import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { prisma } from "../../src/lib/db";
import { makeUser } from "../helpers";
import { makeCast, toRunning, type Cast } from "../flow";
import type { Actor } from "../../src/lib/rbac/actor";

let cast: Cast;
let finance: Actor;
let fileA: string, fileB: string;

test.beforeAll(async () => {
  cast = await makeCast();
  finance = (await makeUser(["FINANCE"])).actor;
  fileA = (await toRunning(cast, "E2E-RESP", "MANUAL_DECISION")).id;
  fileB = (await toRunning(cast, "E2E-RESP", "MANUAL_DECISION")).id;
});
test.afterAll(async () => prisma.$disconnect());

async function as(browser: Browser, info: TestInfo, a: { username: string }): Promise<Page> {
  const page = await (await browser.newContext({ ...info.project.use })).newPage();
  await page.goto("/login");
  await page.getByLabel("اسم المستخدم").fill(a.username);
  await page.getByLabel("كلمة المرور").fill("TestPassword123");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  return page;
}
async function confirm(page: Page, button: string) {
  await page.getByRole("button", { name: button, exact: true }).first().click();
  await page.getByRole("dialog").filter({ visible: true }).getByRole("button", { name: "تأكيد" }).click();
}
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad" }).format(new Date());

test("استجابة مالية بتسديد جزئي ثم كامل، وحجب المبالغ عن غير المخول، وقبول لا يغلق الملف", async ({ browser }, info) => {
  test.setTimeout(120_000);
  const f = await as(browser, info, finance);
  await f.goto(`/violations/${fileA}`);
  await f.getByText("تسجيل استجابة جديدة من الجهة المخالفة").click();
  await f.locator("summary", { hasText: /^استجابة مالية$/ }).click();
  const fin = f.locator("details", { has: f.locator("summary", { hasText: /^استجابة مالية$/ }) }).last();
  await fin.getByLabel(/^تاريخ ورود الاستجابة/).fill(today());
  await fin.getByLabel(/^مضمون الاستجابة/).fill("كتاب الجهة بتسديد الغرامة على دفعتين");
  await fin.getByLabel(/^نوع الاستجابة المالية/).fill("غرامة مالية");
  await fin.getByLabel(/^المبلغ المستحق المعتمد/).fill("1500000");
  await fin.getByLabel(/^سند المبلغ المعتمد/).fill("قرار فرض الغرامة رقم 12");
  await fin.getByRole("button", { name: "تسجيل الاستجابة" }).click();
  await f.getByRole("dialog").filter({ visible: true }).getByRole("button", { name: "تأكيد" }).click();
  await expect(f.getByText("سُجِّلت الاستجابة وتوقف احتساب المدة")).toBeVisible();
  await expect(f.getByText("بانتظار التحقق من الاستجابة").first()).toBeVisible();
  await expect(f.getByText("توقف الاحتساب").first()).toBeVisible();

  await f.getByLabel(/^المبلغ\*?$/).fill("500000");
  await f.getByLabel(/^تاريخ التسديد/).fill(today());
  await f.getByLabel(/^رقم الوصل/).fill("PAY-1");
  await f.getByRole("button", { name: "تسجيل التسديد" }).click();
  await expect(f.getByText("مسدد جزئياً").first()).toBeVisible();
  // تجاوز المستحق مرفوض دون صلاحية
  await f.getByLabel(/^المبلغ\*?$/).fill("2000000");
  await f.getByLabel(/^تاريخ التسديد/).fill(today());
  await f.getByLabel(/^رقم الوصل/).fill("PAY-X");
  await f.getByRole("button", { name: "تسجيل التسديد" }).click();
  await expect(f.getByRole("alert").filter({ hasText: "يتجاوز المستحق" })).toBeVisible();
  await f.getByLabel(/^المبلغ\*?$/).fill("1000000");
  await f.getByLabel(/^رقم الوصل/).fill("PAY-2");
  await f.getByRole("button", { name: "تسجيل التسديد" }).click();
  await expect(f.getByText("مسدد بالكامل").first()).toBeVisible();
  await f.getByLabel(/^نتيجة التدقيق المالي/).fill("الوصولات مطابقة لسجلات الخزينة");
  await f.getByRole("button", { name: "حفظ البيانات المالية" }).click();
  await expect(f.getByText("الوصولات مطابقة لسجلات الخزينة")).toBeVisible();

  // موظف فني بلا صلاحية مالية: المبالغ محجوبة
  const t = await as(browser, info, cast.tech);
  await t.goto(`/violations/${fileA}`);
  await expect(t.getByText("التفاصيل المالية محجوبة")).toBeVisible();
  await expect(t.getByText("1,500,000")).toHaveCount(0);

  const chair = await as(browser, info, cast.chair);
  await chair.goto(`/violations/${fileA}`);
  await confirm(chair, "قبول الاستجابة");
  await expect(chair.getByText("بانتظار التحقق النهائي").first()).toBeVisible();
  await expect(chair.getByText("استجابة مالية").first()).toBeVisible();
  await expect(chair.getByText("مفتوحة").first()).toBeVisible();
});

test("اعتراض لا يوقف المدة تلقائياً، ثم قرار باستمرار السير", async ({ browser }, info) => {
  const l = await as(browser, info, cast.legal);
  await l.goto(`/violations/${fileB}`);
  await l.locator("summary", { hasText: "تسجيل اعتراض أو طعن" }).click();
  await l.getByLabel(/^تاريخ التقديم/).fill(today());
  await l.getByLabel(/^مضمون الاعتراض/).fill("تعترض الجهة على وقائع المحضر");
  await confirm(l, "تسجيل");
  await expect(l.getByText("اعتراض أو طعن قيد المراجعة").first()).toBeVisible();
  await expect(l.getByText("المدة سارية").first()).toBeVisible();
  await l.getByLabel(/^القرار والنتيجة النهائية/).fill("رد الاعتراض لعدم استناده إلى دليل");
  await l.getByLabel(/^بيان الأثر/).fill("استمرار المدة القانونية");
  await confirm(l, "تسجيل القرار");
  await expect(l.getByText("سُجِّل قرار الاعتراض.")).toBeVisible();
  await expect(l.getByText("المدة القانونية سارية").first()).toBeVisible();
  await expect(l.getByText("مرفوض").first()).toBeVisible();
});
