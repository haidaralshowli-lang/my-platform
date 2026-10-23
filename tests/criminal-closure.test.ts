import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { refreshDeadlines } from "@/lib/services/deadlines";
import {
  addCaseEvent, approveJudgment, caseEventSchema, decideNonResponse, initiateNonResponse, judgmentSchema, recordJudgment, recordReferral, updateCase, caseUpdateSchema, updateJudgmentStatus, uploadCaseDocuments, caseDocSchema,
} from "@/lib/services/criminal";
import { closureSchema, decideClosure, reopenViolation, requestClosure } from "@/lib/services/closure";
import { decideResponse, financialSchema, paymentSchema, addPayment, recordResponse, responseBaseSchema, updateFinancial } from "@/lib/services/responses";
import { decide } from "@/lib/services/approvals";
import { createDraft, registerViolation, submitForApproval } from "@/lib/services/violations";
import { attachmentMetaSchema, uploadViolationAttachments } from "@/lib/services/attachments";
import { makeUser, SAMPLE_PDF, completeInput } from "./helpers";
import { makeCast, toRunning, type Cast } from "./flow";
import type { Actor } from "@/lib/rbac/actor";

let c: Cast;
let finance: Actor;
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad" }).format(new Date());
const ver = async (id: string) => (await prisma.violation.findUniqueOrThrow({ where: { id } })).version;
const stage = async (id: string) => (await prisma.violation.findUniqueOrThrow({ where: { id } })).stage;
const pdf = { name: "doc.pdf", data: SAMPLE_PDF };

async function toExpired() {
  const { id } = await toRunning(c);
  // مدة انتهت فعلاً بالوقت الحقيقي (شرط بدء الإجراء يقارن بالساعة الفعلية للخادم)
  const d = await prisma.deadlineCalculation.findFirstOrThrow({ where: { violationId: id, isCurrent: true } });
  await prisma.deadlineCalculation.update({ where: { id: d.id }, data: { dueDate: new Date(Date.now() - 3_600_000) } });
  await refreshDeadlines();
  expect(await stage(id)).toBe("DEADLINE_EXPIRED");
  return id;
}

beforeAll(async () => {
  c = await makeCast();
  finance = (await makeUser(["FINANCE"])).actor;
});

