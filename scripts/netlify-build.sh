#!/bin/sh
# أمر البناء على Netlify. أكواد الخروج تحدد المرحلة الفاشلة (تظهر في رسالة فشل النشر):
#   21-30 فحص الاتصال (راجع scripts/db-probe.ts) · 41 الترحيلات · 42 البيانات الأساسية · 43 التهيئة الأولى · 44 بناء التطبيق
# بلا DIRECT_DATABASE_URL (بيئات المعاينة) يُبنى التطبيق فقط ولا تُمس قاعدة البيانات.
set -u
if [ -n "${DIRECT_DATABASE_URL:-}" ]; then
  npx tsx scripts/db-probe.ts; c=$?; [ "$c" -eq 0 ] || exit "$c"
  npx prisma migrate deploy || exit 41
  npx tsx prisma/seed.ts || exit 42
  npx tsx scripts/bootstrap.ts || exit 43
fi
npm run build || exit 44
