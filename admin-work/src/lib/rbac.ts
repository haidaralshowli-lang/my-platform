import type { Role } from "@prisma/client";
import type { Db } from "@/lib/db";
import { forbidden } from "@/lib/errors";

/// كتالوج الصلاحيات. المدير يملكها كلها دائماً، والمنسق يملك ما يمنحه إياه المدير من الصلاحيات التشغيلية فقط.
export const PERMISSIONS = {
  "dashboard.view": { label: "الاطلاع على لوحة المتابعة", group: "لوحة المتابعة", operational: true },
  "people.view": { label: "الاطلاع على قاعدة بيانات الأشخاص", group: "الأشخاص", operational: true },
  "people.create": { label: "إضافة الأشخاص", group: "الأشخاص", operational: true },
  "people.edit": { label: "تحديث بيانات الأشخاص", group: "الأشخاص", operational: true },
  "people.import": { label: "استيراد الأشخاص من Excel", group: "الأشخاص", operational: true },
  "people.export": { label: "تصدير الأشخاص إلى Excel", group: "الأشخاص", operational: true },
  "people.delete": { label: "حذف سجلات الأشخاص", group: "الأشخاص", operational: false },
  "people.merge": { label: "دمج السجلات المكررة", group: "الأشخاص", operational: false },
  "requests.view": { label: "الاطلاع على الطلبات", group: "الطلبات", operational: true },
  "requests.create": { label: "تسجيل الطلبات الجديدة", group: "الطلبات", operational: true },
  "requests.update": { label: "متابعة الطلبات وتحديث حالاتها", group: "الطلبات", operational: true },
  "requests.close": { label: "اعتماد إغلاق الطلبات", group: "الطلبات", operational: false },
  "requests.delete": { label: "حذف الطلبات", group: "الطلبات", operational: false },
  "tasks.view": { label: "الاطلاع على المهام", group: "المهام", operational: true },
  "tasks.create": { label: "تسجيل المهام", group: "المهام", operational: true },
  "tasks.update": { label: "تحديث مراحل إنجاز المهام", group: "المهام", operational: true },
  "tasks.close": { label: "اعتماد إغلاق المهام", group: "المهام", operational: false },
  "tasks.delete": { label: "حذف المهام", group: "المهام", operational: false },
  "reports.view": { label: "إعداد التقارير والاطلاع عليها", group: "التقارير", operational: true },
  "users.manage": { label: "إدارة حسابات المستخدمين", group: "الإدارة", operational: false },
  "lists.manage": { label: "إدارة القوائم المرجعية والإعدادات", group: "الإدارة", operational: false },
  "audit.view": { label: "الاطلاع على سجل التدقيق", group: "الإدارة", operational: false },
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/// الصلاحيات التي يجوز للمدير منحها للمنسق العام
export const COORDINATOR_GRANTABLE = ALL_PERMISSIONS.filter((p) => PERMISSIONS[p].operational);

/// الصلاحيات الافتراضية للمنسق العام عند إنشاء حسابه (كما وردت في وثيقة المتطلبات)
export const COORDINATOR_DEFAULTS: Permission[] = [...COORDINATOR_GRANTABLE];

export const ROLE_LABELS: Record<Role, string> = { ADMIN: "مدير النظام", COORDINATOR: "المنسق العام" };

export type Actor = {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  permissions: Set<Permission>;
  mustChangePassword: boolean;
};

export function isPermission(p: string): p is Permission {
  return p in PERMISSIONS;
}

/// الصلاحيات الفعلية: المدير كل شيء، والمنسق ما مُنح له مما يجوز منحه فقط (حتى لو عُبث بالقيمة المخزنة)
export function effectivePermissions(role: Role, stored: string[]): Set<Permission> {
  if (role === "ADMIN") return new Set(ALL_PERMISSIONS);
  return new Set(stored.filter(isPermission).filter((p) => PERMISSIONS[p].operational));
}

export async function loadActor(db: Db, userId: string): Promise<Actor | null> {
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u || !u.isActive) return null;
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    role: u.role,
    permissions: effectivePermissions(u.role, u.permissions),
    mustChangePassword: u.mustChangePassword,
  };
}

export function can(actor: Actor | null | undefined, perm: Permission): boolean {
  return !!actor && actor.permissions.has(perm);
}

export function assertCan(actor: Actor, perm: Permission): void {
  if (!can(actor, perm)) throw forbidden();
}
