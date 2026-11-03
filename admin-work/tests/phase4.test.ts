import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addDays, dayInput, today, todayStr } from "@/lib/dates";
import { COORDINATOR_DEFAULTS, type Actor } from "@/lib/rbac";
import { createPerson } from "@/lib/services/people";
import { createRequest, transitionRequest } from "@/lib/services/requests";
import { createTask, recordConsent, updateProgress } from "@/lib/services/tasks";
import { markAllRead, markRead, runNotificationScan, unreadCount } from "@/lib/services/notifications";
import { buildReport, parsePeriod, REPORT_KEYS } from "@/lib/services/reports";
import { reportHtml, reportToXlsx } from "@/lib/services/report-export";
import { makeUser } from "./helpers";

let admin: Actor;
let coord: Actor;
let viewer: Actor;
let person: string;

beforeAll(async () => {
  // حسابات المستخدمين من الاختبارات السابقة تُعطَّل حتى لا تؤثر في عدد المستلمين
  await prisma.user.updateMany({ data: { isActive: false } });
  admin = await makeUser("ADMIN");
  coord = await makeUser("COORDINATOR", [...COORDINATOR_DEFAULTS]);
  viewer = await makeUser("COORDINATOR", ["people.view"]);
  person = (await createPerson(admin, { fullName: "مكلف تنبيهات" })).id;
});

describe("التنبيهات", () => {
  it("طلب جديد ينبّه من يملك صلاحية الطلبات عدا من سجّله", async () => {
    const r = await createRequest(coord, { receivedAt: todayStr(), applicantName: "مقدم", type: "INQUIRY", description: "استفسار عام" });
    const ns = await prisma.notification.findMany({ where: { entityId: r.id, kind: "request_new" } });
    expect(ns.map((n) => n.userId).sort()).toEqual([admin.id]);
    expect(ns[0].link).toBe(`/requests/${r.id}`);
  });

  it("إسناد مهمة ينبّه الفريق", async () => {
    const t = await createTask(admin, { title: "مهمة تنبيه", assigneeId: person, dueDate: dayInput(addDays(today(), 1)) });
    const ns = await prisma.notification.findMany({ where: { entityId: t.id, kind: "task_new" } });
    expect(ns.map((n) => n.userId)).toEqual([coord.id]);
  });

  it("الفحص الدوري ينبّه بالاقتراب والتأخر دون تكرار، ويعيد التنبيه إذا تغير الموعد", async () => {
    const soon = await createRequest(coord, { receivedAt: todayStr(), applicantName: "قريب", type: "INQUIRY", description: "موعد قريب", followUpDate: dayInput(addDays(today(), 1)), ownerId: coord.id });
    const late = await createRequest(admin, { receivedAt: dayInput(addDays(today(), -5)), applicantName: "متأخر", type: "INQUIRY", description: "موعد فائت", followUpDate: dayInput(addDays(today(), -1)) });
    const t = await createTask(admin, { title: "مهمة متأخرة", assigneeId: person, dueDate: dayInput(today()) });
    await recordConsent(admin, t.id, { response: "ACCEPT" });
    await prisma.task.update({ where: { id: t.id }, data: { dueDate: addDays(today(), -1) } });

    await runNotificationScan();
    // الطلب الذي له مسؤول ينبّه المسؤول وحده
    expect((await prisma.notification.findMany({ where: { entityId: soon.id, kind: "request_due" } })).map((n) => n.userId)).toEqual([coord.id]);
    expect(await prisma.notification.count({ where: { entityId: late.id, kind: "request_overdue" } })).toBe(2);
    expect(await prisma.notification.count({ where: { entityId: t.id, kind: "task_overdue" } })).toBe(2);
    // لا يقبل من لا يملك الصلاحية تنبيهات الطلبات
    expect(await prisma.notification.count({ where: { userId: viewer.id, kind: { startsWith: "request" } } })).toBe(0);

    const before = await prisma.notification.count();
    const again = await runNotificationScan();
    expect(await prisma.notification.count()).toBe(before);
    expect(again.request_overdue + again.task_overdue + again.request_due).toBe(0);

    await prisma.request.update({ where: { id: soon.id }, data: { followUpDate: addDays(today(), 2) } });
    await runNotificationScan();
    expect(await prisma.notification.count({ where: { entityId: soon.id, kind: "request_due" } })).toBe(2);
  });

  it("تنبيه مجمّع بالسجلات التي لم تُحدَّث منذ مدة", async () => {
    const p = await createPerson(admin, { fullName: "سجل قديم للتنبيه", followUpOwnerId: coord.id });
    await prisma.$executeRaw`UPDATE "Person" SET "updatedAt" = now() - interval '200 days' WHERE id = ${p.id}::uuid`;
    await runNotificationScan();
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: coord.id, kind: "people_stale" } });
    expect(n.link).toContain(`owner=${coord.id}`);
  });

  it("القراءة: تعليم تنبيه أو الكل، ولا يقرأ أحد تنبيهات غيره", async () => {
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: admin.id, readAt: null } });
    expect(await markRead(coord.id, n.id)).toBeNull();
    await markRead(admin.id, n.id);
    const left = await unreadCount(admin.id);
    expect(await markAllRead(admin.id)).toBe(left);
    expect(await unreadCount(admin.id)).toBe(0);
  });
});

