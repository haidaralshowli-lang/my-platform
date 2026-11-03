import { requirePagePermission } from "@/lib/auth/server";
import { prisma } from "@/lib/db";
import { LIST_LABELS, listItems, type ListKind } from "@/lib/services/lists";
import { SETTING_LABELS, SETTING_LIMITS, getAllSettings, type SettingKey } from "@/lib/settings";
import { Alert, Card, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { AddItemForm, ItemRow, SettingForm } from "./forms";

export const metadata = { title: "القوائم والإعدادات" };

export default async function SettingsPage() {
  await requirePagePermission("lists.manage");
  const kinds: ListKind[] = ["region", "authority"];
  const [lists, settings, backupRow] = await Promise.all([Promise.all(kinds.map(listItems)), getAllSettings(prisma), prisma.setting.findUnique({ where: { key: "backup.lastSuccess" } })]);
  const backup = backupRow?.value as { at: string; manifest: string; sizeBytes: number } | undefined;
  const backupAgeDays = backup ? (Date.now() - Date.parse(backup.at)) / 86_400_000 : null;
  return (
    <>
      <PageHeader title="القوائم المرجعية والإعدادات" description="القوائم تُستخدم في نماذج الأشخاص والطلبات. التعطيل يخفي العنصر من النماذج الجديدة دون المساس بالسجلات القديمة." />
      <div className="grid gap-4 lg:grid-cols-2">
        {kinds.map((kind, i) => (
          <Card key={kind} title={`${LIST_LABELS[kind]} (${lists[i].length})`}>
            <AddItemForm kind={kind} />
            <ul className="mt-4 divide-y divide-line">
              {lists[i].map((item) => (
                <ItemRow key={item.id} kind={kind} item={item} />
              ))}
              {lists[i].length === 0 && <li className="py-3 text-sm text-muted">لا توجد عناصر بعد.</li>}
            </ul>
          </Card>
        ))}
        <Card title="النسخ الاحتياطي" className="lg:col-span-2">
          {backup ? (
            <div className="flex flex-col gap-2 text-sm">
              <p>
                آخر نسخة ناجحة: <span className="ltr-num font-medium">{fmtDateTime(new Date(backup.at))}</span> — الحجم <span className="ltr-num">{(backup.sizeBytes / 1024).toFixed(0)} KB</span> — الملف{" "}
                <span className="ltr-num text-xs text-muted">{backup.manifest}</span>
              </p>
              {backupAgeDays !== null && backupAgeDays > 2 && <Alert tone="danger">مضى أكثر من يومين على آخر نسخة احتياطية. تحقق من المهمة المجدولة للنسخ.</Alert>}
            </div>
          ) : (
            <Alert tone="warning">لم تُسجَّل أي نسخة احتياطية بعد. شغّل «npm run backup» وجدوله يومياً (راجع README).</Alert>
          )}
          <p className="mt-2 text-xs text-muted">النسخ مشفّرة بمفتاح لا يُخزَّن معها، والاستعادة تتحقق من البصمة وأعداد الصفوف وسلامة سجل التدقيق، وترفض الكتابة فوق قاعدة غير فارغة.</p>
        </Card>
        <Card title="إعدادات النظام" className="lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            {(Object.keys(SETTING_LABELS) as SettingKey[]).map((key) => (
              <SettingForm key={key} settingKey={key} label={SETTING_LABELS[key]} value={settings[key]} min={SETTING_LIMITS[key][0]} max={SETTING_LIMITS[key][1]} />
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
