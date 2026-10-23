import Link from "next/link";
import type { Violation } from "@prisma/client";
import { prisma } from "@/lib/db";
import { can, type Actor } from "@/lib/rbac/actor";
import { getSetting } from "@/lib/settings";
import { Badge, Card, DataTable } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { LEGAL_DOC_STATUS_LABELS, LEGAL_REF_PURPOSE_LABELS } from "@/lib/documents";
import { violationLegalRefs, PURPOSE_PERMISSION } from "@/lib/services/legal-library";
import { SYSTEM_ROLES } from "@/lib/rbac/catalog";
import { AssessmentForm, DecisionForm, LinkArticleForm, PrepareWarningForm, SignedWarningForm, UnlinkRefForm } from "./workflow-forms";

const APPROVAL_KIND_LABELS: Record<string, string> = {
  FINAL_REGISTRATION: "المصادقة النهائية", TECHNICAL_REVIEW: "مراجعة الموقف الفني", LEGAL_APPROVAL: "المصادقة القانونية", WARNING_ISSUE: "الموافقة على إصدار الإنذار",
  RESPONSE_VERIFICATION: "التحقق من الاستجابة", REMOVAL_ACCEPTANCE: "قبول إزالة المخالفة", NON_RESPONSE: "اعتماد عدم الاستجابة", JUDGMENT_APPROVAL: "اعتماد الحكم",
  CLOSURE: "اعتماد الإغلاق", REOPEN: "إعادة الفتح",
};
const DECISION_LABELS: Record<string, string> = { APPROVED: "موافقة", RETURNED: "إعادة", REJECTED: "عدم موافقة", CLARIFICATION_REQUESTED: "طلب إيضاح" };
const DECISION_TONE = { APPROVED: "success", RETURNED: "warning", REJECTED: "danger", CLARIFICATION_REQUESTED: "info" } as const;
const ASSESS_LABELS = { DRAFT: "مسودة", SUBMITTED: "مقدم بانتظار القرار", APPROVED: "معتمد", RETURNED: "معاد" } as const;
const WARNING_LABELS = { DRAFT: "مسودة", AWAITING_SIGNATURE: "بانتظار التوقيع", SIGNED: "موقع", SENT: "مرسل", DELIVERED: "مبلَّغ", CANCELLED: "ملغى" } as const;

function Text({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="mb-2">
      <div className="text-xs text-muted">{label}</div>
      <p className="text-sm leading-7 whitespace-pre-wrap">{value}</p>
    </div>
  );
}

