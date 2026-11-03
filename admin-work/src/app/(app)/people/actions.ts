"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionActor, requestContext } from "@/lib/auth/server";
import { AppError, toActionError, type ActionResult } from "@/lib/errors";
import {
  createPerson,
  deletePerson,
  findSimilar,
  markDistinct,
  mergePeople,
  restorePerson,
  updatePerson,
  type PersonInput,
  type SimilarPerson,
} from "@/lib/services/people";
import { commitImport, MAX_IMPORT_BYTES, previewImport, type ImportPreview } from "@/lib/services/people-excel";

function formToInput(form: FormData): PersonInput {
  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : undefined;
  };
  return {
    fullName: str("fullName") ?? "",
    phone: str("phone"),
    regionId: str("regionId") ? Number(str("regionId")) : null,
    followUpOwnerId: str("followUpOwnerId") || null,
    engagementLevel: (str("engagementLevel") as PersonInput["engagementLevel"]) || "NONE",
    availableForWork: form.get("availableForWork") === "on",
    needsUpdate: form.get("needsUpdate") === "on",
    notes: str("notes"),
    confirmDistinct: form.get("confirmDistinct") === "on",
  };
}

function zodFieldErrors(e: unknown) {
  if (e && typeof e === "object" && "issues" in e && Array.isArray((e as { issues: unknown[] }).issues)) {
    const fe: Record<string, string[]> = {};
    for (const i of (e as { issues: { path: (string | number)[]; message: string }[] }).issues) {
      const k = String(i.path[0] ?? "form");
      (fe[k] ??= []).push(i.message);
    }
    return { ok: false as const, error: "يرجى تصحيح الحقول المشار إليها", fieldErrors: fe };
  }
  return null;
}

export async function createPersonAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  let id: string;
  try {
    const actor = await actionActor("people.create");
    const p = await createPerson(actor, formToInput(form), await requestContext());
    id = p.id;
    revalidatePath("/people");
  } catch (e) {
    return zodFieldErrors(e) ?? toActionError(e);
  }
  redirect(`/people/${id}?created=1`);
}

export async function updatePersonAction(id: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const actor = await actionActor("people.edit");
    await updatePerson(actor, id, formToInput(form), await requestContext());
    revalidatePath(`/people/${id}`);
    return { ok: true, message: "تم حفظ التعديلات" };
  } catch (e) {
    return zodFieldErrors(e) ?? toActionError(e);
  }
}

export async function similarAction(name: string, excludeId?: string): Promise<SimilarPerson[]> {
  await actionActor("people.view");
  return findSimilar(String(name).slice(0, 150), { excludeId });
}

export async function deletePersonAction(id: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const actor = await actionActor("people.delete");
    await deletePerson(actor, id, String(form.get("reason") ?? ""), await requestContext());
    revalidatePath("/people");
  } catch (e) {
    return toActionError(e);
  }
  redirect("/people?deleted=1");
}

export async function restorePersonAction(id: string): Promise<ActionResult> {
  try {
    const actor = await actionActor("people.delete");
    await restorePerson(actor, id, await requestContext());
    revalidatePath("/people/deleted");
    return { ok: true, message: "تمت استعادة السجل" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function mergeAction(primaryId: string, duplicateId: string): Promise<ActionResult> {
  try {
    const actor = await actionActor("people.merge");
    await mergePeople(actor, primaryId, duplicateId, await requestContext());
    revalidatePath("/people/duplicates");
    return { ok: true, message: "تم الدمج" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function distinctAction(a: string, b: string): Promise<ActionResult> {
  try {
    const actor = await actionActor("people.edit");
    await markDistinct(actor, a, b, await requestContext());
    revalidatePath("/people/duplicates");
    return { ok: true, message: "تم الحفظ: لن يظهر هذا الزوج مجدداً" };
  } catch (e) {
    return toActionError(e);
  }
}

export type ImportState =
  | { ok: true; mode: "preview"; preview: ImportPreview }
  | { ok: true; mode: "commit"; created: number; preview: ImportPreview }
  | { ok: false; error: string }
  | null;

export async function importAction(_prev: ImportState, form: FormData): Promise<ImportState> {
  try {
    const actor = await actionActor("people.import");
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppError("يرجى اختيار ملف Excel");
    if (file.size > MAX_IMPORT_BYTES) throw new AppError("حجم الملف يتجاوز 5 ميغابايت");
    const buf = Buffer.from(await file.arrayBuffer());
    const allowNameMatches = form.get("allowNameMatches") === "on";
    if (form.get("mode") === "commit") {
      const { created, preview } = await commitImport(actor, buf, file.name, allowNameMatches, await requestContext());
      revalidatePath("/people");
      return { ok: true, mode: "commit", created, preview };
    }
    return { ok: true, mode: "preview", preview: await previewImport(actor, buf, allowNameMatches) };
  } catch (e) {
    return toActionError(e);
  }
}
