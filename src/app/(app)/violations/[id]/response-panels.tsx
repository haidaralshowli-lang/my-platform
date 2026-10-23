import type { Violation } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { can, type Actor } from "@/lib/rbac/actor";
import { Badge, Card, Field } from "@/components/ui";
import { ActForm } from "@/components/act-form";
import { DEFAULT_TZ, formatDate, formatDateTime, formatNumberLocale, localDateKey } from "@/lib/datetime";
import { OBJECTION_FROM } from "@/lib/workflow/transitions";
import { RESPONSE_STAGES } from "@/lib/services/responses";
import { objectionAction, removalAction, responseAction } from "../../workflow-actions";

const KIND = { FINANCIAL: "استجابة مالية", TECHNICAL: "استجابة فنية", LEGAL: "استجابة قانونية" } as const;
const STATUS = { RECORDED: "مسجلة", UNDER_VERIFICATION: "قيد التحقق", ACCEPTED: "مقبولة", PARTIALLY_ACCEPTED: "مقبولة جزئياً", REJECTED: "غير كافية" } as const;
const STATUS_TONE = { RECORDED: "neutral", UNDER_VERIFICATION: "warning", ACCEPTED: "success", PARTIALLY_ACCEPTED: "warning", REJECTED: "danger" } as const;
const PAY = { UNPAID: "غير مسدد", PARTIALLY_PAID: "مسدد جزئياً", PAID: "مسدد بالكامل", UNDER_AUDIT: "قيد التدقيق (لا مبلغ مستحق معتمد)" } as const;
const COMPLIANCE = { FULL: "امتثال كامل", PARTIAL: "امتثال جزئي", NOT_VERIFIED: "غير متحقق" } as const;
const REQ = { PENDING: "قيد المراجعة", APPROVED: "مقبول", REJECTED: "مرفوض", WITHDRAWN: "مسحوب" } as const;

const money = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? "—" : `${formatNumberLocale(d.toString())} د.ع`);

