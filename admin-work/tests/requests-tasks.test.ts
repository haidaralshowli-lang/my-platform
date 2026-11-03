import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addDays, dayInput, today, todayStr } from "@/lib/dates";
import { COORDINATOR_DEFAULTS, type Actor } from "@/lib/rbac";
import { createPerson } from "@/lib/services/people";
import {
  addRequestAction,
  allowedTransitions,
  createRequest,
  deleteRequest,
  exportRequests,
  listRequests,
  requestFilterSchema,
  transitionRequest,
  updateRequest,
} from "@/lib/services/requests";
import {
  approveTaskClosure,
  cancelTask,
  createTask,
  decideDueDateChange,
  listTasks,
  reassignTask,
  recordConsent,
  reopenTask,
  taskFilterSchema,
  updateProgress,
  updateTaskDetails,
} from "@/lib/services/tasks";
import { requestIndicators, taskIndicators } from "@/lib/services/dashboard";
import { makeUser } from "./helpers";

let admin: Actor;
let coord: Actor;
let authorityId: number;
let personA: string;
let personB: string;

const base = (over: Record<string, unknown> = {}) => ({
  receivedAt: todayStr(),
  applicantName: "مقدم طلب تجريبي",
  type: "ADMINISTRATIVE" as const,
  description: "وصف طلب للاختبار",
  ...over,
});

beforeAll(async () => {
  admin = await makeUser("ADMIN");
  coord = await makeUser("COORDINATOR", [...COORDINATOR_DEFAULTS]);
  authorityId = (await prisma.authority.create({ data: { name: `جهة اختبار ${Date.now()}` } })).id;
  personA = (await createPerson(admin, { fullName: "مكلف أول للاختبار" })).id;
  personB = (await createPerson(admin, { fullName: "مكلف ثان للاختبار" })).id;
});

describe("الطلبات", () => {
  it("ترقيم تلقائي متسلسل دون تكرار حتى مع الإنشاء المتزامن", async () => {
    const rs = await Promise.all(Array.from({ length: 8 }, () => createRequest(coord, base())));
    const nums = rs.map((r) => r.number);
    expect(new Set(nums).size).toBe(8);
    expect(nums.every((n) => /^REQ-\d{4}-\d{4}$/.test(n))).toBe(true);
  });

  it("يرفض تاريخ استلام مستقبلي وموعد متابعة قبل الاستلام", async () => {
    await expect(createRequest(coord, base({ receivedAt: dayInput(addDays(today(), 2)) }))).rejects.toThrow();
    await expect(createRequest(coord, base({ receivedAt: todayStr(), followUpDate: dayInput(addDays(today(), -3)) }))).rejects.toThrow();
  });

  it("سير الحالات مع السجل الزمني: مراجعة ← إحالة ← متابعة ← منجز ← إغلاق (للمدير) ← إعادة فتح", async () => {
    const r = await createRequest(coord, base());
    await transitionRequest(coord, r.id, { to: "UNDER_REVIEW", note: "بدء المراجعة" });
    await expect(transitionRequest(coord, r.id, { to: "REFERRED", note: "إحالة" })).rejects.toThrow(/الجهة المختصة/);
    await transitionRequest(coord, r.id, { to: "REFERRED", note: "أحيل بكتاب رسمي", authorityId });
    await transitionRequest(coord, r.id, { to: "FOLLOWING", note: "متابعة هاتفية", followUpDate: dayInput(addDays(today(), 5)) });
    await transitionRequest(coord, r.id, { to: "DONE", note: "أُنجز" });
    expect(allowedTransitions(coord, "DONE")).toEqual(["FOLLOWING"]);
    await expect(transitionRequest(coord, r.id, { to: "CLOSED", note: "إغلاق" })).rejects.toThrow();
    const closed = await transitionRequest(admin, r.id, { to: "CLOSED", note: "اعتماد الإغلاق" });
    expect(closed.closedAt).not.toBeNull();
    await expect(addRequestAction(coord, r.id, { note: "ملاحظة" })).rejects.toThrow(/مغلق/);
    await expect(updateRequest(coord, r.id, base())).rejects.toThrow(/مغلق/);
    const reopened = await transitionRequest(admin, r.id, { to: "FOLLOWING", note: "ظهر نقص" });
    expect(reopened.closedAt).toBeNull();
    const events = await prisma.requestEvent.findMany({ where: { requestId: r.id }, orderBy: { id: "asc" } });
    expect(events.map((e) => e.kind)).toEqual(["created", "status", "status", "status", "status", "closed", "reopened"]);
    expect(events.every((e) => e.userId)).toBe(true);
    // انتقال غير مسموح
    await expect(transitionRequest(admin, r.id, { to: "NEW", note: "رجوع" })).rejects.toThrow(/لا يمكن نقل/);
  });

  it("التعذر يتطلب سبباً، والإغلاق على تعذر يُحتسب متعذراً لا منجزاً", async () => {
    const before = await requestIndicators();
    const r = await createRequest(coord, base());
    await expect(transitionRequest(coord, r.id, { to: "FAILED", note: "تعذر" })).rejects.toThrow(/سبب/);
    await transitionRequest(coord, r.id, { to: "FAILED", note: "تعذر", failureReason: "خارج الاختصاص" });
    await transitionRequest(admin, r.id, { to: "CLOSED", note: "إغلاق" });
    const after = await requestIndicators();
    expect(after.failed).toBe(before.failed + 1);
    expect(after.done).toBe(before.done);
    expect(after.total).toBe(before.total + 1);
  });

  it("الطلب المتأخر عن موعد المتابعة يظهر في المؤشر والكشف والتصدير", async () => {
    const r = await createRequest(coord, base({ receivedAt: dayInput(addDays(today(), -10)), followUpDate: dayInput(addDays(today(), -1)) }));
    const ind = await requestIndicators();
    const { rows, total } = await listRequests(requestFilterSchema.parse({ overdue: "1" }));
    expect(total).toBe(ind.overdue);
    expect(rows.map((x) => x.id)).toContain(r.id);
    const exp = await exportRequests(coord, requestFilterSchema.parse({ overdue: "1" }));
    expect(exp.count).toBe(ind.overdue);
    // تسجيل إجراء بموعد جديد يرفع التأخر
    await addRequestAction(coord, r.id, { note: "اتصال", followUpDate: dayInput(addDays(today(), 3)) });
    expect((await requestIndicators()).overdue).toBe(ind.overdue - 1);
  });

  it("الحذف للمدير فقط، ويختفي الطلب من القوائم", async () => {
    const r = await createRequest(coord, base({ applicantName: "طلب سيحذف" }));
    await expect(deleteRequest(coord, r.id, "خطأ")).rejects.toThrow();
    await deleteRequest(admin, r.id, "تسجيل مكرر");
    expect((await listRequests(requestFilterSchema.parse({ q: "طلب سيحذف" }))).total).toBe(0);
  });
});

