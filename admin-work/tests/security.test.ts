import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { addDays, dayInput, today, todayStr } from "@/lib/dates";
import { authenticate } from "@/lib/auth/service";
import { ALL_PERMISSIONS, COORDINATOR_GRANTABLE, PERMISSIONS, type Actor, type Permission } from "@/lib/rbac";
import { createUser } from "@/lib/services/users";
import { addListItem, updateSetting } from "@/lib/services/lists";
import { createPerson, deletePerson, listPeople, markDistinct, mergePeople, peopleFilterSchema, restorePerson, updatePerson } from "@/lib/services/people";
import { exportPeople, previewImport } from "@/lib/services/people-excel";
import { addRequestAction, createRequest, deleteRequest, exportRequests, listRequests, requestFilterSchema, restoreRequest, transitionRequest } from "@/lib/services/requests";
import { approveTaskClosure, cancelTask, createTask, deleteTask, exportTasks, recordConsent, restoreTask, updateProgress } from "@/lib/services/tasks";
import { makeUser, PASSWORD } from "./helpers";

let admin: Actor;
let personId: string;
let otherPersonId: string;
let requestId: string;
let taskId: string;

beforeAll(async () => {
  admin = await makeUser("ADMIN");
  personId = (await createPerson(admin, { fullName: "شخص مصفوفة الصلاحيات" })).id;
  otherPersonId = (await createPerson(admin, { fullName: "شخص آخر للمصفوفة" })).id;
  requestId = (await createRequest(admin, { receivedAt: todayStr(), applicantName: "مصفوفة", type: "INQUIRY", description: "طلب مصفوفة الصلاحيات" })).id;
  taskId = (await createTask(admin, { title: "مهمة المصفوفة", assigneeId: personId, dueDate: dayInput(addDays(today(), 3)) })).id;
});

/// العملية المحمية بكل صلاحية تُنفَّذ على الخدمة مباشرة (طبقة الأعمال، لا الواجهة)
const GUARDED: Partial<Record<Permission, (a: Actor) => Promise<unknown>>> = {
  "people.create": (a) => createPerson(a, { fullName: "اسم محاولة غير مصرح بها" }),
  "people.edit": (a) => updatePerson(a, personId, { fullName: "تعديل غير مصرح" }),
  "people.import": async (a) => previewImport(a, Buffer.from("PK"), false),
  "people.export": (a) => exportPeople(a, peopleFilterSchema.parse({})),
  "people.delete": (a) => deletePerson(a, personId, "محاولة حذف"),
  "people.merge": (a) => mergePeople(a, personId, otherPersonId),
  "requests.view": (a) => exportRequests(a, requestFilterSchema.parse({})),
  "requests.create": (a) => createRequest(a, { receivedAt: todayStr(), applicantName: "غير مصرح", type: "INQUIRY", description: "محاولة غير مصرح بها" }),
  "requests.update": (a) => addRequestAction(a, requestId, { note: "محاولة غير مصرح بها" }),
  "requests.delete": (a) => deleteRequest(a, requestId, "محاولة حذف"),
  "tasks.view": (a) => exportTasks(a, { status: [], sort: "createdAt", dir: "desc", page: 1 }),
  "tasks.create": (a) => createTask(a, { title: "مهمة غير مصرح بها", assigneeId: personId, dueDate: dayInput(today()) }),
  "tasks.update": (a) => recordConsent(a, taskId, { response: "ACCEPT" }),
  "tasks.close": (a) => cancelTask(a, taskId, "محاولة إلغاء"),
  "tasks.delete": (a) => deleteTask(a, taskId, "محاولة حذف"),
  "users.manage": (a) => createUser(a, { username: `x${Date.now()}`, fullName: "حساب غير مصرح", role: "COORDINATOR" }),
  "lists.manage": (a) => addListItem(a, "authority", `جهة غير مصرح بها ${Date.now()}`),
};

async function expectForbidden(p: Promise<unknown>) {
  const e = await p.then(
    () => null,
    (err) => err,
  );
  expect(e, "يجب رفض العملية").toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe("FORBIDDEN");
}

