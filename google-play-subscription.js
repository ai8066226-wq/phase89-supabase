import { karwaVerifyGooglePlaySubscription } from "./supabase-compat.js?v=120";
import { subscriptionInfo, subscriptionDate } from "./monthly-subscription.js?v=122";

const PRODUCT_ID = "amrni_monthly_access";
let context = null;
let queriedUser = "";
let verifying = false;
let playPrice = "يحدده Google Play";
let trialEligible = null;

function nativeBilling() {
  return typeof window.KarwaNative?.purchaseMonthlySubscription === "function";
}

function show() {
  if (!context) return;
  const info = subscriptionInfo(context.getData() || {});
  const panel = document.getElementById(context.panelId);
  if (!panel) return;
  panel.querySelector("[data-play-price]").textContent = playPrice;
  panel.querySelector("[data-play-trial]").textContent = info.active
    ? `اشتراكك صالح حتى ${subscriptionDate(info.expires)}. يمكنك إدارته أو إلغاء تجديده من Google Play.`
    : trialEligible === false
    ? "لا تتوفر فترة تجريبية لهذا الحساب؛ راجع السعر قبل تأكيد الاشتراك في Google Play."
    : trialEligible === true
      ? "تجربة مجانية لمدة ١٤ يومًا. يبدأ الدفع الشهري بعدها حسب السعر الموضح في Google Play؛ ويمكنك الإلغاء من حسابك."
      : "تجربة مجانية لمدة ١٤ يومًا للحسابات المؤهلة؛ يُعرض السعر الشهري وشروط التجديد قبل تأكيد الشراء في Google Play.";
  panel.querySelector("[data-play-action]").textContent = info.active ? "إدارة الاشتراك في Google Play" : "الاشتراك عبر Google Play";
  panel.querySelector("[data-play-action]").disabled = verifying;
  panel.querySelector("[data-play-restore]").disabled = verifying;
  panel.querySelector("[data-play-platform]").textContent = nativeBilling() ? "الدفع والتجديد عبر Google Play" : "افتح تطبيق آمرني على Android للاشتراك";
  if (context.statusId) document.getElementById(context.statusId).textContent = info.active ? "نشط" : info.expires ? "منتهي" : "بانتظار التفعيل";
  if (context.priceId) document.getElementById(context.priceId).textContent = playPrice;
  if (context.startedId) document.getElementById(context.startedId).textContent = subscriptionDate(info.started);
  if (context.expiresId) document.getElementById(context.expiresId).textContent = subscriptionDate(info.expires);
}

async function verify(detail) {
  if (verifying || !context?.getUser()?.uid || !detail?.purchaseToken) return;
  verifying = true; show();
  try {
    const result = await karwaVerifyGooglePlaySubscription(detail);
    context.updateData({
      subscriptionProductId: PRODUCT_ID,
      subscriptionPlatform: "google_play",
      subscriptionStatus: result.status,
      subscriptionEntitled: result.entitled === true,
      subscriptionStartedAt: result.startedAt,
      subscriptionExpiresAt: result.expiresAt,
      subscriptionAutoRenewing: result.autoRenewing === true
    });
    context.toast(result.entitled ? "تم تفعيل الاشتراك؛ يمكنك الآن قبول الطلبات." : "يمكنك رؤية الطلبات، ويُتاح قبولها بعد التفعيل.");
  } catch (error) {
    console.error("تعذر التحقق من اشتراك Google Play", error);
    context.toast("تعذر التحقق من عملية Google Play. تأكد من الاتصال وأعد استعادة الشراء.");
  } finally { verifying = false; show(); }
}

window.addEventListener("amrni-billing-product", event => {
  const detail = event.detail || {};
  if (detail.productId !== PRODUCT_ID) return;
  playPrice = detail.formattedPrice ? `${detail.formattedPrice}${detail.billingPeriod === "P1M" ? " / شهر" : ""}` : playPrice;
  trialEligible = detail.trialEligible === true;
  show();
});
window.addEventListener("amrni-billing-purchase", event => {
  const detail = event.detail || {};
  if (detail.productId !== PRODUCT_ID) return;
  if (detail.state === "PURCHASED") verify(detail);
  else if (detail.state === "PENDING") context?.toast("الشراء قيد المعالجة في Google Play؛ يبدأ الاشتراك بعد اكتماله.");
  else if (detail.state === "CANCELED") context?.toast("أُلغيت عملية الشراء.");
  else if (detail.state === "UNAVAILABLE") context?.toast("الاشتراك غير متاح لهذا الحساب في Google Play حاليًا.");
  else if (detail.state === "ERROR") context?.toast("تعذر الاتصال بـ Google Play؛ أعد المحاولة.");
});

document.addEventListener("click", event => {
  const action = event.target.closest?.("[data-play-action], [data-play-restore]");
  if (!action || !context || !document.getElementById(context.panelId)?.contains(action)) return;
  const uid = context.getUser()?.uid;
  if (!uid) return context.toast("سجّل الدخول أولًا.");
  if (!nativeBilling()) return context.toast("الاشتراك واستعادة الشراء متاحان من تطبيق Android عبر Google Play.");
  if (action.matches("[data-play-restore]")) {
    window.KarwaNative.queryMonthlySubscription(uid);
    context.toast("جارٍ التحقق من مشتريات Google Play…");
  } else if (subscriptionInfo(context.getData() || {}).active) window.KarwaNative.manageMonthlySubscription();
  else window.KarwaNative.purchaseMonthlySubscription(uid);
});

function refresh() {
  const uid = context?.getUser()?.uid;
  if (uid && nativeBilling()) window.KarwaNative.queryMonthlySubscription(uid);
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
window.addEventListener("online", refresh);
setInterval(refresh, 6 * 60 * 60 * 1000);

export function renderGooglePlaySubscription(config) {
  context = config;
  show();
  const uid = context.getUser()?.uid;
  if (!uid) queriedUser = "";
  else if (uid !== queriedUser && nativeBilling()) { queriedUser = uid; refresh(); }
}
