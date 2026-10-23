import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth/server";
import { Badge, Card, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/datetime";
import { PLACEHOLDERS } from "@/lib/services/warnings";
import { EditTemplateForm } from "../forms";

export const metadata = { title: "قالب إنذار" };

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("template.manage");
  const { id } = await params;
  const t = await prisma.warningTemplate.findUnique({ where: { id }, include: { versions: { orderBy: { versionNo: "desc" }, include: { _count: { select: { warnings: true } } } } } });
  if (!t) notFound();
  const current = t.versions[0];
  return (
    <>
      <PageHeader title={t.name} />
      <div className="mb-4">{t.isActive ? <Badge tone="success">مفعّل</Badge> : <Badge tone="danger">معطّل</Badge>}</div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`تعديل (الإصدار الحالي ${current.versionNo})`}><EditTemplateForm templateId={t.id} body={current.body} active={t.isActive} placeholders={PLACEHOLDERS} /></Card>
        <Card title="الإصدارات">
          <ul className="flex flex-col divide-y divide-line">
            {t.versions.map((v) => (
              <li key={v.id} className="py-3">
                <div className="text-sm font-medium">الإصدار {v.versionNo} <span className="text-xs text-muted">— {formatDateTime(v.createdAt)}{v.notes ? ` — ${v.notes}` : ""} — استُخدم في {v._count.warnings} إنذار</span></div>
                <details className="mt-1"><summary className="cursor-pointer text-xs text-brand">عرض النص</summary><pre className="mt-2 font-sans text-sm leading-7 whitespace-pre-wrap">{v.body}</pre></details>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
