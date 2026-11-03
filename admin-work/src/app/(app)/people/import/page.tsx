import Link from "next/link";
import { Download } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/server";
import { IMPORT_COLUMNS } from "@/lib/services/people-excel";
import { Card, PageHeader } from "@/components/ui";
import { ImportForm } from "./import-form";

export const metadata = { title: "استيراد الأشخاص من Excel" };

export default async function ImportPage() {
  await requirePagePermission("people.import");
  return (
    <>
      <PageHeader
        title="استيراد الأشخاص من Excel"
        description="يُفحص الملف أولاً وتُعرض نتيجة كل صف، ثم تستورد الصفوف السليمة فقط بعد تأكيدك. لا يُستورد أي رقم هاتف مسجل مسبقاً."
        actions={
          <Link href="/people" className="text-sm text-brand hover:underline">
            ← العودة إلى القائمة
          </Link>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="الملف" className="lg:col-span-2">
          <ImportForm />
        </Card>
        <Card title="صيغة الملف">
          <a href="/api/people/template" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
            <Download className="h-4 w-4" aria-hidden /> تنزيل القالب المعتمد
          </a>
          <p className="mb-2 text-sm text-muted">الصف الأول عناوين الأعمدة:</p>
          <ul className="list-inside list-disc space-y-0.5 text-sm">
            {IMPORT_COLUMNS.map((c) => (
              <li key={c.key}>
                {c.header}
                {"required" in c && c.required && <span className="text-tone-danger"> (إلزامي)</span>}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">المحافظة ومستوى التفاعل يُكتبان كما في القوائم، ومسؤول المتابعة باسم المستخدم. ورقة «القيم المقبولة» في القالب تعرضها كلها.</p>
        </Card>
      </div>
    </>
  );
}
