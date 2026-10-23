// مساعد اختبار: يدفع مخالفة عبر المسار الحقيقي حتى مرحلة معينة باستخدام الخدمات نفسها
import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/rbac/actor";
import { createDraft, registerViolation, submitForApproval } from "@/lib/services/violations";
import { attachmentMetaSchema, uploadViolationAttachments } from "@/lib/services/attachments";
import { decide, decideLegal, saveLegal, saveTechnical, submitLegal, submitTechnical } from "@/lib/services/approvals";
import { addArticle, createLegalDocument, legalDocSchema, linkArticle, setLegalDocumentStatus } from "@/lib/services/legal-library";
import { createTemplate, prepareWarning, signedSchema, uploadSignedWarning } from "@/lib/services/warnings";
import { SAMPLE_PDF, completeInput, makeUser } from "./helpers";

export type Cast = Record<"reg" | "chair" | "tech" | "legal" | "legal2" | "delivery" | "manager" | "admin", Actor> & { articleId: string; templateId: string };

export async function makeCast(): Promise<Cast> {
  const c = {
    reg: (await makeUser(["REGISTRAR"])).actor, chair: (await makeUser(["CHAIRMAN"])).actor, tech: (await makeUser(["TECHNICAL"])).actor,
    legal: (await makeUser(["LEGAL"])).actor, legal2: (await makeUser(["LEGAL"])).actor, delivery: (await makeUser(["DELIVERY"])).actor,
    manager: (await makeUser(["BRANCH_MANAGER"])).actor, admin: (await makeUser(["SYSADMIN"])).actor,
  };
  const docId = await createLegalDocument(c.legal, legalDocSchema.parse({ title: `لائحة ${Date.now()}`, docType: "REGULATION" }), { files: [] });
  const v1 = await prisma.legalDocumentVersion.findFirstOrThrow({ where: { documentId: docId } });
  const articleId = await addArticle(c.legal, v1.id, { articleNumber: "5", paragraph: null, text: "نص" });
  await setLegalDocumentStatus(c.legal, docId, "IN_FORCE", "نافذة");
  const templateId = await createTemplate(c.legal, { name: `قالب ${Date.now()}${Math.random()}`, body: "إنذار {{warning.number}} إلى {{offender.name}} استناداً إلى {{legal.basis}}", notes: null });
  return { ...c, articleId, templateId };
}

const ver = async (id: string) => (await prisma.violation.findUniqueOrThrow({ where: { id } })).version;

/// ينشئ مخالفة ويوصلها إلى «بانتظار التبليغ» (إنذار موقع). يعيد معرفي المخالفة والإنذار.
export async function toAwaitingDelivery(c: Cast, overrides: Record<string, unknown> = {}): Promise<{ id: string; warningId: string }> {
  const d = await createDraft(c.reg, await completeInput(overrides));
  await registerViolation(c.reg, d.id, d.version);
  await uploadViolationAttachments(c.reg, d.id, [{ name: "m.pdf", data: SAMPLE_PDF }], attachmentMetaSchema.parse({ documentType: "VIOLATION_REPORT" }));
  await submitForApproval(c.reg, d.id, await ver(d.id));
  await decide(c.chair, d.id, "final", "APPROVED", null, await ver(d.id));
  await linkArticle(c.tech, d.id, c.articleId, "TECHNICAL", null);
  await saveTechnical(c.tech, d.id, { position: "موقف فني", reasons: "أسباب فنية", evidence: null, recommendation: null });
  await submitTechnical(c.tech, d.id);
  await saveLegal(c.legal, d.id, { opinion: "رأي قانوني", reasons: "أسباب قانونية", proposedAction: null, notes: null });
  await submitLegal(c.legal, d.id);
  await decideLegal(c.legal2, d.id, "APPROVED", null, await ver(d.id));
  await decide(c.chair, d.id, "warning_issue", "APPROVED", null, await ver(d.id));
  const warningId = await prepareWarning(c.legal, d.id, { templateId: c.templateId, requiredAction: "إزالة المخالفة", responsePeriodText: "عشرة أيام" });
  await uploadSignedWarning(c.delivery, warningId, { name: "s.pdf", data: SAMPLE_PDF }, signedSchema.parse({ signerName: "رئيس الهيئة", signedAt: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad" }).format(new Date()) }));
  return { id: d.id, warningId };
}

import { recordDispatch, recordReceipt, receiptSchema } from "@/lib/services/deliveries";

/// قاعدة مدة عامة للاختبار (تُنشأ مرة واحدة)
export async function ensureGeneralRule(c: Cast, objectionEffect: "NONE" | "SUSPEND" | "MANUAL_DECISION" = "MANUAL_DECISION", code = "T-GEN-RESP") {
  const existing = await prisma.legalDeadlineRule.findUnique({ where: { code } });
  if (existing) return existing;
  const vt = await prisma.violationType.create({ data: { code: `VT-${code}`, nameAr: `نوع ${code}` } });
  return prisma.legalDeadlineRule.create({
    data: {
      code, nameAr: `قاعدة ${code}`, violationTypeId: vt.id, duration: 10, unit: "CALENDAR_DAYS", startEvent: "RECEIPT_DATE", excludeHolidays: false,
      legalBasis: "سند اختبار", extensionAllowed: true, maxExtensionDays: 30, objectionEffect, warnBeforeDays: 2, effectiveFrom: new Date("2020-01-01"), createdById: c.admin.id,
    },
  });
}

/// يوصل المعاملة إلى «المدة القانونية سارية» (استلام اليوم) باستخدام قاعدة محددة
export async function toRunning(c: Cast, ruleCode = "T-GEN-RESP", objectionEffect: "NONE" | "SUSPEND" | "MANUAL_DECISION" = "MANUAL_DECISION") {
  const rule = await ensureGeneralRule(c, objectionEffect, ruleCode);
  const { id, warningId } = await toAwaitingDelivery(c, { violationTypeId: rule.violationTypeId });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad" }).format(new Date());
  const deliveryId = await recordDispatch(c.delivery, warningId, { sentAt: today, method: "HAND", notes: null });
  await recordReceipt(c.delivery, deliveryId, receiptSchema.parse({ receivedDate: today, recipientName: "مستلم الاختبار", receiptNumber: `R${Date.now()}${Math.random()}` }), { name: "r.pdf", data: SAMPLE_PDF });
  return { id, warningId };
}
