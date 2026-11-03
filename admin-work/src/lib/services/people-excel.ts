import ExcelJS from "exceljs";
import type { EngagementLevel, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit, type AuditContext } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { assertCan, type Actor } from "@/lib/rbac";
import { DATA_STATUS, ENGAGEMENT, ENGAGEMENT_ORDER } from "@/lib/labels";
import { fmtDate } from "@/lib/format";
import { normalizeArabicName, normalizePhone } from "@/lib/text";
import { computeDataStatus, peopleWhere, type PeopleFilter } from "./people";

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/// أعمدة ملف الاستيراد بالترتيب. يُتعرَّف على الأعمدة من عناوينها في الصف الأول.
export const IMPORT_COLUMNS = [
  { key: "fullName", header: "الاسم الكامل", required: true, width: 32 },
  { key: "phone", header: "رقم الهاتف", width: 16 },
  { key: "region", header: "المحافظة أو المنطقة", width: 20 },
  { key: "owner", header: "مسؤول المتابعة (اسم المستخدم)", width: 26 },
  { key: "engagement", header: "مستوى التفاعل", width: 16 },
  { key: "available", header: "متاح للتعاون (نعم/لا)", width: 20 },
  { key: "needsUpdate", header: "بانتظار التحديث (نعم/لا)", width: 22 },
  { key: "notes", header: "ملاحظات إدارية", width: 40 },
] as const;

type ColKey = (typeof IMPORT_COLUMNS)[number]["key"];

function styleHeader(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF23415F" } };
  row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  row.height = 28;
  ws.views = [{ state: "frozen", ySplit: 1, rightToLeft: true }];
}

export async function buildTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "نظام إدارة العمل الإداري";
  const ws = wb.addWorksheet("الأشخاص", { views: [{ rightToLeft: true }] });
  ws.columns = IMPORT_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  styleHeader(ws);
  const [regions, users] = await Promise.all([
    prisma.region.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { name: true } }),
    prisma.user.findMany({ where: { isActive: true }, orderBy: { fullName: "asc" }, select: { username: true, fullName: true } }),
  ]);
  // ورقة إرشادات بالقيم المقبولة
  const help = wb.addWorksheet("القيم المقبولة", { views: [{ rightToLeft: true }] });
  help.columns = [
    { header: "المحافظة أو المنطقة", width: 22 },
    { header: "مستوى التفاعل", width: 16 },
    { header: "مسؤول المتابعة: اسم المستخدم", width: 28 },
    { header: "الاسم", width: 26 },
  ];
  styleHeader(help);
  const n = Math.max(regions.length, users.length, ENGAGEMENT_ORDER.length);
  for (let i = 0; i < n; i++) {
    help.addRow([regions[i]?.name ?? "", ENGAGEMENT_ORDER[i] ? ENGAGEMENT[ENGAGEMENT_ORDER[i]].label : "", users[i]?.username ?? "", users[i]?.fullName ?? ""]);
  }
  help.addRow([]);
  help.addRow(["الاسم الكامل إلزامي. رقم الهاتف عراقي من 11 خانة يبدأ بـ 07 (اختياري). نعم/لا للأعمدة المنطقية."]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
    if ("result" in v) return v.result === undefined || v.result === null ? "" : String(v.result);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v).trim();
}

const YES = new Set(["نعم", "yes", "y", "1", "true", "صح", "✓"]);
const NO = new Set(["لا", "no", "n", "0", "false", ""]);

function parseBool(v: string): boolean | null {
  const s = v.trim().toLowerCase();
  if (YES.has(s)) return true;
  if (NO.has(s)) return false;
  return null;
}

export type ImportRowResult = {
  row: number;
  fullName: string;
  phone: string | null;
  status: "ok" | "error" | "name_match";
  messages: string[];
};

export type ImportPreview = {
  fileRows: number;
  ok: number;
  errors: number;
  nameMatches: number;
  rows: ImportRowResult[];
};

