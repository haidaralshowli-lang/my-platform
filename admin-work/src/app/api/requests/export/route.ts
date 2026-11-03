import { NextResponse, type NextRequest } from "next/server";
import { getSession, requestContext } from "@/lib/auth/server";
import { can } from "@/lib/rbac";
import { XLSX_TYPE } from "@/lib/excel";
import { todayStr } from "@/lib/dates";
import { exportRequests, requestFilterSchema } from "@/lib/services/requests";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s || s.actor.mustChangePassword) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  if (!can(s.actor, "requests.view")) return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  const f = requestFilterSchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  const { buf } = await exportRequests(s.actor, f, await requestContext());
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Disposition": `attachment; filename="${f.overdue ? "overdue-requests" : "requests"}-${todayStr()}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
