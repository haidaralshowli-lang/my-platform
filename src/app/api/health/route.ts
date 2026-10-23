import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/// فحص الجاهزية: لا يكشف أي تفاصيل داخلية
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
