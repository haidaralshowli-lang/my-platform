"use server";

import { revalidatePath } from "next/cache";
import { actionActor, requestContext } from "@/lib/auth/server";
import { toActionError, type ActionResult } from "@/lib/errors";
import {
  createUser, resetUserPassword, revokeUserSessions, setRolePermissions, setUserActive, updateUser, userInputSchema,
} from "@/lib/services/users";

function parseUserForm(form: FormData) {
  return userInputSchema.safeParse({
    username: form.get("username") ?? "",
    fullName: form.get("fullName"),
    email: form.get("email") ?? "",
    jobTitle: form.get("jobTitle") ?? "",
    scope: form.get("scope"),
    governorateId: form.get("governorateId") ?? "",
    officeId: form.get("officeId") ?? "",
    divisionId: form.get("divisionId") ?? "",
    roleIds: form.getAll("roleIds").map(String),
  });
}

export async function createUserAction(_p: ActionResult<{ tempPassword: string; id: string }> | null, form: FormData): Promise<ActionResult<{ tempPassword: string; id: string }>> {
  const parsed = parseUserForm(form);
  if (!parsed.success) return { ok: false, error: "يرجى تصحيح الحقول المشار إليها", fieldErrors: parsed.error.flatten().fieldErrors };
  try {
    const actor = await actionActor("users.manage");
    const r = await createUser(actor, parsed.data, await requestContext());
    revalidatePath("/admin/users");
    return { ok: true, data: r, message: "تم إنشاء الحساب" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateUserAction(_p: ActionResult<{ tempPassword: string; id: string }> | null, form: FormData): Promise<ActionResult<{ tempPassword: string; id: string }>> {
  const id = String(form.get("id"));
  const parsed = parseUserForm(form);
  if (!parsed.success) return { ok: false, error: "يرجى تصحيح الحقول المشار إليها", fieldErrors: parsed.error.flatten().fieldErrors };
  try {
    const actor = await actionActor("users.manage");
    await updateUser(actor, id, parsed.data, await requestContext());
    revalidatePath(`/admin/users/${id}`);
    return { ok: true, message: "تم حفظ التعديلات" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function userAdminAction(_p: ActionResult<{ tempPassword?: string }> | null, form: FormData): Promise<ActionResult<{ tempPassword?: string }>> {
  const id = String(form.get("id"));
  const op = String(form.get("op"));
  try {
    const actor = await actionActor("users.manage");
    const ctx = await requestContext();
    let result: ActionResult<{ tempPassword?: string }>;
    switch (op) {
      case "activate":
      case "deactivate":
        await setUserActive(actor, id, op === "activate", String(form.get("reason") ?? ""), ctx);
        result = { ok: true, message: op === "activate" ? "تم تفعيل الحساب" : "تم تعطيل الحساب وإنهاء جلساته" };
        break;
      case "reset":
        result = { ok: true, data: { tempPassword: await resetUserPassword(actor, id, ctx) }, message: "تم إصدار كلمة مرور مؤقتة" };
        break;
      case "revoke":
        result = { ok: true, message: `تم إنهاء ${await revokeUserSessions(actor, id, ctx)} جلسة` };
        break;
      default:
        return { ok: false, error: "إجراء غير معروف" };
    }
    revalidatePath(`/admin/users/${id}`);
    return result;
  } catch (e) {
    return toActionError(e);
  }
}

export async function setRolePermissionsAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const actor = await actionActor("roles.manage");
    await setRolePermissions(actor, String(form.get("roleId")), form.getAll("perm").map(String), await requestContext());
    revalidatePath("/admin/roles");
    return { ok: true, message: "تم حفظ صلاحيات الدور" };
  } catch (e) {
    return toActionError(e);
  }
}
