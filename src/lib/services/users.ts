import { randomInt } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { writeAudit, type AuditContext } from "@/lib/audit";
import { assertCan, type Actor } from "@/lib/rbac/actor";
import { SYSADMIN_FORBIDDEN, type PermissionCode } from "@/lib/rbac/catalog";
import { hashPassword } from "@/lib/auth/password";
import { revokeAllSessions } from "@/lib/auth/service";

const optionalId = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const userInputSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,40}$/, "اسم المستخدم: 3-40 حرفاً لاتينياً أو أرقاماً أو (. _ -)"),
  fullName: z.string().trim().min(3, "الاسم الكامل مطلوب").max(120),
  email: z
    .string()
    .trim()
    .max(160)
    .transform((v) => (v === "" ? null : v))
    .pipe(z.string().email("البريد الإلكتروني غير صحيح").nullable())
    .optional(),
  jobTitle: z.string().trim().max(120).optional().transform((v) => v || null),
  scope: z.enum(["OFFICE", "GOVERNORATE", "CENTRAL"]),
  governorateId: optionalId,
  officeId: optionalId,
  divisionId: optionalId,
  roleIds: z.array(z.string()).min(1, "يجب تعيين دور واحد على الأقل"),
});

export type UserInput = Omit<z.infer<typeof userInputSchema>, "jobTitle"> & { jobTitle?: string | null };

/// كلمة مرور مؤقتة عشوائية قوية تُعرض مرة واحدة للمسؤول ويُفرض تغييرها عند أول دخول
export function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 14; i++) s += alphabet[randomInt(alphabet.length)];
  return `${s}${randomInt(10)}`;
}

async function validateOrg(input: UserInput) {
  if (input.scope === "OFFICE" && !input.officeId) throw new AppError("يجب تحديد المكتب أو الفرع لنطاق الاطلاع على مستوى المكتب");
  if (input.scope === "GOVERNORATE" && !input.governorateId) throw new AppError("يجب تحديد المحافظة لنطاق الاطلاع على مستوى المحافظة");
  if (input.officeId) {
    const office = await prisma.office.findUnique({ where: { id: input.officeId } });
    if (!office) throw new AppError("المكتب المحدد غير موجود");
    if (input.governorateId && office.governorateId !== input.governorateId) throw new AppError("المكتب المحدد لا يتبع المحافظة المختارة");
    input.governorateId = office.governorateId;
  }
  const roles = await prisma.role.findMany({ where: { id: { in: input.roleIds } } });
  if (roles.length !== new Set(input.roleIds).size) throw new AppError("أحد الأدوار المحددة غير موجود");
  return roles;
}

export async function createUser(actor: Actor, input: UserInput, ctx?: AuditContext): Promise<{ id: string; tempPassword: string }> {
  assertCan(actor, "users.manage");
  const roles = await validateOrg(input);
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        username: input.username,
        fullName: input.fullName,
        email: input.email ?? null,
        jobTitle: input.jobTitle ?? null,
        scope: input.scope,
        governorateId: input.governorateId ?? null,
        officeId: input.officeId ?? null,
        divisionId: input.divisionId ?? null,
        passwordHash,
        mustChangePassword: true,
        roles: { create: roles.map((r) => ({ roleId: r.id, grantedBy: actor.id })) },
      },
    });
    await writeAudit(tx, {
      actor,
      action: "user.created",
      entityType: "User",
      entityId: u.id,
      after: { ...input, roles: roles.map((r) => r.code) },
      ctx,
    });
    return u;
  });
  return { id: user.id, tempPassword };
}