export async function ResponseSections({ actor, v }: { actor: Actor; v: Violation }) {
  const [responses, removals, objections] = await Promise.all([
    prisma.response.findMany({ where: { violationId: v.id }, orderBy: { createdAt: "desc" }, include: { financial: { include: { payments: { orderBy: { createdAt: "asc" } } } }, technical: true, legal: true } }),
    prisma.removalRecord.findMany({ where: { violationId: v.id }, orderBy: { createdAt: "desc" } }),
    prisma.objection.findMany({ where: { violationId: v.id }, orderBy: { createdAt: "desc" }, include: { events: { orderBy: { eventAt: "asc" } } } }),
  ]);
  const canRecordStage = (RESPONSE_STAGES as readonly string[]).includes(v.stage) && v.generalStatus === "OPEN";
  const showResponses = responses.length > 0 || canRecordStage;
  const showFinancial = can(actor, "financial.view") || can(actor, "financial.record");
  const today = localDateKey(new Date(), DEFAULT_TZ);
  const canObject = (OBJECTION_FROM as readonly string[]).includes(v.stage) && can(actor, "objection.record") && !objections.some((o) => o.status === "PENDING");
  const removalStage = ["AWAITING_RESPONSE_VERIFICATION", "AWAITING_FINAL_VERIFICATION"].includes(v.stage);
  if (!showResponses && objections.length === 0 && !canObject) return null;

  return (
    <>
      {showResponses && (
        <Card title={`الاستجابات (${responses.length})`}>
          <ul className="flex flex-col divide-y divide-line">
            {responses.map((r) => {
              const open = r.status === "UNDER_VERIFICATION" || r.status === "RECORDED";
              const paid = r.financial?.payments.reduce((s, p) => s.plus(p.amount), new Prisma.Decimal(0));
              return (
                <li key={r.id} className="flex flex-col gap-2 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{KIND[r.kind]}</span>
                    <Badge tone={STATUS_TONE[r.status]}>{STATUS[r.status]}</Badge>
                    <span className="text-xs text-muted">وردت {formatDate(r.receivedAt, undefined, "UTC")}{r.letterNumber && ` — كتاب ${r.letterNumber}`}{r.letterDate && ` في ${formatDate(r.letterDate, undefined, "UTC")}`}</span>
                  </div>
                  <p className="leading-7">{r.summary}</p>
                  {r.decisionNotes && <p className="text-xs">القرار: {r.decisionNotes} — {formatDateTime(r.decidedAt)}</p>}

                  {r.financial && (showFinancial ? (
                    <div className="rounded-md bg-band p-3">
                      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                        <div><dt className="text-xs text-muted">النوع</dt><dd>{r.financial.financialType}</dd></div>
                        <div><dt className="text-xs text-muted">رقم المعاملة المالية</dt><dd><bdi>{r.financial.transactionNumber ?? "—"}</bdi></dd></div>
                        <div><dt className="text-xs text-muted">حالة التسديد</dt><dd><Badge tone={r.financial.paymentStatus === "PAID" ? "success" : "warning"}>{PAY[r.financial.paymentStatus]}</Badge></dd></div>
                        <div><dt className="text-xs text-muted">المبلغ المستحق المعتمد</dt><dd>{money(r.financial.amountDue)}</dd></div>
                        <div><dt className="text-xs text-muted">المسدد</dt><dd>{money(paid)}</dd></div>
                        <div><dt className="text-xs text-muted">المتبقي</dt><dd>{r.financial.amountDue && paid ? money(r.financial.amountDue.minus(paid)) : "—"}</dd></div>
                        <div className="sm:col-span-3"><dt className="text-xs text-muted">سند المبلغ</dt><dd>{r.financial.amountDueBasis ?? "—"}</dd></div>
                        <div className="sm:col-span-3"><dt className="text-xs text-muted">نتيجة التدقيق المالي</dt><dd>{r.financial.auditResult ?? "لم تُسجَّل بعد"}</dd></div>
                      </dl>
                      {r.financial.payments.length > 0 && (
                        <ul className="mt-2 text-xs">
                          {r.financial.payments.map((p) => (
                            <li key={p.id}>{p.amount.isNegative() ? "قيد عكسي" : "تسديد"} {money(p.amount)} في {formatDate(p.paidAt, undefined, "UTC")} — وصل <bdi>{p.receiptNumber}</bdi>{p.overpaymentReason && ` — ${p.overpaymentReason}`}</li>
                          ))}
                        </ul>
                      )}
                      {open && can(actor, "financial.record") && (
                        <div className="mt-3 grid gap-3 lg:grid-cols-2">
                          <ActForm action={responseAction} hidden={{ violationId: v.id, responseId: r.id, op: "payment" }} submit="تسجيل التسديد" className="grid sm:grid-cols-3">
                            <Field label="المبلغ" htmlFor={`pa-${r.id}`} required hint="سالب لقيد عكسي معتمد"><input id={`pa-${r.id}`} name="amount" inputMode="decimal" dir="ltr" className="field-input" /></Field>
                            <Field label="تاريخ التسديد" htmlFor={`pd-${r.id}`} required><input id={`pd-${r.id}`} name="paidAt" type="date" max={today} className="field-input" /></Field>
                            <Field label="رقم الوصل" htmlFor={`pr-${r.id}`} required><input id={`pr-${r.id}`} name="receiptNumber" className="field-input" /></Field>
                            <Field label="سبب التجاوز أو القيد العكسي" htmlFor={`po-${r.id}`} className="sm:col-span-3"><input id={`po-${r.id}`} name="overpaymentReason" className="field-input" /></Field>
                          </ActForm>
                          <ActForm action={responseAction} hidden={{ violationId: v.id, responseId: r.id, op: "financial" }} submit="حفظ البيانات المالية" variant="secondary" className="grid sm:grid-cols-2">
                            <Field label="المبلغ المستحق المعتمد" htmlFor={`ad-${r.id}`} hint="لا يحتسبه النظام؛ يُدخل من سند معتمد"><input id={`ad-${r.id}`} name="amountDue" defaultValue={r.financial.amountDue?.toString() ?? ""} dir="ltr" className="field-input" /></Field>
                            <Field label="سند المبلغ" htmlFor={`ab-${r.id}`}><input id={`ab-${r.id}`} name="amountDueBasis" defaultValue={r.financial.amountDueBasis ?? ""} className="field-input" /></Field>
                            <Field label="نتيجة التدقيق المالي" htmlFor={`au-${r.id}`} className="sm:col-span-2"><input id={`au-${r.id}`} name="auditResult" defaultValue={r.financial.auditResult ?? ""} className="field-input" /></Field>
                            <Field label="سبب تعديل المبلغ (إن عُدِّل)" htmlFor={`ar-${r.id}`} className="sm:col-span-2"><input id={`ar-${r.id}`} name="reason" className="field-input" /></Field>
                          </ActForm>
                        </div>
                      )}
                    </div>
                  ) : <p className="text-xs text-muted">التفاصيل المالية محجوبة لعدم امتلاك صلاحية الاطلاع.</p>)}

                  {r.technical && (
                    <div className="rounded-md bg-band p-3">
                      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                        <div className="sm:col-span-2"><dt className="text-xs text-muted">الإجراء التصحيحي</dt><dd>{r.technical.correctiveAction}</dd></div>
                        <div><dt className="text-xs text-muted">تاريخ التنفيذ</dt><dd>{formatDate(r.technical.implementedAt, undefined, "UTC")}</dd></div>
                        <div><dt className="text-xs text-muted">حالة الامتثال</dt><dd><Badge tone={r.technical.compliance === "FULL" ? "success" : r.technical.compliance === "PARTIAL" ? "warning" : "neutral"}>{COMPLIANCE[r.technical.compliance]}</Badge></dd></div>
                        {r.technical.inspectionReport && <div className="sm:col-span-2"><dt className="text-xs text-muted">محضر الكشف اللاحق</dt><dd>{r.technical.inspectionReport}</dd></div>}
                        {r.technical.verificationResult && <div className="sm:col-span-2"><dt className="text-xs text-muted">نتيجة التحقق الفني</dt><dd>{r.technical.verificationResult}</dd></div>}
                        {r.technical.recommendation && <div className="sm:col-span-2"><dt className="text-xs text-muted">توصية الموظف الفني</dt><dd>{r.technical.recommendation}</dd></div>}
                      </dl>
                      {open && can(actor, "response.technical_verify") && (
                        <ActForm action={responseAction} hidden={{ violationId: v.id, responseId: r.id, op: "verify" }} submit="حفظ نتيجة التحقق" variant="secondary" className="mt-3 grid sm:grid-cols-2">
                          <Field label="نتيجة التحقق الفني" htmlFor={`vr-${r.id}`} required className="sm:col-span-2"><textarea id={`vr-${r.id}`} name="verificationResult" rows={2} defaultValue={r.technical.verificationResult ?? ""} className="field-input" /></Field>
                          <Field label="حالة الامتثال" htmlFor={`vc-${r.id}`} required>
                            <select id={`vc-${r.id}`} name="compliance" defaultValue={r.technical.compliance} className="field-input">{Object.entries(COMPLIANCE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                          </Field>
                          <Field label="التوصية" htmlFor={`vt-${r.id}`}><input id={`vt-${r.id}`} name="recommendation" defaultValue={r.technical.recommendation ?? ""} className="field-input" /></Field>
                        </ActForm>
                      )}
                    </div>
                  )}

                  {r.legal && (
                    <div className="rounded-md bg-band p-3">
                      <dl className="grid gap-y-1">
                        <div><dt className="text-xs text-muted">نوع الاستجابة القانونية</dt><dd>{r.legal.legalType}</dd></div>
                        <div><dt className="text-xs text-muted">المضمون</dt><dd>{r.legal.content}</dd></div>
                        <div><dt className="text-xs text-muted">الرأي القانوني</dt><dd>{r.legal.legalOpinion ?? "لم يُبدَ بعد"}</dd></div>
                        {r.legal.proposedAction && <div><dt className="text-xs text-muted">الإجراء المقترح</dt><dd>{r.legal.proposedAction}</dd></div>}
                      </dl>
                      {open && can(actor, "response.legal_decide") && (
                        <ActForm action={responseAction} hidden={{ violationId: v.id, responseId: r.id, op: "opinion" }} submit="حفظ الرأي القانوني" variant="secondary" className="mt-3">
                          <Field label="الرأي القانوني" htmlFor={`lo-${r.id}`} required><textarea id={`lo-${r.id}`} name="legalOpinion" rows={2} defaultValue={r.legal.legalOpinion ?? ""} className="field-input" /></Field>
                          <Field label="الإجراء المقترح" htmlFor={`lp-${r.id}`}><input id={`lp-${r.id}`} name="proposedAction" defaultValue={r.legal.proposedAction ?? ""} className="field-input" /></Field>
                        </ActForm>
                      )}
                    </div>
                  )}

                  {open && v.stage === "AWAITING_RESPONSE_VERIFICATION" && can(actor, "response.decide") && (
                    <div className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-3">
                      <ActForm action={responseAction} hidden={{ violationId: v.id, responseId: r.id, op: "decide", decision: "ACCEPTED" }} submit="قبول الاستجابة"
                        confirm={{ title: "قبول الاستجابة", message: "تنتقل المعاملة للتحقق النهائي والإغلاق، ولا يُغلق الملف تلقائياً." }}>
                        <input name="notes" placeholder="ملاحظات (اختيارية)" aria-label="ملاحظات القبول" className="field-input" />
                      </ActForm>
                      <ActForm action={responseAction} hidden={{ violationId: v.id, responseId: r.id, op: "decide", decision: "PARTIALLY_ACCEPTED" }} submit="قبول جزئي" variant="secondary"
                        confirm={{ title: "قبول جزئي", message: "تُعد الاستجابة غير مكتملة ويُستأنف احتساب المدة." }}>
                        <input name="notes" required placeholder="الأسباب (إلزامية)" aria-label="أسباب القبول الجزئي" className="field-input" />
                      </ActForm>
                      <ActForm action={responseAction} hidden={{ violationId: v.id, responseId: r.id, op: "decide", decision: "REJECTED" }} submit="عدم كفاية الاستجابة" variant="danger"
                        confirm={{ title: "عدم كفاية الاستجابة", message: "يُستأنف احتساب المدة، وإن كانت قد انتهت تعود المعاملة إلى «انتهت المدة»." }}>
                        <input name="notes" required placeholder="الأسباب (إلزامية)" aria-label="أسباب الرفض" className="field-input" />
                      </ActForm>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {canRecordStage && (can(actor, "response.record") || can(actor, "financial.record")) && (
            <details className="mt-3 border-t border-line pt-3">
              <summary className="cursor-pointer text-sm font-medium text-brand">تسجيل استجابة جديدة من الجهة المخالفة</summary>
              <div className="mt-3 flex flex-col gap-4">
                {(["FINANCIAL", "TECHNICAL", "LEGAL"] as const).filter((k) => can(actor, k === "FINANCIAL" ? "financial.record" : "response.record")).map((k) => (
                  <details key={k} className="rounded-md border border-line p-3">
                    <summary className="cursor-pointer text-sm">{KIND[k]}</summary>
                    <ActForm action={responseAction} hidden={{ violationId: v.id, op: "record", kind: k }} submit="تسجيل الاستجابة"
                      confirm={{ title: `تسجيل ${KIND[k]}`, message: "يتوقف احتساب المدة وتنتقل المعاملة للتحقق من الاستجابة." }} className="mt-3 grid sm:grid-cols-3">
                      <Field label="تاريخ ورود الاستجابة" htmlFor={`rb-${k}`} required><input id={`rb-${k}`} name="receivedAt" type="date" max={today} className="field-input" /></Field>
                      <Field label="رقم الكتاب" htmlFor={`rl-${k}`}><input id={`rl-${k}`} name="letterNumber" className="field-input" /></Field>
                      <Field label="تاريخ الكتاب" htmlFor={`rd-${k}`}><input id={`rd-${k}`} name="letterDate" type="date" className="field-input" /></Field>
                      <Field label="مضمون الاستجابة" htmlFor={`rs-${k}`} required className="sm:col-span-3"><textarea id={`rs-${k}`} name="summary" rows={2} className="field-input" /></Field>
                      {k === "FINANCIAL" && <>
                        <Field label="نوع الاستجابة المالية" htmlFor="fft" required><input id="fft" name="financialType" className="field-input" /></Field>
                        <Field label="رقم المعاملة المالية" htmlFor="ftn"><input id="ftn" name="transactionNumber" className="field-input" /></Field>
                        <Field label="الموظف المختص" htmlFor="fof"><input id="fof" name="officerName" className="field-input" /></Field>
                        <Field label="المبلغ المستحق المعتمد" htmlFor="fad" hint="اختياري؛ لا يحتسبه النظام"><input id="fad" name="amountDue" dir="ltr" className="field-input" /></Field>
                        <Field label="سند المبلغ المعتمد" htmlFor="fab" className="sm:col-span-2"><input id="fab" name="amountDueBasis" className="field-input" /></Field>
                      </>}
                      {k === "TECHNICAL" && <>
                        <Field label="الإجراء التصحيحي الذي قامت به الجهة" htmlFor="tca" required className="sm:col-span-2"><textarea id="tca" name="correctiveAction" rows={2} className="field-input" /></Field>
                        <Field label="تاريخ التنفيذ" htmlFor="tia"><input id="tia" name="implementedAt" type="date" max={today} className="field-input" /></Field>
                        <Field label="محضر الكشف اللاحق" htmlFor="tir" className="sm:col-span-3"><textarea id="tir" name="inspectionReport" rows={2} className="field-input" /></Field>
                      </>}
                      {k === "LEGAL" && <>
                        <Field label="نوع الاستجابة القانونية" htmlFor="llt" required><input id="llt" name="legalType" className="field-input" /></Field>
                        <Field label="المضمون القانوني" htmlFor="llc" required className="sm:col-span-2"><textarea id="llc" name="content" rows={2} className="field-input" /></Field>
                      </>}
                      <Field label="المرفقات" htmlFor={`rf-${k}`} className="sm:col-span-3" hint="الأدلة والصور والتقارير والوصولات"><input id={`rf-${k}`} name="files" type="file" multiple className="field-input" /></Field>
                    </ActForm>
                  </details>
                ))}
              </div>
            </details>
          )}
        </Card>
      )}

      {(removals.length > 0 || (removalStage && can(actor, "removal.record"))) && (
        <Card title="إزالة المخالفة بالكامل">
          <ul className="flex flex-col divide-y divide-line">
            {removals.map((m) => (
              <li key={m.id} className="flex flex-col gap-1 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2"><Badge tone={m.status === "APPROVED" ? "success" : m.status === "REJECTED" ? "danger" : "warning"}>{REQ[m.status]}</Badge><span>المعالجة في {formatDate(m.treatedAt, undefined, "UTC")}</span></div>
                <p>{m.description}</p>
                <p className="text-xs text-muted">تحققت منها: {m.verifiedByName}{m.inspectionResult && ` — نتيجة الكشف: ${m.inspectionResult}`}{m.approvedAt && ` — القرار في ${formatDateTime(m.approvedAt)}${m.decisionNotes ? `: ${m.decisionNotes}` : ""}`}</p>
                {m.status === "PENDING" && can(actor, "removal.approve") && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <ActForm action={removalAction} hidden={{ violationId: v.id, removalId: m.id, op: "approve" }} submit="اعتماد الإزالة النهائية"
                      confirm={{ title: "اعتماد إزالة المخالفة", message: "تُحدد النتيجة «إزالة المخالفة بالكامل» وينتقل الملف للتحقق النهائي. الإغلاق إجراء مستقل." }}>
                      <input name="notes" placeholder="ملاحظات" aria-label="ملاحظات الاعتماد" className="field-input" />
                    </ActForm>
                    <ActForm action={removalAction} hidden={{ violationId: v.id, removalId: m.id, op: "reject" }} submit="عدم قبول المعالجة" variant="danger">
                      <input name="notes" required placeholder="السبب (إلزامي)" aria-label="سبب عدم القبول" className="field-input" />
                    </ActForm>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {removalStage && can(actor, "removal.record") && !removals.some((m) => m.status === "PENDING") && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-brand">تسجيل إزالة المخالفة (بعد التحقق من امتثال كامل)</summary>
              <ActForm action={removalAction} hidden={{ violationId: v.id, op: "record" }} submit="تسجيل الإزالة" className="mt-3 grid sm:grid-cols-2">
                <Field label="وصف المعالجة" htmlFor="md" required className="sm:col-span-2"><textarea id="md" name="description" rows={2} className="field-input" /></Field>
                <Field label="تاريخ المعالجة" htmlFor="mt" required><input id="mt" name="treatedAt" type="date" max={today} className="field-input" /></Field>
                <Field label="الجهة التي تحققت من الإزالة" htmlFor="mv" required><input id="mv" name="verifiedByName" className="field-input" /></Field>
                <Field label="تقرير التحقق" htmlFor="mr"><textarea id="mr" name="verificationReport" rows={2} className="field-input" /></Field>
                <Field label="نتيجة الكشف أو التدقيق" htmlFor="mi"><textarea id="mi" name="inspectionResult" rows={2} className="field-input" /></Field>
                <Field label="الأدلة المرفقة" htmlFor="mf" className="sm:col-span-2"><input id="mf" name="files" type="file" multiple className="field-input" /></Field>
              </ActForm>
            </details>
          )}
        </Card>
      )}

      {(objections.length > 0 || canObject) && (
        <Card title="الاعتراضات والطعون">
          <ul className="flex flex-col divide-y divide-line">
            {objections.map((o) => (
              <li key={o.id} className="flex flex-col gap-1 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{o.kind === "APPEAL" ? "طعن" : "اعتراض"}</span>
                  <Badge tone={o.status === "PENDING" ? "warning" : o.status === "APPROVED" ? "success" : "danger"}>{REQ[o.status]}</Badge>
                  <span className="text-xs text-muted">قُدِّم {formatDate(o.submittedAt, undefined, "UTC")}{o.referenceNumber && ` — رقم ${o.referenceNumber}`}{o.competentAuthority && ` — الجهة المختصة: ${o.competentAuthority}`}</span>
                  {o.suspendedDeadline && <Badge tone="info">عُلِّقت المدة</Badge>}
                </div>
                <p>{o.content}</p>
                {o.events.map((e) => <p key={e.id} className="text-xs">• {formatDate(e.eventAt, undefined, "UTC")}: {e.description}</p>)}
                {o.outcome && <p className="text-xs">النتيجة: {o.outcome} — الأثر: {o.effectOnFlow}</p>}
                {o.status === "PENDING" && (
                  <div className="mt-2 grid gap-3 rounded-md bg-band p-3 lg:grid-cols-2">
                    {can(actor, "objection.record") && (
                      <ActForm action={objectionAction} hidden={{ violationId: v.id, objectionId: o.id, op: "event" }} submit="إضافة إجراء أو مراسلة" variant="secondary" className="grid sm:grid-cols-2">
                        <Field label="التاريخ" htmlFor={`oe-${o.id}`} required><input id={`oe-${o.id}`} name="eventAt" type="date" max={today} className="field-input" /></Field>
                        <Field label="الوصف" htmlFor={`od-${o.id}`} required><input id={`od-${o.id}`} name="description" className="field-input" /></Field>
                        <Field label="مرفق" htmlFor={`of-${o.id}`} className="sm:col-span-2"><input id={`of-${o.id}`} name="files" type="file" className="field-input" /></Field>
                      </ActForm>
                    )}
                    {can(actor, "objection.decide") && !o.suspendedDeadline && (
                      <ActForm action={objectionAction} hidden={{ violationId: v.id, objectionId: o.id, op: "suspend" }} submit="تعليق المدة بقرار موثق" variant="secondary"
                        confirm={{ title: "تعليق المدة", message: "متاح فقط إذا كانت قاعدة المدة تجعل أثر الاعتراض بقرار. تُضاف مدة التعليق إلى الاستحقاق عند الاستئناف." }}>
                        <Field label="سند قرار التعليق" htmlFor={`os-${o.id}`} required><input id={`os-${o.id}`} name="reason" className="field-input" /></Field>
                      </ActForm>
                    )}
                    {can(actor, "objection.decide") && (
                      <ActForm action={objectionAction} hidden={{ violationId: v.id, objectionId: o.id, op: "decide" }} submit="تسجيل القرار"
                        confirm={{ title: "قرار الاعتراض", message: "يُسجَّل القرار وأثره كما حددته. لا يُلغى أي إجراء سابق." }} className="grid sm:grid-cols-2 lg:col-span-2">
                        <Field label="النتيجة" htmlFor={`oa-${o.id}`} required>
                          <select id={`oa-${o.id}`} name="accepted" className="field-input"><option value="no">رفض الاعتراض</option><option value="yes">قبول الاعتراض</option></select>
                        </Field>
                        <Field label="أثر القرار على سير المخالفة" htmlFor={`ox-${o.id}`} required>
                          <select id={`ox-${o.id}`} name="effect" className="field-input"><option value="CONTINUE">استمرار سير المعاملة</option><option value="END_FILE">إنهاء المسار (عند القبول)</option></select>
                        </Field>
                        <Field label="القرار والنتيجة النهائية" htmlFor={`oo-${o.id}`} required className="sm:col-span-2"><textarea id={`oo-${o.id}`} name="outcome" rows={2} className="field-input" /></Field>
                        <Field label="بيان الأثر" htmlFor={`oy-${o.id}`} required className="sm:col-span-2"><input id={`oy-${o.id}`} name="effectOnFlow" className="field-input" /></Field>
                      </ActForm>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {canObject && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-brand">تسجيل اعتراض أو طعن</summary>
              <ActForm action={objectionAction} hidden={{ violationId: v.id, op: "record" }} submit="تسجيل" className="mt-3 grid sm:grid-cols-3"
                confirm={{ title: "تسجيل اعتراض أو طعن", message: "لا يوقف الاعتراض المدة ولا يلغي المخالفة تلقائياً، إلا إذا نصت قاعدة المدة المعتمدة على التعليق." }}>
                <Field label="النوع" htmlFor="ok" required><select id="ok" name="kind" className="field-input"><option value="OBJECTION">اعتراض</option><option value="APPEAL">طعن</option></select></Field>
                <Field label="تاريخ التقديم" htmlFor="ot" required><input id="ot" name="submittedAt" type="date" max={today} className="field-input" /></Field>
                <Field label="رقم الكتاب أو الدعوى" htmlFor="on"><input id="on" name="referenceNumber" className="field-input" /></Field>
                <Field label="الجهة المختصة بالنظر فيه" htmlFor="oc" className="sm:col-span-3"><input id="oc" name="competentAuthority" className="field-input" /></Field>
                <Field label="مضمون الاعتراض" htmlFor="ob" required className="sm:col-span-3"><textarea id="ob" name="content" rows={3} className="field-input" /></Field>
                <Field label="المستندات المرفقة" htmlFor="of" className="sm:col-span-3"><input id="of" name="files" type="file" multiple className="field-input" /></Field>
              </ActForm>
            </details>
          )}
        </Card>
      )}
    </>
  );
}
