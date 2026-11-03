import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runNotificationScan } from "@/lib/services/notifications";

export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/// المهمة المجدولة لفحص المواعيد وتوليد التنبيهات (يُنصح بتشغيلها كل ساعة)
export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const result = await runNotificationScan();
  return NextResponse.json({ ok: true, result });
}
