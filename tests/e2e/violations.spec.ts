import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const state = JSON.parse(readFileSync("tests/e2e/.state.json", "utf8")) as {
  staff: Record<string, { username: string; password: string }>;
  suffix: string;
};

async function login(page: Page, who: string) {
  const u = state.staff[who];
  await page.goto("/login");
  await page.getByLabel("اسم المستخدم").fill(u.username);
  await page.getByLabel("كلمة المرور").fill(u.password);
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function confirm(page: Page, button: string) {
  await page.getByRole("button", { name: button }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "تأكيد" }).click();
}

test("دورة التسجيل: مسودة، تسجيل برقم رسمي، رفض ملف مزيف، رفع المحضر، إحالة، بحث، وحجب خارج النطاق", async ({ page, browser }, info) => {
  const offender = `قناة اختبار ${info.project.name} ${state.suffix}`;
  await login(page, `registrar-${info.project.name}`);
  await page.goto("/violations/new");
  await page.getByLabel(/^اسم الجهة المخالفة/).fill(offender);
  await page.getByLabel(/^رقم المحضر الورقي/).fill(`PR-${state.suffix}`);
  await page.getByRole("button", { name: "حفظ المسودة" }).click();
  await expect(page.getByText("تم حفظ البيانات.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /^مسودة/ })).toBeVisible();
  // ناقصة: التسجيل يُرفض برسالة واضحة
  await confirm(page, "تسجيل المخالفة رسمياً");
  await expect(page.getByRole("alert").filter({ hasText: "يجب استكمال الحقول الإلزامية" })).toBeVisible();

  // استكمال البيانات
  await page.getByRole("link", { name: "تعديل البيانات" }).click();
  await page.getByLabel(/^تاريخ اكتشاف المخالفة/).fill("2026-09-01");
  await page.getByLabel(/^نوع المخالفة/).selectOption({ label: "نوع مخالفة لاختبار الواجهة" });
  await page.getByLabel(/^مصدر اكتشافها/).selectOption({ index: 1 });
  await page.getByLabel(/^وصف المخالفة/).fill("بث محتوى مخالف لشروط الإجازة، لأغراض الاختبار.");
  await page.getByRole("button", { name: "حفظ التعديلات" }).click();
  await expect(page.getByText("تم حفظ البيانات.")).toBeVisible();

  await confirm(page, "تسجيل المخالفة رسمياً");
  await expect(page.getByRole("heading", { name: /^المخالفة م-\d{4}-\d{6}$/ })).toBeVisible();
  await expect(page.getByText("بانتظار رفع المحضر").first()).toBeVisible();
  const number = (await page.getByRole("heading", { name: /^المخالفة/ }).textContent())!.replace("المخالفة ", "").trim();

  // ملف تنفيذي متنكر باسم PDF يُرفض
  await page.getByLabel(/^الملفات/).setInputFiles("tests/e2e/fixtures/fake.pdf");
  await page.getByRole("button", { name: "رفع", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "غير مسموح" })).toBeVisible();

  // رفع المحضر الأصلي
  await page.getByLabel(/^نوع المستند/).selectOption("VIOLATION_REPORT");
  await page.getByLabel(/^الملفات/).setInputFiles("tests/e2e/fixtures/mahdar.pdf");
  await page.getByRole("button", { name: "رفع", exact: true }).click();
  await expect(page.getByText("تم رفع 1 ملف بنجاح")).toBeVisible();
  await page.reload();
  await expect(page.getByText("mahdar.pdf")).toBeVisible();
  const fileHref = await page.getByRole("link", { name: "معاينة" }).first().getAttribute("href");
  const res = await page.request.get(fileHref!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  expect(res.headers()["cache-control"]).toContain("no-store");

  await confirm(page, "إحالة للمصادقة النهائية");
  await expect(page.getByText("تمت إحالة المخالفة للمصادقة النهائية")).toBeVisible();
  await page.reload();
  await expect(page.getByText("بانتظار المصادقة النهائية").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "تعديل البيانات" })).toHaveCount(0);
  await expect(page.getByText("معتمد", { exact: true })).toBeVisible();

  // البحث برقم المخالفة مع حفظ الفلاتر في الرابط
  await page.goto(`/violations?number=${encodeURIComponent(number)}`);
  await expect(page.getByRole("link", { name: number })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "رقم المخالفة" })).toHaveValue(number);

  // موظف مكتب آخر: لا يجد المخالفة ولا يصل إلى صفحتها ولا إلى ملفها بالرابط المباشر
  const violationUrl = page.url();
  void violationUrl;
  const id = (await page.getByRole("link", { name: number }).getAttribute("href"))!;
  const ctx = await browser.newContext({ ...info.project.use });
  const p2 = await ctx.newPage();
  await login(p2, `outsider-${info.project.name}`);
  await p2.goto(`/violations?q=${encodeURIComponent(offender)}`);
  await expect(p2.getByText("لا توجد مخالفات مطابقة")).toBeVisible();
  await p2.goto(id);
  await expect(p2.getByRole("heading", { name: "الصفحة غير موجودة" })).toBeVisible();
  const r2 = await p2.request.get(fileHref!);
  expect(r2.status()).toBe(404);
  await ctx.close();

  // بلا جلسة: الملف غير متاح
  const anon = await browser.newContext();
  expect((await anon.request.get(`${info.project.use.baseURL ?? "http://localhost:3000"}${fileHref}`)).status()).toBe(401);
  await anon.close();
});
