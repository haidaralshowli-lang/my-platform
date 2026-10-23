import { orNotFound } from "@/lib/page-helpers";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/server";
import { Card, PageHeader } from "@/components/ui";
import { localDateKey } from "@/lib/datetime";
import { EDITABLE_STAGES, getViolationForActor } from "@/lib/services/violations";
import { violationFormOptions } from "../../form-data";
import { ViolationForm, type ViolationFormValues } from "../../violation-form";

export const metadata = { title: "تعديل بيانات المخالفة" };

export default async function EditViolationPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePagePermission("violation.edit");
  const { id } = await params;
  const v = await orNotFound(getViolationForActor(actor, id));
  if (!EDITABLE_STAGES.includes(v.stage)) redirect(`/violations/${id}`);
  const options = await violationFormOptions(actor);
  const s = (x: unknown) => (x === null || x === undefined ? "" : String(x));
  const initial: ViolationFormValues = {
    paperReportNumber: s(v.paperReportNumber), officialLetterNumber: s(v.officialLetterNumber),
    discoveredAt: v.discoveredAt ? localDateKey(v.discoveredAt) : "", governorateId: v.governorateId, officeId: v.officeId,
    divisionId: s(v.divisionId), violationTypeId: s(v.violationTypeId), offenderName: v.offenderName, entityTypeId: s(v.entityTypeId),
    offenderLicenseNo: s(v.offenderLicenseNo), activityTypeId: s(v.activityTypeId), offenderAddress: s(v.offenderAddress),
    latitude: s(v.latitude), longitude: s(v.longitude), description: s(v.description), detectionSourceId: s(v.detectionSourceId),
    organizerName: s(v.organizerName), priority: v.priority, internalNotes: s(v.internalNotes),
  };
  return (
    <>
      <PageHeader title={`تعديل ${v.number ?? v.draftRef}`} />
      <Card><ViolationForm options={options} initial={initial} id={v.id} version={v.version} registered={v.stage !== "DRAFT"} /></Card>
    </>
  );
}
