"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authenticate, changeOwnPassword, revokeSessionByToken, SESSION_COOKIE } from "@/lib/auth/service";
import { getSession, requestContext } from "@/lib/auth/server";
import { AppError, toActionError, type ActionResult } from "@/lib/errors";

const loginSchema = z.object({
  username: z.string().trim().min(1, "اسم المستخدم مطلوب").max(60),
  password: z.string().min(1, "كلمة المرور مطلوبة").max(200),
});

export async function loginAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = loginSchema.safeParse({ username: form.get("username"), password: form.get("password") });
  if (!parsed.success) return { ok: false, error: "يرجى إدخال اسم المستخدم وكلمة المرور", fieldErrors: parsed.error.flatten().fieldErrors };
  let mustChange = false;
  try {
    const ctx = await requestContext();
    const { token, actor, expiresAt } = await authenticate({ ...parsed.data, ip: ctx.ip, userAgent: ctx.userAgent, requestId: ctx.requestId });
    (await cookies()).set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });
    mustChange = actor.mustChangePassword;
  } catch (e) {
    return toActionError(e);
  }
  redirect(mustChange ? "/change-password" : "/dashboard");
}

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const s = await getSession();
    await revokeSessionByToken(token, s?.actor ?? null, await requestContext());
  }
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

const changeSchema = z
  .object({
    current: z.string().min(1, "كلمة المرور الحالية مطلوبة"),
    next: z.string().min(1, "كلمة المرور الجديدة مطلوبة"),
    confirm: z.string(),
  })
  .refine((d) => d.next === d.confirm, { message: "تأكيد كلمة المرور غير مطابق", path: ["confirm"] });

export async function changePasswordAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = changeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: "يرجى تصحيح الحقول", fieldErrors: parsed.error.flatten().fieldErrors };
  try {
    const s = await getSession();
    if (!s) throw new AppError("انتهت الجلسة", "UNAUTHENTICATED");
    await changeOwnPassword(s.actor, s.sessionId, parsed.data, await requestContext());
  } catch (e) {
    return toActionError(e);
  }
  redirect("/dashboard");
}
