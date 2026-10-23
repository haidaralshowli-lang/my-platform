// تُشغَّل الاختبارات على مخطط مؤقت في قاعدة اختبار منفصلة فقط (انظر global-setup.ts)
if (!process.env.CMC_TEST_DB_URL) throw new Error("قاعدة الاختبار غير مهيأة");
process.env.DATABASE_URL = process.env.CMC_TEST_DB_URL;
process.env.DIRECT_DATABASE_URL = process.env.CMC_TEST_DB_URL;
process.env.APP_SECRET ??= "test-secret-test-secret-test-secret-0000";
process.env.APP_TIMEZONE ??= "Asia/Baghdad";
import { tmpdir } from "node:os";
import path from "node:path";
process.env.STORAGE_DRIVER = "local";
process.env.STORAGE_LOCAL_DIR = path.join(tmpdir(), `cmc-test-storage-${process.pid}`);
