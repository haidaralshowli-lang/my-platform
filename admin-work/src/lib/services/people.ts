import { Prisma, type DataStatus, type EngagementLevel } from "@prisma/client";
import { z } from "zod";
import { prisma, type Tx } from "@/lib/db";
import { writeAudit, type AuditContext } from "@/lib/audit";
import { AppError, notFound } from "@/lib/errors";
import { assertCan, type Actor } from "@/lib/rbac";
import { getSetting } from "@/lib/settings";
import { normalizeArabicName, normalizePhone, toLatinDigits } from "@/lib/text";

/// الحد الأدنى للتشابه (pg_trgm) لاعتبار اسمين متشابهين يستحقان المراجعة
export const SIMILARITY_THRESHOLD = 0.55;
export const PAGE_SIZE = 25;

// ─────────────────────────── التحقق والحالة ───────────────────────────

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

export const personSchema = z.object({
  fullName: z.string().trim().min(3, "الاسم الكامل مطلوب (3 أحرف على الأقل)").max(150, "الاسم طويل جداً"),
  phone: z
    .string()
    .optional()
    .transform((v, ctx) => {
      try {
        return normalizePhone(v);
      } catch (e) {
        ctx.addIssue({ code: "custom", message: (e as Error).message });
        return z.NEVER;
      }
    }),
  regionId: z.coerce.number().int().positive().optional().nullable().catch(null),
  followUpOwnerId: z.string().uuid().optional().nullable().catch(null),
  engagementLevel: z.enum(["HIGH", "MEDIUM", "LOW", "NONE"]).default("NONE"),
  availableForWork: z.boolean().default(false),
  needsUpdate: z.boolean().default(false),
  notes: optionalText(1000),
  /// تأكيد المستخدم أن الاسم المطابق لسجل موجود يعود لشخص مختلف
  confirmDistinct: z.boolean().default(false),
});

export type PersonInput = z.input<typeof personSchema>;

/// حالة اكتمال البيانات: «بانتظار التحديث» إذا عُلِّم السجل بذلك، و«ناقصة» إذا غابت المنطقة أو مسؤول المتابعة،
/// وإلا «مكتملة». رقم الهاتف اختياري («عند الحاجة») فلا يؤثر في الاكتمال.
export function computeDataStatus(p: { regionId?: number | null; followUpOwnerId?: string | null; needsUpdate: boolean }): DataStatus {
  if (p.needsUpdate) return "NEEDS_UPDATE";
  if (!p.regionId || !p.followUpOwnerId) return "INCOMPLETE";
  return "COMPLETE";
}

export const MISSING_FIELDS_HINT = "يكتمل السجل بتحديد المحافظة/المنطقة ومسؤول المتابعة.";

async function staleCutoff(db: Tx | typeof prisma): Promise<Date> {
  const days = await getSetting(db, "people.staleDays");
  return new Date(Date.now() - days * 86_400_000);
}

async function assertRefs(tx: Tx, regionId: number | null | undefined, ownerId: string | null | undefined) {
  if (regionId && !(await tx.region.findFirst({ where: { id: regionId } }))) throw new AppError("المحافظة/المنطقة المختارة غير موجودة");
  if (ownerId && !(await tx.user.findFirst({ where: { id: ownerId, isActive: true } }))) throw new AppError("مسؤول المتابعة المختار غير موجود أو معطل");
}

function orderedPair(a: string, b: string): { aId: string; bId: string } {
  return a < b ? { aId: a, bId: b } : { aId: b, bId: a };
}

const AUDIT_FIELDS = {
  id: true,
  serial: true,
  fullName: true,
  phone: true,
  regionId: true,
  followUpOwnerId: true,
  dataStatus: true,
  engagementLevel: true,
  availableForWork: true,
  notes: true,
  deletedAt: true,
  mergedIntoId: true,
} as const;

// ─────────────────────────── التكرار والتشابه ───────────────────────────

export type SimilarPerson = { id: string; serial: number; fullName: string; phone: string | null; regionName: string | null; score: number };

