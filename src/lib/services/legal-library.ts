import { z } from "zod";
import type { LegalRefPurpose, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError, forbidden, notFound } from "@/lib/errors";
import { writeAudit, type AuditContext } from "@/lib/audit";
import { assertCan, can, inScope, type Actor } from "@/lib/rbac/actor";
import type { PermissionCode } from "@/lib/rbac/catalog";
import { insertAttachments, prepareFiles, type IncomingFile } from "./attachments";
import { EDITABLE_STAGES } from "./violations";

const dateOpt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null));

export const legalDocSchema = z.object({
  title: z.string().trim().min(3, "عنوان الوثيقة مطلوب").max(300),
  docType: z.enum(["LAW", "REGULATION", "INSTRUCTION", "DECISION", "CIRCULAR", "TECHNICAL_STANDARD", "OTHER"]),
  number: z.string().trim().max(60).optional().transform((v) => v || null),
  issuedAt: dateOpt,
  issuer: z.string().trim().max(200).optional().transform((v) => v || null),
  effectiveAt: dateOpt,
  description: z.string().trim().max(3000).optional().transform((v) => v || null),
  keywords: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(/[،,]/).map((k) => k.trim()).filter(Boolean).slice(0, 30) : [])),
  previousDocumentId: z.string().optional().transform((v) => v || null),
});

export type LegalDocInput = z.infer<typeof legalDocSchema>;

export const articleSchema = z.object({
  articleNumber: z.string().trim().min(1, "رقم المادة مطلوب").max(30),
  paragraph: z.string().trim().max(30).optional().transform((v) => v || null),
  text: z.string().trim().min(3, "نص المادة مطلوب").max(20000),
});

/// إنشاء وثيقة مرجعية مع إصدارها الأول. الوثيقة تُنشأ بحالة «مسودة» ولا تُعد نافذة لمجرد رفعها.
export async function createLegalDocument(
  actor: Actor,
  input: LegalDocInput,
  version: { notes?: string | null; extractedText?: string | null; files: IncomingFile[] },
  ctx?: AuditContext,
): Promise<string> {
  assertCan(actor, "legal_library.manage");
  if (input.previousDocumentId && !(await prisma.legalDocument.findUnique({ where: { id: input.previousDocumentId } }))) {
    throw new AppError("الوثيقة السابقة المرتبطة غير موجودة");
  }
  const stored = version.files.length ? await prepareFiles(version.files, actor, ctx, "legal") : [];
  return prisma.$transaction(async (tx) => {
    const doc = await tx.legalDocument.create({ data: { ...input, status: "DRAFT", createdById: actor.id } });
    const v = await tx.legalDocumentVersion.create({
      data: { documentId: doc.id, versionNo: 1, notes: version.notes ?? null, extractedText: version.extractedText ?? null, createdById: actor.id },
    });
    if (stored.length) {
      await insertAttachments(tx, actor, stored, { violationId: null, ownerType: "LegalDocumentVersion", ownerId: v.id, documentType: "LEGAL_DOCUMENT", approvalStatus: "APPROVED" }, ctx);
    }
    await writeAudit(tx, { actor, action: "legal_doc.created", entityType: "LegalDocument", entityId: doc.id, after: input, ctx });
    return doc.id;
  });
}

