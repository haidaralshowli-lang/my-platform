import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { addDays, fmtDay, parseDay, today, todayStr } from "@/lib/dates";
import { fmtDateTime } from "@/lib/format";
import { CONSENT, ENGAGEMENT, ENGAGEMENT_ORDER, PRIORITY, REQUEST_STATUS, REQUEST_STATUSES, REQUEST_TYPE, REQUEST_TYPES, TASK_STATUS } from "@/lib/labels";
import { OPEN_STATUSES, overdueWhere } from "./requests";
import { ACTIVE_TASK_STATUSES, overdueTaskWhere } from "./tasks";

// ─────────────────────────── البنية الموحدة للتقارير ───────────────────────────

export type Cell = string | number;
export type ReportSection = { title: string; note?: string; columns: string[]; rows: Cell[][]; empty?: string; truncated?: number };
export type ReportStat = { label: string; value: Cell; hint?: string };
export type Report = {
  key: ReportKey;
  title: string;
  description: string;
  period: { from: string; to: string; label: string } | null;
  generatedAt: Date;
  generatedBy: string;
  stats: ReportStat[];
  sections: ReportSection[];
};

export const REPORTS = {
  people: { title: "تقرير قاعدة البيانات", description: "حجم قاعدة بيانات الأشخاص وتوزيعها حسب المنطقة ومسؤول المتابعة ومستوى التفاعل.", period: "optional" },
  completeness: { title: "تقرير اكتمال البيانات", description: "نسبة اكتمال السجلات، والسجلات الناقصة، والسجلات التي تحتاج إلى تحديث.", period: "none" },
  "requests-received": { title: "تقرير الطلبات المستلمة", description: "الطلبات المستلمة خلال الفترة حسب النوع والحالة والجهة المختصة والمسؤول.", period: "range" },
  "requests-outcome": { title: "تقرير الطلبات المنجزة والمتأخرة", description: "ما أُنجز وما تعذر خلال الفترة ومدة الإنجاز، والطلبات المتأخرة حالياً عن موعد المتابعة.", period: "range" },
  tasks: { title: "تقرير المهام المسندة والمنجزة", description: "المهام المسندة والمنجزة خلال الفترة، وموافقات المكلفين، والأداء حسب الشخص المكلف.", period: "range" },
  obstacles: { title: "تقرير المعوقات", description: "المهام المتعثرة ومعوقاتها، واعتذارات المكلفين وطلبات تعديل المواعيد، وأسباب تعذر الطلبات.", period: "range" },
  weekly: { title: "التقرير الأسبوعي الشامل", description: "ملخص شامل لآخر سبعة أيام: الأشخاص والطلبات والمهام.", period: "week" },
  monthly: { title: "التقرير الشهري الشامل", description: "ملخص شامل لشهر كامل: الأشخاص والطلبات والمهام.", period: "month" },
} as const;

export type ReportKey = keyof typeof REPORTS;
export const REPORT_KEYS = Object.keys(REPORTS) as ReportKey[];
export const MAX_ROWS = 1000;

// ─────────────────────────── الفترة الزمنية ───────────────────────────

const TZ = process.env.APP_TIMEZONE || "Asia/Baghdad";

