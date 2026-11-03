import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { ReactNode } from "react";

type Params = Record<string, string | number | string[] | undefined>;

/// يبني رابط استعلام من الفلاتر مع حذف القيم الافتراضية والفارغة
export function buildQs(f: Params, patch: Params = {}, defaults: Params = { page: 1 }): string {
  const merged = { ...f, ...patch };
  const p = new URLSearchParams();
  for (const [k, raw] of Object.entries(merged)) {
    const v = Array.isArray(raw) ? raw.join(",") : raw;
    if (v === undefined || v === "") continue;
    if (defaults[k] !== undefined && String(defaults[k]) === String(v)) continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function SortHeader({ base, f, col, defaults, children, className }: { base: string; f: Params & { sort: string; dir: string }; col: string; defaults: Params; children: ReactNode; className?: string }) {
  const active = f.sort === col;
  const nextDir = active && f.dir === "desc" ? "asc" : "desc";
  return (
    <th className={className} aria-sort={active ? (f.dir === "asc" ? "ascending" : "descending") : undefined}>
      <Link href={`${base}${buildQs(f, { sort: col, dir: nextDir, page: 1 }, defaults)}`} className="inline-flex items-center gap-1 hover:underline">
        {children}
        {active && (f.dir === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)}
      </Link>
    </th>
  );
}

export function Pagination({ base, f, page, pages, defaults }: { base: string; f: Params; page: number; pages: number; defaults: Params }) {
  if (pages <= 1) return null;
  return (
    <nav aria-label="الصفحات" className="mt-4 flex items-center justify-between gap-2 text-sm">
      {page > 1 ? (
        <Link href={`${base}${buildQs(f, { page: page - 1 }, defaults)}`} className="text-brand hover:underline">
          → السابق
        </Link>
      ) : (
        <span />
      )}
      <span className="ltr-num text-muted">
        {page} / {pages}
      </span>
      {page < pages ? (
        <Link href={`${base}${buildQs(f, { page: page + 1 }, defaults)}`} className="text-brand hover:underline">
          التالي ←
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2" title={`${value}%`}>
      <div className="h-1.5 w-16 rounded-full bg-band" aria-hidden>
        <div className="h-1.5 rounded-full bg-accent" style={{ width: `${value}%` }} />
      </div>
      <span className="ltr-num text-xs text-muted">{value}%</span>
    </div>
  );
}

/// تنبيه ثابت على صفحات الطلبات وفق وثيقة المتطلبات
export function RequestDisclaimer() {
  return (
    <p className="rounded-md border border-line bg-band px-3 py-2 text-xs text-muted">
      تسجيل الطلب ومتابعته لا يعني ضمان تحقيقه. يعرض النظام الحالة الفعلية للطلب كما سُجِّلت، دون أي وعد تلقائي بالإنجاز.
    </p>
  );
}
