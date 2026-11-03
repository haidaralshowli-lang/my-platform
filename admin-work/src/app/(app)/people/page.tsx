import Link from "next/link";
import { ArrowDown, ArrowUp, Download, Plus, Trash2, Upload, Users } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/server";
import { can } from "@/lib/rbac";
import { DATA_STATUS, ENGAGEMENT, ENGAGEMENT_ORDER } from "@/lib/labels";
import { fmtDate } from "@/lib/format";
import { listPeople, peopleFilterSchema, personFormOptions, type PeopleFilter } from "@/lib/services/people";
import { Alert, Badge, Card, DataTable, LinkButton, PageHeader } from "@/components/ui";

export const metadata = { title: "قاعدة بيانات الأشخاص" };

function qs(f: PeopleFilter, patch: Partial<Record<keyof PeopleFilter, string | number | undefined>>) {
  const merged: Record<string, string | number | undefined> = { ...f, ...patch };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined || v === "") continue;
    if (k === "sort" && v === "serial") continue;
    if (k === "dir" && v === "desc") continue;
    if (k === "page" && v === 1) continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

function SortHeader({ f, col, children, className }: { f: PeopleFilter; col: PeopleFilter["sort"]; children: React.ReactNode; className?: string }) {
  const active = f.sort === col;
  const nextDir = active && f.dir === "desc" ? "asc" : "desc";
  return (
    <th className={className} aria-sort={active ? (f.dir === "asc" ? "ascending" : "descending") : undefined}>
      <Link href={`/people${qs(f, { sort: col, dir: nextDir, page: 1 })}`} className="inline-flex items-center gap-1 hover:underline">
        {children}
        {active && (f.dir === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)}
      </Link>
    </th>
  );
}

