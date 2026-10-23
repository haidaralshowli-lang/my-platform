import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { REPORTS, runReport, reportParamsSchema } from "@/lib/reports";
import { dashboardKpis, myTasks } from "@/lib/services/dashboard";
import { updateSetting, updateStageSla } from "@/lib/services/system-settings";
import { nextOfficialNumber } from "@/lib/numbering";
import { verifyAuditChain, writeAudit } from "@/lib/audit";
import { createDraft, registerViolation } from "@/lib/services/violations";
import { makeOffice, makeUser, completeInput } from "./helpers";
import { makeCast, toRunning, type Cast } from "./flow";

let c: Cast;
beforeAll(async () => {
  c = await makeCast();
  await toRunning(c);
});

describe("التقارير", () => {
  it("التقارير العشرون تعمل ببيانات حقيقية لمستخدم مركزي، وتعيد أعمدة وصفوفاً", async () => {
    expect(Object.keys(REPORTS)).toHaveLength(20);
    const v = await prisma.violation.findFirstOrThrow({ where: { number: { not: null }, isDemo: false } });
    for (const key of Object.keys(REPORTS)) {
      const r = await runReport(c.chair, key, reportParamsSchema.parse(key === "violation_full" ? { number: v.number! } : {}));
      expect(r.columns.length, key).toBeGreaterThan(0);
      expect(r.generatedBy).toBe(c.chair.fullName);
    }
  });

  it("تقرير المال وأداء الموظفين يتطلبان صلاحياتهما", async () => {
    const legal = c.legal; // يملك reports.view دون financial.view
    await expect(runReport(legal, "financial", reportParamsSchema.parse({}))).rejects.toThrow(/صلاحية/);
    await expect(runReport(legal, "staff_performance", reportParamsSchema.parse({}))).rejects.toThrow(/صلاحية/);
    await expect(runReport(c.reg, "by_governorate", reportParamsSchema.parse({}))).rejects.toThrow(/صلاحية/);
  });

  it("البيانات التجريبية والمسودات لا تظهر في التقارير، والنطاق يُطبَّق", async () => {
    const d = await createDraft(c.reg, await completeInput({ offenderName: "جهة تجريبية للتقرير" }));
    await registerViolation(c.reg, d.id, d.version);
    await prisma.violation.update({ where: { id: d.id }, data: { isDemo: true } });
    const r = await runReport(c.chair, "missing_documents", reportParamsSchema.parse({}));
    expect(r.rows.some((x) => x.offenderName === "جهة تجريبية للتقرير")).toBe(false);
    const repeat = await runReport(c.chair, "repeat_offenders", reportParamsSchema.parse({}));
    expect(repeat.rows.every((x) => (x.total as number) > 1)).toBe(true);

    const far = await makeOffice("T-MYS", "MYS");
    const { actor: farManager } = await makeUser(["BRANCH_MANAGER"], { officeCode: far.code });
    const k = await dashboardKpis(farManager);
    expect(k.total).toBe(0);
    const g = await runReport(farManager, "by_governorate", reportParamsSchema.parse({}));
    expect(g.rows).toHaveLength(0);
  });

  it("قائمة المهام تعرض ما ينتظر صلاحية المستخدم فقط", async () => {
    const tasks = await myTasks(c.delivery);
    expect(tasks.items.every((t) => ["AWAITING_WARNING_SIGNATURE", "AWAITING_DELIVERY", "AWAITING_RECEIPT_PROOF"].includes(t.stage))).toBe(true);
    expect((await myTasks(c.admin)).total).toBe(0);
  });

  it("المبالغ في لوحة المعلومات لمن يملك صلاحية المال فقط", async () => {
    expect((await dashboardKpis(c.legal)).financial).toBeNull();
    expect((await dashboardKpis(c.chair)).financial).not.toBeNull();
  });
});

describe("إعدادات النظام", () => {
  it("تعديل صيغة الترقيم يتطلب صلاحية وسبباً وصيغة صحيحة، ويُطبَّق على الأرقام الجديدة ويُسجَّل", async () => {
    await expect(updateSetting(c.legal, "numbering.warning", "W-{SEQ:4}", "سبب")).rejects.toThrow(/صلاحية/);
    await expect(updateSetting(c.admin, "numbering.warning", "W-{YYYY}", "سبب")).rejects.toThrow(/SEQ/);
    await expect(updateSetting(c.admin, "numbering.warning", "W-{SEQ:4}", "")).rejects.toThrow(/سبب/);
    await expect(updateSetting(c.admin, "display.digits", "arab", "سبب")).rejects.toThrow(/غير قابل/);
    await updateSetting(c.admin, "numbering.warning", "W-{GOV}-{SEQ:4}", "اعتماد صيغة جديدة");
    const n = await prisma.$transaction((tx) => nextOfficialNumber(tx, "warning", { governorateCode: "BGD" }));
    expect(n).toMatch(/^W-BGD-\d{4}$/);
    expect(await prisma.auditLog.count({ where: { action: "setting.changed", entityId: "numbering.warning" } })).toBe(1);
    await prisma.systemSetting.delete({ where: { key: "numbering.warning" } });
  });

  it("القيم خارج الحدود مرفوضة، والمدة الإدارية للمرحلة تُحفظ", async () => {
    await expect(updateSetting(c.admin, "attachments.maxSizeMb", "500", "سبب")).rejects.toThrow(/بين/);
    await expect(updateSetting(c.admin, "deadline.weekendDays", "7", "سبب")).rejects.toThrow(/0/);
    await updateSetting(c.admin, "workflow.requireJudgmentApproval", "false", "تجربة");
    expect((await prisma.systemSetting.findUniqueOrThrow({ where: { key: "workflow.requireJudgmentApproval" } })).value).toBe(false);
    await prisma.systemSetting.delete({ where: { key: "workflow.requireJudgmentApproval" } });
    await updateStageSla(c.admin, "AWAITING_TECHNICAL", 7);
    expect((await prisma.workflowStageConfig.findUniqueOrThrow({ where: { stage: "AWAITING_TECHNICAL" } })).slaDays).toBe(7);
    await updateStageSla(c.admin, "AWAITING_TECHNICAL", null);
  });
});

describe("سلامة سجل التدقيق", () => {
  it("التحقق يكشف تعديل قيد حتى لو عُطِّل مشغّل الحماية بصلاحية مالك الجداول", async () => {
    await prisma.$transaction((tx) => writeAudit(tx, { actor: null, username: "t", action: "test.tamper_target", entityType: "Test" }));
    expect((await verifyAuditChain(prisma)).ok).toBe(true);
    const target = await prisma.auditLog.findFirstOrThrow({ where: { action: "test.tamper_target" } });
    await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" DISABLE TRIGGER audit_log_no_update`);
    try {
      await prisma.$executeRawUnsafe(`UPDATE "AuditLog" SET "reason" = 'عبث' WHERE id = ${target.id}`);
      const r = await verifyAuditChain(prisma);
      expect(r.ok).toBe(false);
      expect(r.brokenAt).toBe(target.id);
      await prisma.$executeRawUnsafe(`UPDATE "AuditLog" SET "reason" = NULL WHERE id = ${target.id}`);
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" ENABLE TRIGGER audit_log_no_update`);
    }
    expect((await verifyAuditChain(prisma)).ok).toBe(true);
  });
});