describe("عدم الاستجابة والدعوى الجزائية", () => {
  it("لا يبدأ الإجراء قبل انتهاء المدة، ويتطلب إثباتاً، وصلاحية، ولا يعتمده من بدأه", async () => {
    const { id: running } = await toRunning(c);
    await expect(initiateNonResponse(c.legal, running, "تحقق الموظف من عدم ورود أي استجابة", await ver(running))).rejects.toThrow(/لا يمكن تنفيذ/);
    const id = await toExpired();
    await expect(initiateNonResponse(c.reg, id, "إثبات عدم الاستجابة الكافي", await ver(id))).rejects.toThrow(/صلاحية/);
    await expect(initiateNonResponse(c.legal, id, "قصير", await ver(id))).rejects.toThrow(/إثبات/);
    await initiateNonResponse(c.legal, id, "تحقق الموظف من سجل الوارد: لا استجابة حتى انتهاء المدة", await ver(id));
    expect(await stage(id)).toBe("AWAITING_NON_RESPONSE_APPROVAL");
    // لم يُفتح أي ملف دعوى تلقائياً
    expect(await prisma.criminalCase.count({ where: { violationId: id } })).toBe(0);
    const legalWithApprove = { ...c.legal, permissions: new Set([...c.legal.permissions, "nonresponse.approve"]) };
    await expect(decideNonResponse(legalWithApprove, id, true, null, await ver(id))).rejects.toThrow(/من بدأ/);
  });

  it("المسار الكامل: اعتماد، ملف دعوى برقم مستقل، إحالة، إجراءات، حكم غير نهائي يمنع الإغلاق، ثم حكم قطعي وإغلاق وإعادة فتح", async () => {
    const id = await toExpired();
    await initiateNonResponse(c.legal, id, "تحقق الموظف من عدم ورود أي استجابة خلال المدة", await ver(id));
    const caseId = (await decideNonResponse(c.chair, id, true, "اعتماد عدم الاستجابة", await ver(id)))!;
    const v1 = await prisma.violation.findUniqueOrThrow({ where: { id } });
    expect(v1.stage).toBe("CRIMINAL_CASE");
    expect(v1.outcome).toBe("NON_RESPONSE_CRIMINAL");
    const cc = await prisma.criminalCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(cc.number).toMatch(/^دج-\d{4}-\d{4}$/);
    expect(cc.nonResponseProof).toContain("تحقق الموظف");
    expect(cc.warningId).not.toBeNull();
    // المراحل السابقة محفوظة
    expect(await prisma.violationStatusHistory.count({ where: { violationId: id } })).toBeGreaterThan(15);

    await expect(recordJudgment(c.legal, caseId, judgmentSchema.parse({ number: "1/ج/2026", judgmentDate: today(), courtName: "محكمة", summary: "منطوق الحكم", proceduralStatus: "UNKNOWN" }), pdf)).rejects.toThrow(/الإحالة/);
    await expect(recordReferral(c.legal, caseId, { referralAt: today(), letterNumber: "إحالة/5" }, undefined)).rejects.toThrow(/مستند الإحالة/);
    await recordReferral(c.legal, caseId, { referralAt: today(), letterNumber: "إحالة/5" }, pdf);
    expect(await stage(id)).toBe("AWAITING_JUDGMENT");
    await updateCase(c.legal, caseId, caseUpdateSchema.parse({ courtCaseNumber: "123/جنح/2026", courtName: "محكمة جنح الكرخ", followUpOwnerId: c.legal.id }));
    await addCaseEvent(c.legal, caseId, caseEventSchema.parse({ eventType: "جلسة", eventAt: today(), description: "تأجيل لتبليغ المتهم", nextHearingAt: "2027-01-10" }));
    await uploadCaseDocuments(c.legal, caseId, caseDocSchema.parse({ documentType: "CASE_CORRESPONDENCE", letterNumber: "ك/7", letterDate: today() }), [pdf]);
    const after = await prisma.criminalCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(after.status).toBe("IN_COURT");
    expect(after.lastAction).toContain("تأجيل");

    await expect(recordJudgment(c.legal, caseId, judgmentSchema.parse({ number: "9/ج/2026", judgmentDate: today(), courtName: "محكمة جنح الكرخ", summary: "منطوق", proceduralStatus: "NOT_FINAL" }), undefined)).rejects.toThrow(/نسخة/);
    const jId = await recordJudgment(c.legal, caseId, judgmentSchema.parse({ number: "9/ج/2026", judgmentDate: today(), courtName: "محكمة جنح الكرخ", summary: "الحكم بغرامة على الجهة", proceduralStatus: "NOT_FINAL" }), pdf);
    // يشترط اعتماد بيانات الحكم من غير مدخلها
    await expect(approveJudgment(c.legal, jId)).rejects.toThrow(/مدخلها/);
    await approveJudgment(c.legal2, jId);
    expect(await stage(id)).toBe("AWAITING_FINAL_VERIFICATION");

    const req = closureSchema.parse({ path: "CRIMINAL_CASE", finalOutcome: "NON_RESPONSE_CRIMINAL", reason: "اكتمال إجراءات الدعوى الجزائية" });
    await expect(requestClosure(c.legal, id, req)).rejects.toThrow(/الدرجة القطعية/);
    await updateJudgmentStatus(c.legal, jId, "APPEALED", "طعن الجهة تمييزاً");
    expect(await stage(id)).toBe("AWAITING_JUDGMENT");
    await approveJudgmentAgain();
    async function approveJudgmentAgain() {
      // الحكم معتمد مسبقاً؛ بعد قرار محكمة الطعن يُحدَّث إلى قطعي ويُعاد للتحقق النهائي بقيد حكم جديد
      const j2 = await recordJudgment(c.legal, caseId, judgmentSchema.parse({ number: "تمييز/3/2026", judgmentDate: today(), courtName: "محكمة التمييز", summary: "تصديق الحكم", proceduralStatus: "FINAL" }), pdf);
      await approveJudgment(c.legal2, j2);
    }
    expect(await stage(id)).toBe("AWAITING_FINAL_VERIFICATION");

    const rid = await requestClosure(c.legal, id, req);
    expect(await stage(id)).toBe("AWAITING_CLOSURE_APPROVAL");
    expect((await prisma.violation.findUniqueOrThrow({ where: { id } })).generalStatus).toBe("OPEN"); // لا يُعد مغلقاً قبل الاعتماد
    await expect(decideClosure(c.legal, rid, true, null)).rejects.toThrow(/صلاحية/);
    await decideClosure(c.chair, rid, true, "اعتماد الإغلاق");
    const closed = await prisma.violation.findUniqueOrThrow({ where: { id } });
    expect(closed.generalStatus).toBe("CLOSED");
    expect(closed.stage).toBe("CLOSED");
    expect((await prisma.criminalCase.findUniqueOrThrow({ where: { id: caseId } })).status).toBe("CLOSED");

    await expect(reopenViolation(c.legal, id, "ظهور وقائع جديدة تستدعي المراجعة")).rejects.toThrow(/صلاحية/);
    await expect(reopenViolation(c.chair, id, "قصير")).rejects.toThrow(/سبب/);
    await reopenViolation(c.chair, id, "ظهور وقائع جديدة تستدعي المراجعة");
    const re = await prisma.violation.findUniqueOrThrow({ where: { id } });
    expect(re.generalStatus).toBe("OPEN");
    expect(re.stage).toBe("AWAITING_FINAL_VERIFICATION");
    // سجل الإغلاق السابق محفوظ
    expect((await prisma.closureRequest.findUniqueOrThrow({ where: { id: rid } })).status).toBe("APPROVED");
    expect(await prisma.reopenRecord.count({ where: { violationId: id } })).toBe(1);
  });
});