export async function updateUser(actor: Actor, userId: string, input: Omit<UserInput, "username">, ctx?: AuditContext): Promise<void> {
  assertCan(actor, "users.manage");
  const existing = await prisma.user.findUnique({ where: { id: userId }, include: { roles: { include: { role: true } } } });
  if (!existing) throw notFound();
  const full = { ...input, username: existing.username };
  const roles = await validateOrg(full);
  const before = {
    fullName: existing.fullName, email: existing.email, jobTitle: existing.jobTitle, scope: existing.scope,
    governorateId: existing.governorateId, officeId: existing.officeId, divisionId: existing.divisionId,
    roles: existing.roles.map((r) => r.role.code).sort(),
  };
  const newRoles = roles.map((r) => r.code).sort();
  if (userId === actor.id && JSON.stringify(before.roles) !== JSON.stringify(newRoles)) {
    throw new AppError("لا يجوز للمستخدم تعديل أدواره بنفسه");
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        fullName: full.fullName, email: full.email ?? null, jobTitle: full.jobTitle ?? null, scope: full.scope,
        governorateId: full.governorateId ?? null, officeId: full.officeId ?? null, divisionId: full.divisionId ?? null,
      },
    });
    await tx.userRole.deleteMany({ where: { userId, roleId: { notIn: roles.map((r) => r.id) } } });
    for (const r of roles) {
      await tx.userRole.upsert({
        where: { userId_roleId: { userId, roleId: r.id } },
        update: {},
        create: { userId, roleId: r.id, grantedBy: actor.id },
      });
    }
    const after = { ...full, roles: newRoles };
    delete (after as Partial<typeof after>).roleIds;
    await writeAudit(tx, {
      actor,
      action: before.roles.join() !== newRoles.join() ? "user.roles_changed" : "user.updated",
      entityType: "User",
      entityId: userId,
      before,
      after,
      ctx,
    });
  });
}

export async function setUserActive(actor: Actor, userId: string, active: boolean, reason: string, ctx?: AuditContext): Promise<void> {
  assertCan(actor, "users.manage");
  if (userId === actor.id) throw new AppError("لا يجوز للمستخدم تعطيل حسابه بنفسه");
  if (!reason.trim()) throw new AppError("يجب بيان سبب الإجراء");
  await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({ where: { id: userId }, data: { isActive: active, ...(active ? { failedLoginCount: 0, lockedUntil: null } : {}) } });
    if (!active) await revokeAllSessions(tx, userId);
    await writeAudit(tx, { actor, action: active ? "user.activated" : "user.deactivated", entityType: "User", entityId: u.id, reason, ctx });
  });
}

export async function resetUserPassword(actor: Actor, userId: string, ctx?: AuditContext): Promise<string> {
  assertCan(actor, "users.manage");
  if (userId === actor.id) throw new AppError("استخدم صفحة تغيير كلمة المرور لحسابك");
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null } });
    await revokeAllSessions(tx, userId);
    await writeAudit(tx, { actor, action: "user.password_reset", entityType: "User", entityId: userId, ctx });
  });
  return tempPassword;
}

export async function revokeUserSessions(actor: Actor, userId: string, ctx?: AuditContext): Promise<number> {
  assertCan(actor, "users.manage");
  return prisma.$transaction(async (tx) => {
    const n = await revokeAllSessions(tx, userId);
    await writeAudit(tx, { actor, action: "user.sessions_revoked", entityType: "User", entityId: userId, after: { revoked: n }, ctx });
    return n;
  });
}

/// تحديث صلاحيات دور. يمنع منح صلاحيات المصادقة الرسمية لدور مدير النظام (فصل المهام).
export async function setRolePermissions(actor: Actor, roleId: string, codes: string[], ctx?: AuditContext): Promise<void> {
  assertCan(actor, "roles.manage");
  const role = await prisma.role.findUnique({ where: { id: roleId }, include: { permissions: { include: { permission: true } } } });
  if (!role) throw notFound();
  if (role.code === "SYSADMIN") {
    const bad = codes.filter((c) => SYSADMIN_FORBIDDEN.includes(c as PermissionCode));
    if (bad.length) throw new AppError("لا يجوز منح دور مدير النظام صلاحيات المصادقة الرسمية");
  }
  const actorHasRole = actor.roles.includes(role.code);
  if (actorHasRole) throw new AppError("لا يجوز تعديل صلاحيات دور تحمله أنت");
  const perms = await prisma.permission.findMany({ where: { code: { in: codes } } });
  if (perms.length !== new Set(codes).size) throw new AppError("صلاحية غير معروفة");
  const before = role.permissions.map((p) => p.permission.code).sort();
  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId } });
    await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId, permissionId: p.id })) });
    await writeAudit(tx, {
      actor,
      action: "role.permissions_changed",
      entityType: "Role",
      entityId: roleId,
      before: { permissions: before },
      after: { permissions: perms.map((p) => p.code).sort() },
      ctx,
    });
  });
}
