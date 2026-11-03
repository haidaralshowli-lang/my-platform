"use server";

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/server";
import { can } from "@/lib/rbac";
import { forbidden } from "@/lib/errors";
import { normalizeArabicName, toLatinDigits } from "@/lib/text";

export type PersonOption = { id: string; serial: number; fullName: string; regionName: string | null; availableForWork: boolean };

/// بحث سريع عن الأشخاص لاختيار مقدم الطلب أو المكلف بالمهمة
export async function searchPeopleAction(q: string): Promise<PersonOption[]> {
  const s = await getSession();
  if (!s || s.actor.mustChangePassword) throw forbidden();
  if (!["people.view", "tasks.create", "tasks.update", "requests.create", "requests.update"].some((p) => can(s.actor, p as never))) throw forbidden();
  const term = toLatinDigits(String(q).trim()).slice(0, 100);
  if (term.length < 1) return [];
  const rows = await prisma.person.findMany({
    where: {
      deletedAt: null,
      OR: [{ normalizedName: { contains: normalizeArabicName(term) } }, ...(/^\d{1,9}$/.test(term) ? [{ serial: Number(term) }] : [])],
    },
    orderBy: [{ availableForWork: "desc" }, { serial: "asc" }],
    take: 10,
    select: { id: true, serial: true, fullName: true, availableForWork: true, region: { select: { name: true } } },
  });
  return rows.map((r) => ({ id: r.id, serial: r.serial, fullName: r.fullName, availableForWork: r.availableForWork, regionName: r.region?.name ?? null }));
}
