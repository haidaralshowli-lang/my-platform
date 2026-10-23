import type { GeneralStatus, Prisma, Violation, ViolationOutcome, ViolationStage } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { AppError, forbidden, notFound } from "@/lib/errors";
import { writeAudit, type AuditContext } from "@/lib/audit";
import { can, inScope, type Actor } from "@/lib/rbac/actor";
import type { PermissionCode } from "@/lib/rbac/catalog";
import { STAGE_LABELS } from "./labels";
import { notifyTransition } from "@/lib/services/notifications";

/// تعريف انتقال مسموح. الانتقالات معرّفة في الشيفرة (لا تُعدَّل من الواجهة) حتى تبقى قابلة للمراجعة والاختبار.
export type TransitionDef = {
  labelAr: string;
  from: ViolationStage[];
  /// الدالة تستقبل المرحلة الهدف المطلوبة (إن وُجدت) ويجب أن تتحقق من أنها ضمن المسموح
  to: ViolationStage | ((v: Violation, target?: ViolationStage) => ViolationStage);
  /// null = انتقال نظامي يُطلق داخلياً فقط (مثل اكتمال رفع المحضر)
  permission: PermissionCode | null;
  requiresReason?: boolean;
  /// شرط إضافي؛ يعيد نص سبب المنع أو null
  guard?: (tx: Tx, v: Violation) => Promise<string | null>;
  /// تعديلات إضافية على المخالفة ضمن المعاملة نفسها
  effect?: (tx: Tx, v: Violation, actor: Actor) => Promise<Prisma.ViolationUpdateInput>;
  status?: GeneralStatus;
  outcome?: ViolationOutcome | null;
};

const registry = new Map<string, TransitionDef>();

/// منفذ نظامي للمهام الآلية (مثل انتهاء المدة). لا يملك أي صلاحية، ولا يطلق إلا الانتقالات النظامية.
export const SYSTEM_ACTOR: Actor = {
  id: "system",
  username: "system",
  fullName: "النظام (مهمة مجدولة)",
  roles: ["SYSTEM"],
  permissions: new Set(),
  scope: "CENTRAL",
  governorateId: null,
  officeId: null,
  mustChangePassword: false,
};

export function defineTransition(action: string, def: TransitionDef) {
  if (registry.has(action)) throw new Error(`انتقال مكرر: ${action}`);
  registry.set(action, def);
}

export function getTransition(action: string): TransitionDef {
  const t = registry.get(action);
  if (!t) throw new AppError(`إجراء غير معروف: ${action}`);
  return t;
}

/// الإجراءات المتاحة للمستخدم على مخالفة معينة (لعرض الأزرار فقط؛ التحقق الفعلي يتكرر عند التنفيذ)
export function availableTransitions(actor: Actor, v: Violation): { action: string; def: TransitionDef }[] {
  if (!inScope(actor, v)) return [];
  return [...registry.entries()]
    .filter(([, d]) => d.permission && d.from.includes(v.stage) && can(actor, d.permission))
    .map(([action, def]) => ({ action, def }));
}

/// يقفل صف المخالفة حتى نهاية المعاملة لمنع الانتقالات المتزامنة المتعارضة
export async function lockViolation(tx: Tx, id: string): Promise<Violation> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Violation" WHERE id = ${id} FOR UPDATE`;
  if (rows.length === 0) throw notFound();
  return tx.violation.findUniqueOrThrow({ where: { id } });
}

export type TransitionOptions = {
  reason?: string | null;
  /// رقم الإصدار الذي رآه المستخدم؛ يُرفض الإجراء إذا تغيرت المخالفة منذ ذلك الحين
  expectedVersion?: number;
  ctx?: AuditContext;
  /// للانتقالات النظامية المطلقة من خدمة أخرى بعد تحققها من الصلاحية
  system?: boolean;
  /// المرحلة الهدف للانتقالات متعددة الأهداف (تتحقق منها دالة to)
  targetStage?: ViolationStage;
  /// النتيجة النهائية للانتقالات التي تحددها حسب السياق
  outcome?: ViolationOutcome;
};

export async function applyTransition(tx: Tx, actor: Actor, violationId: string, action: string, opts: TransitionOptions = {}): Promise<Violation> {
  const def = getTransition(action);
  const v = await lockViolation(tx, violationId);
  const isSystemActor = actor.id === SYSTEM_ACTOR.id;
  if (isSystemActor && def.permission !== null) throw forbidden("المنفذ النظامي لا يطلق إلا الانتقالات النظامية");
  if (!isSystemActor && !inScope(actor, v)) throw notFound();
  if (def.permission === null && !opts.system) throw forbidden("هذا الإجراء نظامي ولا يُنفَّذ يدوياً");
  if (def.permission && !can(actor, def.permission)) throw forbidden();
  if (opts.expectedVersion !== undefined && opts.expectedVersion !== v.version) {
    throw new AppError("تم تعديل المعاملة من مستخدم آخر بعد فتحك لها. يرجى تحديث الصفحة والمحاولة مجدداً.", "CONFLICT");
  }
  if (!def.from.includes(v.stage)) {
    throw new AppError(`لا يمكن تنفيذ «${def.labelAr}» والمعاملة في مرحلة «${STAGE_LABELS[v.stage]}»`, "CONFLICT");
  }
  const reason = opts.reason?.trim() || null;
  if (def.requiresReason && !reason) throw new AppError("يجب بيان السبب لهذا الإجراء");
  if (def.guard) {
    const blocked = await def.guard(tx, v);
    if (blocked) throw new AppError(blocked);
  }
  const toStage = typeof def.to === "function" ? def.to(v, opts.targetStage) : def.to;
  const toStatus = def.status ?? (toStage === "CLOSED" ? "CLOSED" : "OPEN");
  const extra = def.effect ? await def.effect(tx, v, actor) : {};
  const updated = await tx.violation.update({
    where: { id: v.id, version: v.version },
    data: {
      ...extra,
      stage: toStage,
      generalStatus: toStatus,
      ...(def.outcome !== undefined ? { outcome: def.outcome } : {}),
      ...(opts.outcome !== undefined ? { outcome: opts.outcome } : {}),
      version: { increment: 1 },
    },
  });
  const history = await tx.violationStatusHistory.create({
    data: {
      violationId: v.id,
      fromStage: v.stage,
      toStage,
      fromStatus: v.generalStatus,
      toStatus,
      action,
      reason,
      actorId: actor.id,
      actorRoles: actor.roles,
    },
  });
  await writeAudit(tx, {
    actor: isSystemActor ? null : actor,
    username: isSystemActor ? "system" : undefined,
    action: `violation.${action}`,
    entityType: "Violation",
    entityId: v.id,
    before: { stage: v.stage, generalStatus: v.generalStatus, outcome: v.outcome, number: v.number },
    after: { stage: toStage, generalStatus: toStatus, outcome: updated.outcome, number: updated.number },
    reason,
    ctx: opts.ctx,
  });
  await notifyTransition(tx, action, updated, history.id, actor.id);
  return updated;
}
