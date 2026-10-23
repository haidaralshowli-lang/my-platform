import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth/server";
import { can } from "@/lib/rbac/actor";
import { Badge, Card, PageHeader } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { LEGAL_DOC_STATUS_LABELS, LEGAL_DOC_TYPE_LABELS } from "@/lib/documents";
import { LegalDocActions } from "../forms";

export const metadata = { title: "وثيقة مرجعية" };

export default async function LegalDocPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePagePermission("legal_library.view");
  const { id } = await params;
  const d = await prisma.legalDocument.findUnique({
    where: { id },
    include: {
      previousDocument: true, nextDocuments: true,
      versions: { orderBy: { versionNo: "desc" }, include: { articles: { orderBy: { sortOrder: "asc" }, include: { _count: { select: { violationRefs: true } } } } } },
    },
  });
  if (!d) notFound();
  const files = await prisma.attachment.findMany({ where: { ownerType: "LegalDocumentVersion", ownerId: { in: d.versions.map((v) => v.id) } }, include: { versions: { orderBy: { versionNo: "desc" }, take: 1 } } });
  const current = d.versions[0];
  return (
    <>
      <PageHeader title={d.title} description={d.description ?? undefined} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone={d.status === "IN_FORCE" ? "success" : d.status === "REPEALED" ? "danger" : "neutral"}>{LEGAL_DOC_STATUS_LABELS[d.status]}</Badge>
        <Badge tone="info">{LEGAL_DOC_TYPE_LABELS[d.docType]}</Badge>
        {d.keywords.map((k) => <Badge key={k}>{k}</Badge>)}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          {d.versions.map((v) => (
            <Card key={v.id} title={`الإصدار ${v.versionNo}${v === current ? " (الحالي)" : ""}`}>
              <p className="mb-2 text-xs text-muted">{formatDateTime(v.createdAt)}{v.notes ? ` — ${v.notes}` : ""}</p>
              <div className="mb-3 flex flex-wrap gap-3 text-sm">
                {files.filter((f) => f.ownerId === v.id).map((f) => (
                  <a key={f.id} className="text-brand underline" href={`/api/files/${f.versions[0].id}`} target="_blank" rel="noopener">{f.versions[0].originalName}</a>
                ))}
              </div>
              {v.articles.length === 0 ? <p className="text-sm text-muted">لا توجد مواد مفهرسة في هذا الإصدار.</p> : (
                <ul className="flex flex-col divide-y divide-line">
                  {v.articles.map((a) => (
                    <li key={a.id} className="py-2">
                      <div className="text-sm font-medium">المادة {a.articleNumber}{a.paragraph && ` / الفقرة ${a.paragraph}`}{a._count.violationRefs > 0 && <span className="ms-2 text-xs text-muted">(مستند إليها في {a._count.violationRefs} مخالفة)</span>}</div>
                      <p className="text-sm leading-7 whitespace-pre-wrap">{a.text}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
        <div className="flex flex-col gap-6">
          <Card title="بيانات الوثيقة">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted">الرقم</dt><dd><bdi>{d.number ?? "—"}</bdi></dd>
              <dt className="text-muted">تاريخ الصدور</dt><dd>{formatDate(d.issuedAt)}</dd>
              <dt className="text-muted">تاريخ النفاذ</dt><dd>{formatDate(d.effectiveAt)}</dd>
              <dt className="text-muted">الجهة المصدرة</dt><dd>{d.issuer ?? "—"}</dd>
              <dt className="text-muted">تاريخ الإضافة</dt><dd>{formatDate(d.createdAt)}</dd>
            </dl>
            {d.previousDocument && <p className="mt-3 text-sm">الوثيقة السابقة: <Link className="text-brand underline" href={`/legal-library/${d.previousDocument.id}`}>{d.previousDocument.title}</Link></p>}
            {d.nextDocuments.map((n) => <p key={n.id} className="mt-1 text-sm">وثيقة لاحقة: <Link className="text-brand underline" href={`/legal-library/${n.id}`}>{n.title}</Link></p>)}
          </Card>
          {can(actor, "legal_library.manage") && current && <Card title="إدارة الوثيقة"><LegalDocActions documentId={d.id} versionId={current.id} status={d.status} /></Card>}
        </div>
      </div>
    </>
  );
}
