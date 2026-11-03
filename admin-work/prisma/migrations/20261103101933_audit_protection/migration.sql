-- سجل التدقيق إلحاقي فقط: يُمنع تعديل القيود أو حذفها أو تفريغ الجدول من أي حساب يتصل بقاعدة البيانات عبر التطبيق.
-- (مالك قاعدة البيانات وحده يستطيع تعطيل المشغّل صراحةً، وأي تعطيل كهذا يكسر سلسلة التجزئة ويُكشف عند التحقق.)
CREATE OR REPLACE FUNCTION audit_log_block_changes() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'سجل التدقيق لا يقبل التعديل أو الحذف' USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_changes();

CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_block_changes();

-- السجلات الزمنية للطلبات والمهام إلحاقية كذلك
CREATE TRIGGER request_event_no_update BEFORE UPDATE OR DELETE ON "RequestEvent"
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_changes();
CREATE TRIGGER task_event_no_update BEFORE UPDATE OR DELETE ON "TaskEvent"
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_changes();

-- منع تكرار رقم الهاتف بين السجلات غير المحذوفة
CREATE UNIQUE INDEX "Person_phone_active_key" ON "Person" ("phone") WHERE "phone" IS NOT NULL AND "deletedAt" IS NULL;

-- نسبة الإنجاز بين 0 و100
ALTER TABLE "Task" ADD CONSTRAINT "Task_progress_range" CHECK ("progress" BETWEEN 0 AND 100);
