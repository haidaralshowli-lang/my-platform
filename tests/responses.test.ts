import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  addPayment, decideRemoval, decideResponse, financialSchema, giveLegalOpinion, legalResponseSchema, paymentSchema, recordRemoval, recordResponse,
  removalSchema, responseBaseSchema, technicalResponseSchema, technicalVerifySchema, updateFinancial, verifyTechnicalResponse,
} from "@/lib/services/responses";
import { addObjectionEvent, decideObjection, objectionDecisionSchema, objectionSchema, recordObjection, suspendForObjection } from "@/lib/services/objections";
import { refreshDeadlines } from "@/lib/services/deadlines";
import { makeUser, SAMPLE_PDF } from "./helpers";
import { makeCast, toRunning, type Cast } from "./flow";
import type { Actor } from "@/lib/rbac/actor";

let c: Cast;
let finance: Actor, financeBoss: Actor;
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad" }).format(new Date());
const base = (o: Record<string, unknown> = {}) => responseBaseSchema.parse({ receivedAt: today(), summary: "كتاب الجهة المخالفة بالاستجابة", ...o });
const stage = async (id: string) => (await prisma.violation.findUniqueOrThrow({ where: { id } })).stage;
const deadline = (id: string) => prisma.deadlineCalculation.findFirstOrThrow({ where: { violationId: id, isCurrent: true } });

beforeAll(async () => {
  c = await makeCast();
  finance = (await makeUser(["FINANCE"])).actor;
  financeBoss = (await makeUser(["FINANCE"])).actor;
  financeBoss.permissions.add("financial.approve_overpayment");
});

describe("الاستجابة المالية", () => {
  it("تسجيل الاستجابة يوقف المدة؛ تسديد جزئي ومتعدد؛ منع التجاوز إلا بصلاحية وسبب؛ لا قبول قبل التسديد الكامل", async () => {
    const { id } = await toRunning(c);
    await expect(recordResponse(c.reg, id, base(), { kind: "FINANCIAL", data: financialSchema.parse({ financialType: "غرامة" }) }, [])).rejects.toThrow(/صلاحية/);
    expect(financialSchema.safeParse({ financialType: "غرامة", amountDue: "1000" }).success).toBe(false); // بلا سند
    const rid = await recordResponse(finance, id, base(), { kind: "FINANCIAL", data: financialSchema.parse({ financialType: "غرامة مالية", amountDue: "1000000", amountDueBasis: "قرار الغرامة رقم 5" }) }, [{ name: "f.pdf", data: SAMPLE_PDF }]);
    expect(await stage(id)).toBe("AWAITING_RESPONSE_VERIFICATION");
    expect((await deadline(id)).status).toBe("STOPPED");

    await addPayment(finance, rid, paymentSchema.parse({ amount: "400000", paidAt: today(), receiptNumber: "P1" }));
    let f = await prisma.financialResponse.findUniqueOrThrow({ where: { responseId: rid } });
    expect(f.paymentStatus).toBe("PARTIALLY_PAID");
    await expect(addPayment(finance, rid, paymentSchema.parse({ amount: "700000", paidAt: today(), receiptNumber: "P2" }))).rejects.toThrow(/يتجاوز/);
    await expect(addPayment(finance, rid, paymentSchema.parse({ amount: "100", paidAt: today(), receiptNumber: "P1" }))).rejects.toThrow(/مسجل مسبقاً/);
    await addPayment(finance, rid, paymentSchema.parse({ amount: "600000", paidAt: today(), receiptNumber: "P2" }));
    f = await prisma.financialResponse.findUniqueOrThrow({ where: { responseId: rid } });
    expect(f.paymentStatus).toBe("PAID");
    // التسديدات لا تُعدَّل ولا تُحذف في قاعدة البيانات
    const p = await prisma.payment.findFirstOrThrow({ where: { financialResponseId: rid } });
    await expect(prisma.payment.update({ where: { id: p.id }, data: { amount: 1 } })).rejects.toThrow();
    await expect(prisma.payment.delete({ where: { id: p.id } })).rejects.toThrow();

    await expect(decideResponse(c.chair, rid, "ACCEPTED", null)).rejects.toThrow(/التدقيق المالي/);
    await updateFinancial(finance, rid, { amountDue: "1000000", amountDueBasis: "قرار الغرامة رقم 5", auditResult: "مطابق للوصولات", reason: "" });
    await expect(decideResponse(finance, rid, "ACCEPTED", null)).rejects.toThrow(/صلاحية/);
    const v = await decideResponse(c.chair, rid, "ACCEPTED", null);
    expect(v.stage).toBe("AWAITING_FINAL_VERIFICATION");
    expect(v.outcome).toBe("FINANCIAL_RESPONSE");
    expect(v.generalStatus).toBe("OPEN"); // لا إغلاق تلقائي
  });

  it("القيد العكسي يتطلب صلاحية اعتماد وسبباً، ولا يجعل المجموع سالباً", async () => {
    const { id } = await toRunning(c);
    const rid = await recordResponse(finance, id, base(), { kind: "FINANCIAL", data: financialSchema.parse({ financialType: "رسوم", amountDue: "500", amountDueBasis: "قرار" }) }, []);
    await addPayment(finance, rid, paymentSchema.parse({ amount: "500", paidAt: today(), receiptNumber: "A" }));
    await expect(addPayment(finance, rid, paymentSchema.parse({ amount: "-500", paidAt: today(), receiptNumber: "A-REV" }))).rejects.toThrow(/صلاحية/);
    await expect(addPayment(financeBoss, rid, paymentSchema.parse({ amount: "-500", paidAt: today(), receiptNumber: "A-REV" }))).rejects.toThrow(/سبب/);
    await expect(addPayment(financeBoss, rid, paymentSchema.parse({ amount: "-600", paidAt: today(), receiptNumber: "A-REV", overpaymentReason: "وصل مكرر" }))).rejects.toThrow(/سالباً/);
    await addPayment(financeBoss, rid, paymentSchema.parse({ amount: "-500", paidAt: today(), receiptNumber: "A-REV", overpaymentReason: "وصل مكرر خطأً" }));
    expect((await prisma.financialResponse.findUniqueOrThrow({ where: { responseId: rid } })).paymentStatus).toBe("UNPAID");
    expect(await prisma.auditLog.count({ where: { action: "payment.reversed" } })).toBeGreaterThan(0);
  });
});