/// إصدار جديد للوثيقة: الإصدارات السابقة تبقى بموادها، والمخالفات المرتبطة بها لا تنتقل تلقائياً للإصدار الجديد
export async function addLegalDocumentVersion(
  actor: Actor,
  documentId: string,
  version: { notes: string; extractedText?: string | null; files: IncomingFile[] },
  ctx?: AuditContext,
): Promise<string> {
  assertCan(actor, "legal_library.manage");
  if (!version.notes.trim()) throw new AppError("يجب بيان سبب أو وصف الإصدار الجديد");
  const stored = version.files.length ? await prepareFiles(version.files, actor, ctx, "legal") : [];
  return prisma.$transaction(async (tx) => {
    const last = await tx.legalDocumentVersion.findFirst({ where: { documentId }, orderBy: { versionNo: "desc" } });
    if (!last) throw notFound();
    const v = await tx.legalDocumentVersion.create({
      data: { documentId, versionNo: last.versionNo + 1, notes: version.notes.trim(), extractedText: version.extractedText ?? null, createdById: actor.id },
    });
    if (stored.length) {
      await insertAttachments(tx, actor, stored, { violationId: null, ownerType: "LegalDocumentVersion", ownerId: v.id, documentType: "LEGAL_DOCUMENT", approvalStatus: "APPROVED" }, ctx);
    }
    await writeAudit(tx, { actor, action: "legal_doc.version_added", entityType: "LegalDocument", entityId: documentId, after: { versionNo: v.versionNo }, reason: version.notes, ctx });
    return v.id;
  });
}

export async function setLegalDocumentStatus(actor: Actor, documentId: string, status: "DRAFT" | "IN_FORCE" | "AMENDED" | "REPEALED" | "ARCHIVED", reason: string, ctx?: AuditContext) {
  assertCan(actor, "legal_library.manage");
  if (!reason.trim()) throw new AppError("يجب بيان سند تغيير حالة الوثيقة");
  await prisma.$transaction(async (tx) => {
    const d = await tx.legalDocument.findUnique({ where: { id: documentId } });
    if (!d) throw notFound();
    await tx.legalDocument.update({ where: { id: documentId }, data: { status } });
    await writeAudit(tx, { actor, action: "legal_doc.status_changed", entityType: "LegalDocument", entityId: documentId, before: { status: d.status }, after: { status }, reason, ctx });
  });
}

export async function addArticle(actor: Actor, versionId: string, input: z.infer<typeof articleSchema>, ctx?: AuditContext): Promise<string> {
  assertCan(actor, "legal_library.manage");
  return prisma.$transaction(async (tx) => {
    const v = await tx.legalDocumentVersion.findUnique({ where: { id: versionId } });
    if (!v) throw notFound();
    const count = await tx.legalArticle.count({ where: { documentVersionId: versionId } });
    const a = await tx.legalArticle.create({ data: { documentVersionId: versionId, ...input, sortOrder: count } });
    await writeAudit(tx, { actor, action: "legal_doc.article_added", entityType: "LegalDocument", entityId: v.documentId, after: { versionId, ...input }, ctx });
    return a.id;
  });
}

export async function searchLegalDocuments(actor: Actor, q: string, page = 1) {
  assertCan(actor, "legal_library.view");
  const term = q.trim().slice(0, 120);
  const where: Prisma.LegalDocumentWhereInput = term
    ? {
        OR: [
          { title: { contains: term, mode: "insensitive" } },
          { number: { contains: term, mode: "insensitive" } },
          { keywords: { has: term } },
          { description: { contains: term, mode: "insensitive" } },
          { versions: { some: { OR: [{ extractedText: { contains: term, mode: "insensitive" } }, { articles: { some: { text: { contains: term, mode: "insensitive" } } } }] } } },
        ],
      }
    : {};
  const [total, rows] = await Promise.all([
    prisma.legalDocument.count({ where }),
    prisma.legalDocument.findMany({ where, orderBy: [{ issuedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }], skip: (page - 1) * 20, take: 20, include: { _count: { select: { versions: true } } } }),
  ]);
  return { total, rows, pages: Math.max(1, Math.ceil(total / 20)) };
}

/// بحث في المواد المفهرسة لربطها بمخالفة؛ يُظهر حالة الوثيقة والإصدار
export async function searchArticles(actor: Actor, q: string) {
  assertCan(actor, "legal_library.view");
  const term = q.trim().slice(0, 120);
  if (term.length < 1) return [];
  return prisma.legalArticle.findMany({
    where: {
      OR: [
        { text: { contains: term, mode: "insensitive" } },
        { articleNumber: term },
        { documentVersion: { document: { OR: [{ title: { contains: term, mode: "insensitive" } }, { number: { contains: term, mode: "insensitive" } }] } } },
      ],
    },
    take: 30,
    orderBy: [{ documentVersion: { document: { title: "asc" } } }, { sortOrder: "asc" }],
    include: { documentVersion: { include: { document: true } } },
  });
}

