import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  archiveDraft, createDraft, getViolationForActor, registerViolation, searchSchema, searchViolations, submitForApproval, updateViolation, violationInputSchema,
} from "@/lib/services/violations";
import { addAttachmentVersion, readAttachmentVersion, uploadViolationAttachments, withdrawAttachment, attachmentMetaSchema } from "@/lib/services/attachments";
import { applyTransition } from "@/lib/workflow";
import { SAMPLE_EXE, SAMPLE_PDF, SAMPLE_PNG, completeInput, makeOffice, makeUser } from "./helpers";

const meta = (o: Record<string, unknown> = {}) => attachmentMetaSchema.parse({ documentType: "VIOLATION_REPORT", ...o });

describe("تسجيل المخالفة", () => {
  it("المسودة تحفظ دون رقم رسمي ثم تُسجَّل برقم فريد وتنتظر المحضر", async () => {
    const { actor } = await makeUser(["REGISTRAR"]);
    const draft = await createDraft(actor, await completeInput());
    expect(draft.stage).toBe("DRAFT");
    expect(draft.number).toBeNull();
    const reg = await registerViolation(actor, draft.id, draft.version);
    expect(reg.number).toMatch(/^م-\d{4}-\d{6}$/);
    expect(reg.stage).toBe("AWAITING_REPORT");
    expect(reg.registeredAt).not.toBeNull();
    const hist = await prisma.violationStatusHistory.findMany({ where: { violationId: draft.id }, orderBy: { createdAt: "asc" } });
    expect(hist.map((h) => h.toStage)).toEqual(["DRAFT", "REGISTERED", "AWAITING_REPORT"]);
  });

  it("لا يُسجَّل مسودة ناقصة الحقول الإلزامية", async () => {
    const { actor } = await makeUser(["REGISTRAR"]);
    const draft = await createDraft(actor, await completeInput({ violationTypeId: "", description: "" }));
    await expect(registerViolation(actor, draft.id, draft.version)).rejects.toThrow(/نوع المخالفة.*وصف المخالفة/);
  });

  it("رفض تاريخ اكتشاف في المستقبل", () => {
    const r = violationInputSchema.safeParse({ governorateId: "x", officeId: "y", offenderName: "جهة", discoveredAt: "2999-01-01" });
    expect(r.success).toBe(false);
  });

  it("الحماية من التعديل المتزامن", async () => {
    const { actor } = await makeUser(["REGISTRAR"]);
    const d = await createDraft(actor, await completeInput());
    await updateViolation(actor, d.id, await completeInput({ offenderName: "اسم معدل أول" }), d.version, null);
    await expect(updateViolation(actor, d.id, await completeInput({ offenderName: "اسم معدل ثانٍ" }), d.version, null)).rejects.toThrow(/مستخدم آخر/);
  });

  it("التعديل بعد التسجيل يتطلب سبباً ويُسجَّل الفرق في التدقيق", async () => {
    const { actor } = await makeUser(["REGISTRAR"]);
    const d = await createDraft(actor, await completeInput());
    const r = await registerViolation(actor, d.id, d.version);
    await expect(updateViolation(actor, d.id, await completeInput({ offenderName: "جهة مصححة" }), r.version, null)).rejects.toThrow(/سبب/);
    await updateViolation(actor, d.id, await completeInput({ offenderName: "جهة مصححة" }), r.version, "تصحيح الاسم وفق الإجازة");
    const log = await prisma.auditLog.findFirst({ where: { action: "violation.updated", entityId: d.id } });
    expect(log?.before).toEqual({ offenderName: "قناة اختبار الفضائية" });
    expect(log?.after).toEqual({ offenderName: "جهة مصححة" });
    expect(log?.reason).toBe("تصحيح الاسم وفق الإجازة");
  });

  it("لا يمكن الإحالة للمصادقة دون محضر، ورفع المحضر ينقل المرحلة، والإحالة تعتمد المرفقات", async () => {
    const { actor } = await makeUser(["REGISTRAR"]);
    const d = await createDraft(actor, await completeInput());
    let v = await registerViolation(actor, d.id, d.version);
    await expect(submitForApproval(actor, d.id, v.version)).rejects.toThrow(/لا يمكن تنفيذ/);
    await uploadViolationAttachments(actor, d.id, [{ name: "محضر.pdf", data: SAMPLE_PDF }], meta());
    v = await prisma.violation.findUniqueOrThrow({ where: { id: d.id } });
    expect(v.stage).toBe("REGISTERED");
    v = await submitForApproval(actor, d.id, v.version);
    expect(v.stage).toBe("AWAITING_FINAL_APPROVAL");
    const a = await prisma.attachment.findFirstOrThrow({ where: { violationId: d.id } });
    expect(a.approvalStatus).toBe("APPROVED");
    // لا تعديل بعد الإحالة
    await expect(updateViolation(actor, d.id, await completeInput(), v.version, "سبب")).rejects.toThrow(/بعد إحالتها/);
  });

  it("الانتقال العشوائي والانتقال النظامي اليدوي ممنوعان", async () => {
    const { actor } = await makeUser(["REGISTRAR"]);
    const d = await createDraft(actor, await completeInput());
    await expect(prisma.$transaction((tx) => applyTransition(tx, actor, d.id, "submit_for_approval"))).rejects.toThrow(/لا يمكن تنفيذ/);
    await expect(prisma.$transaction((tx) => applyTransition(tx, actor, d.id, "report_attached"))).rejects.toThrow(/نظامي/);
    await expect(prisma.$transaction((tx) => applyTransition(tx, actor, d.id, "no_such_action"))).rejects.toThrow(/غير معروف/);
  });

  it("أرشفة المسودة منطقية ولا تحذفها، ولا تُؤرشف مخالفة مسجلة", async () => {
    const { actor } = await makeUser(["REGISTRAR"]);
    const d = await createDraft(actor, await completeInput());
    await archiveDraft(actor, d.id, "إدخال مكرر");
    expect((await prisma.violation.findUniqueOrThrow({ where: { id: d.id } })).archivedAt).not.toBeNull();
    const d2 = await createDraft(actor, await completeInput());
    await registerViolation(actor, d2.id, d2.version);
    await expect(archiveDraft(actor, d2.id, "x")).rejects.toThrow(/المسودات/);
  });
});

