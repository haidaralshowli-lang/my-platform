// تشغيل مهمة تحديث المدد والتنبيهات مباشرة (لخادم الهيئة: cron أو systemd timer كل ساعة)
// مثال cron: 5 * * * *  cd /opt/cmc && npm run job:deadlines >> /var/log/cmc-deadlines.log 2>&1
import { refreshDeadlines } from "../src/lib/services/deadlines";
import { prisma } from "../src/lib/db";

refreshDeadlines()
  .then((r) => console.log(new Date().toISOString(), JSON.stringify(r)))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
