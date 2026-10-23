"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionActor, requestContext } from "@/lib/auth/server";
import { AppError, toActionError, type ActionResult } from "@/lib/errors";
import { decide, decideLegal, legalSchema, reviewTechnical, saveLegal, saveTechnical, submitLegal, submitTechnical, technicalSchema } from "@/lib/services/approvals";
import {
  addArticle, addLegalDocumentVersion, articleSchema, createLegalDocument, legalDocSchema, linkArticle, searchArticles, setLegalDocumentStatus, unlinkArticle,
} from "@/lib/services/legal-library";
import {
  cancelWarning, createTemplate, prepareWarning, prepareWarningSchema, setTemplateActive, signedSchema, templateSchema, updateTemplate, uploadSignedWarning,
} from "@/lib/services/warnings";
import type { IncomingFile } from "@/lib/services/attachments";
import { correctReceipt, dispatchSchema, receiptSchema, recordDispatch, recordReceipt } from "@/lib/services/deliveries";
import { addHoliday, applyRuleToPending, createRule, decideExtension, endRule, extensionSchema, recordExtension, removeHoliday, ruleSchema } from "@/lib/services/deadlines";
import { markRead } from "@/lib/services/notifications";
import {
  addPayment, decideRemoval, decideResponse, financialSchema, giveLegalOpinion, legalOpinionSchema, legalResponseSchema, paymentSchema, recordRemoval, recordResponse,
  removalSchema, responseBaseSchema, technicalResponseSchema, technicalVerifySchema, updateFinancial, verifyTechnicalResponse,
} from "@/lib/services/responses";
import {
  addCaseEvent, approveJudgment, caseDocSchema, caseEventSchema, caseUpdateSchema, decideNonResponse, initiateNonResponse, judgmentSchema, recordJudgment, recordReferral,
  updateCase, updateJudgmentStatus, uploadCaseDocuments,
} from "@/lib/services/criminal";
import { closureSchema, decideClosure, reopenViolation, requestClosure } from "@/lib/services/closure";
import { addObjectionEvent, decideObjection, objectionDecisionSchema, objectionSchema, recordObjection, suspendForObjection } from "@/lib/services/objections";

