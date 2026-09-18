# إصلاح تسجيل العميل — v99

## المشكلة
كان `app.js` يشغّل استعلامات Supabase داخل callback قادم مباشرة من `client.auth.onAuthStateChange`. وفق توثيق Supabase، تنفيذ API async داخل هذا callback قد يؤدي إلى deadlock، فتظل عملية تسجيل الدخول معلقة ولا تعود.

## ما تم إصلاحه
1. `supabase-compat.js`: أصبحت callbacks الخاصة بالمصادقة تُرسل عبر `setTimeout(..., 0)` قبل السماح لكود التطبيق بتنفيذ أي استعلام Supabase.
2. `device-binding.js`: تم توحيد مرجع `supabase-compat.js` إلى v99 بدل تحميل نسخة ثانية بسبب اختلاف query string.
3. `index.html`, `driver.html`, `services.html`, `admin.html`, `sw.js`: تم رفع cache-busting إلى v99.
4. `version.json`: إصدار الويب 2.8.9 مع وصف الإصلاح.
5. نفس ملفات الويب المصلحة مضمنة داخل مشروع Android v99.

## Supabase
تم التحقق من المشروع `ndrcopijnkbpfrxzafzk`: المشروع نشط، المفتاح publishable صحيح، `public-signup` فعالة، وملفات Auth/Profiles متطابقة. لا توجد Migration مطلوبة لهذا الإصلاح.
