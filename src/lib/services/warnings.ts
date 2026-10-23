import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError, forbidden, notFound } from "@/lib/errors";
import { writeAudit, type AuditContext } from "@/lib/audit";
import { assertCan, can, inScope, type Actor } from "@/lib/rbac/actor";
import { applyTransition, lockViolation } from "@/lib/workflow";
import { nextOfficialNumber } from "@/lib/numbering";
import { formatDate, isFutureDateKey, localDateKey } from "@/lib/datetime";
import { insertAttachments, prepareFiles, type IncomingFile } from "./attachments";

// ─── القوالب ───

/// الحقول القابلة للتعبئة التلقائية في قالب الإنذار
export const PLACEHOLDERS = {
  "warning.number": "رقم الإنذار",
  "warning.date": "تاريخ الإصدار",
  "violation.number": "رقم المخالفة",
  "violation.discoveredAt": "تاريخ اكتشاف المخالفة",
  "violation.description": "وصف المخالفة",
  "violation.type": "نوع المخالفة",
  "offender.name": "اسم الجهة المخالفة",
  "offender.address": "عنوان الجهة المخالفة",
  "offender.license": "رقم إجازة الجهة",
  "legal.basis": "السند القانوني المعتمد",
  "required.action": "الإجراء المطلوب",
  "response.period": "المدة المحددة للاستجابة",
  "issuer": "الجهة المصدرة",
} as const;

export type PlaceholderKey = keyof typeof PLACEHOLDERS;

const PH_RE = /\{\{\s*([a-zA-Z.]+)\s*\}\}/g;

export function templateErrors(body: string): string[] {
  const errs: string[] = [];
  for (const m of body.matchAll(PH_RE)) if (!(m[1] in PLACEHOLDERS)) errs.push(`حقل غير معروف: {{${m[1]}}}`);
  if (/[{}]{2}/.test(body.replace(PH_RE, ""))) errs.push("أقواس حقول غير مكتملة");
  return [...new Set(errs)];
}

/// تعبئة القالب نصياً (النتيجة نص عادي؛ يُهرَّب عند العرض فلا يُحقن أي HTML)
export function renderTemplate(body: string, values: Record<PlaceholderKey, string>): string {
  return body.replace(PH_RE, (_m, k: string) => (k in values ? values[k as PlaceholderKey] : `{{${k}}}`));
}

export const templateSchema = z.object({
  name: z.string().trim().min(3, "اسم القالب مطلوب").max(150),
  body: z.string().trim().min(20, "نص القالب قصير جداً").max(20000),
  notes: z.string().trim().max(500).optional().transform((v) => v || null),
});

export async function createTemplate(actor: Actor, input: z.infer<typeof templateSchema>, ctx?: AuditContext) {
  assertCan(actor, "template.manage");
  const errs = templateErrors(input.body);
  if (errs.length) throw new AppError(errs.join("، "));
  return prisma.$transaction(async (tx) => {
    const t = await tx.warningTemplate.create({
      data: { name: input.name, createdById: actor.id, versions: { create: { versionNo: 1, body: input.body, notes: input.notes, createdById: actor.id } } },
    });
    await writeAudit(tx, { actor, action: "template.created", entityType: "WarningTemplate", entityId: t.id, after: input, ctx });
    return t.id;
  });
}

/// تعديل القالب ينشئ إصداراً جديداً؛ الإنذارات السابقة تحتفظ بنصها كما صدر
export async function updateTemplate(actor: Actor, templateId: string, input: { body: string; notes: string }, ctx?: AuditContext) {
  assertCan(actor, "template.manage");
  if (!input.notes.trim()) throw new AppError("يجب بيان سبب التعديل");
  const errs = templateErrors(input.body);
  if (errs.length) throw new AppError(errs.join("، "));
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ currentVersionNo: number }[]>`SELECT "currentVersionNo" FROM "WarningTemplate" WHERE id = ${templateId} FOR UPDATE`;
    if (!rows.length) throw notFound();
    const next = rows[0].currentVersionNo + 1;
    await tx.warningTemplateVersion.create({ data: { templateId, versionNo: next, body: input.body, notes: input.notes.trim(), createdById: actor.id } });
    await tx.warningTemplate.update({ where: { id: templateId }, data: { currentVersionNo: next } });
    await writeAudit(tx, { actor, action: "template.version_added", entityType: "WarningTemplate", entityId: templateId, after: { versionNo: next }, reason: input.notes, ctx });
  });
}