type ValidRow = {
  fullName: string;
  normalizedName: string;
  phone: string | null;
  regionId: number | null;
  followUpOwnerId: string | null;
  engagementLevel: EngagementLevel;
  availableForWork: boolean;
  needsUpdate: boolean;
  notes: string | null;
};

async function readSheet(buf: Buffer): Promise<{ rows: Record<ColKey, string>[]; firstRow: number }> {
  if (buf.byteLength > MAX_IMPORT_BYTES) throw new AppError("حجم الملف يتجاوز 5 ميغابايت");
  // ملفات xlsx هي أرشيف zip يبدأ بالتوقيع PK
  if (buf.byteLength < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw new AppError("الملف ليس بصيغة Excel ‏(.xlsx)");
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new AppError("تعذرت قراءة ملف Excel. تأكد أنه بصيغة .xlsx وغير تالف");
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new AppError("الملف لا يحتوي أي ورقة");
  const headerMap = new Map<number, ColKey>();
  const norm = (s: string) => normalizeArabicName(s).replace(/\s/g, "");
  ws.getRow(1).eachCell((cell, col) => {
    const h = norm(cellText(cell.value));
    const match = IMPORT_COLUMNS.find((c) => norm(c.header) === h || (h && norm(c.header).startsWith(h)));
    if (match) headerMap.set(col, match.key);
  });
  if (![...headerMap.values()].includes("fullName")) throw new AppError("لم يُعثر على عمود «الاسم الكامل» في الصف الأول. استخدم القالب المعتمد");
  const rows: Record<ColKey, string>[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const rec = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c.key, ""])) as Record<ColKey, string>;
    for (const [col, key] of headerMap) rec[key] = cellText(row.getCell(col).value);
    if (Object.values(rec).every((v) => !v)) continue;
    rows.push(rec);
    if (rows.length > MAX_IMPORT_ROWS) throw new AppError(`الحد الأقصى ${MAX_IMPORT_ROWS} صف في الملف الواحد`);
  }
  return { rows, firstRow: 2 };
}

