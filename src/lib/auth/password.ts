import { hash, verify } from "@node-rs/argon2";

// معاملات Argon2id وفق توصيات OWASP (19 MiB، تكرار 2)
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export async function hashPassword(plain: string): Promise<string> {
  // algorithm 2 = Argon2id (const enum في المكتبة)
  return hash(plain, { ...OPTIONS, algorithm: 2 });
}

export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  try {
    return await verify(stored, plain);
  } catch {
    return false;
  }
}

/// سياسة كلمة المرور: 12 حرفاً على الأقل مع حروف وأرقام، ولا تساوي اسم المستخدم
export function passwordPolicyErrors(password: string, username?: string): string[] {
  const errors: string[] = [];
  if (password.length < 12) errors.push("يجب ألا تقل كلمة المرور عن 12 حرفاً");
  if (password.length > 128) errors.push("كلمة المرور طويلة جداً");
  if (!/[A-Za-z؀-ۿ]/.test(password)) errors.push("يجب أن تحتوي كلمة المرور على حروف");
  if (!/[0-9٠-٩]/.test(password)) errors.push("يجب أن تحتوي كلمة المرور على أرقام");
  if (username && password.toLowerCase().includes(username.toLowerCase())) {
    errors.push("يجب ألا تحتوي كلمة المرور على اسم المستخدم");
  }
  return errors;
}