export async function setTemplateActive(actor: Actor, templateId: string, active: boolean, ctx?: AuditContext) {
  assertCan(actor, "template.manage");
  await prisma.$transaction(async (tx) => {
    await tx.warningTemplate.update({ where: { id: templateId }, data: { isActive: active } });
    await writeAudit(tx, { actor, action: active ? "template.activated" : "template.deactivated", entityType: "WarningTemplate", entityId: templateId, ctx });
  });
}

// ─── الإنذار ───

export const prepareWarningSchema = z.object({
  templateId: z.string().min(1, "يجب اختيار القالب"),
  requiredAction: z.string().trim().min(5, "الإجراء المطلوب مطلوب").max(5000),
  responsePeriodText: z.string().trim().min(2, "المدة المحددة للاستجابة مطلوبة").max(300),
});

const ISSUER = "هيئة الإعلام والاتصالات";

/// إعداد الإنذار من القالب المعتمد: تُحفظ لقطة ثابتة من النص، ويولَّد رقم الإنذار في الخادم
export async function prepareWarning(actor: Actor, violationId: string, input: z.infer<typeof prepareWarningSchema>, ctx?: AuditContext): Promise<string> {
  assertCan(actor, "warning.prepare");
  return prisma.$transaction(async (tx) => {
    const v = await lockViolation(tx, violationId);
    if (!inScope(actor, v)) throw notFound();
    if (v.stage !== "WARNING_PREPARATION") throw new AppError("المعاملة ليست في مرحلة إعداد الإنذار", "CONFLICT");
    const t = await tx.warningTemplate.findUnique({ where: { id: input.templateId }, include: { versions: { orderBy: { versionNo: "desc" }, take: 1 } } });
    if (!t || !t.isActive) throw new AppError("القالب غير موجود أو معطل");
    const tv = t.versions[0];
    const full = await tx.violation.findUniqueOrThrow({ where: { id: violationId }, include: { violationType: true, office: { include: { governorate: true } } } });
    const refs = await tx.violationLegalReference.findMany({
      where: { violationId, purpose: { in: ["LEGAL", "WARNING", "TECHNICAL"] } },
      include: { article: { include: { documentVersion: { include: { document: true } } } } },
      orderBy: { createdAt: "asc" },
    });
    if (refs.length === 0) throw new AppError("لا يوجد سند قانوني مرتبط بالمخالفة");
    // يُفضَّل سند الإنذار ثم السند القانوني ثم الفني، دون تكرار المادة نفسها
    const order = { WARNING: 0, LEGAL: 1, TECHNICAL: 2, POTENTIAL: 3 } as const;
    const seen = new Set<string>();
    const basis = refs
      .sort((a, b) => order[a.purpose] - order[b.purpose])
      .filter((r) => (seen.has(r.articleId) ? false : (seen.add(r.articleId), true)))
      .map((r) => {
        const d = r.article.documentVersion.document;
        return `المادة (${r.article.articleNumber})${r.article.paragraph ? ` الفقرة (${r.article.paragraph})` : ""} من ${d.title}${d.number ? ` رقم (${d.number})` : ""}`;
      })
      .join("؛ ");
    const now = new Date();
    const number = await nextOfficialNumber(tx, "warning", { governorateCode: full.office.governorate.code, officeCode: full.office.code, at: now });
    const values: Record<PlaceholderKey, string> = {
      "warning.number": number,
      "warning.date": formatDate(now),
      "violation.number": full.number ?? "",
      "violation.discoveredAt": formatDate(full.discoveredAt),
      "violation.description": full.description ?? "",
      "violation.type": full.violationType?.nameAr ?? "",
      "offender.name": full.offenderName,
      "offender.address": full.offenderAddress ?? "",
      "offender.license": full.offenderLicenseNo ?? "",
      "legal.basis": basis,
      "required.action": input.requiredAction,
      "response.period": input.responsePeriodText,
      issuer: ISSUER,
    };
    const w = await tx.warning.create({
      data: {
        number, violationId, templateVersionId: tv.id, renderedBody: renderTemplate(tv.body, values),
        requiredAction: input.requiredAction, responsePeriodText: input.responsePeriodText, status: "AWAITING_SIGNATURE", preparedById: actor.id, preparedAt: now,
      },
    });
    await writeAudit(tx, { actor, action: "warning.prepared", entityType: "Warning", entityId: w.id, after: { number, violationId, template: t.name, templateVersion: tv.versionNo }, ctx });
    await applyTransition(tx, actor, violationId, "warning_prepared", { ctx });
    return w.id;
  });
}

