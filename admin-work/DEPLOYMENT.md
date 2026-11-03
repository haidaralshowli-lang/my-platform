# النشر

يعمل النظام بطريقتين بالشيفرة نفسها: Netlify مع Supabase (النشر الحالي)، أو خادم داخلي بـ Node.js وPostgreSQL.

## أ. Netlify + Supabase (النشر الحالي)

نُشر بالبنية نفسها المعتمدة لمنصة المخالفات في المستودع، وفي مشروع Supabase نفسه، لكن في مخطط وأدوار مستقلة تماماً.

**الحالة (2026-11-03):** النشر الأول ناجح (deploy `6ae9c782…`، مدته نحو 3 دقائق). تحقق منه من قاعدة البيانات مباشرة:
- طُبّقت الترحيلات الأربعة: 16 جدولاً.
- البيانات الأساسية موجودة: 19 محافظة و5 إعدادات.
- أُنشئ المدير الأول `admin` بكلمة مرور مؤقتة يُلزم بتغييرها، ومعه قيد تدقيق واحد.
- اجتاز اتصال دور التطبيق فحص البناء.
- صلاحيات `aw_app` على `AuditLog` و`RequestEvent` و`TaskEvent` تقتصر على الإضافة والقراءة.
- الدالة المجدولة `notifications-cron` مسجلة كل ساعة.
- حُذفت متغيرات التهيئة بعد النجاح.

الموقع **محمي بدخول فريق Netlify** (الإعداد الافتراضي للمشاريع الجديدة)، فلم يُختبر من الخارج بعد.

| العنصر | القيمة |
|---|---|
| موقع Netlify | `admin-work-platform` ← `https://admin-work-platform.netlify.app` |
| مجلد البناء | `admin-work` (المستودع يضم منصة المخالفات أيضاً) |
| قاعدة البيانات | مشروع Supabase «my-platform» (eu-central-1، PostgreSQL 17)، المخطط `aw` |
| دور الترحيلات | `aw_owner`: مالك المخطط والجداول، يُستخدم في البناء فقط عبر `DIRECT_DATABASE_URL` (Session pooler، المنفذ 5432) |
| دور التطبيق | `aw_app`: قراءة وإضافة وتعديل وحذف فقط، **بلا** تعديل أو حذف أو تفريغ على `AuditLog` و`RequestEvent` و`TaskEvent`، ولا يستطيع تعطيل المشغّلات لأنه ليس المالك. يُستخدم عبر `DATABASE_URL` (Transaction pooler، المنفذ 6543، `pgbouncer=true&connection_limit=10`) |
| مسار البحث | `ALTER ROLE aw_owner/aw_app SET search_path = aw, public` |
| البحث التقريبي | الإضافة `pg_trgm` مثبتة **داخل المخطط `aw`** لأن Prisma يقصر مسار البحث على مخطط التطبيق، فتُوجد دوال التشابه في المخطط نفسه |
| العزل | الدوران لا يملكان أي صلاحية على مخطط منصة المخالفات `cmc`، والمخطط `aw` غير مكشوف عبر واجهة Supabase العامة (Data API) |

### إعداد قاعدة البيانات (نُفّذ مرة واحدة بصلاحية postgres)

```sql
CREATE ROLE aw_owner LOGIN PASSWORD '<عشوائية>';
CREATE ROLE aw_app LOGIN PASSWORD '<عشوائية>';
GRANT aw_owner TO postgres;
CREATE SCHEMA aw AUTHORIZATION aw_owner;
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA aw;
GRANT USAGE ON SCHEMA aw TO aw_app;
ALTER DEFAULT PRIVILEGES FOR ROLE aw_owner IN SCHEMA aw GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO aw_app;
ALTER DEFAULT PRIVILEGES FOR ROLE aw_owner IN SCHEMA aw GRANT USAGE, SELECT ON SEQUENCES TO aw_app;
ALTER ROLE aw_owner SET search_path = aw, public;
ALTER ROLE aw_app SET search_path = aw, public;
```

الترحيل `app_role_restrictions` يسحب صلاحيات التعديل والحذف على السجلات الإلحاقية من `aw_app` تلقائياً.

### متغيرات البيئة على Netlify

| المتغير | ملاحظة |
|---|---|
| `DATABASE_URL` | دور التطبيق عبر Transaction pooler |
| `DIRECT_DATABASE_URL` | دور الترحيلات عبر Session pooler (للبناء فقط) |
| `APP_SECRET`، `CRON_SECRET` | قيم عشوائية |
| `APP_URL` | `https://admin-work-platform.netlify.app` |
| `APP_TIMEZONE`، `SESSION_TTL_HOURS` | `Asia/Baghdad`، `8` |
| `BOOTSTRAP_ADMIN_USERNAME`، `BOOTSTRAP_ADMIN_FULLNAME`، `BOOTSTRAP_ADMIN_PASSWORD_HASH` | للتهيئة الأولى فقط، **تُحذف بعد أول نشر ناجح** |

