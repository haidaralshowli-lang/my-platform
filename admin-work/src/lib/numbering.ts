import type { Tx } from "@/lib/db";

/// الرقم التالي بصيغة PREFIX-YYYY-NNNN. الزيادة ذرية (INSERT ... ON CONFLICT) فلا يتكرر الرقم مع الطلبات المتزامنة،
/// ويُلغى الرقم مع المعاملة إذا فشلت.
export async function nextNumber(tx: Tx, prefix: "REQ" | "TSK", year: number): Promise<string> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" (name, year, value) VALUES (${prefix}, ${year}, 1)
    ON CONFLICT (name, year) DO UPDATE SET value = "Counter".value + 1
    RETURNING value`;
  return `${prefix}-${year}-${String(rows[0].value).padStart(4, "0")}`;
}
