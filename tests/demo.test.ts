import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { verifyAuditChain } from "@/lib/audit";
import { purgeDemo, seedDemo } from "@/lib/demo/seed";
import { dashboardKpis } from "@/lib/services/dashboard";
import { makeUser, completeInput } from "./helpers";
import { createDraft } from "@/lib/services/violations";

describe("البيانات التجريبية", () => {
  it("تُنشأ عبر الخدمات بكل المراحل، لا تدخل لوحة المعلومات، وتُحذف دون مساس بالبيانات الحقيقية أو سجل التدقيق", async () => {
    const reg = (await makeUser(["REGISTRAR"])).actor;
    const real = await createDraft(reg, await completeInput());
    const senior = (await makeUser(["SENIOR_MGMT"], { scope: "CENTRAL" })).actor;
    const before = await dashboardKpis(senior);

    const r = await seedDemo();
    expect(r.credentials).toHaveLength(9);
    expect(new Set(r.credentials.map((c) => c.password)).size).toBe(9);
    const demo = await prisma.violation.findMany({ where: { isDemo: true }, select: { stage: true, generalStatus: true } });
    expect(demo.length).toBe(r.violations);
    const stages = new Set(demo.map((v) => v.stage));
    for (const s of ["DRAFT", "AWAITING_FINAL_APPROVAL", "NOT_APPROVED", "OBJECTION_UNDER_REVIEW", "AWAITING_RESPONSE_VERIFICATION", "AWAITING_DELIVERY", "DEADLINE_RUNNING", "CRIMINAL_CASE", "CLOSED"]) expect([...stages]).toContain(s);
    expect(await prisma.deadlineCalculation.count({ where: { violation: { isDemo: true }, status: "NEAR_EXPIRY" } })).toBeGreaterThan(0);
    expect(await prisma.user.findUniqueOrThrow({ where: { username: "demo.setup" } })).toMatchObject({ isActive: false });
    expect(await dashboardKpis(senior)).toEqual(before);
    await expect(seedDemo()).rejects.toThrow(/موجودة مسبقاً/);

    const auditBefore = await prisma.auditLog.count();
    const p = await purgeDemo();
    expect(p.violations).toBe(r.violations);
    expect(await prisma.violation.count({ where: { isDemo: true } })).toBe(0);
    expect(await prisma.violation.findUnique({ where: { id: real.id } })).not.toBeNull();
    expect(await prisma.user.count({ where: { isDemo: true, isActive: true } })).toBe(0);
    expect(await prisma.auditLog.count()).toBe(auditBefore + 1);
    expect((await verifyAuditChain(prisma)).ok).toBe(true);
    // مشغلات منع التعديل أعيد تفعيلها
    const h = await prisma.violationStatusHistory.findFirstOrThrow();
    await expect(prisma.violationStatusHistory.delete({ where: { id: h.id } })).rejects.toThrow();
    // ويمكن إعادة الإنشاء بعد الحذف
    expect((await seedDemo()).violations).toBe(r.violations);
    await purgeDemo();
  }, 180_000);
});