describe("نطاق الاطلاع والبحث", () => {
  it("موظف مكتب آخر لا يرى المخالفة ولا يجدها في البحث ولا يرفع إليها", async () => {
    const other = await makeOffice("T-NJF", "NJF");
    const { actor: owner } = await makeUser(["REGISTRAR"]);
    const { actor: outsider } = await makeUser(["REGISTRAR"], { officeCode: other.code });
    const d = await createDraft(owner, await completeInput({ offenderName: "جهة سرية النطاق" }));
    await registerViolation(owner, d.id, d.version);
    await expect(getViolationForActor(outsider, d.id)).rejects.toThrow(/غير موجود/);
    const res = await searchViolations(outsider, searchSchema.parse({ q: "جهة سرية النطاق" }));
    expect(res.total).toBe(0);
    const mine = await searchViolations(owner, searchSchema.parse({ q: "جهة سرية النطاق" }));
    expect(mine.total).toBe(1);
    await expect(uploadViolationAttachments(outsider, d.id, [{ name: "a.pdf", data: SAMPLE_PDF }], meta())).rejects.toThrow(/غير موجود/);
  });

  it("لا يمكن التسجيل باسم مكتب خارج النطاق ولو في المحافظة نفسها", async () => {
    const other = await makeOffice("T-KRB", "KRB");
    const sameGov = await makeOffice("T-BGD2", "BGD");
    const { actor } = await makeUser(["REGISTRAR"]);
    await expect(createDraft(actor, await completeInput({ officeId: other.id, governorateId: other.governorateId }))).rejects.toThrow(/نطاق/);
    await expect(createDraft(actor, await completeInput({ officeId: sameGov.id, governorateId: sameGov.governorateId }))).rejects.toThrow(/نطاق/);
  });

  it("مسودة الموظف لا تظهر لزميله في البحث العام", async () => {
    const { actor: a } = await makeUser(["REGISTRAR"]);
    const { actor: b } = await makeUser(["TECHNICAL"]);
    const d = await createDraft(a, await completeInput({ offenderName: "مسودة خاصة جداً" }));
    expect((await searchViolations(b, searchSchema.parse({ q: "مسودة خاصة جداً" }))).total).toBe(0);
    await expect(getViolationForActor(b, d.id)).rejects.toThrow();
  });

  it("البحث بالرقم الرسمي وبرقم المحضر والفرز والتقسيم", async () => {
    const { actor } = await makeUser(["REGISTRAR"]);
    const d = await createDraft(actor, await completeInput({ paperReportNumber: "PR-99881" }));
    const r = await registerViolation(actor, d.id, d.version);
    expect((await searchViolations(actor, searchSchema.parse({ number: r.number! }))).rows[0].id).toBe(d.id);
    expect((await searchViolations(actor, searchSchema.parse({ paperReportNumber: "PR-99881" }))).total).toBe(1);
    const page = await searchViolations(actor, searchSchema.parse({ sort: "number_asc", page: 1 }));
    expect(page.rows.length).toBeLessThanOrEqual(20);
  });
});

