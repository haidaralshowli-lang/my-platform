import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/rbac/actor";
import { createDraft, registerViolation, submitForApproval } from "@/lib/services/violations";
import { attachmentMetaSchema, uploadViolationAttachments } from "@/lib/services/attachments";
import { decide, decideLegal, reviewTechnical, saveLegal, saveTechnical, submitLegal, submitTechnical } from "@/lib/services/approvals";
import { addArticle, addLegalDocumentVersion, createLegalDocument, legalDocSchema, linkArticle, setLegalDocumentStatus } from "@/lib/services/legal-library";
import { cancelWarning, createTemplate, prepareWarning, renderTemplate, templateErrors, updateTemplate, uploadSignedWarning, signedSchema } from "@/lib/services/warnings";
import { SAMPLE_PDF, completeInput, makeUser } from "./helpers";

let reg: Actor, chair: Actor, tech: Actor, tech2: Actor, legal: Actor, legal2: Actor, admin: Actor, delivery: Actor;
let articleId: string, draftDocArticleId: string, templateId: string;

const TEMPLATE = "إنذار رقم {{warning.number}} بتاريخ {{warning.date}}\nإلى {{offender.name}}\nاستناداً إلى {{legal.basis}} بشأن المخالفة {{violation.number}}\nالمطلوب: {{required.action}} خلال {{response.period}}\n{{issuer}}";

beforeAll(async () => {
  reg = (await makeUser(["REGISTRAR"])).actor;
  chair = (await makeUser(["CHAIRMAN"])).actor;
  tech = (await makeUser(["TECHNICAL"])).actor;
  tech2 = (await makeUser(["TECHNICAL"])).actor;
  legal = (await makeUser(["LEGAL"])).actor;
  legal2 = (await makeUser(["LEGAL"])).actor;
  admin = (await makeUser(["SYSADMIN"])).actor;
  delivery = (await makeUser(["DELIVERY"])).actor;
  const docId = await createLegalDocument(legal, legalDocSchema.parse({ title: "لائحة اختبار البث", docType: "REGULATION", number: "7" }), { files: [{ name: "lv.pdf", data: SAMPLE_PDF }] });
  const v1 = await prisma.legalDocumentVersion.findFirstOrThrow({ where: { documentId: docId } });
  articleId = await addArticle(legal, v1.id, { articleNumber: "12", paragraph: "ثانياً", text: "نص مادة اختبارية" });
  const draftDoc = await createLegalDocument(legal, legalDocSchema.parse({ title: "مسودة لائحة", docType: "REGULATION" }), { files: [] });
  const dv = await prisma.legalDocumentVersion.findFirstOrThrow({ where: { documentId: draftDoc } });
  draftDocArticleId = await addArticle(legal, dv.id, { articleNumber: "1", paragraph: null, text: "مادة في وثيقة غير معتمدة" });
  await setLegalDocumentStatus(legal, docId, "IN_FORCE", "منشورة في الجريدة الرسمية");
  templateId = await createTemplate(legal, { name: `قالب اختبار ${Date.now()}`, body: TEMPLATE, notes: null });
});

async function toFinalApproval() {
  const d = await createDraft(reg, await completeInput());
  await registerViolation(reg, d.id, d.version);
  await uploadViolationAttachments(reg, d.id, [{ name: "m.pdf", data: SAMPLE_PDF }], attachmentMetaSchema.parse({ documentType: "VIOLATION_REPORT" }));
  const v = await prisma.violation.findUniqueOrThrow({ where: { id: d.id } });
  return submitForApproval(reg, d.id, v.version);
}

const ver = async (id: string) => (await prisma.violation.findUniqueOrThrow({ where: { id } })).version;

