import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { readFileSync } from "node:fs";

const state = JSON.parse(readFileSync("tests/e2e/.state.json", "utf8")) as {
  staff: Record<string, { username: string; password: string }>;
  suffix: string;
  docTitle: string;
};

async function as(browser: Browser, info: TestInfo, who: string): Promise<Page> {
  const ctx = await browser.newContext({ ...info.project.use });
  const page = await ctx.newPage();
  const u = state.staff[`${who}-${info.project.name}`];
  await page.goto("/login");
  await page.getByLabel("اسم المستخدم").fill(u.username);
  await page.getByLabel("كلمة المرور").fill(u.password);
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  return page;
}

async function confirm(page: Page, button: string) {
  await page.getByRole("button", { name: button, exact: true }).first().click();
  await page.getByRole("dialog").filter({ visible: true }).getByRole("button", { name: "تأكيد" }).click();
}

test("مسار المصادقات كاملاً: رئيس الهيئة، القسم الفني، الدائرة القانونية، الإنذار، النسخة الموقعة", async ({ browser }, info) => {
  test.setTimeout(180_000);
  // موظف التسجيل يجهز معاملة ويحيلها
  const reg = await as(browser, info, "registrar");
  await reg.goto("/violations/new");
  const offender = `جهة مصادقات ${info.project.name} ${state.suffix}`;
  await reg.getByLabel(/^اسم الجهة المخالفة/).fill(offender);
  await reg.getByLabel(/^تاريخ اكتشاف المخالفة/).fill("2026-09-10");
  await reg.getByLabel(/^نوع المخالفة/).selectOption({ label: "نوع مخالفة لاختبار الواجهة" });
  await reg.getByLabel(/^مصدر اكتشافها/).selectOption({ index: 1 });
  await reg.getByLabel(/^وصف المخالفة/).fill("وصف لاختبار مسار المصادقات");
  await reg.getByRole("button", { name: "حفظ المسودة" }).click();
  await expect(reg.getByText("تم حفظ البيانات.")).toBeVisible();
  const url = reg.url().split("?")[0];
  await confirm(reg, "تسجيل المخالفة رسمياً");
  await reg.getByLabel(/^الملفات/).setInputFiles("tests/e2e/fixtures/mahdar.pdf");
  await reg.getByRole("button", { name: "رفع", exact: true }).click();
  await expect(reg.getByText("mahdar.pdf")).toBeVisible();
  await confirm(reg, "إحالة للمصادقة النهائية");
  await expect(reg.getByText("بانتظار المصادقة النهائية").first()).toBeVisible();
  // موظف التسجيل لا يرى نموذج المصادقة
  await expect(reg.getByText("قرار المصادقة النهائية")).toHaveCount(0);

  // رئيس الهيئة: من قائمة الانتظار إلى القرار
  const chair = await as(browser, info, "chairman");
  await chair.goto("/queues/approval");
  await chair.getByRole("link", { name: /م-/ }).filter({ has: chair.locator("bdi") }).first().waitFor();
  await chair.goto(url);
  await confirm(chair, "المصادقة النهائية");
  await expect(chair.getByText("تم تسجيل القرار.")).toBeVisible();
  await expect(chair.getByText("بانتظار الموقف الفني").first()).toBeVisible();

  // القسم الفني: ربط مادة من المكتبة ثم الموقف الفني
  const tech = await as(browser, info, "technical");
  await tech.goto(url);
  await tech.getByLabel("بحث في المواد").fill(state.docTitle);
  await tech.getByRole("button", { name: "بحث في المكتبة" }).click();
  await tech.getByRole("button", { name: "ربط المادة" }).first().click();
  await expect(tech.getByText("رُبطت المادة بالمخالفة")).toBeVisible();
  await tech.getByLabel(/^الموقف الفني/).fill("ثبت فنياً وجود البث المخالف.");
  await tech.getByLabel(/^أسباب الموقف الفني/).fill("نتائج الرصد والقياس المرفقة.");
  await confirm(tech, "تقديم");
  await expect(tech.getByText("اعتُمد الموقف الفني")).toBeVisible();

  // الدائرة القانونية: إعداد الرأي، ثم مصادقة زميل
  const legal = await as(browser, info, "legal");
  await legal.goto(url);
  await legal.getByLabel(/^الرأي القانوني/).fill("المخالفة ثابتة ويستوجب الأمر الإنذار.");
  await legal.getByLabel(/^أسباب الرأي/).fill("انطباق المادة المرتبطة.");
  await confirm(legal, "تقديم");
  await expect(legal.getByText("قُدِّم الرأي القانوني للمصادقة")).toBeVisible();
  const legal2 = await as(browser, info, "legal2");
  await legal2.goto(url);
  await confirm(legal2, "المصادقة القانونية");
  await expect(legal2.getByText("بانتظار موافقة إصدار الإنذار").first()).toBeVisible();

  // رئيس الهيئة: الموافقة على الإنذار
  await chair.goto(url);
  await confirm(chair, "الموافقة على إصدار الإنذار");
  await expect(chair.getByText("إعداد الإنذار").first()).toBeVisible();

  // إعداد الإنذار من القالب
  await legal.goto(url);
  await legal.getByLabel(/^القالب المعتمد/).selectOption({ label: `قالب واجهة ${state.suffix}` });
  await legal.getByLabel(/^الإجراء المطلوب/).fill("إيقاف البث المخالف فوراً");
  await legal.getByLabel(/^المدة المحددة للاستجابة/).fill("عشرة أيام من تاريخ التبليغ");
  await confirm(legal, "إعداد الإنذار");
  await expect(legal.getByText("أُعد الإنذار وهو بانتظار التوقيع اليدوي.")).toBeVisible();
  const printHref = await legal.getByRole("link", { name: /نسخة الإنذار قبل التوقيع/ }).getAttribute("href");
  await legal.goto(printHref!);
  await expect(legal.getByRole("heading", { name: "إنذار" })).toBeVisible();
  await expect(legal.getByText(`المادة (9) الفقرة (أولاً) من ${state.docTitle} رقم (E2E-1)`)).toBeVisible();
  await expect(legal.getByText(offender).first()).toBeVisible();
  const docx = await legal.request.get(printHref!.replace("/warnings/", "/api/warnings/").replace("/print", "/docx"));
  expect(docx.status()).toBe(200);
  expect(docx.headers()["content-type"]).toContain("wordprocessingml");

  // شعبة التبليغات: رفع النسخة الموقعة يدوياً
  const del = await as(browser, info, "delivery");
  await del.goto(url);
  await del.getByLabel(/^اسم صاحب التوقيع/).fill("رئيس الهيئة");
  await del.getByLabel(/^تاريخ التوقيع/).fill(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad" }).format(new Date()));
  await del.getByLabel(/^النسخة الضوئية الموقعة/).setInputFiles("tests/e2e/fixtures/mahdar.pdf");
  await confirm(del, "رفع النسخة الموقعة");
  await expect(del.getByText("رُفعت النسخة الموقعة وانتقلت المعاملة إلى مرحلة التبليغ.")).toBeVisible();
  await expect(del.getByText("بانتظار التبليغ").first()).toBeVisible();
  await expect(del.getByText("سجل القرارات والمصادقات")).toBeVisible();
  await del.screenshot({ path: `test-results/approvals-${info.project.name}.png`, fullPage: true });
});

test("لا تمرير أفقي في صفحات المنصة الرئيسية", async ({ browser }, info) => {
  const page = await as(browser, info, "chairman");
  for (const path of ["/dashboard", "/violations", "/queues/approval", "/warnings", "/legal-library"]) {
    await page.goto(path);
    const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(sw, path).toBeLessThanOrEqual(cw);
  }
  // صفحة مخالفة فيها سجل قرارات (جدول عريض)
  await page.goto("/violations?stage=AWAITING_DELIVERY");
  const link = page.locator("tbody a").first();
  if (await link.count()) {
    await link.click();
    await page.waitForURL(/\/violations\/c/);
    const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(sw).toBeLessThanOrEqual(cw);
  }
});
