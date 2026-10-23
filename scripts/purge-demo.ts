// حذف بيانات العرض التجريبية قبل التشغيل الفعلي. لا يمس سجل التدقيق، ويعطّل الحسابات التجريبية بدل حذفها.
// الاستخدام: npm run demo:purge -- --yes   (يتطلب اتصالاً بصلاحية مالك الجداول، مثل DIRECT_DATABASE_URL)
import { purgeDemo } from "../src/lib/demo/seed";
import { prisma } from "../src/lib/db";

if (!process.argv.includes("--yes")) {
  console.error("هذا الإجراء يحذف كل المخالفات التجريبية نهائياً. أعد التشغيل مع --yes للتأكيد.");
  process.exit(1);
}
if (process.env.DIRECT_DATABASE_URL) process.env.DATABASE_URL = process.env.DIRECT_DATABASE_URL;

purgeDemo()
  .then((r) => console.log(`حُذفت ${r.violations} مخالفة تجريبية، وعُطِّل ${r.users} حساباً تجريبياً. سجل التدقيق محفوظ.`))
  .catch((e) => {
    console.error("فشل الحذف:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