const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string) : "");
const strings = (f: FormData) => Object.fromEntries([...f.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;

async function files(form: FormData, field: string): Promise<IncomingFile[]> {
  const out: IncomingFile[] = [];
  for (const f of form.getAll(field)) if (f instanceof File && f.size > 0) out.push({ name: f.name, data: Buffer.from(await f.arrayBuffer()) });
  return out;
}

function done(path: string, message: string): ActionResult {
  revalidatePath(path);
  return { ok: true, message };
}

const DECISIONS = ["APPROVED", "RETURNED", "REJECTED", "CLARIFICATION_REQUESTED"] as const;

/// قرارات البوابات: المصادقة النهائية، الموافقة على الإنذار، المصادقة القانونية، مراجعة الموقف الفني
export async function gateDecisionAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = str(form, "violationId");
  const gate = str(form, "gate");
  const decision = str(form, "decision") as (typeof DECISIONS)[number];
  const notes = str(form, "notes") || null;
  const version = Number(str(form, "version"));
  try {
    if (!DECISIONS.includes(decision)) throw new AppError("قرار غير معروف");
    const actor = await actionActor();
    const ctx = await requestContext();
    if (gate === "final" || gate === "warning_issue") {
      if (decision === "CLARIFICATION_REQUESTED") throw new AppError("قرار غير متاح");
      await decide(actor, id, gate, decision, notes, version, ctx);
    } else if (gate === "legal") {
      await decideLegal(actor, id, decision, notes, version, ctx);
    } else if (gate === "technical_review") {
      if (decision !== "APPROVED" && decision !== "RETURNED") throw new AppError("قرار غير متاح");
      await reviewTechnical(actor, id, decision, notes, ctx);
    } else throw new AppError("بوابة غير معروفة");
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath(`/violations/${id}`);
  redirect(`/violations/${id}?done=decision`);
}

export async function assessmentAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = str(form, "violationId");
  const kind = str(form, "kind");
  const op = str(form, "op");
  try {
    const actor = await actionActor();
    const ctx = await requestContext();
    if (kind === "technical") {
      const parsed = technicalSchema.safeParse(strings(form));
      if (!parsed.success) return { ok: false, error: "يرجى تصحيح الحقول", fieldErrors: parsed.error.flatten().fieldErrors };
      await saveTechnical(actor, id, parsed.data, ctx);
      if (op === "submit") {
        const r = await submitTechnical(actor, id, ctx);
        revalidatePath(`/violations/${id}`);
        redirect(`/violations/${id}?done=${r === "APPROVED" ? "technical" : "technical_submitted"}`);
      }
    } else if (kind === "legal") {
      const parsed = legalSchema.safeParse(strings(form));
      if (!parsed.success) return { ok: false, error: "يرجى تصحيح الحقول", fieldErrors: parsed.error.flatten().fieldErrors };
      await saveLegal(actor, id, parsed.data, ctx);
      if (op === "submit") {
        await submitLegal(actor, id, ctx);
        revalidatePath(`/violations/${id}`);
        redirect(`/violations/${id}?done=legal_submitted`);
      }
    } else throw new AppError("نوع غير معروف");
    return done(`/violations/${id}`, "تم حفظ المسودة");
  } catch (e) {
    return toActionError(e);
  }
}

export type ArticleHit = { id: string; label: string; text: string; status: string };

export async function searchArticlesAction(q: string): Promise<ArticleHit[]> {
  const actor = await actionActor("legal_library.view");
  const rows = await searchArticles(actor, String(q ?? ""));
  return rows.map((a) => ({
    id: a.id,
    label: `${a.documentVersion.document.title}${a.documentVersion.document.number ? ` (${a.documentVersion.document.number})` : ""} — الإصدار ${a.documentVersion.versionNo} — المادة ${a.articleNumber}${a.paragraph ? ` / ${a.paragraph}` : ""}`,
    text: a.text.slice(0, 300),
    status: a.documentVersion.document.status,
  }));
}

export async function legalRefAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = str(form, "violationId");
  try {
    const actor = await actionActor();
    const ctx = await requestContext();
    if (str(form, "op") === "unlink") {
      await unlinkArticle(actor, str(form, "refId"), str(form, "reason"), ctx);
      return done(`/violations/${id}`, "أُزيل السند");
    }
    const purpose = str(form, "purpose");
    if (!["POTENTIAL", "TECHNICAL", "LEGAL", "WARNING"].includes(purpose)) throw new AppError("غرض غير معروف");
    await linkArticle(actor, id, str(form, "articleId"), purpose as "TECHNICAL", str(form, "note") || null, ctx);
    return done(`/violations/${id}`, "رُبطت المادة بالمخالفة");
  } catch (e) {
    return toActionError(e);
  }
}

export async function warningAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = str(form, "violationId");
  const op = str(form, "op");
  try {
    const actor = await actionActor();
    const ctx = await requestContext();
    if (op === "prepare") {
      const parsed = prepareWarningSchema.safeParse(strings(form));
      if (!parsed.success) return { ok: false, error: "يرجى تصحيح الحقول", fieldErrors: parsed.error.flatten().fieldErrors };
      await prepareWarning(actor, id, parsed.data, ctx);
    } else if (op === "cancel") {
      await cancelWarning(actor, str(form, "warningId"), str(form, "reason"), ctx);
    } else if (op === "signed") {
      const parsed = signedSchema.safeParse(strings(form));
      if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "بيانات التوقيع غير صحيحة" };
      const [file] = await files(form, "file");
      await uploadSignedWarning(actor, str(form, "warningId"), file, parsed.data, ctx);
    } else throw new AppError("إجراء غير معروف");
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath(`/violations/${id}`);
  redirect(`/violations/${id}?done=warning_${op}`);
}

// ─── المكتبة القانونية ───

