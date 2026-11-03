import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/server";
import { can } from "@/lib/rbac";
import { duplicatePairs, SIMILARITY_THRESHOLD } from "@/lib/services/people";
import { Badge, Card, PageHeader } from "@/components/ui";
import { PairActions } from "../row-actions";

export const metadata = { title: "مراجعة الأسماء المتشابهة" };

function Side({ id, serial, name, phone, region }: { id: string; serial: number; name: string; phone: string | null; region: string | null }) {
  return (
    <div className="min-w-0 flex-1 rounded-md bg-band/70 p-3 text-sm">
      <Link href={`/people/${id}`} target="_blank" className="font-medium text-brand hover:underline">
        <span className="ltr-num text-muted">#{serial}</span> {name}
      </Link>
      <div className="mt-1 text-xs text-muted">
        {region ?? "دون منطقة"}
        {phone && <span className="ltr-num"> · {phone}</span>}
      </div>
    </div>
  );
}

export default async function DuplicatesPage() {
  const actor = await requirePagePermission("people.view");
  const pairs = await duplicatePairs(100);
  const canMerge = can(actor, "people.merge");
  const canEdit = can(actor, "people.edit");
  return (
    <>
      <PageHeader
        title="مراجعة الأسماء المتشابهة"
        description={`أزواج السجلات التي تتشابه أسماؤها بنسبة ${Math.round(SIMILARITY_THRESHOLD * 100)}% فأكثر بعد توحيد الهمزات والتاء المربوطة والمسافات. راجع كل زوج قبل الدمج: الدمج يُكمل الحقول الفارغة في السجل المُبقى عليه، وينقل إليه المهام والطلبات، ويحذف الآخر حذفاً ناعماً.`}
        actions={
          <Link href="/people" className="text-sm text-brand hover:underline">
            ← العودة إلى القائمة
          </Link>
        }
      />
      <Card title={`أزواج بانتظار المراجعة (${pairs.length}${pairs.length === 100 ? "+" : ""})`}>
        {!canMerge && <p className="mb-3 text-sm text-muted">الدمج من صلاحية مدير النظام. يمكنك تأكيد أن السجلين لشخصين مختلفين.</p>}
        {pairs.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">لا توجد أسماء متشابهة بانتظار المراجعة.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {pairs.map((p) => (
              <li key={`${p.aId}-${p.bId}`} className="rounded-lg border border-line p-3">
                <div className="mb-2 flex items-center gap-2">
                  <Badge tone={p.score >= 0.999 ? "danger" : p.score >= 0.75 ? "warning" : "neutral"}>
                    {p.score >= 0.999 ? "اسم مطابق" : <>تشابه <span className="ltr-num">{Math.round(p.score * 100)}%</span></>}
                  </Badge>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Side id={p.aId} serial={p.aSerial} name={p.aName} phone={p.aPhone} region={p.aRegion} />
                  <Side id={p.bId} serial={p.bSerial} name={p.bName} phone={p.bPhone} region={p.bRegion} />
                </div>
                <div className="mt-3">
                  <PairActions a={p.aId} b={p.bId} aSerial={p.aSerial} bSerial={p.bSerial} canMerge={canMerge} canEdit={canEdit} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
