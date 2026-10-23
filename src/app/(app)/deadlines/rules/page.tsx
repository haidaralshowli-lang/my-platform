import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth/server";
import { Badge, Card, DataTable, EmptyState, Field, PageHeader } from "@/components/ui";
import { ActForm } from "@/components/act-form";
import { formatDate } from "@/lib/datetime";
import { getSetting } from "@/lib/settings";
import { deadlineAdminAction } from "../../workflow-actions";

export const metadata = { title: "قواعد المدد القانونية" };

const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const OBJ = { NONE: "لا أثر", SUSPEND: "يعلّق المدة", MANUAL_DECISION: "يُقرر الأثر بقرار موثق" } as const;

export default async function RulesPage() {
  await requirePagePermission("deadline.rules_manage");
  const [rules, types, holidays, weekend] = await Promise.all([
    prisma.legalDeadlineRule.findMany({ orderBy: [{ isActive: "desc" }, { effectiveFrom: "desc" }], include: { violationType: true, _count: { select: { calculations: true } } } }),
    prisma.violationType.findMany({ where: { isActive: true }, orderBy: { nameAr: "asc" } }),
    prisma.holiday.findMany({ orderBy: { date: "desc" }, take: 100 }),
    getSetting(prisma, "deadline.weekendDays"),
  ]);
  return (
    <>
      <PageHeader title="قواعد المدد القانونية" description="لا يفترض النظام مدة موحدة. كل قاعدة تُنشأ بسندها القانوني وتاريخ سريانها، ولا تُعدَّل بعد إنشائها؛ لتغييرها تُنهى القديمة وتُنشأ بديلة. المدد المحتسبة سابقاً تحتفظ بنسخة قاعدتها وتقويمها." />
      <Card title="القواعد" className="mb-6">
        {rules.length === 0 ? <EmptyState>لا توجد قواعد. لن تُحتسب أي مدة حتى تُضاف قاعدة معتمدة.</EmptyState> : (
          <DataTable>
            <thead><tr><th>القاعدة</th><th>نوع المخالفة</th><th>المدة</th><th>السريان</th><th>التمديد</th><th>أثر الاعتراض</th><th>استُخدمت</th><th>إنهاء السريان</th></tr></thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td><div className="font-medium">{r.nameAr}</div><div className="text-xs text-muted">{r.legalBasis}</div></td>
                  <td className="text-xs">{r.violationType?.nameAr ?? "عامة (لكل الأنواع)"}</td>
                  <td className="text-xs">{r.duration} {r.unit === "WORKING_DAYS" ? "يوم عمل" : "يوماً تقويمياً"}، {r.startEvent === "RECEIPT_DATE" ? "من يوم الاستلام" : "من اليوم التالي"}{r.excludeHolidays && r.unit === "CALENDAR_DAYS" ? "، تمتد إذا صادف آخرها عطلة" : ""}، تنبيه قبل {r.warnBeforeDays} أيام</td>
                  <td className="text-xs whitespace-nowrap">{formatDate(r.effectiveFrom, "latn", "UTC")} — {r.effectiveTo ? formatDate(r.effectiveTo, "latn", "UTC") : "مستمرة"}{!r.isActive && <Badge tone="danger">معطلة</Badge>}</td>
                  <td className="text-xs">{r.extensionAllowed ? `مسموح${r.maxExtensionDays ? ` حتى ${r.maxExtensionDays} يوماً` : ""}` : "غير مسموح"}</td>
                  <td className="text-xs">{OBJ[r.objectionEffect]}</td>
                  <td className="text-xs">{r._count.calculations}</td>
                  <td>
                    {!r.effectiveTo && (
                      <ActForm action={deadlineAdminAction} hidden={{ op: "end_rule", ruleId: r.id }} submit="إنهاء" variant="secondary" className="min-w-48">
                        <input name="effectiveTo" type="date" required aria-label="تاريخ نهاية السريان" className="field-input" />
                        <input name="reason" required placeholder="السبب" aria-label="سبب الإنهاء" className="field-input" />
                      </ActForm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>
      <Card title="قاعدة جديدة" className="mb-6">
        <ActForm action={deadlineAdminAction} hidden={{ op: "rule" }} submit="إنشاء القاعدة" confirm={{ title: "إنشاء قاعدة مدة", message: "لا يمكن تعديل القاعدة بعد إنشائها. تأكد من مطابقتها للسند المعتمد." }} className="grid sm:grid-cols-2 lg:grid-cols-4">
          <Field label="الرمز" htmlFor="code" required><input id="code" name="code" dir="ltr" className="field-input" /></Field>
          <Field label="اسم القاعدة" htmlFor="nameAr" required className="lg:col-span-2"><input id="nameAr" name="nameAr" className="field-input" /></Field>
          <Field label="نوع المخالفة" htmlFor="violationTypeId" hint="فارغ = قاعدة عامة">
            <select id="violationTypeId" name="violationTypeId" className="field-input"><option value="">عامة لكل الأنواع</option>{types.map((t) => <option key={t.id} value={t.id}>{t.nameAr}</option>)}</select>
          </Field>
          <Field label="المدة" htmlFor="duration" required><input id="duration" name="duration" type="number" min={1} className="field-input" /></Field>
          <Field label="وحدة المدة" htmlFor="unit" required>
            <select id="unit" name="unit" className="field-input"><option value="CALENDAR_DAYS">أيام تقويمية</option><option value="WORKING_DAYS">أيام عمل</option></select>
          </Field>
          <Field label="بدء الاحتساب" htmlFor="startEvent" required>
            <select id="startEvent" name="startEvent" className="field-input"><option value="RECEIPT_DATE">من يوم الاستلام (يُحتسب)</option><option value="DAY_AFTER_RECEIPT">من اليوم التالي للاستلام</option></select>
          </Field>
          <Field label="تاريخ سريان القاعدة" htmlFor="effectiveFrom" required><input id="effectiveFrom" name="effectiveFrom" type="date" className="field-input" /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="excludeHolidays" /> للأيام التقويمية: تمتد المدة إلى أول يوم عمل إذا صادف آخرها عطلة (أيام العمل تستبعد العطل دائماً)</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="extensionAllowed" /> تجيز التمديد</label>
          <Field label="الحد الأقصى للتمديد (يوم)" htmlFor="maxExtensionDays"><input id="maxExtensionDays" name="maxExtensionDays" type="number" min={1} className="field-input" /></Field>
          <Field label="أثر الاعتراض أو الطعن" htmlFor="objectionEffect" required>
            <select id="objectionEffect" name="objectionEffect" defaultValue="MANUAL_DECISION" className="field-input">{Object.entries(OBJ).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Field>
          <Field label="التنبيه قبل الانتهاء (أيام)" htmlFor="warnBeforeDays" required><input id="warnBeforeDays" name="warnBeforeDays" type="number" min={0} defaultValue={3} className="field-input" /></Field>
          <Field label="السند القانوني أو القرار المعتمد" htmlFor="legalBasis" required className="sm:col-span-2 lg:col-span-4"><input id="legalBasis" name="legalBasis" className="field-input" /></Field>
        </ActForm>
      </Card>
      <Card title="العطل الرسمية">
        <p className="mb-3 text-xs text-muted">أيام نهاية الأسبوع المعتمدة حالياً: {(weekend as number[]).map((d) => DAYS[d]).join(" و")}. تُحفظ العطل ضمن نسخة كل مدة محتسبة، فلا يغيّر تعديلها لاحقاً المدد السارية.</p>
        <ActForm action={deadlineAdminAction} hidden={{ op: "holiday" }} submit="إضافة عطلة" className="mb-4 flex-row flex-wrap items-end">
          <input name="date" type="date" required aria-label="التاريخ" className="field-input w-44" />
          <input name="nameAr" required placeholder="اسم العطلة" aria-label="اسم العطلة" className="field-input w-64" />
        </ActForm>
        <ul className="flex flex-col divide-y divide-line text-sm">
          {holidays.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-2 py-2">
              <span>{formatDate(h.date, "latn", "UTC")} — {h.nameAr}</span>
              <ActForm action={deadlineAdminAction} hidden={{ op: "remove_holiday", holidayId: h.id }} submit="حذف" variant="ghost" />
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
