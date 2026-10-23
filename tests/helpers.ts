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

// ─── عينات ملفات حقيقية التوقيع للاختبار ───
export const SAMPLE_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);
export const SAMPLE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
export const SAMPLE_EXE = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200, 0x90)]);

export async function ensureRefs() {
  const vt = await prisma.violationType.upsert({ where: { code: "T-BCAST" }, update: {}, create: { code: "T-BCAST", nameAr: "نوع مخالفة للاختبار" } });
  const ds = await prisma.detectionSource.findFirstOrThrow();
  const hq = await prisma.office.findUniqueOrThrow({ where: { code: "HQ" } });
  return { violationTypeId: vt.id, detectionSourceId: ds.id, officeId: hq.id, governorateId: hq.governorateId };
}

export async function completeInput(overrides: Record<string, unknown> = {}) {
  const r = await ensureRefs();
  const { violationInputSchema } = await import("@/lib/services/violations");
  return violationInputSchema.parse({
    governorateId: r.governorateId,
    officeId: r.officeId,
    offenderName: "قناة اختبار الفضائية",
    violationTypeId: r.violationTypeId,
    detectionSourceId: r.detectionSourceId,
    discoveredAt: "2026-01-15",
    description: "وصف مخالفة لأغراض الاختبار",
    organizerName: "منظم المحضر",
    ...overrides,
  });
}
