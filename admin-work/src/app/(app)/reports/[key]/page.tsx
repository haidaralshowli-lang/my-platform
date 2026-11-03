import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, FileSpreadsheet } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/server";
import { buildReport, parsePeriod, REPORT_KEYS, REPORTS, type ReportKey } from "@/lib/services/reports";
import { pdfAvailable } from "@/lib/services/report-export";
import { Card, PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { renderReportHtml } from "@/components/report/report-html";
import { REPORT_CSS } from "@/components/report/report-css";
import { PeriodForm } from "../period-form";

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return { title: REPORTS[key as ReportKey]?.title ?? "تقرير" };
}

export default async function ReportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePagePermission("reports.view");
  const { key } = await params;
  if (!REPORT_KEYS.includes(key as ReportKey)) notFound();
  const k = key as ReportKey;
  const sp = await searchParams;
  const period = parsePeriod(k, sp);
  const report = await buildReport(k, period, actor.fullName);
  const qs = new URLSearchParams(Object.entries({ from: sp.from, to: sp.to, month: sp.month }).filter((e): e is [string, string] => !!e[1])).toString();
  const btn = "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition";
  return (
    <>
      <style>{REPORT_CSS}</style>
      <div className="no-print">
        <PageHeader
          title={REPORTS[k].title}
          actions={
            <>
              {pdfAvailable() && (
                <a href={`/api/reports/${k}?format=pdf${qs ? `&${qs}` : ""}`} className={`${btn} bg-brand text-white hover:bg-brand-dark`}>
                  <Download className="h-4 w-4" aria-hidden /> تنزيل PDF
                </a>
              )}
              <a href={`/api/reports/${k}?format=xlsx${qs ? `&${qs}` : ""}`} className={`${btn} border border-line bg-white text-ink hover:bg-band`}>
                <FileSpreadsheet className="h-4 w-4" aria-hidden /> تصدير Excel
              </a>
              <PrintButton />
            </>
          }
        />
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <PeriodForm reportKey={k} period={period} action={`/reports/${k}`} />
          <Link href="/reports" className="text-sm text-brand hover:underline">
            ← كل التقارير
          </Link>
        </div>
      </div>
      <Card className="print:border-0 print:shadow-none">
        {/* HTML مُولَّد من بيانات مُهرَّبة بالكامل في renderReportHtml */}
        <div dangerouslySetInnerHTML={{ __html: renderReportHtml(report) }} />
      </Card>
    </>
  );
}
