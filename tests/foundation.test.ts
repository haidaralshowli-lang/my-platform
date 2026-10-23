import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { hashPassword, passwordPolicyErrors, verifyPassword } from "@/lib/auth/password";
import { formatNumber, nextOfficialNumber, sequenceKey, validatePattern } from "@/lib/numbering";
import { canonicalJson, redact, verifyAuditChain, writeAudit } from "@/lib/audit";
import { localDateKey, zonedDateTimeToUtc } from "@/lib/datetime";

describe("كلمات المرور (Argon2id)", () => {
  it("تجزئة وتحقق صحيحان", async () => {
    const h = await hashPassword("CorrectHorse12345");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, "CorrectHorse12345")).toBe(true);
    expect(await verifyPassword(h, "wrong-password-1")).toBe(false);
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
  });
  it("سياسة كلمة المرور", () => {
    expect(passwordPolicyErrors("short1")).not.toHaveLength(0);
    expect(passwordPolicyErrors("onlylettersxxxx")).not.toHaveLength(0);
    expect(passwordPolicyErrors("ahmedPassword2026", "ahmed")).not.toHaveLength(0);
    expect(passwordPolicyErrors("GoodPassword2026", "ahmed")).toHaveLength(0);
  });
});

describe("الترقيم الرسمي", () => {
  it("التحقق من الصيغة", () => {
    expect(validatePattern("م-{YYYY}-{SEQ:6}")).toBeNull();
    expect(validatePattern("م-{YYYY}")).not.toBeNull();
    expect(validatePattern("{SEQ}{SEQ}")).not.toBeNull();
    expect(validatePattern("{FOO}-{SEQ}")).not.toBeNull();
  });
  it("التنسيق ومفتاح التسلسل", () => {
    const t = { year: 2026, governorateCode: "DQR", officeCode: "DQR1" };
    expect(formatNumber("{GOV}/{YYYY}/{SEQ:4}", t, 7)).toBe("DQR/2026/0007");
    expect(sequenceKey("violation", "{GOV}/{YYYY}/{SEQ:4}", t)).toBe("violation:2026:DQR");
    expect(sequenceKey("violation", "{SEQ:4}", t)).toBe("violation");
  });
  it("لا تتكرر الأرقام مع 40 طلباً متزامناً", async () => {
    const results = await Promise.all(
      Array.from({ length: 40 }, () => prisma.$transaction((tx) => nextOfficialNumber(tx, "violation", {}))),
    );
    expect(new Set(results).size).toBe(40);
    expect(results.every((r) => /^م-\d{4}-\d{6}$/.test(r))).toBe(true);
  });
  it("السنة تُحتسب بتوقيت بغداد لا UTC", async () => {
    // 2026-12-31 22:30 UTC = 2027-01-01 01:30 بتوقيت بغداد
    const n = await prisma.$transaction((tx) => nextOfficialNumber(tx, "warning", { at: new Date("2026-12-31T22:30:00Z") }));
    expect(n).toMatch(/^إن-2027-/);
  });
});

describe("المنطقة الزمنية", () => {
  it("تحويل التاريخ المحلي إلى UTC", () => {
    expect(zonedDateTimeToUtc("2026-03-01", "00:00", "Asia/Baghdad").toISOString()).toBe("2026-02-28T21:00:00.000Z");
    expect(localDateKey(new Date("2026-02-28T21:30:00Z"), "Asia/Baghdad")).toBe("2026-03-01");
    expect(localDateKey(new Date("2026-02-28T21:30:00Z"), "UTC")).toBe("2026-02-28");
  });
});

describe("سجل التدقيق", () => {
  it("يحجب الحقول السرية", () => {
    expect(redact({ password: "x", passwordHash: "y", nested: { token: "z", name: "ok" } })).toEqual({
      password: "[محجوب]", passwordHash: "[محجوب]", nested: { token: "[محجوب]", name: "ok" },
    });
  });
  it("التسلسل القانوني مستقل عن ترتيب المفاتيح", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
  it("سلسلة التجزئة سليمة بعد عدة قيود", async () => {
    for (let i = 0; i < 3; i++) {
      await prisma.$transaction((tx) =>
        writeAudit(tx, { actor: null, username: "test", action: "test.event", entityType: "Test", entityId: String(i), after: { zeta: i, alpha: "ب" } }),
      );
    }
    const r = await verifyAuditChain(prisma);
    expect(r.ok).toBe(true);
    expect(r.checked).toBeGreaterThanOrEqual(3);
  });
  it("قاعدة البيانات تمنع تعديل أو حذف قيود التدقيق", async () => {
    await expect(prisma.$executeRawUnsafe(`UPDATE "AuditLog" SET "action" = 'x'`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "AuditLog"`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`TRUNCATE "AuditLog"`)).rejects.toThrow();
  });
});
