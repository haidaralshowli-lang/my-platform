// بيانات العرض التجريبية: تُنشأ عبر الخدمات الحقيقية نفسها (فيتولد سجل الحالات والتدقيق والتنبيهات كما في الاستخدام الفعلي)،
// وكل مخالفة تحمل isDemo=true فلا تدخل لوحة المعلومات ولا التقارير. القواعد والوثائق القانونية هنا معلّمة صراحةً بأنها تجريبية
// ولا تمثل سنداً قانونياً. لا تُشغَّل على قاعدة إنتاج فيها بيانات حقيقية إلا بقرار صريح.
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { writeAudit } from "@/lib/audit";
import { loadActor, type Actor } from "@/lib/rbac/actor";
import { createDraft, registerViolation, submitForApproval, violationInputSchema } from "@/lib/services/violations";
import { attachmentMetaSchema, uploadViolationAttachments } from "@/lib/services/attachments";
import { decide, decideLegal, saveLegal, saveTechnical, submitLegal, submitTechnical } from "@/lib/services/approvals";
import { addArticle, createLegalDocument, legalDocSchema, linkArticle, setLegalDocumentStatus } from "@/lib/services/legal-library";
import { createTemplate, prepareWarning, signedSchema, uploadSignedWarning } from "@/lib/services/warnings";
import { dispatchSchema, receiptSchema, recordDispatch, recordReceipt } from "@/lib/services/deliveries";
import { createRule, refreshDeadlines, ruleSchema } from "@/lib/services/deadlines";
import { addPayment, decideResponse, financialSchema, paymentSchema, recordResponse, responseBaseSchema, updateFinancial } from "@/lib/services/responses";
import { objectionSchema, recordObjection } from "@/lib/services/objections";
import { decideNonResponse, initiateNonResponse } from "@/lib/services/criminal";
import { closureSchema, decideClosure, requestClosure } from "@/lib/services/closure";

/// ملف PDF صغير صالح البنية، مكتوب عليه أنه مستند تجريبي
export const DEMO_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n" +
    "4 0 obj<</Length 66>>stream\nBT /F1 18 Tf 60 780 Td (DEMO DOCUMENT - NOT AN OFFICIAL RECORD) Tj ET\nendstream endobj\n" +
    "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);
const pdf = (name: string) => ({ name, data: DEMO_PDF });

const DEMO_ROLES: [string, string, string][] = [
  ["demo.registrar", "موظف تسجيل (تجريبي)", "REGISTRAR"],
  ["demo.technical", "موظف فني (تجريبي)", "TECHNICAL"],
  ["demo.legal", "موظف قانوني (تجريبي)", "LEGAL"],
  ["demo.legal2", "مصادق قانوني (تجريبي)", "LEGAL"],
  ["demo.chairman", "رئيس الهيئة (تجريبي)", "CHAIRMAN"],
  ["demo.senior", "الإدارة العليا (تجريبي)", "SENIOR_MGMT"],
  ["demo.finance", "موظف مالي (تجريبي)", "FINANCE"],
  ["demo.delivery", "موظف تبليغات (تجريبي)", "DELIVERY"],
  ["demo.manager", "مدير فرع (تجريبي)", "BRANCH_MANAGER"],
];

export type DemoResult = { credentials: { username: string; fullName: string; role: string; password: string }[]; violations: number };

function password(): string {
  return randomBytes(12).toString("base64url");
}

function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: process.env.APP_TIMEZONE || "Asia/Baghdad" }).format(new Date());
}