async function toLegal() {
  const v = await toFinalApproval();
  await decide(chair, v.id, "final", "APPROVED", "مصادق", v.version);
  await linkArticle(tech, v.id, articleId, "TECHNICAL", null);
  await saveTechnical(tech, v.id, { position: "الموقف الفني الكامل", reasons: "أسباب فنية كافية", evidence: null, recommendation: null });
  await submitTechnical(tech, v.id);
  return v.id;
}

async function toWarningPreparation() {
  const id = await toLegal();
  await saveLegal(legal, id, { opinion: "رأي قانوني مفصل", reasons: "أسباب قانونية", proposedAction: "إنذار", notes: null });
  await submitLegal(legal, id);
  await decideLegal(legal2, id, "APPROVED", null, await ver(id));
  await decide(chair, id, "warning_issue", "APPROVED", null, await ver(id));
  return id;
}

describe("المصادقة النهائية", () => {
  it("موظف التسجيل ومدير النظام والفني لا يصادقون؛ رئيس الهيئة يصادق ويُسجَّل القرار", async () => {
    const v = await toFinalApproval();
    for (const a of [reg, admin, tech]) await expect(decide(a, v.id, "final", "APPROVED", null, v.version)).rejects.toThrow();
    const r = await decide(chair, v.id, "final", "APPROVED", "مستوفية", v.version);
    expect(r.stage).toBe("AWAITING_TECHNICAL");
    const ap = await prisma.approval.findFirstOrThrow({ where: { violationId: v.id, kind: "FINAL_REGISTRATION" } });
    expect(ap.decidedById).toBe(chair.id);
    expect(ap.decidedRole).toContain("CHAIRMAN");
  });

  it("الإعادة والرفض يتطلبان سبباً؛ الإعادة تتيح التعديل، والرفض يحدد النتيجة دون إغلاق", async () => {
    const v = await toFinalApproval();
    await expect(decide(chair, v.id, "final", "RETURNED", "", v.version)).rejects.toThrow(/السبب/);
    const r = await decide(chair, v.id, "final", "RETURNED", "إرفاق صور إضافية", v.version);
    expect(r.stage).toBe("REGISTERED");
    const v2 = await toFinalApproval();
    const rj = await decide(chair, v2.id, "final", "REJECTED", "لا تشكل مخالفة", v2.version);
    expect(rj.stage).toBe("NOT_APPROVED");
    expect(rj.outcome).toBe("NOT_APPROVED");
    expect(rj.generalStatus).toBe("OPEN");
  });

  it("سجل المصادقات غير قابل للتعديل في قاعدة البيانات", async () => {
    const ap = await prisma.approval.findFirstOrThrow();
    await expect(prisma.approval.update({ where: { id: ap.id }, data: { notes: "عبث" } })).rejects.toThrow();
  });
});