/// الأسماء المتشابهة مع اسم معين بين السجلات غير المحذوفة (مرتبة بالأكثر تشابهاً)
export async function findSimilar(name: string, opts: { excludeId?: string; limit?: number } = {}): Promise<SimilarPerson[]> {
  const n = normalizeArabicName(name);
  if (n.length < 3) return [];
  return prisma.$queryRaw<SimilarPerson[]>`
    SELECT p.id, p.serial, p."fullName", p.phone, r.name AS "regionName",
           round(similarity(p."normalizedName", ${n})::numeric, 2)::float AS score
    FROM "Person" p LEFT JOIN "Region" r ON r.id = p."regionId"
    WHERE p."deletedAt" IS NULL
      AND (p."normalizedName" = ${n} OR similarity(p."normalizedName", ${n}) >= ${SIMILARITY_THRESHOLD})
      ${opts.excludeId ? Prisma.sql`AND p.id <> ${opts.excludeId}::uuid` : Prisma.empty}
    ORDER BY score DESC, p.serial
    LIMIT ${opts.limit ?? 8}`;
}

export type DuplicatePair = {
  aId: string;
  aSerial: number;
  aName: string;
  aPhone: string | null;
  aRegion: string | null;
  bId: string;
  bSerial: number;
  bName: string;
  bPhone: string | null;
  bRegion: string | null;
  score: number;
};

/// أزواج السجلات المتشابهة التي لم تُراجع بعد (لصفحة مراجعة التكرار)
export async function duplicatePairs(limit = 100): Promise<DuplicatePair[]> {
  return prisma.$transaction(async (tx) => {
    // يجعل المعامل % يستخدم الحد نفسه فيستفيد من فهرس gin_trgm
    await tx.$executeRaw`SELECT set_config('pg_trgm.similarity_threshold', ${String(SIMILARITY_THRESHOLD)}, true)`;
    return tx.$queryRaw<DuplicatePair[]>`
      SELECT a.id AS "aId", a.serial AS "aSerial", a."fullName" AS "aName", a.phone AS "aPhone", ra.name AS "aRegion",
             b.id AS "bId", b.serial AS "bSerial", b."fullName" AS "bName", b.phone AS "bPhone", rb.name AS "bRegion",
             round(similarity(a."normalizedName", b."normalizedName")::numeric, 2)::float AS score
      FROM "Person" a
      JOIN "Person" b ON a.id < b.id AND a."normalizedName" % b."normalizedName"
      LEFT JOIN "Region" ra ON ra.id = a."regionId"
      LEFT JOIN "Region" rb ON rb.id = b."regionId"
      WHERE a."deletedAt" IS NULL AND b."deletedAt" IS NULL
        AND NOT EXISTS (SELECT 1 FROM "PersonDistinctPair" d WHERE d."aId" = a.id AND d."bId" = b.id)
      ORDER BY score DESC, a.serial
      LIMIT ${limit}`;
  });
}

export async function markDistinct(actor: Actor, idA: string, idB: string, ctx?: AuditContext) {
  assertCan(actor, "people.edit");
  if (idA === idB) throw new AppError("لا يمكن مقارنة السجل بنفسه");
  const pair = orderedPair(idA, idB);
  await prisma.$transaction(async (tx) => {
    await tx.personDistinctPair.upsert({ where: { aId_bId: pair }, create: { ...pair, createdById: actor.id }, update: {} });
    await writeAudit(tx, { actor, action: "person.mark_distinct", entityType: "Person", entityId: pair.aId, after: pair, ctx });
  });
}

/// يمنع الإنشاء/التعديل إذا طابق الاسم الموحد سجلاً آخر حرفياً، ما لم يؤكد المستخدم أنهما شخصان مختلفان
async function checkExactNameConflict(tx: Tx, actor: Actor, normalizedName: string, confirmDistinct: boolean, selfId?: string) {
  const matches = await tx.person.findMany({
    where: { normalizedName, deletedAt: null, ...(selfId ? { id: { not: selfId } } : {}) },
    select: { id: true, serial: true, fullName: true },
    take: 5,
  });
  if (matches.length === 0) return [];
  // يُستثنى من سبق تأكيد أنه شخص مختلف عن هذا السجل
  let pending = matches;
  if (selfId) {
    const confirmed = await tx.personDistinctPair.findMany({
      where: { OR: matches.map((m) => orderedPair(selfId, m.id)) },
      select: { aId: true, bId: true },
    });
    const ok = new Set(confirmed.map((c) => (c.aId === selfId ? c.bId : c.aId)));
    pending = matches.filter((m) => !ok.has(m.id));
    if (pending.length === 0) return [];
  }
  if (!confirmDistinct) {
    throw new AppError(
      `يوجد سجل بالاسم نفسه: ${pending.map((m) => `${m.fullName} (رقم ${m.serial})`).join("، ")}. راجع السجل الموجود، أو أكد أن هذا شخص مختلف.`,
      "CONFLICT",
    );
  }
  return pending.map((m) => m.id);
}

