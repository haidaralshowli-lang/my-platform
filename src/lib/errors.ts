/// خطأ أعمال يُعرض نصه للمستخدم. أي خطأ آخر يُسجل داخلياً ويُعرض بدلاً منه رسالة عامة.
export class AppError extends Error {
  constructor(
    message: string,
    public code: "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "CONFLICT" | "UNAUTHENTICATED" | "RATE_LIMITED" = "VALIDATION",
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const forbidden = (msg = "لا تملك صلاحية تنفيذ هذا الإجراء") => new AppError(msg, "FORBIDDEN");
export const notFound = (msg = "السجل المطلوب غير موجود أو خارج نطاق صلاحياتك") => new AppError(msg, "NOT_FOUND");

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

/// يحول أي خطأ إلى نتيجة آمنة للعرض دون كشف التفاصيل الداخلية
export function toActionError(err: unknown): { ok: false; error: string } {
  if (err instanceof AppError) return { ok: false, error: err.message };
  if (typeof err === "object" && err && "code" in err && (err as { code: string }).code === "P2002") {
    return { ok: false, error: "القيمة المدخلة مكررة ومستخدمة مسبقاً" };
  }
  if (typeof err === "object" && err && "digest" in err) throw err; // أخطاء next (redirect/notFound)
  console.error("[unexpected-error]", err instanceof Error ? err.message : err);
  return { ok: false, error: "حدث خطأ غير متوقع. يرجى المحاولة مجدداً أو مراجعة مدير النظام." };
}