export async function seedDemo(): Promise<DemoResult> {
  if (await prisma.violation.count({ where: { isDemo: true } })) {
    throw new Error("البيانات التجريبية موجودة مسبقاً. احذفها أولاً (npm run demo:purge) قبل إعادة إنشائها.");
  }
  const hq = await prisma.office.findUniqueOrThrow({ where: { code: "HQ" } });
  const roles = await prisma.role.findMany();
  const roleId = (code: string) => roles.find((r) => r.code === code)!.id;

  // ─── المستخدمون التجريبيون: نطاق مركزي، كلمات مرور عشوائية تُعرض مرة واحدة ───
  const credentials: DemoResult["credentials"] = [];
  const users: Record<string, Actor> = {};
  for (const [username, fullName, role] of DEMO_ROLES) {
    const pw = password();
    // بعد الحذف يبقى المستخدم التجريبي معطلاً (يشير إليه سجل التدقيق)، فيُعاد تفعيله بكلمة مرور جديدة
    const u = await prisma.user.upsert({
      where: { username },
      update: { passwordHash: await hashPassword(pw), isActive: true, failedLoginCount: 0, lockedUntil: null },
      create: {
        username, fullName, passwordHash: await hashPassword(pw), mustChangePassword: false, isActive: true, isDemo: true,
        scope: "CENTRAL", governorateId: hq.governorateId, officeId: hq.id, roles: { create: [{ roleId: roleId(role) }] },
      },
    });
    if (!u.isDemo) throw new Error(`اسم المستخدم ${username} مستخدم لحساب غير تجريبي`);
    users[username] = (await loadActor(prisma, u.id))!;
    credentials.push({ username, fullName, role, password: pw });
  }
  // حساب إعداد داخلي لإنشاء القوائم والقواعد التجريبية، يُعطَّل فور الانتهاء (لا يمكن الدخول به)
  const setupUser = await prisma.user.upsert({
    where: { username: "demo.setup" },
    update: { isActive: true },
    create: {
      username: "demo.setup", fullName: "إعداد البيانات التجريبية", passwordHash: await hashPassword(password()), mustChangePassword: true, isActive: true, isDemo: true,
      scope: "CENTRAL", governorateId: hq.governorateId, officeId: hq.id, roles: { create: [{ roleId: roleId("SYSADMIN") }] },
    },
  });
  const admin = (await loadActor(prisma, setupUser.id))!;
  const reg = users["demo.registrar"], tech = users["demo.technical"], legal = users["demo.legal"], legal2 = users["demo.legal2"];
  const chair = users["demo.chairman"], finance = users["demo.finance"], delivery = users["demo.delivery"];

  // ─── قوائم مرجعية تجريبية ───
  const offices = await Promise.all(
    ([["DEMO-BSR", "مكتب البصرة (تجريبي)", "BSR"], ["DEMO-NJF", "مكتب النجف (تجريبي)", "NJF"], ["DEMO-NIN", "مكتب نينوى (تجريبي)", "NIN"]] as const).map(async ([code, nameAr, gov]) => {
      const g = await prisma.governorate.findUniqueOrThrow({ where: { code: gov } });
      return prisma.office.upsert({ where: { code }, update: {}, create: { code, nameAr, governorateId: g.id } });
    }),
  );
  const allOffices = [hq, ...offices];
  const types = await Promise.all(
    [["DEMO-CONTENT", "مخالفة محتوى إعلامي (تجريبي)"], ["DEMO-LICENSE", "عمل دون ترخيص (تجريبي)"], ["DEMO-FREQ", "استخدام ترددات دون تخويل (تجريبي)"], ["DEMO-URGENT", "مخالفة بمدة قصيرة (تجريبي)"]].map(([code, nameAr]) =>
      prisma.violationType.upsert({ where: { code }, update: {}, create: { code, nameAr } }),
    ),
  );
  const [tContent, tLicense, tFreq, tUrgent] = types;
  const source = await prisma.detectionSource.findFirstOrThrow({ where: { isActive: true } });

  // قواعد مدد مقيدة بالأنواع التجريبية فقط، فلا تنطبق على أي مخالفة حقيقية
  const basis = "قاعدة تجريبية لأغراض العرض فقط — لا تمثل سنداً قانونياً معتمداً";
  const ruleExists = async (code: string) => !!(await prisma.legalDeadlineRule.findUnique({ where: { code } }));
  for (const t of [tContent, tLicense, tFreq]) {
    if (await ruleExists(`${t.code}-R`)) continue;
    await createRule(admin, ruleSchema.parse({
      code: `${t.code}-R`, nameAr: `مدة ${t.nameAr}`, violationTypeId: t.id, duration: "15", unit: "CALENDAR_DAYS", startEvent: "RECEIPT_DATE", excludeHolidays: "",
      legalBasis: basis, extensionAllowed: "on", maxExtensionDays: "15", objectionEffect: "SUSPEND", warnBeforeDays: "3", effectiveFrom: "2020-01-01",
    }));
  }
  if (!(await ruleExists("DEMO-URGENT-R"))) await createRule(admin, ruleSchema.parse({
    code: "DEMO-URGENT-R", nameAr: "مدة قصيرة (تجريبي)", violationTypeId: tUrgent.id, duration: "2", unit: "CALENDAR_DAYS", startEvent: "RECEIPT_DATE", excludeHolidays: "",
    legalBasis: basis, extensionAllowed: "", maxExtensionDays: "", objectionEffect: "NONE", warnBeforeDays: "3", effectiveFrom: "2020-01-01",
  }));

  const DEMO_DOC = "وثيقة تجريبية — ليست نصاً قانونياً نافذاً";
  let article = await prisma.legalArticle.findFirst({ where: { documentVersion: { document: { title: DEMO_DOC } } } });
  if (!article) {
    const docId = await createLegalDocument(legal, legalDocSchema.parse({ title: DEMO_DOC, docType: "REGULATION" }), { files: [] });
    const v1 = await prisma.legalDocumentVersion.findFirstOrThrow({ where: { documentId: docId } });
    await addArticle(legal, v1.id, { articleNumber: "1", paragraph: null, text: "نص تجريبي لأغراض العرض فقط، لا يُستند إليه." });
    await setLegalDocumentStatus(legal, docId, "IN_FORCE", "تفعيل للعرض التجريبي");
    article = await prisma.legalArticle.findFirstOrThrow({ where: { documentVersion: { documentId: docId } } });
  }
  const articleId = article.id;
  const existingTemplate = await prisma.warningTemplate.findUnique({ where: { name: "قالب إنذار (تجريبي)" } });
  const templateId = existingTemplate?.id ?? await createTemplate(legal, {
    name: "قالب إنذار (تجريبي)",
    body: "نسخة تجريبية — إنذار رقم {{warning.number}}\nإلى: {{offender.name}}\nاستناداً إلى {{legal.basis}}\nالإجراء المطلوب: {{required.action}}\nالمدة: {{response.period}}",
    notes: "للعرض التجريبي فقط",
  });

  // ─── المخالفات ───
  const offenders = ["قناة الأفق الفضائية (تجريبي)", "إذاعة صوت المدينة (تجريبي)", "شركة الشبكة السريعة (تجريبي)", "موقع الخبر اليوم (تجريبي)", "محطة النهرين (تجريبي)", "شركة الاتصال الذهبي (تجريبي)"];
  let n = 0;
  const ver = async (id: string) => (await prisma.violation.findUniqueOrThrow({ where: { id } })).version;
  const today = todayKey();
  const draft = async (typeId: string) => {
    const office = allOffices[n % allOffices.length];
    const month = String(((n * 5) % 9) + 1).padStart(2, "0");
    const input = violationInputSchema.parse({
      governorateId: office.governorateId, officeId: office.id, offenderName: offenders[n % offenders.length], violationTypeId: typeId,
      detectionSourceId: source.id, discoveredAt: `${today.slice(0, 4)}-${month}-${String((n % 25) + 1).padStart(2, "0")}` <= today ? `${today.slice(0, 4)}-${month}-${String((n % 25) + 1).padStart(2, "0")}` : today,
      description: `وصف تجريبي للمخالفة رقم ${n + 1} لأغراض العرض فقط`, organizerName: "منظم محضر تجريبي",
    });
    n++;
    return createDraft(reg, input, undefined, { isDemo: true });
  };
  const registered = async (typeId: string) => {
    const d = await draft(typeId);
    await registerViolation(reg, d.id, d.version);
    return d.id;
  };
  const submitted = async (typeId: string) => {
    const id = await registered(typeId);
    await uploadViolationAttachments(reg, id, [pdf("mahdar-demo.pdf")], attachmentMetaSchema.parse({ documentType: "VIOLATION_REPORT" }));
    await submitForApproval(reg, id, await ver(id));
    return id;
  };
  const approved = async (typeId: string) => {
    const id = await submitted(typeId);
    await decide(chair, id, "final", "APPROVED", null, await ver(id));
    return id;
  };
  const technicalDone = async (typeId: string) => {
    const id = await approved(typeId);
    await linkArticle(tech, id, articleId, "TECHNICAL", null);
    await saveTechnical(tech, id, { position: "موقف فني تجريبي", reasons: "أسباب فنية تجريبية", evidence: null, recommendation: null });
    await submitTechnical(tech, id);
    return id;
  };
  const legalApproved = async (typeId: string) => {
    const id = await technicalDone(typeId);
    await saveLegal(legal, id, { opinion: "رأي قانوني تجريبي", reasons: "أسباب قانونية تجريبية", proposedAction: null, notes: null });
    await submitLegal(legal, id);
    await decideLegal(legal2, id, "APPROVED", null, await ver(id));
    return id;
  };
  const awaitingDelivery = async (typeId: string) => {
    const id = await legalApproved(typeId);
    await decide(chair, id, "warning_issue", "APPROVED", null, await ver(id));
    const warningId = await prepareWarning(legal, id, { templateId, requiredAction: "إزالة المخالفة خلال المدة (تجريبي)", responsePeriodText: "خمسة عشر يوماً (تجريبي)" });
    await uploadSignedWarning(delivery, warningId, pdf("signed-demo.pdf"), signedSchema.parse({ signerName: "رئيس الهيئة (تجريبي)", signedAt: today }));
    return { id, warningId };
  };
  const running = async (typeId: string) => {
    const { id, warningId } = await awaitingDelivery(typeId);
    const dId = await recordDispatch(delivery, warningId, dispatchSchema.parse({ sentAt: today, method: "HAND" }));
    await recordReceipt(delivery, dId, receiptSchema.parse({ receivedDate: today, recipientName: "مستلم تجريبي", recipientCapacity: "المدير المفوض", receiptNumber: `DEMO-${n}-${randomBytes(3).toString("hex")}` }), pdf("receipt-demo.pdf"));
    return id;
  };

  // 1–6: مراحل ما قبل الإنذار
  await draft(tContent.id); // مسودة
  await registered(tLicense.id); // مسجلة دون محضر
  await submitted(tFreq.id); // بانتظار مصادقة رئيس الهيئة
  const rejected = await submitted(tContent.id);
  await decide(chair, rejected, "final", "REJECTED", "عدم كفاية الأدلة (تجريبي)", await ver(rejected)); // غير مصادق عليها
  await approved(tLicense.id); // لدى القسم الفني
  await technicalDone(tFreq.id); // لدى الدائرة القانونية
  await legalApproved(tContent.id); // بانتظار موافقة إصدار الإنذار
  // 7–9: الإنذار والتبليغ والمدة
  await awaitingDelivery(tLicense.id); // بانتظار التبليغ
  await running(tFreq.id); // المدة سارية
  await running(tUrgent.id); // قاربت على الانتهاء (قاعدة المدة القصيرة)
  // 10: اعتراض يعلّق المدة
  const objected = await running(tContent.id);
  await recordObjection(legal, objected, objectionSchema.parse({ kind: "OBJECTION", submittedAt: today, content: "اعتراض تجريبي على الإنذار", competentAuthority: "الدائرة القانونية" }), [pdf("objection-demo.pdf")]);
  // 11: استجابة مالية بتسديد جزئي
  const partial = await running(tLicense.id);
  const pr = await recordResponse(finance, partial, responseBaseSchema.parse({ receivedAt: today, summary: "كتاب استجابة مالية (تجريبي)" }), { kind: "FINANCIAL", data: financialSchema.parse({ financialType: "غرامة (تجريبي)", amountDue: "2500000", amountDueBasis: "قرار تجريبي" }) }, [pdf("finance-demo.pdf")]);
  await addPayment(finance, pr, paymentSchema.parse({ amount: "1000000", paidAt: today, receiptNumber: `DEMO-PAY-${randomBytes(3).toString("hex")}` }));
  // 12: استجابة مالية كاملة مقبولة ثم إغلاق باعتماد ثانٍ
  const closed = await running(tFreq.id);
  const cr = await recordResponse(finance, closed, responseBaseSchema.parse({ receivedAt: today, summary: "تسديد كامل (تجريبي)" }), { kind: "FINANCIAL", data: financialSchema.parse({ financialType: "غرامة (تجريبي)", amountDue: "1000000", amountDueBasis: "قرار تجريبي" }) }, []);
  await addPayment(finance, cr, paymentSchema.parse({ amount: "1000000", paidAt: today, receiptNumber: `DEMO-PAY-${randomBytes(3).toString("hex")}` }));
  await updateFinancial(finance, cr, { amountDue: "1000000", amountDueBasis: "قرار تجريبي", auditResult: "مطابق للوصولات (تجريبي)", reason: "" });
  await decideResponse(chair, cr, "ACCEPTED", null);
  const req = await requestClosure(legal, closed, closureSchema.parse({ path: "RESPONSE", finalOutcome: "FINANCIAL_RESPONSE", reason: "اكتمال الاستجابة المالية والتسديد (تجريبي)" }));
  await decideClosure(chair, req, true, "اعتماد الإغلاق (تجريبي)");
  // 13: انتهاء المدة دون استجابة ثم دعوى جزائية.
  // لا يمكن تسجيل تبليغ بتاريخ ماضٍ عبر الخدمات (التبليغ لا يسبق الإعداد)، لذا يُزاح تاريخ الاستحقاق لهذه المعاملة التجريبية
  // وحدها إلى الماضي، ويُسجَّل ذلك صراحةً في سجل التدقيق.
  const expired = await running(tContent.id);
  const dl = await prisma.deadlineCalculation.findFirstOrThrow({ where: { violationId: expired, isCurrent: true } });
  const shifted = new Date(Date.now() - 3_600_000);
  await prisma.$transaction(async (tx) => {
    await tx.deadlineCalculation.update({ where: { id: dl.id }, data: { dueDate: shifted } });
    await writeAudit(tx, { actor: admin, action: "demo.deadline_shifted", entityType: "DeadlineCalculation", entityId: dl.id, before: { dueDate: dl.dueDate }, after: { dueDate: shifted }, reason: "إزاحة زمنية لبيانات العرض التجريبية فقط" });
  });
  await refreshDeadlines();
  await initiateNonResponse(legal, expired, "تحقق تجريبي من سجل الوارد: لا استجابة حتى انتهاء المدة", await ver(expired));
  await decideNonResponse(chair, expired, true, "اعتماد عدم الاستجابة (تجريبي)", await ver(expired));

  await refreshDeadlines();
  await prisma.user.update({ where: { id: setupUser.id }, data: { isActive: false } });
  await prisma.$transaction((tx) => writeAudit(tx, { actor: null, action: "demo.seeded", entityType: "System", entityId: "demo", after: { users: credentials.length, violations: n } }));
  return { credentials, violations: n };
}