async function rememberDistinct(tx: Tx, actor: Actor, personId: string, others: string[]) {
  for (const o of others) {
    const pair = orderedPair(personId, o);
    await tx.personDistinctPair.upsert({ where: { aId_bId: pair }, create: { ...pair, createdById: actor.id }, update: {} });
  }
}

function phoneConflict(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new AppError("رقم الهاتف مسجل لشخص آخر", "CONFLICT");
  throw e;
}

// ─────────────────────────── الإنشاء والتعديل ───────────────────────────

export async function createPerson(actor: Actor, input: PersonInput, ctx?: AuditContext) {
  assertCan(actor, "people.create");
  const d = personSchema.parse(input);
  const normalizedName = normalizeArabicName(d.fullName);
  return prisma
    .$transaction(async (tx) => {
      await assertRefs(tx, d.regionId, d.followUpOwnerId);
      const distinctFrom = await checkExactNameConflict(tx, actor, normalizedName, d.confirmDistinct);
      if (d.phone && (await tx.person.findFirst({ where: { phone: d.phone, deletedAt: null } }))) throw new AppError("رقم الهاتف مسجل لشخص آخر", "CONFLICT");
      const p = await tx.person.create({
        data: {
          fullName: d.fullName,
          normalizedName,
          phone: d.phone,
          regionId: d.regionId ?? null,
          followUpOwnerId: d.followUpOwnerId ?? null,
          engagementLevel: d.engagementLevel,
          availableForWork: d.availableForWork,
          notes: d.notes,
          dataStatus: computeDataStatus({ ...d, needsUpdate: d.needsUpdate }),
          createdById: actor.id,
          updatedById: actor.id,
        },
        select: AUDIT_FIELDS,
      });
      await rememberDistinct(tx, actor, p.id, distinctFrom);
      await writeAudit(tx, { actor, action: "person.create", entityType: "Person", entityId: p.id, after: p, ctx });
      return p;
    })
    .catch(phoneConflict);
}

export async function updatePerson(actor: Actor, id: string, input: PersonInput, ctx?: AuditContext) {
  assertCan(actor, "people.edit");
  const d = personSchema.parse(input);
  const normalizedName = normalizeArabicName(d.fullName);
  return prisma
    .$transaction(async (tx) => {
      const before = await tx.person.findFirst({ where: { id, deletedAt: null }, select: AUDIT_FIELDS });
      if (!before) throw notFound();
      await assertRefs(tx, d.regionId, d.followUpOwnerId);
      const distinctFrom = await checkExactNameConflict(tx, actor, normalizedName, d.confirmDistinct, id);
      if (d.phone && (await tx.person.findFirst({ where: { phone: d.phone, deletedAt: null, id: { not: id } } }))) throw new AppError("رقم الهاتف مسجل لشخص آخر", "CONFLICT");
      const after = await tx.person.update({
        where: { id },
        data: {
          fullName: d.fullName,
          normalizedName,
          phone: d.phone,
          regionId: d.regionId ?? null,
          followUpOwnerId: d.followUpOwnerId ?? null,
          engagementLevel: d.engagementLevel,
          availableForWork: d.availableForWork,
          notes: d.notes,
          dataStatus: computeDataStatus({ ...d, needsUpdate: d.needsUpdate }),
          updatedById: actor.id,
        },
        select: AUDIT_FIELDS,
      });
      await rememberDistinct(tx, actor, id, distinctFrom);
      await writeAudit(tx, { actor, action: "person.update", entityType: "Person", entityId: id, before, after, ctx });
      return after;
    })
    .catch(phoneConflict);
}

// ─────────────────────────── الحذف والاستعادة والدمج ───────────────────────────

export async function deletePerson(actor: Actor, id: string, reason: string, ctx?: AuditContext) {
  assertCan(actor, "people.delete");
  if (reason.trim().length < 3) throw new AppError("يرجى ذكر سبب الحذف");
  return prisma.$transaction(async (tx) => {
    const before = await tx.person.findFirst({ where: { id, deletedAt: null }, select: AUDIT_FIELDS });
    if (!before) throw notFound();
    const after = await tx.person.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: actor.id, deleteReason: reason.trim() },
      select: AUDIT_FIELDS,
    });
    await writeAudit(tx, { actor, action: "person.delete", entityType: "Person", entityId: id, before, after, reason, ctx });
  });
}

