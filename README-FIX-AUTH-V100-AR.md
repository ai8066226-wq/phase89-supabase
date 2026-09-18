# إصلاح تسجيل العميل داخل تطبيق Android — v100

## المشكلة
نسخة الويب كانت تستطيع تسجيل الدخول وإنشاء الحساب، بينما تطبيق Android يعمل من أصل WebView محلي (`https://appassets.androidplatform.net`). دالة `public-signup` كانت مقيدة بأصول الويب، كما أن الاعتماد على طلبات Auth من داخل WebView يجعل التسجيل حساسًا لاختلافات CORS/WebView.

## الإصلاح
- أضيف transport أصلي داخل تطبيق Android لطلبات Supabase Authentication و`public-signup`.
- `supabase-compat.js` يستخدم المسار الأصلي تلقائيًا داخل Android، ويستخدم `fetch` المعتاد على الويب.
- تم منع الاستضافة البعيدة من استبدال `supabase-compat.js` داخل Android حتى يبقى إصلاح المصادقة المضمن هو المستخدم دائمًا.
- تم الحفاظ على نفس Supabase project والمفتاح publishable؛ لا يوجد `service_role` داخل التطبيق.
- تم رفع cache busting إلى v100.

## النتيجة
تسجيل الدخول وإنشاء حساب العميل من التطبيق لا يعتمدان على CORS الخاص بـ WebView، بينما الرابط/المتصفح يستمران بالعمل بالطريقة السابقة.
