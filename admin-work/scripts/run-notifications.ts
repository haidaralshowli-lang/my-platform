// تشغيل فحص التنبيهات يدوياً أو من مجدول النظام (cron): npm run job:notifications
import { runNotificationScan } from "../src/lib/services/notifications";
import { prisma } from "../src/lib/db";

runNotificationScan()
  .then((r) => console.log("تم فحص التنبيهات:", r))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
