import type { Cell, Report } from "@/lib/services/reports";
import { fmtDateTime } from "@/lib/format";

/// يحوّل النص إلى HTML آمن (كل القيم القادمة من قاعدة البيانات تمر من هنا)
export function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// الخلايا الرقمية والتواريخ وأرقام الطلبات والمهام تُعزل باتجاه اليسار إلى اليمين حتى لا تنقلب داخل النص العربي
const NUMERIC = /^[\d\s.,:%\-/+]+$|^\d{4}-\d{2}-\d{2}|^(REQ|TSK)-/;

function cell(v: Cell): string {
  const s = String(v);
  return `<td${typeof v === "number" || NUMERIC.test(s) ? ' class="num"' : ""}>${esc(s)}</td>`;
}

/// عرض التقرير كـHTML: المصدر الوحيد لشكل التقرير في الصفحة وفي ملف PDF
export function renderReportHtml(r: Report): string {
  const stats = r.stats
    .map((s) => `<div class="rpt-stat"><div class="rpt-stat-label">${esc(s.label)}</div><div class="rpt-stat-value">${esc(s.value)}</div>${s.hint ? `<div class="rpt-stat-hint">${esc(s.hint)}</div>` : ""}</div>`)
    .join("");
  const sections = r.sections
    .map((sec) => {
      const head = `<h2>${esc(sec.title)}</h2>${sec.note ? `<p class="rpt-note">${esc(sec.note)}</p>` : ""}${
        sec.truncated ? `<p class="rpt-note">يعرض التقرير أول ${sec.rows.length} صف من أصل ${sec.truncated}. الملف الكامل متاح بتصدير القوائم من صفحاتها.</p>` : ""
      }`;
      const body =
        sec.rows.length === 0
          ? `<p class="rpt-empty">${esc(sec.empty ?? "لا توجد بيانات.")}</p>`
          : `<div class="rpt-scroll"><table><thead><tr>${sec.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${sec.rows
              .map((row) => `<tr>${row.map(cell).join("")}</tr>`)
              .join("")}</tbody></table></div>`;
      return `<section class="rpt-sec">${head}${body}</section>`;
    })
    .join("");
  return `<article class="rpt" dir="rtl">
<header class="rpt-head">
<div class="rpt-org">نظام إدارة العمل الإداري والتنظيمي</div>
<h1 class="rpt-title">${esc(r.title)}</h1>
<p class="rpt-desc">${esc(r.description)}</p>
<div class="rpt-meta"><span>الفترة الزمنية: <b>${esc(r.period ? r.period.label : "حتى تاريخ إعداد التقرير")}</b></span><span>تاريخ الإعداد: <b class="num">${esc(fmtDateTime(r.generatedAt))}</b></span><span>أعدّه: <b>${esc(r.generatedBy)}</b></span></div>
</header>
<section class="rpt-stats" aria-label="الإحصائيات">${stats}</section>
${sections}
<footer class="rpt-foot">أُعدّ هذا التقرير آلياً من قاعدة البيانات المركزية للنظام. الأرقام تعكس البيانات المسجلة حتى لحظة إعداده.</footer>
</article>`;
}
