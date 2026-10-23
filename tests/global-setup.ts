import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

// كل تشغيل للاختبارات يستخدم مخططاً (schema) جديداً مؤقتاً داخل قاعدة الاختبار،
// تُطبَّق عليه الترحيلات بـ migrate deploy (غير هدّام)، ويُحذف المخطط المؤقت وحده في النهاية.
export default function setup() {
  const base = process.env.TEST_DATABASE_URL ?? "postgresql://cmc:cmc_dev@localhost:5432/cmc_violations_test";
  if (!/test/i.test(base)) throw new Error("رفض التشغيل: رابط قاعدة الاختبار يجب أن يحتوي كلمة test");
  const schema = `vitest_${Date.now()}`;
  const url = `${base}${base.includes("?") ? "&" : "?"}schema=${schema}`;
  process.env.CMC_TEST_DB_URL = url;
  const env = { ...process.env, DATABASE_URL: url, DIRECT_DATABASE_URL: url };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });

  return async () => {
    if (process.env.KEEP_TEST_SCHEMA) return;
    const prisma = new PrismaClient({ datasourceUrl: base });
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
  };
}
