import ExcelJS from "exceljs";
import { AlignmentType, Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { getSession, requestContext } from "@/lib/auth/server";
import { describeParams, reportParamsSchema, runReport } from "@/lib/reports";
import { AppError } from "@/lib/errors";
import { formatDateTime } from "@/lib/datetime";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/// تصدير التقرير (Excel لجميع التقارير، Word للتقارير النصية). يُسجَّل التصدير في سجل التدقيق.
export async function GET(req: Request, { params }: { params: Promise<{ key: string; format: string }> }) {
  const s = await getSession();
  if (!s || s.actor.mustChangePassword) return new Response("غير مصرح", { status: 401 });
  const { key, format } = await params;
  if (format !== "xlsx" && format !== "docx") return new Response("صيغة غير مدعومة", { status: 404 });
  const url = new URL(req.url);
  const p = reportParamsSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!p.success) return new Response("معايير غير صالحة", { status: 400 });
  try {
    const r = await runReport(s.actor, key, p.data);
    const criteria = await describeParams(p.data);
    const meta = [`${r.title}`, `معايير البحث: ${criteria}`, `تاريخ الإنشاء: ${formatDateTime(r.generatedAt)}`, `أنشأه: ${r.generatedBy}`];
    let body: Uint8Array<ArrayBuffer>;
    let type: string;
    if (format === "xlsx") {
      const wb = new ExcelJS.Workbook();
      wb.creator = "منصة إدارة المخالفات";
      const ws = wb.addWorksheet("التقرير", { views: [{ rightToLeft: true }] });
      meta.forEach((m) => ws.addRow([m]).font = { bold: m === r.title });
      if (r.note) ws.addRow([r.note]);
      ws.addRow([]);
      const head = ws.addRow(r.columns.map((c) => c.label));
      head.font = { bold: true, color: { argb: "FFFFFFFF" } };
      head.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2A314D" } }));
      for (const row of r.rows) ws.addRow(r.columns.map((c) => row[c.key]));
      ws.columns.forEach((c) => (c.width = 22));
      body = new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer);
      type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    } else {
      const para = (t: string, bold = false) => new Paragraph({ bidirectional: true, alignment: AlignmentType.START, children: [new TextRun({ text: t, bold, rightToLeft: true, font: "Simplified Arabic", size: 24 })] });
      const cell = (t: string, bold = false) => new TableCell({ children: [para(t, bold)] });
      const doc = new Document({
        sections: [{
          children: [
            ...meta.map((m, i) => para(m, i === 0)),
            ...(r.note ? [para(r.note)] : []),
            new Table({
              visuallyRightToLeft: true,
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [new TableRow({ children: r.columns.map((c) => cell(c.label, true)) }), ...r.rows.map((row) => new TableRow({ children: r.columns.map((c) => cell(String(row[c.key] ?? ""))) }))],
            }),
          ],
        }],
      });
      body = new Uint8Array(await Packer.toBuffer(doc));
      type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    }
    await prisma.$transaction(async (tx) => writeAudit(tx, { actor: s.actor, action: "report.exported", entityType: "Report", entityId: key, after: { format, criteria, rows: r.rows.length }, ctx: await requestContext() }));
    return new Response(body, {
      headers: {
        "Content-Type": type,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${r.title}.${format}`)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.code === "FORBIDDEN" ? 403 : 404 });
    console.error("[report-export]", e instanceof Error ? e.message : e);
    return new Response("تعذر إنشاء الملف", { status: 500 });
  }
}
