import { writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/auth/password";

// ينشئ حساب مدير نظام مؤقتاً بكلمة مرور عشوائية لكل تشغيل، ويُلزمه بتغييرها (يختبر مسار التهيئة الأولى)
export default async function setup() {
  if (process.env.NODE_ENV === "production" || /prod/i.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("رفض تشغيل اختبارات الواجهة على قاعدة إنتاج");
  }
  const prisma = new PrismaClient();
  const role = await prisma.role.findUniqueOrThrow({ where: { code: "SYSADMIN" } });
  const hq = await prisma.office.findUniqueOrThrow({ where: { code: "HQ" } });
  const suffix = randomBytes(3).toString("hex");
  const password = `E2e${randomBytes(6).toString("hex")}9`;
  const admins: Record<string, { username: string; password: string }> = {};
  for (const project of ["desktop", "mobile"]) {
    const username = `e2e-admin-${project}-${suffix}`;
    await prisma.user.create({
      data: {
        username, fullName: `مدير اختبار ${project}`, passwordHash: await hashPassword(password), mustChangePassword: true,
        isDemo: true, officeId: hq.id, governorateId: hq.governorateId, roles: { create: { roleId: role.id } },
      },
    });
    admins[project] = { username, password };
  }
  // موظف تسجيل في المقر العام، وموظف في مكتب آخر لاختبار النطاق
  const reg = await prisma.role.findUniqueOrThrow({ where: { code: "REGISTRAR" } });
  const bsr = await prisma.governorate.findUniqueOrThrow({ where: { code: "BSR" } });
  const otherOffice = await prisma.office.upsert({ where: { code: "E2E-BSR" }, update: {}, create: { code: "E2E-BSR", nameAr: "مكتب اختبار البصرة", governorateId: bsr.id } });
  const staff: Record<string, { username: string; password: string }> = {};
  for (const [key, officeId, govId] of [["registrar", hq.id, hq.governorateId], ["outsider", otherOffice.id, bsr.id]] as const) {
    for (const project of ["desktop", "mobile"]) {
      const username = `e2e-${key}-${project}-${suffix}`;
      await prisma.user.create({
        data: {
          username, fullName: `موظف ${key} ${project}`, passwordHash: await hashPassword(password), mustChangePassword: false,
          isDemo: true, officeId, governorateId: govId, roles: { create: { roleId: reg.id } },
        },
      });
      staff[`${key}-${project}`] = { username, password };
    }
  }
  // أدوار مسار المصادقات
  for (const [key, roleCode] of [["chairman", "CHAIRMAN"], ["technical", "TECHNICAL"], ["legal", "LEGAL"], ["legal2", "LEGAL"], ["delivery", "DELIVERY"]] as const) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    for (const project of ["desktop", "mobile"]) {
      const username = `e2e-${key}-${project}-${suffix}`;
      await prisma.user.create({
        data: {
          username, fullName: `${key} ${project}`, passwordHash: await hashPassword(password), mustChangePassword: false,
          isDemo: true, officeId: hq.id, governorateId: hq.governorateId, roles: { create: { roleId: role.id } },
        },
      });
      staff[`${key}-${project}`] = { username, password };
    }
  }
  // وثيقة مرجعية نافذة بمادة مفهرسة، وقالب إنذار للاختبار
  const creator = await prisma.user.findFirstOrThrow({ where: { username: staff["legal-desktop"].username } });
  const docTitle = `لائحة اختبار الواجهة ${suffix}`;
  await prisma.legalDocument.create({
    data: {
      title: docTitle, docType: "REGULATION", number: "E2E-1", status: "IN_FORCE", createdById: creator.id,
      versions: { create: { versionNo: 1, createdById: creator.id, articles: { create: { articleNumber: "9", paragraph: "أولاً", text: `نص مادة اختبار الواجهة ${suffix}` } } } },
    },
  });
  await prisma.warningTemplate.create({
    data: {
      name: `قالب واجهة ${suffix}`, createdById: creator.id,
      versions: { create: { versionNo: 1, createdById: creator.id, body: "إلى {{offender.name}}\nإنذار رقم {{warning.number}} بشأن المخالفة {{violation.number}} استناداً إلى {{legal.basis}}\nالمطلوب: {{required.action}} خلال {{response.period}}" } },
    },
  });
  await prisma.violationType.upsert({ where: { code: "E2E" }, update: { isActive: true }, create: { code: "E2E", nameAr: "نوع مخالفة لاختبار الواجهة" } });
  writeFileSync("tests/e2e/.state.json", JSON.stringify({ admins, staff, suffix, docTitle }));
  await prisma.$disconnect();
}