async function validate(buf: Buffer, allowNameMatches: boolean) {
  const { rows } = await readSheet(buf);
  const [regions, users] = await Promise.all([
    prisma.region.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, username: true } }),
  ]);
  const regionByName = new Map(regions.map((r) => [normalizeArabicName(r.name), r.id]));
  const userByName = new Map(users.map((u) => [u.username.toLowerCase(), u.id]));
  const engagementByLabel = new Map(ENGAGEMENT_ORDER.map((e) => [normalizeArabicName(ENGAGEMENT[e].label), e] as const));

  const results: ImportRowResult[] = [];
  const valid: ValidRow[] = [];
  const parsed: (ValidRow | null)[] = [];
  const phonesInFile = new Map<string, number>();
  const namesInFile = new Map<string, number>();

  rows.forEach((r, i) => {
    const rowNo = i + 2;
    const msgs: string[] = [];
    const fullName = r.fullName.replace(/\s+/g, " ").trim();
    if (fullName.length < 3) msgs.push("الاسم الكامل مطلوب (3 أحرف على الأقل)");
    if (fullName.length > 150) msgs.push("الاسم طويل جداً");
    let phone: string | null = null;
    try {
      phone = normalizePhone(r.phone);
    } catch (e) {
      msgs.push((e as Error).message);
    }
    let regionId: number | null = null;
    if (r.region) {
      regionId = regionByName.get(normalizeArabicName(r.region)) ?? null;
      if (!regionId) msgs.push(`المحافظة/المنطقة «${r.region}» غير موجودة في القائمة`);
    }
    let followUpOwnerId: string | null = null;
    if (r.owner) {
      followUpOwnerId = userByName.get(r.owner.trim().toLowerCase()) ?? null;
      if (!followUpOwnerId) msgs.push(`مسؤول المتابعة «${r.owner}» ليس اسم مستخدم نشط`);
    }
    let engagementLevel: EngagementLevel = "NONE";
    if (r.engagement) {
      const e = engagementByLabel.get(normalizeArabicName(r.engagement));
      if (e) engagementLevel = e;
      else msgs.push(`مستوى التفاعل «${r.engagement}» غير معروف`);
    }
    const available = parseBool(r.available);
    if (available === null) msgs.push("قيمة «متاح للتعاون» يجب أن تكون نعم أو لا");
    const needsUpdate = parseBool(r.needsUpdate);
    if (needsUpdate === null) msgs.push("قيمة «بانتظار التحديث» يجب أن تكون نعم أو لا");
    const notes = r.notes.trim().slice(0, 1000) || null;
    const normalizedName = normalizeArabicName(fullName);
    if (phone) {
      if (phonesInFile.has(phone)) msgs.push(`رقم الهاتف مكرر في الملف (الصف ${phonesInFile.get(phone)})`);
      else phonesInFile.set(phone, rowNo);
    }
    if (normalizedName && namesInFile.has(normalizedName)) msgs.push(`الاسم مكرر في الملف (الصف ${namesInFile.get(normalizedName)})`);
    else if (normalizedName) namesInFile.set(normalizedName, rowNo);
    results.push({ row: rowNo, fullName, phone, status: msgs.length ? "error" : "ok", messages: msgs });
    parsed.push(
      msgs.length
        ? null
        : { fullName, normalizedName, phone, regionId, followUpOwnerId, engagementLevel, availableForWork: !!available, needsUpdate: !!needsUpdate, notes },
    );
  });

  // المقارنة مع قاعدة البيانات دفعة واحدة
  const phones = [...phonesInFile.keys()];
  const names = [...namesInFile.keys()];
  const [phoneHits, nameHits] = await Promise.all([
    phones.length ? prisma.person.findMany({ where: { phone: { in: phones }, deletedAt: null }, select: { phone: true, serial: true } }) : [],
    names.length ? prisma.person.findMany({ where: { normalizedName: { in: names }, deletedAt: null }, select: { normalizedName: true, serial: true } }) : [],
  ]);
  const phoneSerial = new Map(phoneHits.map((p) => [p.phone!, p.serial]));
  const nameSerial = new Map(nameHits.map((p) => [p.normalizedName, p.serial]));
  results.forEach((res, i) => {
    const v = parsed[i];
    if (!v) return;
    if (v.phone && phoneSerial.has(v.phone)) {
      res.status = "error";
      res.messages.push(`رقم الهاتف مسجل مسبقاً (السجل رقم ${phoneSerial.get(v.phone)})`);
      return;
    }
    if (nameSerial.has(v.normalizedName)) {
      res.messages.push(`يوجد سجل بالاسم نفسه (رقم ${nameSerial.get(v.normalizedName)})`);
      if (!allowNameMatches) {
        res.status = "name_match";
        return;
      }
    }
    valid.push(v);
  });
  const preview: ImportPreview = {
    fileRows: rows.length,
    ok: valid.length,
    errors: results.filter((r) => r.status === "error").length,
    nameMatches: results.filter((r) => r.status === "name_match").length,
    rows: results.filter((r) => r.status !== "ok" || r.messages.length).slice(0, 300),
  };
  return { preview, valid };
}

export async function previewImport(actor: Actor, buf: Buffer, allowNameMatches: boolean): Promise<ImportPreview> {
  assertCan(actor, "people.import");
  return (await validate(buf, allowNameMatches)).preview;
}

