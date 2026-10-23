"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionActor, requestContext } from "@/lib/auth/server";
import { AppError, toActionError, type ActionResult } from "@/lib/errors";
import {
  archiveDraft, createDraft, registerViolation, submitForApproval, updateViolation, violationInputSchema,
} from "@/lib/services/violations";
import {
  addAttachmentVersion, attachmentMetaSchema, uploadViolationAttachments, withdrawAttachment, type IncomingFile,
} from "@/lib/services/attachments";

function formObject(form: FormData) {
  const o: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") o[k] = v;
  return o;
}

export async function saveViolationAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = String(form.get("id") ?? "");
  const parsed = violationInputSchema.safeParse(formObject(form));
  if (!parsed.success) return { ok: false, error: "يرجى تصحيح الحقول المشار إليها", fieldErrors: parsed.error.flatten().fieldErrors };
  let targetId = id;
  try {
    const ctx = await requestContext();
    if (id) {
      const actor = await actionActor("violation.edit");
      await updateViolation(actor, id, parsed.data, Number(form.get("version")), String(form.get("editReason") ?? "") || null, ctx);
    } else {
      const actor = await actionActor("violation.create");
      targetId = (await createDraft(actor, parsed.data, ctx)).id;
    }
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath(`/violations/${targetId}`);
  redirect(`/violations/${targetId}?saved=1`);
}

export async function violationCommandAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = String(form.get("id"));
  const op = String(form.get("op"));
  const version = Number(form.get("version"));
  try {
    const actor = await actionActor();
    const ctx = await requestContext();
    switch (op) {
      case "register":
        await registerViolation(actor, id, version, ctx);
        break;
      case "submit":
        await submitForApproval(actor, id, version, ctx);
        break;
      case "archive":
        await archiveDraft(actor, id, String(form.get("reason") ?? ""), ctx);
        break;
      default:
        throw new AppError("إجراء غير معروف");
    }
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath(`/violations/${id}`);
  if (op === "archive") redirect("/violations?drafts=mine");
  // إعادة التوجيه تضمن ظهور رسالة النتيجة حتى لو لم يبقَ إجراء متاح بعد الانتقال
  redirect(`/violations/${id}?done=${op}`);
}

async function filesFrom(form: FormData, field: string): Promise<IncomingFile[]> {
  const out: IncomingFile[] = [];
  for (const f of form.getAll(field)) {
    if (f instanceof File && f.size > 0) out.push({ name: f.name, data: Buffer.from(await f.arrayBuffer()) });
  }
  return out;
}

export async function uploadAttachmentsAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = String(form.get("violationId"));
  const meta = attachmentMetaSchema.safeParse(formObject(form));
  if (!meta.success) return { ok: false, error: "يرجى تحديد نوع المستند", fieldErrors: meta.error.flatten().fieldErrors };
  try {
    const actor = await actionActor("attachment.upload");
    const n = await uploadViolationAttachments(actor, id, await filesFrom(form, "files"), meta.data, await requestContext());
    revalidatePath(`/violations/${id}`);
    return { ok: true, message: `تم رفع ${n.length} ملف بنجاح` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function attachmentCommandAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const violationId = String(form.get("violationId"));
  const attachmentId = String(form.get("attachmentId"));
  const op = String(form.get("op"));
  const reason = String(form.get("reason") ?? "");
  try {
    const actor = await actionActor();
    const ctx = await requestContext();
    if (op === "version") {
      const [file] = await filesFrom(form, "file");
      if (!file) throw new AppError("يرجى اختيار الملف");
      await addAttachmentVersion(actor, attachmentId, file, reason, ctx);
    } else if (op === "withdraw") {
      await withdrawAttachment(actor, attachmentId, reason, ctx);
    } else throw new AppError("إجراء غير معروف");
    revalidatePath(`/violations/${violationId}`);
    return { ok: true, message: op === "version" ? "تمت إضافة الإصدار الجديد مع الاحتفاظ بالسابق" : "تم سحب المرفق" };
  } catch (e) {
    return toActionError(e);
  }
}
