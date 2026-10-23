"use server";

import { revalidatePath } from "next/cache";
import { actionActor, requestContext } from "@/lib/auth/server";
import { toActionError, type ActionResult } from "@/lib/errors";
import { createReferenceItem, referenceItemSchema, REFERENCE_LISTS, updateReferenceItem, type ReferenceList } from "@/lib/services/reference";

export async function addReferenceAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = referenceItemSchema.safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  try {
    await createReferenceItem(await actionActor("reference.manage"), parsed.data, await requestContext());
    revalidatePath("/admin/settings");
    return { ok: true, message: "تمت الإضافة" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function editReferenceAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  const list = String(form.get("list")) as ReferenceList;
  if (!(list in REFERENCE_LISTS)) return { ok: false, error: "قائمة غير معروفة" };
  const op = String(form.get("op"));
  try {
    const actor = await actionActor("reference.manage");
    const patch =
      op === "toggle"
        ? { isActive: form.get("isActive") !== "true" }
        : { nameAr: String(form.get("nameAr") ?? ""), description: (form.get("description") as string | null) || null };
    await updateReferenceItem(actor, list, String(form.get("id")), patch, await requestContext());
    revalidatePath("/admin/settings");
    return { ok: true, message: "تم الحفظ" };
  } catch (e) {
    return toActionError(e);
  }
}