describe("المرفقات", () => {
  it("يرفض ملفاً تنفيذياً متنكراً بامتداد PDF، وصورة بامتداد مضلل", async () => {
    const { actor } = await makeUser(["REGISTRAR"]);
    const d = await createDraft(actor, await completeInput());
    await expect(uploadViolationAttachments(actor, d.id, [{ name: "report.pdf", data: SAMPLE_EXE }], meta())).rejects.toThrow(/غير مسموح/);
    await expect(uploadViolationAttachments(actor, d.id, [{ name: "photo.pdf", data: SAMPLE_PNG }], meta())).rejects.toThrow(/لا يطابق/);
    expect(await prisma.attachment.count({ where: { violationId: d.id } })).toBe(0);
  });

  it("يحفظ البصمة والنوع الحقيقي، والتنزيل يعيد المحتوى نفسه", async () => {
    const { actor } = await makeUser(["REGISTRAR"]);
    const d = await createDraft(actor, await completeInput());
    const [id] = await uploadViolationAttachments(actor, d.id, [{ name: "صورة.png", data: SAMPLE_PNG }], meta({ documentType: "EVIDENCE" }));
    const v = await prisma.attachmentVersion.findFirstOrThrow({ where: { attachmentId: id } });
    expect(v.mimeType).toBe("image/png");
    expect(v.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(v.storageKey).not.toContain("صورة");
    const r = await readAttachmentVersion(actor, v.id);
    expect(r.data.equals(SAMPLE_PNG)).toBe(true);
    expect(r.inline).toBe(true);
  });

  it("الإصدار الجديد يحفظ القديم ويتطلب سبباً، وقاعدة البيانات تمنع تعديل محتوى الإصدار", async () => {
    const { actor } = await makeUser(["REGISTRAR"]);
    const d = await createDraft(actor, await completeInput());
    const [id] = await uploadViolationAttachments(actor, d.id, [{ name: "a.pdf", data: SAMPLE_PDF }], meta());
    await expect(addAttachmentVersion(actor, id, { name: "b.pdf", data: SAMPLE_PDF }, " ")).rejects.toThrow(/سبب/);
    await addAttachmentVersion(actor, id, { name: "b.pdf", data: SAMPLE_PDF }, "نسخة أوضح");
    const versions = await prisma.attachmentVersion.findMany({ where: { attachmentId: id }, orderBy: { versionNo: "asc" } });
    expect(versions.map((x) => x.versionNo)).toEqual([1, 2]);
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id } })).currentVersionNo).toBe(2);
    await expect(prisma.attachmentVersion.update({ where: { id: versions[0].id }, data: { sha256: "0".repeat(64) } })).rejects.toThrow();
    await expect(prisma.attachmentVersion.delete({ where: { id: versions[0].id } })).rejects.toThrow();
  });

  it("المرفق المعتمد لا يسحبه إلا صاحب الصلاحية الرسمية، والسحب لا يحذف", async () => {
    const { actor } = await makeUser(["REGISTRAR"]);
    const d = await createDraft(actor, await completeInput());
    const r = await registerViolation(actor, d.id, d.version);
    const [id] = await uploadViolationAttachments(actor, d.id, [{ name: "a.pdf", data: SAMPLE_PDF }], meta());
    const v = await prisma.violation.findUniqueOrThrow({ where: { id: d.id } });
    await submitForApproval(actor, d.id, v.version);
    void r;
    await expect(withdrawAttachment(actor, id, "خطأ")).rejects.toThrow(/صلاحية/);
    actor.permissions.add("attachment.withdraw");
    await withdrawAttachment(actor, id, "سحب بقرار رسمي");
    const a = await prisma.attachment.findUniqueOrThrow({ where: { id } });
    expect(a.approvalStatus).toBe("WITHDRAWN");
    expect(await prisma.attachmentVersion.count({ where: { attachmentId: id } })).toBe(1);
  });

  it("المرفق السري محجوب عمن لا يملك الصلاحية، وتنزيله مسجل في التدقيق", async () => {
    const { actor: legal } = await makeUser(["LEGAL"]);
    const { actor: reg } = await makeUser(["REGISTRAR"]);
    const d = await createDraft(reg, await completeInput());
    await registerViolation(reg, d.id, d.version);
    await expect(uploadViolationAttachments(reg, d.id, [{ name: "s.pdf", data: SAMPLE_PDF }], meta({ confidentiality: "CONFIDENTIAL" }))).rejects.toThrow(/سرية/);
    const [id] = await uploadViolationAttachments(legal, d.id, [{ name: "s.pdf", data: SAMPLE_PDF }], meta({ documentType: "OFFICIAL_LETTER", confidentiality: "CONFIDENTIAL" }));
    const ver = await prisma.attachmentVersion.findFirstOrThrow({ where: { attachmentId: id } });
    await expect(readAttachmentVersion(reg, ver.id)).rejects.toThrow(/غير موجود/);
    await readAttachmentVersion(legal, ver.id);
    expect(await prisma.auditLog.count({ where: { action: "attachment.downloaded", entityId: id } })).toBe(1);
  });

  it("المرفقات بعد الإحالة تكميلية وتتطلب سبب الإضافة", async () => {
    const { actor } = await makeUser(["REGISTRAR"]);
    const d = await createDraft(actor, await completeInput());
    await registerViolation(actor, d.id, d.version);
    await uploadViolationAttachments(actor, d.id, [{ name: "a.pdf", data: SAMPLE_PDF }], meta());
    const v = await prisma.violation.findUniqueOrThrow({ where: { id: d.id } });
    await submitForApproval(actor, d.id, v.version);
    await expect(uploadViolationAttachments(actor, d.id, [{ name: "b.pdf", data: SAMPLE_PDF }], meta({ documentType: "SUPPLEMENTARY" }))).rejects.toThrow(/سبب/);
    await uploadViolationAttachments(actor, d.id, [{ name: "b.pdf", data: SAMPLE_PDF }], meta({ documentType: "SUPPLEMENTARY", additionReason: "صورة إضافية للموقع" }));
  });
});
