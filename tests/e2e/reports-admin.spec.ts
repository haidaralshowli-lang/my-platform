import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { prisma } from "../../src/lib/db";
import { makeCast, toRunning, type Cast } from "../flow";

let cast: Cast;
test.beforeAll(async () => {
  cast = await makeCast();
  await toRunning(cast, "E2E-REP", "NONE");
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

test("لوحة المعلومات والتقارير والتصدير وسجل التدقيق", async ({ browser }, info) => {
  const chair = await as(browser, info, cast.chair);
  await expect(chair.getByText("ضمن المدة القانونية")).toBeVisible();
  await expect(chair.getByText("المخالفات المسجلة شهرياً")).toBeVisible();
  await expect(chair.getByText("حسب المحافظة")).toBeVisible();
  await expect(chair.getByText("المستحق المعتمد (د.ع)")).toBeVisible();
  const { sw, cw } = await chair.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw).toBeLessThanOrEqual(cw);

  await chair.goto("/reports");
  await chair.getByText("المخالفات حسب المحافظة").click();
  await chair.getByRole("button", { name: "عرض التقرير" }).click();
  await expect(chair.getByText("معايير البحث:")).toBeVisible();
  await expect(chair.getByText(`أنشأه: ${cast.chair.fullName}`).or(chair.getByText(cast.chair.fullName)).first()).toBeVisible();
  await expect(chair.getByRole("cell", { name: "بغداد" })).toBeVisible();
  const href = await chair.getByRole("link", { name: "تصدير Excel" }).getAttribute("href");
  const x = await chair.request.get(href!);
  expect(x.status()).toBe(200);
  expect(x.headers()["content-type"]).toContain("spreadsheetml");

  // قانوني بلا صلاحية مالية لا يرى التقرير المالي
  const legal = await as(browser, info, cast.legal);
  await legal.goto("/reports");
  await expect(legal.getByText("الاستجابات المالية والتسديدات")).toHaveCount(0);
  await legal.goto("/reports/financial");
  await expect(legal.getByRole("heading", { name: "الصفحة غير موجودة" })).toBeVisible();

  await chair.goto("/audit");
  await chair.getByRole("button", { name: "التحقق من سلامة السجل" }).click();
  await expect(chair.getByText("السلسلة سليمة")).toBeVisible({ timeout: 30_000 });
});

test("إعدادات النظام لمدير النظام وتتطلب سبباً", async ({ browser }, info) => {
  const admin = await as(browser, info, cast.admin);
  await admin.goto("/admin/system");
  await expect(admin.getByRole("heading", { name: "إعدادات النظام" })).toBeVisible();
  const row = admin.locator("form", { has: admin.getByText("مدة قفل الحساب") });
  await row.getByRole("textbox").first().fill("20");
  await row.getByLabel("سبب التعديل").fill(`اختبار ${info.project.name}`);
  await row.getByRole("button", { name: "حفظ" }).click();
  await expect(row.getByText("تم الحفظ")).toBeVisible();
  await row.getByRole("textbox").first().fill("15");
  await row.getByLabel("سبب التعديل").fill("إرجاع القيمة");
  await row.getByRole("button", { name: "حفظ" }).click();
  await expect(row.getByText("تم الحفظ")).toBeVisible();
});