/// حذف البيانات التجريبية: تُحذف المخالفات التجريبية وكل ما يتبعها، ويُعطَّل المستخدمون التجريبيون (لا يُحذفون لأن سجل
/// التدقيق غير القابل للتعديل يشير إليهم). سجل التدقيق لا يُمس إطلاقاً. يتطلب اتصالاً بصلاحية مالك الجداول لتعطيل
/// مشغلات منع التعديل مؤقتاً داخل المعاملة نفسها (ALTER TABLE ... DISABLE TRIGGER) ثم إعادتها قبل الالتزام.
export async function purgeDemo(): Promise<{ violations: number; users: number }> {
  const ids = (await prisma.violation.findMany({ where: { isDemo: true }, select: { id: true } })).map((v) => v.id);
  const result = await prisma.$transaction(async (tx) => {
    const guarded = ["ViolationStatusHistory", "Approval", "ReceiptCorrection", "Payment", "AttachmentVersion", "StoredBlob"];
    for (const t of guarded) await tx.$executeRawUnsafe(`ALTER TABLE "${t}" DISABLE TRIGGER USER`);
    if (ids.length) {
      const del = (sql: string) => tx.$executeRawUnsafe(sql, ids);
      const inV = `= ANY($1::text[])`;
      const keys = (await tx.$queryRawUnsafe<{ storageKey: string }[]>(
        `SELECT av."storageKey" FROM "AttachmentVersion" av JOIN "Attachment" a ON a.id = av."attachmentId" WHERE a."violationId" ${inV} AND av."storageProvider" = 'db'`, ids,
      )).map((r) => r.storageKey);
      await del(`DELETE FROM "Payment" WHERE "financialResponseId" IN (SELECT id FROM "Response" WHERE "violationId" ${inV})`);
      for (const child of ["FinancialResponse", "TechnicalResponse", "LegalResponse"]) {
        await del(`DELETE FROM "${child}" WHERE "responseId" IN (SELECT id FROM "Response" WHERE "violationId" ${inV})`);
      }
      await del(`DELETE FROM "ObjectionEvent" WHERE "objectionId" IN (SELECT id FROM "Objection" WHERE "violationId" ${inV})`);
      await del(`DELETE FROM "CourtJudgment" WHERE "caseId" IN (SELECT id FROM "CriminalCase" WHERE "violationId" ${inV})`);
      await del(`DELETE FROM "CriminalCaseEvent" WHERE "caseId" IN (SELECT id FROM "CriminalCase" WHERE "violationId" ${inV})`);
      await del(`DELETE FROM "ReceiptCorrection" WHERE "deliveryRecordId" IN (SELECT d.id FROM "DeliveryRecord" d JOIN "Warning" w ON w.id = d."warningId" WHERE w."violationId" ${inV})`);
      await del(`DELETE FROM "ExtensionRequest" WHERE "violationId" ${inV}`);
      await del(`DELETE FROM "DeadlineCalculation" WHERE "violationId" ${inV}`);
      await del(`DELETE FROM "DeliveryRecord" WHERE "warningId" IN (SELECT id FROM "Warning" WHERE "violationId" ${inV})`);
      for (const t of ["Warning", "Response", "Objection", "CriminalCase", "RemovalRecord", "ClosureRequest", "ReopenRecord", "TechnicalAssessment", "LegalAssessment", "ViolationLegalReference", "Notification", "Approval", "ViolationStatusHistory"]) {
        await del(`DELETE FROM "${t}" WHERE "violationId" ${inV}`);
      }
      await del(`DELETE FROM "AttachmentVersion" WHERE "attachmentId" IN (SELECT id FROM "Attachment" WHERE "violationId" ${inV})`);
      await del(`DELETE FROM "Attachment" WHERE "violationId" ${inV}`);
      await del(`DELETE FROM "Violation" WHERE id ${inV}`);
      if (keys.length) await tx.$executeRawUnsafe(`DELETE FROM "StoredBlob" WHERE key = ANY($1::text[])`, keys);
    }
    for (const t of guarded) await tx.$executeRawUnsafe(`ALTER TABLE "${t}" ENABLE TRIGGER USER`);
    const demoUsers = await tx.user.findMany({ where: { isDemo: true }, select: { id: true } });
    await tx.session.deleteMany({ where: { userId: { in: demoUsers.map((u) => u.id) } } });
    await tx.notification.deleteMany({ where: { userId: { in: demoUsers.map((u) => u.id) } } });
    const users = await tx.user.updateMany({ where: { isDemo: true }, data: { isActive: false } });
    await writeAudit(tx, { actor: null, action: "demo.purged", entityType: "System", entityId: "demo", after: { violations: ids.length, deactivatedUsers: users.count } });
    return { violations: ids.length, users: users.count };
  }, { timeout: 120_000 });
  return result;
}
