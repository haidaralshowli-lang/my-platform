import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { addSheet, newWorkbook, toBuffer } from "@/lib/excel";
import { fmtDateTime } from "@/lib/format";
import { esc, renderReportHtml } from "@/components/report/report-html";
import { REPORT_CSS } from "@/components/report/report-css";
import type { Report } from "./reports";

// ─────────────────────────── Excel ───────────────────────────

/// ورقة للملخص والإحصائيات، وورقة لكل قسم
export async function reportToXlsx(r: Report): Promise<Buffer> {
  const wb = newWorkbook();
  const summary = addSheet(wb, "الملخص", [
    { header: "البند", key: "k", width: 40 },
    { header: "القيمة", key: "v", width: 30 },
  ]);
  summary.addRow({ k: "التقرير", v: r.title });
  summary.addRow({ k: "الفترة الزمنية", v: r.period ? r.period.label : "حتى تاريخ إعداد التقرير" });
  summary.addRow({ k: "تاريخ الإعداد", v: fmtDateTime(r.generatedAt) });
  summary.addRow({ k: "أعدّه", v: r.generatedBy });
  summary.addRow({});
  for (const s of r.stats) summary.addRow({ k: s.hint ? `${s.label} (${s.hint})` : s.label, v: s.value });
  const used = new Set<string>(["الملخص"]);
  for (const sec of r.sections) {
    // أسماء أوراق Excel بحد أقصى 31 حرفاً ودون الرموز المحجوزة
    let name = sec.title.replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim();
    for (let i = 2; used.has(name); i++) name = `${name.slice(0, 28)} ${i}`;
    used.add(name);
    const ws = addSheet(
      wb,
      name,
      sec.columns.map((c, i) => ({ header: c || " ", key: `c${i}`, width: Math.min(45, Math.max(12, c.length + 4, ...sec.rows.slice(0, 200).map((r) => String(r[i] ?? "").length + 2))) })),
    );
    for (const row of sec.rows) ws.addRow(Object.fromEntries(row.map((v, i) => [`c${i}`, v])));
    if (sec.rows.length === 0) ws.addRow({ c0: sec.empty ?? "لا توجد بيانات." });
    if (sec.truncated) ws.addRow({ c0: `يعرض أول ${sec.rows.length} صف من أصل ${sec.truncated}` });
  }
  return toBuffer(wb);
}

// ─────────────────────────── PDF ───────────────────────────

export function pdfAvailable(): boolean {
  return !!process.env.CHROMIUM_PATH;
}

let fontCss: Promise<string> | null = null;

/// الخط العربي مضمَّن في الملف حتى يُرسم PDF دون اتصال بالإنترنت
function embeddedFonts(): Promise<string> {
  fontCss ??= (async () => {
    const dir = path.join(process.cwd(), "node_modules/@fontsource/ibm-plex-sans-arabic/files");
    const faces = await Promise.all(
      ([400, 600, 700] as const).flatMap((w) =>
        (["arabic", "latin"] as const).map(async (sub) => {
          const data = await readFile(path.join(dir, `ibm-plex-sans-arabic-${sub}-${w}-normal.woff2`));
          return `@font-face{font-family:"Plex";font-weight:${w};src:url(data:font/woff2;base64,${data.toString("base64")}) format("woff2");}`;
        }),
      ),
    );
    return faces.join("\n");
  })();
  return fontCss;
}

export async function reportHtml(r: Report): Promise<string> {
  const body = renderReportHtml(r);
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(r.title)}</title><style>${await embeddedFonts()}
html,body{margin:0;background:#fff;font-family:"Plex",sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
${REPORT_CSS}
.rpt-scroll{overflow:visible}</style></head><body>${body}</body></html>`;
}

/// يرسم التقرير إلى PDF بمتصفح Chromium (تشكيل الحروف العربية واتجاه النص صحيحان كما في الصفحة)
export async function reportToPdf(r: Report): Promise<Buffer> {
  const executablePath = process.env.CHROMIUM_PATH;
  if (!executablePath) throw new Error("توليد PDF على الخادم غير مهيأ (CHROMIUM_PATH)");
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage();
    // لا يُسمح للصفحة بأي طلب شبكي: كل المحتوى مضمَّن
    await page.route("**/*", (route) => (route.request().url().startsWith("data:") ? route.continue() : route.abort()));
    await page.setContent(await reportHtml(r), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "14mm", bottom: "16mm", left: "12mm", right: "12mm" },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="width:100%;font-size:8px;color:#5a6070;text-align:center;font-family:sans-serif"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
