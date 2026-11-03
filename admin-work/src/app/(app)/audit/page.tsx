import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requirePagePermission } from "@/lib/auth/server";
import { prisma } from "@/lib/db";
import { verifyAuditChain } from "@/lib/audit";
import { fmtDateTime } from "@/lib/format";
import { Alert, Card, DataTable, LinkButton, PageHeader } from "@/components/ui";

export const metadata = { title: "سجل التدقيق" };

const PAGE = 50;

/// أسماء العمليات بالعربية؛ العمليات غير المدرجة تظهر برمزها
const ACTION_LABELS: Record<string, string> = {
  "auth.login": "تسجيل دخول",
  "auth.login_failed": "محاولة دخول فاشلة",
  "auth.logout": "تسجيل خروج",
  "auth.password_changed": "تغيير كلمة المرور",
  "user.bootstrap_admin": "إنشاء أول مدير",
  "user.create": "إنشاء حساب",
  "user.update": "تعديل حساب أو صلاحيات",
  "user.activate": "تفعيل حساب",
  "user.deactivate": "تعطيل حساب",
  "user.password_reset": "إعادة تعيين كلمة المرور",
  "user.sessions_revoked": "إنهاء الجلسات",
  "region.create": "إضافة محافظة/منطقة",
  "region.update": "تعديل محافظة/منطقة",
  "authority.create": "إضافة جهة مختصة",
  "authority.update": "تعديل جهة مختصة",
  "setting.update": "تعديل إعداد",
  "person.create": "إضافة شخص",
  "person.update": "تعديل بيانات شخص",
  "person.delete": "حذف سجل شخص",
  "person.restore": "استعادة سجل شخص",
  "person.merge": "دمج سجلين",
  "person.mark_distinct": "تأكيد عدم التكرار",
  "person.import": "استيراد من Excel",
  "person.export": "تصدير إلى Excel",
  "request.create": "تسجيل طلب",
  "request.update": "تعديل بيانات طلب",
  "request.status": "تغيير حالة طلب",
  "request.action": "إجراء متابعة على طلب",
  "request.closed": "اعتماد إغلاق طلب",
  "request.reopened": "إعادة فتح طلب",
  "request.delete": "حذف طلب",
  "request.export": "تصدير الطلبات",
  "task.create": "إنشاء مهمة",
  "task.updated": "تعديل مهمة",
  "task.accepted": "موافقة المكلف",
  "task.declined": "اعتذار المكلف",
  "task.change_requested": "طلب تعديل موعد",
  "task.change_approved": "اعتماد موعد جديد",
  "task.change_rejected": "رفض تعديل موعد",
  "task.reassigned": "إعادة إسناد مهمة",
  "task.progress": "تحديث إنجاز مهمة",
  "task.closed": "اعتماد إغلاق مهمة",
  "task.reopened": "إعادة فتح مهمة",
  "task.cancelled": "إلغاء مهمة",
  "task.deleted": "حذف مهمة",
  "task.export": "تصدير المهام",
};

const ENTITY_LABELS: Record<string, string> = {
  User: "مستخدم",
  Region: "محافظة/منطقة",
  Authority: "جهة مختصة",
  Setting: "إعداد",
  Person: "شخص",
  Request: "طلب",
  Task: "مهمة",
};

function JsonCell({ value }: { value: Prisma.JsonValue }) {
  if (value === null || value === undefined) return <span className="text-muted">—</span>;
  return (
    <details>
      <summary className="cursor-pointer text-xs text-brand">عرض</summary>
      <pre dir="ltr" className="mt-1 max-w-sm overflow-x-auto rounded bg-band p-2 text-start text-[11px] leading-snug">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePagePermission("audit.view");
  const sp = await searchParams;
  const q = sp.q?.trim().slice(0, 80) || undefined;
  const action = sp.action && sp.action in ACTION_LABELS ? sp.action : undefined;
  const before = sp.before && /^\d+$/.test(sp.before) ? BigInt(sp.before) : undefined;
  const where: Prisma.AuditLogWhereInput = {
    ...(action ? { action } : {}),
    ...(q ? { OR: [{ username: { contains: q, mode: "insensitive" } }, { entityId: q }, { ip: q }] } : {}),
    ...(before ? { id: { lt: before } } : {}),
  };
  const [rows, chain] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { id: "desc" }, take: PAGE + 1 }),
    sp.verify === "1" ? verifyAuditChain(prisma) : Promise.resolve(null),
  ]);
  const more = rows.length > PAGE;
  const shown = rows.slice(0, PAGE);
  const qs = (extra: Record<string, string>) => new URLSearchParams({ ...(q ? { q } : {}), ...(action ? { action } : {}), ...extra }).toString();
  return (
    <>
      <PageHeader
        title="سجل التدقيق"
        description="سجل إلحاقي لجميع عمليات الدخول والتعديل. لا يمكن تعديله أو حذفه من أي مستخدم، والقيود متسلسلة بالتجزئة لكشف أي عبث."
        actions={<LinkButton href={`/audit?${qs({ verify: "1" })}`} variant="secondary">التحقق من سلامة السجل</LinkButton>}
      />
      {chain && (
        <div className="mb-4">
          {chain.ok ? (
            <Alert tone="success">السجل سليم: تم التحقق من {chain.checked} قيداً دون أي انقطاع في سلسلة التجزئة.</Alert>
          ) : (
            <Alert tone="danger">تنبيه: انقطاع في سلسلة التجزئة عند القيد رقم {String(chain.brokenAt)} بعد {chain.checked} قيداً سليماً.</Alert>
          )}
        </div>
      )}
      <Card>
        <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
          <div className="flex flex-col gap-1">
            <label htmlFor="q" className="text-sm font-medium">
              بحث (اسم المستخدم، معرف السجل، IP)
            </label>
            <input id="q" name="q" defaultValue={q} className="field-input w-64" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="action" className="text-sm font-medium">
              نوع العملية
            </label>
            <select id="action" name="action" defaultValue={action ?? ""} className="field-input w-56">
              <option value="">الكل</option>
              {Object.entries(ACTION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
            تصفية
          </button>
        </form>
        <DataTable>
          <thead>
            <tr>
              <th>#</th>
              <th>الوقت</th>
              <th>المستخدم</th>
              <th>العملية</th>
              <th>السجل</th>
              <th>القيمة السابقة</th>
              <th>القيمة الجديدة</th>
              <th>السبب</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={String(r.id)} className="align-top">
                <td className="ltr-num text-muted">{String(r.id)}</td>
                <td className="ltr-num whitespace-nowrap">{fmtDateTime(r.at)}</td>
                <td className="ltr-num">{r.username ?? "—"}</td>
                <td className="whitespace-nowrap">{ACTION_LABELS[r.action] ?? r.action}</td>
                <td className="text-xs">
                  {ENTITY_LABELS[r.entityType] ?? r.entityType}
                  {r.entityId && <div className="ltr-num max-w-[10rem] truncate text-muted" title={r.entityId}>{r.entityId}</div>}
                </td>
                <td><JsonCell value={r.before} /></td>
                <td><JsonCell value={r.after} /></td>
                <td>{r.reason ?? "—"}</td>
                <td className="ltr-num text-xs">{r.ip ?? "—"}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center text-muted">
                  لا توجد قيود مطابقة.
                </td>
              </tr>
            )}
          </tbody>
        </DataTable>
        {more && (
          <div className="mt-4">
            <Link href={`/audit?${qs({ before: String(shown[shown.length - 1].id) })}`} className="text-sm text-brand hover:underline">
              القيود الأقدم ←
            </Link>
          </div>
        )}
      </Card>
    </>
  );
}
