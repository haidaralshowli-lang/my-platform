import { AlignmentType, Document, Packer, Paragraph, TextRun } from "docx";
import { getSession, requestContext } from "@/lib/auth/server";
import { getWarningForActor } from "@/lib/services/warnings";
import { AppError } from "@/lib/errors";
import { formatDate } from "@/lib/datetime";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const rtl = (text: string, opts: { bold?: boolean; size?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}) =>
  new Paragraph({
    bidirectional: true,
    alignment: opts.align ?? AlignmentType.START,
    spacing: { after: 160, line: 360 },
    children: [new TextRun({ text, bold: opts.bold, size: opts.size ?? 28, rightToLeft: true, font: "Simplified Arabic" })],
  });

/// تصدير الإنذار بصيغة Word (RTL) من النص الثابت المحفوظ
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s || s.actor.mustChangePassword) return new Response("غير مصرح", { status: 401 });
  const { id } = await params;
  try {
    const w = await getWarningForActor(s.actor, id);
    const doc = new Document({
      sections: [{
        properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } },
        children: [
          rtl("جمهورية العراق", { bold: true }),
          rtl("هيئة الإعلام والاتصالات", { bold: true }),
          rtl(`${w.violation.office.nameAr} — ${w.violation.office.governorate.nameAr}`),
          rtl(`العدد: ${w.number}    التاريخ: ${formatDate(w.preparedAt)}    رقم المخالفة: ${w.violation.number ?? ""}`),
          rtl("إنذار", { bold: true, size: 36, align: AlignmentType.CENTER }),
          ...w.renderedBody.split(/\n+/).map((p) => rtl(p, { align: AlignmentType.JUSTIFIED })),
          rtl(""),
          rtl(w.signerName ?? "رئيس هيئة الإعلام والاتصالات", { bold: true, align: AlignmentType.END }),
          rtl("التوقيع والختم", { align: AlignmentType.END }),
        ],
      }],
    });
    const buf = await Packer.toBuffer(doc);
    await prisma.$transaction((tx) => requestContext().then((ctx) => writeAudit(tx, { actor: s.actor, action: "warning.exported_docx", entityType: "Warning", entityId: id, ctx })));
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`إنذار-${w.number}.docx`)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: 404 });
    console.error("[warning-docx]", e instanceof Error ? e.message : e);
    return new Response("تعذر إنشاء الملف", { status: 500 });
  }
}
