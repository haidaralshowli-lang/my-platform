import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { recordDispatch, recordReceipt, correctReceipt, receiptSchema } from "@/lib/services/deliveries";
import { applyRuleToPending, createRule, decideExtension, endRule, extensionSchema, recordExtension, refreshDeadlines, ruleSchema } from "@/lib/services/deadlines";
import { addDaysKey } from "@/lib/deadlines/compute";
import { localDateKey } from "@/lib/datetime";
import { SAMPLE_PDF } from "./helpers";
import { makeCast, toAwaitingDelivery, type Cast } from "./flow";

let c: Cast;
let typeId: string;
const today = () => localDateKey(new Date(), "Asia/Baghdad");
const receipt = (date: string) => receiptSchema.parse({ receivedDate: date, recipientName: "مدير المحطة", recipientCapacity: "المدير المفوض", receiptNumber: `R-${Math.random()}` });
const file = { name: "wasl.pdf", data: SAMPLE_PDF };

async function delivered(receivedDaysAgo: number, typeOverride?: string) {
  const { id, warningId } = await toAwaitingDelivery(c, typeOverride ? { violationTypeId: typeOverride } : {});
  const sent = addDaysKey(today(), -receivedDaysAgo);
  // الإرسال والتوقيع اليوم في الاختبار؛ نسجل الإرسال بتاريخ الاستلام نفسه أو قبله
  await prisma.warning.update({ where: { id: warningId }, data: { signedAt: new Date(`${addDaysKey(sent, -1)}T00:00:00Z`) } });
  const deliveryId = await recordDispatch(c.delivery, warningId, { sentAt: sent, method: "HAND", notes: null });
  return { id, warningId, deliveryId, receivedKey: sent };
}

beforeAll(async () => {
  c = await makeCast();
  const t = await prisma.violationType.create({ data: { code: `DL${Date.now()}`, nameAr: `نوع مدة ${Date.now()}` } });
  typeId = t.id;
  // قاعدة عامة: 10 أيام تقويمية من يوم الاستلام، وقاعدة خاصة بنوع: 5 أيام عمل من اليوم التالي
  await createRule(c.admin, ruleSchema.parse({
    code: `GEN${Date.now()}`, nameAr: "قاعدة عامة للاختبار", duration: "10", unit: "CALENDAR_DAYS", startEvent: "RECEIPT_DATE", excludeHolidays: "",
    legalBasis: "قرار مجلس الأمناء رقم (اختبار)", extensionAllowed: "on", maxExtensionDays: "15", objectionEffect: "MANUAL_DECISION", warnBeforeDays: "3", effectiveFrom: "2020-01-01",
  }));
  await createRule(c.admin, ruleSchema.parse({
    code: `WD${Date.now()}`, nameAr: "قاعدة خاصة بأيام العمل", violationTypeId: typeId, duration: "5", unit: "WORKING_DAYS", startEvent: "DAY_AFTER_RECEIPT", excludeHolidays: "on",
    legalBasis: "تعليمات اختبار", extensionAllowed: "", maxExtensionDays: "", objectionEffect: "NONE", warnBeforeDays: "1", effectiveFrom: "2020-01-01",
  }));
});

