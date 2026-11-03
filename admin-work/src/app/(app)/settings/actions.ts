"use server";

import { revalidatePath } from "next/cache";
import { actionActor, requestContext } from "@/lib/auth/server";
import { AppError, toActionError, type ActionResult } from "@/lib/errors";
import { addListItem, updateListItem, updateSetting, type ListKind } from "@/lib/services/lists";
import { SETTING_DEFAULTS, type SettingKey } from "@/lib/settings";

const KINDS: ListKind[] = ["region", "authority"];

function kindOf(v: unknown): ListKind {
  if (!KINDS.includes(v as ListKind)) throw new AppError("نوع القائمة غير معروف");
  return v as ListKind;
}

export async function addItemAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const actor = await actionActor("lists.manage");
    await addListItem(actor, kindOf(form.get("kind")), String(form.get("name") ?? ""), await requestContext());
    revalidatePath("/settings");
    return { ok: true, message: "تمت الإضافة" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateItemAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const actor = await actionActor("lists.manage");
    const id = Number(form.get("id"));
    if (!Number.isInteger(id)) throw new AppError("معرف غير صالح");
    await updateListItem(actor, kindOf(form.get("kind")), id, { name: String(form.get("name") ?? ""), isActive: form.get("isActive") === "on" }, await requestContext());
    revalidatePath("/settings");
    return { ok: true, message: "تم الحفظ" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateSettingAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const actor = await actionActor("lists.manage");
    const key = String(form.get("key"));
    if (!(key in SETTING_DEFAULTS)) throw new AppError("إعداد غير معروف");
    await updateSetting(actor, key as SettingKey, Number(form.get("value")), await requestContext());
    revalidatePath("/settings");
    return { ok: true, message: "تم الحفظ" };
  } catch (e) {
    return toActionError(e);
  }
}
