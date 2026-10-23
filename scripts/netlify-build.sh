#!/bin/sh
# أمر البناء على Netlify. أكواد الخروج تحدد المرحلة الفاشلة (تظهر في رسالة فشل النشر):
#   21-30 فحص الاتصال (راجع scripts/db-probe.ts) · 41 الترحيلات · 42 البيانات الأساسية · 43 التهيئة الأولى · 44 بناء التطبيق
# بلا DIRECT_DATABASE_URL (بيئات المعاينة) يُبنى التطبيق فقط ولا تُمس قاعدة البيانات.
# BUILD_DIAG_URL/BUILD_DIAG_KEY (اختياري، مؤقت): يرسل مرحلة البناء وآخر سطور مخرجاتها (بعد إخفاء بيانات الاتصال) لتشخيص الفشل.
set -u
LOG=/tmp/cmc-build-step.log

diag() {
  [ -n "${BUILD_DIAG_URL:-}" ] || return 0
  node -e '
    const fs = require("fs");
    let out = ""; try { out = fs.readFileSync(process.argv[3], "utf8"); } catch {}
    out = out.replace(/:\/\/[^@\s]*@/g, "://***@").replace(/\$argon2id\$[^\s"]+/g, "<hash>").slice(-6000);
    fetch(process.env.BUILD_DIAG_URL, { method: "POST", headers: { apikey: process.env.BUILD_DIAG_KEY, authorization: "Bearer " + process.env.BUILD_DIAG_KEY, "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify({ stage: process.argv[1], code: Number(process.argv[2]), output: out }) }).catch(() => {});
  ' "$1" "$2" "$LOG" || true
}

step() {
  name=$1; fail=$2; shift 2
  "$@" > "$LOG" 2>&1; c=$?
  cat "$LOG"
  if [ "$c" -ne 0 ]; then diag "$name" "$c"; [ "$fail" = "probe" ] && exit "$c"; exit "$fail"; fi
  diag "$name" 0
}

: > "$LOG"; diag start 0
if [ -n "${DIRECT_DATABASE_URL:-}" ]; then
  step probe probe npx tsx scripts/db-probe.ts
  step migrate 41 npx prisma migrate deploy
  step seed 42 npx tsx prisma/seed.ts
  step bootstrap 43 npx tsx scripts/bootstrap.ts
fi
step build 44 npm run build
