// دالة Netlify مجدولة: تستدعي فحص المواعيد وتوليد التنبيهات كل ساعة مع الرمز السري
export default async function notificationsCron() {
  const base = process.env.URL ?? process.env.APP_URL;
  const res = await fetch(`${base}/api/cron/notifications`, { method: "POST", headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  console.log("notifications-cron", res.status, await res.text());
}

export const config = { schedule: "@hourly" };
