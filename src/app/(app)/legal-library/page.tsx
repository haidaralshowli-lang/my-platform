import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth/server";
import { can } from "@/lib/rbac/actor";
import { Badge, Card, DataTable, EmptyState, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/datetime";
import { LEGAL_DOC_STATUS_LABELS, LEGAL_DOC_TYPE_LABELS } from "@/lib/documents";
import { searchLegalDocuments } from "@/lib/services/legal-library";
import { CreateLegalDocForm } from "./forms";

export const metadata = { title: "اللوائح والقوانين والتعليمات" };

export default async function LegalLibraryPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const actor = await requirePagePermission("legal_library.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const { total, rows, pages } = await searchLegalDocuments(actor, sp.q ?? "", page);
  const manage = can(actor, "legal_library.manage");
  const allDocs = manage ? await prisma.legalDocument.findMany({ select: { id: true, title: true }, orderBy: { title: "asc" } }) : [];
  return (
    <>
      <PageHeader title="اللوائح والقوانين والتعليمات" description="مكتبة مرجعية للوثائق القانونية والفنية. النظام لا يفسر النصوص ولا يحدد العقوبات؛ القرار للجهة المخولة." />
      <Card className="mb-6">
        <form className="flex flex-wrap gap-2" role="search">
          <input name="q" defaultValue={sp.q} placeholder="البحث بالعنوان أو الرقم أو الكلمات المفتاحية أو نص المواد" aria-label="بحث" className="field-input max-w-xl flex-1" />
          <button className="rounded-md bg-brand px-4 py-2 text-sm text-white">بحث</button>
        </form>
      </Card>
      <Card title={`الوثائق (${total})`} className="mb-6">
        {rows.length === 0 ? <EmptyState>لا توجد وثائق مطابقة.</EmptyState> : (
          <DataTable>
            <thead><tr><th>العنوان</th><th>النوع</th><th>الرقم</th><th>تاريخ الصدور</th><th>الحالة</th><th>الإصدارات</th></tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td><Link href={`/legal-library/${d.id}`} className="font-medium text-brand hover:underline">{d.title}</Link></td>
                  <td className="text-xs">{LEGAL_DOC_TYPE_LABELS[d.docType]}</td>
                  <td className="text-xs"><bdi>{d.number ?? "—"}</bdi></td>
                  <td className="text-xs">{formatDate(d.issuedAt)}</td>
                  <td><Badge tone={d.status === "IN_FORCE" ? "success" : d.status === "REPEALED" ? "danger" : "neutral"}>{LEGAL_DOC_STATUS_LABELS[d.status]}</Badge></td>
                  <td className="text-xs">{d._count.versions}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
        {pages > 1 && (
          <nav className="mt-3 flex gap-2 text-sm">
            {page > 1 && <Link className="rounded border border-line px-3 py-1" href={`?${new URLSearchParams({ q: sp.q ?? "", page: String(page - 1) })}`}>السابق</Link>}
            {page < pages && <Link className="rounded border border-line px-3 py-1" href={`?${new URLSearchParams({ q: sp.q ?? "", page: String(page + 1) })}`}>التالي</Link>}
          </nav>
        )}
      </Card>
      {manage && <Card title="إضافة وثيقة مرجعية"><CreateLegalDocForm docs={allDocs} /></Card>}
    </>
  );
}
