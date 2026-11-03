"use server";

import { revalidatePath } from "next/cache";
import { actionActor, requestContext } from "@/lib/auth/server";
import { toActionError, type ActionResult } from "@/lib/errors";
import { createUser, resetUserPassword, revokeUserSessions, setUserActive, updateUser } from "@/lib/services/users";

type Prev = ActionResult<{ tempPassword?: string; username?: string }> | null;

export async function createUserAction(_prev: Prev, form: FormData): Promise<NonNullable<Prev>> {
  try {
    const actor = await actionActor("users.manage");
    const { user, tempPassword } = await createUser(
      actor,
      {
        username: String(form.get("username") ?? ""),
        fullName: String(form.get("fullName") ?? ""),
        role: form.get("role") === "ADMIN" ? "ADMIN" : "COORDINATOR",
        permissions: form.getAll("permissions").map(String),
      },
      await requestContext(),
    );
    revalidatePath("/users");
    return { ok: true, data: { tempPassword, username: user.username }, message: "تم إنشاء الحساب" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateUserAction(userId: string, _prev: Prev, form: FormData): Promise<NonNullable<Prev>> {
  try {
    const actor = await actionActor("users.manage");
    await updateUser(actor, userId, { fullName: String(form.get("fullName") ?? ""), permissions: form.getAll("permissions").map(String) }, await requestContext());
    revalidatePath(`/users/${userId}`);
    return { ok: true, message: "تم حفظ التعديلات" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function setActiveAction(userId: string, active: boolean, _prev: Prev, form: FormData): Promise<NonNullable<Prev>> {
  try {
    const actor = await actionActor("users.manage");
    await setUserActive(actor, userId, active, String(form.get("reason") ?? ""), await requestContext());
    revalidatePath(`/users/${userId}`);
    return { ok: true, message: active ? "تم تفعيل الحساب" : "تم تعطيل الحساب وإنهاء جلساته" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function resetPasswordAction(userId: string): Promise<NonNullable<Prev>> {
  try {
    const actor = await actionActor("users.manage");
    const { tempPassword } = await resetUserPassword(actor, userId, await requestContext());
    revalidatePath(`/users/${userId}`);
    return { ok: true, data: { tempPassword }, message: "تم إصدار كلمة مرور مؤقتة جديدة" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function revokeSessionsAction(userId: string): Promise<NonNullable<Prev>> {
  try {
    const actor = await actionActor("users.manage");
    const n = await revokeUserSessions(actor, userId, await requestContext());
    revalidatePath(`/users/${userId}`);
    return { ok: true, message: `تم إنهاء ${n} جلسة` };
  } catch (e) {
    return toActionError(e);
  }
}
