# منصة التنقّل المجدول

منصة متعددة الشركاء لاشتراكات التنقّل اليومي (طلاب، موظفون)، يشغّلها شريك نقل مرخّص من الهيئة العامة للنقل، والمنصة مزوّد التقنية.

| الجزء | المجلد | التقنية |
| --- | --- | --- |
| الخادم (API) | `apps/api` | NestJS، PostgreSQL + PostGIS، Redis |
| لوحة التشغيل | `apps/admin` | Next.js (عربي/إنجليزي) |
| تطبيق الراكب | `apps/rider_app` | Flutter |
| تطبيق السائق | `apps/driver_app` | Flutter |
| الكود المشترك للتطبيقين | `packages/mobile_core` | Flutter |
| عقد الواجهات | `packages/contracts/openapi.json` | OpenAPI، يُولَّد من الخادم |

## الحالة

- **المرحلة 2 مكتملة:** السائقون والمركبات ووثائقهم ومراجعتها، نطاقات الخدمة على الخريطة، الباقات، والفحص اليومي لانتهاء الوثائق. التفاصيل في `docs/phase-2.md`.
- **المرحلة 1 مكتملة:** الأساس، وتفاصيلها أدناه وفي `docs/phase-1.md`.

### المرحلة 1 (الأساس)

- تسجيل الدخول برمز تحقق SMS للتطبيقات الثلاثة، مع حسابات منفصلة لكل تطبيق لنفس الرقم.
- جلسات آمنة: رمز وصول قصير (15 دقيقة) ورمز تجديد يتبدّل مع كل استخدام؛ إعادة استخدام رمز قديم تُنهي الجلسة كلها.
- تسجيل الخروج من جهاز واحد أو من كل الأجهزة، ويسري فورا.
- الأدوار: راكب، سائق، منسق تشغيل، مدير شريك، مدير المنصة.
- عزل بيانات كل شريك؛ لا يرى فريق شريك بيانات شريك آخر.
- سجل تدقيق لكل تعديل إداري (من، ماذا، قبل، بعد).
- حدود للطلبات والرموز، رسائل أخطاء موحّدة بالعربية والإنجليزية.
- لوحة تشغيل: دخول برمز التحقق، إدارة الشركاء، إدارة الفريق (إضافة، ترقية، إيقاف).
- تطبيقا الراكب والسائق: دخول برمز التحقق، تجديد الجلسة تلقائيا، الاسم واللغة، تسجيل الخروج.
- اختبارات آلية للخادم واللوحة والتطبيقات، وخط CI.

## التشغيل محليا

المتطلبات: Node.js 22، pnpm 10، Docker، Flutter 3.24+.

```bash
pnpm install
docker compose -f infra/docker-compose.yml up -d     # PostgreSQL+PostGIS و Redis

cp apps/api/.env.example apps/api/.env               # ثم عدّل الأسرار ورقم مدير المنصة
pnpm --filter @ride/api db:migrate:dev
pnpm --filter @ride/api db:seed:dev -- --demo        # مدير المنصة + شريك تجريبي (رمز الانضمام DEMO26) + نطاق وباقة
pnpm dev:api                                         # http://localhost:3000  (التوثيق: /docs)

cp apps/admin/.env.example apps/admin/.env.local
pnpm dev:admin                                       # http://localhost:3001
```

في بيئة التطوير تُطبع رموز التحقق في سجل الخادم. لأرقام الاختبار حدّد `OTP_TEST_PHONES` و`OTP_TEST_CODE` في `.env`.

### التطبيقات

أول مرة فقط، داخل كل تطبيق، أنشئ مجلدات المنصات (لن يغيّر `lib/`):

```bash
cd apps/rider_app
flutter create --platforms=android,ios --org sa.yourcompany --project-name rider_app .
flutter pub get
flutter run --dart-define=API_URL=http://10.0.2.2:3000     # محاكي أندرويد
```

وكرر الأمر نفسه في `apps/driver_app` مع `--project-name driver_app`.

## الاختبارات

```bash
pnpm --filter @ride/api test        # يحتاج قاعدة ride_test و Redis
pnpm --filter @ride/admin test
cd packages/mobile_core && flutter test
```

## قبل الإنتاج

- مزوّد رسائل SMS حقيقي: الخادم يرفض العمل في الإنتاج بمزوّد الطباعة. أضف المزوّد في `apps/api/src/auth/sms/sms.provider.ts`.
- أسرار قوية ومختلفة لكل بيئة (`JWT_ACCESS_SECRET`, `HASH_PEPPER`).
- `COOKIE_SECURE=true` للوحة خلف HTTPS، و`CORS_ORIGINS` بعنوان اللوحة فقط.

تفاصيل البنية والقرارات في `docs/`.
