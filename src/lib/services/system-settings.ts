import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { writeAudit, type AuditContext } from "@/lib/audit";
import { assertCan, type Actor } from "@/lib/rbac/actor";
import { DEFAULT_SETTINGS, getSetting, type SettingKey } from "@/lib/settings";
import { validatePattern } from "@/lib/numbering";

/// المدقق لكل إعداد قابل للتعديل من الواجهة. كل إعداد هنا مستخدم فعلياً في منطق النظام.
const VALIDATORS: Partial<Record<SettingKey, (raw: string) => unknown>> = {
  "numbering.violation": (r) => pattern(r),
  "numbering.warning": (r) => pattern(r),
  "numbering.criminalCase": (r) => pattern(r),
  "attachments.maxSizeMb": (r) => int(r, 1, 28, "حجم الملف (يُقيد أيضاً بحد طلب الخادم 30 ميغابايت)"),
  "attachments.maxFilesPerViolation": (r) => int(r, 1, 2000, "عدد المرفقات"),
  "auth.maxFailedLogins": (r) => int(r, 3, 20, "عدد المحاولات"),
  "auth.lockMinutes": (r) => int(r, 1, 1440, "مدة القفل"),
  "workflow.requireTechnicalReview": (r) => bool(r),
  "workflow.requireLegalSecondApproval": (r) => bool(r),
  "workflow.requireJudgmentApproval": (r) => bool(r),
  "deadline.weekendDays": (r) => {
    const days = r.split(",").map((x) => x.trim()).filter(Boolean).map(Number);
    if (days.length > 3 || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new AppError("أيام نهاية الأسبوع: أرقام من 0 (الأحد) إلى 6 (السبت)، ثلاثة كحد أقصى");
    return [...new Set(days)].sort();
  },
};

function pattern(r: string) {
  const err = validatePattern(r.trim());
  if (err) throw new AppError(err);
  return { pattern: r.trim() };
}
function int(r: string, min: number, max: number, label: string) {
  const n = Number(r);
  if (!Number.isInteger(n) || n < min || n > max) throw new AppError(`${label}: قيمة بين ${min} و${max}`);
  return n;
}
function bool(r: string) {
  return r === "true" || r === "on";
}

export const EDITABLE_SETTINGS = Object.keys(VALIDATORS) as SettingKey[];

export async function currentSettings() {
  const out: Record<string, unknown> = {};
  for (const k of EDITABLE_SETTINGS) out[k] = await getSetting(prisma, k);
  return out;
}

export async function updateSetting(actor: Actor, key: string, raw: string, reason: string, ctx?: AuditContext) {
  assertCan(actor, "settings.manage");
  const v = VALIDATORS[key as SettingKey];
  if (!v) throw new AppError("إعداد غير قابل للتعديل");
  if (!reason.trim()) throw new AppError("يجب بيان سبب تعديل الإعداد");
  const value = v(raw);
  await prisma.$transaction(async (tx) => {
    const before = await getSetting(tx, key as SettingKey);
    await tx.systemSetting.upsert({ where: { key }, update: { value: value as Prisma.InputJsonValue, updatedById: actor.id }, create: { key, value: value as Prisma.InputJsonValue, updatedById: actor.id } });
    await writeAudit(tx, { actor, action: "setting.changed", entityType: "SystemSetting", entityId: key, before: { value: before }, after: { value }, reason, ctx });
  });
}

/// المدة الإدارية لكل مرحلة (تستخدمها المهمة المجدولة لتنبيهات التأخر)
export async function updateStageSla(actor: Actor, stage: string, slaDays: number | null, ctx?: AuditContext) {
  assertCan(actor, "settings.manage");
  if (slaDays !== null && (!Number.isInteger(slaDays) || slaDays < 1 || slaDays > 365)) throw new AppError("المدة الإدارية بين 1 و365 يوماً");
  await prisma.$transaction(async (tx) => {
    const s = await tx.workflowStageConfig.findUnique({ where: { stage: stage as never } });
    if (!s) throw new AppError("مرحلة غير معروفة");
    await tx.workflowStageConfig.update({ where: { stage: s.stage }, data: { slaDays } });
    await writeAudit(tx, { actor, action: "stage_sla.changed", entityType: "WorkflowStageConfig", entityId: stage, before: { slaDays: s.slaDays }, after: { slaDays }, ctx });
  });
}

export { DEFAULT_SETTINGS };