القيم السرية مولّدة عشوائياً ولم تُكتب في المستودع. أداة الإعداد المستخدمة لم تقبل وسم «سري» ولا تقييد النطاق، فـ**يُرجى من المالك** من **Project configuration → Environment variables**:
1. تفعيل «Contains secret values» لـ `DATABASE_URL` و`DIRECT_DATABASE_URL` و`APP_SECRET` و`CRON_SECRET`.
2. تقييد `DIRECT_DATABASE_URL` على نطاق **Builds** فقط، وعلى سياق **Production** فقط (حتى لا تُرحِّل بيئات المعاينة قاعدة الإنتاج).

### خطوة البناء (`scripts/netlify-build.sh`)

عند وجود `DIRECT_DATABASE_URL`: فحص الاتصال ← `prisma migrate deploy` ← فحص اتصال دور التطبيق ← البيانات الأساسية (المحافظات والإعدادات) ← التهيئة الأولى ← `next build`. لكل مرحلة كود خروج يظهر في رسالة فشل النشر: 21–30 الاتصال، 41 الترحيلات، 42 البيانات الأساسية، 43 التهيئة، 44 البناء. كل الخطوات متساوية القوى، فتكرار البناء لا يكرر البيانات.

### التهيئة الأولى

يُمرَّر **بصمة** Argon2id لا كلمة مرور نصية:

```bash
printf '%s' '<كلمة المرور المؤقتة>' | npm run -s password:hash
```

يُنشأ المدير الأول مرة واحدة فقط (إذا لم يوجد أي مدير)، ويُلزم بتغيير كلمة المرور عند أول دخول. **لا تُنشأ أي بيانات تجريبية**، وفق وثيقة المتطلبات.

### المهام المجدولة

الدالة `netlify/functions/notifications-cron.mts` تستدعي `POST /api/cron/notifications` كل ساعة. وفي التطبيق تشغيل احتياطي: بعد عرض أي صفحة لمستخدم مسجّل، مرة كل ساعة على الأكثر.

**تنبيه:** ما دام الموقع محمياً بدخول فريق Netlify، تصطدم الدالة المجدولة بهذه الحماية، فلا يعمل إلا التشغيل الاحتياطي.

### توليد PDF

دوال Netlify لا تتضمن متصفح Chromium، فلا يُضبط `CHROMIUM_PATH`. يختفي زر «تنزيل PDF» تلقائياً، ويبقى «طباعة / حفظ PDF» من المتصفح بالشكل نفسه. وتصدير Excel يعمل كاملاً.

### الأداء

دوال Netlify تعمل افتراضياً في Ohio، والقاعدة في Frankfurt، فيكلف كل استعلام نحو 0.3 ثانية ذهاباً وإياباً. **الإصلاح من المالك:** Project configuration ← Build & deploy ← Functions region ← **EU (Frankfurt)**، ثم إعادة النشر.

### إعادة النشر

أي نشر جديد يطبق الترحيلات الجديدة تلقائياً.

## النسخ الاحتياطي على Supabase

- Supabase يأخذ نسخاً يومية حسب الخطة.
- نسخ إضافي مستقل تحت سيطرتكم، من جهاز إداري فيه `pg_dump` بالإصدار 17 أو أحدث:

```bash
BACKUP_KEY=<المفتاح> DIRECT_DATABASE_URL="<رابط aw_owner>" npm run backup -- --out /secure/backups
```

- يُجدوَل يومياً على ذلك الجهاز (cron)، ويظهر آخر نجاح في صفحة «القوائم والإعدادات».
- احفظ `BACKUP_KEY` في خزنة مفاتيح منفصلة عن النسخ، فضياعه يعني تعذر الاستعادة.

## ب. خادم داخلي

1. Node.js 22.9+، وPostgreSQL 14+ مع الإضافة pg_trgm.
2. `npm ci`، ثم `cp .env.example .env` وضبط القيم.
3. `npm run db:migrate && npm run db:seed && npm run admin:create`.
4. `npm run build && npm start` (المنفذ 3100) خلف وكيل عكسي بشهادة TLS.
5. للتنبيهات: `npm run job:notifications` كل ساعة (cron). للنسخ: `npm run backup` يومياً.
6. لتنزيل PDF من الخادم: ثبّت Chromium واضبط `CHROMIUM_PATH`.
