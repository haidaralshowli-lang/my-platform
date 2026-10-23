// يطبع بصمة Argon2id لكلمة مرور تُقرأ من الإدخال القياسي (لا تُمرَّر في سطر الأوامر حتى لا تبقى في سجل الأوامر).
// الاستخدام: printf '%s' 'كلمة المرور' | npm run -s password:hash
import { hashPassword, passwordPolicyErrors } from "../src/lib/auth/password";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", async () => {
  const pw = input.replace(/\r?\n$/, "");
  const errs = passwordPolicyErrors(pw, "");
  if (errs.length) {
    console.error(errs.join("، "));
    process.exitCode = 1;
    return;
  }
  console.log(await hashPassword(pw));
});
