"use server";

import { revalidatePath } from "next/cache";
import { actionActor, requestContext } from "@/lib/auth/server";
import { toActionError, type ActionResult } from "@/lib/errors";
import { updateSetting, updateStageSla } from "@/lib/services/system-settings";
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


export async function systemSettingAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const actor = await actionActor("settings.manage");
    const ctx = await requestContext();
    if (form.get("op") === "sla") {
      const raw = String(form.get("slaDays") ?? "");
      await updateStageSla(actor, String(form.get("stage")), raw ? Number(raw) : null, ctx);
    } else {
      // مربعات الاختيار: غير المحدد لا يُرسل، فيُعد «false»؛ والاختيارات المتعددة تُجمع بفاصلة
      const values = form.getAll("value").map(String);
      const raw = form.get("bool") ? (values.length ? "true" : "false") : values.join(",");
      await updateSetting(actor, String(form.get("key")), raw, String(form.get("reason") ?? ""), ctx);
    }
    revalidatePath("/admin/system");
    return { ok: true, message: "تم الحفظ وسُجِّل التعديل في سجل التدقيق" };
  } catch (e) {
    return toActionError(e);
  }
}
