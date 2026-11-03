import { NextResponse, type NextRequest } from "next/server";
import { getSession, requestContext } from "@/lib/auth/server";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { XLSX_TYPE } from "@/lib/excel";
import { buildReport, parsePeriod, REPORT_KEYS, type ReportKey } from "@/lib/services/reports";
import { pdfAvailable, reportToPdf, reportToXlsx } from "@/lib/services/report-export";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/// تصدير التقرير إلى PDF أو Excel، ويُسجَّل التصدير في سجل التدقيق
export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const s = await getSession();
  if (!s || s.actor.mustChangePassword) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  if (!can(s.actor, "reports.view")) return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  const { key } = await params;
  if (!REPORT_KEYS.includes(key as ReportKey)) return NextResponse.json({ error: "تقرير غير معروف" }, { status: 404 });
  const sp = Object.fromEntries(req.nextUrl.searchParams);
  const format = sp.format === "pdf" ? "pdf" : "xlsx";
  if (format === "pdf" && !pdfAvailable()) return NextResponse.json({ error: "توليد PDF على الخادم غير مهيأ. استخدم «طباعة / حفظ PDF» من صفحة التقرير." }, { status: 501 });
  const k = key as ReportKey;
  const report = await buildReport(k, parsePeriod(k, sp), s.actor.fullName);
  const buf = format === "pdf" ? await reportToPdf(report) : await reportToXlsx(report);
  const ctx = await requestContext();
  await prisma.$transaction((tx) => writeAudit(tx, { actor: s.actor, action: "report.export", entityType: "Report", entityId: k, after: { format, period: report.period }, ctx }));
  const name = `${k}${report.period ? `-${report.period.from}_${report.period.to}` : ""}.${format}`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : XLSX_TYPE,
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