/// بداية يوم محلي (بالمنطقة الزمنية للمنصة) كلحظة UTC، لمقارنة الحقول الزمنية (تاريخ الإنشاء، أحداث السجل)
function localDayStart(day: string): Date {
  const guess = new Date(`${day}T00:00:00.000Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(guess)
      .map((p) => [p.type, p.value]),
  );
  const asLocal = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess.getTime() - (asLocal - guess.getTime()));
}

export type Period = { from: string; to: string; label: string; fromDay: Date; toDay: Date; start: Date; end: Date };

function mkPeriod(from: string, to: string, label?: string): Period {
  return {
    from,
    to,
    label: label ?? `من \u2066${from}\u2069 إلى \u2066${to}\u2069`,
    fromDay: parseDay(from)!,
    toDay: parseDay(to)!,
    start: localDayStart(from),
    end: localDayStart(fmtDay(addDays(parseDay(to)!, 1))),
  };
}

const MONTHS = ["كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول"];

/// يستخرج الفترة من معاملات الرابط حسب نوع التقرير، مع قيم افتراضية معقولة ورفض المدد غير المنطقية
export function parsePeriod(key: ReportKey, sp: Record<string, string | undefined>): Period | null {
  const mode = REPORTS[key].period;
  const valid = (s?: string) => {
    try {
      return s && parseDay(s) ? s : undefined;
    } catch {
      return undefined;
    }
  };
  const t = todayStr();
  if (mode === "none") return null;
  if (mode === "week") {
    const to = valid(sp.to) ?? t;
    return mkPeriod(fmtDay(addDays(parseDay(to)!, -6)), to, undefined);
  }
  if (mode === "month") {
    const m = sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : t.slice(0, 7);
    const [y, mm] = m.split("-").map(Number);
    const last = new Date(Date.UTC(y, mm, 0)).getUTCDate();
    return mkPeriod(`${m}-01`, `${m}-${String(last).padStart(2, "0")}`, `${MONTHS[mm - 1]} ${y}`);
  }
  const from = valid(sp.from);
  const to = valid(sp.to);
  if (mode === "optional" && !from && !to) return null;
  const f = from ?? fmtDay(addDays(today(), -29));
  const e = to ?? t;
  return f <= e ? mkPeriod(f, e) : mkPeriod(e, f);
}

// ─────────────────────────── أدوات ───────────────────────────

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

function section(title: string, columns: string[], rows: Cell[][], opts: { note?: string; empty?: string; total?: number } = {}): ReportSection {
  const total = opts.total ?? rows.length;
  return { title, columns, rows: rows.slice(0, MAX_ROWS), note: opts.note, empty: opts.empty ?? "لا توجد بيانات.", truncated: total > MAX_ROWS ? total : undefined };
}

async function nameMaps() {
  const [regions, users] = await Promise.all([prisma.region.findMany({ select: { id: true, name: true } }), prisma.user.findMany({ select: { id: true, fullName: true } })]);
  return { region: new Map(regions.map((r) => [r.id, r.name])), user: new Map(users.map((u) => [u.id, u.fullName])) };
}

const livePerson = { deletedAt: null } as const;
const liveReq = { deletedAt: null } as const;
const liveTask = { deletedAt: null } as const;

// ─────────────────────────── 1. قاعدة البيانات ───────────────────────────

async function peopleReport(p: Period | null) {
  const m = await nameMaps();
  const [total, complete, incomplete, needsUpdate, available, byRegion, byOwner, byEng, added] = await Promise.all([
    prisma.person.count({ where: livePerson }),
    prisma.person.count({ where: { ...livePerson, dataStatus: "COMPLETE" } }),
    prisma.person.count({ where: { ...livePerson, dataStatus: "INCOMPLETE" } }),
    prisma.person.count({ where: { ...livePerson, dataStatus: "NEEDS_UPDATE" } }),
    prisma.person.count({ where: { ...livePerson, availableForWork: true } }),
    prisma.person.groupBy({ by: ["regionId", "dataStatus"], where: livePerson, _count: { _all: true } }),
    prisma.person.groupBy({ by: ["followUpOwnerId", "dataStatus"], where: livePerson, _count: { _all: true } }),
    prisma.person.groupBy({ by: ["engagementLevel"], where: livePerson, _count: { _all: true } }),
    p ? prisma.person.count({ where: { ...livePerson, createdAt: { gte: p.start, lt: p.end } } }) : Promise.resolve(null),
  ]);
  const pivot = <K,>(rows: { key: K; status: string; n: number }[], name: (k: K) => string) => {
    const acc = new Map<K, { total: number; COMPLETE: number; INCOMPLETE: number; NEEDS_UPDATE: number }>();
    for (const r of rows) {
      const a = acc.get(r.key) ?? { total: 0, COMPLETE: 0, INCOMPLETE: 0, NEEDS_UPDATE: 0 };
      a.total += r.n;
      a[r.status as "COMPLETE"] += r.n;
      acc.set(r.key, a);
    }
    return [...acc]
      .sort((x, y) => y[1].total - x[1].total)
      .map(([k, a]) => [name(k), a.total, a.COMPLETE, a.INCOMPLETE, a.NEEDS_UPDATE, pct(a.COMPLETE, a.total)] as Cell[]);
  };
  const cols = ["", "الإجمالي", "مكتملة", "ناقصة", "بانتظار التحديث", "نسبة الاكتمال"];
  const stats: ReportStat[] = [
    { label: "إجمالي السجلات", value: total },
    { label: "مكتملة", value: complete, hint: pct(complete, total) },
    { label: "ناقصة", value: incomplete },
    { label: "بانتظار التحديث", value: needsUpdate },
    { label: "متاحون للتعاون الإداري", value: available },
  ];
  if (added !== null) stats.push({ label: "أُضيفت خلال الفترة", value: added });
  return {
    stats,
    sections: [
      section("التوزيع حسب المحافظة أو المنطقة", ["المنطقة", ...cols.slice(1)], pivot(byRegion.map((r) => ({ key: r.regionId, status: r.dataStatus, n: r._count._all })), (k) => (k ? (m.region.get(k) ?? "—") : "غير محددة"))),
      section("التوزيع حسب مسؤول المتابعة", ["مسؤول المتابعة", ...cols.slice(1)], pivot(byOwner.map((r) => ({ key: r.followUpOwnerId, status: r.dataStatus, n: r._count._all })), (k) => (k ? (m.user.get(k) ?? "—") : "غير محدد"))),
      section(
        "التوزيع حسب مستوى التفاعل الإداري",
        ["مستوى التفاعل", "العدد", "النسبة"],
        ENGAGEMENT_ORDER.map((e) => {
          const n = byEng.find((g) => g.engagementLevel === e)?._count._all ?? 0;
          return [ENGAGEMENT[e].label, n, pct(n, total)];
        }),
      ),
    ],
  };
}

// ─────────────────────────── 2. اكتمال البيانات ───────────────────────────

async function completenessReport() {
  const m = await nameMaps();
  const staleDays = await getSetting(prisma, "people.staleDays");
  const cutoff = new Date(Date.now() - staleDays * 86_400_000);
  const needsWhere: Prisma.PersonWhereInput = { ...livePerson, OR: [{ dataStatus: "NEEDS_UPDATE" }, { updatedAt: { lt: cutoff } }] };
  const [total, complete, incomplete, noRegion, noOwner, noPhone, needsCount, incompleteRows, needsRows] = await Promise.all([
    prisma.person.count({ where: livePerson }),
    prisma.person.count({ where: { ...livePerson, dataStatus: "COMPLETE" } }),
    prisma.person.count({ where: { ...livePerson, dataStatus: "INCOMPLETE" } }),
    prisma.person.count({ where: { ...livePerson, regionId: null } }),
    prisma.person.count({ where: { ...livePerson, followUpOwnerId: null } }),
    prisma.person.count({ where: { ...livePerson, phone: null } }),
    prisma.person.count({ where: needsWhere }),
    prisma.person.findMany({ where: { ...livePerson, dataStatus: "INCOMPLETE" }, orderBy: { serial: "asc" }, take: MAX_ROWS }),
    prisma.person.findMany({ where: needsWhere, orderBy: { updatedAt: "asc" }, take: MAX_ROWS }),
  ]);
  return {
    stats: [
      { label: "نسبة الاكتمال", value: pct(complete, total), hint: `${complete} من ${total}` },
      { label: "سجلات ناقصة", value: incomplete },
      { label: "تحتاج إلى تحديث", value: needsCount, hint: `بانتظار التحديث أو أقدم من ${staleDays} يوماً` },
      { label: "دون منطقة", value: noRegion },
      { label: "دون مسؤول متابعة", value: noOwner },
      { label: "دون رقم هاتف", value: noPhone, hint: "الهاتف اختياري" },
    ],
    sections: [
      section(
        "السجلات الناقصة",
        ["الرقم", "الاسم الكامل", "الحقول الناقصة", "مسؤول المتابعة", "آخر تحديث"],
        incompleteRows.map((r) => [r.serial, r.fullName, [!r.regionId && "المنطقة", !r.followUpOwnerId && "مسؤول المتابعة"].filter(Boolean).join("، "), r.followUpOwnerId ? (m.user.get(r.followUpOwnerId) ?? "—") : "—", fmtDay(r.updatedAt)]),
        { total: incomplete, empty: "لا توجد سجلات ناقصة." },
      ),
      section(
        "السجلات التي تحتاج إلى تحديث",
        ["الرقم", "الاسم الكامل", "السبب", "المنطقة", "مسؤول المتابعة", "آخر تحديث"],
        needsRows.map((r) => [
          r.serial,
          r.fullName,
          [r.dataStatus === "NEEDS_UPDATE" && "معلَّم بانتظار التحديث", r.updatedAt < cutoff && `لم يُحدَّث منذ ${Math.floor((Date.now() - r.updatedAt.getTime()) / 86_400_000)} يوماً`].filter(Boolean).join("، "),
          r.regionId ? (m.region.get(r.regionId) ?? "—") : "—",
          r.followUpOwnerId ? (m.user.get(r.followUpOwnerId) ?? "—") : "—",
          fmtDay(r.updatedAt),
        ]),
        { total: needsCount, empty: "لا توجد سجلات تحتاج إلى تحديث." },
      ),
    ],
  };
}

// ─────────────────────────── 3. الطلبات المستلمة ───────────────────────────

const reqInclude = { owner: { select: { fullName: true } }, authority: { select: { name: true } } } as const;

async function requestsReceivedReport(p: Period) {
  const where: Prisma.RequestWhereInput = { ...liveReq, receivedAt: { gte: p.fromDay, lte: p.toDay } };
  const [rows, byType, byStatus, byAuthority, byOwner, authorities, m] = await Promise.all([
    prisma.request.findMany({ where, orderBy: { receivedAt: "asc" }, take: MAX_ROWS, include: reqInclude }),
    prisma.request.groupBy({ by: ["type"], where, _count: { _all: true } }),
    prisma.request.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.request.groupBy({ by: ["authorityId"], where, _count: { _all: true } }),
    prisma.request.groupBy({ by: ["ownerId"], where, _count: { _all: true } }),
    prisma.authority.findMany({ select: { id: true, name: true } }),
    nameMaps(),
  ]);
  const total = byType.reduce((s, g) => s + g._count._all, 0);
  const cnt = (s: string) => byStatus.find((g) => g.status === s)?._count._all ?? 0;
  const aName = new Map(authorities.map((a) => [a.id, a.name]));
  return {
    stats: [
      { label: "الطلبات المستلمة", value: total },
      { label: "ما زالت مفتوحة", value: OPEN_STATUSES.reduce((s, x) => s + cnt(x), 0) },
      { label: "منجزة", value: cnt("DONE") },
      { label: "متعذرة", value: cnt("FAILED") },
      { label: "مغلقة", value: cnt("CLOSED") },
    ],
    sections: [
      section("حسب نوع الطلب", ["النوع", "العدد", "النسبة"], REQUEST_TYPES.map((t) => {
        const n = byType.find((g) => g.type === t)?._count._all ?? 0;
        return [REQUEST_TYPE[t], n, pct(n, total)];
      })),
      section("حسب الحالة الحالية", ["الحالة", "العدد", "النسبة"], REQUEST_STATUSES.map((s) => [REQUEST_STATUS[s].label, cnt(s), pct(cnt(s), total)])),
      section("حسب الجهة المختصة", ["الجهة", "العدد"], byAuthority.sort((a, b) => b._count._all - a._count._all).map((g) => [g.authorityId ? (aName.get(g.authorityId) ?? "—") : "غير محددة", g._count._all])),
      section("حسب المسؤول عن المتابعة", ["المسؤول", "العدد"], byOwner.sort((a, b) => b._count._all - a._count._all).map((g) => [g.ownerId ? (m.user.get(g.ownerId) ?? "—") : "غير محدد", g._count._all])),
      section(
        "قائمة الطلبات المستلمة",
        ["رقم الطلب", "تاريخ الاستلام", "مقدم الطلب", "النوع", "الحالة", "المسؤول", "الأولوية"],
        rows.map((r) => [r.number, fmtDay(r.receivedAt), r.applicantName, REQUEST_TYPE[r.type], REQUEST_STATUS[r.status].label, r.owner?.fullName ?? "—", PRIORITY[r.priority].label]),
        { total, empty: "لم تُستلم طلبات خلال الفترة." },
      ),
    ],
  };
}

// ─────────────────────────── 4. المنجزة والمتأخرة ───────────────────────────

/// الطلبات التي انتقلت إلى حالة معينة خلال الفترة (آخر انتقال لكل طلب)
async function transitionedIn(p: Period, to: "DONE" | "FAILED") {
  const events = await prisma.requestEvent.findMany({
    where: { toStatus: to, at: { gte: p.start, lt: p.end }, request: { deletedAt: null } },
    orderBy: { at: "desc" },
    include: { request: { include: reqInclude } },
  });
  const seen = new Set<string>();
  return events.filter((e) => (seen.has(e.requestId) ? false : (seen.add(e.requestId), true)));
}

async function requestsOutcomeReport(p: Period) {
  const [done, failed, overdue] = await Promise.all([
    transitionedIn(p, "DONE"),
    transitionedIn(p, "FAILED"),
    prisma.request.findMany({ where: { ...liveReq, ...overdueWhere() }, orderBy: { followUpDate: "asc" }, take: MAX_ROWS, include: reqInclude }),
  ]);
  const days = done.map((e) => Math.max(0, Math.round((parseDay(todayStr(e.at))!.getTime() - e.request.receivedAt.getTime()) / 86_400_000)));
  const avg = days.length ? (days.reduce((a, b) => a + b, 0) / days.length).toFixed(1) : "—";
  const t = today();
  return {
    stats: [
      { label: "أُنجزت خلال الفترة", value: done.length },
      { label: "تعذرت خلال الفترة", value: failed.length },
      { label: "نسبة الإنجاز من المحسوم", value: pct(done.length, done.length + failed.length) },
      { label: "متوسط مدة الإنجاز", value: avg, hint: "بالأيام من الاستلام" },
      { label: "متأخرة حالياً", value: overdue.length, hint: "فات موعد متابعتها" },
    ],
    sections: [
      section(
        "الطلبات المنجزة خلال الفترة",
        ["رقم الطلب", "مقدم الطلب", "النوع", "الاستلام", "الإنجاز", "المدة (يوم)", "الإجراء"],
        done.map((e, i) => [e.request.number, e.request.applicantName, REQUEST_TYPE[e.request.type], fmtDay(e.request.receivedAt), fmtDateTime(e.at), days[i], e.note ?? "—"]),
        { empty: "لم يُنجز أي طلب خلال الفترة." },
      ),
      section(
        "الطلبات المتعذرة خلال الفترة",
        ["رقم الطلب", "مقدم الطلب", "النوع", "تاريخ التعذر", "السبب"],
        failed.map((e) => [e.request.number, e.request.applicantName, REQUEST_TYPE[e.request.type], fmtDateTime(e.at), e.request.failureReason ?? e.note ?? "—"]),
        { empty: "لم يتعذر أي طلب خلال الفترة." },
      ),
      section(
        "الطلبات المتأخرة عن موعد المتابعة (حتى تاريخ التقرير)",
        ["رقم الطلب", "مقدم الطلب", "الحالة", "المسؤول", "موعد المتابعة", "أيام التأخر", "آخر إجراء"],
        overdue.map((r) => [r.number, r.applicantName, REQUEST_STATUS[r.status].label, r.owner?.fullName ?? "—", fmtDay(r.followUpDate), Math.round((t.getTime() - r.followUpDate!.getTime()) / 86_400_000), r.lastAction ?? "—"]),
        { empty: "لا توجد طلبات متأخرة." },
      ),
    ],
  };
}

// ─────────────────────────── 5. المهام ───────────────────────────

async function tasksReport(p: Period) {
  const assignedWhere: Prisma.TaskWhereInput = { ...liveTask, createdAt: { gte: p.start, lt: p.end } };
  const [assigned, doneEvents, acceptedEvents, declinedEvents, overdueNow, pending] = await Promise.all([
    prisma.task.findMany({ where: assignedWhere, include: { assignee: { select: { id: true, fullName: true, serial: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.taskEvent.findMany({ where: { kind: "progress", toStatus: "DONE", at: { gte: p.start, lt: p.end }, task: { deletedAt: null } }, include: { task: { include: { assignee: { select: { id: true, fullName: true } } } } }, orderBy: { at: "asc" } }),
    prisma.taskEvent.count({ where: { kind: { in: ["accepted", "change_approved"] }, at: { gte: p.start, lt: p.end }, task: { deletedAt: null } } }),
    prisma.taskEvent.count({ where: { kind: "declined", at: { gte: p.start, lt: p.end }, task: { deletedAt: null } } }),
    prisma.task.findMany({ where: { ...liveTask, ...overdueTaskWhere() }, include: { assignee: { select: { id: true, fullName: true } } } }),
    prisma.task.findMany({ where: { ...liveTask, consentStatus: { in: ["PENDING", "CHANGE_REQUESTED"] }, status: { not: "CANCELLED" } }, include: { assignee: { select: { fullName: true } } }, orderBy: { createdAt: "asc" }, take: MAX_ROWS }),
  ]);
  const doneUnique = [...new Map(doneEvents.map((e) => [e.taskId, e])).values()];
  const byPerson = new Map<string, { name: string; assigned: number; done: number; stuck: number; overdue: number }>();
  const bump = (id: string, name: string, k: "assigned" | "done" | "stuck" | "overdue") => {
    const r = byPerson.get(id) ?? { name, assigned: 0, done: 0, stuck: 0, overdue: 0 };
    r[k]++;
    byPerson.set(id, r);
  };
  for (const t of assigned) {
    bump(t.assigneeId, t.assignee.fullName, "assigned");
    if (t.status === "STUCK") bump(t.assigneeId, t.assignee.fullName, "stuck");
  }
  for (const e of doneUnique) bump(e.task.assigneeId, e.task.assignee.fullName, "done");
  for (const t of overdueNow) bump(t.assigneeId, t.assignee.fullName, "overdue");
  const onTime = doneUnique.filter((e) => todayStr(e.at) <= fmtDay(e.task.dueDate)).length;
  return {
    stats: [
      { label: "مهام أُسندت خلال الفترة", value: assigned.length },
      { label: "موافقات المكلفين", value: acceptedEvents },
      { label: "اعتذارات", value: declinedEvents },
      { label: "أُنجزت خلال الفترة", value: doneUnique.length },
      { label: "أُنجزت في موعدها", value: pct(onTime, doneUnique.length) },
      { label: "متأخرة حالياً", value: overdueNow.length },
    ],
    sections: [
      section(
        "حسب الشخص المكلف",
        ["المكلف", "أُسندت في الفترة", "أُنجزت في الفترة", "متعثرة", "متأخرة حالياً"],
        [...byPerson.values()].sort((a, b) => b.assigned + b.done - (a.assigned + a.done)).map((r) => [r.name, r.assigned, r.done, r.stuck, r.overdue]),
        { empty: "لا توجد مهام خلال الفترة." },
      ),
      section(
        "المهام المسندة خلال الفترة",
        ["رقم المهمة", "العنوان", "المكلف", "تاريخ الإسناد", "الموعد", "الموافقة", "الحالة", "الإنجاز"],
        assigned.map((t) => [t.number, t.title, t.assignee.fullName, fmtDay(t.createdAt), fmtDay(t.dueDate), CONSENT[t.consentStatus].label, TASK_STATUS[t.status].label, `${t.progress}%`]),
        { empty: "لم تُسند مهام خلال الفترة." },
      ),
      section(
        "المهام المنجزة خلال الفترة",
        ["رقم المهمة", "العنوان", "المكلف", "الموعد", "تاريخ الإنجاز", "في الموعد", "النتيجة"],
        doneUnique.map((e) => [e.task.number, e.task.title, e.task.assignee.fullName, fmtDay(e.task.dueDate), fmtDateTime(e.at), todayStr(e.at) <= fmtDay(e.task.dueDate) ? "نعم" : "لا", e.task.finalResult ?? "—"]),
        { empty: "لم تُنجز مهام خلال الفترة." },
      ),
      section(
        "مهام بانتظار موافقة المكلف (حتى تاريخ التقرير)",
        ["رقم المهمة", "العنوان", "المكلف", "الموعد", "الحالة"],
        pending.map((t) => [t.number, t.title, t.assignee.fullName, fmtDay(t.dueDate), CONSENT[t.consentStatus].label]),
        { empty: "لا توجد مهام بانتظار الموافقة." },
      ),
    ],
  };
}

// ─────────────────────────── 6. المعوقات ───────────────────────────

async function obstaclesReport(p: Period) {
  const inP = { at: { gte: p.start, lt: p.end }, task: { deletedAt: null } };
  const [stuck, obstacleEvents, declines, changes, failed] = await Promise.all([
    prisma.task.findMany({ where: { ...liveTask, status: "STUCK" }, include: { assignee: { select: { fullName: true } } }, orderBy: { lastUpdateAt: "asc" } }),
    prisma.taskEvent.findMany({ where: { ...inP, kind: "progress", toStatus: "STUCK" }, include: { task: { select: { number: true, title: true } }, user: { select: { fullName: true } } }, orderBy: { at: "asc" } }),
    prisma.taskEvent.findMany({ where: { ...inP, kind: "declined" }, include: { task: { select: { number: true, title: true } } }, orderBy: { at: "asc" } }),
    prisma.taskEvent.findMany({ where: { ...inP, kind: "change_requested" }, include: { task: { select: { number: true, title: true } } }, orderBy: { at: "asc" } }),
    transitionedIn(p, "FAILED"),
  ]);
  const reasons = new Map<string, number>();
  for (const e of failed) {
    const r = (e.request.failureReason ?? e.note ?? "—").trim();
    reasons.set(r, (reasons.get(r) ?? 0) + 1);
  }
  return {
    stats: [
      { label: "مهام متعثرة حالياً", value: stuck.length },
      { label: "حالات تعثر سُجلت في الفترة", value: obstacleEvents.length },
      { label: "اعتذارات المكلفين", value: declines.length },
      { label: "طلبات تعديل موعد", value: changes.length },
      { label: "طلبات متعذرة", value: failed.length },
    ],
    sections: [
      section(
        "المهام المتعثرة حالياً ومعوقاتها",
        ["رقم المهمة", "العنوان", "المكلف", "الموعد", "الإنجاز", "المعوقات", "آخر تحديث"],
        stuck.map((t) => [t.number, t.title, t.assignee.fullName, fmtDay(t.dueDate), `${t.progress}%`, t.obstacles ?? "—", fmtDateTime(t.lastUpdateAt)]),
        { empty: "لا توجد مهام متعثرة." },
      ),
      section("حالات التعثر المسجلة خلال الفترة", ["التاريخ", "المهمة", "التفاصيل", "سجّلها"], obstacleEvents.map((e) => [fmtDateTime(e.at), `${e.task.number} — ${e.task.title}`, e.note ?? "—", e.user?.fullName ?? "—"]), { empty: "لم تُسجَّل حالات تعثر." }),
      section("اعتذارات المكلفين", ["التاريخ", "المهمة", "التفاصيل"], declines.map((e) => [fmtDateTime(e.at), `${e.task.number} — ${e.task.title}`, e.note ?? "—"]), { empty: "لا توجد اعتذارات." }),
      section("طلبات تعديل المواعيد", ["التاريخ", "المهمة", "التفاصيل"], changes.map((e) => [fmtDateTime(e.at), `${e.task.number} — ${e.task.title}`, e.note ?? "—"]), { empty: "لا توجد طلبات تعديل." }),
      section("أسباب تعذر الطلبات", ["السبب", "عدد الطلبات"], [...reasons].sort((a, b) => b[1] - a[1]), { empty: "لا توجد طلبات متعذرة خلال الفترة." }),
    ],
  };
}

// ─────────────────────────── 7 و8. الشامل ───────────────────────────

async function comprehensiveReport(p: Period, monthly: boolean) {
  const [peopleAdded, peopleUpdated, totalPeople, completePeople, received, outcome, tasks, obstacles, reqOverdueNow, openReq] = await Promise.all([
    prisma.person.count({ where: { ...livePerson, createdAt: { gte: p.start, lt: p.end } } }),
    prisma.person.count({ where: { ...livePerson, updatedAt: { gte: p.start, lt: p.end }, createdAt: { lt: p.start } } }),
    prisma.person.count({ where: livePerson }),
    prisma.person.count({ where: { ...livePerson, dataStatus: "COMPLETE" } }),
    requestsReceivedReport(p),
    requestsOutcomeReport(p),
    tasksReport(p),
    obstaclesReport(p),
    prisma.request.count({ where: { ...liveReq, ...overdueWhere() } }),
    prisma.request.count({ where: { ...liveReq, status: { in: OPEN_STATUSES } } }),
  ]);
  const activeTasks = await prisma.task.count({ where: { ...liveTask, status: { in: ACTIVE_TASK_STATUSES } } });
  const stat = (r: { stats: ReportStat[] }, label: string) => r.stats.find((s) => s.label === label)?.value ?? 0;
  const pick = (r: { sections: ReportSection[] }, title: string, rename?: string) => {
    const s = r.sections.find((x) => x.title === title)!;
    return rename ? { ...s, title: rename } : s;
  };
  const stats: ReportStat[] = [
    { label: "أشخاص أُضيفوا", value: peopleAdded },
    { label: "سجلات حُدِّثت", value: peopleUpdated },
    { label: "نسبة اكتمال قاعدة البيانات", value: pct(completePeople, totalPeople) },
    { label: "طلبات مستلمة", value: stat(received, "الطلبات المستلمة") },
    { label: "طلبات أُنجزت", value: stat(outcome, "أُنجزت خلال الفترة") },
    { label: "طلبات تعذرت", value: stat(outcome, "تعذرت خلال الفترة") },
    { label: "طلبات مفتوحة / متأخرة", value: `${openReq} / ${reqOverdueNow}` },
    { label: "مهام أُسندت", value: stat(tasks, "مهام أُسندت خلال الفترة") },
    { label: "مهام أُنجزت", value: stat(tasks, "أُنجزت خلال الفترة") },
    { label: "مهام جارية / متعثرة", value: `${activeTasks} / ${stat(obstacles, "مهام متعثرة حالياً")}` },
  ];
  const sections = [
    pick(received, "حسب نوع الطلب", "الطلبات المستلمة حسب النوع"),
    ...(monthly ? [pick(received, "حسب الجهة المختصة", "الطلبات المستلمة حسب الجهة المختصة")] : []),
    pick(outcome, "الطلبات المنجزة خلال الفترة"),
    pick(outcome, "الطلبات المتأخرة عن موعد المتابعة (حتى تاريخ التقرير)"),
    pick(tasks, "حسب الشخص المكلف", "المهام حسب الشخص المكلف"),
    pick(tasks, "المهام المنجزة خلال الفترة"),
    pick(obstacles, "المهام المتعثرة حالياً ومعوقاتها"),
    ...(monthly ? [pick(obstacles, "أسباب تعذر الطلبات")] : []),
  ];
  return { stats, sections };
}

// ─────────────────────────── نقطة الدخول ───────────────────────────

export async function buildReport(key: ReportKey, period: Period | null, generatedBy: string): Promise<Report> {
  const need = () => {
    if (!period) throw new Error("الفترة مطلوبة لهذا التقرير");
    return period;
  };
  const body =
    key === "people"
      ? await peopleReport(period)
      : key === "completeness"
        ? await completenessReport()
        : key === "requests-received"
          ? await requestsReceivedReport(need())
          : key === "requests-outcome"
            ? await requestsOutcomeReport(need())
            : key === "tasks"
              ? await tasksReport(need())
              : key === "obstacles"
                ? await obstaclesReport(need())
                : await comprehensiveReport(need(), key === "monthly");
  return {
    key,
    title: REPORTS[key].title,
    description: REPORTS[key].description,
    period: period ? { from: period.from, to: period.to, label: period.label } : null,
    generatedAt: new Date(),
    generatedBy,
    ...body,
  };
}
