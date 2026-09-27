import { signInWithGoogleIdToken } from "./supabase-compat.js?v=118";

function nativeBridge() { return globalThis.KarwaNative || null; }
function requestId() {
  try { return `google_${Date.now()}_${crypto.randomUUID().replace(/-/g, "")}`; }
  catch (_) { return `google_${Date.now()}_${Math.random().toString(36).slice(2)}`; }
}
export function googleWebClientId(settings = {}) { return String(settings?.googleWebClientId || "").trim(); }
export function googleRegistrationMessage(error) {
  const code = String(error?.code || error?.message || "");
  if (code.includes("google/client-id-required")) return "لم يتم ضبط Google Web Client ID بعد. أضفه من لوحة الإدارة > الاشتراك والتسعير.";
  if (code.includes("native-required")) return "إنشاء الحساب عبر Google متاح من تطبيق آمرني على Android.";
  if (code.includes("NoCredential") || code.includes("TYPE_NO_CREDENTIAL")) return "لم يتم العثور على حساب Google جاهز على الهاتف. أضف حساب Google للجهاز ثم حاول مجددًا.";
  if (code.includes("Cancellation") || code.includes("cancel")) return "تم إلغاء اختيار حساب Google.";
  if (code.includes("google-token") || code.includes("invalid") || code.includes("provider")) return "تعذر التحقق من حساب Google. تحقق من إعداد Google في Supabase وGoogle Cloud.";
  return error?.message || "تعذر إنشاء الحساب باستخدام Google. حاول مرة أخرى.";
}
export async function nativeGoogleRegistration(auth, settings = {}, purpose = "register") {
  const bridge = nativeBridge();
  if (!bridge?.beginGoogleSignIn) { const e = new Error("GOOGLE_NATIVE_REQUIRED"); e.code = "google/native-required"; throw e; }
  const clientId = googleWebClientId(settings);
  if (!clientId || !clientId.endsWith(".apps.googleusercontent.com")) { const e = new Error("GOOGLE_CLIENT_ID_REQUIRED"); e.code = "google/client-id-required"; throw e; }
  const id = requestId();
  const nativeResult = await new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => { window.removeEventListener("karwa-google-auth-result", handler); clearTimeout(timer); };
    const handler = event => {
      const detail = event?.detail || {};
      if (String(detail.requestId || "") !== id || settled) return;
      settled = true; cleanup();
      if (!detail.ok) { const e = new Error(detail.message || detail.errorCode || "GOOGLE_SIGN_IN_FAILED"); e.code = `google/${detail.errorCode || "sign-in-failed"}`; reject(e); return; }
      resolve(detail);
    };
    const timer = window.setTimeout(() => { if (settled) return; settled = true; cleanup(); const e = new Error("GOOGLE_SIGN_IN_TIMEOUT"); e.code = "google/timeout"; reject(e); }, 90000);
    window.addEventListener("karwa-google-auth-result", handler);
    try { bridge.beginGoogleSignIn(id, clientId); }
    catch (error) { settled = true; cleanup(); const e = new Error(error?.message || "GOOGLE_SIGN_IN_FAILED"); e.code = "google/native-failed"; reject(e); }
  });
  const credential = await signInWithGoogleIdToken(auth, nativeResult.idToken, nativeResult.nonce || "");
  return { ...credential, google: { ...nativeResult, purpose } };
}
