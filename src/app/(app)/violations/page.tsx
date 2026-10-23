import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth/server";
import { can } from "@/lib/rbac/actor";
import { Badge, Card, DataTable, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { formatDate, formatNumberLocale } from "@/lib/datetime";
import { STAGE_LABELS, STAGE_ORDER, STATUS_LABELS, stageTone } from "@/lib/workflow/labels";
import { officeScopeWhere, searchSchema, searchViolations } from "@/lib/services/violations";

export const metadata = { title: "جميع المخالفات" };

const TEXT_FILTERS: [string, string][] = [
  ["number", "رقم المخالفة"], ["warningNumber", "رقم الإنذار"], ["paperReportNumber", "رقم المحضر"], ["officialLetterNumber", "رقم الكتاب الرسمي"],
  ["offenderName", "اسم الجهة المخالفة"], ["offenderLicenseNo", "رقم إجازة الجهة"], ["caseNumber", "رقم ملف الدعوى"],
  ["courtCaseNumber", "رقم الدعوى القضائية"], ["judgmentNumber", "رقم الحكم"],
];
const DATE_FILTERS: [string, string][] = [
  ["registeredFrom", "التسجيل من"], ["registeredTo", "التسجيل إلى"], ["receivedFrom", "الاستلام من"], ["receivedTo", "الاستلام إلى"],
  ["dueFrom", "انتهاء المدة من"], ["dueTo", "انتهاء المدة إلى"],
];

export default async function ViolationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePagePermission("violation.view");
  const raw = await searchParams;
  const parsed = searchSchema.safeParse(Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== "" && v !== undefined)));
  const s = parsed.success ? parsed.data : searchSchema.parse({});
  const [{ total, rows, pages }, offices, types, staff] = await Promise.all([
    searchViolations(actor, s),
    prisma.office.findMany({ where: actor.scope === "CENTRAL" ? {} : officeScopeWhere(actor), include: { governorate: true }, orderBy: { nameAr: "asc" } }),
    prisma.violationType.findMany({ orderBy: { nameAr: "asc" } }),
    prisma.user.findMany({ where: { createdViolations: { some: {} } }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" }, take: 300 }),
  ]);
  const governorates = [...new Map(offices.map((o) => [o.governorateId, o.governorate])).values()].sort((a, b) => a.sortOrder - b.sortOrder);
  const current = Object.fromEntries(Object.entries(raw).filter(([k, v]) => v && k !== "page")) as Record<string, string>;
  const pageHref = (p: number) => `?${new URLSearchParams({ ...current, page: String(p) })}`;
  const advancedOpen = TEXT_FILTERS.some(([k]) => raw[k]) || DATE_FILTERS.some(([k]) => raw[k]) || !!raw.createdById;

  return (
    <>
      <PageHeader
        title="جميع المخالفات"
        description="تعرض النتائج المخالفات الواقعة ضمن نطاق صلاحياتك فقط."
        actions={
          <>
            <LinkButton variant="secondary" href="/violations?drafts=mine">مسوداتي</LinkButton>
            {can(actor, "violation.create") && <LinkButton href="/violations/new">تسجيل مخالفة جديدة</LinkButton>}
          </>
        }
      />
      <Card className="mb-6">
        <form className="flex flex-col gap-3" role="search">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input name="q" defaultValue={raw.q} placeholder="بحث سريع: رقم، جهة، محضر، كتاب، إجازة" aria-label="بحث سريع" className="field-input lg:col-span-2" />
            <select name="stage" defaultValue={raw.stage ?? ""} aria-label="المرحلة الإجرائية" className="field-input">
              <option value="">كل المراحل (عدا المسودات)</option>
              {STAGE_ORDER.map((st) => <option key={st} value={st}>{STAGE_LABELS[st]}</option>)}
            </select>
            <select name="status" defaultValue={raw.status ?? ""} aria-label="الحالة العامة" className="field-input">
              <option value="">كل الحالات</option><option value="OPEN">{STATUS_LABELS.OPEN}</option><option value="CLOSED">{STATUS_LABELS.CLOSED}</option>
            </select>
            <select name="governorateId" defaultValue={raw.governorateId ?? ""} aria-label="المحافظة" className="field-input">
              <option value="">كل المحافظات</option>
              {governorates.map((g) => <option key={g.id} value={g.id}>{g.nameAr}</option>)}
            </select>
            <select name="officeId" defaultValue={raw.officeId ?? ""} aria-label="الفرع" className="field-input">
              <option value="">كل الفروع</option>
              {offices.map((o) => <option key={o.id} value={o.id}>{o.governorate.nameAr} / {o.nameAr}</option>)}
            </select>
            <select name="violationTypeId" defaultValue={raw.violationTypeId ?? ""} aria-label="نوع المخالفة" className="field-input">
              <option value="">كل أنواع المخالفات</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.nameAr}</option>)}
            </select>
            <select name="sort" defaultValue={s.sort} aria-label="الفرز" className="field-input">
              <option value="updatedAt_desc">الأحدث تعديلاً</option><option value="registeredAt_desc">الأحدث تسجيلاً</option>
              <option value="registeredAt_asc">الأقدم تسجيلاً</option><option value="number_asc">حسب الرقم</option><option value="offenderName_asc">حسب اسم الجهة</option>
            </select>
          </div>
          <details open={advancedOpen}>
            <summary className="cursor-pointer text-sm text-brand">بحث متقدم</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {TEXT_FILTERS.map(([k, l]) => (
                <label key={k} className="flex flex-col gap-1 text-xs text-muted">{l}<input name={k} defaultValue={raw[k]} className="field-input" /></label>
              ))}
              <label className="flex flex-col gap-1 text-xs text-muted">الموظف المسؤول (المنشئ)
                <select name="createdById" defaultValue={raw.createdById ?? ""} className="field-input">
                  <option value="">الكل</option>
                  {staff.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
                </select>
              </label>
              {DATE_FILTERS.map(([k, l]) => (
                <label key={k} className="flex flex-col gap-1 text-xs text-muted">{l}<input type="date" name={k} defaultValue={raw[k]} className="field-input" /></label>
              ))}
            </div>
          </details>
          {raw.drafts && <input type="hidden" name="drafts" value={raw.drafts} />}
          <div className="flex gap-2">
            <button className="rounded-md bg-brand px-4 py-2 text-sm text-white hover:bg-brand-dark">بحث</button>
            <Link href="/violations" className="rounded-md border border-line px-4 py-2 text-sm hover:bg-band">مسح الفلاتر</Link>
          </div>
          {!parsed.success && <p className="text-xs text-tone-danger">بعض معايير البحث غير صالحة وتم تجاهلها.</p>}
        </form>
      </Card>

      <Card title={`النتائج: ${formatNumberLocale(total)}${raw.drafts === "mine" ? " (مسوداتي)" : ""}`}>
        {rows.length === 0 ? (
          <EmptyState>لا توجد مخالفات مطابقة لمعايير البحث ضمن نطاق صلاحياتك.</EmptyState>
        ) : (
          <DataTable>
            <thead>
              <tr><th>الرقم</th><th>الجهة المخالفة</th><th>النوع</th><th>المحافظة / الفرع</th><th>المرحلة</th><th>الحالة</th><th>تاريخ التسجيل</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">
                    <Link href={`/violations/${r.id}`} className="font-medium text-brand hover:underline"><bdi>{r.number ?? r.draftRef}</bdi></Link>
                    {r.isDemo && <span className="ms-1"><Badge tone="danger">تجريبية</Badge></span>}
                  </td>
                  <td>{r.offenderName}</td>
                  <td className="text-xs">{r.violationType?.nameAr ?? "—"}</td>
                  <td className="text-xs">{r.governorate.nameAr} / {r.office.nameAr}</td>
                  <td><Badge tone={stageTone(r.stage)}>{STAGE_LABELS[r.stage]}</Badge></td>
                  <td><Badge tone={r.generalStatus === "OPEN" ? "info" : "success"}>{STATUS_LABELS[r.generalStatus]}</Badge></td>
                  <td className="text-xs whitespace-nowrap">{formatDate(r.registeredAt)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="الصفحات">
          <span className="text-muted">صفحة {s.page} من {pages}</span>
          <span className="flex gap-2">
            {s.page > 1 && <Link className="rounded border border-line px-3 py-1 hover:bg-band" href={pageHref(s.page - 1)}>السابق</Link>}
            {s.page < pages && <Link className="rounded border border-line px-3 py-1 hover:bg-band" href={pageHref(s.page + 1)}>التالي</Link>}
          </span>
        </nav>
      </Card>
    </>
  );
}