describe("الموقف الفني والمكتبة القانونية", () => {
  it("لا يُقدَّم الموقف الفني دون سند من المكتبة، ولا يُستند إلى وثيقة غير معتمدة", async () => {
    const v = await toFinalApproval();
    await decide(chair, v.id, "final", "APPROVED", null, v.version);
    await saveTechnical(tech, v.id, { position: "موقف فني", reasons: "أسباب الموقف", evidence: null, recommendation: null });
    await expect(submitTechnical(tech, v.id)).rejects.toThrow(/مادة واحدة/);
    await expect(linkArticle(tech, v.id, draftDocArticleId, "TECHNICAL", null)).rejects.toThrow(/غير معتمدة/);
    await expect(linkArticle(reg, v.id, articleId, "TECHNICAL", null)).rejects.toThrow(/صلاحية/);
    await linkArticle(tech, v.id, articleId, "TECHNICAL", "تنطبق الفقرة ثانياً");
    expect(await submitTechnical(tech, v.id)).toBe("APPROVED");
    expect((await prisma.violation.findUniqueOrThrow({ where: { id: v.id } })).stage).toBe("AWAITING_LEGAL");
  });

  it("الإصدار الجديد للائحة لا يغير الإصدار الذي استند إليه الموظف", async () => {
    const id = await toLegal();
    const art = await prisma.legalArticle.findUniqueOrThrow({ where: { id: articleId }, include: { documentVersion: true } });
    await addLegalDocumentVersion(legal, art.documentVersion.documentId, { notes: "تعديل 2026", files: [] });
    const ref = await prisma.violationLegalReference.findFirstOrThrow({ where: { violationId: id }, include: { article: { include: { documentVersion: true } } } });
    expect(ref.article.documentVersion.versionNo).toBe(1);
  });

  it("عند اشتراط المراجعة الفنية: المعد لا يصادق على موقفه، ويصادق زميله", async () => {
    await prisma.systemSetting.upsert({ where: { key: "workflow.requireTechnicalReview" }, update: { value: true }, create: { key: "workflow.requireTechnicalReview", value: true } });
    try {
      const v = await toFinalApproval();
      await decide(chair, v.id, "final", "APPROVED", null, v.version);
      await linkArticle(tech, v.id, articleId, "TECHNICAL", null);
      await saveTechnical(tech, v.id, { position: "موقف فني", reasons: "أسباب الموقف", evidence: null, recommendation: null });
      expect(await submitTechnical(tech, v.id)).toBe("SUBMITTED");
      await expect(reviewTechnical(tech, v.id, "APPROVED", null)).rejects.toThrow(/بنفسه/);
      await reviewTechnical(tech2, v.id, "APPROVED", "موافق");
      expect((await prisma.violation.findUniqueOrThrow({ where: { id: v.id } })).stage).toBe("AWAITING_LEGAL");
    } finally {
      await prisma.systemSetting.delete({ where: { key: "workflow.requireTechnicalReview" } });
    }
  });
});

describe("المصادقة القانونية", () => {
  it("الفني لا يملك المصادقة القانونية، ولا قرار قبل تقديم الرأي", async () => {
    const id = await toLegal();
    await expect(decideLegal(tech, id, "APPROVED", null, await ver(id))).rejects.toThrow(/صلاحية/);
    await expect(decideLegal(legal, id, "APPROVED", null, await ver(id))).rejects.toThrow(/مقدم/);
  });

  it("طلب الإيضاح يعيد المعاملة للقسم الفني الذي يعد موقفاً جديداً مع بقاء السابق", async () => {
    const id = await toLegal();
    await saveLegal(legal, id, { opinion: "رأي أولي مفصل", reasons: "يحتاج إيضاحاً", proposedAction: null, notes: null });
    await submitLegal(legal, id);
    const r = await decideLegal(legal2, id, "CLARIFICATION_REQUESTED", "يرجى توضيح القياسات", await ver(id));
    expect(r.stage).toBe("AWAITING_TECHNICAL");
    await saveTechnical(tech, id, { position: "موقف فني موضح", reasons: "قياسات مفصلة", evidence: "تقرير القياس", recommendation: null });
    await submitTechnical(tech, id);
    expect(await prisma.technicalAssessment.count({ where: { violationId: id } })).toBe(2);
  });

  it("المصادقة الثانية: معد الرأي لا يصادق عليه عند اشتراطها", async () => {
    await prisma.systemSetting.upsert({ where: { key: "workflow.requireLegalSecondApproval" }, update: { value: true }, create: { key: "workflow.requireLegalSecondApproval", value: true } });
    try {
      const id = await toLegal();
      await saveLegal(legal, id, { opinion: "رأي قانوني", reasons: "أسباب قانونية", proposedAction: null, notes: null });
      await submitLegal(legal, id);
      await expect(decideLegal(legal, id, "APPROVED", null, await ver(id))).rejects.toThrow(/غير معده/);
      await decideLegal(legal2, id, "APPROVED", null, await ver(id));
    } finally {
      await prisma.systemSetting.delete({ where: { key: "workflow.requireLegalSecondApproval" } });
    }
  });
});

