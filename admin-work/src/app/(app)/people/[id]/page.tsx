import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/server";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { orNotFound } from "@/lib/page-helpers";
import { DATA_STATUS, ENGAGEMENT } from "@/lib/labels";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { getSetting } from "@/lib/settings";
import { getPerson, personFormOptions } from "@/lib/services/people";
import { Alert, Badge, Card, PageHeader } from "@/components/ui";
import { updatePersonAction } from "../actions";
import { PersonForm } from "../person-form";
import { DeletePersonForm } from "./delete-form";

export const metadata = { title: "سجل شخص" };

const FIELD_LABELS: Record<string, string> = {
  fullName: "الاسم الكامل",
  phone: "رقم الهاتف",
  regionId: "المنطقة",
  followUpOwnerId: "مسؤول المتابعة",
  dataStatus: "حالة البيانات",
  engagementLevel: "مستوى التفاعل",
  availableForWork: "متاح للتعاون",
  notes: "ملاحظات",
};

const ACTION_LABELS: Record<string, string> = {
  "person.create": "إنشاء السجل",
  "person.update": "تعديل",
  "person.delete": "حذف",
  "person.restore": "استعادة",
  "person.merge": "دمج سجل مكرر فيه",
  "person.mark_distinct": "تأكيد عدم التكرار",
};