describe("شروط الإغلاق", () => {
  it("إغلاق مسار الاستجابة: يتطلب تطابق النتيجة واستجابة مقبولة، ولا يعتمده مقدم الطلب، والرفض يعيده للتحقق", async () => {
    const { id } = await toRunning(c);
    const rid = await recordResponse(finance, id, responseBaseSchema.parse({ receivedAt: today(), summary: "تسديد الغرامة كاملة" }), { kind: "FINANCIAL", data: financialSchema.parse({ financialType: "غرامة", amountDue: "100", amountDueBasis: "قرار" }) }, []);
    await addPayment(finance, rid, paymentSchema.parse({ amount: "100", paidAt: today(), receiptNumber: "Z1" }));
    await updateFinancial(finance, rid, { amountDue: "100", amountDueBasis: "قرار", auditResult: "مطابق", reason: "" });
    await decideResponse(c.chair, rid, "ACCEPTED", null);
    await expect(requestClosure(c.legal, id, closureSchema.parse({ path: "RESPONSE", finalOutcome: "TECHNICAL_RESPONSE", reason: "اكتمال الاستجابة المالية" }))).rejects.toThrow(/لا تطابق/);
    await expect(requestClosure(c.legal, id, closureSchema.parse({ path: "CRIMINAL_CASE", finalOutcome: "FINANCIAL_RESPONSE", reason: "اكتمال الاستجابة المالية" }))).rejects.toThrow(/لا تتفق/);
    const chairBoth = { ...c.chair, permissions: new Set([...c.chair.permissions, "closure.request"]) };
    const req = await requestClosure(chairBoth, id, closureSchema.parse({ path: "RESPONSE", finalOutcome: "FINANCIAL_RESPONSE", reason: "اكتمال الاستجابة المالية والتسديد" }));
    await expect(decideClosure(chairBoth, req, true, null)).rejects.toThrow(/من طلبه/);
    const chair2 = (await makeUser(["CHAIRMAN"])).actor;
    await expect(decideClosure(chair2, req, false, "")).rejects.toThrow(/سبب/);
    await decideClosure(chair2, req, false, "يرجى إرفاق كتاب التسوية");
    expect(await stage(id)).toBe("AWAITING_FINAL_VERIFICATION");
    const req2 = await requestClosure(c.legal, id, closureSchema.parse({ path: "RESPONSE", finalOutcome: "FINANCIAL_RESPONSE", reason: "اكتمال الاستجابة المالية والتسديد" }));
    await decideClosure(c.chair, req2, true, null);
    const v = await prisma.violation.findUniqueOrThrow({ where: { id } });
    expect(v.generalStatus).toBe("CLOSED");
    expect(v.outcome).toBe("FINANCIAL_RESPONSE");
  });

  it("منع إغلاق ملف ناقص: لا إغلاق قبل التحقق النهائي، ومسار «أخرى» يتطلب مستنداً رسمياً", async () => {
    const { id } = await toRunning(c);
    await expect(requestClosure(c.legal, id, closureSchema.parse({ path: "OTHER", finalOutcome: "OTHER", reason: "سبب إغلاق بنتيجة أخرى" }))).rejects.toThrow(/التحقق النهائي.*مستند رسمي/);
  });

  it("إغلاق مخالفة لم تتم الموافقة عليها بمسار «عدم الموافقة»", async () => {
    const d = await createDraft(c.reg, await completeInput());
    await registerViolation(c.reg, d.id, d.version);
    await uploadViolationAttachments(c.reg, d.id, [pdf], attachmentMetaSchema.parse({ documentType: "VIOLATION_REPORT" }));
    await submitForApproval(c.reg, d.id, await ver(d.id));
    await decide(c.chair, d.id, "final", "REJECTED", "لا تشكل مخالفة", await ver(d.id));
    const req = await requestClosure(c.reg, d.id, closureSchema.parse({ path: "NOT_APPROVED", finalOutcome: "NOT_APPROVED", reason: "قرار رئيس الهيئة بعدم الموافقة" }));
    await decideClosure(c.chair, req, true, null);
    expect((await prisma.violation.findUniqueOrThrow({ where: { id: d.id } })).generalStatus).toBe("CLOSED");
  });
});