describe("الإنذار", () => {
  it("القالب يرفض الحقول المجهولة، والتعبئة لا تفسر المدخلات كأوامر", () => {
    expect(templateErrors("{{offender.name}} {{evil}}")).toEqual(["حقل غير معروف: {{evil}}"]);
    const out = renderTemplate("{{offender.name}}", { "offender.name": "<script>x</script>" } as never);
    expect(out).toBe("<script>x</script>"); // نص خام؛ يُهرَّب عند العرض
  });

  it("لا يُعد إنذار قبل الموافقة على إصداره", async () => {
    const id = await toLegal();
    await expect(prepareWarning(legal, id, { templateId, requiredAction: "إيقاف البث المخالف", responsePeriodText: "عشرة أيام" })).rejects.toThrow(/مرحلة إعداد الإنذار/);
  });

  it("المسار الكامل: إعداد الإنذار بلقطة ثابتة، وإلغاؤه، وإعادة إعداده، ثم رفع النسخة الموقعة", async () => {
    const id = await toWarningPreparation();
    const wId = await prepareWarning(legal, id, { templateId, requiredAction: "إيقاف البث المخالف", responsePeriodText: "عشرة أيام من تاريخ التبليغ" });
    const w = await prisma.warning.findUniqueOrThrow({ where: { id: wId } });
    expect(w.number).toMatch(/^إن-\d{4}-\d{5}$/);
    expect(w.renderedBody).toContain("المادة (12) الفقرة (ثانياً) من لائحة اختبار البث رقم (7)");
    expect(w.renderedBody).not.toContain("{{");
    // تعديل القالب لاحقاً لا يغير نص الإنذار الصادر
    await updateTemplate(legal, templateId, { body: TEMPLATE + "\nسطر جديد", notes: "تحديث" });
    expect((await prisma.warning.findUniqueOrThrow({ where: { id: wId } })).renderedBody).toBe(w.renderedBody);

    await cancelWarning(legal, wId, "خطأ في الإجراء المطلوب");
    expect((await prisma.violation.findUniqueOrThrow({ where: { id } })).stage).toBe("WARNING_PREPARATION");
    const w2 = await prepareWarning(legal, id, { templateId, requiredAction: "إيقاف البث فوراً", responsePeriodText: "عشرة أيام" });

    const signed = signedSchema.parse({ signerName: "رئيس الهيئة", signedAt: new Date().toISOString().slice(0, 10) });
    await expect(uploadSignedWarning(delivery, w2, undefined, signed)).rejects.toThrow(/النسخة الضوئية/);
    await expect(uploadSignedWarning(reg, w2, { name: "s.pdf", data: SAMPLE_PDF }, signed)).rejects.toThrow(/صلاحية/);
    await uploadSignedWarning(delivery, w2, { name: "signed.pdf", data: SAMPLE_PDF }, signed);
    const done = await prisma.warning.findUniqueOrThrow({ where: { id: w2 } });
    expect(done.status).toBe("SIGNED");
    expect(done.signedAttachmentId).not.toBeNull();
    expect((await prisma.violation.findUniqueOrThrow({ where: { id } })).stage).toBe("AWAITING_DELIVERY");
    const hist = await prisma.violationStatusHistory.findMany({ where: { violationId: id }, orderBy: { createdAt: "asc" }, select: { toStage: true } });
    expect(hist.map((h) => h.toStage)).toEqual([
      "DRAFT", "REGISTERED", "AWAITING_REPORT", "REGISTERED", "AWAITING_FINAL_APPROVAL", "AWAITING_TECHNICAL", "AWAITING_LEGAL",
      "AWAITING_WARNING_APPROVAL", "WARNING_PREPARATION", "AWAITING_WARNING_SIGNATURE", "WARNING_PREPARATION", "AWAITING_WARNING_SIGNATURE", "AWAITING_DELIVERY",
    ]);
  });
});
