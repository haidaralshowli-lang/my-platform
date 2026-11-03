import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/server";
import { markRead } from "@/lib/services/notifications";

export const dynamic = "force-dynamic";

/// يعلّم التنبيه مقروءاً ثم ينتقل إلى السجل المرتبط به (روابط داخلية فقط)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.redirect(new URL("/login", req.url));
  const { id } = await params;
  const n = /^[0-9a-f-]{36}$/i.test(id) ? await markRead(s.actor.id, id) : null;
  const target = n?.link && n.link.startsWith("/") && !n.link.startsWith("//") ? n.link : "/notifications";
  return NextResponse.redirect(new URL(target, req.url));
}
