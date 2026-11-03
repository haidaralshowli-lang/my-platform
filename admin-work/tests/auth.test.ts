import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { authenticate, changeOwnPassword, revokeSessionByToken, validateSession } from "@/lib/auth/service";
import { passwordPolicyErrors } from "@/lib/auth/password";
import { makeUser, PASSWORD } from "./helpers";

describe("المصادقة", () => {
  it("يسجل الدخول بكلمة مرور صحيحة وينشئ جلسة صالحة", async () => {
    const a = await makeUser("COORDINATOR");
    const { token, actor } = await authenticate({ username: a.username, password: PASSWORD, ip: "10.0.0.1" });
    expect(actor.id).toBe(a.id);
    const s = await validateSession(token);
    expect(s?.actor.id).toBe(a.id);
    // الرمز لا يُخزَّن كما هو
    expect(await prisma.session.findFirst({ where: { tokenHash: token } })).toBeNull();
  });

  it("يرفض كلمة المرور الخاطئة والمستخدم غير الموجود بالرسالة نفسها", async () => {
    const a = await makeUser("COORDINATOR");
    const e1 = await authenticate({ username: a.username, password: "wrong-password-1" }).catch((e) => e);
    const e2 = await authenticate({ username: "no-such-user", password: "wrong-password-1" }).catch((e) => e);
    expect(e1.message).toBe(e2.message);
  });

  it("يقفل الحساب بعد 5 محاولات فاشلة حتى مع كلمة المرور الصحيحة", async () => {
    const a = await makeUser("COORDINATOR");
    for (let i = 0; i < 5; i++) await authenticate({ username: a.username, password: "bad-password-00" }).catch(() => null);
    await expect(authenticate({ username: a.username, password: PASSWORD })).rejects.toThrow(/مقفل/);
  });

  it("يرفض دخول الحساب المعطل ويبطل جلساته", async () => {
    const a = await makeUser("COORDINATOR");
    const { token } = await authenticate({ username: a.username, password: PASSWORD });
    await prisma.user.update({ where: { id: a.id }, data: { isActive: false } });
    expect(await validateSession(token)).toBeNull();
    await expect(authenticate({ username: a.username, password: PASSWORD })).rejects.toThrow(/معطل/);
  });

  it("تنتهي الجلسة بعد 60 دقيقة خمول وبعد تسجيل الخروج", async () => {
    const a = await makeUser("ADMIN");
    const s1 = await authenticate({ username: a.username, password: PASSWORD });
    await prisma.session.updateMany({ where: { userId: a.id }, data: { lastSeenAt: new Date(Date.now() - 61 * 60_000) } });
    expect(await validateSession(s1.token)).toBeNull();
    const s2 = await authenticate({ username: a.username, password: PASSWORD });
    await revokeSessionByToken(s2.token, a);
    expect(await validateSession(s2.token)).toBeNull();
  });

  it("يفرض سياسة كلمة المرور ويُنهي الجلسات الأخرى عند تغييرها", async () => {
    expect(passwordPolicyErrors("short1")).not.toHaveLength(0);
    expect(passwordPolicyErrors("onlyletterslong")).not.toHaveLength(0);
    expect(passwordPolicyErrors("ahmed-2026-abcd", "ahmed")).not.toHaveLength(0);
    const a = await makeUser("COORDINATOR");
    const s1 = await authenticate({ username: a.username, password: PASSWORD });
    const s2 = await authenticate({ username: a.username, password: PASSWORD });
    const current = await validateSession(s1.token);
    await expect(changeOwnPassword(a, current!.sessionId, { current: PASSWORD, next: "weak" })).rejects.toThrow();
    await changeOwnPassword(a, current!.sessionId, { current: PASSWORD, next: "New-Strong-Pass-99" });
    expect(await validateSession(s1.token)).not.toBeNull();
    expect(await validateSession(s2.token)).toBeNull();
  });

  it("يسجل الدخول الناجح والفاشل في سجل التدقيق", async () => {
    const a = await makeUser("COORDINATOR");
    await authenticate({ username: a.username, password: "bad-password-00" }).catch(() => null);
    await authenticate({ username: a.username, password: PASSWORD });
    const actions = (await prisma.auditLog.findMany({ where: { username: a.username } })).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["auth.login_failed", "auth.login"]));
  });
});