export async function createLegalDocAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = legalDocSchema.safeParse(strings(form));
  if (!parsed.success) return { ok: false, error: "يرجى تصحيح الحقول", fieldErrors: parsed.error.flatten().fieldErrors };
  let docId: string;
  try {
    const actor = await actionActor("legal_library.manage");
    docId = await createLegalDocument(actor, parsed.data, { notes: str(form, "versionNotes") || null, extractedText: str(form, "extractedText") || null, files: await files(form, "files") }, await requestContext());
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/legal-library/${docId}`);
}

export async function legalDocAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const docId = str(form, "documentId");
  const op = str(form, "op");
  try {
    const actor = await actionActor("legal_library.manage");
    const ctx = await requestContext();
    if (op === "status") {
      await setLegalDocumentStatus(actor, docId, str(form, "status") as "IN_FORCE", str(form, "reason"), ctx);
    } else if (op === "version") {
      await addLegalDocumentVersion(actor, docId, { notes: str(form, "notes"), extractedText: str(form, "extractedText") || null, files: await files(form, "files") }, ctx);
    } else if (op === "article") {
      const parsed = articleSchema.safeParse(strings(form));
      if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "بيانات المادة غير صحيحة" };
      await addArticle(actor, str(form, "versionId"), parsed.data, ctx);
    } else throw new AppError("إجراء غير معروف");
    return done(`/legal-library/${docId}`, "تم الحفظ");
  } catch (e) {
    return toActionError(e);
  }
}

// ─── القوالب ───

export async function createTemplateAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = templateSchema.safeParse(strings(form));
  if (!parsed.success) return { ok: false, error: "يرجى تصحيح الحقول", fieldErrors: parsed.error.flatten().fieldErrors };
  let id: string;
  try {
    id = await createTemplate(await actionActor("template.manage"), parsed.data, await requestContext());
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/templates/${id}`);
}

export async function templateAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = str(form, "templateId");
  try {
    const actor = await actionActor("template.manage");
    const ctx = await requestContext();
    if (str(form, "op") === "toggle") await setTemplateActive(actor, id, str(form, "active") !== "true", ctx);
    else await updateTemplate(actor, id, { body: str(form, "body"), notes: str(form, "notes") }, ctx);
    return done(`/templates/${id}`, "تم الحفظ");
  } catch (e) {
    return toActionError(e);
  }
}

// ─── التبليغ والمدد ───


export async function deliveryAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = str(form, "violationId");
  const op = str(form, "op");
  try {
    const actor = await actionActor();
    const ctx = await requestContext();
    if (op === "dispatch") {
      const parsed = dispatchSchema.safeParse(strings(form));
      if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
      await recordDispatch(actor, str(form, "warningId"), parsed.data, ctx);
    } else if (op === "receipt") {
      const parsed = receiptSchema.safeParse(strings(form));
      if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
      const [f] = await files(form, "file");
      await recordReceipt(actor, str(form, "deliveryId"), parsed.data, f, ctx);
    } else if (op === "correct") {
      await correctReceipt(actor, str(form, "deliveryId"), { receivedDate: str(form, "receivedDate"), receivedTime: str(form, "receivedTime"), reason: str(form, "reason") }, ctx);
    } else if (op === "apply_rule") {
      await applyRuleToPending(actor, id, ctx);
    } else throw new AppError("إجراء غير معروف");
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath(`/violations/${id}`);
  redirect(`/violations/${id}?done=delivery_${op}`);
}

export async function extensionAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = str(form, "violationId");
  const op = str(form, "op");
  try {
    const actor = await actionActor();
    const ctx = await requestContext();
    if (op === "record") {
      const parsed = extensionSchema.safeParse(strings(form));
      if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
      await recordExtension(actor, id, parsed.data, await files(form, "files"), ctx);
    } else if (op === "approve" || op === "reject") {
      const days = str(form, "grantedDays");
      await decideExtension(actor, str(form, "requestId"), op === "approve", days ? Number(days) : null, str(form, "notes") || null, ctx);
    } else throw new AppError("إجراء غير معروف");
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath(`/violations/${id}`);
  redirect(`/violations/${id}?done=extension_${op}`);
}

