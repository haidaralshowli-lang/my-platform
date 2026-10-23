-- صلاحيات دور التطبيق (إن وُجد): التطبيق يتصل بدور محدود غير مالك للجداول.
-- الجداول غير القابلة للتعديل تُسحب منها صلاحيات التعديل والحذف على مستوى الصلاحيات أيضاً (إضافة إلى المشغلات)،
-- فلا يستطيع دور التطبيق حتى تعطيل المشغلات لأنه ليس مالك الجداول.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cmc_app') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO cmc_app', current_schema());
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO cmc_app', current_schema());
    EXECUTE format('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA %I TO cmc_app', current_schema());
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cmc_app', current_schema());
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO cmc_app', current_schema());
    REVOKE UPDATE, DELETE, TRUNCATE ON "AuditLog", "ViolationStatusHistory", "Approval", "ReceiptCorrection", "Payment", "StoredBlob" FROM cmc_app;
    REVOKE ALL ON "_prisma_migrations" FROM cmc_app;
    GRANT SELECT ON "_prisma_migrations" TO cmc_app;
  END IF;
END $$;
