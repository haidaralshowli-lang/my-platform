-- عند وجود دور التطبيق المحدود (aw_app في الإنتاج): يُمنع من تعديل أو حذف السجلات الإلحاقية حتى على مستوى الصلاحيات،
-- إضافة إلى المشغّلات. محلياً لا يوجد هذا الدور فلا يُنفَّذ شيء.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aw_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON "AuditLog", "RequestEvent", "TaskEvent" FROM aw_app;
    REVOKE TRUNCATE ON ALL TABLES IN SCHEMA aw FROM aw_app;
  END IF;
END $$;
