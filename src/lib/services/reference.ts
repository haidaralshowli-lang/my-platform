import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { writeAudit, type AuditContext } from "@/lib/audit";
import { assertCan, type Actor } from "@/lib/rbac/actor";

/// القوائم المرجعية القابلة للإدارة. لا تُحذف عناصرها (قد ترتبط بها معاملات)؛ تُعطَّل فقط.
export const REFERENCE_LISTS = {
  violationType: { labelAr: "أنواع المخالفات", hasCode: true, hasDescription: true },
  detectionSource: { labelAr: "مصادر اكتشاف المخالفة", hasCode: false, hasDescription: false },
  entityType: { labelAr: "أنواع الجهات", hasCode: false, hasDescription: false },
  activityType: { labelAr: "أنواع النشاط الإعلامي أو الاتصالي", hasCode: false, hasDescription: false },
  office: { labelAr: "الفروع والمكاتب", hasCode: true, hasDescription: false },
  division: { labelAr: "الشعب المختصة", hasCode: false, hasDescription: false },
  judgmentResultType: { labelAr: "تصنيفات نتيجة الحكم القضائي", hasCode: false, hasDescription: false },
} as const;

export type ReferenceList = keyof typeof REFERENCE_LISTS;

export const referenceItemSchema = z.object({
  list: z.enum(Object.keys(REFERENCE_LISTS) as [ReferenceList, ...ReferenceList[]]),
  nameAr: z.string().trim().min(2, "الاسم مطلوب").max(150),
  code: z
    .string()
    .trim()
    .max(20)
    .optional()
    .transform((v) => (v ? v.toUpperCase() : undefined))
    .refine((v) => !v || /^[A-Z0-9_-]+$/.test(v), "الرمز: حروف لاتينية وأرقام فقط"),
  description: z.string().trim().max(500).optional().transform((v) => v || null),
  governorateId: z.string().optional().transform((v) => v || undefined),
  officeId: z.string().optional().transform((v) => v || null),
});

export type ReferenceItemInput = z.infer<typeof referenceItemSchema>;

type Delegate = {
  create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<{ id: string }>;
  findUnique(args: { where: { id: string } }): Promise<Record<string, unknown> | null>;
};

function delegate(list: ReferenceList, tx: typeof prisma | Parameters<Parameters<typeof prisma.$transaction>[0]>[0]): Delegate {
  return (tx as unknown as Record<string, Delegate>)[list];
}

export async function createReferenceItem(actor: Actor, input: ReferenceItemInput, ctx?: AuditContext): Promise<string> {
  assertCan(actor, "reference.manage");
  const def = REFERENCE_LISTS[input.list];
  if (def.hasCode && !input.code) throw new AppError("الرمز مطلوب لهذه القائمة");
  const data: Record<string, unknown> = { nameAr: input.nameAr };
  if (def.hasCode) data.code = input.code;
  if (def.hasDescription) data.description = input.description;
  if (input.list === "office") {
    if (!input.governorateId) throw new AppError("المحافظة مطلوبة للفرع أو المكتب");
    data.governorateId = input.governorateId;
  }
  if (input.list === "division") data.officeId = input.officeId;
  return prisma.$transaction(async (tx) => {
    const row = await delegate(input.list, tx).create({ data });
    await writeAudit(tx, { actor, action: "reference.created", entityType: input.list, entityId: row.id, after: data, ctx });
    return row.id;
  });
}

export async function updateReferenceItem(actor: Actor, list: ReferenceList, id: string, patch: { nameAr?: string; description?: string | null; isActive?: boolean }, ctx?: AuditContext): Promise<void> {
  assertCan(actor, "reference.manage");
  await prisma.$transaction(async (tx) => {
    const d = delegate(list, tx);
    const before = await d.findUnique({ where: { id } });
    if (!before) throw notFound();
    const data: Record<string, unknown> = {};
    if (patch.nameAr !== undefined) {
      if (patch.nameAr.trim().length < 2) throw new AppError("الاسم مطلوب");
      data.nameAr = patch.nameAr.trim();
    }
    if (patch.description !== undefined && REFERENCE_LISTS[list].hasDescription) data.description = patch.description;
    if (patch.isActive !== undefined) data.isActive = patch.isActive;
    await d.update({ where: { id }, data });
    await writeAudit(tx, {
      actor,
      action: patch.isActive === false ? "reference.deactivated" : patch.isActive === true ? "reference.activated" : "reference.updated",
      entityType: list,
      entityId: id,
      before: Object.fromEntries(Object.keys(data).map((k) => [k, before[k]])),
      after: data,
      ctx,
    });
  });
}

export async function loadReferenceLists() {
  const [violationType, detectionSource, entityType, activityType, office, division, judgmentResultType, governorates] = await Promise.all([
    prisma.violationType.findMany({ orderBy: { nameAr: "asc" } }),
    prisma.detectionSource.findMany({ orderBy: { nameAr: "asc" } }),
    prisma.entityType.findMany({ orderBy: { nameAr: "asc" } }),
    prisma.activityType.findMany({ orderBy: { nameAr: "asc" } }),
    prisma.office.findMany({ orderBy: [{ governorate: { sortOrder: "asc" } }, { nameAr: "asc" }], include: { governorate: true } }),
    prisma.division.findMany({ orderBy: { nameAr: "asc" }, include: { office: true } }),
    prisma.judgmentResultType.findMany({ orderBy: { nameAr: "asc" } }),
    prisma.governorate.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  return { violationType, detectionSource, entityType, activityType, office, division, judgmentResultType, governorates };
}
