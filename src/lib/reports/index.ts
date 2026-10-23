import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError, forbidden } from "@/lib/errors";
import { can, type Actor } from "@/lib/rbac/actor";
import type { PermissionCode } from "@/lib/rbac/catalog";
import { DEFAULT_TZ, formatDate, formatDateTime, localDateKey, zonedDateTimeToUtc } from "@/lib/datetime";
import { OUTCOME_LABELS, STAGE_LABELS, STAGE_ORDER, STATUS_LABELS } from "@/lib/workflow/labels";
import { CASE_STATUS_LABELS, docTypeLabel } from "@/lib/documents";
import { kpiWhere } from "@/lib/services/dashboard";

export const reportParamsSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")).transform((v) => v || undefined),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")).transform((v) => v || undefined),
  governorateId: z.string().max(40).optional().transform((v) => v || undefined),
  officeId: z.string().max(40).optional().transform((v) => v || undefined),
  violationTypeId: z.string().max(40).optional().transform((v) => v || undefined),
  number: z.string().trim().max(60).optional().transform((v) => v || undefined),
});
export type ReportParams = z.infer<typeof reportParamsSchema>;

export type Column = { key: string; label: string };
export type Cell = string | number;
export type ReportResult = { columns: Column[]; rows: Record<string, Cell>[]; note?: string };

type Def = {
  title: string;
  description: string;
  perm?: PermissionCode;
  /// المعاملات المعتمدة بالإضافة إلى المرشحات العامة
  needsNumber?: boolean;
  run: (actor: Actor, p: ReportParams) => Promise<ReportResult>;
};

/// المرشحات العامة: نطاق المستخدم، غير التجريبية، والفترة على تاريخ التسجيل الرسمي بتوقيت بغداد
function baseWhere(actor: Actor, p: ReportParams, extra: Prisma.ViolationWhereInput = {}): Prisma.ViolationWhereInput {
  const and: Prisma.ViolationWhereInput[] = [extra];
  if (p.from || p.to) {
    and.push({
      registeredAt: {
        ...(p.from ? { gte: zonedDateTimeToUtc(p.from, "00:00", DEFAULT_TZ) } : {}),
        ...(p.to ? { lt: new Date(zonedDateTimeToUtc(p.to, "00:00", DEFAULT_TZ).getTime() + 86_400_000) } : {}),
      },
    });
  }
  if (p.governorateId) and.push({ governorateId: p.governorateId });
  if (p.officeId) and.push({ officeId: p.officeId });
  if (p.violationTypeId) and.push({ violationTypeId: p.violationTypeId });
  return kpiWhere(actor, { AND: and });
}

const RESP = { RECORDED: "مسجلة", UNDER_VERIFICATION: "قيد التحقق", ACCEPTED: "مقبولة", PARTIALLY_ACCEPTED: "مقبولة جزئياً", REJECTED: "غير كافية" } as const;
const REQ = { PENDING: "قيد المراجعة", APPROVED: "موافق عليه", REJECTED: "مرفوض", WITHDRAWN: "مسحوب" } as const;

const dec = (d: Prisma.Decimal | null | undefined) => (d ? Number(d.toFixed(2)) : 0);
const days = (a: Date, b: Date) => Math.round(((b.getTime() - a.getTime()) / 86_400_000) * 10) / 10;

async function countBy(actor: Actor, p: ReportParams, by: "governorateId" | "violationTypeId" | "stage") {
  const where = baseWhere(actor, p);
  const [all, open, closed] = await Promise.all([
    prisma.violation.groupBy({ by: [by], where, _count: true }),
    prisma.violation.groupBy({ by: [by], where: { AND: [where, { generalStatus: "OPEN" }] }, _count: true }),
    prisma.violation.groupBy({ by: [by], where: { AND: [where, { generalStatus: "CLOSED" }] }, _count: true }),
  ]);
  const get = (rows: typeof all, k: unknown) => rows.find((r) => (r as Record<string, unknown>)[by] === k)?._count ?? 0;
  return all.map((r) => ({ key: (r as Record<string, unknown>)[by] as string | null, total: r._count, open: get(open, (r as Record<string, unknown>)[by]), closed: get(closed, (r as Record<string, unknown>)[by]) }));
}

