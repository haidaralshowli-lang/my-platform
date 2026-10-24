import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
const U = "http://localhost:3000"; const LOG = "/var/log/postgresql/postgresql-16-main.log";
const lines = () => Number(execSync(`wc -l < ${LOG}`).toString());
const count = (from) => Number(execSync(`tail -n +${from + 1} ${LOG} | grep -cE "LOG:  (statement|execute)" || true`).toString());
const b = await chromium.launch(); const p = await (await b.newContext()).newPage();
await p.goto(`${U}/login`); await p.getByLabel(/اسم المستخدم/).fill("shot.viewer"); await p.getByLabel(/كلمة المرور/).fill("ShotViewer12345");
await p.getByRole("button", { name: /دخول/ }).click(); await p.waitForURL(/dashboard/); await p.waitForTimeout(1500);
for (const path of ["/notifications", "/violations", "/dashboard"]) { const n = lines(); await p.goto(U + path); await p.waitForTimeout(1500); console.log(path, count(n), "statements"); }
await b.close();
