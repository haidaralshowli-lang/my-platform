import { z } from "zod";
import type { Attachment, AttachmentVersion, Confidentiality } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { AppError, forbidden, notFound } from "@/lib/errors";
import { writeAudit, type AuditContext } from "@/lib/audit";
import { assertCan, can, inScope, type Actor } from "@/lib/rbac/actor";
import { getSetting } from "@/lib/settings";
import { storage, storageFor, newStorageKey } from "@/lib/storage";
import { ALLOWED_TYPES, checkFile, FileRejected, safeDisplayName, scanForMalware } from "@/lib/storage/file-check";
import { applyTransition } from "@/lib/workflow";
import { VIOLATION_DOC_TYPES } from "@/lib/documents";
import { EDITABLE_STAGES } from "./violations";

export type IncomingFile = { name: string; data: Buffer };

export const attachmentMetaSchema = z.object({
  documentType: z.enum(Object.keys(VIOLATION_DOC_TYPES) as [keyof typeof VIOLATION_DOC_TYPES, ...(keyof typeof VIOLATION_DOC_TYPES)[]], {
    errorMap: () => ({ message: "نوع المستند مطلوب" }),
  }),
  description: z.string().trim().max(500).optional().transform((v) => v || null),
  letterNumber: z.string().trim().max(60).optional().transform((v) => v || null),
  letterDate: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null)),
  confidentiality: z.enum(["NORMAL", "RESTRICTED", "CONFIDENTIAL"]).default("NORMAL"),
  additionReason: z.string().trim().max(500).optional().transform((v) => v || null),
});

export type AttachmentMeta = z.infer<typeof attachmentMetaSchema>;

const MAX_FILES_PER_UPLOAD = 20;

async function validateAll(files: IncomingFile[]) {
  const maxMb = await getSetting(prisma, "attachments.maxSizeMb");
  const checked = [];
  for (const f of files) {
    try {
      checked.push({ file: f, info: await checkFile(f.name, f.data, maxMb * 1024 * 1024) });
    } catch (e) {
      if (e instanceof FileRejected) throw new AppError(e.message);
      throw e;
    }
  }
  return checked;
}

async function storeChecked(data: Buffer, mime: string, actor: Actor, ctx?: AuditContext, prefix = "violations") {
  const scan = await scanForMalware(data);
  if (scan === "INFECTED") {
    await prisma.$transaction((tx) => writeAudit(tx, { actor, action: "attachment.rejected_malware", entityType: "Attachment", ctx }));
    throw new AppError("رُفض الملف لاحتوائه على برمجية خبيثة");
  }
  const key = newStorageKey(prefix);
  await storage().put(key, data, mime);
  return { key, scan };
}

export type StoredFile = { file: IncomingFile; info: Awaited<ReturnType<typeof checkFile>>; key: string; scan: "CLEAN" | "NOT_SCANNED" | "PENDING" };

/// يتحقق من الملفات ويخزنها (قبل معاملة قاعدة البيانات)
export async function prepareFiles(files: IncomingFile[], actor: Actor, ctx?: AuditContext, prefix = "violations"): Promise<StoredFile[]> {
  if (files.length === 0) throw new AppError("يرجى اختيار ملف واحد على الأقل");
  if (files.length > MAX_FILES_PER_UPLOAD) throw new AppError(`الحد الأقصى ${MAX_FILES_PER_UPLOAD} ملفاً في المرة الواحدة`);
  const checked = await validateAll(files);
  const out: StoredFile[] = [];
  for (const c of checked) {
    const { key, scan } = await storeChecked(c.file.data, c.info.mimeType, actor, ctx, prefix);
    out.push({ ...c, key, scan: scan as StoredFile["scan"] });
  }
  return out;
}

export type AttachmentBase = {
  violationId: string | null;
  ownerType: string;
  ownerId: string;
  documentType: string;
  description?: string | null;
  letterNumber?: string | null;
  letterDate?: Date | null;
  confidentiality?: Confidentiality;
  additionReason?: string | null;
  approvalStatus: "DRAFT" | "APPROVED";
};

