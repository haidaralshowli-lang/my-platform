import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/server";
import { can } from "@/lib/rbac";

/// الصفحة الافتتاحية بعد الدخول: لوحة المتابعة لمن يملك صلاحيتها، وإلا الصفحة الرئيسية
export default async function Root() {
  const actor = await requireActor();
  redirect(can(actor, "dashboard.view") ? "/dashboard" : "/home");
}
