import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/server";
import { LoginForm } from "./login-form";

export const metadata = { title: "تسجيل الدخول" };

export default async function LoginPage() {
  if (await getSession()) redirect("/dashboard");
  return (
    <div className="w-full max-w-sm rounded-lg border border-line bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-lg font-bold text-brand">تسجيل الدخول</h1>
      <p className="mt-1 text-sm text-muted">استخدم حسابك الوظيفي المعتمد.</p>
      <LoginForm />
    </div>
  );
}
