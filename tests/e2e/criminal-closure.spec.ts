import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { prisma } from "../../src/lib/db";
import { refreshDeadlines } from "../../src/lib/services/deadlines";
import { makeCast, toRunning, type Cast } from "../flow";

let cast: Cast;
let id: string;

test.beforeAll(async () => {
  cast = await makeCast();
  id = (await toRunning(cast, "E2E-CRIM", "MANUAL_DECISION")).id;
  const d = await prisma.deadlineCalculation.findFirstOrThrow({ where: { violationId: id, isCurrent: true } });
  await prisma.deadlineCalculation.update({ where: { id: d.id }, data: { dueDate: new Date(Date.now() - 3_600_000) } });
  await refreshDeadlines();
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

test("عدم الاستجابة ← ملف دعوى ← إحالة ← حكم قطعي ← إغلاق باعتماد ثانٍ ← أرشيف ← إعادة فتح", async ({ browser }, info) => {
  test.setTimeout(150_000);
  const url = `/violations/${id}`;
  const legal = await as(browser, info, cast.legal);
  await legal.goto(url);
  await expect(legal.getByText("لا يُحال الملف إلى الدعوى الجزائية تلقائياً")).toBeVisible();
  await legal.getByLabel(/^إثبات عدم الاستجابة/).fill("مراجعة سجل الوارد والبريد الرسمي حتى انتهاء المدة دون ورود أي استجابة");
  await confirm(legal, "بدء إجراء عدم الاستجابة");
  await expect(legal.getByText("لم يُفتح ملف دعوى بعد")).toBeVisible();

  const chair = await as(browser, info, cast.chair);
  await chair.goto(url);
  await confirm(chair, "اعتماد عدم الاستجابة وفتح ملف الدعوى");
  await expect(chair).toHaveURL(/\/criminal-cases\//);
  await expect(chair.getByText("فُتح ملف الدعوى الجزائية")).toBeVisible();
  const caseUrl = chair.url().split("?")[0];

  await legal.goto(caseUrl);
  await legal.getByLabel(/^تاريخ الإحالة/).fill(today());
  await legal.getByLabel(/^مستند الإحالة/).setInputFiles("tests/e2e/fixtures/mahdar.pdf");
  await confirm(legal, "تسجيل الإحالة");
  await expect(legal.getByText("سُجِّلت الإحالة.")).toBeVisible();
  await legal.getByText("تسجيل حكم صادر").click();
  await legal.getByLabel(/^رقم الحكم/).fill("55/جنح/2026");
  await legal.getByLabel(/^تاريخ الحكم/).fill(today());
  await legal.getByLabel(/^اسم المحكمة\*?$/).fill("محكمة جنح الرصافة");
  await legal.getByLabel(/^منطوق الحكم/).fill("الحكم على الجهة المخالفة بغرامة");
  await legal.getByLabel(/^الحالة الإجرائية/).selectOption("FINAL");
  await legal.getByLabel(/^نسخة ضوئية من الحكم/).setInputFiles("tests/e2e/fixtures/mahdar.pdf");
  await confirm(legal, "تسجيل الحكم");
  await expect(legal.getByText("بانتظار الاعتماد").first()).toBeVisible();
  // المدخل لا يرى زر الاعتماد
  await expect(legal.getByRole("button", { name: "اعتماد بيانات الحكم" })).toHaveCount(0);

  const legal2 = await as(browser, info, cast.legal2);
  await legal2.goto(caseUrl);
  await confirm(legal2, "اعتماد بيانات الحكم");
  await expect(legal2.getByText("اعتُمدت بيانات الحكم.")).toBeVisible();

  await legal.goto(url);
  await expect(legal.getByText("الملف مستوفٍ لشروط الإغلاق")).toBeVisible();
  await legal.getByLabel(/^سبب الإغلاق/).fill("اكتمال إجراءات الدعوى الجزائية وصدور حكم قطعي");
  await confirm(legal, "طلب إغلاق المخالفة");
  await expect(legal.getByText("لا تُعد المخالفة مغلقة قبل اعتماده")).toBeVisible();

  await chair.goto(url);
  await confirm(chair, "اعتماد الإغلاق");
  await expect(chair.getByText("اعتُمد إغلاق المخالفة.")).toBeVisible();
  await expect(chair.getByText("المخالفة مغلقة بالنتيجة").first()).toBeVisible();

  await chair.goto("/archive");
  await expect(chair.getByRole("heading", { name: "الأرشيف والمخالفات المغلقة" })).toBeVisible();

  await chair.goto(url);
  await chair.getByText("إعادة فتح المخالفة (صلاحية خاصة)").click();
  await chair.getByLabel(/^سبب إعادة الفتح/).fill("ورود معلومات جديدة تستدعي المراجعة");
  await confirm(chair, "إعادة الفتح");
  await expect(chair.getByText("أُعيد فتح المخالفة مع الاحتفاظ بسجل الإغلاق السابق.")).toBeVisible();
  await expect(chair.getByText("معتمد").first()).toBeVisible();
});
