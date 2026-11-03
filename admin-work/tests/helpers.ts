import { randomUUID } from "node:crypto";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { loadActor, type Actor } from "@/lib/rbac";

export const PASSWORD = "Strong-Pass-2026";

export async function makeUser(role: Role, permissions: string[] = []): Promise<Actor> {
  const u = await prisma.user.create({
    data: {
      username: `u${randomUUID().slice(0, 8)}`,
      fullName: role === "ADMIN" ? "مدير اختبار" : "منسق اختبار",
      role,
      permissions,
      passwordHash: await hashPassword(PASSWORD),
      mustChangePassword: false,
    },
  });
  return (await loadActor(prisma, u.id))!;
}
