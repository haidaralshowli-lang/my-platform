// تهيئة عن بُعد تُشغَّل ضمن خطوة البناء (على Netlify حيث تصل البيئة إلى قاعدة البيانات)، وهي متساوية القوى:
// مدير النظام الأول: إذا ضُبط BOOTSTRAP_ADMIN_USERNAME و BOOTSTRAP_ADMIN_PASSWORD_HASH (بصمة Argon2id لا كلمة مرور نصية)
// ولم يوجد أي مدير بعد. يُلزم بتغيير كلمة المرور عند أول دخول. لا تُنشأ أي بيانات تجريبية.
// يُشغَّل باتصال مالك الجداول (DIRECT_DATABASE_URL). بعد نجاح التهيئة تُحذف هذه المتغيرات من إعدادات البيئة.
import { prisma } from "../src/lib/db";
import { writeAudit } from "../src/lib/audit";

const ARGON = /^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/;

async function main() {
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME?.toLowerCase();
  const hash = process.env.BOOTSTRAP_ADMIN_PASSWORD_HASH;
  if (!username || !hash) return console.log("• لا توجد متغيرات تهيئة؛ تخطي");
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error("BOOTSTRAP_ADMIN_USERNAME غير صالح");
  if (!ARGON.test(hash)) throw new Error("BOOTSTRAP_ADMIN_PASSWORD_HASH ليس بصمة Argon2id");
  if (await prisma.user.findFirst({ where: { role: "ADMIN" } })) return console.log("• يوجد مدير نظام مسبقاً؛ لا إنشاء");
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { username, fullName: process.env.BOOTSTRAP_ADMIN_FULLNAME || "مدير النظام", passwordHash: hash, role: "ADMIN", mustChangePassword: true },
    });
    await writeAudit(tx, { actor: null, username: "bootstrap", action: "user.bootstrap_admin", entityType: "User", entityId: user.id, after: { username, role: "ADMIN" } });
  });
  console.log(`✔ أُنشئ مدير النظام ${username} (يُلزم بتغيير كلمة المرور عند أول دخول)`);
}

main()
  .catch((e) => {
    console.error("✖ فشل التهيئة:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
