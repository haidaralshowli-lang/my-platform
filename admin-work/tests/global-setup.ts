import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

// كل تشغيل يستخدم مخططاً (schema) مؤقتاً جديداً داخل قاعدة الاختبار، ويُحذف في النهاية.
export default function setup() {
  const base = process.env.TEST_DATABASE_URL ?? "postgresql://aw:aw_dev@localhost:5432/admin_work_test";
  if (!/test/i.test(base)) throw new Error("رفض التشغيل: رابط قاعدة الاختبار يجب أن يحتوي كلمة test");
  const schema = `vitest_${Date.now()}`;
  const url = `${base}${base.includes("?") ? "&" : "?"}schema=${schema}`;
  process.env.AW_TEST_DB_URL = url;
  const env = { ...process.env, DATABASE_URL: url, DIRECT_DATABASE_URL: url };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });

  return async () => {
    const prisma = new PrismaClient({ datasourceUrl: base });
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
  };
}
