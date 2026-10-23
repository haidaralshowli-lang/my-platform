import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const state = JSON.parse(readFileSync("tests/e2e/.state.json", "utf8")) as {
  admins: Record<string, { username: string; password: string }>;
  suffix: string;
};

async function login(page: import("@playwright/test").Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("اسم المستخدم").fill(username);
  await page.getByLabel("كلمة المرور").fill(password);
  await page.getByRole("button", { name: "دخول" }).click();
}

async function openNav(page: import("@playwright/test").Page) {
  const toggle = page.getByRole("button", { name: "فتح القائمة" });
  if (await toggle.isVisible()) await toggle.click();
}

test("الصفحات المحمية تعيد التوجيه لصفحة الدخول، والواجهة RTL عربية", async ({ page }) => {
  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.getByText("منصة إدارة المخالفات").first()).toBeVisible();
});

test("بيانات دخول خاطئة تعرض رسالة عربية موحدة", async ({ page }) => {
  await login(page, "nobody-here", "WrongPassword1");
  await expect(page.getByRole("alert").filter({ hasText: "اسم المستخدم أو كلمة المرور غير صحيحة" })).toBeVisible();
});

test("دورة كاملة: دخول أول، تغيير كلمة المرور المؤقتة، إنشاء موظف، والتحقق من صلاحياته", async ({ page, browser }, info) => {
  const admin = state.admins[info.project.name];
  const newPassword = `Changed${state.suffix}2026x`;
  await login(page, admin.username, admin.password);

  // كلمة المرور المؤقتة تفرض التغيير قبل أي شيء آخر
  await expect(page).toHaveURL(/\/change-password$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByLabel("كلمة المرور الحالية").fill(admin.password);
  await page.getByLabel(/^كلمة المرور الجديدة\*?$/).fill(newPassword);
  await page.getByLabel("تأكيد كلمة المرور الجديدة").fill(newPassword);
  await page.getByRole("button", { name: "حفظ كلمة المرور" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "لوحة المعلومات" })).toBeVisible();

  // مدير النظام لا يرى المخالفات (لا صلاحية اطلاع) لكنه يرى إدارة المستخدمين
  await expect(page.getByText("لا يملك صلاحية الاطلاع على المخالفات")).toBeVisible();
  await openNav(page);
  await page.getByRole("link", { name: "إدارة المستخدمين والصلاحيات" }).click();
  await expect(page.getByRole("heading", { name: "إدارة المستخدمين والصلاحيات" })).toBeVisible();

  // إنشاء موظف تسجيل
  await page.getByRole("link", { name: "إنشاء حساب" }).click();
  const username = `e2e-reg-${info.project.name}-${state.suffix}`;
  await page.getByLabel("اسم المستخدم").fill(username);
  await page.getByLabel("الاسم الكامل").fill("موظف تسجيل تجريبي");
  await page.getByLabel("المحافظة").selectOption({ label: "بغداد" });
  await page.getByLabel("المكتب أو الفرع").selectOption({ label: "المقر العام" });
  await page.getByLabel(/موظف تسجيل المخالفة/).check();
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();
  const temp = (await page.locator(".select-all").first().textContent())!.trim();
  expect(temp.length).toBeGreaterThanOrEqual(12);

  // الموظف الجديد في جلسة منفصلة: يُلزم بتغيير كلمة المرور، ولا يصل إلى إدارة المستخدمين
  const ctx = await browser.newContext({ ...info.project.use });
  const p2 = await ctx.newPage();
  await login(p2, username, temp);
  await expect(p2).toHaveURL(/\/change-password$/);
  await p2.getByLabel("كلمة المرور الحالية").fill(temp);
  await p2.getByLabel(/^كلمة المرور الجديدة\*?$/).fill(newPassword);
  await p2.getByLabel("تأكيد كلمة المرور الجديدة").fill(newPassword);
  await p2.getByRole("button", { name: "حفظ كلمة المرور" }).click();
  await expect(p2).toHaveURL(/\/dashboard$/);
  await expect(p2.getByText("إجمالي المخالفات المسجلة")).toBeVisible();
  await p2.goto("/admin/users");
  await expect(p2).toHaveURL(/\/forbidden$/);
  await openNav(p2);
  await expect(p2.getByRole("link", { name: "إدارة المستخدمين والصلاحيات" })).toHaveCount(0);
  await p2.screenshot({ path: `test-results/dashboard-${info.project.name}.png`, fullPage: true });
  await ctx.close();

  // تسجيل الخروج يلغي الجلسة
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
});
