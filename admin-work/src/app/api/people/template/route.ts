import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/server";
import { can } from "@/lib/rbac";
import { buildTemplate } from "@/lib/services/people-excel";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getSession();
  if (!s || s.actor.mustChangePassword) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  if (!can(s.actor, "people.import")) return NextResponse.json({ error: "لا تملك صلاحية الاستيراد" }, { status: 403 });
  return new NextResponse(new Uint8Array(await buildTemplate()), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="people-import-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
