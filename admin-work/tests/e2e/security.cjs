// فحوص الأمان عبر HTTP على خادم قيد التشغيل وقاعدة اختبار (لا تُشغَّل على بيانات حقيقية: تُنشئ حساباً وسجلات).
// الاستخدام: E2E_BASE_URL=http://localhost:3100 E2E_ADMIN_USER=... E2E_ADMIN_PASS=... npm run test:security
// إذا كانت كلمة مرور المدير مؤقتة، تُغيَّر إلى E2E_ADMIN_NEWPASS. يلزم CRON_SECRET مضبوطاً على الخادم.
const { chromium } = require('playwright');
const B = process.env.E2E_BASE_URL || 'http://localhost:3100';
const ADMIN_USER = process.env.E2E_ADMIN_USER;
const ADMIN_PASS = process.env.E2E_ADMIN_PASS;
if (!ADMIN_USER || !ADMIN_PASS) { console.error('يلزم E2E_ADMIN_USER و E2E_ADMIN_PASS'); process.exit(2); }
const VIEWER = `viewer${Date.now().toString(36)}`;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const PAGES = ['/home', '/dashboard', '/people', '/people/new', '/people/import', '/people/duplicates', '/people/deleted', '/requests', '/requests/new', '/requests/deleted', '/tasks', '/tasks/new', '/tasks/deleted', '/notifications', '/reports', '/reports/weekly', '/users', '/settings', '/audit'];
const APIS = ['/api/people/export', '/api/people/template', '/api/requests/export', '/api/tasks/export', '/api/reports/people?format=xlsx'];
(async () => {
  const browser = await chromium.launch();
  // 1) دون جلسة
  const anon = await browser.newContext();
  for (const p of PAGES) {
    const r = await anon.request.get(B + p, { maxRedirects: 0 });
    check(`دون دخول ${p}`, r.status() === 307 && (r.headers().location || '').endsWith('/login'), String(r.status()));
  }
  for (const p of APIS) { const r = await anon.request.get(B + p, { maxRedirects: 0 }); check(`دون دخول ${p}`, r.status() === 401, String(r.status())); }
  check('المهمة المجدولة دون سر', (await anon.request.post(B + '/api/cron/notifications')).status() === 401);
  check('المهمة المجدولة بسر خاطئ', (await anon.request.post(B + '/api/cron/notifications', { headers: { Authorization: 'Bearer wrong-secret-wrong-secret' } })).status() === 401);
  // ملف جلسة مزوّر
  const forged = await browser.newContext();
  await forged.addCookies([{ name: 'aw_session', value: 'forged-token-value', url: B }]);
  const fr = await forged.request.get(B + '/people', { maxRedirects: 0 });
  check('ملف جلسة مزوّر', fr.status() === 307 && fr.headers().location.endsWith('/login'), String(fr.status()));

  // 2) الترويسات الأمنية
  const h = (await anon.request.get(B + '/login')).headers();
  check('Content-Security-Policy', /default-src 'self'/.test(h['content-security-policy'] || '') && /frame-ancestors 'none'/.test(h['content-security-policy']));
  check('X-Frame-Options: DENY', h['x-frame-options'] === 'DENY');
  check('X-Content-Type-Options: nosniff', h['x-content-type-options'] === 'nosniff');
  check('Strict-Transport-Security', /max-age=\d+/.test(h['strict-transport-security'] || ''));
  check('Referrer-Policy', !!h['referrer-policy']);
  check('لا يكشف X-Powered-By', !h['x-powered-by']);

  // 3) الدخول وملف الجلسة
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
  const login = async (u, p) => { await page.goto(B + '/login'); await page.fill('#username', u); await page.fill('#password', p); await page.click('button[type=submit]'); await page.waitForLoadState('networkidle'); };
  await login(ADMIN_USER, ADMIN_PASS);
  if (page.url().endsWith('/change-password')) {
    const np = process.env.E2E_ADMIN_NEWPASS;
    if (!np) throw new Error('كلمة مرور المدير مؤقتة: اضبط E2E_ADMIN_NEWPASS');
    await page.fill('#current', ADMIN_PASS); await page.fill('#next', np); await page.fill('#confirm', np); await page.click('button[type=submit]'); await page.waitForURL((u) => !u.pathname.includes('change-password'));
  }
  const cookie = (await ctx.cookies()).find((c) => c.name === 'aw_session');
  check('ملف الجلسة HttpOnly', cookie?.httpOnly === true);
  check('ملف الجلسة SameSite=Lax', cookie?.sameSite === 'Lax');
  check('ملف الجلسة Secure (الإنتاج)', cookie?.secure === true);

  // 4) حساب محدود الصلاحيات: الاطلاع على الأشخاص فقط
  await page.goto(B + '/users');
  await page.fill('#username', VIEWER); await page.fill('#fullName', 'مطلع فقط');
  for (const cb of await page.locator('input[name=permissions]').all()) if ((await cb.getAttribute('value')) !== 'people.view') await cb.uncheck();
  await page.click('button:has-text("إنشاء الحساب")');
  const temp = (await page.locator('.font-mono').first().textContent()).trim();

  // 5) محاولة حقن نصوص برمجية مخزنة في الأسماء والأوصاف
  const XSS = `<img src=x onerror="window.__xss=1;alert('xss')"><script>window.__xss=1</script>`;
  await page.goto(B + '/people/new'); await page.fill('#fullName', 'حقن ' + VIEWER + ' ' + XSS); await page.click('button:has-text("حفظ السجل")'); await page.waitForURL(/\/people\/[0-9a-f-]{36}/);
  const personUrl = page.url();
  await page.goto(B + '/requests/new'); await page.selectOption('#type', 'OTHER'); await page.fill('#applicantName', 'حقن ' + XSS); await page.fill('#description', XSS); await page.click('button:has-text("تسجيل الطلب")'); await page.waitForURL(/\/requests\/[0-9a-f-]{36}/);
  const reqUrl = page.url();
  for (const u of [personUrl, reqUrl, B + '/people', B + '/requests', B + '/dashboard', B + '/reports/requests-received', B + '/audit', B + '/people/duplicates']) {
    await page.goto(u); await page.waitForLoadState('networkidle');
    const flag = await page.evaluate(() => window.__xss);
    check(`لا تنفيذ لنص مخزن في ${u.replace(B, '').slice(0, 30)}`, flag === undefined && dialogs.length === 0);
  }
  check('النص يظهر كما هو (مهرَّباً)', (await page.goto(personUrl), await page.locator('h1').textContent()).includes('<img'));

  // 6) طلب إجراء خادمي من موقع خارجي (CSRF)
  const csrf = await ctx.request.post(B + '/people/new', { headers: { 'Next-Action': '0'.repeat(40), Origin: 'https://evil.example', 'Content-Type': 'text/plain;charset=UTF-8' }, data: '[]' });
  check('رفض الإجراء الخادمي من مصدر خارجي', csrf.status() >= 400, String(csrf.status()));

  // 7) تسجيل الخروج يبطل الجلسة حتى لو احتُفظ بملفها
  const stolen = (await ctx.cookies()).find((c) => c.name === 'aw_session');
  await page.click('button[aria-label="تسجيل الخروج"]'); await page.waitForURL('**/login');
  const replay = await browser.newContext(); await replay.addCookies([{ ...stolen }]);
  const rr = await replay.request.get(B + '/people', { maxRedirects: 0 });
  check('إعادة استخدام ملف جلسة بعد الخروج', rr.status() === 307 && rr.headers().location.endsWith('/login'), String(rr.status()));

  // 8) المطلع فقط
  await login(VIEWER, temp);
  await page.fill('#current', temp); await page.fill('#next', 'Viewer-Strong-2026'); await page.fill('#confirm', 'Viewer-Strong-2026'); await page.click('button[type=submit]'); await page.waitForURL('**/home');
  const nav = await page.locator('#main-nav a').allTextContents();
  check('قائمة المطلع: الرئيسية والأشخاص والتنبيهات فقط', JSON.stringify(nav) === JSON.stringify(['الرئيسية', 'قاعدة بيانات الأشخاص', 'التنبيهات']), nav.join('، '));
  for (const p of ['/dashboard', '/people/new', '/people/import', '/people/deleted', '/requests', '/requests/new', '/tasks', '/tasks/new', '/reports', '/reports/weekly', '/users', '/settings', '/audit', '/requests/deleted', '/tasks/deleted']) {
    await page.goto(B + p);
    check(`المطلع ممنوع من ${p}`, new URL(page.url()).pathname === '/forbidden', new URL(page.url()).pathname);
  }
  for (const p of APIS) { const r = await page.request.get(B + p); check(`المطلع ممنوع من ${p}`, r.status() === 403, String(r.status())); }
  await page.goto(personUrl);
  check('المطلع يرى السجل دون نموذج التعديل', (await page.locator('button:has-text("حفظ التعديلات")').count()) === 0 && (await page.locator('text=حذف السجل').count()) === 0);
  await page.goto(reqUrl);
  check('المطلع لا يفتح طلباً برابطه المباشر', new URL(page.url()).pathname === '/forbidden');
  const otherNotif = await page.request.get(B + '/notifications/open/00000000-0000-4000-8000-000000000000', { maxRedirects: 0 });
  check('لا يفتح تنبيهاً ليس له', (otherNotif.headers().location || '').endsWith('/notifications'));

  // 9) قفل الحساب بعد محاولات فاشلة
  const lockCtx = await browser.newContext(); const lp = await lockCtx.newPage();
  for (let i = 0; i < 6; i++) { await lp.goto(B + '/login'); await lp.fill('#username', VIEWER); await lp.fill('#password', 'wrong-password-' + i); await lp.click('button[type=submit]'); await lp.waitForSelector('p[role=alert]'); }
  check('قفل الحساب بعد 5 محاولات فاشلة', /مقفل/.test(await lp.locator('p[role=alert]').textContent()));

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
