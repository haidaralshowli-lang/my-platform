import { timingSafeEqual } from "node:crypto";
import { markDeadlineJobRun, refreshDeadlines } from "@/lib/services/deadlines";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/// تشغيل مهمة تحديث المدد والتنبيهات من مجدول خارجي (Netlify Scheduled Function أو cron على خادم الهيئة)
export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: "غير مصرح" }, { status: 401 });
  try {
    await markDeadlineJobRun();
    const result = await refreshDeadlines();
    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error("[cron-deadlines]", e instanceof Error ? e.message : e);
    return Response.json({ ok: false }, { status: 500 });
  }
}
