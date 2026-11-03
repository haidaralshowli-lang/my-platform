import { NextResponse, type NextRequest } from "next/server";
import { getSession, requestContext } from "@/lib/auth/server";
import { can } from "@/lib/rbac";
import { peopleFilterSchema } from "@/lib/services/people";
import { exportPeople } from "@/lib/services/people-excel";

export const dynamic = "force-dynamic";

/// تصدير الأشخاص المطابقين للفلاتر الحالية إلى Excel (يُسجَّل في سجل التدقيق)
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s || s.actor.mustChangePassword) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  if (!can(s.actor, "people.export")) return NextResponse.json({ error: "لا تملك صلاحية التصدير" }, { status: 403 });
  const f = peopleFilterSchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  const { buf } = await exportPeople(s.actor, f, await requestContext());
  const name = `people-${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
