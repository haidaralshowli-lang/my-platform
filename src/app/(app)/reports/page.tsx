import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/server";
import { can } from "@/lib/rbac/actor";
import { Card, PageHeader } from "@/components/ui";
import { REPORTS } from "@/lib/reports";

export const metadata = { title: "التقارير والإحصائيات" };

export default async function ReportsPage() {
  const actor = await requirePagePermission("reports.view");
  const list = Object.entries(REPORTS).filter(([, d]) => !d.perm || can(actor, d.perm));
  return (
    <>
      <PageHeader title="التقارير والإحصائيات" description="جميع التقارير مستمدة من قاعدة البيانات الفعلية، ضمن نطاق صلاحياتك، ودون البيانات التجريبية. تُطبع أو تُحفظ PDF من المتصفح، وتُصدَّر Excel." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.map(([key, d], i) => (
          <Link key={key} href={`/reports/${key}`} className="block">
            <Card className="h-full transition hover:shadow-md">
              <div className="text-xs text-muted">تقرير {i + 1}</div>
              <div className="mt-1 font-semibold text-brand">{d.title}</div>
              <p className="mt-1 text-xs text-muted">{d.description}</p>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