/// ينشئ سجلات المرفقات وإصدارها الأول داخل المعاملة ويكتب قيد التدقيق
export async function insertAttachments(tx: Tx, actor: Actor, stored: StoredFile[], base: AttachmentBase, ctx?: AuditContext): Promise<string[]> {
  const ids: string[] = [];
  for (const s of stored) {
    const a = await tx.attachment.create({
      data: {
        violationId: base.violationId,
        ownerType: base.ownerType,
        ownerId: base.ownerId,
        documentType: base.documentType,
        description: base.description ?? null,
        letterNumber: base.letterNumber ?? null,
        letterDate: base.letterDate ?? null,
        confidentiality: base.confidentiality ?? "NORMAL",
        approvalStatus: base.approvalStatus,
        additionReason: base.additionReason ?? null,
        createdById: actor.id,
        versions: {
          create: {
            versionNo: 1,
            originalName: safeDisplayName(s.file.name),
            storageProvider: storage().provider,
            storageKey: s.key,
            mimeType: s.info.mimeType,
            sizeBytes: s.info.sizeBytes,
            sha256: s.info.sha256,
            scanStatus: s.scan,
            uploadedById: actor.id,
          },
        },
      },
    });
    ids.push(a.id);
    await writeAudit(tx, {
      actor,
      action: "attachment.uploaded",
      entityType: "Attachment",
      entityId: a.id,
      after: {
        violationId: base.violationId, ownerType: base.ownerType, ownerId: base.ownerId, documentType: base.documentType,
        name: safeDisplayName(s.file.name), sha256: s.info.sha256, sizeBytes: s.info.sizeBytes, confidentiality: base.confidentiality ?? "NORMAL",
      },
      reason: base.additionReason ?? null,
      ctx,
    });
  }
  return ids;
}

/// رفع مرفقات لمخالفة. لا يُقبل إلا النوع الحقيقي المسموح، ويُحفظ المحتوى خارج المجلد العام بمفتاح يولده النظام.
export async function uploadViolationAttachments(actor: Actor, violationId: string, files: IncomingFile[], meta: AttachmentMeta, ctx?: AuditContext): Promise<string[]> {
  assertCan(actor, "attachment.upload");
  if (files.length === 0) throw new AppError("يرجى اختيار ملف واحد على الأقل");
  const v = await prisma.violation.findUnique({ where: { id: violationId } });
  if (!v || !inScope(actor, v)) throw notFound();
  if (v.generalStatus === "CLOSED") throw new AppError("لا تُضاف مرفقات إلى مخالفة مغلقة إلا بعد إعادة فتحها");
  if (meta.confidentiality !== "NORMAL" && !can(actor, "attachment.view_confidential")) {
    throw forbidden("لا تملك صلاحية تصنيف مستند بمستوى سرية أعلى من العادي");
  }
  // بعد الإحالة للمصادقة تُعد المرفقات تكميلية ويجب بيان سبب إضافتها
  const supplementary = !EDITABLE_STAGES.includes(v.stage);
  if (supplementary && !meta.additionReason) throw new AppError("يجب بيان سبب إضافة المرفقات التكميلية في هذه المرحلة");
  const maxFiles = await getSetting(prisma, "attachments.maxFilesPerViolation");
  const existing = await prisma.attachment.count({ where: { violationId } });
  if (existing + files.length > maxFiles) throw new AppError(`تجاوز الحد الأقصى لعدد المرفقات لهذه المخالفة (${maxFiles})`);

  const stored = await prepareFiles(files, actor, ctx);
  return prisma.$transaction(async (tx) => {
    const ids = await insertAttachments(tx, actor, stored, {
      violationId, ownerType: "Violation", ownerId: violationId, ...meta, approvalStatus: "DRAFT",
    }, ctx);
    if (meta.documentType === "VIOLATION_REPORT" && v.stage === "AWAITING_REPORT") {
      await applyTransition(tx, actor, violationId, "report_attached", { system: true, ctx });
    }
    return ids;
  });
}

/// إصدار جديد لمرفق: يبقى الإصدار السابق محفوظاً ولا يُستبدل بصمت، ويجب بيان السبب
export async function addAttachmentVersion(actor: Actor, attachmentId: string, file: IncomingFile, reason: string, ctx?: AuditContext): Promise<void> {
  assertCan(actor, "attachment.upload");
  if (!reason.trim()) throw new AppError("يجب بيان سبب إضافة إصدار جديد");
  const a = await prisma.attachment.findUnique({ where: { id: attachmentId }, include: { violation: true } });
  if (!a || !a.violation || !inScope(actor, a.violation)) throw notFound();
  if (a.withdrawnAt) throw new AppError("لا يضاف إصدار إلى مرفق مسحوب");
  if (a.violation.generalStatus === "CLOSED") throw new AppError("المخالفة مغلقة");
  if (a.confidentiality !== "NORMAL" && !can(actor, "attachment.view_confidential")) throw notFound();
  const [c] = await validateAll([file]);
  const { key, scan } = await storeChecked(file.data, c.info.mimeType, actor, ctx);
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ currentVersionNo: number }[]>`SELECT "currentVersionNo" FROM "Attachment" WHERE id = ${attachmentId} FOR UPDATE`;
    const next = rows[0].currentVersionNo + 1;
    await tx.attachmentVersion.create({
      data: {
        attachmentId, versionNo: next, originalName: safeDisplayName(file.name), storageProvider: storage().provider, storageKey: key,
        mimeType: c.info.mimeType, sizeBytes: c.info.sizeBytes, sha256: c.info.sha256, scanStatus: scan, reason: reason.trim(), uploadedById: actor.id,
      },
    });
    await tx.attachment.update({ where: { id: attachmentId }, data: { currentVersionNo: next } });
    await writeAudit(tx, {
      actor,
      action: a.approvalStatus === "APPROVED" ? "attachment.approved_version_replaced" : "attachment.version_added",
      entityType: "Attachment",
      entityId: attachmentId,
      before: { versionNo: next - 1 },
      after: { versionNo: next, sha256: c.info.sha256, name: safeDisplayName(file.name) },
      reason: reason.trim(),
      ctx,
    });
  });
}

