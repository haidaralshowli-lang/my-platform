import { Prisma, type ViolationStage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { can, violationScopeWhere, type Actor } from "@/lib/rbac/actor";
import { DEFAULT_TZ, zonedParts } from "@/lib/datetime";
import { OUTCOME_LABELS, STAGE_LABELS, STAGE_ORDER, STATUS_LABELS } from "@/lib/workflow/labels";
import { STAGE_OWNER } from "./deadlines";
import type { Datum } from "@/components/charts";

/// شرط المخالفات المحتسبة في المؤشرات: ضمن النطاق، مسجلة رسمياً، غير تجريبية
export function kpiWhere(actor: Actor, extra: Prisma.ViolationWhereInput = {}): Prisma.ViolationWhereInput {
  return { AND: [violationScopeWhere(actor), { isDemo: false, archivedAt: null, stage: { not: "DRAFT" } }, extra] };
}

export async function dashboardKpis(actor: Actor) {
  const w = (extra: Prisma.ViolationWhereInput = {}) => kpiWhere(actor, extra);
  const count = (extra: Prisma.ViolationWhereInput) => prisma.violation.count({ where: w(extra) });
  const [
    total, open, closed, awaitingApproval, awaitingTechnical, awaitingLegal, warningsIssued, notProven, running, expired,
    openCases, awaitingJudgment, awaitingVerification, pendingExtensions, pendingObjections,
  ] = await Promise.all([
    count({}), count({ generalStatus: "OPEN" }), count({ generalStatus: "CLOSED" }),
    count({ stage: { in: ["AWAITING_FINAL_APPROVAL", "AWAITING_WARNING_APPROVAL"] } }),
    count({ stage: "AWAITING_TECHNICAL" }), count({ stage: "AWAITING_LEGAL" }),
    prisma.warning.count({ where: { status: { in: ["SIGNED", "SENT", "DELIVERED"] }, violation: w() } }),
    count({ stage: { in: ["AWAITING_DELIVERY", "AWAITING_RECEIPT_PROOF"] } }),
    count({ stage: "DEADLINE_RUNNING" }), count({ stage: "DEADLINE_EXPIRED" }),
    prisma.criminalCase.count({ where: { status: { not: "CLOSED" }, violation: w() } }),
    count({ stage: "AWAITING_JUDGMENT" }), count({ stage: "AWAITING_RESPONSE_VERIFICATION" }),
    prisma.extensionRequest.count({ where: { status: "PENDING", violation: w() } }),
    prisma.objection.count({ where: { status: "PENDING", violation: w() } }),
  ]);
  let financial: { due: Prisma.Decimal; paid: Prisma.Decimal } | null = null;
  if (can(actor, "financial.view")) {
    const [due, paid] = await Promise.all([
      prisma.financialResponse.aggregate({ _sum: { amountDue: true }, where: { response: { violation: w() } } }),
      prisma.payment.aggregate({ _sum: { amount: true }, where: { financialResponse: { response: { violation: w() } } } }),
    ]);
    financial = { due: due._sum.amountDue ?? new Prisma.Decimal(0), paid: paid._sum.amount ?? new Prisma.Decimal(0) };
  }
  return {
    total, open, closed, awaitingApproval, awaitingTechnical, awaitingLegal, warningsIssued, notProven, running, expired,
    openCases, awaitingJudgment, awaitingVerification, pendingExtensions, pendingObjections, financial,
  };
}

const AR_MONTHS = ["كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول"];

export async function dashboardCharts(actor: Actor) {
  const where = kpiWhere(actor);
  const [byGov, byType, byStage, byStatus, byOutcome, govs, types, responses] = await Promise.all([
    prisma.violation.groupBy({ by: ["governorateId"], where, _count: true }),
    prisma.violation.groupBy({ by: ["violationTypeId"], where, _count: true }),
    prisma.violation.groupBy({ by: ["stage"], where, _count: true }),
    prisma.violation.groupBy({ by: ["generalStatus"], where, _count: true }),
    prisma.violation.groupBy({ by: ["outcome"], where: kpiWhere(actor, { generalStatus: "CLOSED" }), _count: true }),
    prisma.governorate.findMany({ select: { id: true, nameAr: true } }),
    prisma.violationType.findMany({ select: { id: true, nameAr: true } }),
    prisma.response.groupBy({ by: ["kind"], where: { violation: where }, _count: true }),
  ]);
  const govName = new Map(govs.map((g) => [g.id, g.nameAr]));
  const typeName = new Map(types.map((t) => [t.id, t.nameAr]));

  // آخر 12 شهراً بتوقيت بغداد
  const now = zonedParts(new Date(), DEFAULT_TZ);
  const months: { key: string; label: string }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.year, now.month - 1 - i, 1));
    months.push({ key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, label: `${AR_MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}` });
  }
  const since = new Date(Date.UTC(now.year, now.month - 12, 1));
  const regs = await prisma.violation.findMany({ where: kpiWhere(actor, { registeredAt: { gte: since } }), select: { registeredAt: true } });
  const perMonth = new Map<string, number>();
  for (const r of regs) {
    const p = zonedParts(r.registeredAt!, DEFAULT_TZ);
    const k = `${p.year}-${String(p.month).padStart(2, "0")}`;
    perMonth.set(k, (perMonth.get(k) ?? 0) + 1);
  }
  const KIND = { FINANCIAL: "مالية", TECHNICAL: "فنية", LEGAL: "قانونية" } as const;
  const d = (key: string, label: string, value: number, href?: string): Datum => ({ key, label, value, href });
  return {
    governorate: byGov.map((g) => d(g.governorateId, govName.get(g.governorateId) ?? "—", g._count, `/violations?governorateId=${g.governorateId}`)),
    type: byType.map((t) => d(t.violationTypeId ?? "none", t.violationTypeId ? typeName.get(t.violationTypeId) ?? "—" : "غير محدد", t._count, t.violationTypeId ? `/violations?violationTypeId=${t.violationTypeId}` : undefined)),
    stage: byStage.sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage)).map((s) => d(s.stage, STAGE_LABELS[s.stage], s._count, `/violations?stage=${s.stage}`)),
    status: byStatus.map((s) => d(s.generalStatus, STATUS_LABELS[s.generalStatus], s._count, `/violations?status=${s.generalStatus}`)),
    month: months.map((m) => d(m.key, m.label, perMonth.get(m.key) ?? 0)),
    responseKind: responses.map((r) => d(r.kind, KIND[r.kind], r._count)),
    outcome: byOutcome.map((o) => d(o.outcome ?? "none", o.outcome ? OUTCOME_LABELS[o.outcome] : "غير محدد", o._count)),
  };
}

/// قائمة المهام الشخصية: المراحل التي ينتظر فيها الإجراء التالي صلاحيةً يملكها المستخدم، ضمن نطاقه
export async function myTasks(actor: Actor) {
  const stages = (Object.entries(STAGE_OWNER) as [ViolationStage, string[]][])
    .filter(([, perms]) => perms.some((p) => actor.permissions.has(p)))
    .map(([s]) => s);
  if (stages.length === 0) return { total: 0, items: [] as { id: string; number: string | null; offenderName: string; stage: ViolationStage; since: Date }[] };
  const where = { AND: [violationScopeWhere(actor), { stage: { in: stages }, archivedAt: null, generalStatus: "OPEN" as const }] };
  const [total, rows] = await Promise.all([
    prisma.violation.count({ where }),
    prisma.violation.findMany({
      where, take: 10, orderBy: [{ priority: "desc" }, { updatedAt: "asc" }],
      select: { id: true, number: true, offenderName: true, stage: true, updatedAt: true },
    }),
  ]);
  return { total, items: rows.map((r) => ({ ...r, since: r.updatedAt })) };
}
