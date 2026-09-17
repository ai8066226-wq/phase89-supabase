# كروة — Phase 88 — الانتقال إلى Supabase

هذه المرحلة تنقل Auth وبيانات التطبيق وRealtime وStorage إلى مشروع Supabase الخاص بك.

- Project ref: `ndrcopijnkbpfrxzafzk`
- الواجهة تستخدم `supabase-compat.js` لتشغيل منطق Firestore الحالي فوق جدول `karwa_documents` مؤقتًا.
- تسجيل الحسابات الجديدة يمر عبر Edge Function `public-signup`.
- حذف الحساب يمر عبر Edge Function `delete-self`.
- صور الخدمات تستخدم bucket `service-assets` (WebP بحد 50KB).
- `firebase-messaging-sw.js` بقي فقط لخدمة إشعارات FCM الحالية، وليس لقاعدة البيانات أو Auth أو Storage.

## مهم قبل الإنتاج
جسر التوافق هدفه تسريع الانتقال واختبار الواجهات. العمليات المالية والحساسة يجب نقلها لاحقًا إلى RPC/Edge Functions مخصصة قبل اعتماد النظام للإنتاج، بدل الاعتماد على منطق العميل.
