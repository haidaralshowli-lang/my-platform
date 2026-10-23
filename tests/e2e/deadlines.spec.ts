import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { prisma } from "../../src/lib/db";
import { makeCast, toAwaitingDelivery, type Cast } from "../flow";

// يُجهَّز الملف عبر الخدمات الحقيقية حتى «بانتظار التبليغ»، ثم يُكمل المسار من الواجهة
let cast: Cast;
let violationId: string;

test.beforeAll(async () => {
  cast = await makeCast();
  if (!(await prisma.legalDeadlineRule.findUnique({ where: { code: "E2E-GEN" } }))) {
    await prisma.legalDeadlineRule.create({
      data: {
        code: "E2E-GEN", nameAr: "قاعدة اختبار الواجهة", duration: 10, unit: "CALENDAR_DAYS", startEvent: "RECEIPT_DATE", excludeHolidays: false,
        legalBasis: "سند اختبار الواجهة", extensionAllowed: true, maxExtensionDays: 30, warnBeforeDays: 3, effectiveFrom: new Date("2020-01-01"), createdById: cast.admin.id,
      },
    });
  }
  violationId = (await toAwaitingDelivery(cast)).id;
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

const todayKey = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad" }).format(new Date());

test("التبليغ والمدة والتمديد والتنبيهات من الواجهة، والمهمة المجدولة محمية بالرمز السري", async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const url = `/violations/${violationId}`;
  const del = await as(browser, info, cast.delivery);
  await del.goto(url);
  await expect(del.getByText("لم يبدأ الاحتساب")).toBeVisible();
  await del.getByLabel(/^تاريخ إرسال الإنذار/).fill(todayKey());
  await del.getByLabel(/^طريقة التبليغ/).selectOption("HAND");
  await del.getByRole("button", { name: "تسجيل إرسال الإنذار" }).click();
  await expect(del.getByText("بانتظار إثبات الاستلام").first()).toBeVisible();
  await expect(del.getByText("لم يبدأ الاحتساب")).toBeVisible();

  await del.getByLabel(/^تاريخ الاستلام الفعلي/).fill(todayKey());
  await del.getByLabel(/^اسم المستلم/).fill("مدير المحطة");
  await del.getByLabel(/^رقم وصل الاستلام/).fill(`W-${Date.now()}`);
  await del.getByLabel(/^صورة ضوئية من الوصل/).setInputFiles("tests/e2e/fixtures/mahdar.pdf");
  await confirm(del, "تسجيل الاستلام");
  await expect(del.getByText("سُجِّل الاستلام وبدأ احتساب المدة القانونية.")).toBeVisible();
  await expect(del.getByText("المدة سارية").first()).toBeVisible();
  await expect(del.getByText("سند اختبار الواجهة")).toBeVisible();
  await expect(del.getByText("متبقٍ 9 يوماً تقويمياً")).toBeVisible();

  // تسجيل طلب تمديد ثم قرار رئيس الهيئة
  const legal = await as(browser, info, cast.legal);
  await legal.goto(url);
  await legal.getByText("تسجيل طلب تمديد من الجهة المخالفة").click();
  await legal.getByLabel(/^تاريخ الطلب/).fill(todayKey());
  await legal.getByLabel(/^المدة الإضافية المطلوبة/).fill("5");
  await legal.getByLabel(/^أسباب الطلب/).fill("ظروف فنية خارجة عن الإرادة");
  await legal.getByRole("button", { name: "تسجيل الطلب" }).click();
  await expect(legal.getByText("لم يتغير تاريخ الاستحقاق")).toBeVisible();

  const chair = await as(browser, info, cast.chair);
  // الجرس يعرض تنبيهات غير مقروءة، وصفحة التنبيهات تفتح الملف
  await expect(chair.getByRole("link", { name: /التنبيهات \([1-9]/ })).toBeVisible();
  await chair.goto("/notifications");
  await expect(chair.getByText("طلب تمديد مدة بانتظار القرار").first()).toBeVisible();
  await chair.goto(url);
  await chair.getByLabel(/^المدة الممنوحة/).fill("3");
  await confirm(chair, "الموافقة على التمديد");
  await expect(chair.getByText("تمت الموافقة على التمديد")).toBeVisible();
  await expect(chair.getByText("المدة ممددة بموافقة معتمدة").first()).toBeVisible();
  await expect(chair.getByText("متبقٍ 12 يوماً تقويمياً")).toBeVisible();

  // المهمة المجدولة: مرفوضة دون الرمز
  expect((await request.post("/api/cron/deadlines")).status()).toBe(401);
  expect((await request.post("/api/cron/deadlines", { headers: { authorization: "Bearer wrong-secret-value-123" } })).status()).toBe(401);
  await chair.goto("/deadlines");
  await expect(chair.getByRole("heading", { name: "المدد القانونية والتنبيهات" })).toBeVisible();
});
