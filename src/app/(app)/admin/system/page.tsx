import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth/server";
import { Card, PageHeader } from "@/components/ui";
import { ActForm } from "@/components/act-form";
import { currentSettings } from "@/lib/services/system-settings";
import { formatDateTime } from "@/lib/datetime";
import { systemSettingAction } from "../settings/actions";

export const metadata = { title: "إعدادات النظام" };

const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const TEXT: [string, string, string][] = [
  ["numbering.violation", "صيغة رقم المخالفة", "الرموز: {YYYY} {GOV} {OFFICE} {SEQ:n}. يبدأ تسلسل مستقل لكل قيمة من الرموز المقسِّمة الموجودة"],
  ["numbering.warning", "صيغة رقم الإنذار", ""],
  ["numbering.criminalCase", "صيغة رقم ملف الدعوى", ""],
  ["attachments.maxSizeMb", "الحد الأقصى لحجم الملف (ميغابايت)", "حتى 28"],
  ["attachments.maxFilesPerViolation", "الحد الأقصى لعدد مرفقات المخالفة", ""],
  ["auth.maxFailedLogins", "عدد محاولات الدخول الفاشلة قبل القفل", ""],
  ["auth.lockMinutes", "مدة قفل الحساب (دقيقة)", ""],
];
const BOOL: [string, string][] = [
  ["workflow.requireTechnicalReview", "اشتراط مراجعة الموقف الفني من موظف غير معده"],
  ["workflow.requireLegalSecondApproval", "اشتراط مصادقة الرأي القانوني من غير معده"],
  ["workflow.requireJudgmentApproval", "اشتراط اعتماد بيانات الحكم القضائي من غير مدخلها"],
];

export default async function SystemSettingsPage() {
  await requirePagePermission("settings.manage");
  const [s, stages, jobs] = await Promise.all([
    currentSettings(),
    prisma.workflowStageConfig.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.systemSetting.findMany({ where: { key: { in: ["job.deadlines.lastRunAt", "job.backup.lastSuccess"] } } }),
  ]);
  const deadlinesRun = jobs.find((j) => j.key === "job.deadlines.lastRunAt")?.updatedAt;
  const backup = jobs.find((j) => j.key === "job.backup.lastSuccess")?.value as { at?: string; manifest?: string } | undefined;
  const val = (k: string) => {
    const v = s[k];
    return typeof v === "object" && v && "pattern" in v ? String((v as { pattern: string }).pattern) : String(v ?? "");
  };
  return (
    <>
      <PageHeader title="إعدادات النظام" description="كل إعداد هنا مستخدم فعلياً في منطق المنصة، وكل تعديل يتطلب سبباً ويُسجَّل بالقيمة السابقة والجديدة. تعديل صيغ الترقيم لا يغير الأرقام الصادرة. المنطقة الزمنية ونمط الأرقام يُضبطان من متغيرات البيئة (APP_TIMEZONE وAPP_DIGITS)." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="الترقيم والمرفقات والدخول">
          <div className="flex flex-col gap-4">
            {TEXT.map(([k, l, h]) => (
              <ActForm key={k} action={systemSettingAction} hidden={{ key: k }} submit="حفظ" variant="secondary" className="grid grid-cols-[1fr_1fr] items-end">
                <label className="flex flex-col gap-1 text-xs">{l}{h && <span className="text-muted">{h}</span>}<input name="value" defaultValue={val(k)} dir="ltr" className="field-input" /></label>
                <label className="flex flex-col gap-1 text-xs">سبب التعديل<input name="reason" required className="field-input" /></label>
              </ActForm>
            ))}
          </div>
        </Card>
        <div className="flex flex-col gap-6">
          <Card title="فصل المهام في سير العمل">
            <div className="flex flex-col gap-4">
              {BOOL.map(([k, l]) => (
                <ActForm key={k} action={systemSettingAction} hidden={{ key: k, bool: "1" }} submit="حفظ" variant="secondary">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="value" defaultChecked={s[k] === true} />{l}</label>
                  <input name="reason" required placeholder="سبب التعديل" aria-label="سبب التعديل" className="field-input" />
                </ActForm>
              ))}
            </div>
          </Card>
          <Card title="أيام نهاية الأسبوع (لاحتساب أيام العمل)">
            <ActForm action={systemSettingAction} hidden={{ key: "deadline.weekendDays" }} submit="حفظ" variant="secondary">
              <div className="flex flex-wrap gap-3 text-sm">
                {DAYS.map((d, i) => <label key={i} className="flex items-center gap-1"><input type="checkbox" name="value" value={i} defaultChecked={(s["deadline.weekendDays"] as number[]).includes(i)} />{d}</label>)}
              </div>
              <p className="text-xs text-muted">يؤثر على المدد التي تُحتسب بعد التعديل فقط؛ المدد السابقة تحتفظ بتقويمها.</p>
              <input name="reason" required placeholder="سبب التعديل" aria-label="سبب التعديل" className="field-input" />
            </ActForm>
          </Card>
        </div>
        <Card title="حالة المهام التشغيلية" className="lg:col-span-2">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-muted">آخر تشغيل لمهمة المدد والتنبيهات</dt><dd>{deadlinesRun ? formatDateTime(deadlinesRun) : "لم تُشغَّل بعد"}</dd></div>
            <div><dt className="text-xs text-muted">آخر نسخة احتياطية ناجحة</dt><dd>{backup?.at ? <>{formatDateTime(backup.at)} — <bdi dir="ltr" className="text-xs">{backup.manifest}</bdi></> : "لا توجد نسخة مسجّلة — راجع DEPLOYMENT.md (npm run backup)"}</dd></div>
          </dl>
        </Card>
        <Card title="المدد الإدارية للمراحل (تنبيهات التأخر)" className="lg:col-span-2">
          <p className="mb-3 text-xs text-muted">عند تجاوز المعاملة هذه المدة في المرحلة تُرسل المهمة المجدولة تنبيهاً لأصحاب الإجراء التالي (مرة واحدة لكل دخول للمرحلة). فارغ = بلا تنبيه.</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {stages.filter((x) => x.stage !== "DRAFT" && x.stage !== "CLOSED").map((x) => (
              <ActForm key={x.stage} action={systemSettingAction} hidden={{ op: "sla", stage: x.stage }} submit="حفظ" variant="ghost" className="flex-row items-end">
                <label className="flex flex-1 flex-col gap-1 text-xs">{x.labelAr}<input name="slaDays" type="number" min={1} max={365} defaultValue={x.slaDays ?? ""} className="field-input" /></label>
              </ActForm>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