const violationRow = (v: { number: string | null; offenderName: string; stage: keyof typeof STAGE_LABELS; registeredAt: Date | null; governorate: { nameAr: string }; office: { nameAr: string } }) => ({
  number: v.number ?? "", offenderName: v.offenderName, place: `${v.governorate.nameAr} / ${v.office.nameAr}`, stage: STAGE_LABELS[v.stage], registeredAt: formatDate(v.registeredAt),
});
const VCOLS: Column[] = [{ key: "number", label: "رقم المخالفة" }, { key: "offenderName", label: "الجهة المخالفة" }, { key: "place", label: "المحافظة / الفرع" }, { key: "stage", label: "المرحلة" }, { key: "registeredAt", label: "تاريخ التسجيل" }];
const vSelect = { id: true, number: true, offenderName: true, stage: true, registeredAt: true, governorate: { select: { nameAr: true } }, office: { select: { nameAr: true } } } as const;
const CC: Column[] = [{ key: "label", label: "البند" }, { key: "total", label: "الإجمالي" }, { key: "open", label: "المفتوحة" }, { key: "closed", label: "المغلقة" }];

export const REPORTS: Record<string, Def> = {
  by_governorate: {
    title: "المخالفات حسب المحافظة", description: "عدد المخالفات المسجلة والمفتوحة والمغلقة لكل محافظة.",
    run: async (a, p) => {
      const rows = await countBy(a, p, "governorateId");
      const names = new Map((await prisma.governorate.findMany()).map((g) => [g.id, g.nameAr]));
      return { columns: CC, rows: rows.map((r) => ({ label: names.get(r.key!) ?? "—", total: r.total, open: r.open, closed: r.closed })).sort((x, y) => (y.total as number) - (x.total as number)) };
    },
  },
  by_type: {
    title: "المخالفات حسب نوع المخالفة", description: "توزيع المخالفات على الأنواع المعتمدة.",
    run: async (a, p) => {
      const rows = await countBy(a, p, "violationTypeId");
      const names = new Map((await prisma.violationType.findMany()).map((t) => [t.id, t.nameAr]));
      return { columns: CC, rows: rows.map((r) => ({ label: r.key ? names.get(r.key) ?? "—" : "غير محدد", total: r.total, open: r.open, closed: r.closed })).sort((x, y) => (y.total as number) - (x.total as number)) };
    },
  },
  by_stage: {
    title: "المخالفات حسب المرحلة الإجرائية", description: "عدد المخالفات في كل مرحلة.",
    run: async (a, p) => {
      const rows = await countBy(a, p, "stage");
      return { columns: [{ key: "label", label: "المرحلة" }, { key: "total", label: "العدد" }], rows: rows.sort((x, y) => STAGE_ORDER.indexOf(x.key as never) - STAGE_ORDER.indexOf(y.key as never)).map((r) => ({ label: STAGE_LABELS[r.key as keyof typeof STAGE_LABELS], total: r.total })) };
    },
  },
  open_closed: {
    title: "المخالفات المفتوحة والمغلقة", description: "الحالة العامة، والمغلقة حسب نتيجة الإغلاق.",
    run: async (a, p) => {
      const where = baseWhere(a, p);
      const [st, oc] = await Promise.all([
        prisma.violation.groupBy({ by: ["generalStatus"], where, _count: true }),
        prisma.violation.groupBy({ by: ["outcome"], where: { AND: [where, { generalStatus: "CLOSED" }] }, _count: true }),
      ]);
      return {
        columns: [{ key: "label", label: "البند" }, { key: "total", label: "العدد" }],
        rows: [...st.map((s) => ({ label: STATUS_LABELS[s.generalStatus], total: s._count })), ...oc.map((o) => ({ label: `مغلقة: ${o.outcome ? OUTCOME_LABELS[o.outcome] : "غير محدد"}`, total: o._count }))],
      };
    },
  },
  expired: {
    title: "المخالفات التي انتهت مددها دون استجابة", description: "الملفات في مرحلة «انتهت المدة دون استجابة» أو بانتظار اعتماد عدم الاستجابة.",
    run: async (a, p) => {
      const rows = await prisma.violation.findMany({ where: baseWhere(a, p, { stage: { in: ["DEADLINE_EXPIRED", "AWAITING_NON_RESPONSE_APPROVAL"] } }), select: { ...vSelect, deadlines: { where: { isCurrent: true }, select: { dueDate: true } } }, orderBy: { registeredAt: "asc" } });
      return { columns: [...VCOLS, { key: "due", label: "تاريخ انتهاء المدة" }], rows: rows.map((v) => ({ ...violationRow(v), due: formatDateTime(v.deadlines[0]?.dueDate) })) };
    },
  },
  warnings: {
    title: "الإنذارات الصادرة والمبلغة وغير المثبت استلامها", description: "كل إنذار بحالته وتواريخ توقيعه وإرساله واستلامه.",
    run: async (a, p) => {
      const rows = await prisma.warning.findMany({ where: { status: { not: "CANCELLED" }, violation: baseWhere(a, p) }, include: { violation: { select: { number: true, offenderName: true } }, deliveries: { select: { sentAt: true, receivedAt: true } } }, orderBy: { preparedAt: "desc" } });
      const L = { DRAFT: "مسودة", AWAITING_SIGNATURE: "بانتظار التوقيع", SIGNED: "موقع لم يُرسل", SENT: "مرسل لم يثبت استلامه", DELIVERED: "مبلَّغ", CANCELLED: "ملغى" } as const;
      return {
        columns: [{ key: "number", label: "رقم الإنذار" }, { key: "violation", label: "المخالفة" }, { key: "offender", label: "الجهة" }, { key: "status", label: "الحالة" }, { key: "signed", label: "التوقيع" }, { key: "sent", label: "الإرسال" }, { key: "received", label: "الاستلام" }],
        rows: rows.map((w) => ({ number: w.number, violation: w.violation.number ?? "", offender: w.violation.offenderName, status: L[w.status], signed: formatDate(w.signedAt, undefined, "UTC"), sent: formatDate(w.deliveries[0]?.sentAt), received: formatDateTime(w.deliveries.find((d) => d.receivedAt)?.receivedAt) })),
      };
    },
  },
  financial: {
    title: "الاستجابات المالية والتسديدات", description: "المستحق المعتمد والمسدد والمتبقي لكل استجابة مالية.", perm: "financial.view",
    run: async (a, p) => {
      const rows = await prisma.financialResponse.findMany({ where: { response: { violation: baseWhere(a, p) } }, include: { payments: true, response: { include: { violation: { select: { number: true, offenderName: true } } } } } });
      const P = { UNPAID: "غير مسدد", PARTIALLY_PAID: "مسدد جزئياً", PAID: "مسدد بالكامل", UNDER_AUDIT: "قيد التدقيق" } as const;
      const out = rows.map((r) => {
        const paid = r.payments.reduce((s, x) => s.plus(x.amount), new Prisma.Decimal(0));
        return { violation: r.response.violation.number ?? "", offender: r.response.violation.offenderName, type: r.financialType, due: dec(r.amountDue), paid: dec(paid), remaining: r.amountDue ? dec(r.amountDue.minus(paid)) : 0, payments: r.payments.length, status: P[r.paymentStatus] };
      });
      const sum = (k: "due" | "paid" | "remaining") => out.reduce((s, r) => s + (r[k] as number), 0);
      return {
        columns: [{ key: "violation", label: "المخالفة" }, { key: "offender", label: "الجهة" }, { key: "type", label: "النوع" }, { key: "due", label: "المستحق (د.ع)" }, { key: "paid", label: "المسدد (د.ع)" }, { key: "remaining", label: "المتبقي (د.ع)" }, { key: "payments", label: "عدد التسديدات" }, { key: "status", label: "الحالة" }],
        rows: out, note: `الإجمالي: المستحق ${sum("due")} — المسدد ${sum("paid")} — المتبقي ${sum("remaining")} دينار عراقي`,
      };
    },
  },
  technical_responses: {
    title: "الاستجابات الفنية", description: "الإجراءات التصحيحية ونتائج التحقق وحالة الامتثال.",
    run: async (a, p) => {
      const rows = await prisma.technicalResponse.findMany({ where: { response: { violation: baseWhere(a, p) } }, include: { response: { include: { violation: { select: { number: true, offenderName: true } } } } } });
      const C = { FULL: "امتثال كامل", PARTIAL: "امتثال جزئي", NOT_VERIFIED: "غير متحقق" } as const;
      return {
        columns: [{ key: "violation", label: "المخالفة" }, { key: "offender", label: "الجهة" }, { key: "received", label: "الورود" }, { key: "action", label: "الإجراء التصحيحي" }, { key: "compliance", label: "الامتثال" }, { key: "decision", label: "القرار" }],
        rows: rows.map((r) => ({ violation: r.response.violation.number ?? "", offender: r.response.violation.offenderName, received: formatDate(r.response.receivedAt, undefined, "UTC"), action: r.correctiveAction, compliance: C[r.compliance], decision: RESP[r.response.status] })),
      };
    },
  },
  legal_responses: {
    title: "الاستجابات القانونية", description: "الدفوع القانونية والرأي والقرار.",
    run: async (a, p) => {
      const rows = await prisma.legalResponse.findMany({ where: { response: { violation: baseWhere(a, p) } }, include: { response: { include: { violation: { select: { number: true, offenderName: true } } } } } });
      return {
        columns: [{ key: "violation", label: "المخالفة" }, { key: "offender", label: "الجهة" }, { key: "type", label: "النوع" }, { key: "opinion", label: "الرأي القانوني" }, { key: "decision", label: "القرار" }],
        rows: rows.map((r) => ({ violation: r.response.violation.number ?? "", offender: r.response.violation.offenderName, type: r.legalType, opinion: r.legalOpinion ?? "—", decision: RESP[r.response.status] })),
      };
    },
  },
  removals: {
    title: "إزالة المخالفات بالكامل", description: "سجلات الإزالة وحالة اعتمادها.",
    run: async (a, p) => {
      const rows = await prisma.removalRecord.findMany({ where: { violation: baseWhere(a, p) }, include: { violation: { select: { number: true, offenderName: true } } } });
      return {
        columns: [{ key: "violation", label: "المخالفة" }, { key: "offender", label: "الجهة" }, { key: "treated", label: "تاريخ المعالجة" }, { key: "verifier", label: "المتحقق" }, { key: "status", label: "الحالة" }, { key: "approved", label: "تاريخ الاعتماد" }],
        rows: rows.map((r) => ({ violation: r.violation.number ?? "", offender: r.violation.offenderName, treated: formatDate(r.treatedAt, undefined, "UTC"), verifier: r.verifiedByName ?? "", status: REQ[r.status], approved: formatDateTime(r.approvedAt) })),
      };
    },
  },
  extensions: {
    title: "طلبات التمديد", description: "الطلبات والمدد المطلوبة والممنوحة والقرارات.",
    run: async (a, p) => {
      const rows = await prisma.extensionRequest.findMany({ where: { violation: baseWhere(a, p) }, include: { violation: { select: { number: true, offenderName: true } } }, orderBy: { createdAt: "desc" } });
      return {
        columns: [{ key: "violation", label: "المخالفة" }, { key: "offender", label: "الجهة" }, { key: "requested", label: "المطلوب (يوم)" }, { key: "granted", label: "الممنوح (يوم)" }, { key: "status", label: "الحالة" }, { key: "newDue", label: "الاستحقاق الجديد" }],
        rows: rows.map((r) => ({ violation: r.violation.number ?? "", offender: r.violation.offenderName, requested: r.requestedDays, granted: r.grantedDays ?? 0, status: REQ[r.status], newDue: formatDateTime(r.newDueDate) })),
      };
    },
  },
  objections: {
    title: "الاعتراضات والطعون", description: "الاعتراضات والطعون ونتائجها وأثرها.",
    run: async (a, p) => {
      const rows = await prisma.objection.findMany({ where: { violation: baseWhere(a, p) }, include: { violation: { select: { number: true, offenderName: true } } }, orderBy: { submittedAt: "desc" } });
      return {
        columns: [{ key: "violation", label: "المخالفة" }, { key: "offender", label: "الجهة" }, { key: "kind", label: "النوع" }, { key: "submitted", label: "التقديم" }, { key: "status", label: "الحالة" }, { key: "effect", label: "الأثر" }],
        rows: rows.map((r) => ({ violation: r.violation.number ?? "", offender: r.violation.offenderName, kind: r.kind === "APPEAL" ? "طعن" : "اعتراض", submitted: formatDate(r.submittedAt, undefined, "UTC"), status: REQ[r.status], effect: r.effectOnFlow ?? "—" })),
      };
    },
  },
  criminal_cases: {
    title: "ملفات الدعوى الجزائية", description: "ملفات الدعوى وحالتها ومحاكمها.", perm: "criminal.view",
    run: async (a, p) => {
      const rows = await prisma.criminalCase.findMany({ where: { violation: baseWhere(a, p) }, include: { violation: { select: { number: true, offenderName: true } } }, orderBy: { createdAt: "desc" } });
      return {
        columns: [{ key: "number", label: "رقم الملف" }, { key: "violation", label: "المخالفة" }, { key: "offender", label: "الجهة" }, { key: "court", label: "المحكمة" }, { key: "courtCase", label: "رقم الدعوى" }, { key: "status", label: "الحالة" }, { key: "last", label: "آخر إجراء" }],
        rows: rows.map((r) => ({ number: r.number, violation: r.violation.number ?? "", offender: r.violation.offenderName, court: r.courtName ?? "", courtCase: r.courtCaseNumber ?? "", status: CASE_STATUS_LABELS[r.status], last: r.lastAction ?? "" })),
      };
    },
  },
  judgments: {
    title: "الأحكام القضائية", description: "الأحكام المسجلة وحالتها الإجرائية واعتمادها.", perm: "criminal.view",
    run: async (a, p) => {
      const rows = await prisma.courtJudgment.findMany({ where: { criminalCase: { violation: baseWhere(a, p) } }, include: { resultType: true, criminalCase: { select: { number: true, violation: { select: { offenderName: true } } } } }, orderBy: { judgmentDate: "desc" } });
      const S = { UNKNOWN: "غير معلومة", NOT_FINAL: "غير قطعي", APPEALED: "مطعون فيه", FINAL: "قطعي" } as const;
      return {
        columns: [{ key: "number", label: "رقم الحكم" }, { key: "date", label: "التاريخ" }, { key: "court", label: "المحكمة" }, { key: "case", label: "ملف الدعوى" }, { key: "offender", label: "الجهة" }, { key: "result", label: "النتيجة" }, { key: "status", label: "الحالة الإجرائية" }, { key: "approved", label: "معتمد" }],
        rows: rows.map((r) => ({ number: r.number, date: formatDate(r.judgmentDate, undefined, "UTC"), court: r.courtName, case: r.criminalCase.number, offender: r.criminalCase.violation.offenderName, result: r.resultType?.nameAr ?? "", status: S[r.proceduralStatus], approved: r.approvedById ? "نعم" : "لا" })),
      };
    },
  },
  repeat_offenders: {
    title: "المخالفات المتكررة لكل جهة", description: "الجهات التي سُجلت عليها أكثر من مخالفة (بحسب رقم الإجازة إن وُجد، وإلا الاسم).",
    run: async (a, p) => {
      const rows = await prisma.violation.findMany({ where: baseWhere(a, p), select: { offenderName: true, offenderLicenseNo: true, generalStatus: true } });
      const m = new Map<string, { name: string; license: string; total: number; open: number }>();
      for (const r of rows) {
        const k = r.offenderLicenseNo?.trim() || r.offenderName.trim();
        const e = m.get(k) ?? { name: r.offenderName, license: r.offenderLicenseNo ?? "", total: 0, open: 0 };
        e.total++;
        if (r.generalStatus === "OPEN") e.open++;
        m.set(k, e);
      }
      return {
        columns: [{ key: "name", label: "الجهة" }, { key: "license", label: "رقم الإجازة" }, { key: "total", label: "عدد المخالفات" }, { key: "open", label: "المفتوحة" }],
        rows: [...m.values()].filter((e) => e.total > 1).sort((x, y) => y.total - x.total),
      };
    },
  },
  stage_durations: {
    title: "مدد الإنجاز بين المراحل", description: "متوسط وأقصى عدد الأيام التي بقيتها المعاملات في كل مرحلة (من سجل الانتقالات).",
    run: async (a, p) => {
      const hist = await prisma.violationStatusHistory.findMany({ where: { violation: baseWhere(a, p) }, orderBy: [{ violationId: "asc" }, { createdAt: "asc" }], select: { violationId: true, toStage: true, createdAt: true } });
      const acc = new Map<string, number[]>();
      for (let i = 0; i < hist.length - 1; i++) {
        if (hist[i].violationId !== hist[i + 1].violationId) continue;
        const arr = acc.get(hist[i].toStage) ?? [];
        arr.push(days(hist[i].createdAt, hist[i + 1].createdAt));
        acc.set(hist[i].toStage, arr);
      }
      return {
        columns: [{ key: "stage", label: "المرحلة" }, { key: "count", label: "عدد المرات" }, { key: "avg", label: "المتوسط (يوم)" }, { key: "max", label: "الأقصى (يوم)" }],
        rows: STAGE_ORDER.filter((s) => acc.has(s)).map((s) => {
          const v = acc.get(s)!;
          return { stage: STAGE_LABELS[s], count: v.length, avg: Math.round((v.reduce((x, y) => x + y, 0) / v.length) * 10) / 10, max: Math.max(...v) };
        }),
      };
    },
  },
  staff_performance: {
    title: "أداء الموظفين", description: "عدد الإجراءات المنفذة لكل موظف ضمن النطاق والفترة، ومتوسط زمن الاستجابة للمرحلة التي نفذ فيها الإجراء.", perm: "reports.performance",
    run: async (a, p) => {
      const hist = await prisma.violationStatusHistory.findMany({ where: { violation: baseWhere(a, p) }, orderBy: [{ violationId: "asc" }, { createdAt: "asc" }], select: { violationId: true, actorId: true, createdAt: true } });
      const acc = new Map<string, { n: number; t: number[] }>();
      for (let i = 1; i < hist.length; i++) {
        const h = hist[i];
        if (h.actorId === "system") continue;
        const e = acc.get(h.actorId) ?? { n: 0, t: [] };
        e.n++;
        if (hist[i - 1].violationId === h.violationId) e.t.push(days(hist[i - 1].createdAt, h.createdAt));
        acc.set(h.actorId, e);
      }
      const names = new Map((await prisma.user.findMany({ where: { id: { in: [...acc.keys()] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
      return {
        columns: [{ key: "name", label: "الموظف" }, { key: "actions", label: "عدد الإجراءات" }, { key: "avg", label: "متوسط الزمن قبل الإجراء (يوم)" }],
        rows: [...acc.entries()].map(([id, e]) => ({ name: names.get(id) ?? id, actions: e.n, avg: e.t.length ? Math.round((e.t.reduce((x, y) => x + y, 0) / e.t.length) * 10) / 10 : 0 })).sort((x, y) => y.actions - x.actions),
        note: "يقيس هذا التقرير حجم الإجراءات وزمنها فقط، ولا يقيّم جودة القرارات.",
      };
    },
  },
  by_period: {
    title: "المخالفات حسب الفترة الزمنية", description: "عدد المخالفات المسجلة لكل شهر ضمن الفترة.",
    run: async (a, p) => {
      const rows = await prisma.violation.findMany({ where: baseWhere(a, p), select: { registeredAt: true, generalStatus: true } });
      const m = new Map<string, { total: number; closed: number }>();
      for (const r of rows) {
        if (!r.registeredAt) continue;
        const k = localDateKey(r.registeredAt, DEFAULT_TZ).slice(0, 7);
        const e = m.get(k) ?? { total: 0, closed: 0 };
        e.total++;
        if (r.generalStatus === "CLOSED") e.closed++;
        m.set(k, e);
      }
      return { columns: [{ key: "month", label: "الشهر" }, { key: "total", label: "المسجلة" }, { key: "closed", label: "أغلق منها" }], rows: [...m.entries()].sort().map(([month, e]) => ({ month, ...e })) };
    },
  },
  violation_full: {
    title: "تقرير شامل عن إجراءات مخالفة محددة", description: "جميع انتقالات المخالفة وقراراتها ومرفقاتها بالتسلسل الزمني.", needsNumber: true,
    run: async (a, p) => {
      if (!p.number) throw new AppError("يرجى إدخال رقم المخالفة");
      const v = await prisma.violation.findFirst({ where: kpiWhere(a, { number: p.number }), select: { id: true, number: true, offenderName: true } });
      if (!v) throw new AppError("المخالفة غير موجودة أو خارج نطاق صلاحياتك");
      const [hist, approvals, atts] = await Promise.all([
        prisma.violationStatusHistory.findMany({ where: { violationId: v.id }, orderBy: { createdAt: "asc" } }),
        prisma.approval.findMany({ where: { violationId: v.id }, include: { decidedBy: { select: { fullName: true } } } }),
        prisma.attachment.findMany({ where: { violationId: v.id }, include: { versions: { orderBy: { versionNo: "asc" } } } }),
      ]);
      const names = new Map((await prisma.user.findMany({ where: { id: { in: hist.map((h) => h.actorId) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
      const rows = [
        ...hist.map((h) => ({ at: h.createdAt, kind: "انتقال", detail: `${h.fromStage ? STAGE_LABELS[h.fromStage] + " ← " : ""}${STAGE_LABELS[h.toStage]}`, by: h.actorId === "system" ? "النظام" : names.get(h.actorId) ?? "", note: h.reason ?? "" })),
        ...approvals.map((x) => ({ at: x.decidedAt, kind: "قرار", detail: `${x.kind} / ${x.decision}`, by: x.decidedBy.fullName, note: x.notes ?? "" })),
        ...atts.flatMap((t) => t.versions.map((ver) => ({ at: ver.uploadedAt, kind: "مستند", detail: `${docTypeLabel(t.documentType)} (إصدار ${ver.versionNo}): ${ver.originalName}`, by: "", note: ver.reason ?? "" }))),
      ].sort((x, y) => x.at.getTime() - y.at.getTime());
      return {
        columns: [{ key: "at", label: "التاريخ والوقت" }, { key: "kind", label: "النوع" }, { key: "detail", label: "التفاصيل" }, { key: "by", label: "المنفذ" }, { key: "note", label: "الملاحظات" }],
        rows: rows.map((r) => ({ ...r, at: formatDateTime(r.at) })), note: `المخالفة ${v.number} — ${v.offenderName}`,
      };
    },
  },
  missing_documents: {
    title: "المرفقات والمستندات الناقصة", description: "الملفات المفتوحة التي ينقصها مستند إلزامي بحسب مرحلتها.",
    run: async (a, p) => {
      const rows = await prisma.violation.findMany({
        where: baseWhere(a, p, { generalStatus: "OPEN" }),
        select: {
          ...vSelect,
          attachments: { where: { withdrawnAt: null }, select: { documentType: true } },
          warnings: { select: { status: true, signedAttachmentId: true, deliveries: { select: { receivedAt: true, receiptAttachmentId: true } } } },
          criminalCase: { select: { referralAt: true, judgments: { select: { attachmentId: true } } } },
        },
      });
      const idx = (s: string) => STAGE_ORDER.indexOf(s as never);
      const out: Record<string, Cell>[] = [];
      for (const v of rows) {
        const missing: string[] = [];
        const types = new Set(v.attachments.map((x) => x.documentType));
        if (idx(v.stage) >= idx("REGISTERED") && !types.has("VIOLATION_REPORT")) missing.push("المحضر الأصلي");
        if (idx(v.stage) >= idx("AWAITING_DELIVERY") && idx(v.stage) < idx("NOT_APPROVED") && !v.warnings.some((w) => w.signedAttachmentId)) missing.push("الإنذار الموقع");
        if (idx(v.stage) >= idx("DEADLINE_RUNNING") && idx(v.stage) < idx("NOT_APPROVED") && !v.warnings.some((w) => w.deliveries.some((d) => d.receiptAttachmentId))) missing.push("وصل الاستلام");
        if (v.criminalCase && idx(v.stage) >= idx("AWAITING_JUDGMENT") && !v.criminalCase.referralAt) missing.push("مستند الإحالة");
        if (missing.length) out.push({ ...violationRow(v), missing: missing.join("، ") });
      }
      return { columns: [...VCOLS, { key: "missing", label: "الناقص" }], rows: out };
    },
  },
};

export type ReportKey = keyof typeof REPORTS;

export async function runReport(actor: Actor, key: string, params: ReportParams): Promise<ReportResult & { title: string; generatedAt: Date; generatedBy: string }> {
  const def = REPORTS[key];
  if (!def) throw new AppError("تقرير غير معروف", "NOT_FOUND");
  if (!can(actor, "reports.view")) throw forbidden();
  if (def.perm && !can(actor, def.perm)) throw forbidden("لا تملك صلاحية الاطلاع على هذا التقرير");
  const r = await def.run(actor, params);
  return { ...r, title: def.title, generatedAt: new Date(), generatedBy: actor.fullName };
}

export async function describeParams(p: ReportParams): Promise<string> {
  const parts: string[] = [];
  if (p.from || p.to) parts.push(`فترة التسجيل: ${p.from ?? "البداية"} إلى ${p.to ?? "اليوم"}`);
  if (p.governorateId) parts.push(`المحافظة: ${(await prisma.governorate.findUnique({ where: { id: p.governorateId } }))?.nameAr ?? "—"}`);
  if (p.officeId) parts.push(`الفرع: ${(await prisma.office.findUnique({ where: { id: p.officeId } }))?.nameAr ?? "—"}`);
  if (p.violationTypeId) parts.push(`نوع المخالفة: ${(await prisma.violationType.findUnique({ where: { id: p.violationTypeId } }))?.nameAr ?? "—"}`);
  if (p.number) parts.push(`رقم المخالفة: ${p.number}`);
  return parts.length ? parts.join("؛ ") : "بلا مرشحات (كل ما يقع ضمن نطاق صلاحياتك)";
}
