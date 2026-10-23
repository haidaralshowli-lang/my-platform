-- تثبيت search_path لدوال المشغلات (لا تشير إلى أي جدول) حتى لا يتأثر سلوكها بمسار البحث لدى المستدعي
ALTER FUNCTION cmc_prevent_mutation() SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION cmc_attachment_version_guard() SET search_path = pg_catalog, pg_temp;