/// سحب مرفق: لا حذف فعلي. المرفق المعتمد لا يُسحب إلا بصلاحية المسار الرسمي.
export async function withdrawAttachment(actor: Actor, attachmentId: string, reason: string, ctx?: AuditContext): Promise<void> {
  if (!reason.trim()) throw new AppError("يجب بيان سبب السحب");
  const a = await prisma.attachment.findUnique({ where: { id: attachmentId }, include: { violation: true } });
  if (!a || !a.violation || !inScope(actor, a.violation)) throw notFound();
  if (a.withdrawnAt) throw new AppError("المرفق مسحوب مسبقاً");
  if (a.approvalStatus === "APPROVED") {
    assertCan(actor, "attachment.withdraw", "المرفق معتمد ولا يُسحب إلا بصلاحية السحب الرسمي");
  } else if (a.createdById !== actor.id && !can(actor, "attachment.withdraw")) {
    throw forbidden("لا يسحب المرفق غير المعتمد إلا رافعه أو صاحب صلاحية السحب");
  }
  await prisma.$transaction(async (tx) => {
    await tx.attachment.update({ where: { id: attachmentId }, data: { withdrawnAt: new Date(), withdrawnReason: reason.trim(), approvalStatus: "WITHDRAWN" } });
    await writeAudit(tx, { actor, action: "attachment.withdrawn", entityType: "Attachment", entityId: attachmentId, before: { approvalStatus: a.approvalStatus }, reason: reason.trim(), ctx });
  });
}

export function canSeeConfidentiality(actor: Actor, c: Confidentiality): boolean {
  return c === "NORMAL" || can(actor, "attachment.view_confidential");
}

/// قراءة محتوى إصدار مرفق بعد التحقق من النطاق والسرية. يسجل تنزيل المستندات الحساسة في سجل التدقيق.
export async function readAttachmentVersion(actor: Actor, versionId: string, ctx?: AuditContext): Promise<{ version: AttachmentVersion; attachment: Attachment; data: Buffer; inline: boolean }> {
  const version = await prisma.attachmentVersion.findUnique({ where: { id: versionId }, include: { attachment: { include: { violation: true } } } });
  if (!version) throw notFound();
  const { attachment } = version;
  if (attachment.violation) {
    if (!inScope(actor, attachment.violation)) throw notFound();
    if (attachment.violation.stage === "DRAFT" && attachment.violation.createdById !== actor.id && !can(actor, "violation.edit")) throw notFound();
  } else if (attachment.ownerType === "LegalDocumentVersion") {
    // ملفات المكتبة القانونية: مرجعية عامة داخل الهيئة لمن يملك صلاحية الاطلاع على المكتبة
    if (!can(actor, "legal_library.view")) throw notFound();
  } else {
    throw notFound();
  }
  if (!canSeeConfidentiality(actor, attachment.confidentiality)) throw notFound();
  if (version.scanStatus === "INFECTED") throw new AppError("الملف محجوب لاحتوائه على برمجية خبيثة");
  const data = await storageFor(version.storageProvider).get(version.storageKey);
  if (attachment.confidentiality !== "NORMAL") {
    await prisma.$transaction((tx) =>
      writeAudit(tx, { actor, action: "attachment.downloaded", entityType: "Attachment", entityId: attachment.id, after: { versionId, versionNo: version.versionNo, confidentiality: attachment.confidentiality }, ctx }),
    );
  }
  const { attachment: _a, ...plainVersion } = version;
  void _a;
  return { version: plainVersion, attachment, data, inline: ALLOWED_TYPES[version.mimeType]?.inline ?? false };
}

export async function listViolationAttachments(actor: Actor, violationId: string) {
  const rows = await prisma.attachment.findMany({
    where: { violationId },
    orderBy: [{ createdAt: "asc" }],
    include: { versions: { orderBy: { versionNo: "desc" } } },
  });
  return rows.map((a) => ({ ...a, hidden: !canSeeConfidentiality(actor, a.confidentiality) }));
}
