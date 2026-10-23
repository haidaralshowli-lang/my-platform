import { requirePagePermission } from "@/lib/auth/server";
import { Card, LinkButton, PageHeader } from "@/components/ui";
import { can } from "@/lib/rbac/actor";
import { loadReferenceLists, REFERENCE_LISTS } from "@/lib/services/reference";
import { ReferenceListEditor } from "./reference-ui";

export const metadata = { title: "القوائم المرجعية" };

export default async function SettingsPage() {
  const actor = await requirePagePermission("reference.manage");
  const d = await loadReferenceLists();
  const simple = (k: "detectionSource" | "entityType" | "activityType" | "judgmentResultType") => d[k].map((i) => ({ id: i.id, nameAr: i.nameAr, isActive: i.isActive }));
  return (
    <>
      <PageHeader
        title="القوائم المرجعية"
        actions={can(actor, "deadline.rules_manage") ? <LinkButton variant="secondary" href="/deadlines/rules">قواعد المدد القانونية والعطل</LinkButton> : undefined}
        description="القوائم المرجعية المستخدمة في النماذج. لا تُحذف العناصر لارتباط المعاملات بها؛ تُعطَّل فتختفي من النماذج الجديدة وتبقى ظاهرة في المعاملات السابقة. جميع التعديلات مسجلة في سجل التدقيق."
      />
      <div className="flex flex-col gap-6">
        <Card title={REFERENCE_LISTS.violationType.labelAr}>
          <p className="mb-3 text-xs text-muted">تصنيف قانوني تحدده الهيئة؛ لا تُزرع أنواع افتراضية.</p>
          <ReferenceListEditor list="violationType" hasCode hasDescription items={d.violationType.map((i) => ({ id: i.id, nameAr: i.nameAr, code: i.code, description: i.description, isActive: i.isActive }))} />
        </Card>
        <Card title={REFERENCE_LISTS.office.labelAr}>
          <ReferenceListEditor list="office" hasCode hasDescription={false} parents={d.governorates} parentField="governorateId" parentLabel="المحافظة"
            items={d.office.map((i) => ({ id: i.id, nameAr: i.nameAr, code: i.code, isActive: i.isActive, extra: i.governorate.nameAr }))} />
        </Card>
        <Card title={REFERENCE_LISTS.division.labelAr}>
          <ReferenceListEditor list="division" hasCode={false} hasDescription={false} parents={d.office.map((o) => ({ id: o.id, nameAr: `${o.governorate.nameAr} / ${o.nameAr}` }))} parentField="officeId" parentLabel="المكتب"
            items={d.division.map((i) => ({ id: i.id, nameAr: i.nameAr, isActive: i.isActive, extra: i.office?.nameAr ?? "جميع المكاتب" }))} />
        </Card>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title={REFERENCE_LISTS.detectionSource.labelAr}><ReferenceListEditor list="detectionSource" hasCode={false} hasDescription={false} items={simple("detectionSource")} /></Card>
          <Card title={REFERENCE_LISTS.entityType.labelAr}><ReferenceListEditor list="entityType" hasCode={false} hasDescription={false} items={simple("entityType")} /></Card>
          <Card title={REFERENCE_LISTS.activityType.labelAr}><ReferenceListEditor list="activityType" hasCode={false} hasDescription={false} items={simple("activityType")} /></Card>
          <Card title={REFERENCE_LISTS.judgmentResultType.labelAr}><ReferenceListEditor list="judgmentResultType" hasCode={false} hasDescription={false} items={simple("judgmentResultType")} /></Card>
        </div>
      </div>
    </>
  );
}
