import { requireActor } from "@/lib/auth/server";
import { orNotFound } from "@/lib/page-helpers";
import { getWarningForActor } from "@/lib/services/warnings";
import { formatDate } from "@/lib/datetime";
import { PrintButton } from "./print-button";

export const metadata = { title: "طباعة الإنذار" };

/// نسخة الإنذار للطباعة أو الحفظ PDF من المتصفح. النص لقطة ثابتة كما صدر، ويُعرض نصاً مهرَّباً (لا HTML).
export default async function WarningPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const w = await orNotFound(getWarningForActor(actor, id));
  const logo = process.env.NEXT_PUBLIC_LOGO_PATH;
  const signed = w.status === "SIGNED" || w.status === "DELIVERED" || w.status === "SENT";
  return (
    <div className="min-h-dvh bg-page py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-2 px-4">
        <span className="text-sm text-muted">{signed ? "هذه نسخة النص المعتمد. النسخة الموقعة الرسمية هي النسخة الضوئية المرفوعة." : "نسخة الإنذار قبل التوقيع."}</span>
        <PrintButton />
      </div>
      <article className="mx-auto min-h-[297mm] max-w-[210mm] bg-white px-[18mm] py-[16mm] text-[15px] leading-8 shadow print:min-h-0 print:shadow-none">
        <header className="flex items-start justify-between gap-4 border-b-4 border-brand pb-4">
          <div className="leading-7">
            <div className="text-lg font-bold text-brand">جمهورية العراق</div>
            <div className="text-lg font-bold text-brand">هيئة الإعلام والاتصالات</div>
            <div className="text-sm">{w.violation.office.nameAr} — {w.violation.office.governorate.nameAr}</div>
          </div>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="شعار الهيئة" className="h-20 w-20 object-contain" />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-accent text-xs text-muted">الشعار</div>
          )}
          <div className="text-sm leading-7">
            <div>العدد: <bdi className="font-semibold">{w.number}</bdi></div>
            <div>التاريخ: {formatDate(w.preparedAt)}</div>
            <div>رقم المخالفة: <bdi>{w.violation.number}</bdi></div>
          </div>
        </header>
        <h1 className="my-6 text-center text-xl font-bold text-brand">إنذار</h1>
        <div className="flex flex-col gap-3">
          {w.renderedBody.split(/\n+/).map((p, i) => <p key={i} className="text-justify">{p}</p>)}
        </div>
        <footer className="mt-16 grid grid-cols-2 gap-8 text-sm">
          <div />
          <div className="text-center leading-8">
            <div className="h-20 border-b border-dashed border-muted" aria-label="موضع التوقيع" />
            <div className="font-semibold">{w.signerName ?? "رئيس هيئة الإعلام والاتصالات"}</div>
            <div className="text-muted">التوقيع والختم</div>
            {w.signedAt && <div>تاريخ التوقيع: {formatDate(w.signedAt)}</div>}
          </div>
        </footer>
        {w.status === "CANCELLED" && <p className="mt-8 border-2 border-tone-danger p-2 text-center font-bold text-tone-danger">ملغى — {w.cancelReason}</p>}
      </article>
    </div>
  );
}
