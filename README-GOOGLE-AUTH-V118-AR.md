# آمرني v118 / 2.10.0 — التسجيل بحساب Google على Android

## ما تم تنفيذه

- العميل والكابتن ومزود الخدمة يبدأ إنشاء حسابه باختيار حساب Google الموجود على الهاتف.
- لا توجد كلمة مرور جديدة أثناء التسجيل عبر Google.
- يتم استخدام Android Credential Manager ثم تمرير Google ID Token إلى Supabase Auth.
- يستخدم التطبيق nonce عشوائيًا؛ يرسل SHA-256 منه إلى Google، ويرسل القيمة الأصلية إلى Supabase للتحقق.
- يبقى تسجيل الدخول بالبريد وكلمة المرور للحسابات القديمة فقط.
- Google Web Client ID يمكن تغييره من لوحة الإدارة > الاشتراك والتسعير.

## إعداد مطلوب مرة واحدة قبل التشغيل الحقيقي

1. في Google Auth Platform أنشئ OAuth Client من نوع **Web application**. هذا هو Web Client ID الذي سيستخدمه Android للحصول على ID Token مخصص للخادم.
2. أنشئ أيضًا OAuth Client من نوع **Android** للحزمة `com.razi.karwa` وأضف SHA-1 لشهادة التوقيع الفعلية المستخدمة في Google Play. إذا كنت تختبر بتوقيع مختلف، أضف SHA-1 لذلك التوقيع أيضًا.
3. في Supabase > Authentication > Providers > Google فعّل Google وأضف Web Client ID وClient Secret. إذا أضفت أكثر من Client ID فضع Web Client ID أولًا كما توصي وثائق Supabase.
4. من لوحة إدارة آمرني > **الاشتراك والتسعير** الصق Web Client ID في حقل **Google Web Client ID** واحفظ.
5. اختبر على جهاز Android عليه حساب Google. اضغط «إنشاء حساب» واختر الحساب، ثم أكمل رقم الهاتف وبيانات الدور.

## ملاحظات مهمة

- OAuth Client ID ليس سرًا ويمكن وجوده في إعدادات التطبيق، أما Client Secret فيبقى داخل إعداد Supabase/Google ولا يوضع داخل Android أو JavaScript.
- Sign in with Google لا يعني قراءة Gmail. التطبيق يستخدم هوية Google والبريد والاسم فقط للمصادقة ولا يطلب صلاحية قراءة الرسائل.
- Google لم تعد توصي بالاعتماد على رقم الهاتف القادم من Google ID credential؛ لذلك يطلب آمرني رقم الهاتف من المستخدم ويخزنه عبر مسار Supabase الحالي.