describe("الاستجابة الفنية وإزالة المخالفة", () => {
  it("الرفع وحده لا يثبت الامتثال؛ عدم الكفاية يستأنف المدة؛ الإزالة تتطلب امتثالاً كاملاً واعتماداً ولا تُغلق الملف", async () => {
    const { id } = await toRunning(c);
    const rid = await recordResponse(c.tech, id, base(), { kind: "TECHNICAL", data: technicalResponseSchema.parse({ correctiveAction: "إيقاف البث على التردد المخالف", implementedAt: today() }) }, [{ name: "photo.pdf", data: SAMPLE_PDF }]);
    await expect(decideResponse(c.chair, rid, "ACCEPTED", null)).rejects.toThrow(/يتحقق القسم الفني/);
    await expect(recordRemoval(c.tech, id, removalSchema.parse({ description: "إزالة كاملة", treatedAt: today(), verifiedByName: "لجنة الكشف" }), [])).rejects.toThrow(/امتثال كامل/);
    await verifyTechnicalResponse(c.tech, rid, technicalVerifySchema.parse({ verificationResult: "تحقق جزئي بالكشف", compliance: "PARTIAL" }));
    await expect(decideResponse(c.chair, rid, "ACCEPTED", null)).rejects.toThrow(/امتثال كامل/);
    const v = await decideResponse(c.chair, rid, "PARTIALLY_ACCEPTED", "الإزالة غير مكتملة");
    expect(v.stage).toBe("DEADLINE_RUNNING");
    expect((await deadline(id)).status).not.toBe("STOPPED");

    const rid2 = await recordResponse(c.tech, id, base({ summary: "استجابة ثانية بعد الاستكمال" }), { kind: "TECHNICAL", data: technicalResponseSchema.parse({ correctiveAction: "إزالة الجهاز المخالف كلياً" }) }, []);
    expect(await prisma.response.count({ where: { violationId: id } })).toBe(2);
    await verifyTechnicalResponse(c.tech, rid2, technicalVerifySchema.parse({ verificationResult: "كشف لاحق يؤكد الإزالة", compliance: "FULL" }));
    const remId = await recordRemoval(c.tech, id, removalSchema.parse({ description: "إزالة كاملة للجهاز", treatedAt: today(), verifiedByName: "لجنة الكشف الفني" }), [{ name: "k.pdf", data: SAMPLE_PDF }]);
    await expect(decideRemoval(c.tech, remId, true, null)).rejects.toThrow(/صلاحية/);
    await decideRemoval(c.chair, remId, true, "معالجة مقبولة");
    const after = await prisma.violation.findUniqueOrThrow({ where: { id } });
    expect(after.stage).toBe("AWAITING_FINAL_VERIFICATION");
    expect(after.outcome).toBe("FULL_REMOVAL");
    expect(after.generalStatus).toBe("OPEN");
  });

  it("الاستجابة المرفوضة بعد انتهاء المدة تعيد المعاملة إلى «انتهت المدة»", async () => {
    const { id } = await toRunning(c);
    const rid = await recordResponse(c.tech, id, base(), { kind: "TECHNICAL", data: technicalResponseSchema.parse({ correctiveAction: "إجراء غير كافٍ" }) }, []);
    await verifyTechnicalResponse(c.tech, rid, technicalVerifySchema.parse({ verificationResult: "لم تتحقق الإزالة", compliance: "PARTIAL" }));
    const d = await deadline(id);
    await prisma.deadlineCalculation.update({ where: { id: d.id }, data: { dueDate: new Date(Date.now() - 3_600_000) } });
    await expect(decideResponse(c.chair, rid, "REJECTED", "")).rejects.toThrow(/أسباب/);
    const v = await decideResponse(c.chair, rid, "REJECTED", "غير كافية");
    expect(v.stage).toBe("DEADLINE_EXPIRED");
    expect((await deadline(id)).status).toBe("EXPIRED");
  });
});