export async function cancelWarning(actor: Actor, warningId: string, reason: string, ctx?: AuditContext) {
  assertCan(actor, "warning.prepare");
  await prisma.$transaction(async (tx) => {
    const w = await tx.warning.findUnique({ where: { id: warningId } });
    if (!w) throw notFound();
    if (w.status !== "AWAITING_SIGNATURE") throw new AppError("لا يُلغى إلا الإنذار غير الموقع");
    await applyTransition(tx, actor, w.violationId, "warning_cancelled", { reason, ctx });
    await tx.warning.update({ where: { id: warningId }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason.trim() } });
    await writeAudit(tx, { actor, action: "warning.cancelled", entityType: "Warning", entityId: warningId, reason, ctx });
  });
}

export const signedSchema = z.object({
  signerName: z.string().trim().min(3, "اسم صاحب التوقيع مطلوب").max(150),
  signedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ التوقيع مطلوب")
    .refine((v) => !isFutureDateKey(v), "لا يجوز أن يكون تاريخ التوقيع في المستقبل")
    .transform((v) => new Date(`${v}T00:00:00Z`)),
});

/// التوقيع اليدوي: لا يعتبر الإنذار موقعاً إلا برفع نسخته الضوئية الموقعة
export async function uploadSignedWarning(actor: Actor, warningId: string, file: IncomingFile | undefined, input: z.infer<typeof signedSchema>, ctx?: AuditContext) {
  assertCan(actor, "warning.upload_signed");
  if (!file) throw new AppError("يجب رفع النسخة الضوئية الموقعة من الإنذار");
  const w0 = await prisma.warning.findUnique({ where: { id: warningId }, include: { violation: true } });
  if (!w0 || !inScope(actor, w0.violation)) throw notFound();
  if (w0.status !== "AWAITING_SIGNATURE") throw new AppError("الإنذار ليس بانتظار التوقيع");
  if (input.signedAt < new Date(localDateKey(w0.preparedAt) + "T00:00:00Z")) throw new AppError("لا يجوز أن يسبق تاريخ التوقيع تاريخ إعداد الإنذار");
  const stored = await prepareFiles([file], actor, ctx);
  await prisma.$transaction(async (tx) => {
    const [attId] = await insertAttachments(tx, actor, stored, {
      violationId: w0.violationId, ownerType: "Warning", ownerId: warningId, documentType: "SIGNED_WARNING",
      description: `النسخة الموقعة من الإنذار ${w0.number}`, approvalStatus: "APPROVED",
    }, ctx);
    const upd = await tx.warning.updateMany({
      where: { id: warningId, status: "AWAITING_SIGNATURE" },
      data: { status: "SIGNED", signedAt: input.signedAt, signerName: input.signerName, signedAttachmentId: attId, signedUploadedById: actor.id, signedUploadedAt: new Date() },
    });
    if (upd.count !== 1) throw new AppError("تغيرت حالة الإنذار. يرجى تحديث الصفحة.", "CONFLICT");
    await writeAudit(tx, { actor, action: "warning.signed_uploaded", entityType: "Warning", entityId: warningId, after: { signerName: input.signerName, signedAt: input.signedAt, attachmentId: attId }, ctx });
    await applyTransition(tx, actor, w0.violationId, "warning_signed", { ctx });
  });
}

export async function getWarningForActor(actor: Actor, warningId: string) {
  const w = await prisma.warning.findUnique({
    where: { id: warningId },
    include: { violation: { include: { office: { include: { governorate: true } } } }, templateVersion: { include: { template: true } } },
  });
  if (!w || !inScope(actor, w.violation)) throw notFound();
  if (!can(actor, "violation.view")) throw forbidden();
  return w;
}
