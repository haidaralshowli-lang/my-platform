// فحص الاتصال بقاعدة البيانات أثناء البناء، بأكواد خروج مميزة لأن سجل البناء قد لا يكون متاحاً لمن ينشر:
//   0 نجاح · 21 تعذر الوصول/DNS · 22 فشل المصادقة أو المستأجر غير موجود · 23 خطأ TLS · 24 خطأ آخر
//   --runtime: يفحص DATABASE_URL (دور التطبيق) بقراءة جدول وتعديل فارغ
//   30 فشل المضيف المحدد ونجح مضيف التجميع البديل (aws-0 ↔ aws-1): صحّح المضيف في متغيرات البيئة
import { PrismaClient } from "@prisma/client";

async function tryUrl(url: string, sql = "SELECT 1"): Promise<number> {
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    await db.$queryRawUnsafe(sql);
    return 0;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.error("[db-probe]", m.split("\n").filter(Boolean).slice(-2).join(" | ").replace(/:\/\/[^@]*@/g, "://***@"));
    if (/tenant or user not found|authentication failed|password/i.test(m)) return 22;
    if (/tls|ssl|certificate/i.test(m)) return 23;
    if (/can't reach|ENOTFOUND|ECONNREFUSED|timed out|P1001/i.test(m)) return 21;
    return 24;
  } finally {
    await db.$disconnect().catch(() => {});
  }
}

async function main() {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) return 0;
  const code = await tryUrl(url);
  if (code === 0) return 0;
  const alt = url.replace(/aws-([01])-/, (_m, d: string) => `aws-${d === "0" ? "1" : "0"}-`);
  if (alt !== url && (await tryUrl(alt)) === 0) return 30;
  return code;
}

/// بعد الترحيلات: اتصال التشغيل الفعلي (DATABASE_URL، دور التطبيق عبر مجمّع المعاملات) يقرأ جداول التطبيق ويكتب في جدول عادي
export async function probeRuntime(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) return 0;
  const read = await tryUrl(url, `SELECT count(*) FROM "User"`);
  if (read) return read;
  return tryUrl(url, `UPDATE "SystemSetting" SET "key" = "key" WHERE false`);
}

(process.argv.includes("--runtime") ? probeRuntime() : main()).then((c) => process.exit(c));