describe("مصفوفة الصلاحيات على طبقة الأعمال", () => {
  it("كل صلاحية تشغيلية: من يملك كل الصلاحيات الأخرى عداها يُرفض", async () => {
    for (const perm of COORDINATOR_GRANTABLE) {
      const fn = GUARDED[perm];
      if (!fn) continue;
      const actor = await makeUser("COORDINATOR", COORDINATOR_GRANTABLE.filter((p) => p !== perm));
      await expectForbidden(fn(actor));
    }
  });

  it("الصلاحيات الإدارية: المنسق بكامل الصلاحيات التشغيلية يُرفض في كل عملية إدارية", async () => {
    const coord = await makeUser("COORDINATOR", [...COORDINATOR_GRANTABLE]);
    const adminOnly = ALL_PERMISSIONS.filter((p) => !PERMISSIONS[p].operational);
    for (const perm of adminOnly) {
      const fn = GUARDED[perm];
      if (fn) await expectForbidden(fn(coord));
    }
    // عمليات إدارية إضافية لا ترتبط بصلاحية واحدة في الجدول
    await expectForbidden(updateSetting(coord, "people.staleDays", 30));
    await expectForbidden(restorePerson(coord, personId));
    await expectForbidden(restoreRequest(coord, requestId));
    await expectForbidden(restoreTask(coord, taskId));
    await expectForbidden(transitionRequest(coord, requestId, { to: "CLOSED", note: "إغلاق" }).catch(async (e) => {
      // يلزم أن يكون الطلب منجزاً أولاً حتى يصل الفحص إلى الصلاحية
      if (e instanceof AppError && e.code !== "FORBIDDEN") {
        await transitionRequest(admin, requestId, { to: "DONE", note: "تجهيز" });
        return transitionRequest(coord, requestId, { to: "CLOSED", note: "إغلاق" });
      }
      throw e;
    }));
    await recordConsent(admin, taskId, { response: "ACCEPT" });
    await updateProgress(admin, taskId, { status: "DONE", progress: 100, finalResult: "تم" });
    await expectForbidden(approveTaskClosure(coord, taskId, null));
  });

  it("كل صلاحية مستخدمة في الواجهة معرّفة في الكتالوج، ولكل صلاحية تشغيلية عملية محمية مختبرة", () => {
    const untested = COORDINATOR_GRANTABLE.filter((p) => !GUARDED[p] && !["dashboard.view", "people.view", "reports.view"].includes(p));
    expect(untested).toEqual([]);
    // الصلاحيات الثلاث المستثناة تحمي صفحات قراءة فقط (مختبرة عبر HTTP في tests/e2e)
  });
});

describe("الحماية من الإدخال الخبيث", () => {
  it("نصوص الاستعلام الخبيثة لا تكسر البحث (الاستعلامات مُعاملة)", async () => {
    for (const q of ["' OR 1=1 --", "%", "_", "\\", "'; DROP TABLE \"Person\"; --", "أ%ب"]) {
      await expect(listPeople(peopleFilterSchema.parse({ q }))).resolves.toBeDefined();
      await expect(listRequests(requestFilterSchema.parse({ q }))).resolves.toBeDefined();
    }
    expect(await prisma.person.count()).toBeGreaterThan(0);
  });

  it("الأسماء التي تبدأ بعلامات الصيغ تُصدَّر نصاً لا صيغة في Excel", async () => {
    await createPerson(admin, { fullName: '=HYPERLINK("http://evil.example","اضغط")' });
    const { buf } = await exportPeople(admin, peopleFilterSchema.parse({ q: "HYPERLINK" }));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const cell = wb.worksheets[0].getRow(2).getCell(2);
    expect(cell.type).toBe(ExcelJS.ValueType.String);
    expect(cell.formula).toBeUndefined();
  });

  it("ملف الاستيراد: يرفض الملفات غير xlsx والملفات الكبيرة، ويقرأ الصيغ كقيم", async () => {
    await expect(previewImport(admin, Buffer.from("<html>"), false)).rejects.toThrow(/Excel/);
    await expect(previewImport(admin, Buffer.alloc(6 * 1024 * 1024, 0x50), false)).rejects.toThrow(/5 ميغابايت/);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("x");
    ws.addRow(["الاسم الكامل", "رقم الهاتف"]);
    ws.addRow([{ formula: '"صيغة "&"مدمجة"', result: "صيغة مدمجة" }, ""]);
    const preview = await previewImport(admin, Buffer.from(await wb.xlsx.writeBuffer()), false);
    expect(preview.ok).toBe(1);
  });

  it("محاولات الدخول من عنوان IP واحد تُحدّ بعد 30 محاولة فاشلة خلال 15 دقيقة", async () => {
    const ip = "203.0.113.77";
    await prisma.loginAttempt.createMany({ data: Array.from({ length: 30 }, () => ({ username: "x", ip, success: false })) });
    const a = await makeUser("COORDINATOR");
    await expect(authenticate({ username: a.username, password: PASSWORD, ip })).rejects.toThrow(/تجاوز/);
    // من عنوان آخر ينجح
    await expect(authenticate({ username: a.username, password: PASSWORD, ip: "203.0.113.78" })).resolves.toBeDefined();
  });

  it("المستخدم المعطل لا يُعامل كمنفذ حتى لو بقيت جلسته", async () => {
    const c = await makeUser("COORDINATOR", [...COORDINATOR_GRANTABLE]);
    await prisma.user.update({ where: { id: c.id }, data: { isActive: false } });
    const { loadActor } = await import("@/lib/rbac");
    expect(await loadActor(prisma, c.id)).toBeNull();
  });

  it("تأكيد عدم التكرار يتطلب صلاحية التعديل", async () => {
    const viewer = await makeUser("COORDINATOR", ["people.view"]);
    await expectForbidden(markDistinct(viewer, personId, otherPersonId));
  });
});