export default async function PersonPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePagePermission("people.view");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const p = await orNotFound(getPerson(id, { includeDeleted: can(actor, "people.delete") }));
  const [{ regions, owners }, history, staleDays] = await Promise.all([
    personFormOptions(),
    prisma.auditLog.findMany({ where: { entityType: "Person", entityId: id }, orderBy: { id: "desc" }, take: 30 }),
    getSetting(prisma, "people.staleDays"),
  ]);
  // يُبقي المنطقة/المسؤول الحاليين في القوائم حتى لو عُطِّلا لاحقاً
  const regionOpts = p.regionId && !regions.some((r) => r.id === p.regionId) ? [...regions, { id: p.regionId, name: `${p.region?.name} (معطلة)` }] : regions;
  const ownerOpts = owners.map((o) => ({ id: o.id, name: o.fullName }));
  if (p.followUpOwner && !owners.some((o) => o.id === p.followUpOwner!.id)) ownerOpts.push({ id: p.followUpOwner.id, name: `${p.followUpOwner.fullName} (معطل)` });

  const [allRegions, allUsers] = await Promise.all([prisma.region.findMany({ select: { id: true, name: true } }), prisma.user.findMany({ select: { id: true, fullName: true } })]);
  const regionName = new Map(allRegions.map((r) => [r.id, r.name]));
  const userName = new Map(allUsers.map((u) => [u.id, u.fullName]));
  const show = (k: string, v: unknown): string => {
    if (v === null || v === undefined || v === "") return "—";
    if (k === "regionId") return regionName.get(Number(v)) ?? String(v);
    if (k === "followUpOwnerId") return userName.get(String(v)) ?? String(v);
    if (k === "dataStatus") return DATA_STATUS[v as keyof typeof DATA_STATUS]?.label ?? String(v);
    if (k === "engagementLevel") return ENGAGEMENT[v as keyof typeof ENGAGEMENT]?.label ?? String(v);
    if (typeof v === "boolean") return v ? "نعم" : "لا";
    return String(v);
  };
  const stale = p.updatedAt < new Date(Date.now() - staleDays * 86_400_000);
  const deleted = !!p.deletedAt;

  return (
    <>
      <PageHeader
        title={p.fullName}
        description={`الرقم التسلسلي ${p.serial}`}
        actions={
          <Link href="/people" className="text-sm text-brand hover:underline">
            ← العودة إلى القائمة
          </Link>
        }
      />
      <div className="mb-4 flex flex-col gap-2">
        {sp.created === "1" && <Alert tone="success">تم حفظ السجل برقم تسلسلي {p.serial}.</Alert>}
        {deleted && (
          <Alert tone="danger">
            هذا السجل محذوف منذ {fmtDateTime(p.deletedAt)}. السبب: {p.deleteReason ?? "—"}
            {p.mergedInto && (
              <>
                {" "}
                — دُمج في{" "}
                <Link href={`/people/${p.mergedInto.id}`} className="underline">
                  السجل رقم {p.mergedInto.serial}
                </Link>
              </>
            )}
            . الاستعادة من صفحة «السجلات المحذوفة».
          </Alert>
        )}
        {!deleted && stale && <Alert tone="warning">لم يُحدَّث هذا السجل منذ أكثر من {staleDays} يوماً.</Alert>}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="ملخص السجل">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">حالة البيانات</dt>
            <dd>
              <Badge tone={DATA_STATUS[p.dataStatus].tone}>{DATA_STATUS[p.dataStatus].label}</Badge>
            </dd>
            <dt className="text-muted">مستوى التفاعل</dt>
            <dd>
              <Badge tone={ENGAGEMENT[p.engagementLevel].tone}>{ENGAGEMENT[p.engagementLevel].label}</Badge>
            </dd>
            <dt className="text-muted">متاح للتعاون</dt>
            <dd>{p.availableForWork ? "نعم" : "لا"}</dd>
            <dt className="text-muted">تاريخ الإضافة</dt>
            <dd className="ltr-num">{fmtDateTime(p.createdAt)}</dd>
            <dt className="text-muted">آخر تحديث</dt>
            <dd className="ltr-num">{fmtDateTime(p.updatedAt)}</dd>
          </dl>
          <h3 className="mt-5 mb-2 text-sm font-semibold text-brand">المهام التي وافق على تنفيذها</h3>
          {p.tasks.length === 0 ? (
            <p className="text-sm text-muted">لا توجد مهام موافق عليها.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {p.tasks.map((t) => (
                <li key={t.id}>
                  <span className="ltr-num text-muted">{t.number}</span> {t.title} — <span className="ltr-num">{t.progress}%</span>، الموعد <span className="ltr-num">{fmtDate(t.dueDate)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={can(actor, "people.edit") && !deleted ? "تعديل البيانات" : "البيانات"} className="lg:col-span-2">
          {can(actor, "people.edit") && !deleted ? (
            <PersonForm
              action={updatePersonAction.bind(null, p.id)}
              regions={regionOpts}
              owners={ownerOpts}
              personId={p.id}
              submitLabel="حفظ التعديلات"
              initial={{
                fullName: p.fullName,
                phone: p.phone,
                regionId: p.regionId,
                followUpOwnerId: p.followUpOwnerId,
                engagementLevel: p.engagementLevel,
                availableForWork: p.availableForWork,
                needsUpdate: p.dataStatus === "NEEDS_UPDATE",
                notes: p.notes,
              }}
            />
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              {(["fullName", "phone", "regionId", "followUpOwnerId", "notes"] as const).map((k) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{FIELD_LABELS[k]}</dt>
                  <dd className={k === "phone" ? "ltr-num" : undefined}>{show(k, p[k])}</dd>
                </div>
              ))}
            </dl>
          )}
        </Card>
        <Card title="سجل التعديلات" className="lg:col-span-2">
          {history.length === 0 ? (
            <p className="text-sm text-muted">لا توجد عمليات مسجلة.</p>
          ) : (
            <ol className="relative space-y-4 border-s border-line ps-4">
              {history.map((h) => {
                const before = (h.before ?? {}) as Record<string, unknown>;
                const after = (h.after ?? {}) as Record<string, unknown>;
                const changed = h.action === "person.update" ? Object.keys(FIELD_LABELS).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])) : [];
                return (
                  <li key={String(h.id)} className="text-sm">
                    <span className="absolute -start-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-accent" aria-hidden />
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">{ACTION_LABELS[h.action] ?? h.action}</span>
                      <span className="ltr-num text-xs text-muted">{fmtDateTime(h.at)}</span>
                      <span className="text-xs text-muted">بواسطة {h.username ?? "—"}</span>
                    </div>
                    {h.reason && <div className="text-xs text-muted">السبب: {h.reason}</div>}
                    {changed.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-xs">
                        {changed.map((k) => (
                          <li key={k}>
                            <span className="text-muted">{FIELD_LABELS[k]}:</span> <del className="text-tone-danger">{show(k, before[k])}</del> ← <ins className="text-tone-success no-underline">{show(k, after[k])}</ins>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
        {can(actor, "people.delete") && !deleted && (
          <Card title="حذف السجل">
            <DeletePersonForm id={p.id} />
          </Card>
        )}
      </div>
    </>
  );
}
