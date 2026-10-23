import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth/server";
import { can } from "@/lib/rbac/actor";
import { Alert, Card, DataTable, EmptyState, PageHeader } from "@/components/ui";
import { formatDateTime, formatNumberLocale } from "@/lib/datetime";
import { describeParams, reportParamsSchema, REPORTS, runReport } from "@/lib/reports";
import { AppError } from "@/lib/errors";
import { officeScopeWhere } from "@/lib/services/violations";
import { PrintButton } from "@/app/warnings/[id]/print/print-button";

export const metadata = { title: "تقرير" };

export default async function ReportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePagePermission("reports.view");
  const { key } = await params;
  const def = REPORTS[key];
  if (!def || (def.perm && !can(actor, def.perm))) notFound();
  const raw = await searchParams;
  const p = reportParamsSchema.safeParse(raw);
  const prm = p.success ? p.data : reportParamsSchema.parse({});
  const ran = raw.run === "1";
  let result: Awaited<ReturnType<typeof runReport>> | null = null;
  let error: string | null = null;
  if (ran) {
    try {
      result = await runReport(actor, key, prm);
    } catch (e) {
      if (e instanceof AppError) error = e.message;
      else throw e;
    }
  }
  const [offices, types, criteria] = await Promise.all([
    prisma.office.findMany({ where: actor.scope === "CENTRAL" ? {} : officeScopeWhere(actor), include: { governorate: true }, orderBy: { nameAr: "asc" } }),
    prisma.violationType.findMany({ orderBy: { nameAr: "asc" } }),
    describeParams(prm),
  ]);
  const governorates = [...new Map(offices.map((o) => [o.governorateId, o.governorate])).values()];
  const qs = new URLSearchParams(Object.entries(raw).filter(([k, v]) => v && k !== "run") as [string, string][]).toString();

  return (
    <>
      <div className="no-print"><PageHeader title={def.title} description={def.description} /></div>
      <Card className="no-print mb-6">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input type="hidden" name="run" value="1" />
          {def.needsNumber && <label className="flex flex-col gap-1 text-xs text-muted">رقم المخالفة<input name="number" defaultValue={raw.number} required className="field-input" /></label>}
          <label className="flex flex-col gap-1 text-xs text-muted">التسجيل من<input type="date" name="from" defaultValue={raw.from} className="field-input" /></label>
          <label className="flex flex-col gap-1 text-xs text-muted">التسجيل إلى<input type="date" name="to" defaultValue={raw.to} className="field-input" /></label>
          <label className="flex flex-col gap-1 text-xs text-muted">المحافظة
            <select name="governorateId" defaultValue={raw.governorateId ?? ""} className="field-input"><option value="">الكل</option>{governorates.map((g) => <option key={g.id} value={g.id}>{g.nameAr}</option>)}</select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">الفرع
            <select name="officeId" defaultValue={raw.officeId ?? ""} className="field-input"><option value="">الكل</option>{offices.map((o) => <option key={o.id} value={o.id}>{o.governorate.nameAr} / {o.nameAr}</option>)}</select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">نوع المخالفة
            <select name="violationTypeId" defaultValue={raw.violationTypeId ?? ""} className="field-input"><option value="">الكل</option>{types.map((t) => <option key={t.id} value={t.id}>{t.nameAr}</option>)}</select>
          </label>
          <div className="flex items-end gap-2"><button className="rounded-md bg-brand px-4 py-2 text-sm text-white">عرض التقرير</button></div>
        </form>
      </Card>

      {error && <Alert tone="danger">{error}</Alert>}
      {result && (
        <article className="rounded-lg border border-line bg-white p-4 print:border-0 print:p-0">
          <header className="mb-4 border-b-4 border-brand pb-3">
            <div className="text-sm font-bold text-brand">هيئة الإعلام والاتصالات — منصة إدارة المخالفات</div>
            <h1 className="mt-1 text-lg font-bold">{result.title}</h1>
            <dl className="mt-2 grid gap-1 text-xs text-muted sm:grid-cols-3">
              <div><dt className="inline">معايير البحث: </dt><dd className="inline">{criteria}</dd></div>
              <div><dt className="inline">تاريخ الإنشاء: </dt><dd className="inline">{formatDateTime(result.generatedAt)}</dd></div>
              <div><dt className="inline">أنشأه: </dt><dd className="inline">{result.generatedBy}</dd></div>
            </dl>
          </header>
          <div className="no-print mb-3 flex flex-wrap gap-2">
            <PrintButton />
            <a className="rounded-md border border-line px-4 py-2 text-sm hover:bg-band" href={`/api/reports/${key}/xlsx?${qs}`}>تصدير Excel</a>
            {key === "violation_full" && <a className="rounded-md border border-line px-4 py-2 text-sm hover:bg-band" href={`/api/reports/${key}/docx?${qs}`}>تصدير Word</a>}
          </div>
          {result.note && <p className="mb-3 text-sm font-medium">{result.note}</p>}
          {result.rows.length === 0 ? <EmptyState>لا توجد بيانات مطابقة.</EmptyState> : (
            <DataTable>
              <thead><tr>{result.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
              <tbody>
                {result.rows.map((r, i) => (
                  <tr key={i}>{result!.columns.map((c) => <td key={c.key} className="text-xs">{typeof r[c.key] === "number" ? formatNumberLocale(r[c.key] as number) : <bdi>{r[c.key]}</bdi>}</td>)}</tr>
                ))}
              </tbody>
            </DataTable>
          )}
          <p className="mt-3 text-xs text-muted">عدد الصفوف: {formatNumberLocale(result.rows.length)}</p>
        </article>
      )}
    </>
  );
}
