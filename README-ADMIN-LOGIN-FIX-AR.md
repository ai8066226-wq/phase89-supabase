تحديث Phase 90.1 — إصلاح دخول الإدارة

استبدل في جذر المستودع الملفات التالية:
- admin.html
- admin.js
- sw.js
- version.json

بعد الرفع اعمل Commit changes ثم افتح admin.html من جديد.
الإصلاح يجعل التحقق من صلاحية الإدارة يبدأ مباشرة من public.profiles ثم يستخدم users/{uid} كمسار توافق، ولا يعتمد على وصول Realtime قبل فتح اللوحة.
