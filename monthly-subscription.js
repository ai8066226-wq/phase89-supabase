export function subscriptionTimestamp(value){
  if(!value)return 0;
  if(typeof value.toMillis==="function")return value.toMillis();
  if(Number.isFinite(Number(value.seconds)))return Number(value.seconds)*1000;
  const parsed=new Date(value).getTime();return Number.isFinite(parsed)?parsed:0;
}
export function subscriptionInfo(data={},now=Date.now()){
  const started=subscriptionTimestamp(data.subscriptionStartedAt);
  const expires=subscriptionTimestamp(data.subscriptionExpiresAt);
  const active=data.subscriptionEntitled===true && expires>now && ["active","canceled","grace"].includes(String(data.subscriptionStatus||""));
  return {active,started,expires,status:active?"نشط":expires>0?"منتهي":"غير مشترك"};
}
export function subscriptionDate(ms){
  return ms?new Intl.DateTimeFormat("ar-IQ",{year:"numeric",month:"long",day:"numeric"}).format(ms):"—";
}
export function monthlyPrice(settings={}){
  const n=Number(settings.monthlySubscriptionFee);
  return Number.isFinite(n)&&n>=5000&&n<=1000000?n:5000;
}
export function subscriptionError(error){
  const message=String(error?.message||"").toUpperCase();
  if(message.includes("TOPUP_PENDING"))return "يوجد طلب اشتراك قيد المراجعة. انتظر قرار الإدارة.";
  if(message.includes("TOPUP_TRANSFER_DISABLED"))return "التحويل متوقف حاليًا من الإدارة. جرّب كرت الاشتراك.";
  if(message.includes("TOPUP_CARD_METHOD_DISABLED"))return "كروت الاشتراك متوقفة حاليًا من الإدارة.";
  if(message.includes("TOPUP_CARD_USED"))return "هذا الكرت مستخدم مسبقًا.";
  if(message.includes("SUBSCRIPTION_CARD_AMOUNT_MISMATCH"))return "قيمة الكرت لا تطابق سعر الاشتراك الشهري الحالي.";
  if(message.includes("INVALID_TOPUP_CARD"))return "رمز الكرت غير صحيح أو غير موجود.";
  if(message.includes("MONTHLY_PRICE_INVALID"))return "سعر الاشتراك غير مضبوط. راجع الإدارة.";
  if(message.includes("SUBSCRIPTION_REQUIRED"))return "انتهى اشتراكك الشهري. جدّده لاستقبال الطلبات الجديدة.";
  if(message.includes("TOPUP_ALREADY_REVIEWED"))return "سبق اتخاذ قرار بشأن هذا الطلب.";
  return "تعذر إتمام الاشتراك الآن. تحقق من الاتصال وحاول مجددًا.";
}