export async function restorePerson(actor: Actor, id: string, ctx?: AuditContext) {
  assertCan(actor, "people.delete");
  return prisma
    .$transaction(async (tx) => {
      const before = await tx.person.findFirst({ where: { id, deletedAt: { not: null } }, select: AUDIT_FIELDS });
      if (!before) throw notFound();
      if (before.mergedIntoId) throw new AppError("هذا السجل دُمج في سجل آخر ونُقلت ارتباطاته إليه، لذا لا يُستعاد");
      const after = await tx.person.update({ where: { id }, data: { deletedAt: null, deletedById: null, deleteReason: null, updatedById: actor.id }, select: AUDIT_FIELDS });
      await writeAudit(tx, { actor, action: "person.restore", entityType: "Person", entityId: id, before, after, ctx });
    })
    .catch(phoneConflict);
}

const ENGAGEMENT_RANK: Record<EngagementLevel, number> = { HIGH: 3, MEDIUM: 2, LOW: 1, NONE: 0 };

/// دمج سجل مكرر في السجل الأساسي: تُكمَّل الحقول الفارغة في الأساسي من المكرر، وتُنقل المهام والطلبات المرتبطة،
/// ويُحذف المكرر حذفاً ناعماً مع الإشارة إلى السجل الذي دُمج فيه.
export async function mergePeople(actor: Actor, primaryId: string, duplicateId: string, ctx?: AuditContext) {
  assertCan(actor, "people.merge");
  if (primaryId === duplicateId) throw new AppError("لا يمكن دمج السجل في نفسه");
  return prisma.$transaction(async (tx) => {
    // قفل السجلين بترتيب ثابت لمنع التعارض مع عملية دمج متزامنة
    await tx.$queryRaw`SELECT id FROM "Person" WHERE id IN (${primaryId}::uuid, ${duplicateId}::uuid) ORDER BY id FOR UPDATE`;
    const [p, d] = await Promise.all([
      tx.person.findFirst({ where: { id: primaryId, deletedAt: null } }),
      tx.person.findFirst({ where: { id: duplicateId, deletedAt: null } }),
    ]);
    if (!p || !d) throw notFound("أحد السجلين غير موجود أو محذوف");
    const pick = <T,>(a: T | null, b: T | null) => (a === null || a === undefined || a === "" ? b : a);
    const notes = [p.notes, d.notes && d.notes !== p.notes ? `(من السجل المدمج رقم ${d.serial}) ${d.notes}` : null].filter(Boolean).join("\n") || null;
    const merged = {
      phone: pick(p.phone, d.phone),
      regionId: pick(p.regionId, d.regionId),
      followUpOwnerId: pick(p.followUpOwnerId, d.followUpOwnerId),
      engagementLevel: ENGAGEMENT_RANK[d.engagementLevel] > ENGAGEMENT_RANK[p.engagementLevel] ? d.engagementLevel : p.engagementLevel,
      availableForWork: p.availableForWork || d.availableForWork,
      notes: notes && notes.length > 1000 ? notes.slice(0, 1000) : notes,
    };
    const before = { primary: await tx.person.findUnique({ where: { id: p.id }, select: AUDIT_FIELDS }), duplicate: await tx.person.findUnique({ where: { id: d.id }, select: AUDIT_FIELDS }) };
    // يُحذف المكرر أولاً حتى يتحرر رقم هاتفه من الفهرس الفريد
    await tx.person.update({ where: { id: d.id }, data: { deletedAt: new Date(), deletedById: actor.id, deleteReason: `دُمج في السجل رقم ${p.serial}`, mergedIntoId: p.id } });
    const movedTasks = await tx.task.updateMany({ where: { assigneeId: d.id }, data: { assigneeId: p.id } });
    const movedRequests = await tx.request.updateMany({ where: { applicantId: d.id }, data: { applicantId: p.id } });
    await tx.person.updateMany({ where: { mergedIntoId: d.id }, data: { mergedIntoId: p.id } });
    const after = await tx.person.update({
      where: { id: p.id },
      data: {
        ...merged,
        dataStatus: computeDataStatus({ ...merged, needsUpdate: p.dataStatus === "NEEDS_UPDATE" }),
        updatedById: actor.id,
      },
      select: AUDIT_FIELDS,
    });
    await writeAudit(tx, {
      actor,
      action: "person.merge",
      entityType: "Person",
      entityId: p.id,
      before,
      after: { primary: after, duplicateId: d.id, movedTasks: movedTasks.count, movedRequests: movedRequests.count },
      ctx,
    });
    return after;
  });
}