describe("التقارير", () => {
  it("الفترات: افتراضية، أسبوعية، شهرية، وتصحيح المقلوبة", () => {
    expect(parsePeriod("completeness", {})).toBeNull();
    expect(parsePeriod("people", {})).toBeNull();
    const w = parsePeriod("weekly", { to: "2026-03-10" })!;
    expect([w.from, w.to]).toEqual(["2026-03-04", "2026-03-10"]);
    const m = parsePeriod("monthly", { month: "2026-02" })!;
    expect([m.from, m.to, m.label]).toEqual(["2026-02-01", "2026-02-28", "شباط 2026"]);
    const r = parsePeriod("tasks", { from: "2026-05-10", to: "2026-05-01" })!;
    expect([r.from, r.to]).toEqual(["2026-05-01", "2026-05-10"]);
    expect(parsePeriod("tasks", { from: "bad" })!.to).toBe(todayStr());
  });

  it("كل التقارير الثمانية تُبنى وتتضمن الفترة وتاريخ الإعداد والإحصائيات، وتُصدَّر Excel وHTML", async () => {
    const r = await createRequest(coord, { receivedAt: todayStr(), applicantName: "تقرير", type: "ADMINISTRATIVE", description: "طلب للتقارير" });
    await transitionRequest(coord, r.id, { to: "DONE", note: "أنجز" });
    const t = await createTask(admin, { title: "مهمة التقارير", assigneeId: person, dueDate: dayInput(addDays(today(), 3)) });
    await recordConsent(admin, t.id, { response: "ACCEPT" });
    await updateProgress(admin, t.id, { status: "STUCK", progress: 20, obstacles: "نقص المواد" });
    for (const key of REPORT_KEYS) {
      const rep = await buildReport(key, parsePeriod(key, {}), "مدير اختبار");
      expect(rep.stats.length).toBeGreaterThan(0);
      expect(rep.generatedAt).toBeInstanceOf(Date);
      if (!["people", "completeness"].includes(key)) expect(rep.period).not.toBeNull();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load((await reportToXlsx(rep)) as unknown as ArrayBuffer);
      expect(wb.worksheets.length).toBe(rep.sections.length + 1);
      const html = await reportHtml(rep);
      expect(html).toContain(rep.title);
      expect(html).toContain("@font-face");
    }
    const outcome = await buildReport("requests-outcome", parsePeriod("requests-outcome", {}), "x");
    expect(outcome.sections[0].rows.map((row) => row[0])).toContain(r.number);
    const obst = await buildReport("obstacles", parsePeriod("obstacles", {}), "x");
    expect(obst.sections[0].rows.some((row) => row[5] === "نقص المواد")).toBe(true);
  });
});

describe("أمان عرض التقارير", () => {
  it("يهرّب أي نص قادم من قاعدة البيانات", async () => {
    const { renderReportHtml } = await import("@/components/report/report-html");
    const html = renderReportHtml({
      key: "people",
      title: "<script>x</script>",
      description: "d",
      period: null,
      generatedAt: new Date(),
      generatedBy: '"><img src=x onerror=alert(1)>',
      stats: [{ label: "a&b", value: 1 }],
      sections: [{ title: "s", columns: ["c"], rows: [["<b>bold</b>"]] }],
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>bold");
    expect(html).toContain("&lt;script&gt;");
  });
});
