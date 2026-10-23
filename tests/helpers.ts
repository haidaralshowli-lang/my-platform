import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { loadActor, type Actor } from "@/lib/rbac/actor";

let n = 0;

export async function makeUser(roleCodes: string[], opts: { password?: string; scope?: "OFFICE" | "GOVERNORATE" | "CENTRAL"; officeCode?: string; active?: boolean } = {}) {
  n++;
  const office = await prisma.office.findUniqueOrThrow({ where: { code: opts.officeCode ?? "HQ" } });
  const roles = await prisma.role.findMany({ where: { code: { in: roleCodes } } });
  const user = await prisma.user.create({
    data: {
      username: `t${Date.now().toString(36)}${n}`,
      fullName: `مستخدم اختبار ${n}`,
      passwordHash: await hashPassword(opts.password ?? "TestPassword123"),
      mustChangePassword: false,
      isActive: opts.active ?? true,
      scope: opts.scope ?? "OFFICE",
      governorateId: office.governorateId,
      officeId: office.id,
      roles: { create: roles.map((r) => ({ roleId: r.id })) },
    },
  });
  return { user, actor: (await loadActor(prisma, user.id)) as Actor };
}

export async function makeOffice(code: string, govCode: string) {
  const gov = await prisma.governorate.findUniqueOrThrow({ where: { code: govCode } });
  return prisma.office.upsert({ where: { code }, update: {}, create: { code, nameAr: `مكتب ${code}`, governorateId: gov.id } });
}