export default async function PeoplePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePagePermission("people.view");
  const sp = await searchParams;
  const f = peopleFilterSchema.parse(sp);
  const [{ total, rows, cutoff, pages }, { regions, owners }] = await Promise.all([listPeople(f), personFormOptions()]);
  const filtered = !!(f.q || f.region || f.owner || f.status || f.engagement || f.available);
  return (
    <>
      <PageHeader
        title="قاعدة بيانات الأشخاص"
        description="ابحث بالاسم أو الرقم التسلسلي أو رقم الهاتف، وصفِّ حسب المنطقة أو مسؤول المتابعة أو حالة البيانات."
        actions={
          <>
            {can(actor, "people.create") && (
              <LinkButton href="/people/new">
                <Plus className="h-4 w-4" aria-hidden /> إضافة شخص
              </LinkButton>
            )}
            {can(actor, "people.import") && (
              <LinkButton href="/people/import" variant="secondary">
                <Upload className="h-4 w-4" aria-hidden /> استيراد من Excel
              </LinkButton>
            )}
            {can(actor, "people.export") && (
              <a href={`/api/people/export${qs(f, { page: undefined })}`} className="inline-flex items-center justify-center gap-2 rounded-md border border-line bg-white px-4 py-2 text-sm font-medium text-ink transition hover:bg-band">
                <Download className="h-4 w-4" aria-hidden /> تصدير إلى Excel
              </a>
            )}
          </>
        }
      />
      {sp.deleted === "1" && (
        <div className="mb-4">
          <Alert tone="success">تم حذف السجل. يمكن استعادته من «السجلات المحذوفة».</Alert>
        </div>
      )}
      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <Link href="/people/duplicates" className="inline-flex items-center gap-1.5 text-brand hover:underline">
          <Users className="h-4 w-4" aria-hidden /> مراجعة الأسماء المتشابهة
        </Link>
        {can(actor, "people.delete") && (
          <Link href="/people/deleted" className="inline-flex items-center gap-1.5 text-brand hover:underline">
            <Trash2 className="h-4 w-4" aria-hidden /> السجلات المحذوفة
          </Link>
        )}
      </div>
      <Card>
        <form method="get" className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 xl:items-end">
          <div className="flex flex-col gap-1 xl:col-span-2">
            <label htmlFor="q" className="text-sm font-medium">
              بحث
            </label>
            <input id="q" name="q" defaultValue={f.q} placeholder="الاسم، الرقم التسلسلي، الهاتف" className="field-input" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="region" className="text-sm font-medium">
              المنطقة
            </label>
            <select id="region" name="region" defaultValue={f.region ?? ""} className="field-input">
              <option value="">الكل</option>
              <option value="none">غير محددة</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="owner" className="text-sm font-medium">
              مسؤول المتابعة
            </label>
            <select id="owner" name="owner" defaultValue={f.owner ?? ""} className="field-input">
              <option value="">الكل</option>
              <option value="none">غير محدد</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.fullName}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="status" className="text-sm font-medium">
              حالة البيانات
            </label>
            <select id="status" name="status" defaultValue={f.status ?? ""} className="field-input">
              <option value="">الكل</option>
              <option value="COMPLETE">مكتملة</option>
              <option value="INCOMPLETE">ناقصة</option>
              <option value="NEEDS_UPDATE">بانتظار التحديث</option>
              <option value="needs">تحتاج إلى تحديث (تشمل القديمة)</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="engagement" className="text-sm font-medium">
              التفاعل
            </label>
            <select id="engagement" name="engagement" defaultValue={f.engagement ?? ""} className="field-input">
              <option value="">الكل</option>
              {ENGAGEMENT_ORDER.map((e) => (
                <option key={e} value={e}>
                  {ENGAGEMENT[e].label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="available" className="text-sm font-medium">
              التعاون
            </label>
            <select id="available" name="available" defaultValue={f.available ?? ""} className="field-input">
              <option value="">الكل</option>
              <option value="1">متاح</option>
              <option value="0">غير متاح</option>
            </select>
          </div>
          <input type="hidden" name="sort" value={f.sort} />
          <input type="hidden" name="dir" value={f.dir} />
          <div className="flex gap-2 sm:col-span-2 lg:col-span-4 xl:col-span-7">
            <button type="submit" className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
              بحث
            </button>
            {filtered && (
              <Link href="/people" className="rounded-md px-4 py-2 text-sm text-brand hover:bg-brand-soft">
                مسح الفلاتر
              </Link>
            )}
            <span className="ltr-num ms-auto self-center text-sm text-muted">
              {total} سجل
            </span>
          </div>
        </form>
        <DataTable>
          <thead>
            <tr>
              <SortHeader f={f} col="serial">الرقم</SortHeader>
              <SortHeader f={f} col="fullName">الاسم الكامل</SortHeader>
              <th>الهاتف</th>
              <th>المنطقة</th>
              <th>مسؤول المتابعة</th>
              <th>حالة البيانات</th>
              <th>التفاعل</th>
              <SortHeader f={f} col="createdAt" className="hidden 2xl:table-cell">تاريخ الإضافة</SortHeader>
              <SortHeader f={f} col="updatedAt">آخر تحديث</SortHeader>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="ltr-num text-muted">{p.serial}</td>
                <td className="min-w-48">
                  <Link href={`/people/${p.id}`} className="font-medium text-brand hover:underline">
                    {p.fullName}
                  </Link>
                  {p.availableForWork && <span className="ms-2 text-xs text-tone-success">● متاح</span>}
                </td>
                <td className="ltr-num whitespace-nowrap">{p.phone ?? "—"}</td>
                <td className="whitespace-nowrap">{p.region?.name ?? "—"}</td>
                <td className="whitespace-nowrap">{p.followUpOwner?.fullName ?? "—"}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    <Badge tone={DATA_STATUS[p.dataStatus].tone}>{DATA_STATUS[p.dataStatus].label}</Badge>
                    {p.updatedAt < cutoff && <Badge tone="danger">قديم</Badge>}
                  </div>
                </td>
                <td>
                  <Badge tone={ENGAGEMENT[p.engagementLevel].tone}>{ENGAGEMENT[p.engagementLevel].label}</Badge>
                </td>
                <td className="ltr-num hidden whitespace-nowrap 2xl:table-cell">{fmtDate(p.createdAt)}</td>
                <td className="ltr-num whitespace-nowrap">{fmtDate(p.updatedAt)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-muted">
                  {filtered ? "لا توجد سجلات مطابقة للبحث." : "لا توجد سجلات بعد. ابدأ بإضافة شخص أو استيراد ملف Excel."}
                </td>
              </tr>
            )}
          </tbody>
        </DataTable>
        {pages > 1 && (
          <nav aria-label="الصفحات" className="mt-4 flex items-center justify-between gap-2 text-sm">
            {f.page > 1 ? (
              <Link href={`/people${qs(f, { page: f.page - 1 })}`} className="text-brand hover:underline">
                → السابق
              </Link>
            ) : (
              <span />
            )}
            <span className="ltr-num text-muted">
              {f.page} / {pages}
            </span>
            {f.page < pages ? (
              <Link href={`/people${qs(f, { page: f.page + 1 })}`} className="text-brand hover:underline">
                التالي ←
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </Card>
    </>
  );
}
