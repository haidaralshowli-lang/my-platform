import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth/server";
import { Badge, Card, DataTable, EmptyState, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/datetime";
import { PLACEHOLDERS } from "@/lib/services/warnings";
import { CreateTemplateForm } from "./forms";

export const metadata = { title: "قوالب الكتب والإنذارات" };

export default async function TemplatesPage() {
  await requirePagePermission("template.manage");
  const rows = await prisma.warningTemplate.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { versions: true } } } });
  return (
    <>
      <PageHeader title="قوالب الكتب والإنذارات" description="قوالب رسمية بإصدارات محفوظة. لا تحتوي المنصة نصوصاً قانونية جاهزة؛ تكتب الجهة المختصة نص القالب المعتمد." />
      <Card title="القوالب" className="mb-6">
        {rows.length === 0 ? <EmptyState>لا توجد قوالب بعد.</EmptyState> : (
          <DataTable>
            <thead><tr><th>الاسم</th><th>الإصدار الحالي</th><th>الحالة</th><th>تاريخ الإنشاء</th></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td><Link className="font-medium text-brand hover:underline" href={`/templates/${t.id}`}>{t.name}</Link></td>
                  <td className="text-xs">{t.currentVersionNo} من {t._count.versions}</td>
                  <td>{t.isActive ? <Badge tone="success">مفعّل</Badge> : <Badge tone="danger">معطّل</Badge>}</td>
                  <td className="text-xs">{formatDate(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>
      <Card title="قالب جديد"><CreateTemplateForm placeholders={PLACEHOLDERS} /></Card>
    </>
  );
}
