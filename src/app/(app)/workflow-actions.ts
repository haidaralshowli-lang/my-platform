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
