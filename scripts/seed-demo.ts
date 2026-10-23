// إنشاء بيانات العرض التجريبية (معلّمة isDemo، ولا تظهر في لوحة المعلومات والتقارير).
// الاستخدام: npm run demo:seed -- [--out ./demo-credentials.txt]
// تُطبع كلمات مرور الحسابات التجريبية مرة واحدة فقط (أو تُكتب إلى ملف بصلاحية 600). لا تُحفظ في المستودع.
import { writeFileSync } from "node:fs";
import { seedDemo } from "../src/lib/demo/seed";
import { prisma } from "../src/lib/db";

const i = process.argv.indexOf("--out");
const out = i >= 0 ? process.argv[i + 1] : undefined;

seedDemo()
  .then((r) => {
    const lines = [`أُنشئت ${r.violations} مخالفة تجريبية. الحسابات التجريبية (نطاق مركزي):`, ...r.credentials.map((c) => `${c.username}\t${c.password}\t${c.fullName}`)];
    if (out) {
      writeFileSync(out, lines.join("\n") + "\n", { mode: 0o600 });
      console.log(`${lines[0]} كُتبت بيانات الدخول إلى ${out}`);
    } else console.log(lines.join("\n"));
  })
  .catch((e) => {
    console.error("فشل إنشاء البيانات التجريبية:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
