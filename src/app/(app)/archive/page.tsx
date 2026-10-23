import { redirect } from "next/navigation";

/// الأرشيف: البحث في المخالفات المغلقة بالمحرك نفسه (يطبق النطاق والفلاتر)
export default async function ArchivePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams(Object.entries({ ...sp, status: "CLOSED" }).filter(([, v]) => v) as [string, string][]);
  redirect(`/violations?${qs}`);
}