describe("التبليغ وبدء الاحتساب", () => {
  it("لا يبدأ العداد قبل توثيق الاستلام، ولا يُقبل الاستلام دون صورة الوصل", async () => {
    const { id, deliveryId } = await delivered(0);
    expect((await prisma.violation.findUniqueOrThrow({ where: { id } })).stage).toBe("AWAITING_RECEIPT_PROOF");
    expect(await prisma.deadlineCalculation.count({ where: { violationId: id } })).toBe(0);
    await expect(recordReceipt(c.delivery, deliveryId, receipt(today()), undefined)).rejects.toThrow(/وصل الاستلام/);
    await expect(recordReceipt(c.reg, deliveryId, receipt(today()), file)).rejects.toThrow(/صلاحية/);
  });

  it("الاحتساب من تاريخ الاستلام لا من تاريخ الإصدار، بالقاعدة العامة، مع حفظ نسخة القاعدة", async () => {
    const { id, deliveryId, receivedKey } = await delivered(2);
    await recordReceipt(c.delivery, deliveryId, receipt(receivedKey), file);
    const d = await prisma.deadlineCalculation.findFirstOrThrow({ where: { violationId: id, isCurrent: true } });
    expect(localDateKey(d.dueDate!, "Asia/Baghdad")).toBe(addDaysKey(receivedKey, 9));
    expect(d.status).toBe("RUNNING");
    expect((d.ruleSnapshot as { rule: { legalBasis: string } }).rule.legalBasis).toContain("مجلس الأمناء");
    const v = await prisma.violation.findUniqueOrThrow({ where: { id } });
    expect(v.stage).toBe("DEADLINE_RUNNING");
    const w = await prisma.warning.findFirstOrThrow({ where: { violationId: id } });
    expect(w.status).toBe("DELIVERED");
    // تواريخ منفصلة: الإعداد، الإرسال، الاستلام، تاريخ تسجيل الاستلام
    const del = await prisma.deliveryRecord.findUniqueOrThrow({ where: { id: deliveryId } });
    expect(del.receivedAt).not.toEqual(w.preparedAt);
    expect(del.recordedAt).toBeTruthy();
  });

  it("قاعدة خاصة بنوع المخالفة تتقدم على العامة", async () => {
    const { id, deliveryId, receivedKey } = await delivered(0, typeId);
    await recordReceipt(c.delivery, deliveryId, receipt(receivedKey), file);
    const d = await prisma.deadlineCalculation.findFirstOrThrow({ where: { violationId: id, isCurrent: true }, include: { rule: true } });
    expect(d.rule?.unit).toBe("WORKING_DAYS");
  });

  it("تعديل القواعد لاحقاً لا يغير مدة محتسبة (لا أثر رجعي)", async () => {
    const { id, deliveryId, receivedKey } = await delivered(1);
    await recordReceipt(c.delivery, deliveryId, receipt(receivedKey), file);
    const before = await prisma.deadlineCalculation.findFirstOrThrow({ where: { violationId: id, isCurrent: true } });
    await endRule(c.admin, before.ruleId!, today(), "استبدالها بقاعدة جديدة");
    await refreshDeadlines();
    const after = await prisma.deadlineCalculation.findFirstOrThrow({ where: { violationId: id, isCurrent: true } });
    expect(after.dueDate).toEqual(before.dueDate);
    // إعادة القاعدة العامة للسريان لبقية الاختبارات
    await prisma.legalDeadlineRule.update({ where: { id: before.ruleId! }, data: { effectiveTo: null } });
  });

  it("تصحيح تاريخ الاستلام يحفظ القديم والجديد والسبب، ويعيد الاحتساب، ويتطلب صلاحية", async () => {
    const { id, deliveryId, receivedKey } = await delivered(3);
    await recordReceipt(c.delivery, deliveryId, receipt(receivedKey), file);
    const newKey = addDaysKey(receivedKey, 1);
    await expect(correctReceipt(c.delivery, deliveryId, { receivedDate: newKey, reason: "خطأ إدخال" })).rejects.toThrow(/صلاحية/);
    await expect(correctReceipt(c.manager, deliveryId, { receivedDate: newKey, reason: "" })).rejects.toThrow(/سبب/);
    await correctReceipt(c.manager, deliveryId, { receivedDate: newKey, reason: "تاريخ الوصل الأصلي" });
    const corr = await prisma.receiptCorrection.findFirstOrThrow({ where: { deliveryRecordId: deliveryId } });
    expect(localDateKey(corr.oldReceivedAt!, "Asia/Baghdad")).toBe(receivedKey);
    expect(corr.approvedById).toBe(c.manager.id);
    const d = await prisma.deadlineCalculation.findFirstOrThrow({ where: { violationId: id, isCurrent: true } });
    expect(localDateKey(d.dueDate!, "Asia/Baghdad")).toBe(addDaysKey(newKey, 9));
    await expect(prisma.receiptCorrection.delete({ where: { id: corr.id } })).rejects.toThrow();
  });
});

