# النشر

يمكن تشغيل المنصة بطريقتين دون ارتباط حصري بمزود واحد. الشيفرة نفسها تعمل على الطريقتين.

## أ. خادم الهيئة الداخلي (Docker)

> **تنبيه:** كُتب `Dockerfile` و`docker-compose.yml`، ونجح البناء الإنتاجي (`npm run build`) والتشغيل (`npm start`) واختبارات الواجهة على الخادم نفسه. أما بناء صورة Docker فلم يُختبر بعد، لأن خدمة Docker غير متاحة في بيئة التطوير الحالية. يجب التحقق منه على خادم فيه Docker (`docker compose up -d --build`) قبل اعتماده.

1. ثبّت Docker وDocker Compose على الخادم.
2. `cp .env.example .env`، ثم اضبط فيه: `POSTGRES_PASSWORD` و`APP_SECRET` (توليد: `openssl rand -base64 48`) و`CRON_SECRET` و`APP_URL=https://<النطاق>`.
3. `docker compose up -d --build`. تُطبَّق الترحيلات تلقائياً عند بدء الحاوية.
4. `docker compose exec app npx tsx prisma/seed.ts`
5. `docker compose exec -it app npx tsx scripts/create-admin.ts`
6. **الوصول الخارجي الآمن:** التطبيق مربوط على `127.0.0.1:3000` فقط. ضع أمامه وكيلاً عكسياً (nginx أو Caddy) بشهادة TLS:

```nginx
server {
  listen 443 ssl http2;
  server_name violations.example.gov.iq;
  ssl_certificate     /etc/ssl/cmc/fullchain.pem;
  ssl_certificate_key /etc/ssl/cmc/privkey.pem;
  client_max_body_size 30m;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;   # استبدال، لا إضافة
    proxy_set_header X-Forwarded-Proto https;
  }
}
server { listen 80; return 301 https://$host$request_uri; }
```

   ويُوصى بأن يقتصر الوصول من خارج الشبكة على VPN الهيئة، أو على قائمة عناوين مسموح بها في الجدار الناري.

## ب. Netlify + Supabase

1. **Supabase:** أنشئ مشروعاً، ومن **Database → Connection string** خذ:
   - `DATABASE_URL`: رابط Transaction pooler (المنفذ 6543) مع `?pgbouncer=true&connection_limit=1`
   - `DIRECT_DATABASE_URL`: الرابط المباشر أو Session pooler (المنفذ 5432)، لتشغيل الترحيلات
2. **التخزين:** دوال Netlify لا تملك قرصاً دائماً، فيجب `STORAGE_DRIVER=s3`. يمكن استخدام Supabase Storage عبر واجهته المتوافقة مع S3: أنشئ حاوية **خاصة** (Private)، ومفاتيح S3 من **Storage → Settings**، واضبط `S3_ENDPOINT` و`S3_REGION` و`S3_BUCKET` و`S3_ACCESS_KEY_ID` و`S3_SECRET_ACCESS_KEY`.
3. **Netlify:** اربط المستودع. الإعداد موجود في `netlify.toml`: يشغّل `prisma migrate deploy` ثم البناء. أضف متغيرات البيئة كلها من **Site configuration → Environment variables**.
4. بعد أول نشر، نفّذ الزرع وإنشاء المدير من جهاز إداري موثوق، مع ضبط `DATABASE_URL` على الرابط المباشر:

```bash
DATABASE_URL="<direct-url>" npm run db:seed
DATABASE_URL="<direct-url>" npm run admin:create
```

5. **المهام المجدولة:** دالة Netlify مجدولة لتحديث المدد والتنبيهات (تُضاف في الجزء 4).

> سيُنفَّذ النشر الفعلي على Netlify وSupabase ويُتحقق منه في الجزء 8. هذا القسم سيُحدَّث برابط النشر الفعلي وبنتائج التحقق.

## النسخ الاحتياطي والاستعادة

تُضاف سكربتات النسخ الاحتياطي المشفّر واختبار الاستعادة في الجزء 8.