export async function deadlineAdminAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const op = str(form, "op");
  try {
    const actor = await actionActor("deadline.rules_manage");
    const ctx = await requestContext();
    if (op === "rule") {
      const parsed = ruleSchema.safeParse(strings(form));
      if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
      await createRule(actor, parsed.data, ctx);
    } else if (op === "end_rule") await endRule(actor, str(form, "ruleId"), str(form, "effectiveTo"), str(form, "reason"), ctx);
    else if (op === "holiday") await addHoliday(actor, str(form, "date"), str(form, "nameAr"), ctx);
    else if (op === "remove_holiday") await removeHoliday(actor, str(form, "holidayId"), ctx);
    else throw new AppError("إجراء غير معروف");
    return done("/deadlines/rules", "تم الحفظ");
  } catch (e) {
    return toActionError(e);
  }
}

export async function markNotificationsAction(form: FormData): Promise<void> {
  const actor = await actionActor();
  const ids = form.getAll("id").map(String);
  await markRead(actor.id, ids.length ? ids : "all");
  revalidatePath("/notifications");
}

// ─── الاستجابات والإزالة والاعتراضات ───

function firstIssue(r: { success: false; error: { issues: { message: string }[] } }): ActionResult {
  return { ok: false, error: r.error.issues[0]?.message ?? "بيانات غير صحيحة" };
}

export async function responseAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = str(form, "violationId");
  const op = str(form, "op");
  const rid = str(form, "responseId");
  const f = strings(form);
  try {
    const actor = await actionActor();
    const ctx = await requestContext();
    if (op === "record") {
      const b = responseBaseSchema.safeParse(f);
      if (!b.success) return firstIssue(b);
      const kind = str(form, "kind");
      const schema = kind === "FINANCIAL" ? financialSchema : kind === "TECHNICAL" ? technicalResponseSchema : kind === "LEGAL" ? legalResponseSchema : null;
      if (!schema) throw new AppError("نوع الاستجابة غير معروف");
      const sp = schema.safeParse(f);
      if (!sp.success) return firstIssue(sp);
      await recordResponse(actor, id, b.data, { kind, data: sp.data } as Parameters<typeof recordResponse>[3], await files(form, "files"), ctx);
    } else if (op === "payment") {
      const p = paymentSchema.safeParse(f);
      if (!p.success) return firstIssue(p);
      await addPayment(actor, rid, p.data, ctx);
    } else if (op === "financial") {
      await updateFinancial(actor, rid, { amountDue: f.amountDue || null, amountDueBasis: f.amountDueBasis || null, auditResult: f.auditResult || null, reason: f.reason ?? "" }, ctx);
    } else if (op === "verify") {
      const p = technicalVerifySchema.safeParse(f);
      if (!p.success) return firstIssue(p);
      await verifyTechnicalResponse(actor, rid, p.data, ctx);
    } else if (op === "opinion") {
      const p = legalOpinionSchema.safeParse(f);
      if (!p.success) return firstIssue(p);
      await giveLegalOpinion(actor, rid, p.data, ctx);
    } else if (op === "decide") {
      const d = str(form, "decision");
      if (!["ACCEPTED", "PARTIALLY_ACCEPTED", "REJECTED"].includes(d)) throw new AppError("قرار غير معروف");
      await decideResponse(actor, rid, d as "ACCEPTED", f.notes || null, ctx);
    } else throw new AppError("إجراء غير معروف");
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath(`/violations/${id}`);
  redirect(`/violations/${id}?done=response_${op}`);
}

export async function removalAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = str(form, "violationId");
  const op = str(form, "op");
  try {
    const actor = await actionActor();
    const ctx = await requestContext();
    if (op === "record") {
      const p = removalSchema.safeParse(strings(form));
      if (!p.success) return firstIssue(p);
      await recordRemoval(actor, id, p.data, await files(form, "files"), ctx);
    } else if (op === "approve" || op === "reject") {
      await decideRemoval(actor, str(form, "removalId"), op === "approve", str(form, "notes") || null, ctx);
    } else throw new AppError("إجراء غير معروف");
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath(`/violations/${id}`);
  redirect(`/violations/${id}?done=removal_${op}`);
}