describe("المهام وموافقة المكلف", () => {
  it("المهمة تبدأ بانتظار الموافقة، ولا يُسجَّل إنجاز قبل موافقة المكلف", async () => {
    const t = await createTask(coord, { title: "تجهيز كشف", assigneeId: personA, dueDate: dayInput(addDays(today(), 7)) });
    expect(t.number).toMatch(/^TSK-\d{4}-\d{4}$/);
    expect(t.consentStatus).toBe("PENDING");
    await expect(updateProgress(coord, t.id, { status: "IN_PROGRESS", progress: 20 })).rejects.toThrow(/موافقة المكلف/);
    await recordConsent(coord, t.id, { response: "ACCEPT", note: "موافق" });
    const p = await updateProgress(coord, t.id, { status: "IN_PROGRESS", progress: 40, note: "بدأ العمل" });
    expect(p.progress).toBe(40);
    // بعد الموافقة لا يتغير الموعد إلا بطلب تعديل
    await expect(updateTaskDetails(coord, t.id, { title: "تجهيز كشف", dueDate: dayInput(addDays(today(), 20)) })).rejects.toThrow(/طلب تعديل الموعد/);
  });

  it("طلب تعديل الموعد: القبول يعتمد الموعد الجديد، والرفض يعيدها بانتظار الموافقة", async () => {
    const t = await createTask(coord, { title: "مهمة موعد", assigneeId: personA, dueDate: dayInput(addDays(today(), 3)) });
    await expect(recordConsent(coord, t.id, { response: "REQUEST_CHANGE" })).rejects.toThrow(/الموعد المقترح/);
    await recordConsent(coord, t.id, { response: "REQUEST_CHANGE", proposedDueDate: dayInput(addDays(today(), 10)), note: "ضغط عمل" });
    const ok = await decideDueDateChange(admin, t.id, true, null);
    expect(ok.consentStatus).toBe("ACCEPTED");
    expect(dayInput(ok.dueDate)).toBe(dayInput(addDays(today(), 10)));
    await recordConsent(coord, t.id, { response: "REQUEST_CHANGE", proposedDueDate: dayInput(addDays(today(), 30)) });
    const no = await decideDueDateChange(admin, t.id, false, "الموعد ملزم");
    expect(no.consentStatus).toBe("PENDING");
    expect(dayInput(no.dueDate)).toBe(dayInput(addDays(today(), 10)));
  });

  it("الاعتذار يتطلب سبباً ويوقف التنفيذ، ثم إعادة الإسناد لشخص آخر بانتظار موافقته", async () => {
    const t = await createTask(coord, { title: "مهمة اعتذار", assigneeId: personA, dueDate: dayInput(addDays(today(), 5)) });
    await recordConsent(coord, t.id, { response: "ACCEPT" });
    await updateProgress(coord, t.id, { status: "IN_PROGRESS", progress: 30 });
    await expect(reassignTask(coord, t.id, { assigneeId: personB })).rejects.toThrow(/اعتذاره/);
    await expect(recordConsent(coord, t.id, { response: "DECLINE" })).rejects.toThrow(/سبب/);
    const d = await recordConsent(coord, t.id, { response: "DECLINE", note: "سفر طارئ" });
    expect(d.consentStatus).toBe("DECLINED");
    expect(d.status).toBe("WAITING");
    await expect(updateProgress(coord, t.id, { status: "IN_PROGRESS", progress: 50 })).rejects.toThrow();
    const r = await reassignTask(coord, t.id, { assigneeId: personB, note: "إسناد بديل" });
    expect(r.assigneeId).toBe(personB);
    expect(r.consentStatus).toBe("PENDING");
    const events = await prisma.taskEvent.findMany({ where: { taskId: t.id }, orderBy: { id: "asc" } });
    expect(events.map((e) => e.kind)).toEqual(["created", "accepted", "progress", "declined", "reassigned"]);
  });

  it("التعثر يتطلب معوقات، والإنجاز يتطلب نتيجة، والإغلاق والإلغاء للمدير", async () => {
    const t = await createTask(coord, { title: "مهمة إنجاز", assigneeId: personB, dueDate: dayInput(addDays(today(), 5)) });
    await recordConsent(coord, t.id, { response: "ACCEPT" });
    await expect(updateProgress(coord, t.id, { status: "STUCK", progress: 10 })).rejects.toThrow(/المعوقات/);
    await updateProgress(coord, t.id, { status: "STUCK", progress: 10, obstacles: "تأخر رد الجهة" });
    await expect(updateProgress(coord, t.id, { status: "DONE", progress: 100 })).rejects.toThrow(/النتيجة/);
    await expect(updateProgress(coord, t.id, { status: "IN_PROGRESS", progress: 100 })).rejects.toThrow(/100/);
    const done = await updateProgress(coord, t.id, { status: "DONE", progress: 80, finalResult: "سُلّم الكشف" });
    expect(done.progress).toBe(100);
    expect((await listTasks(taskFilterSchema.parse({ awaitingClose: "1" }))).rows.map((x) => x.id)).toContain(t.id);
    await expect(approveTaskClosure(coord, t.id, null)).rejects.toThrow();
    const closed = await approveTaskClosure(admin, t.id, null);
    expect(closed.closedAt).not.toBeNull();
    await expect(updateProgress(coord, t.id, { status: "IN_PROGRESS", progress: 50 })).rejects.toThrow(/مغلقة/);
    const reopened = await reopenTask(admin, t.id, "ملاحظات على النتيجة");
    expect(reopened.status).toBe("IN_PROGRESS");
    expect(reopened.progress).toBe(99);

    const t2 = await createTask(coord, { title: "مهمة تلغى", assigneeId: personB, dueDate: dayInput(addDays(today(), 5)) });
    await expect(cancelTask(coord, t2.id, "لم تعد مطلوبة")).rejects.toThrow();
    expect((await cancelTask(admin, t2.id, "لم تعد مطلوبة")).status).toBe("CANCELLED");
  });

  it("المهمة النافذة المتأخرة تظهر في الكشف، ومؤشرات المهام متسقة", async () => {
    const t = await createTask(coord, { title: "مهمة متأخرة", assigneeId: personA, dueDate: dayInput(today()) });
    await recordConsent(coord, t.id, { response: "ACCEPT" });
    await prisma.task.update({ where: { id: t.id }, data: { dueDate: addDays(today(), -2) } });
    const ind = await taskIndicators();
    expect((await listTasks(taskFilterSchema.parse({ overdue: "1" }))).rows.map((x) => x.id)).toContain(t.id);
    expect(ind.total).toBe(await prisma.task.count({ where: { deletedAt: null } }));
    expect(ind.completionRate).toBe(Math.round((ind.done / (ind.total - ind.cancelled)) * 100));
  });

  it("ربط المهمة بطلب يُسجَّل في السجل الزمني للطلب، ولا يُسمح بالربط بطلب مغلق", async () => {
    const r = await createRequest(coord, base());
    await createTask(coord, { title: "مهمة للطلب", assigneeId: personA, dueDate: dayInput(addDays(today(), 4)), requestId: r.id });
    expect(await prisma.requestEvent.count({ where: { requestId: r.id, kind: "task_linked" } })).toBe(1);
    await transitionRequest(coord, r.id, { to: "DONE", note: "انتهى" });
    await transitionRequest(admin, r.id, { to: "CLOSED", note: "إغلاق" });
    await expect(createTask(coord, { title: "أخرى", assigneeId: personA, dueDate: dayInput(addDays(today(), 4)), requestId: r.id })).rejects.toThrow(/مغلق/);
  });

  it("الموعد في الماضي مرفوض، والمكلف يجب أن يكون في قاعدة البيانات", async () => {
    await expect(createTask(coord, { title: "مهمة", assigneeId: personA, dueDate: dayInput(addDays(today(), -1)) })).rejects.toThrow();
    await expect(createTask(coord, { title: "مهمة", assigneeId: "00000000-0000-4000-8000-000000000000", dueDate: dayInput(today()) })).rejects.toThrow(/المكلف/);
  });
});