/// يستورد الصفوف السليمة فقط في معاملة واحدة. الصفوف الخاطئة لا تُستورد ويظهر سببها في المعاينة.
export async function commitImport(actor: Actor, buf: Buffer, fileName: string, allowNameMatches: boolean, ctx?: AuditContext) {
  assertCan(actor, "people.import");
  const { preview, valid } = await validate(buf, allowNameMatches);
  if (valid.length === 0) throw new AppError("لا توجد صفوف سليمة للاستيراد");
  const created = await prisma.$transaction(
    async (tx) => {
      const data: Prisma.PersonCreateManyInput[] = valid.map(({ needsUpdate, ...v }) => ({
        ...v,
        dataStatus: computeDataStatus({ regionId: v.regionId, followUpOwnerId: v.followUpOwnerId, needsUpdate }),
        createdById: actor.id,
        updatedById: actor.id,
      }));
      const rows = await tx.person.createManyAndReturn({ data, select: { id: true, serial: true } });
      await writeAudit(tx, {
        actor,
        action: "person.import",
        entityType: "Person",
        after: { fileName: fileName.slice(0, 200), imported: rows.length, skippedErrors: preview.errors, skippedNameMatches: preview.nameMatches, serials: rows.map((r) => r.serial) },
        ctx,
      });
      return rows.length;
    },
    { timeout: 120_000 },
  );
  return { created, preview };
}

// ─────────────────────────── التصدير ───────────────────────────

export async function exportPeople(actor: Actor, f: PeopleFilter, ctx?: AuditContext): Promise<{ buf: Buffer; count: number }> {
  assertCan(actor, "people.export");
  const where = await peopleWhere(f);
  const rows = await prisma.person.findMany({
    where,
    orderBy: [{ [f.sort]: f.dir }, { serial: "desc" }],
    take: 50_000,
    include: {
      region: { select: { name: true } },
      followUpOwner: { select: { fullName: true } },
      _count: { select: { tasks: { where: { consentStatus: "ACCEPTED", deletedAt: null } } } },
    },
  });
  const wb = new ExcelJS.Workbook();
  wb.creator = "نظام إدارة العمل الإداري";
  const ws = wb.addWorksheet("الأشخاص", { views: [{ rightToLeft: true }] });
  ws.columns = [
    { header: "الرقم التسلسلي", key: "serial", width: 14 },
    { header: "الاسم الكامل", key: "fullName", width: 32 },
    { header: "رقم الهاتف", key: "phone", width: 16 },
    { header: "المحافظة أو المنطقة", key: "region", width: 20 },
    { header: "مسؤول المتابعة", key: "owner", width: 24 },
    { header: "حالة البيانات", key: "status", width: 16 },
    { header: "مستوى التفاعل", key: "engagement", width: 14 },
    { header: "متاح للتعاون", key: "available", width: 14 },
    { header: "المهام الموافق عليها", key: "tasks", width: 18 },
    { header: "تاريخ الإضافة", key: "createdAt", width: 14 },
    { header: "آخر تحديث", key: "updatedAt", width: 14 },
    { header: "ملاحظات إدارية", key: "notes", width: 40 },
  ];
  styleHeader(ws);
  for (const p of rows) {
    ws.addRow({
      serial: p.serial,
      fullName: p.fullName,
      phone: p.phone ?? "",
      region: p.region?.name ?? "",
      owner: p.followUpOwner?.fullName ?? "",
      status: DATA_STATUS[p.dataStatus].label,
      engagement: ENGAGEMENT[p.engagementLevel].label,
      available: p.availableForWork ? "نعم" : "لا",
      tasks: p._count.tasks,
      createdAt: fmtDate(p.createdAt),
      updatedAt: fmtDate(p.updatedAt),
      notes: p.notes ?? "",
    });
  }
  // يُعامَل الهاتف كنص حتى لا يحذف Excel الصفر الأول
  ws.getColumn("phone").numFmt = "@";
  await prisma.$transaction((tx) => writeAudit(tx, { actor, action: "person.export", entityType: "Person", after: { filters: f, count: rows.length }, ctx }));
  return { buf: Buffer.from(await wb.xlsx.writeBuffer()), count: rows.length };
}
