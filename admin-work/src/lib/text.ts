/// توحيد الأسماء العربية لاكتشاف التكرار: إزالة التشكيل والتطويل، وتوحيد الهمزات والتاء المربوطة والألف المقصورة،
/// وتحويل الأرقام العربية الهندية، وضغط المسافات. لا يُعرض للمستخدم، ويُخزَّن في normalizedName فقط.
export function normalizeArabicName(input: string): string {
  return toLatinDigits(input)
    .normalize("NFKC")
    .replace(/[ً-ٰٟۖ-ۭ]/g, "") // التشكيل
    .replace(/ـ/g, "") // التطويل
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function toLatinDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/// توحيد رقم الهاتف العراقي إلى الصيغة المحلية 07XXXXXXXXX. يعيد null للقيمة الفارغة، ويرمي رسالة للقيمة غير الصالحة.
export function normalizePhone(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  let d = toLatinDigits(String(input)).replace(/[\s\-().]/g, "");
  if (!d) return null;
  if (d.startsWith("+964")) d = "0" + d.slice(4);
  else if (d.startsWith("00964")) d = "0" + d.slice(5);
  else if (d.startsWith("964") && d.length === 13) d = "0" + d.slice(3);
  else if (/^7\d{9}$/.test(d)) d = "0" + d;
  if (!/^07\d{9}$/.test(d)) throw new Error("رقم الهاتف يجب أن يكون رقماً عراقياً من 11 خانة يبدأ بـ 07");
  return d;
}
