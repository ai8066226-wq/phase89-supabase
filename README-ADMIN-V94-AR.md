إصلاح Phase 90.4 / v94 — دخول الإدارة

السبب: Supabase يحذر حاليًا من deadlock إذا تم تنفيذ أي استدعاء Supabase غير متزامن داخل onAuthStateChange.
كان admin.js يفحص karwa_is_admin ويشغّل Realtime من داخل callback نفسه.

الإصلاح:
- onAuthStateChanged أصبح متزامنًا بالكامل.
- كل فحوص admin وRealtime وpush تبدأ بعد رجوع callback عبر setTimeout(0).
- صفحة الإدارة تبقى معزولة عن PWA كما في v93.
- لا تغيير على الحسابات أو كلمات المرور.

ارفع الملفات الخمسة إلى جذر المستودع واستبدل القديمة، ثم Commit changes.
افتح admin.html?v=94 وجرب الدخول.
