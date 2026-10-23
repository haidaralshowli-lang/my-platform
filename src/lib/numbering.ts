import type { Tx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { zonedParts } from "@/lib/datetime";

export type NumberKind = "violation" | "warning" | "criminalCase";

const SETTING_KEY = {
  violation: "numbering.violation",
  warning: "numbering.warning",
  criminalCase: "numbering.criminalCase",
} as const;

export type NumberTokens = { year: number; governorateCode?: string; officeCode?: string };

const TOKEN_RE = /\{(YYYY|GOV|OFFICE|SEQ(?::(\d))?)\}/g;

export function validatePattern(pattern: string): string | null {
  const seq = pattern.match(/\{SEQ(?::\d)?\}/g) ?? [];
  if (seq.length !== 1) return "يجب أن تحتوي الصيغة على {SEQ} مرة واحدة بالضبط";
  const stripped = pattern.replace(TOKEN_RE, "");
  if (/[{}]/.test(stripped)) return "الصيغة تحتوي رموزاً غير معروفة. المسموح: {YYYY} {GOV} {OFFICE} {SEQ:n}";
  if (pattern.length > 40) return "الصيغة طويلة جداً";
  return null;
}

/// مفتاح التسلسل يتضمن قيم الرموز المقسِّمة الموجودة في الصيغة، فيبدأ ترقيم مستقل لكل سنة/فرع حسب الصيغة
export function sequenceKey(kind: NumberKind, pattern: string, t: NumberTokens): string {
  const parts: string[] = [kind];
  if (pattern.includes("{YYYY}")) parts.push(String(t.year));
  if (pattern.includes("{GOV}")) parts.push(t.governorateCode ?? "");
  if (pattern.includes("{OFFICE}")) parts.push(t.officeCode ?? "");
  return parts.join(":");
}

export function formatNumber(pattern: string, t: NumberTokens, seq: number): string {
  return pattern.replace(TOKEN_RE, (_m, tok: string, width?: string) => {
    if (tok === "YYYY") return String(t.year);
    if (tok === "GOV") return t.governorateCode ?? "";
    if (tok === "OFFICE") return t.officeCode ?? "";
    return String(seq).padStart(width ? Number(width) : 1, "0");
  });
}

/// يولد رقماً رسمياً فريداً داخل المعاملة. الزيادة ذرية (INSERT .. ON CONFLICT DO UPDATE .. RETURNING)
/// فلا يتكرر الرقم مع الطلبات المتزامنة من فروع متعددة، ويبقى القيد الفريد في الجداول ضماناً إضافياً.
export async function nextOfficialNumber(tx: Tx, kind: NumberKind, tokens: Omit<NumberTokens, "year"> & { at?: Date }): Promise<string> {
  const { pattern } = (await getSetting(tx, SETTING_KEY[kind])) as { pattern: string };
  const err = validatePattern(pattern);
  if (err) throw new AppError(`صيغة الترقيم غير صحيحة: ${err}`);
  const t: NumberTokens = { ...tokens, year: zonedParts(tokens.at ?? new Date()).year };
  const key = sequenceKey(kind, pattern, t);
  const rows = await tx.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO "NumberingSequence" ("key", "lastValue", "updatedAt") VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET "lastValue" = "NumberingSequence"."lastValue" + 1, "updatedAt" = now()
    RETURNING "lastValue"`;
  return formatNumber(pattern, t, rows[0].lastValue);
}
