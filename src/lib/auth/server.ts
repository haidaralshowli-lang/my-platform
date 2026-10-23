import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import type { PermissionCode } from "@/lib/rbac/catalog";
import { can, type Actor } from "@/lib/rbac/actor";
import { forbidden } from "@/lib/errors";
import type { AuditContext } from "@/lib/audit";
import { SESSION_COOKIE, validateSession } from "./service";

/// المستخدم الحالي للطلب (مخزّن مؤقتاً على مستوى الطلب الواحد)
export const getSession = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return validateSession(token);
});

export async function getActor(): Promise<Actor | null> {
  return (await getSession())?.actor ?? null;
}

/// للصفحات: يعيد التوجيه لصفحة الدخول إذا لم توجد جلسة، ولتغيير كلمة المرور إذا كانت مؤقتة
export async function requireActor(opts: { allowPasswordChange?: boolean } = {}): Promise<Actor> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.actor.mustChangePassword && !opts.allowPasswordChange) redirect("/change-password");
  return s.actor;
}

/// للصفحات: يتطلب صلاحية محددة
export async function requirePagePermission(perm: PermissionCode): Promise<Actor> {
  const actor = await requireActor();
  if (!can(actor, perm)) redirect("/forbidden");
  return actor;
}

/// للإجراءات الخادمية: يرمي خطأً بدل إعادة التوجيه
export async function actionActor(perm?: PermissionCode): Promise<Actor> {
  const s = await getSession();
  if (!s) throw forbidden("انتهت الجلسة. يرجى تسجيل الدخول مجدداً.");
  if (s.actor.mustChangePassword) throw forbidden("يجب تغيير كلمة المرور المؤقتة أولاً");
  if (perm && !can(s.actor, perm)) throw forbidden();
  return s.actor;
}

export async function requestContext(): Promise<AuditContext & { userAgent: string | null }> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ip: fwd || h.get("x-real-ip") || h.get("x-nf-client-connection-ip") || null,
    requestId: h.get("x-request-id") || h.get("x-nf-request-id") || randomUUID(),
    userAgent: h.get("user-agent"),
  };
}
