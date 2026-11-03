import { requirePagePermission } from "@/lib/auth/server";
import { prisma } from "@/lib/db";
import { LIST_LABELS, listItems, type ListKind } from "@/lib/services/lists";
import { SETTING_LABELS, SETTING_LIMITS, getAllSettings, type SettingKey } from "@/lib/settings";
import { Card, PageHeader } from "@/components/ui";
import { AddItemForm, ItemRow, SettingForm } from "./forms";

export const metadata = { title: "القوائم والإعدادات" };

export default async function SettingsPage() {
  await requirePagePermission("lists.manage");
  const kinds: ListKind[] = ["region", "authority"];
  const [lists, settings] = await Promise.all([Promise.all(kinds.map(listItems)), getAllSettings(prisma)]);
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
