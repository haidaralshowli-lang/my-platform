import { requirePagePermission } from "@/lib/auth/server";
import { Card, PageHeader } from "@/components/ui";
import { createUserAction } from "../actions";
import { orgOptions } from "../data";
import { UserForm } from "../user-form";

export const metadata = { title: "إنشاء حساب" };

export default async function NewUserPage() {
  await requirePagePermission("users.manage");
  const opts = await orgOptions();
  return (
    <>
      <PageHeader title="إنشاء حساب مستخدم" description="تُولَّد كلمة مرور مؤقتة عشوائية، ويُلزم الموظف بتغييرها عند أول دخول." />
      <Card><UserForm action={createUserAction} {...opts} submitLabel="إنشاء الحساب" /></Card>
    </>
  );
}