describe("المهمة المجدولة والتنبيهات", () => {
  it("اقتراب الانتهاء ثم الانتهاء ينقل المعاملة إلى «انتهت المدة»، ولا تتكرر التنبيهات في كل تشغيل", async () => {
    const { id, deliveryId, receivedKey } = await delivered(8); // تنتهي بعد يوم
    await recordReceipt(c.delivery, deliveryId, receipt(receivedKey), file);
    await refreshDeadlines();
    let d = await prisma.deadlineCalculation.findFirstOrThrow({ where: { violationId: id, isCurrent: true } });
    expect(d.status).toBe("NEAR_EXPIRY");
    const n1 = await prisma.notification.count({ where: { violationId: id, type: "deadline.near_expiry" } });
    expect(n1).toBeGreaterThan(0);
    await refreshDeadlines();
    expect(await prisma.notification.count({ where: { violationId: id, type: "deadline.near_expiry" } })).toBe(n1);

    const later = new Date(d.dueDate!.getTime() + 60_000);
    await refreshDeadlines(later);
    d = await prisma.deadlineCalculation.findFirstOrThrow({ where: { violationId: id, isCurrent: true } });
    expect(d.status).toBe("EXPIRED");
    const v = await prisma.violation.findUniqueOrThrow({ where: { id } });
    expect(v.stage).toBe("DEADLINE_EXPIRED");
    // لا يُغلق الملف ولا يُحال تلقائياً إلى الدعوى
    expect(v.generalStatus).toBe("OPEN");
    expect(await prisma.criminalCase.count({ where: { violationId: id } })).toBe(0);
    const exp1 = await prisma.notification.count({ where: { violationId: id, type: "transition.deadline_expired" } });
    expect(exp1).toBeGreaterThan(0);
    await refreshDeadlines(later);
    expect(await prisma.notification.count({ where: { violationId: id, type: "transition.deadline_expired" } })).toBe(exp1);
    const hist = await prisma.violationStatusHistory.findFirstOrThrow({ where: { violationId: id, action: "deadline_expired" } });
    expect(hist.actorId).toBe("system");
  });

  it("بلا قاعدة سارية: المدة «بانتظار المراجعة» دون اختراع مدة، ثم تُطبق القاعدة عند إضافتها", async () => {
    const lone = await prisma.violationType.create({ data: { code: `LN${Date.now()}`, nameAr: `نوع بلا قاعدة ${Date.now()}` } });
    const general = await prisma.legalDeadlineRule.findMany({ where: { violationTypeId: null, isActive: true } });
    await prisma.legalDeadlineRule.updateMany({ where: { id: { in: general.map((g) => g.id) } }, data: { isActive: false } });
    try {
      const { id, deliveryId, receivedKey } = await delivered(0, lone.id);
      await recordReceipt(c.delivery, deliveryId, receipt(receivedKey), file);
      const d = await prisma.deadlineCalculation.findFirstOrThrow({ where: { violationId: id, isCurrent: true } });
      expect(d.status).toBe("PENDING_REVIEW");
      expect(d.dueDate).toBeNull();
      expect(d.ruleId).toBeNull();
      await expect(applyRuleToPending(c.admin, id)).rejects.toThrow(/لا توجد بعد قاعدة/);
      await createRule(c.admin, ruleSchema.parse({
        code: `LR${Date.now()}`, nameAr: "قاعدة لاحقة", violationTypeId: lone.id, duration: "7", unit: "CALENDAR_DAYS", startEvent: "RECEIPT_DATE", excludeHolidays: "",
        legalBasis: "قرار لاحق", extensionAllowed: "", maxExtensionDays: "", objectionEffect: "NONE", warnBeforeDays: "2", effectiveFrom: "2020-01-01",
      }));
      await applyRuleToPending(c.admin, id);
      const d2 = await prisma.deadlineCalculation.findFirstOrThrow({ where: { violationId: id, isCurrent: true } });
      expect(localDateKey(d2.dueDate!, "Asia/Baghdad")).toBe(addDaysKey(receivedKey, 6));
    } finally {
      await prisma.legalDeadlineRule.updateMany({ where: { id: { in: general.map((g) => g.id) } }, data: { isActive: true } });
    }
  });
});