export async function WorkflowSections({ actor, v }: { actor: Actor; v: Violation }) {
  const [refs, techs, legals, approvals, warnings, templates, requireTechReview] = await Promise.all([
    violationLegalRefs(v.id),
    prisma.technicalAssessment.findMany({ where: { violationId: v.id }, orderBy: { createdAt: "desc" } }),
    prisma.legalAssessment.findMany({ where: { violationId: v.id }, orderBy: { createdAt: "desc" } }),
    prisma.approval.findMany({ where: { violationId: v.id }, orderBy: { decidedAt: "desc" }, include: { decidedBy: { select: { fullName: true } } } }),
    prisma.warning.findMany({ where: { violationId: v.id }, orderBy: { createdAt: "desc" }, include: { templateVersion: { include: { template: true } } } }),
    prisma.warningTemplate.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getSetting(prisma, "workflow.requireTechnicalReview"),
  ]);
  const ids = new Set([...techs.flatMap((t) => [t.preparedById, t.reviewedById]), ...legals.flatMap((l) => [l.preparedById, l.approvedById]), ...warnings.map((w) => w.preparedById)].filter(Boolean) as string[]);
  const names = new Map((await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));

  const linkPurposes = (Object.keys(PURPOSE_PERMISSION) as (keyof typeof PURPOSE_PERMISSION)[])
    .filter((p) => can(actor, PURPOSE_PERMISSION[p].perm) && PURPOSE_PERMISSION[p].stages.includes(v.stage) && can(actor, "legal_library.view"))
    .map((p) => ({ value: p, label: LEGAL_REF_PURPOSE_LABELS[p] }));
  const canUnlink = (p: keyof typeof PURPOSE_PERMISSION) => can(actor, PURPOSE_PERMISSION[p].perm) && PURPOSE_PERMISSION[p].stages.includes(v.stage);

  const tech = techs[0];
  const legal = legals[0];
  const techEditable = v.stage === "AWAITING_TECHNICAL" && can(actor, "technical.prepare") && tech?.status !== "SUBMITTED";
  const techReviewable = v.stage === "AWAITING_TECHNICAL" && can(actor, "technical.review") && tech?.status === "SUBMITTED" && tech.preparedById !== actor.id;
  const legalEditable = v.stage === "AWAITING_LEGAL" && can(actor, "legal.prepare") && legal?.status !== "SUBMITTED";
  const legalDecidable = v.stage === "AWAITING_LEGAL" && can(actor, "legal.approve") && legal?.status === "SUBMITTED";
  const activeWarning = warnings.find((w) => w.status === "AWAITING_SIGNATURE");
  const showTech = techs.length > 0 || v.stage === "AWAITING_TECHNICAL";
  const showLegal = legals.length > 0 || v.stage === "AWAITING_LEGAL";

  return (
    <>
      {v.stage === "AWAITING_FINAL_APPROVAL" && can(actor, "approval.final_registration") && (
        <Card title="قرار المصادقة النهائية (رئيس الهيئة)">
          <DecisionForm violationId={v.id} version={v.version} gate="final" title="القرار" decisions={[
            { value: "APPROVED", label: "المصادقة النهائية", variant: "primary", confirm: "تُصادق المخالفة وتنتقل إلى القسم الفني لبيان الموقف الفني." },
            { value: "RETURNED", label: "إعادة لاستكمال النواقص", confirm: "تعود المعاملة إلى موظف التسجيل لاستكمال النواقص المذكورة في الملاحظات." },
            { value: "REJECTED", label: "عدم الموافقة", variant: "danger", confirm: "تُسجَّل عدم الموافقة بأسبابها. تبقى المخالفة مفتوحة حتى يُعتمد إغلاقها وفق الإجراء." },
          ]} />
        </Card>
      )}

      {v.stage === "AWAITING_WARNING_APPROVAL" && can(actor, "warning.approve_issue") && (
        <Card title="قرار إصدار الإنذار (رئيس الهيئة)">
          <DecisionForm violationId={v.id} version={v.version} gate="warning_issue" title="القرار" decisions={[
            { value: "APPROVED", label: "الموافقة على إصدار الإنذار", variant: "primary", confirm: "تنتقل المعاملة لإعداد الإنذار من القالب المعتمد." },
            { value: "RETURNED", label: "إعادة للاستكمال", confirm: "تعود المعاملة للدائرة القانونية." },
            { value: "REJECTED", label: "رفض إصدار الإنذار", variant: "danger", confirm: "يُسجَّل رفض إصدار الإنذار بأسبابه." },
          ]} />
        </Card>
      )}

      <Card title={`السند القانوني والفني (${refs.length})`}>
        {refs.length === 0 ? (
          <p className="text-sm text-muted">لم تُربط أي مادة من المكتبة القانونية بعد.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {refs.map((r) => {
              const d = r.article.documentVersion.document;
              return (
                <li key={r.id} className="flex flex-col gap-1 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge tone="legal">{LEGAL_REF_PURPOSE_LABELS[r.purpose]}</Badge>
                    <Link href={`/legal-library/${d.id}`} className="font-medium text-brand hover:underline">{d.title}{d.number && ` (${d.number})`}</Link>
                    <span>— المادة {r.article.articleNumber}{r.article.paragraph && ` / ${r.article.paragraph}`}</span>
                    <Badge tone="info">الإصدار {r.article.documentVersion.versionNo}</Badge>
                    {d.status !== "IN_FORCE" && <Badge tone="warning">{LEGAL_DOC_STATUS_LABELS[d.status]}</Badge>}
                  </div>
                  <p className="text-xs leading-6 text-muted">{r.article.text}</p>
                  {r.note && <p className="text-xs">ملاحظة: {r.note}</p>}
                  {canUnlink(r.purpose) && <UnlinkRefForm violationId={v.id} refId={r.id} />}
                </li>
              );
            })}
          </ul>
        )}
        {linkPurposes.length > 0 && <div className="mt-4"><LinkArticleForm violationId={v.id} purposes={linkPurposes} /></div>}
      </Card>

      {showTech && (
        <Card title="الموقف الفني">
          {tech && (
            <div className="mb-4">
              <div className="mb-2 flex flex-wrap gap-2 text-xs text-muted">
                <Badge tone={tech.status === "APPROVED" ? "success" : tech.status === "RETURNED" ? "warning" : "neutral"}>{ASSESS_LABELS[tech.status]}</Badge>
                <span>أعده: {names.get(tech.preparedById)}</span>
                {tech.reviewedById && <span>راجعه: {names.get(tech.reviewedById)} في {formatDateTime(tech.reviewedAt)}</span>}
                {tech.completedAt && <span>تاريخ الإنجاز: {formatDate(tech.completedAt)}</span>}
              </div>
              {!techEditable && <>
                <Text label="الموقف الفني" value={tech.position} />
                <Text label="أسباب الموقف" value={tech.reasons} />
                <Text label="الأدلة الفنية" value={tech.evidence} />
                <Text label="التوصية الفنية" value={tech.recommendation} />
              </>}
            </div>
          )}
          {techEditable && (
            <AssessmentForm violationId={v.id} kind="technical"
              initial={tech && tech.status === "DRAFT" ? { position: tech.position, reasons: tech.reasons, evidence: tech.evidence ?? "", recommendation: tech.recommendation ?? "" } : {}}
              fields={[
                { name: "position", label: "الموقف الفني", required: true, rows: 4 },
                { name: "reasons", label: "أسباب الموقف الفني", required: true, rows: 4 },
                { name: "evidence", label: "الأدلة الفنية" },
                { name: "recommendation", label: "التوصية الفنية" },
              ]} />
          )}
          {techEditable && <p className="mt-2 text-xs text-muted">{requireTechReview ? "تشترط الإعدادات مراجعة فنية من موظف آخر بعد التقديم." : "يُعتمد الموقف عند تقديمه وتنتقل المعاملة إلى الدائرة القانونية."} يشترط ربط مادة سنداً للموقف الفني.</p>}
          {techReviewable && (
            <div className="mt-4 border-t border-line pt-4">
              <DecisionForm violationId={v.id} version={v.version} gate="technical_review" title="المراجعة الفنية" decisions={[
                { value: "APPROVED", label: "المصادقة الفنية", variant: "primary", confirm: "يُعتمد الموقف الفني وتنتقل المعاملة إلى الدائرة القانونية." },
                { value: "RETURNED", label: "إعادة للمعد", confirm: "يُعاد الموقف الفني لمعده لاستكماله." },
              ]} />
            </div>
          )}
          {techs.length > 1 && <p className="mt-2 text-xs text-muted">توجد {techs.length - 1} نسخة سابقة من الموقف الفني محفوظة في السجل.</p>}
        </Card>
      )}

      {showLegal && (
        <Card title="الرأي القانوني">
          {legal && (
            <div className="mb-4">
              <div className="mb-2 flex flex-wrap gap-2 text-xs text-muted">
                <Badge tone={legal.status === "APPROVED" ? "success" : legal.status === "RETURNED" ? "warning" : "neutral"}>{ASSESS_LABELS[legal.status]}</Badge>
                <span>أعده: {names.get(legal.preparedById)}</span>
                {legal.approvedById && <span>صادق عليه: {names.get(legal.approvedById)} في {formatDateTime(legal.approvedAt)}</span>}
              </div>
              {!legalEditable && <>
                <Text label="الرأي القانوني" value={legal.opinion} />
                <Text label="أسباب الرأي" value={legal.reasons} />
                <Text label="الإجراء المقترح" value={legal.proposedAction} />
                <Text label="ملاحظات" value={legal.notes} />
              </>}
            </div>
          )}
          {legalEditable && (
            <AssessmentForm violationId={v.id} kind="legal"
              initial={legal && legal.status === "DRAFT" ? { opinion: legal.opinion, reasons: legal.reasons, proposedAction: legal.proposedAction ?? "", notes: legal.notes ?? "" } : {}}
              fields={[
                { name: "opinion", label: "الرأي القانوني", required: true, rows: 4 },
                { name: "reasons", label: "أسباب الرأي", required: true, rows: 4 },
                { name: "proposedAction", label: "الإجراء المقترح" },
                { name: "notes", label: "ملاحظات" },
              ]} />
          )}
          {legalDecidable && (
            <div className="mt-4 border-t border-line pt-4">
              <DecisionForm violationId={v.id} version={v.version} gate="legal" title="القرار القانوني" decisions={[
                { value: "APPROVED", label: "المصادقة القانونية", variant: "primary", confirm: "تُرفع المعاملة إلى رئيس الهيئة للموافقة على إصدار الإنذار." },
                { value: "CLARIFICATION_REQUESTED", label: "طلب إيضاح من القسم الفني", confirm: "تعود المعاملة للقسم الفني لاستكمال الموقف الفني." },
                { value: "RETURNED", label: "إعادة للاستكمال", confirm: "تعود المعاملة لموظف التسجيل، وتمر بالمصادقة النهائية مجدداً." },
                { value: "REJECTED", label: "عدم الموافقة", variant: "danger", confirm: "تُسجَّل عدم الموافقة القانونية بأسبابها." },
              ]} />
            </div>
          )}
        </Card>
      )}

      {(warnings.length > 0 || v.stage === "WARNING_PREPARATION") && (
        <Card title="الإنذار">
          {warnings.length > 0 && (
            <ul className="mb-4 flex flex-col divide-y divide-line">
              {warnings.map((w) => (
                <li key={w.id} className="flex flex-col gap-1 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">الإنذار <bdi>{w.number}</bdi></span>
                    <Badge tone={w.status === "SIGNED" || w.status === "DELIVERED" ? "success" : w.status === "CANCELLED" ? "danger" : "warning"}>{WARNING_LABELS[w.status]}</Badge>
                    <span className="text-xs text-muted">القالب: {w.templateVersion.template.name} (الإصدار {w.templateVersion.versionNo})</span>
                  </div>
                  <div className="text-xs text-muted">
                    أُعد في {formatDateTime(w.preparedAt)} بواسطة {names.get(w.preparedById)}
                    {w.signedAt && `، وُقِّع في ${formatDate(w.signedAt)} من ${w.signerName}`}
                    {w.cancelReason && `، أُلغي: ${w.cancelReason}`}
                  </div>
                  {w.status !== "CANCELLED" && (
                    <div className="flex flex-wrap gap-3 text-sm">
                      <Link className="text-brand underline" href={`/warnings/${w.id}/print`} target="_blank">{w.status === "AWAITING_SIGNATURE" ? "نسخة الإنذار قبل التوقيع (طباعة / PDF)" : "عرض نص الإنذار"}</Link>
                      <a className="text-brand underline" href={`/api/warnings/${w.id}/docx`}>تصدير Word</a>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {v.stage === "WARNING_PREPARATION" && can(actor, "warning.prepare") && (
            templates.length === 0
              ? <p className="text-sm text-tone-warning">لا توجد قوالب إنذار معتمدة مفعلة. تُضاف من «قوالب الكتب والإنذارات».</p>
              : <PrepareWarningForm violationId={v.id} templates={templates} />
          )}
          {activeWarning && v.stage === "AWAITING_WARNING_SIGNATURE" && (can(actor, "warning.upload_signed") || can(actor, "warning.prepare")) && (
            <div className="border-t border-line pt-4">
              <p className="mb-3 text-xs text-muted">التوقيع يدوي من رئيس الهيئة: اطبع النسخة، وبعد توقيعها تُرفع نسختها الضوئية. الموافقة الإلكترونية داخل المنصة لا تغني عن التوقيع اليدوي.</p>
              <SignedWarningForm violationId={v.id} warningId={activeWarning.id} canUpload={can(actor, "warning.upload_signed")} canCancel={can(actor, "warning.prepare")} />
            </div>
          )}
        </Card>
      )}

      {approvals.length > 0 && (
        <Card title="سجل القرارات والمصادقات">
          <DataTable>
            <thead><tr><th>القرار</th><th>النوع</th><th>صاحب القرار</th><th>الدور</th><th>التاريخ والوقت</th><th>الملاحظات</th></tr></thead>
            <tbody>
              {approvals.map((a) => (
                <tr key={a.id}>
                  <td><Badge tone={DECISION_TONE[a.decision]}>{DECISION_LABELS[a.decision]}</Badge></td>
                  <td className="text-xs">{APPROVAL_KIND_LABELS[a.kind]}</td>
                  <td className="text-xs">{a.decidedBy.fullName}</td>
                  <td className="text-xs">{a.decidedRole.map((r) => SYSTEM_ROLES[r]?.nameAr ?? r).join("، ")}</td>
                  <td className="text-xs whitespace-nowrap">{formatDateTime(a.decidedAt)}</td>
                  <td className="text-xs">{a.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Card>
      )}
    </>
  );
}
