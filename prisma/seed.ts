// البيانات الأساسية المطلوبة لتشغيل المنصة (آمنة للإنتاج):
// الصلاحيات، الأدوار الأساسية، المحافظات، المقر العام، القوائم المرجعية العامة، تسميات المراحل.
// لا تُنشئ هذه العملية أي مستخدم أو كلمة مرور. لإنشاء أول مدير: npm run admin:create
// العملية متكررة الأمان (idempotent): لا تعيد كتابة تعديلات الإدارة على الأدوار أو القوائم.

import { PrismaClient } from "@prisma/client";
import { PERMISSIONS, SYSTEM_ROLES } from "../src/lib/rbac/catalog";
import { STAGE_LABELS, STAGE_ORDER } from "../src/lib/workflow/labels";

const prisma = new PrismaClient();

const GOVERNORATES: [string, string][] = [
  ["BGD", "بغداد"], ["BSR", "البصرة"], ["NIN", "نينوى"], ["ERB", "أربيل"], ["SUL", "السليمانية"],
  ["DUH", "دهوك"], ["KRK", "كركوك"], ["DIY", "ديالى"], ["ANB", "الأنبار"], ["BAB", "بابل"],
  ["KRB", "كربلاء"], ["NJF", "النجف"], ["WAS", "واسط"], ["DQR", "ذي قار"], ["MYS", "ميسان"],
  ["MUT", "المثنى"], ["QAD", "القادسية"], ["SAL", "صلاح الدين"], ["HLB", "حلبجة"],
];

// قوائم عامة غير قانونية؛ يمكن للإدارة تعديلها أو تعطيلها. أنواع المخالفات لا تُزرع لأنها تصنيف قانوني تحدده الهيئة.
const DETECTION_SOURCES = ["رصد ميداني", "رصد ومراقبة البث", "شكوى مواطن", "إحالة من جهة رسمية", "رصد إلكتروني"];
const ENTITY_TYPES = ["قناة فضائية", "محطة إذاعية", "شركة اتصالات", "مزود خدمة إنترنت", "مؤسسة إعلامية", "شخص طبيعي", "أخرى"];
const ACTIVITY_TYPES = ["بث تلفزيوني", "بث إذاعي", "خدمات اتصالات", "خدمات إنترنت", "إعلام رقمي", "استخدام الطيف الترددي", "أخرى"];

async function main() {
  for (const [code, def] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { code },
      update: { nameAr: def.nameAr, groupAr: def.groupAr },
      create: { code, nameAr: def.nameAr, groupAr: def.groupAr },
    });
  }
  const perms = new Map((await prisma.permission.findMany()).map((p) => [p.code, p.id]));

  for (const [code, def] of Object.entries(SYSTEM_ROLES)) {
    const existing = await prisma.role.findUnique({ where: { code } });
    if (existing) continue; // لا نعيد كتابة صلاحيات دور عدلته الإدارة
    await prisma.role.create({
      data: {
        code,
        nameAr: def.nameAr,
        description: def.description,
        isSystem: true,
        permissions: { create: def.permissions.map((p) => ({ permissionId: perms.get(p)! })) },
      },
    });
  }

  for (const [i, [code, nameAr]] of GOVERNORATES.entries()) {
    await prisma.governorate.upsert({ where: { code }, update: {}, create: { code, nameAr, sortOrder: i } });
  }
  const baghdad = await prisma.governorate.findUniqueOrThrow({ where: { code: "BGD" } });
  await prisma.office.upsert({
    where: { code: "HQ" },
    update: {},
    create: { code: "HQ", nameAr: "المقر العام", governorateId: baghdad.id },
  });

  for (const nameAr of DETECTION_SOURCES) await prisma.detectionSource.upsert({ where: { nameAr }, update: {}, create: { nameAr } });
  for (const nameAr of ENTITY_TYPES) await prisma.entityType.upsert({ where: { nameAr }, update: {}, create: { nameAr } });
  for (const nameAr of ACTIVITY_TYPES) await prisma.activityType.upsert({ where: { nameAr }, update: {}, create: { nameAr } });

  for (const [i, stage] of STAGE_ORDER.entries()) {
    await prisma.workflowStageConfig.upsert({
      where: { stage },
      update: {},
      create: { stage, labelAr: STAGE_LABELS[stage], sortOrder: i },
    });
  }

  console.log("✔ تم زرع البيانات الأساسية (الصلاحيات، الأدوار، المحافظات، القوائم المرجعية).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
