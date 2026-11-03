// تهيئة آمنة لأول مدير نظام: تُطلب البيانات تفاعلياً ولا تُخزَّن في المستودع.
// الاستخدام: npm run admin:create
// للتشغيل غير التفاعلي (مثلاً داخل حاوية): ADMIN_USERNAME و ADMIN_FULLNAME و ADMIN_PASSWORD كمتغيرات بيئة مؤقتة.

import { PrismaClient } from "@prisma/client";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { hashPassword, passwordPolicyErrors } from "../src/lib/auth/password";
import { writeAudit } from "../src/lib/audit";

const prisma = new PrismaClient();

async function ask(rl: ReturnType<typeof createInterface>, q: string, hidden = false): Promise<string> {
  if (!hidden) return (await rl.question(q)).trim();
  // إخفاء كلمة المرور أثناء الكتابة
  const out = stdout as unknown as { write: (s: string) => boolean };
  const orig = out.write.bind(out);
  stdout.write(q);
  out.write = () => true;
  try {
    return (await rl.question("")).trim();
  } finally {
    out.write = orig;
    stdout.write("\n");
  }
}

async function main() {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const username = (process.env.ADMIN_USERNAME || (await ask(rl, "اسم المستخدم لمدير النظام: "))).toLowerCase();
    const fullName = process.env.ADMIN_FULLNAME || (await ask(rl, "الاسم الكامل: "));
    const password = process.env.ADMIN_PASSWORD || (await ask(rl, "كلمة المرور (12 حرفاً على الأقل): ", true));

    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error("اسم المستخدم يجب أن يكون 3-40 حرفاً لاتينياً أو أرقاماً أو (. _ -)");
    if (!fullName) throw new Error("الاسم الكامل مطلوب");
    const errs = passwordPolicyErrors(password, username);
    if (errs.length) throw new Error(errs.join("، "));
    if (await prisma.user.findUnique({ where: { username } })) throw new Error("اسم المستخدم موجود مسبقاً");

    const passwordHash = await hashPassword(password);
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        // يُطلب تغيير كلمة المرور عند أول دخول إذا مُررت عبر متغير بيئة
        data: { username, fullName, passwordHash, role: "ADMIN", mustChangePassword: !!process.env.ADMIN_PASSWORD },
      });
      await writeAudit(tx, {
        actor: null,
        username: "bootstrap",
        action: "user.bootstrap_admin",
        entityType: "User",
        entityId: user.id,
        after: { username, fullName, role: "ADMIN" },
      });
    });
    console.log(`✔ تم إنشاء مدير النظام "${username}". أنشئ حساب المنسق العام من صفحة «المستخدمون» بعد الدخول.`);
  } finally {
    rl.close();
  }
}

main()
  .catch((e) => {
    console.error("✖", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
