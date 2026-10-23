import Link from "next/link";
import { formatNumberLocale } from "@/lib/datetime";

export type Datum = { key: string; label: string; value: number; href?: string };

/// جدول بديل لكل رسم (إمكانية الوصول، والطباعة، وقراءة القيم الدقيقة)
function TableView({ data, unit }: { data: Datum[]; unit: string }) {
  return (
    <details className="mt-3 text-xs">
      <summary className="cursor-pointer text-muted">عرض كجدول</summary>
      <table className="mt-2 w-full text-start">
        <thead><tr className="text-muted"><th className="py-1 text-start font-normal">البند</th><th className="py-1 text-start font-normal">{unit}</th></tr></thead>
        <tbody>{data.map((d) => <tr key={d.key} className="border-t border-line"><td className="py-1">{d.label}</td><td className="py-1">{formatNumberLocale(d.value)}</td></tr>)}</tbody>
      </table>
    </details>
  );
}

/// أعمدة أفقية لسلسلة واحدة (مقدار لكل فئة): لون واحد، قيم مباشرة بلون النص، نهاية مستديرة على جهة القيمة
export function BarList({ title, data, unit = "العدد", max: maxItems = 12 }: { title: string; data: Datum[]; unit?: string; max?: number }) {
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const shown = sorted.slice(0, maxItems);
  const rest = sorted.slice(maxItems).reduce((s, d) => s + d.value, 0);
  if (rest > 0) shown.push({ key: "__other", label: "أخرى", value: rest });
  const max = Math.max(1, ...shown.map((d) => d.value));
  return (
    <figure className="min-w-0">
      <figcaption className="mb-3 text-sm font-semibold text-brand">{title}</figcaption>
      {shown.length === 0 ? <p className="text-xs text-muted">لا توجد بيانات.</p> : (
        <ul className="flex flex-col gap-0.5" aria-label={title}>
          {shown.map((d) => {
            const pct = (d.value / max) * 100;
            const label = d.href ? <Link href={d.href} className="hover:text-brand hover:underline">{d.label}</Link> : d.label;
            return (
              <li key={d.key} className="group grid grid-cols-[minmax(6rem,10rem)_1fr_auto] items-center gap-3 rounded px-1 py-1 hover:bg-band" title={`${d.label}: ${formatNumberLocale(d.value)}`}>
                <span className="truncate text-xs text-ink">{label}</span>
                <span className="relative h-2.5" aria-hidden>
                  <span className="absolute inset-y-0 start-0 rounded-e bg-brand transition-[width] group-hover:bg-brand-dark" style={{ width: `${Math.max(pct, d.value > 0 ? 1.5 : 0)}%` }} />
                </span>
                <span className="min-w-8 text-end text-xs font-medium text-ink tabular-nums">{formatNumberLocale(d.value)}</span>
              </li>
            );
          })}
        </ul>
      )}
      <TableView data={shown} unit={unit} />
    </figure>
  );
}

/// أعمدة رأسية عبر الزمن (الأشهر)، تُقرأ من اليمين إلى اليسار في الاتجاه العربي
export function ColumnChart({ title, data, unit = "العدد" }: { title: string; data: Datum[]; unit?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <figure className="min-w-0">
      <figcaption className="mb-3 text-sm font-semibold text-brand">{title}</figcaption>
      <div className="flex h-40 items-end gap-0.5 border-b border-line" role="list" aria-label={title}>
        {data.map((d) => (
          <div key={d.key} role="listitem" className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end" title={`${d.label}: ${formatNumberLocale(d.value)}`}>
            {d.value > 0 && <span className="mb-1 text-[10px] text-muted tabular-nums">{formatNumberLocale(d.value)}</span>}
            <span className="w-full max-w-6 rounded-t bg-brand group-hover:bg-brand-dark" style={{ height: `${(d.value / max) * 85}%`, minHeight: d.value > 0 ? 3 : 0 }} aria-label={`${d.label}: ${d.value}`} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-0.5 text-[10px] text-muted" aria-hidden>
        {data.map((d) => <span key={d.key} className="min-w-0 flex-1 truncate text-center">{d.label}</span>)}
      </div>
      <TableView data={data} unit={unit} />
    </figure>
  );
}