// ─── ربط المخالفة بالمواد ───

/// شروط الربط حسب الغرض: الصلاحية المطلوبة والمراحل التي يجوز فيها الربط أو الإزالة
const PURPOSE_RULES: Record<LegalRefPurpose, { perm: PermissionCode; stages: string[] }> = {
  POTENTIAL: { perm: "violation.edit", stages: EDITABLE_STAGES },
  TECHNICAL: { perm: "technical.prepare", stages: ["AWAITING_TECHNICAL"] },
  LEGAL: { perm: "legal.prepare", stages: ["AWAITING_LEGAL"] },
  WARNING: { perm: "legal.prepare", stages: ["AWAITING_LEGAL", "WARNING_PREPARATION"] },
};

async function loadForRef(actor: Actor, violationId: string, purpose: LegalRefPurpose) {
  const v = await prisma.violation.findUnique({ where: { id: violationId } });
  if (!v || !inScope(actor, v)) throw notFound();
  const rule = PURPOSE_RULES[purpose];
  if (!can(actor, rule.perm)) throw forbidden();
  if (!rule.stages.includes(v.stage)) throw new AppError("لا يجوز تعديل هذا النوع من السند القانوني في المرحلة الحالية");
  return v;
}

export async function linkArticle(actor: Actor, violationId: string, articleId: string, purpose: LegalRefPurpose, note: string | null, ctx?: AuditContext) {
  await loadForRef(actor, violationId, purpose);
  const article = await prisma.legalArticle.findUnique({ where: { id: articleId }, include: { documentVersion: { include: { document: true } } } });
  if (!article) throw notFound("المادة غير موجودة");
  const doc = article.documentVersion.document;
  if (doc.status === "DRAFT" || doc.status === "ARCHIVED") throw new AppError("لا يجوز الاستناد إلى وثيقة غير معتمدة أو مؤرشفة");
  await prisma.$transaction(async (tx) => {
    const ref = await tx.violationLegalReference.create({ data: { violationId, articleId, purpose, note: note?.trim() || null, addedById: actor.id } });
    await writeAudit(tx, {
      actor,
      action: "violation.legal_ref_linked",
      entityType: "Violation",
      entityId: violationId,
      after: { refId: ref.id, purpose, document: doc.title, documentStatus: doc.status, versionNo: article.documentVersion.versionNo, article: article.articleNumber, paragraph: article.paragraph },
      ctx,
    });
  });
}

export async function unlinkArticle(actor: Actor, refId: string, reason: string, ctx?: AuditContext) {
  const ref = await prisma.violationLegalReference.findUnique({ where: { id: refId } });
  if (!ref) throw notFound();
  await loadForRef(actor, ref.violationId, ref.purpose);
  if (!reason.trim()) throw new AppError("يجب بيان سبب إزالة السند");
  await prisma.$transaction(async (tx) => {
    await tx.violationLegalReference.delete({ where: { id: refId } });
    await writeAudit(tx, { actor, action: "violation.legal_ref_unlinked", entityType: "Violation", entityId: ref.violationId, before: { refId, articleId: ref.articleId, purpose: ref.purpose }, reason, ctx });
  });
}

export async function violationLegalRefs(violationId: string) {
  return prisma.violationLegalReference.findMany({
    where: { violationId },
    orderBy: { createdAt: "asc" },
    include: { article: { include: { documentVersion: { include: { document: true } } } } },
  });
}

export const PURPOSE_PERMISSION = Object.fromEntries(Object.entries(PURPOSE_RULES).map(([k, v]) => [k, v])) as typeof PURPOSE_RULES;
