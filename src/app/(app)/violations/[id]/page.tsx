import { orNotFound } from "@/lib/page-helpers";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth/server";
import { can } from "@/lib/rbac/actor";
import { Alert, Badge, Card, LinkButton, PageHeader } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { OUTCOME_LABELS, PRIORITY_LABELS, STAGE_LABELS, STATUS_LABELS, stageTone } from "@/lib/workflow/labels";
import { availableTransitions, missingRegistrationFields } from "@/lib/workflow";
import { EDITABLE_STAGES, getViolationForActor } from "@/lib/services/violations";
import { listViolationAttachments } from "@/lib/services/attachments";
import { ATTACHMENT_STATUS_LABELS, CONFIDENTIALITY_LABELS, docTypeLabel, VIOLATION_DOC_TYPES } from "@/lib/documents";
import { ACCEPT_ATTR } from "@/lib/storage/file-check";
import { ViolationCommands } from "./commands";
import { AttachmentRowActions, UploadForm } from "./attachments-ui";

export const metadata = { title: "ملف المخالفة" };

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-line/60 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm">{children || "—"}</dd>
    </div>
  );
}

const DONE_MESSAGES: Record<string, string> = {
  register: "تم تسجيل المخالفة رسمياً وتوليد رقمها.",
  submit: "تمت إحالة المخالفة للمصادقة النهائية.",
};

