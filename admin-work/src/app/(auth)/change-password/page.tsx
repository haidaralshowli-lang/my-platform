import { requireActor } from "@/lib/auth/server";
import { ChangePasswordForm } from "./form";

export const metadata = { title: "تغيير كلمة المرور" };

export default async function ChangePasswordPage() {
  const actor = await requireActor({ allowPasswordChange: true });
  return (
    <div className="w-full max-w-md rounded-lg border border-line bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-lg font-bold text-brand">تغيير كلمة المرور</h1>
      {actor.mustChangePassword && (
        <p className="mt-2 rounded-md bg-tone-warning-bg px-3 py-2 text-sm text-tone-warning">
          كلمة المرور الحالية مؤقتة. يجب تغييرها قبل متابعة استخدام المنصة.
        </p>
      )}
      <p className="mt-2 text-xs text-muted">12 حرفاً على الأقل، تتضمن حروفاً وأرقاماً، ولا تحتوي اسم المستخدم. سيتم إنهاء جلساتك الأخرى.</p>
      <ChangePasswordForm />
    </div>
  );
}
