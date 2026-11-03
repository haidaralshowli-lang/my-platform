const TZ = process.env.APP_TIMEZONE || "Asia/Baghdad";

// صيغة ثابتة YYYY-MM-DD HH:mm بأرقام لاتينية حتى لا يبعثرها اتجاه النص العربي
const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function pieces(d: Date) {
  const m: Record<string, string> = {};
  for (const p of parts.formatToParts(d)) m[p.type] = p.value;
  return m;
}

export function fmtDateTime(d: Date | null | undefined): string {
  if (!d) return "—";
  const p = pieces(d);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

export function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  const p = pieces(d);
  return `${p.year}-${p.month}-${p.day}`;
}
