// دالة Netlify مجدولة: تستدعي مهمة تحديث المدد كل ساعة مع الرمز السري

export default async function deadlinesCron() {
  const base = process.env.URL ?? process.env.APP_URL;
  const res = await fetch(`${base}/api/cron/deadlines`, { method: "POST", headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  console.log("deadlines-cron", res.status, await res.text());
}

export const config = { schedule: "@hourly" };
