// تهيئة عن بُعد تُشغَّل ضمن خطوة البناء (مثلاً على Netlify حيث تصل البيئة إلى قاعدة البيانات)، وهي متساوية القوى:
//  1) مدير النظام الأول: إذا ضُبط BOOTSTRAP_ADMIN_USERNAME و BOOTSTRAP_ADMIN_PASSWORD_HASH (بصمة Argon2id لا كلمة مرور نصية)
//     ولم يوجد المستخدم بعد. يُلزم بتغيير كلمة المرور عند أول دخول.
//  2) بيانات العرض التجريبية: إذا ضُبط BOOTSTRAP_DEMO=1 و BOOTSTRAP_DEMO_PASSWORD_HASH، ولم تُنشأ من قبل قط
//     (فلا تعود بعد حذفها بـ demo:purge).
// يُشغَّل باتصال مالك الجداول (DIRECT_DATABASE_URL). بعد نجاح التهيئة تُحذف هذه المتغيرات من إعدادات البيئة.
import { prisma } from "../src/lib/db";
import { writeAudit } from "../src/lib/audit";
import { purgeDemo, seedDemo } from "../src/lib/demo/seed";

const ARGON = /^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/;

async function bootstrapAdmin() {
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME?.toLowerCase();
  const hash = process.env.BOOTSTRAP_ADMIN_PASSWORD_HASH;
  if (!username || !hash) return;
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error("BOOTSTRAP_ADMIN_USERNAME غير صالح");
  if (!ARGON.test(hash)) throw new Error("BOOTSTRAP_ADMIN_PASSWORD_HASH ليس بصمة Argon2id");
  if (await prisma.user.findUnique({ where: { username } })) return console.log(`• مدير النظام ${username} موجود مسبقاً`);
  const role = await prisma.role.findUniqueOrThrow({ where: { code: "SYSADMIN" } });
  const hq = await prisma.office.findUniqueOrThrow({ where: { code: "HQ" } });
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        username, fullName: process.env.BOOTSTRAP_ADMIN_FULLNAME || "مدير النظام", passwordHash: hash, mustChangePassword: true,
        scope: "OFFICE", governorateId: hq.governorateId, officeId: hq.id, roles: { create: { roleId: role.id, grantedBy: "bootstrap" } },
      },
    });
    await writeAudit(tx, { actor: null, username: "bootstrap", action: "user.bootstrap_admin", entityType: "User", entityId: user.id, after: { username, roles: ["SYSADMIN"] } });
  });
  console.log(`✔ أُنشئ مدير النظام ${username} (يُلزم بتغيير كلمة المرور عند أول دخول)`);
}

async function bootstrapDemo() {
  if (process.env.BOOTSTRAP_DEMO !== "1") return;
  const hash = process.env.BOOTSTRAP_DEMO_PASSWORD_HASH;
  if (!hash || !ARGON.test(hash)) throw new Error("BOOTSTRAP_DEMO_PASSWORD_HASH مطلوب (بصمة Argon2id)");
  if (await prisma.auditLog.findFirst({ where: { action: "demo.seeded" } })) return console.log("• البيانات التجريبية أُنشئت سابقاً؛ لا إعادة إنشاء");
  // إنشاء سابق لم يكتمل (انقطاع أثناء البناء): يُحذف ما أُنشئ منه ثم يُعاد الإنشاء. الحذف يتطلب اتصالاً بصلاحية مالك الجداول.
  if (await prisma.violation.count({ where: { isDemo: true } })) {
    const p = await purgeDemo();
    console.log(`• حُذفت ${p.violations} مخالفة تجريبية من إنشاء سابق غير مكتمل`);
  }
  const r = await seedDemo({ passwordHash: hash });
  console.log(`✔ أُنشئت ${r.violations} مخالفة تجريبية و${r.credentials.length} حسابات تجريبية`);
}

async function main() {
  await bootstrapAdmin();
  await bootstrapDemo();
}

main()
  .catch((e) => {
    console.error("✖ فشل التهيئة:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
