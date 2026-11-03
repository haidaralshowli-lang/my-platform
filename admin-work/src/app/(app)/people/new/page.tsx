import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/server";
import { personFormOptions } from "@/lib/services/people";
import { Card, PageHeader } from "@/components/ui";
import { createPersonAction } from "../actions";
import { PersonForm } from "../person-form";

export const metadata = { title: "إضافة شخص" };

export default async function NewPersonPage() {
  await requirePagePermission("people.create");
  const { regions, owners } = await personFormOptions();
  return (
    <>
      <PageHeader
        title="إضافة شخص"
        description="يُمنح السجل رقماً تسلسلياً تلقائياً عند الحفظ."
        actions={
          <Link href="/people" className="text-sm text-brand hover:underline">
            ← العودة إلى القائمة
          </Link>
        }
      />
      <Card>
        <PersonForm action={createPersonAction} regions={regions} owners={owners.map((o) => ({ id: o.id, name: o.fullName }))} submitLabel="حفظ السجل" />
      </Card>
    </>
  );
}