describe("الاستجابة القانونية", () => {
  it("لا قرار قبل الرأي القانوني، والرأي يتطلب صلاحية", async () => {
    const { id } = await toRunning(c);
    const rid = await recordResponse(c.legal, id, base(), { kind: "LEGAL", data: legalResponseSchema.parse({ legalType: "دفع قانوني", content: "تدفع الجهة بعدم الاختصاص" }) }, []);
    await expect(decideResponse(c.chair, rid, "REJECTED", "سبب")).rejects.toThrow(/الرأي القانوني/);
    await expect(giveLegalOpinion(c.tech, rid, { legalOpinion: "رأي", proposedAction: null })).rejects.toThrow(/صلاحية/);
    await giveLegalOpinion(c.legal, rid, { legalOpinion: "الدفع غير منتج قانوناً", proposedAction: "رفض الدفع" });
    const v = await decideResponse(c.chair, rid, "REJECTED", "رُد الدفع");
    expect(v.stage).toBe("DEADLINE_RUNNING");
  });
});

describe("الاعتراضات والطعون", () => {
  it("لا يوقف المدة ولا يلغي المخالفة تلقائياً عند أثر «بقرار»؛ التعليق بقرار موثق ثم الاستمرار يزيح الاستحقاق", async () => {
    const { id } = await toRunning(c);
    const before = await deadline(id);
    const oid = await recordObjection(c.legal, id, objectionSchema.parse({ kind: "OBJECTION", submittedAt: today(), content: "اعتراض على وقائع المحضر" }), [{ name: "o.pdf", data: SAMPLE_PDF }]);
    expect(await stage(id)).toBe("OBJECTION_UNDER_REVIEW");
    expect((await deadline(id)).status).toBe(before.status); // لم تتوقف
    expect((await prisma.violation.findUniqueOrThrow({ where: { id } })).outcome).toBeNull();
    await expect(suspendForObjection(c.legal, oid, "")).rejects.toThrow(/سند/);
    await suspendForObjection(c.legal, oid, "قرار المدير القانوني بتعليق المدة لحين البت");
    expect((await deadline(id)).status).toBe("SUSPENDED");
    // المهمة المجدولة لا تُنهي مدة معلقة
    await refreshDeadlines(new Date(before.dueDate!.getTime() + 86_400_000));
    expect((await deadline(id)).status).toBe("SUSPENDED");
    await addObjectionEvent(c.legal, oid, { eventAt: today(), description: "كتاب إلى الجهة المختصة" }, []);
    await expect(decideObjection(c.legal, oid, objectionDecisionSchema.parse({ accepted: "no", outcome: "رد الاعتراض", effect: "END_FILE", effectOnFlow: "إنهاء" }))).rejects.toThrow(/مرفوض/);
    await decideObjection(c.legal, oid, objectionDecisionSchema.parse({ accepted: "no", outcome: "رد الاعتراض موضوعاً", effect: "CONTINUE", effectOnFlow: "استمرار المدة بعد إضافة مدة التعليق" }));
    const after = await deadline(id);
    expect(after.dueDate!.getTime()).toBe(before.dueDate!.getTime() + 86_400_000);
    expect(await stage(id)).toBe("DEADLINE_RUNNING");
  });

  it("أثر «تعليق» في القاعدة يعلّق المدة تلقائياً؛ وأثر «لا أثر» لا يجيز التعليق؛ وقبول الاعتراض بإنهاء المسار يحدد النتيجة دون إغلاق", async () => {
    const s = await toRunning(c, "T-SUSPEND", "SUSPEND");
    await recordObjection(c.legal, s.id, objectionSchema.parse({ kind: "APPEAL", submittedAt: today(), content: "طعن لدى الجهة المختصة", referenceNumber: "طعن/9" }), []);
    expect((await deadline(s.id)).status).toBe("SUSPENDED");

    const n = await toRunning(c, "T-NONE", "NONE");
    const oid = await recordObjection(c.legal, n.id, objectionSchema.parse({ kind: "OBJECTION", submittedAt: today(), content: "اعتراض" }), []);
    await expect(suspendForObjection(c.legal, oid, "قرار")).rejects.toThrow(/لا تجيز/);
    await expect(decideObjection(c.reg, oid, objectionDecisionSchema.parse({ accepted: "yes", outcome: "قبول الاعتراض", effect: "END_FILE", effectOnFlow: "إنهاء المسار" }))).rejects.toThrow(/صلاحية/);
    await decideObjection(c.legal, oid, objectionDecisionSchema.parse({ accepted: "yes", outcome: "قبول الاعتراض لثبوت الخطأ في الوقائع", effect: "END_FILE", effectOnFlow: "إنهاء المسار وإحالة الملف للتحقق النهائي" }));
    const v = await prisma.violation.findUniqueOrThrow({ where: { id: n.id } });
    expect(v.stage).toBe("AWAITING_FINAL_VERIFICATION");
    expect(v.outcome).toBe("OBJECTION_APPEAL");
    expect(v.generalStatus).toBe("OPEN");
  });
});