// ─────────────────────────── البحث والقراءة ───────────────────────────

export const peopleFilterSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  /// رقم المحافظة، أو none للسجلات دون محافظة
  region: z.union([z.literal("none"), z.coerce.number().int().positive()]).optional().catch(undefined),
  /// معرف مسؤول المتابعة، أو none للسجلات دون مسؤول
  owner: z.union([z.literal("none"), z.string().uuid()]).optional().catch(undefined),
  /// COMPLETE | INCOMPLETE | NEEDS_UPDATE | needs (بانتظار التحديث أو لم يُحدَّث منذ مدة)
  status: z.enum(["COMPLETE", "INCOMPLETE", "NEEDS_UPDATE", "needs"]).optional().catch(undefined),
  engagement: z.enum(["HIGH", "MEDIUM", "LOW", "NONE"]).optional().catch(undefined),
  available: z.enum(["1", "0"]).optional().catch(undefined),
  sort: z.enum(["serial", "fullName", "updatedAt", "createdAt"]).default("serial").catch("serial"),
  dir: z.enum(["asc", "desc"]).default("desc").catch("desc"),
  page: z.coerce.number().int().min(1).max(100000).default(1).catch(1),
});

export type PeopleFilter = z.infer<typeof peopleFilterSchema>;

export async function peopleWhere(f: PeopleFilter): Promise<Prisma.PersonWhereInput> {
  const and: Prisma.PersonWhereInput[] = [{ deletedAt: null }];
  if (f.q) {
    const q = toLatinDigits(f.q).trim();
    const or: Prisma.PersonWhereInput[] = [{ normalizedName: { contains: normalizeArabicName(q) } }];
    if (/^\d{1,9}$/.test(q)) or.push({ serial: Number(q) });
    const digits = q.replace(/\D/g, "");
    if (digits.length >= 4) or.push({ phone: { contains: digits.replace(/^964/, "0") } });
    and.push({ OR: or });
  }
  if (f.region) and.push({ regionId: f.region === "none" ? null : f.region });
  if (f.owner) and.push({ followUpOwnerId: f.owner === "none" ? null : f.owner });
  if (f.engagement) and.push({ engagementLevel: f.engagement });
  if (f.available) and.push({ availableForWork: f.available === "1" });
  if (f.status === "needs") and.push({ OR: [{ dataStatus: "NEEDS_UPDATE" }, { updatedAt: { lt: await staleCutoff(prisma) } }] });
  else if (f.status) and.push({ dataStatus: f.status });
  return { AND: and };
}

export async function listPeople(f: PeopleFilter) {
  const where = await peopleWhere(f);
  const [total, rows, cutoff] = await Promise.all([
    prisma.person.count({ where }),
    prisma.person.findMany({
      where,
      orderBy: [{ [f.sort]: f.dir }, { serial: "desc" }],
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { region: { select: { name: true } }, followUpOwner: { select: { fullName: true } } },
    }),
    staleCutoff(prisma),
  ]);
  return { total, rows, cutoff, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getPerson(id: string, opts: { includeDeleted?: boolean } = {}) {
  const p = await prisma.person.findFirst({
    where: { id, ...(opts.includeDeleted ? {} : { deletedAt: null }) },
    include: {
      region: { select: { name: true } },
      followUpOwner: { select: { id: true, fullName: true } },
      mergedInto: { select: { id: true, serial: true, fullName: true } },
      tasks: { where: { consentStatus: "ACCEPTED", deletedAt: null }, orderBy: { dueDate: "asc" }, select: { id: true, number: true, title: true, status: true, dueDate: true, progress: true } },
    },
  });
  if (!p) throw notFound();
  return p;
}

/// الخيارات المرجعية لنماذج الأشخاص
export async function personFormOptions() {
  const [regions, owners] = await Promise.all([
    prisma.region.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    prisma.user.findMany({ where: { isActive: true }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }),
  ]);
  return { regions, owners };
}
