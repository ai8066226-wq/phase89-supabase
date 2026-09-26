import { karwaVerifyGooglePlaySubscription } from "./supabase-compat.js?v=117";

export const AMRNI_MONTHLY_PRODUCT_ID = "amrni_monthly_access";

export function subscriptionTimestampMillis(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (Number.isFinite(Number(value?.seconds))) return Number(value.seconds) * 1000;
  if (Number.isFinite(Number(value)) && Number(value) > 1000000000) {
    const n = Number(value);
    return n > 100000000000 ? n : n * 1000;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function subscriptionInfo(data = {}) {
  const role = String(data?.role || "");
  if (role === "admin") return { required:false, active:true, status:"admin", startedAt:0, expiresAt:0, remainingMs:Infinity };
  const startedAt = subscriptionTimestampMillis(data?.subscriptionStartedAt);
  const expiresAt = subscriptionTimestampMillis(data?.subscriptionExpiresAt);
  const status = String(data?.subscriptionStatus || "required").toLowerCase();
  const entitledFlag = data?.subscriptionEntitled === true;
  const activeState = ["active", "canceled", "cancelled", "grace"].includes(status);
  const active = entitledFlag && activeState && expiresAt > Date.now();
  return { required:true, active, status, startedAt, expiresAt, remainingMs:Math.max(0, expiresAt-Date.now()), autoRenewing:data?.subscriptionAutoRenewing===true };
}

export function hasActiveSubscription(data = {}) { return subscriptionInfo(data).active; }

function formatDate(ms) {
  if (!ms) return "—";
  try { return new Intl.DateTimeFormat("ar-IQ", {year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(ms)); }
  catch (_) { return new Date(ms).toLocaleString("ar-IQ"); }
}

function statusLabel(info) {
  if (!info.required) return "حساب إدارة";
  if (info.active && info.status === "grace") return "نشط • فترة سماح";
  if (info.active && ["canceled","cancelled"].includes(info.status)) return "نشط حتى نهاية المدة";
  if (info.active) return "اشتراك نشط";
  if (info.status === "pending") return "بانتظار إكمال الدفع";
  if (info.status === "on_hold") return "الدفع معلّق";
  if (info.status === "paused") return "الاشتراك متوقف مؤقتًا";
  if (info.expiresAt && info.expiresAt <= Date.now()) return "منتهي";
  return "الاشتراك مطلوب";
}

const runtime = {
  mounted:false,
  productPrice:"يُحدد في Google Play",
  billingPeriod:"شهري",
  context:null,
  queriedUid:"",
  verifying:false
};

function nativeAvailable() {
  try { return typeof window.KarwaNative?.purchaseMonthlySubscription === "function"; } catch (_) { return false; }
}

function render() {
  const ctx = runtime.context;
  if (!ctx) return;
  const data = ctx.getUserData?.() || {};
  const info = subscriptionInfo(data);
  const status = document.getElementById("subscriptionStatus");
  const start = document.getElementById("subscriptionStartedAt");
  const expiry = document.getElementById("subscriptionExpiresAt");
  const price = document.getElementById("subscriptionPrice");
  const notice = document.getElementById("subscriptionNotice");
  const button = document.getElementById("subscriptionButton");
  const restore = document.getElementById("subscriptionRestore");
  if (status) { status.textContent = statusLabel(info); status.dataset.active = info.active ? "true" : "false"; }
  if (start) start.textContent = formatDate(info.startedAt);
  if (expiry) expiry.textContent = formatDate(info.expiresAt);
  if (price) price.textContent = runtime.productPrice;
  if (notice) notice.textContent = info.active
    ? (info.autoRenewing ? "سيستمر حسابك بالعمل ما دام اشتراك Google Play صالحًا." : "الاشتراك فعّال حتى التاريخ الموضح، ثم يتوقف إنشاء الطلبات أو استقبالها حتى التجديد.")
    : "يلزم اشتراك شهري صالح عبر Google Play لاستخدام وظائف آمرني التشغيلية.";
  if (button) button.textContent = info.active ? "إدارة الاشتراك في Google Play" : "الاشتراك الشهري عبر Google Play";
  if (button) button.disabled = runtime.verifying;
  if (restore) restore.disabled = runtime.verifying;
  ctx.onRender?.(info);
}

async function verifyPurchase(detail) {
  const ctx = runtime.context;
  const user = ctx?.getUser?.();
  if (!user?.uid || runtime.verifying) return;
  const token = String(detail?.purchaseToken || "");
  if (!token) return;
  runtime.verifying = true; render();
  try {
    const result = await karwaVerifyGooglePlaySubscription(detail);
    const patch = {
      subscriptionStatus: result.status || "active",
      subscriptionEntitled: result.entitled === true,
      subscriptionProductId: result.productId || AMRNI_MONTHLY_PRODUCT_ID,
      subscriptionPlatform: "google_play",
      subscriptionStartedAt: result.startedAt || null,
      subscriptionExpiresAt: result.expiresAt || null,
      subscriptionAutoRenewing: result.autoRenewing === true,
      subscriptionVerifiedAt: result.verifiedAt || new Date().toISOString()
    };
    ctx.setUserData?.({ ...(ctx.getUserData?.() || {}), ...patch });
    ctx.toast?.(patch.subscriptionEntitled ? "تم تفعيل اشتراك آمرني بنجاح" : "تم تحديث حالة الاشتراك");
    ctx.onVerified?.(result);
  } catch (error) {
    console.error("Google Play subscription verification failed", error);
    ctx.toast?.("تعذر التحقق من اشتراك Google Play. تأكد من الحساب والاتصال ثم أعد المحاولة.");
  } finally {
    runtime.verifying = false; render();
  }
}

function bindOnce() {
  if (runtime.mounted) return;
  runtime.mounted = true;
  window.addEventListener("amrni-billing-product", event => {
    const detail = event?.detail || {};
    if (detail.productId && detail.productId !== AMRNI_MONTHLY_PRODUCT_ID) return;
    runtime.productPrice = detail.formattedPrice || runtime.productPrice;
    runtime.billingPeriod = detail.billingPeriod || runtime.billingPeriod;
    render();
  });
  window.addEventListener("amrni-billing-purchase", event => {
    const detail = event?.detail || {};
    if (detail.productId && detail.productId !== AMRNI_MONTHLY_PRODUCT_ID) return;
    const state = String(detail.state || "").toUpperCase();
    if (state === "PURCHASED") verifyPurchase(detail);
    else if (state === "PENDING") runtime.context?.toast?.("عملية الدفع ما زالت معلّقة في Google Play. سيتم التفعيل بعد اكتمالها.");
    else if (state === "NOT_OWNED") { render(); }
    else if (state === "CANCELED") runtime.context?.toast?.("تم إلغاء عملية الاشتراك.");
    else if (detail?.message) runtime.context?.toast?.(String(detail.message));
  });
  document.addEventListener("click", event => {
    const button = event.target?.closest?.("#subscriptionButton");
    if (!button) return;
    const ctx = runtime.context, user = ctx?.getUser?.(), info = subscriptionInfo(ctx?.getUserData?.() || {});
    if (!user?.uid) return ctx?.toast?.("سجّل الدخول أولًا");
    if (!nativeAvailable()) return ctx?.toast?.("الاشتراك متاح من تطبيق آمرني على Android عبر Google Play فقط.");
    try {
      if (info.active && typeof window.KarwaNative?.manageMonthlySubscription === "function") window.KarwaNative.manageMonthlySubscription();
      else window.KarwaNative.purchaseMonthlySubscription(user.uid);
    } catch (error) { console.error(error); ctx?.toast?.("تعذر فتح Google Play"); }
  });
  const refreshNativePurchase = () => {
    const ctx=runtime.context,user=ctx?.getUser?.();
    if(!user?.uid||!nativeAvailable())return;
    try{window.KarwaNative.queryMonthlySubscription(user.uid);}catch(_){}
  };
  globalThis.setInterval(refreshNativePurchase, 6*60*60*1000);
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")refreshNativePurchase();});
  window.addEventListener("online",refreshNativePurchase);

  document.addEventListener("click", event => {
    if (!event.target?.closest?.("#subscriptionRestore")) return;
    const ctx=runtime.context,user=ctx?.getUser?.();
    if(!user?.uid)return ctx?.toast?.("سجّل الدخول أولًا");
    if(!nativeAvailable())return ctx?.toast?.("استعادة الاشتراك متاحة من تطبيق Android فقط.");
    try{window.KarwaNative.queryMonthlySubscription(user.uid);ctx?.toast?.("جارٍ التحقق من مشتريات Google Play…");}catch(error){console.error(error);}
  });
}

export function mountSubscriptionUi(context = {}) {
  runtime.context = context;
  bindOnce();
  render();
  const user=context.getUser?.();
  if(user?.uid && nativeAvailable() && runtime.queriedUid!==user.uid){
    runtime.queriedUid=user.uid;
    try{window.KarwaNative.queryMonthlySubscription(user.uid);}catch(error){console.warn(error);}
  }
  return subscriptionInfo(context.getUserData?.() || {});
}

export function renderSubscriptionUi() { render(); }
