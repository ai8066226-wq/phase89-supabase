# إصلاح دخول الإدارة v92

استبدل الملفات التالية في جذر مستودع phase89-supabase ثم نفّذ Commit changes:

- admin.html
- admin.js
- pwa.js
- sw.js
- version.json

الإصلاح يلغي سباق تسجيل الدخول المزدوج، ويتحقق من صلاحية الإدارة عبر Supabase RPC مع إعادة المحاولة، ولا يسمح لخطأ في الخريطة أو Realtime بترك صفحة الإدارة فارغة.
