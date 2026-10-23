import type { AccessScope, Prisma } from "@prisma/client";
import type { Db } from "@/lib/db";
import { forbidden } from "@/lib/errors";
import type { PermissionCode } from "./catalog";

/// المستخدم المنفذ للإجراء كما يُحمَّل من قاعدة البيانات في الخادم (وليس من المتصفح)
export type Actor = {
  id: string;
  username: string;
  fullName: string;
  roles: string[];
  permissions: Set<string>;
  scope: AccessScope;
  governorateId: string | null;
  officeId: string | null;
  mustChangePassword: boolean;
};

export async function loadActor(db: Db, userId: string): Promise<Actor | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
  });
  if (!user || !user.isActive) return null;
  const permissions = new Set<string>();
  for (const ur of user.roles) for (const rp of ur.role.permissions) permissions.add(rp.permission.code);
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    roles: user.roles.map((r) => r.role.code),
    permissions,
    scope: permissions.has("scope.central") ? "CENTRAL" : user.scope,
    governorateId: user.governorateId,
    officeId: user.officeId,
    mustChangePassword: user.mustChangePassword,
  };
}

export function can(actor: Actor, perm: PermissionCode): boolean {
  return actor.permissions.has(perm);
}

export function canAny(actor: Actor, perms: PermissionCode[]): boolean {
  return perms.some((p) => actor.permissions.has(p));
}

export function assertCan(actor: Actor, perm: PermissionCode, msg?: string): void {
  if (!can(actor, perm)) throw forbidden(msg);
}

/// شرط نطاق الاطلاع يُطبَّق على كل استعلام للمخالفات (بما فيها نتائج البحث)
export function violationScopeWhere(actor: Actor): Prisma.ViolationWhereInput {
  if (!can(actor, "violation.view")) return { id: "__none__" };
  switch (actor.scope) {
    case "CENTRAL":
      return {};
    case "GOVERNORATE":
      return actor.governorateId ? { governorateId: actor.governorateId } : { id: "__none__" };
    case "OFFICE":
    default:
      return actor.officeId ? { officeId: actor.officeId } : { id: "__none__" };
  }
}

/// هل تقع المخالفة ضمن نطاق المستخدم؟
export function inScope(actor: Actor, v: { governorateId: string; officeId: string }): boolean {
  if (!can(actor, "violation.view")) return false;
  if (actor.scope === "CENTRAL") return true;
  if (actor.scope === "GOVERNORATE") return !!actor.governorateId && v.governorateId === actor.governorateId;
  return !!actor.officeId && v.officeId === actor.officeId;
}
