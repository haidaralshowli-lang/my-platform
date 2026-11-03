import { randomInt } from "node:crypto";
import type { Role } from "@prisma/client";
import { z } from "zod";
import { prisma, type Tx } from "@/lib/db";
import { writeAudit, type AuditContext } from "@/lib/audit";
import { AppError, notFound } from "@/lib/errors";
import { hashPassword } from "@/lib/auth/password";
import { revokeAllSessions } from "@/lib/auth/service";
import { assertCan, COORDINATOR_DEFAULTS, COORDINATOR_GRANTABLE, isPermission, type Actor, type Permission } from "@/lib/rbac";

const USER_SAFE_FIELDS = {
  id: true,
  username: true,
  fullName: true,
  role: true,
  permissions: true,
  isActive: true,
  mustChangePassword: true,
} as const;

/// كلمة مرور مؤقتة عشوائية (16 حرفاً، حروف وأرقام دون الأحرف الملتبسة) تُعرض مرة واحدة
export function generateTempPassword(): string {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = letters + digits;
  const chars = [letters[randomInt(letters.length)], digits[randomInt(digits.length)]];
  while (chars.length < 16) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/// يقبل فقط الصلاحيات التشغيلية الجائز منحها للمنسق، ويرفض أي صلاحية إدارية
export function sanitizeCoordinatorPermissions(input: string[]): Permission[] {
  const bad = input.filter((p) => !isPermission(p) || !COORDINATOR_GRANTABLE.includes(p));
  if (bad.length) throw new AppError("لا يجوز منح المنسق العام صلاحيات إدارية أو غير معروفة");
  return [...new Set(input)] as Permission[];
}

export const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,40}$/, "اسم المستخدم من 3 إلى 40 حرفاً لاتينياً أو رقماً أو (. _ -)"),
  fullName: z.string().trim().min(3, "الاسم الكامل مطلوب").max(120),
  role: z.enum(["ADMIN", "COORDINATOR"]),
  permissions: z.array(z.string()).optional(),
});

export async function createUser(actor: Actor, input: z.input<typeof createUserSchema>, ctx?: AuditContext) {
  assertCan(actor, "users.manage");
  // حماية إضافية مستقلة عن الصلاحيات: لا ينشئ مديراً إلا مدير
  if (input.role === "ADMIN" && actor.role !== "ADMIN") throw new AppError("لا يجوز إنشاء حساب مدير إلا من قبل مدير النظام", "FORBIDDEN");
  const data = createUserSchema.parse(input);
  const permissions = data.role === "ADMIN" ? [] : sanitizeCoordinatorPermissions(data.permissions ?? COORDINATOR_DEFAULTS);
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  const user = await prisma.$transaction(async (tx) => {
    if (await tx.user.findUnique({ where: { username: data.username } })) throw new AppError("اسم المستخدم مستخدم مسبقاً", "CONFLICT");
    const u = await tx.user.create({
      data: { username: data.username, fullName: data.fullName, role: data.role, permissions, passwordHash, mustChangePassword: true, createdById: actor.id },
      select: USER_SAFE_FIELDS,
    });
    await writeAudit(tx, { actor, action: "user.create", entityType: "User", entityId: u.id, after: u, ctx });
    return u;
  });
  return { user, tempPassword };
}

async function lockTarget(tx: Tx, actor: Actor, userId: string) {
  const target = await tx.user.findUnique({ where: { id: userId }, select: USER_SAFE_FIELDS });
  if (!target) throw notFound();
  // المنسق لا يملك users.manage أصلاً، وهذا حاجز ثانٍ: لا يمس حساب مدير إلا مدير
  if (target.role === "ADMIN" && actor.role !== "ADMIN") throw new AppError("لا يجوز تعديل حساب المدير", "FORBIDDEN");
  return target;
}

async function assertNotLastAdmin(tx: Tx, target: { id: string; role: Role; isActive: boolean }) {
  if (target.role !== "ADMIN" || !target.isActive) return;
  const others = await tx.user.count({ where: { role: "ADMIN", isActive: true, id: { not: target.id } } });
  if (others === 0) throw new AppError("لا يمكن تعطيل آخر حساب مدير نشط في النظام");
}

export const updateUserSchema = z.object({
  fullName: z.string().trim().min(3, "الاسم الكامل مطلوب").max(120),
  permissions: z.array(z.string()).default([]),
});

export async function updateUser(actor: Actor, userId: string, input: z.input<typeof updateUserSchema>, ctx?: AuditContext) {
  assertCan(actor, "users.manage");
  const data = updateUserSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const before = await lockTarget(tx, actor, userId);
    const permissions = before.role === "ADMIN" ? [] : sanitizeCoordinatorPermissions(data.permissions);
    const after = await tx.user.update({ where: { id: userId }, data: { fullName: data.fullName, permissions }, select: USER_SAFE_FIELDS });
    await writeAudit(tx, { actor, action: "user.update", entityType: "User", entityId: userId, before, after, ctx });
    return after;
  });
}

export async function setUserActive(actor: Actor, userId: string, active: boolean, reason: string, ctx?: AuditContext) {
  assertCan(actor, "users.manage");
  if (userId === actor.id && !active) throw new AppError("لا يمكنك تعطيل حسابك بنفسك");
  if (!active && reason.trim().length < 3) throw new AppError("يرجى ذكر سبب التعطيل");
  return prisma.$transaction(async (tx) => {
    const before = await lockTarget(tx, actor, userId);
    if (!active) await assertNotLastAdmin(tx, before);
    const after = await tx.user.update({
      where: { id: userId },
      data: { isActive: active, ...(active ? { failedLoginCount: 0, lockedUntil: null } : {}) },
      select: USER_SAFE_FIELDS,
    });
    if (!active) await revokeAllSessions(tx, userId);
    await writeAudit(tx, { actor, action: active ? "user.activate" : "user.deactivate", entityType: "User", entityId: userId, before, after, reason, ctx });
    return after;
  });
}

export async function resetUserPassword(actor: Actor, userId: string, ctx?: AuditContext) {
  assertCan(actor, "users.manage");
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  await prisma.$transaction(async (tx) => {
    await lockTarget(tx, actor, userId);
    await tx.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null } });
    await revokeAllSessions(tx, userId);
    await writeAudit(tx, { actor, action: "user.password_reset", entityType: "User", entityId: userId, ctx });
  });
  return { tempPassword };
}

export async function revokeUserSessions(actor: Actor, userId: string, ctx?: AuditContext) {
  assertCan(actor, "users.manage");
  return prisma.$transaction(async (tx) => {
    await lockTarget(tx, actor, userId);
    const count = await revokeAllSessions(tx, userId);
    await writeAudit(tx, { actor, action: "user.sessions_revoked", entityType: "User", entityId: userId, after: { count }, ctx });
    return count;
  });
}