const sizeLabel = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} م.ب` : `${Math.max(1, Math.round(n / 1024))} ك.ب`);

export default async function ViolationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; done?: string }> }) {
  const actor = await requirePagePermission("violation.view");
  const { id } = await params;
  const sp = await searchParams;
  const v = await orNotFound(getViolationForActor(actor, id));
  const [attachments, history] = await Promise.all([
    listViolationAttachments(actor, id),
    prisma.violationStatusHistory.findMany({ where: { violationId: id }, orderBy: { createdAt: "desc" } }),
  ]);
  const userIds = new Set<string>([...history.map((h) => h.actorId), ...attachments.flatMap((a) => a.versions.map((x) => x.uploadedById))]);
  const users = new Map((await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));

  const transitions = availableTransitions(actor, v).map((t) => ({ action: t.action, label: t.def.labelAr }));
  const missing = missingRegistrationFields(v);
  const canEdit = can(actor, "violation.edit") && EDITABLE_STAGES.includes(v.stage) && !v.archivedAt;
  const canUpload = can(actor, "attachment.upload") && v.generalStatus === "OPEN" && !v.archivedAt;
  const supplementary = !EDITABLE_STAGES.includes(v.stage);
  const hasReport = attachments.some((a) => a.documentType === "VIOLATION_REPORT" && !a.withdrawnAt);

  const timeline = [
    ...history.map((h) => ({
      at: h.createdAt,
      title: h.fromStage ? `${STAGE_LABELS[h.fromStage]} ← ${STAGE_LABELS[h.toStage]}` : `إنشاء: ${STAGE_LABELS[h.toStage]}`,
      by: users.get(h.actorId),
      note: h.reason,
    })),
    ...attachments.flatMap((a) =>
      a.versions.map((x) => ({
        at: x.uploadedAt,
        title: x.versionNo === 1 ? `رفع مستند: ${docTypeLabel(a.documentType)}` : `إصدار ${x.versionNo} من: ${docTypeLabel(a.documentType)}`,
        by: users.get(x.uploadedById),
        note: x.reason ?? (x.versionNo === 1 ? a.additionReason : null),
      })),
    ),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <>
      <PageHeader
        title={v.number ? `المخالفة ${v.number}` : `مسودة ${v.draftRef}`}
        description={v.offenderName}
        actions={canEdit ? <LinkButton variant="secondary" href={`/violations/${id}/edit`}>تعديل البيانات</LinkButton> : undefined}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={stageTone(v.stage)}>{STAGE_LABELS[v.stage]}</Badge>
        <Badge tone={v.generalStatus === "OPEN" ? "info" : "success"}>{STATUS_LABELS[v.generalStatus]}</Badge>
        {v.outcome && <Badge tone="legal">{OUTCOME_LABELS[v.outcome]}</Badge>}
        <Badge tone={v.priority === "URGENT" || v.priority === "HIGH" ? "warning" : "neutral"}>أولوية {PRIORITY_LABELS[v.priority]}</Badge>
        {v.isDemo && <Badge tone="danger">بيانات تجريبية</Badge>}
        {v.archivedAt && <Badge tone="danger">مسودة مؤرشفة</Badge>}
      </div>
      {sp.saved && <div className="mb-4"><Alert tone="success">تم حفظ البيانات.</Alert></div>}
      {sp.done && DONE_MESSAGES[sp.done] && <div className="mb-4"><Alert tone="success">{DONE_MESSAGES[sp.done]}</Alert></div>}
      {v.stage === "DRAFT" && missing.length > 0 && (
        <div className="mb-4"><Alert tone="warning">لاستكمال التسجيل الرسمي يلزم: {missing.join("، ")}.</Alert></div>
      )}
      {v.stage === "AWAITING_REPORT" && <div className="mb-4"><Alert tone="warning">المخالفة مسجلة وبانتظار رفع المحضر الأصلي (نوع المستند: «المحضر الأصلي»).</Alert></div>}

      {!v.archivedAt && (transitions.length > 0 || (v.stage === "DRAFT" && (v.createdById === actor.id || can(actor, "violation.edit")))) && (
        <Card title="الإجراءات المتاحة" className="mb-6">
          <ViolationCommands id={v.id} version={v.version} transitions={transitions} canArchive={v.stage === "DRAFT"} hasReport={hasReport} />
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card title="البيانات الأساسية">
            <dl className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
              <Item label="رقم المخالفة">{v.number ? <bdi className="font-semibold">{v.number}</bdi> : `غير مسجلة (${v.draftRef})`}</Item>
              <Item label="رقم المحضر الورقي">{v.paperReportNumber}</Item>
              <Item label="رقم الكتاب الرسمي">{v.officialLetterNumber}</Item>
              <Item label="تاريخ الاكتشاف">{formatDate(v.discoveredAt)}</Item>
              <Item label="تاريخ التسجيل">{formatDateTime(v.registeredAt)}</Item>
              <Item label="المحافظة">{v.governorate.nameAr}</Item>
              <Item label="الفرع أو المكتب">{v.office.nameAr}</Item>
              <Item label="الشعبة المختصة">{v.division?.nameAr}</Item>
              <Item label="نوع المخالفة">{v.violationType?.nameAr}</Item>
              <Item label="مصدر الاكتشاف">{v.detectionSource?.nameAr}</Item>
              <Item label="الموظف المنظم">{v.organizerName}</Item>
              <Item label="أنشأها">{v.createdBy.fullName}</Item>
            </dl>
          </Card>
          <Card title="الجهة المخالفة">
            <dl className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
              <Item label="الاسم">{v.offenderName}</Item>
              <Item label="نوع الجهة">{v.entityType?.nameAr}</Item>
              <Item label="رقم الإجازة">{v.offenderLicenseNo && <bdi>{v.offenderLicenseNo}</bdi>}</Item>
              <Item label="نوع النشاط">{v.activityType?.nameAr}</Item>
              <Item label="العنوان">{v.offenderAddress}</Item>
              <Item label="الموقع الجغرافي">{v.latitude && v.longitude ? <span className="ltr-num">{String(v.latitude)}, {String(v.longitude)}</span> : null}</Item>
            </dl>
          </Card>
          <Card title="وصف المخالفة">
            <p className="text-sm leading-7 whitespace-pre-wrap">{v.description || "—"}</p>
            {v.internalNotes && (
              <div className="mt-4 rounded-md bg-band p-3 text-sm">
                <div className="mb-1 text-xs text-muted">ملاحظات داخلية</div>
                <p className="whitespace-pre-wrap">{v.internalNotes}</p>
              </div>
            )}
          </Card>

          <Card title={`المحضر والمرفقات (${attachments.length})`}>
            {attachments.length === 0 ? (
              <p className="text-sm text-muted">لا توجد مرفقات بعد.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {attachments.map((a) => {
                  const cur = a.versions[0];
                  return (
                    <li key={a.id} className="flex flex-col gap-2 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{docTypeLabel(a.documentType)}</span>
                        <Badge tone={a.approvalStatus === "APPROVED" ? "success" : a.approvalStatus === "WITHDRAWN" ? "danger" : "neutral"}>{ATTACHMENT_STATUS_LABELS[a.approvalStatus]}</Badge>
                        {a.confidentiality !== "NORMAL" && <Badge tone="warning">{CONFIDENTIALITY_LABELS[a.confidentiality]}</Badge>}
                        {a.versions.length > 1 && <Badge tone="info">الإصدار {a.currentVersionNo}</Badge>}
                        {cur.scanStatus === "NOT_SCANNED" && <span className="text-xs text-muted">(لم يُفحص بمضاد الفيروسات)</span>}
                      </div>
                      {a.hidden ? (
                        <p className="text-xs text-muted">مستند مقيد؛ لا تملك صلاحية الاطلاع عليه.</p>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                            <span className="text-ink">{cur.originalName}</span>
                            <span>{sizeLabel(cur.sizeBytes)}</span>
                            <span>رفعه {users.get(cur.uploadedById)} في {formatDateTime(cur.uploadedAt)}</span>
                            <span dir="ltr" title={cur.sha256} className="font-mono">SHA-256: {cur.sha256.slice(0, 12)}…</span>
                          </div>
                          {a.description && <p className="text-sm">{a.description}</p>}
                          {a.withdrawnAt && <p className="text-xs text-tone-danger">سُحب في {formatDateTime(a.withdrawnAt)}: {a.withdrawnReason}</p>}
                          <div className="flex flex-wrap gap-3 text-sm">
                            {cur.mimeType.startsWith("image/") && cur.mimeType !== "image/tiff" && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <a href={`/api/files/${cur.id}`} target="_blank" rel="noopener"><img src={`/api/files/${cur.id}`} alt={cur.originalName} className="h-20 rounded border border-line object-cover" /></a>
                            )}
                            <a className="text-brand underline" href={`/api/files/${cur.id}`} target="_blank" rel="noopener">معاينة</a>
                            <a className="text-brand underline" href={`/api/files/${cur.id}?download=1`}>تنزيل</a>
                          </div>
                          {a.versions.length > 1 && (
                            <details className="text-xs">
                              <summary className="cursor-pointer text-muted">الإصدارات السابقة ({a.versions.length - 1})</summary>
                              <ul className="mt-2 flex flex-col gap-1">
                                {a.versions.slice(1).map((x) => (
                                  <li key={x.id}>
                                    الإصدار {x.versionNo}: {x.originalName}، {formatDateTime(x.uploadedAt)}{" "}
                                    <a className="text-brand underline" href={`/api/files/${x.id}?download=1`}>تنزيل</a>
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                          {canUpload && !a.withdrawnAt && (
                            <AttachmentRowActions violationId={id} attachmentId={a.id} approved={a.approvalStatus === "APPROVED"} accept={ACCEPT_ATTR}
                              canWithdraw={a.approvalStatus === "APPROVED" ? can(actor, "attachment.withdraw") : a.createdById === actor.id || can(actor, "attachment.withdraw")} />
                          )}
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {canUpload && (
              <div className="mt-4 border-t border-line pt-4">
                <UploadForm violationId={id} accept={ACCEPT_ATTR} docTypes={VIOLATION_DOC_TYPES} supplementary={supplementary}
                  canConfidential={can(actor, "attachment.view_confidential")} defaultType={hasReport ? "SUPPLEMENTARY" : "VIOLATION_REPORT"} />
              </div>
            )}
          </Card>
        </div>

        <Card title="التسلسل الزمني">
          <ol className="relative flex flex-col gap-4 border-s-2 border-line ps-4">
            {timeline.map((t, i) => (
              <li key={i} className="relative">
                <span className="absolute -start-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full bg-accent" aria-hidden />
                <div className="text-sm font-medium">{t.title}</div>
                <div className="text-xs text-muted">{formatDateTime(t.at)}{t.by ? `، ${t.by}` : ""}</div>
                {t.note && <div className="mt-1 text-xs">{t.note}</div>}
              </li>
            ))}
          </ol>
          <div className="mt-4 text-xs"><Link className="text-brand underline" href="/violations">العودة إلى قائمة المخالفات</Link></div>
        </Card>
      </div>
    </>
  );
}