describe("طلبات التمديد", () => {
  it("تقديم الطلب لا يغير الاستحقاق؛ الموافقة من صاحب الصلاحية تمدد بوحدة القاعدة؛ وتحترم الحد الأقصى", async () => {
    const { id, deliveryId, receivedKey } = await delivered(1);
    await recordReceipt(c.delivery, deliveryId, receipt(receivedKey), file);
    const before = await prisma.deadlineCalculation.findFirstOrThrow({ where: { violationId: id, isCurrent: true } });
    await expect(recordExtension(c.legal, id, extensionSchema.parse({ requestedAt: today(), requestedDays: "20", reasons: "ظروف فنية" }), [])).rejects.toThrow(/الحد الأقصى/);
    const reqId = await recordExtension(c.legal, id, extensionSchema.parse({ requestedAt: today(), requestedDays: "5", reasons: "ظروف فنية قاهرة" }), [file]);
    expect((await prisma.violation.findUniqueOrThrow({ where: { id } })).stage).toBe("EXTENSION_UNDER_REVIEW");
    expect((await prisma.deadlineCalculation.findUniqueOrThrow({ where: { id: before.id } })).dueDate).toEqual(before.dueDate);
    await expect(decideExtension(c.legal, reqId, true, 5, null)).rejects.toThrow(/صلاحية/);
    await decideExtension(c.chair, reqId, true, 4, "منح أربعة أيام");
    const after = await prisma.deadlineCalculation.findUniqueOrThrow({ where: { id: before.id } });
    expect(localDateKey(after.dueDate!, "Asia/Baghdad")).toBe(addDaysKey(localDateKey(before.dueDate!, "Asia/Baghdad"), 4));
    expect(after.status).toBe("EXTENDED");
    expect(after.totalExtensionDays).toBe(4);
    expect((await prisma.violation.findUniqueOrThrow({ where: { id } })).stage).toBe("DEADLINE_RUNNING");
  });

  it("القاعدة التي لا تجيز التمديد ترفض الطلب، والرفض يتطلب سبباً", async () => {
    const { id, deliveryId, receivedKey } = await delivered(0, typeId);
    await recordReceipt(c.delivery, deliveryId, receipt(receivedKey), file);
    await expect(recordExtension(c.legal, id, extensionSchema.parse({ requestedAt: today(), requestedDays: "2", reasons: "سبب الطلب" }), [])).rejects.toThrow(/لا تجيز/);
    const g = await delivered(0);
    await recordReceipt(c.delivery, g.deliveryId, receipt(g.receivedKey), file);
    const r = await recordExtension(c.legal, g.id, extensionSchema.parse({ requestedAt: today(), requestedDays: "2", reasons: "سبب الطلب" }), []);
    await expect(decideExtension(c.chair, r, false, null, "")).rejects.toThrow(/سبب/);
    await decideExtension(c.chair, r, false, null, "الأسباب غير كافية");
    expect((await prisma.extensionRequest.findUniqueOrThrow({ where: { id: r } })).status).toBe("REJECTED");
  });
});

describe("إشعارات سير العمل", () => {
  it("الإحالة للمصادقة تُشعر رئيس الهيئة برابط مباشر، ولا يُشعَر المنفذ بإجرائه", async () => {
    const { id } = await toAwaitingDelivery(c);
    const n = await prisma.notification.findFirst({ where: { userId: c.chair.id, violationId: id, type: "transition.submit_for_approval" } });
    expect(n?.link).toBe(`/violations/${id}`);
    expect(await prisma.notification.count({ where: { userId: c.reg.id, violationId: id, type: "transition.submit_for_approval" } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: c.delivery.id, violationId: id, type: "transition.warning_signed" } })).toBe(0);
  });
});
