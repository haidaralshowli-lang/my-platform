import { describe, expect, it } from "vitest";
import { computeDue, daysRemaining, extendDue, liveStatus, type Calendar, type RuleSpec } from "@/lib/deadlines/compute";

// العراق: نهاية الأسبوع الجمعة (5) والسبت (6)
const cal = (holidays: string[] = [], tz = "Asia/Baghdad"): Calendar => ({ timezone: tz, weekendDays: [5, 6], holidays: new Set(holidays) });
const rule = (r: Partial<RuleSpec> = {}): RuleSpec => ({ duration: 10, unit: "CALENDAR_DAYS", startEvent: "RECEIPT_DATE", excludeHolidays: false, ...r });
// 2026-11-01 الأحد، الساعة 10 صباحاً بتوقيت بغداد = 07:00 UTC
const RECEIPT = new Date("2026-11-01T07:00:00Z");

describe("احتساب المدة القانونية", () => {
  it("أيام تقويمية من يوم الاستلام: اليوم الأول هو يوم الاستلام وتنتهي بنهاية اليوم العاشر بتوقيت بغداد", () => {
    const r = computeDue(RECEIPT, rule(), cal());
    expect(r.startKey).toBe("2026-11-01");
    expect(r.dueKey).toBe("2026-11-10");
    expect(r.dueDate.toISOString()).toBe("2026-11-10T20:59:59.999Z"); // 23:59:59.999 بغداد
  });

  it("من اليوم التالي للاستلام: لا يُحتسب يوم الاستلام", () => {
    expect(computeDue(RECEIPT, rule({ startEvent: "DAY_AFTER_RECEIPT" }), cal()).dueKey).toBe("2026-11-11");
  });

  it("أيام تقويمية مع امتداد آخر يوم إذا صادف عطلة أو نهاية أسبوع", () => {
    // 2026-11-13 جمعة → يمتد إلى الأحد 15 (السبت عطلة أيضاً)
    expect(computeDue(RECEIPT, rule({ duration: 13 }), cal()).dueKey).toBe("2026-11-13");
    expect(computeDue(RECEIPT, rule({ duration: 13, excludeHolidays: true }), cal()).dueKey).toBe("2026-11-15");
    // عطلة رسمية يوم الأحد 15 → الاثنين 16
    expect(computeDue(RECEIPT, rule({ duration: 13, excludeHolidays: true }), cal(["2026-11-15"])).dueKey).toBe("2026-11-16");
  });

  it("أيام عمل: تُستبعد الجمعة والسبت والعطل الرسمية", () => {
    // الأحد 1 (يوم 1)، 2،3،4،5 (الخميس = 5)، الأحد 8 = 6 ... الخميس 12 = 10
    expect(computeDue(RECEIPT, rule({ unit: "WORKING_DAYS" }), cal()).dueKey).toBe("2026-11-12");
    expect(computeDue(RECEIPT, rule({ unit: "WORKING_DAYS" }), cal(["2026-11-04"])).dueKey).toBe("2026-11-15");
  });

  it("أيام عمل: الاستلام في يوم عطلة يبدأ العد من أول يوم عمل", () => {
    const friday = new Date("2026-11-06T09:00:00Z");
    const r = computeDue(friday, rule({ unit: "WORKING_DAYS", duration: 1 }), cal());
    expect(r.startKey).toBe("2026-11-08");
    expect(r.dueKey).toBe("2026-11-08");
  });

  it("المنطقة الزمنية: الاستلام قبيل منتصف الليل بتوقيت UTC يقع في اليوم التالي ببغداد", () => {
    const late = new Date("2026-11-01T22:30:00Z"); // 01:30 صباح 2 نوفمبر ببغداد
    expect(computeDue(late, rule(), cal()).startKey).toBe("2026-11-02");
    expect(computeDue(late, rule(), cal([], "UTC")).startKey).toBe("2026-11-01");
  });

  it("مدد مختلفة حسب القاعدة", () => {
    expect(computeDue(RECEIPT, rule({ duration: 1 }), cal()).dueKey).toBe("2026-11-01");
    expect(computeDue(RECEIPT, rule({ duration: 30 }), cal()).dueKey).toBe("2026-11-30");
    expect(() => computeDue(RECEIPT, rule({ duration: 0 }), cal())).toThrow();
  });

  it("التمديد يُضاف من تاريخ الاستحقاق الحالي وبوحدة القاعدة نفسها", () => {
    expect(extendDue("2026-11-10", 5, rule(), cal()).dueKey).toBe("2026-11-15");
    // أيام عمل: الثلاثاء 10 + 5 أيام عمل = 11،12،15،16،17
    expect(extendDue("2026-11-10", 5, rule({ unit: "WORKING_DAYS" }), cal()).dueKey).toBe("2026-11-17");
  });

  it("الحالة الزمنية: سارية، اقترب الانتهاء، منتهية", () => {
    const due = computeDue(RECEIPT, rule(), cal()).dueDate;
    expect(liveStatus(due, 3, new Date("2026-11-05T09:00:00Z"), "Asia/Baghdad")).toBe("RUNNING");
    expect(liveStatus(due, 3, new Date("2026-11-07T09:00:00Z"), "Asia/Baghdad")).toBe("NEAR_EXPIRY");
    expect(liveStatus(due, 3, new Date("2026-11-10T20:59:00Z"), "Asia/Baghdad")).toBe("NEAR_EXPIRY");
    expect(liveStatus(due, 3, new Date("2026-11-10T21:00:00Z"), "Asia/Baghdad")).toBe("EXPIRED");
    expect(daysRemaining(due, new Date("2026-11-07T09:00:00Z"), "Asia/Baghdad")).toBe(3);
  });
});

describe("مقارنة التواريخ بالتقويم المحلي", () => {
  it("تاريخ اليوم في بغداد ليس «مستقبلاً» بين منتصف الليل المحلي ومنتصف ليل UTC", async () => {
    const { isFutureDateKey } = await import("@/lib/datetime");
    const now = new Date("2026-10-23T21:30:00Z"); // 00:30 يوم 24 في بغداد
    expect(isFutureDateKey("2026-10-24", now, "Asia/Baghdad")).toBe(false);
    expect(isFutureDateKey("2026-10-23", now, "Asia/Baghdad")).toBe(false);
    expect(isFutureDateKey("2026-10-25", now, "Asia/Baghdad")).toBe(true);
  });
});
