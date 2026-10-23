-- حماية السجلات الرسمية من التعديل والحذف على مستوى قاعدة البيانات.
-- تشمل: سجل التدقيق، سجل انتقالات المراحل، قرارات المصادقة، تصحيحات تاريخ الاستلام.
-- الحدود: مالك قاعدة البيانات (superuser) يستطيع تعطيل المشغلات؛ راجع SECURITY.md.

CREATE OR REPLACE FUNCTION cmc_prevent_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'السجل % غير قابل للتعديل أو الحذف', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION cmc_prevent_mutation();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION cmc_prevent_mutation();

CREATE TRIGGER status_history_no_update BEFORE UPDATE OR DELETE ON "ViolationStatusHistory"
  FOR EACH ROW EXECUTE FUNCTION cmc_prevent_mutation();

CREATE TRIGGER approval_no_update BEFORE UPDATE OR DELETE ON "Approval"
  FOR EACH ROW EXECUTE FUNCTION cmc_prevent_mutation();

CREATE TRIGGER receipt_correction_no_update BEFORE UPDATE OR DELETE ON "ReceiptCorrection"
  FOR EACH ROW EXECUTE FUNCTION cmc_prevent_mutation();

-- إصدارات المرفقات لا تُعدَّل بعد رفعها (يُسمح فقط بتحديث حالة الفحص)
CREATE OR REPLACE FUNCTION cmc_attachment_version_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'لا يجوز حذف إصدار مرفق' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."storageKey" <> OLD."storageKey" OR NEW."sha256" <> OLD."sha256"
     OR NEW."sizeBytes" <> OLD."sizeBytes" OR NEW."versionNo" <> OLD."versionNo"
     OR NEW."attachmentId" <> OLD."attachmentId" THEN
    RAISE EXCEPTION 'لا يجوز تعديل محتوى إصدار مرفق' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER attachment_version_guard BEFORE UPDATE OR DELETE ON "AttachmentVersion"
  FOR EACH ROW EXECUTE FUNCTION cmc_attachment_version_guard();