export async function objectionAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = str(form, "violationId");
  const op = str(form, "op");
  const oid = str(form, "objectionId");
  try {
    const actor = await actionActor();
    const ctx = await requestContext();
    if (op === "record") {
      const p = objectionSchema.safeParse(strings(form));
      if (!p.success) return firstIssue(p);
      await recordObjection(actor, id, p.data, await files(form, "files"), ctx);
    } else if (op === "suspend") await suspendForObjection(actor, oid, str(form, "reason"), ctx);
    else if (op === "event") await addObjectionEvent(actor, oid, { eventAt: str(form, "eventAt"), description: str(form, "description") }, await files(form, "files"), ctx);
    else if (op === "decide") {
      const p = objectionDecisionSchema.safeParse(strings(form));
      if (!p.success) return firstIssue(p);
      await decideObjection(actor, oid, p.data, ctx);
    } else throw new AppError("إجراء غير معروف");
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath(`/violations/${id}`);
  redirect(`/violations/${id}?done=objection_${op}`);
}

// ─── عدم الاستجابة والدعوى والإغلاق ───

export async function nonResponseAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = str(form, "violationId");
  const op = str(form, "op");
  let caseId: string | null = null;
  try {
    const actor = await actionActor();
    const ctx = await requestContext();
    const version = Number(str(form, "version"));
    if (op === "initiate") await initiateNonResponse(actor, id, str(form, "proof"), version, ctx);
    else if (op === "approve" || op === "return") caseId = await decideNonResponse(actor, id, op === "approve", str(form, "notes") || null, version, ctx);
    else throw new AppError("إجراء غير معروف");
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath(`/violations/${id}`);
  redirect(caseId ? `/criminal-cases/${caseId}?done=opened` : `/violations/${id}?done=nonresponse_${op}`);
}

export async function caseAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const caseId = str(form, "caseId");
  const op = str(form, "op");
  const f = strings(form);
  try {
    const actor = await actionActor();
    const ctx = await requestContext();
    if (op === "update") {
      const p = caseUpdateSchema.safeParse(f);
      if (!p.success) return firstIssue(p);
      await updateCase(actor, caseId, p.data, ctx);
    } else if (op === "referral") {
      const [file] = await files(form, "file");
      await recordReferral(actor, caseId, { referralAt: f.referralAt ?? "", letterNumber: f.letterNumber || null }, file, ctx);
    } else if (op === "event") {
      const p = caseEventSchema.safeParse(f);
      if (!p.success) return firstIssue(p);
      await addCaseEvent(actor, caseId, p.data, ctx);
    } else if (op === "docs") {
      const p = caseDocSchema.safeParse(f);
      if (!p.success) return firstIssue(p);
      await uploadCaseDocuments(actor, caseId, p.data, await files(form, "files"), ctx);
    } else if (op === "judgment") {
      const p = judgmentSchema.safeParse(f);
      if (!p.success) return firstIssue(p);
      const [file] = await files(form, "file");
      await recordJudgment(actor, caseId, p.data, file, ctx);
    } else if (op === "approve_judgment") {
      await approveJudgment(actor, str(form, "judgmentId"), ctx);
    } else if (op === "judgment_status") {
      const st = str(form, "proceduralStatus");
      if (!["UNKNOWN", "NOT_FINAL", "APPEALED", "FINAL"].includes(st)) throw new AppError("حالة غير معروفة");
      await updateJudgmentStatus(actor, str(form, "judgmentId"), st as "FINAL", str(form, "note"), ctx);
    } else throw new AppError("إجراء غير معروف");
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath(`/criminal-cases/${caseId}`);
  redirect(`/criminal-cases/${caseId}?done=${op}`);
}

export async function closureAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = str(form, "violationId");
  const op = str(form, "op");
  try {
    const actor = await actionActor();
    const ctx = await requestContext();
    if (op === "request") {
      const p = closureSchema.safeParse({ ...strings(form), supportingAttachmentIds: form.getAll("supportingAttachmentIds").map(String) });
      if (!p.success) return firstIssue(p);
      await requestClosure(actor, id, p.data, ctx);
    } else if (op === "approve" || op === "reject") {
      await decideClosure(actor, str(form, "requestId"), op === "approve", str(form, "notes") || null, ctx);
    } else if (op === "reopen") {
      await reopenViolation(actor, id, str(form, "reason"), ctx);
    } else throw new AppError("إجراء غير معروف");
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath(`/violations/${id}`);
  redirect(`/violations/${id}?done=closure_${op}`);
}
