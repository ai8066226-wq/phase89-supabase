import { initializeApp } from "./supabase-compat.js?v=107";
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from "./supabase-compat.js?v=107";
import {
  collection,
  doc,
  getDoc,
  getSupabase,
  onSnapshot,
  subscribeGlobalPricing,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  karwaSensitiveAction,
  karwaProviderCancelRequest,
  karwaProviderBackfillPickupOtp,
  karwaRedeemTopupCard
} from "./supabase-compat.js?v=107";
import { deleteObject, getDownloadURL, getStorage, ref as storageRef, uploadBytes } from "./supabase-compat.js?v=107";
import { requireNativeRegistrationDevice, addDeviceRegistrationWrites, enforceDeviceSession } from "./device-binding.js?v=107";

const app = initializeApp({ backend: "supabase", project: "karwa" }, "karwa-services-portal-v4");
const auth = getAuth(app);
const db = getSupabase(app);
const storage = getStorage(app);

async function registerServiceNativePushToken(user){
  if(!user)return false;let token="";try{token=String(window.KarwaNative?.getPushToken?.()||window.KarwaNotify?.getNativePushToken?.()||"").trim()}catch{}if(!token)return false;
  const id=`android_${token.slice(-36).replace(/[^a-zA-Z0-9_-]/g,"_")}`;
  try{await setDoc(doc(db,"users",user.uid,"pushTokens",id),{token,platform:"android",app:"karwa",role:"service",updatedAt:serverTimestamp()},{merge:true});return true}catch(error){console.warn("تعذر تسجيل رمز إشعارات الخدمات",error);return false}
}
window.addEventListener("karwa-native-push-token",()=>{if(auth.currentUser)registerServiceNativePushToken(auth.currentUser)});

try {
  await setPersistence(auth, browserLocalPersistence);
} catch (error) {
  console.warn("تعذر تفعيل حفظ جلسة مزود الخدمة", error);
}

const byId = id => document.getElementById(id);
const views = ["loadingView", "authView", "applicationView", "providerView", "deniedView"];
const categories = {
  restaurant: "مطعم ومأكولات",
  grocery: "بقالة ومتجر غذائي",
  retail: "تسوق ومنتجات",
  maintenance: "صيانة وإصلاح",
  home: "خدمات منزلية",
  health: "صحة وعناية",
  other: "خدمة أخرى"
};
const categoryAliases = Object.fromEntries(Object.entries(categories).flatMap(([key,label]) => [[key,key],[label,key]]));
function normalizeCategory(value) { const clean=String(value||"").trim().replace(/\s+/g," "); return categoryAliases[clean] || clean; }
function categoryLabel(value) { return categories[value] || String(value || "مهنة غير محددة"); }

let currentUser = null;
let currentUserData = null;
let currentApplication = null;
let currentProfile = null;
let providerItems = [];
let providerRequests = [];
let providerLocation = null;
let providerCoverImage = null;
let draftItemImage = null;
let editingItemIndex = -1;
let imageLibraryTarget = "item";
let imageLibraryFilter = "all";
let registrationLocation = null;
let editApplicationLocation = null;
let authMode = new URLSearchParams(location.search).get("mode") === "register" ? "register" : "login";
let activeRole = "";
let roleUnsubscribe = null;
let contentUnsubscribe = null;
let requestsUnsubscribe = null;
let topupUnsubscribe = null;
let serviceTopupRequests = [];
let serviceTopupSnapshotReady = false;
const pickupOtpBackfillIds = new Set();
let pricingSettings = {};

function fixedFee(key,fallback){const n=Number(pricingSettings?.[key]);return Math.max(0,Math.min(100000,Math.round(Number.isFinite(n)?n:fallback)));}
function providerOperationFee(requestOrCategory){
  const category=typeof requestOrCategory==="string"?requestOrCategory:String(requestOrCategory?.providerCategory||requestOrCategory?.category||currentProfile?.category||"");
  const legacy=fixedFee("providerOrderFee",250);
  return category==="restaurant"?fixedFee("providerRestaurantFee",legacy):fixedFee("providerServiceFee",legacy);
}
function timestampMillis(value){if(!value)return 0;if(typeof value.toMillis==="function")return value.toMillis();if(Number.isFinite(Number(value?.seconds)))return Number(value.seconds)*1000;const t=new Date(value).getTime();return Number.isFinite(t)?t:0;}
function activeBonusAmount(data={}){const amount=Math.max(0,Number(data.bonusBalance||0));return amount>0&&timestampMillis(data.bonusExpiresAt)>Date.now()?amount:0;}
function walletAvailable(data=currentUserData||{}){return Math.max(0,Number(data?.balance||0))+activeBonusAmount(data||{});}
function walletDebitPatch(data,amount){const fee=Math.max(0,Math.round(Number(amount||0)));const paid=Math.max(0,Number(data?.balance||0));const bonus=activeBonusAmount(data||{});if(paid+bonus<fee)return null;const useBonus=Math.min(bonus,fee);return {balance:paid-(fee-useBonus),bonusBalance:Math.max(0,Number(data?.bonusBalance||0)-useBonus),updatedAt:serverTimestamp()};}
function signupBonusFields(settings=pricingSettings||{}){const enabled=settings.signupBonusEnabled!==false;const amount=enabled?Math.max(0,Math.round(Number(settings.signupBonusAmount??1000))):0;const hours=Math.max(1,Math.min(168,Math.round(Number(settings.signupBonusHours??24))));return {bonusBalance:amount,bonusExpiresAt:amount?new Date(Date.now()+hours*3600000):null,welcomeBonusGranted:amount>0,welcomeBonusEvaluated:true};}
function serviceTransferTopupEnabled(){return pricingSettings?.topupTransferEnabled!==false;}
function serviceCardTopupEnabled(){return pricingSettings?.topupCardEnabled!==false;}
function renderServiceTopupMethods(){
  const transfer=serviceTransferTopupEnabled(),card=serviceCardTopupEnabled();
  if(byId("serviceTransferTopupMethod"))byId("serviceTransferTopupMethod").hidden=!transfer;
  if(byId("serviceCardTopupMethod"))byId("serviceCardTopupMethod").hidden=!card;
  if(byId("serviceTopupMethodsDisabled"))byId("serviceTopupMethodsDisabled").hidden=transfer||card;
  [byId("serviceTopupCardCode"),byId("serviceRedeemTopupCard")].forEach(el=>{if(el)el.disabled=!card;});
  updateServiceTopupFormState();
}
function renderServiceWallet(){
  const value=`${walletAvailable().toLocaleString("ar-IQ")} د.ع`;
  if(byId("serviceWalletBalance"))byId("serviceWalletBalance").textContent=value;
  if(byId("serviceWalletMetric"))byId("serviceWalletMetric").textContent=value;
  const bonus=activeBonusAmount(currentUserData||{}),bonusStatus=byId("serviceBonusStatus");
  if(bonusStatus)bonusStatus.textContent=bonus>0?`مجاني ${bonus.toLocaleString("ar-IQ")} د.ع حتى ${new Date(timestampMillis(currentUserData?.bonusExpiresAt)).toLocaleString("ar-IQ")}`:"الرصيد المشحون";
  if(byId("serviceTopupTransferLabel"))byId("serviceTopupTransferLabel").textContent=pricingSettings.topupTransferLabel||"Mastercard محلي";
  if(byId("serviceTopupTransferId"))byId("serviceTopupTransferId").textContent=pricingSettings.topupTransferId||"أضف معرف التحويل من الإدارة";
  if(byId("serviceTopupCardHolder"))byId("serviceTopupCardHolder").textContent=pricingSettings.topupCardHolder||"إدارة كروة";
  renderServiceTopupMethods();
  if(byId("serviceFeeSummary")){
    const publish=fixedFee("publishFee",1000).toLocaleString("ar-IQ");
    const restaurant=providerOperationFee("restaurant").toLocaleString("ar-IQ");
    const service=providerOperationFee("other").toLocaleString("ar-IQ");
    byId("serviceFeeSummary").textContent=`نشر ${publish} د.ع • مطعم ${restaurant} د.ع • خدمات ${service} د.ع`;
  }
  renderServiceTopupRequests();
}
function serviceHasPendingTopup(){return serviceTopupRequests.some(x=>(x.status||"pending")==="pending");}
function updateServiceTopupFormState(){
  const pending=serviceHasPendingTopup(),enabled=serviceTransferTopupEnabled();
  [byId("serviceTopupAmount"),byId("serviceTopupReference"),byId("serviceTopupSubmit")].forEach(el=>{if(el)el.disabled=pending||!enabled;});
  const submit=byId("serviceTopupSubmit");if(submit)submit.textContent=!enabled?"التحويل متوقف من الإدارة":pending?"طلب الشحن قيد المراجعة":"إرسال طلب الشحن";
}
function renderServiceTopupRequests(){
  const box=byId("serviceTopupRequestsList");if(!box)return;
  if(!currentUser){box.innerHTML='<p class="muted">سجّل الدخول لعرض طلبات الشحن.</p>';updateServiceTopupFormState();return;}
  if(!serviceTopupRequests.length){box.innerHTML='<p class="muted">لا توجد طلبات شحن بعد.</p>';updateServiceTopupFormState();return;}
  const labels={pending:"بانتظار المراجعة",approved:"تم الاعتماد",rejected:"مرفوض",cancelled:"ملغي"};
  box.innerHTML=serviceTopupRequests.map(x=>`<div class="unified-topup-row"><div><strong>${Number(x.amount||0).toLocaleString("ar-IQ")} د.ع</strong><small>${escapeHtml(x.transferReference||"بدون مرجع")}</small></div><span class="unified-topup-status ${escapeHtml(x.status||"pending")}">${labels[x.status]||escapeHtml(x.status||"pending")}</span></div>`).join("");
  updateServiceTopupFormState();
}
function subscribeServiceTopups(user){
  topupUnsubscribe?.();
  serviceTopupSnapshotReady=false;
  topupUnsubscribe=onSnapshot(query(collection(db,"topupRequests"),where("userId","==",user.uid)),snapshot=>{
    const previous=new Map(serviceTopupRequests.map(item=>[item.firestoreId,item]));
    const incoming=snapshot.docs.map(d=>({...d.data(),firestoreId:d.id})).sort((a,b)=>Number(b.createdAt?.seconds||0)-Number(a.createdAt?.seconds||0));
    if(serviceTopupSnapshotReady)incoming.forEach(item=>{
      const old=previous.get(item.firestoreId);
      if(!old||old.status===item.status||!["approved","rejected"].includes(item.status))return;
      const approved=item.status==="approved";
      window.KarwaNotify?.push?.({
        title:approved?"تم اعتماد شحن الرصيد":"تم رفض طلب الشحن",
        body:approved?`أضيف ${Number(item.amount||0).toLocaleString("ar-IQ")} د.ع إلى رصيد الخدمة.`:`طلب الشحن بقيمة ${Number(item.amount||0).toLocaleString("ar-IQ")} د.ع لم يعتمد.`,
        type:"wallet",route:"#providerView",tag:`service-topup-${item.firestoreId}-${item.status}`
      });
    });
    serviceTopupRequests=incoming;
    serviceTopupSnapshotReady=true;
    renderServiceTopupRequests();
  },error=>console.warn("تعذر تحميل طلبات شحن مزود الخدمة",error));
}
function serviceCommissionRate(){return 0;}

const unsubscribeServicePricing=subscribeGlobalPricing(settings=>{pricingSettings=settings||{};renderServiceWallet();if(providerRequests.length)renderProviderRequests(providerRequests);},error=>console.warn("تعذر تحميل إعدادات التسعير والرسوم العامة",error));

function showView(id) {
  views.forEach(view => byId(view)?.classList.toggle("hidden", view !== id));
}

function toast(message) {
  const element = byId("toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(window.servicesToast);
  window.servicesToast = setTimeout(() => element.classList.remove("show"), 2800);
}

function requestProviderCancellationReason() {
  const value = prompt("اكتب سبب إلغاء الطلب. السبب مطلوب وسيظهر للإدارة والعميل:", "");
  if (value === null) return null;
  const reason = String(value || "").trim();
  if (reason.length < 3) { toast("يجب كتابة سبب واضح للإلغاء (3 أحرف على الأقل)."); return null; }
  return reason.slice(0, 300);
}

function providerCancellationMeta(reason) {
  return {
    cancellationReason: reason,
    cancelledBy: "serviceProvider",
    cancelledByRole: "serviceProvider",
    cancelledByUserId: currentUser?.uid || "",
    cancelledByName: currentUserData?.name || currentUser?.displayName || currentProfile?.ownerName || "مزود خدمة",
    cancelledByEmail: currentUser?.email || currentUserData?.email || "",
    cancelledAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

function money(value) {
  const amount = Number(value || 0);
  return amount > 0 ? amount.toLocaleString("ar-IQ") + " د.ع" : "حسب الاتفاق";
}

function setBusy(button, isBusy, busyLabel = "جاري التنفيذ…") {
  if (isBusy) {
    button.dataset.label = button.textContent;
    button.textContent = busyLabel;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

function validPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15;
}

function locationLabel(value) {
  return value?.latitude != null && value?.longitude != null
    ? `${Number(value.latitude).toFixed(5)}, ${Number(value.longitude).toFixed(5)}`
    : "غير محدد";
}

function normalizedImageAsset(asset = null) {
  if (!asset) return null;
  const url = String(asset.url || asset.previewUrl || "").trim();
  const path = String(asset.path || "").trim();
  const size = Math.max(0, Math.round(Number(asset.size || asset.draftBlob?.size || 0)));
  const width = Math.max(0, Math.round(Number(asset.width || 0)));
  const height = Math.max(0, Math.round(Number(asset.height || 0)));
  const contentType = String(asset.contentType || asset.draftBlob?.type || "image/webp").trim() || "image/webp";
  const name = String(asset.name || "image.webp").slice(0, 120);
  if (!url && !asset.draftBlob) return null;
  return { ...(url ? { url } : {}), ...(path ? { path } : {}), ...(size ? { size } : {}), ...(width ? { width } : {}), ...(height ? { height } : {}), contentType, ...(name ? { name } : {}), ...(asset.previewUrl ? { previewUrl: asset.previewUrl } : {}), ...(asset.draftBlob ? { draftBlob: asset.draftBlob } : {}) };
}

function imageAssetPreviewUrl(asset = null) {
  const normalized = normalizedImageAsset(asset);
  return normalized?.previewUrl || normalized?.url || "";
}

function sanitizeImageAsset(asset = null) {
  const normalized = normalizedImageAsset(asset);
  if (!normalized?.url) return null;
  return {
    url: normalized.url,
    path: normalized.path || "",
    size: Math.max(0, Math.round(Number(normalized.size || 0))),
    contentType: normalized.contentType || "image/webp",
    width: Math.max(0, Math.round(Number(normalized.width || 0))),
    height: Math.max(0, Math.round(Number(normalized.height || 0))),
    name: String(normalized.name || "image.webp").slice(0, 120)
  };
}

function assetSummary(asset = null) {
  const normalized = normalizedImageAsset(asset);
  if (!normalized) return "";
  const kb = normalized.size ? `${(normalized.size / 1024).toFixed(1)} KB` : "";
  const size = normalized.width && normalized.height ? `${normalized.width}×${normalized.height}` : "";
  return ["WebP", kb, size].filter(Boolean).join(" • ");
}

function previewMarkup(asset, fallback, alt) {
  const url = imageAssetPreviewUrl(asset);
  return url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt || "صورة")}" loading="lazy">` : escapeHtml(fallback || "🖼️");
}

function renderImagePanel({ previewId, labelId, metaId, removeId, asset, fallback = "🖼️", emptyLabel = "لا توجد صورة", emptyMeta = "", alt = "صورة" }) {
  const preview = byId(previewId);
  const label = byId(labelId);
  const meta = byId(metaId);
  const remove = byId(removeId);
  const hasImage = Boolean(imageAssetPreviewUrl(asset));
  if (preview) {
    preview.classList.toggle("has-image", hasImage);
    preview.innerHTML = previewMarkup(asset, fallback, alt);
  }
  if (label) label.textContent = hasImage ? `تم تجهيز ${alt}` : emptyLabel;
  if (meta) meta.textContent = hasImage ? (assetSummary(asset) || emptyMeta) : emptyMeta;
  if (remove) remove.hidden = !hasImage;
}

function renderCoverImagePanel() {
  renderImagePanel({
    previewId: "pCoverImagePreview", labelId: "pCoverImageLabel", metaId: "pCoverImageMeta", removeId: "pRemoveCoverImage",
    asset: providerCoverImage, fallback: "🏪", emptyLabel: "لا توجد صورة واجهة مرفوعة",
    emptyMeta: "إذا لم تضف صورة مخصصة فسيستمر عرض واجهة افتراضية مناسبة لنوع نشاطك.", alt: "صورة واجهة الخدمة"
  });
}

function renderDraftItemImagePanel() {
  renderImagePanel({
    previewId: "pItemImagePreview", labelId: "pItemImageLabel", metaId: "pItemImageMeta", removeId: "pRemoveItemImage",
    asset: draftItemImage, fallback: "🖼️", emptyLabel: "لا توجد صورة لهذا العنصر",
    emptyMeta: "مثال: لفة فلافل، كباب، قهوة، عصير أو أي منتج آخر.", alt: "صورة المنتج أو الخدمة"
  });
}

function slugifyAssetName(value = "image") {
  const slug = String(value || "").normalize("NFKD").replace(/[ً-ٟ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 40);
  return slug || "image";
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("READ_FAILED"));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("IMAGE_LOAD_FAILED"));
    image.src = dataUrl;
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, "image/webp", quality));
}

async function prepareWebpImage(file, { maxBytes = 50 * 1024, maxDimension = 1280, targetAspect = 1 } = {}) {
  if (!file) throw new Error("NO_FILE");
  const dataUrl = await fileToDataUrl(file);
  const image = await loadImage(dataUrl);
  const sourceWidth = image.naturalWidth || image.width || 1;
  const sourceHeight = image.naturalHeight || image.height || 1;
  const ratio = Math.max(0.2, Math.min(5, Number(targetAspect || 1)));
  let sx = 0, sy = 0, sw = sourceWidth, sh = sourceHeight;
  if (sourceWidth / sourceHeight > ratio) {
    sw = sourceHeight * ratio;
    sx = (sourceWidth - sw) / 2;
  } else {
    sh = sourceWidth / ratio;
    sy = (sourceHeight - sh) / 2;
  }
  const maxSourceDimension = Math.max(sw, sh);
  const baseScale = Math.min(1, maxDimension / maxSourceDimension);
  const baseWidth = Math.max(120, Math.round(sw * baseScale));
  const baseHeight = Math.max(120, Math.round(sh * baseScale));
  const qualities = [0.92, 0.84, 0.76, 0.68, 0.60, 0.52, 0.45, 0.38, 0.32];
  const scales = [1, 0.92, 0.84, 0.76, 0.68, 0.60, 0.52, 0.44, 0.36];
  for (const scale of scales) {
    const width = Math.max(120, Math.round(baseWidth * scale));
    const height = Math.max(120, Math.round(baseHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);
    for (const quality of qualities) {
      const blob = await canvasToBlob(canvas, quality);
      if (!blob) continue;
      if (blob.size <= maxBytes) {
        return normalizedImageAsset({
          previewUrl: await fileToDataUrl(blob), draftBlob: blob, size: blob.size, width, height,
          contentType: "image/webp", name: `${slugifyAssetName(file.name || "image")}.webp`
        });
      }
    }
  }
  throw new Error("IMAGE_TOO_LARGE");
}

async function uploadServiceAssetIfNeeded(asset, folder, label = "image") {
  const normalized = normalizedImageAsset(asset);
  if (!normalized) return null;
  if (!normalized.draftBlob) return sanitizeImageAsset(normalized);
  if (!currentUser?.uid) throw new Error("NOT_AUTHENTICATED");
  const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${slugifyAssetName(label)}.webp`;
  const path = `service-assets/${currentUser.uid}/${folder}/${filename}`;
  const ref = storageRef(storage, path);
  await uploadBytes(ref, normalized.draftBlob, { contentType: "image/webp", cacheControl: "public,max-age=31536000,immutable" });
  const url = await getDownloadURL(ref);
  return sanitizeImageAsset({ ...normalized, url, path, name: filename, contentType: "image/webp" });
}

async function deleteServiceAssetPath(path) {
  if (!path) return;
  try { await deleteObject(storageRef(storage, path)); } catch (error) { console.warn("تعذر حذف الصورة من التخزين", path, error); }
}

function collectRemovedAssetPaths(previousProfile = {}, nextCoverImage = null, nextItems = []) {
  const previous = new Set();
  const current = new Set();
  const oldCoverPath = sanitizeImageAsset(previousProfile?.coverImage)?.path;
  if (oldCoverPath) previous.add(oldCoverPath);
  (Array.isArray(previousProfile?.items) ? previousProfile.items : []).forEach(item => { const path = sanitizeImageAsset(item?.image)?.path; if (path) previous.add(path); });
  const newCoverPath = sanitizeImageAsset(nextCoverImage)?.path;
  if (newCoverPath) current.add(newCoverPath);
  (Array.isArray(nextItems) ? nextItems : []).forEach(item => { const path = sanitizeImageAsset(item?.image)?.path; if (path) current.add(path); });
  return [...previous].filter(path => !current.has(path));
}

function serviceImageLibraryEntries() {
  return Array.isArray(window.KarwaServiceImageLibrary) ? window.KarwaServiceImageLibrary : [];
}

function renderServiceImageLibrary() {
  const grid = byId("serviceImageLibraryGrid");
  if (!grid) return;
  const queryText = String(byId("serviceImageLibrarySearch")?.value || "").trim().toLowerCase();
  const entries = serviceImageLibraryEntries().filter(entry => {
    const groupMatch = imageLibraryFilter === "all" || entry.group === imageLibraryFilter;
    const searchMatch = !queryText || `${entry.label || ""} ${entry.key || ""}`.toLowerCase().includes(queryText);
    return groupMatch && searchMatch;
  });
  grid.innerHTML = entries.length ? entries.map(entry => `
    <button class="library-image-card" type="button" data-library-image="${escapeHtml(entry.key)}" aria-label="اختيار ${escapeHtml(entry.label)}">
      <img src="${escapeHtml(entry.src)}" alt="${escapeHtml(entry.label)}" loading="lazy"><span>${escapeHtml(entry.label)}</span>
    </button>`).join("") : `<div class="image-library-empty">لا توجد صورة مطابقة للبحث.</div>`;
}

function openServiceImageLibrary(target = "item") {
  imageLibraryTarget = target === "cover" ? "cover" : "item";
  imageLibraryFilter = "all";
  byId("serviceImageLibrarySearch").value = imageLibraryTarget === "item" ? byId("pItemName")?.value?.trim() || "" : "";
  document.querySelectorAll("[data-library-filter]").forEach(button => button.classList.toggle("active", button.dataset.libraryFilter === "all"));
  byId("serviceImageLibraryTitle").textContent = imageLibraryTarget === "cover" ? "اختر صورة واجهة جاهزة" : "اختر صورة للمنتج أو الخدمة";
  byId("serviceImageLibrarySubtitle").textContent = imageLibraryTarget === "cover"
    ? "ستُقص الصورة تلقائيًا بنسبة 16:9 ثم تُرفع مع واجهة نشاطك."
    : "ستُقص الصورة تلقائيًا إلى مربع 1:1 ثم تُرفع مع المنتج أو الخدمة.";
  renderServiceImageLibrary();
  byId("serviceImageLibrary").classList.add("show");
  setTimeout(() => byId("serviceImageLibrarySearch")?.focus(), 20);
}

function closeServiceImageLibrary() {
  byId("serviceImageLibrary")?.classList.remove("show");
}

async function chooseServiceLibraryImage(key) {
  const entry = serviceImageLibraryEntries().find(item => item.key === key);
  if (!entry) return;
  const target = imageLibraryTarget;
  closeServiceImageLibrary();
  try {
    toast("جارٍ تجهيز الصورة المختارة…");
    const response = await fetch(entry.src, { cache: "force-cache" });
    if (!response.ok) throw new Error("LIBRARY_IMAGE_FETCH_FAILED");
    const blob = await response.blob();
    const file = new File([blob], `${entry.key}.webp`, { type: "image/webp" });
    if (target === "cover") {
      providerCoverImage = await prepareWebpImage(file, { maxBytes: 50 * 1024, maxDimension: 1440, targetAspect: 16 / 9 });
      renderCoverImagePanel();
      renderPreview();
      toast(`تم اختيار ${entry.label} كصورة واجهة. احفظ التغييرات لرفعها.`);
    } else {
      draftItemImage = await prepareWebpImage(file, { maxBytes: 50 * 1024, maxDimension: 1200, targetAspect: 1 });
      renderDraftItemImagePanel();
      toast(`تم اختيار صورة ${entry.label}.`);
    }
  } catch (error) {
    console.error(error);
    toast("تعذر تجهيز الصورة الجاهزة. حاول مرة أخرى.");
  }
}

byId("pCoverLibraryButton")?.addEventListener("click", () => openServiceImageLibrary("cover"));
byId("pItemLibraryButton")?.addEventListener("click", () => openServiceImageLibrary("item"));
byId("serviceImageLibraryClose")?.addEventListener("click", closeServiceImageLibrary);
byId("serviceImageLibrarySearch")?.addEventListener("input", renderServiceImageLibrary);
byId("serviceImageLibraryGrid")?.addEventListener("click", event => {
  const button = event.target.closest("[data-library-image]");
  if (button) chooseServiceLibraryImage(button.dataset.libraryImage);
});
byId("serviceImageLibrary")?.addEventListener("click", event => { if (event.target === event.currentTarget) closeServiceImageLibrary(); });
document.querySelectorAll("[data-library-filter]").forEach(button => button.addEventListener("click", () => {
  imageLibraryFilter = button.dataset.libraryFilter || "all";
  document.querySelectorAll("[data-library-filter]").forEach(item => item.classList.toggle("active", item === button));
  renderServiceImageLibrary();
}));
window.addEventListener("keydown", event => { if (event.key === "Escape" && byId("serviceImageLibrary")?.classList.contains("show")) closeServiceImageLibrary(); });


async function getServicePrecisePosition(options = {}) {
  if (window.KarwaGeo?.getPrecisePosition) return window.KarwaGeo.getPrecisePosition({targetAccuracy:20,acceptableAccuracy:35,maxWait:18000,...options});
  if (!navigator.geolocation) throw Object.assign(new Error("GPS غير مدعوم"),{code:"UNSUPPORTED"});
  return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:18000,maximumAge:0}));
}

function handleServiceLocationError(error) {
  console.warn("service precise location",error);
  const code=String(error?.code||"");
  if(code==="PRECISE_PERMISSION_REQUIRED"||code==="PERMISSION_DENIED"||error?.code===1){toast("فعّل «الموقع الدقيق» لكروة");window.KarwaGeo?.promptPreciseSettings?.("موقع النشاط يحتاج دقة عالية حتى يصل العميل والكابتن للمكان الصحيح.");return;}
  if(code==="GPS_DISABLED"){toast("شغّل GPS ثم حاول مجددًا");try{window.KarwaNative?.openLocationSettings?.();}catch{}return;}
  if(code==="ACCURACY_TOO_LOW"){const a=Number(error?.bestAccuracy||0);toast(a?`دقة GPS الحالية ${Math.round(a)} م؛ انتقل لمكان مفتوح وحاول مجددًا`:"لم تصل إشارة GPS للدقة المطلوبة");return;}
  toast("تعذر تحديد الموقع بدقة. تحقق من GPS والصلاحيات.");
}

async function captureLocation(buttonId, statusId, target) {
  const button = byId(buttonId);
  setBusy(button, true, "جاري تثبيت GPS…");
  try {
    const position = await getServicePrecisePosition();
    const value = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy };
    if (target === "register") registrationLocation = value;
    else if (target === "edit") editApplicationLocation = value;
    else providerLocation = value;
    byId(statusId).textContent = `تم التحديد ✓ دقة ${Math.round(value.accuracy||0)} م • ${locationLabel(value)}`;
    toast("تم حفظ موقع النشاط بدقة عالية");
  } catch(error) {
    handleServiceLocationError(error);
  } finally {
    setBusy(button, false);
  }
}

function authErrorMessage(error) {
  const messages = {
    "auth/email-already-in-use": "هذا البريد مستخدم في حساب آخر.",
    "auth/invalid-email": "صيغة البريد الإلكتروني غير صحيحة.",
    "auth/invalid-credential": "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
    "auth/missing-password": "أدخل كلمة المرور.",
    "auth/weak-password": "كلمة المرور يجب أن تكون ستة أحرف على الأقل.",
    "auth/too-many-requests": "محاولات كثيرة؛ حاول بعد قليل.",
    "auth/network-request-failed": "تعذر الاتصال بالإنترنت."
  };
  return messages[error?.code] || "تعذر إكمال العملية. حاول مرة أخرى.";
}

function setAuthMode(mode) {
  authMode = mode;
  const registering = mode === "register";
  byId("loginMode").classList.toggle("active", !registering);
  byId("registerMode").classList.toggle("active", registering);
  byId("loginMode").setAttribute("aria-selected", String(!registering));
  byId("registerMode").setAttribute("aria-selected", String(registering));
  byId("authHeading").textContent = registering ? "أنشئ حساب خدمتك" : "مرحبًا بعودتك";
  byId("authLead").textContent = registering
    ? "عند إكمال التسجيل سيصل طلب اعتمادك إلى الإدارة تلقائيًا."
    : "سجّل الدخول لمتابعة طلبك أو إدارة خدمتك.";
  byId("authSubmit").textContent = registering ? "إنشاء الحساب وإرسال طلب الموافقة" : "تسجيل الدخول";
  byId("authPassword").autocomplete = registering ? "new-password" : "current-password";
  byId("authMessage").textContent = "";
  document.querySelectorAll(".registration-field").forEach(field => field.classList.toggle("hidden", !registering));
  ["registerPasswordConfirm", "registerName", "registerBusinessName", "registerCategory", "registerPhone", "registerCity", "registerAddress"].forEach(id => {
    byId(id).required = registering;
  });
}

byId("loginMode").addEventListener("click", () => setAuthMode("login"));
byId("registerMode").addEventListener("click", () => setAuthMode("register"));
byId("logoutBtn").addEventListener("click", () => signOut(auth));
byId("deniedLogout").addEventListener("click", () => signOut(auth));
byId("registerGpsButton").addEventListener("click", () => captureLocation("registerGpsButton", "registerGpsStatus", "register"));
byId("editGpsButton").addEventListener("click", () => captureLocation("editGpsButton", "editGpsStatus", "edit"));

function registrationData() {
  return {
    ownerName: byId("registerName").value.trim(),
    businessName: byId("registerBusinessName").value.trim(),
    category: normalizeCategory(byId("registerCategory").value),
    phone: byId("registerPhone").value.trim(),
    city: byId("registerCity").value,
    address: byId("registerAddress").value.trim(),
    description: byId("registerDescription").value.trim(),
    location: registrationLocation
  };
}

function validateApplication(data) {
  if (data.ownerName.length < 2) return "اكتب اسم صاحب الخدمة بشكل صحيح.";
  if (data.businessName.length < 2) return "اكتب اسم النشاط بشكل صحيح.";
  if (String(data.category || "").trim().length < 2) return "اكتب تصنيف المهنة بشكل واضح.";
  if (!validPhone(data.phone)) return "اكتب رقم هاتف صحيحًا.";
  if (!data.city) return "اختر المدينة.";
  if (data.address.length < 3) return "اكتب عنوان النشاط بشكل أوضح.";
  if (data.location?.latitude == null || data.location?.longitude == null) return "حدد موقع النشاط الجغرافي قبل إرسال الطلب.";
  return "";
}

byId("authForm").addEventListener("submit", async event => {
  event.preventDefault();
  const email = byId("authEmail").value.trim();
  const password = byId("authPassword").value;
  const passwordConfirm = byId("registerPasswordConfirm")?.value || "";
  const submit = byId("authSubmit");
  byId("authMessage").textContent = "";

  if (authMode === "register") {
    const data = registrationData();
    const validationMessage = validateApplication(data);
    if (validationMessage) {
      byId("authMessage").textContent = validationMessage;
      return;
    }
    if (password !== passwordConfirm) {
      byId("authMessage").textContent = "كلمتا المرور غير متطابقتين.";
      byId("registerPasswordConfirm")?.focus();
      return;
    }

    let credential = null;
    let profileSaved = false;
    setBusy(submit, true, "جاري إنشاء الحساب وإرسال الطلب…");
    try {
      const settingsSnapshot = await getDoc(doc(db, "appSettings", "pricing"));
      pricingSettings = settingsSnapshot.exists() ? settingsSnapshot.data() : {};
      const deviceInfo = requireNativeRegistrationDevice();
      credential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(credential.user, { displayName: data.ownerName });
      const batch = writeBatch(db);
      const welcomeBonus=signupBonusFields();
      batch.set(doc(db, "users", credential.user.uid), {
        name: data.ownerName,
        email,
        role: "serviceApplicant",
        balance: 0,
        ...welcomeBonus,
        notifications: true,
        deviceBound: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      addDeviceRegistrationWrites(batch,db,credential.user.uid,"serviceApplicant",deviceInfo);
      batch.set(doc(db, "serviceApplications", credential.user.uid), {
        userId: credential.user.uid,
        ownerName: data.ownerName,
        businessName: data.businessName,
        category: data.category,
        serviceType: "other",
        phone: data.phone,
        email,
        city: data.city,
        address: data.address,
        description: data.description,
        location: data.location,
        status: "pending",
        submittedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      await batch.commit();
      profileSaved = true;
      toast("تم إنشاء الحساب وإرسال طلبك إلى الإدارة");
      history.replaceState(null, "", "./services.html");
    } catch (error) {
      console.error(error);
      if (credential?.user && !profileSaved) {
        try {
          await deleteUser(credential.user);
        } catch (rollbackError) {
          console.warn("تعذر التراجع عن الحساب غير المكتمل", rollbackError);
        }
      }
      const deviceMessage = error?.message === "DEVICE_NATIVE_REQUIRED" || error?.code === "device/native-required"
        ? "إنشاء حساب خدمة جديد متاح من تطبيق كروة على Android فقط حتى يتم ربط الحساب بهذا الهاتف."
        : (String(error?.code||"").includes("permission-denied") ? "هذا الهاتف مرتبط بالفعل بحساب كروة آخر، أو إعدادات ربط الجهاز في Supabase غير محدثة." : "");
      byId("authMessage").textContent = deviceMessage || authErrorMessage(error);
    } finally {
      setBusy(submit, false);
      setAuthMode(authMode);
    }
    return;
  }

  setBusy(submit, true, "جاري تسجيل الدخول…");
  try {
    await signInWithEmailAndPassword(auth, email, password);
    history.replaceState(null, "", "./services.html");
  } catch (error) {
    console.error(error);
    byId("authMessage").textContent = authErrorMessage(error);
  } finally {
    setBusy(submit, false);
  }
});

function applicationSummary(data) {
  const values = [
    ["اسم النشاط", data.businessName || "—"],
    ["صاحب الخدمة", data.ownerName || currentUserData?.name || "—"],
    ["التصنيف", categoryLabel(data.category)],
    ["الهاتف", data.phone || "—"],
    ["المدينة", data.city || "—"],
    ["العنوان", data.address || "—"],
    ["موقع GPS", locationLabel(data.location)]
  ];
  byId("applicationSummary").innerHTML = values.map(([label, value]) =>
    `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
  ).join("");
}

function fillResubmitForm(data = {}) {
  byId("editOwnerName").value = data.ownerName || currentUserData?.name || currentUser?.displayName || "";
  byId("editBusinessName").value = data.businessName || "";
  byId("editCategory").value = categoryLabel(data.category);
  byId("editPhone").value = data.phone || "";
  byId("editCity").value = data.city || "الموصل";
  byId("editAddress").value = data.address || "";
  byId("editDescription").value = data.description || "";
  editApplicationLocation = data.location || null;
  byId("editGpsStatus").textContent = editApplicationLocation
    ? `محفوظ ✓ ${locationLabel(editApplicationLocation)}`
    : "لم يتم تحديد الموقع بعد";
}

function renderApplication(data) {
  currentApplication = data;
  const status = data?.status || "missing";
  const rejected = status === "rejected";
  const approved = status === "approved";
  const missing = status === "missing";

  byId("applicationStatus").className = "status";
  byId("applicationNotice").className = "notice";
  byId("resubmitForm").classList.toggle("hidden", !rejected && !missing);
  byId("stepReview").className = "timeline-step active";
  byId("stepReview").querySelector(".step-number").textContent = "2";
  byId("stepAccess").className = "timeline-step";

  if (rejected) {
    byId("applicationTitle").textContent = "طلبك يحتاج إلى تعديل";
    byId("applicationSubtitle").textContent = "راجع ملاحظة الإدارة، وعدّل البيانات، ثم أعد إرسال الطلب.";
    byId("applicationHeroStatus").textContent = "مطلوب تعديل";
    byId("applicationStatus").textContent = "يحتاج تعديلًا";
    byId("applicationStatus").classList.add("bad");
    byId("applicationNotice").textContent = data.reviewNote || "يرجى مراجعة البيانات وإعادة إرسال الطلب.";
    byId("applicationNotice").classList.add("bad");
    fillResubmitForm(data);
  } else if (approved) {
    byId("applicationTitle").textContent = "تمت الموافقة على طلبك";
    byId("applicationSubtitle").textContent = "جاري تجهيز لوحة مزود الخدمة وفتحها تلقائيًا.";
    byId("applicationHeroStatus").textContent = "تمت الموافقة ✓";
    byId("applicationStatus").textContent = "مقبول";
    byId("applicationStatus").classList.add("ok");
    byId("applicationNotice").textContent = "تم اعتماد الحساب. ستفتح لوحة الخدمة خلال لحظات.";
    byId("applicationNotice").classList.add("ok");
    byId("stepReview").className = "timeline-step done";
    byId("stepReview").querySelector(".step-number").textContent = "✓";
    byId("stepAccess").className = "timeline-step active";
  } else if (missing) {
    byId("applicationTitle").textContent = "أكمل طلب اعتماد خدمتك";
    byId("applicationSubtitle").textContent = "هذا حساب خدمة قديم؛ أكمل بيانات النشاط لإرسال الطلب إلى الإدارة.";
    byId("applicationHeroStatus").textContent = "طلب غير مكتمل";
    byId("applicationStatus").textContent = "غير مرسل";
    byId("applicationNotice").textContent = "أدخل بيانات النشاط أدناه، وسيصل الطلب إلى الإدارة فور الإرسال.";
    fillResubmitForm(data);
  } else {
    byId("applicationTitle").textContent = "طلبك قيد المراجعة";
    byId("applicationSubtitle").textContent = "وصل الطلب إلى الإدارة، وسنفتح لوحة الخدمة تلقائيًا بعد الموافقة.";
    byId("applicationHeroStatus").textContent = "قيد المراجعة";
    byId("applicationStatus").textContent = "قيد المراجعة";
    byId("applicationNotice").textContent = "تم استلام طلبك بنجاح. لا تحتاج إلى إعادة الإرسال؛ ستتحدث الحالة هنا تلقائيًا.";
  }
  applicationSummary(data || {});
}

async function openApplicant() {
  showView("applicationView");
  const applicationRef = doc(db, "serviceApplications", currentUser.uid);
  const snapshot = await getDoc(applicationRef);
  renderApplication(snapshot.exists() ? snapshot.data() : null);
  contentUnsubscribe?.();
  contentUnsubscribe = onSnapshot(applicationRef, applicationSnapshot => {
    renderApplication(applicationSnapshot.exists() ? applicationSnapshot.data() : null);
  }, error => {
    console.error(error);
    toast("تعذر تحديث حالة الطلب");
  });
}

byId("resubmitForm").addEventListener("submit", async event => {
  event.preventDefault();
  const data = {
    ownerName: byId("editOwnerName").value.trim(),
    businessName: byId("editBusinessName").value.trim(),
    category: normalizeCategory(byId("editCategory").value),
    phone: byId("editPhone").value.trim(),
    city: byId("editCity").value,
    address: byId("editAddress").value.trim(),
    description: byId("editDescription").value.trim(),
    location: editApplicationLocation
  };
  const validationMessage = validateApplication(data);
  if (validationMessage) return toast(validationMessage);
  const button = byId("resubmitButton");
  setBusy(button, true, "جاري إرسال الطلب…");
  try {
    const payload = {
      userId: currentUser.uid,
      ...data,
      email: currentUser.email || currentUserData?.email || "",
      serviceType: "other",
      status: "pending",
      reviewNote: "",
      updatedAt: serverTimestamp()
    };
    if (currentApplication) payload.resubmittedAt = serverTimestamp();
    else payload.submittedAt = serverTimestamp();
    await setDoc(doc(db, "serviceApplications", currentUser.uid), payload, { merge: Boolean(currentApplication) });
    toast("تم إرسال الطلب إلى الإدارة");
  } catch (error) {
    console.error(error);
    toast("تعذر إرسال الطلب. تحقق من الاتصال وسياسات Supabase.");
  } finally {
    setBusy(button, false);
  }
});

const itemUnitLabels = { item: "قطعة / طلب", meal: "وجبة", person: "نفر", kg: "كيلوغرام", pack: "عبوة / باكيت", liter: "لتر", meter: "متر", hour: "ساعة", day: "يوم" };
function providerRequestItems(request={}){
  if(Array.isArray(request.items)&&request.items.length)return request.items;
  return request.itemName?[{itemName:request.itemName,itemUnit:request.itemUnit||"item",quantity:Number(request.quantity||1),unitPrice:Number(request.unitPrice||request.itemPrice||0),subtotal:Number(request.subtotal||0)}]:[];
}
function providerItemsTitle(request={}){const items=providerRequestItems(request);return items.length<=1?(items[0]?.itemName||"طلب خدمة"):`${items[0].itemName} + ${items.length-1} أصناف`;}
function providerItemsHtml(request={}){return providerRequestItems(request).map(i=>`<div class="request-meta"><span><b>${escapeHtml(i.itemName||"صنف")}</b></span><span>${Number(i.quantity||1).toLocaleString("ar-IQ")} ${escapeHtml(itemUnitLabels[i.itemUnit]||itemUnitLabels.item)}</span><span>${money(i.unitPrice||0)}</span><span>${money(i.subtotal||0)}</span></div>`).join("");}

function normalizedProviderItem(item = {}) {
  const unit = itemUnitLabels[item.unit] ? item.unit : "item";
  return {
    name: String(item.name || "").slice(0, 80),
    price: Math.max(0, Math.round(Number(item.price || 0))),
    description: String(item.description || "").slice(0, 300),
    unit,
    deliveryAvailable: item.deliveryAvailable === true,
    deliveryFee: item.deliveryAvailable === true ? Math.max(0, Math.round(Number(item.deliveryFee || 0))) : 0,
    image: normalizedImageAsset(item.image || null)
  };
}

function resetItemEditor() {
  editingItemIndex = -1;
  byId("pItemName").value = "";
  byId("pItemPrice").value = "";
  byId("pItemDescription").value = "";
  byId("pItemUnit").value = "item";
  byId("pDeliveryAvailable").checked = false;
  byId("pDeliveryFee").value = "0";
  byId("pDeliveryFee").disabled = true;
  byId("pItemImage").value = "";
  draftItemImage = null;
  renderDraftItemImagePanel();
  byId("pItemEditBanner")?.classList.remove("show");
  byId("pCancelItemEdit").hidden = true;
  byId("pAddItem").textContent = "＋ إضافة وحفظ العنصر";
}

function startEditingProviderItem(index) {
  const item = providerItems[index];
  if (!item) return;
  editingItemIndex = index;
  byId("pItemName").value = item.name || "";
  byId("pItemPrice").value = String(item.price || "");
  byId("pItemDescription").value = item.description || "";
  byId("pItemUnit").value = item.unit || "item";
  byId("pDeliveryAvailable").checked = item.deliveryAvailable === true;
  byId("pDeliveryFee").value = String(item.deliveryAvailable ? Number(item.deliveryFee || 0) : 0);
  byId("pDeliveryFee").disabled = item.deliveryAvailable !== true;
  byId("pItemImage").value = "";
  draftItemImage = normalizedImageAsset(item.image || null);
  renderDraftItemImagePanel();
  byId("pItemEditBanner")?.classList.add("show");
  byId("pCancelItemEdit").hidden = false;
  byId("pAddItem").textContent = "✓ حفظ تعديل العنصر";
  byId("pItemName").scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderProviderItems() {
  byId("pItemCount").textContent = `${providerItems.length} عنصر`;
  byId("itemsMetric").textContent = providerItems.length;
  byId("pItemList").innerHTML = providerItems.length
    ? providerItems.map((item, index) => `
        <div class="catalog-item catalog-item-rich">
          <div class="catalog-inline"><div class="catalog-item-media ${imageAssetPreviewUrl(item.image) ? "has-image" : ""}">${previewMarkup(item.image, "🧾", item.name || "صورة العنصر")}</div><div><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.description || "بدون وصف")}</small><div class="catalog-item-tags"><span>السعر لكل ${escapeHtml(itemUnitLabels[item.unit] || itemUnitLabels.item)}</span><span>${item.deliveryAvailable ? `توصيل ${money(item.deliveryFee)}` : "استلام فقط"}</span>${item.image ? `<span>${escapeHtml(assetSummary(item.image) || "صورة مرفقة")}</span>` : ""}</div></div></div>
          <span class="price">${money(item.price)}</span>
          <div class="catalog-item-actions"><button class="button secondary" type="button" data-edit-item="${index}">✎ تعديل</button><button class="button danger" type="button" data-remove-item="${index}">حذف</button></div>
        </div>`).join("")
    : `<div class="empty">لم تضف خدمات أو منتجات بعد.</div>`;
  byId("pItemList").querySelectorAll("[data-edit-item]").forEach(button => button.addEventListener("click", () => startEditingProviderItem(Number(button.dataset.editItem))));
  byId("pItemList").querySelectorAll("[data-remove-item]").forEach(button => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.removeItem);
      const item = providerItems[index];
      if (!item || !confirm(`حذف ${item.name} من القائمة؟ سيتم حذف صورته من السيرفر بعد حفظ التغييرات.`)) return;
      providerItems.splice(index, 1);
      if (editingItemIndex === index) resetItemEditor();
      else if (editingItemIndex > index) editingItemIndex -= 1;
      renderProviderItems();
      toast("تم حذف العنصر من المسودة. احفظ التغييرات لتأكيد الحذف من السيرفر.");
    });
  });
  renderPreview();
}

byId("pDeliveryAvailable").addEventListener("change", event => {
  byId("pDeliveryFee").disabled = !event.target.checked;
  if (!event.target.checked) byId("pDeliveryFee").value = "0";
});

byId("pCoverImageInput").addEventListener("change", async event => {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  try {
    input.disabled = true;
    providerCoverImage = await prepareWebpImage(file, { maxBytes: 50 * 1024, maxDimension: 1440, targetAspect: 16 / 9 });
    renderCoverImagePanel();
    renderPreview();
    toast("تم تجهيز صورة الواجهة. احفظ التغييرات لرفعها.");
  } catch (error) {
    console.error(error);
    toast("تعذر تجهيز صورة الواجهة. جرّب صورة أصغر أو أوضح.");
    input.value = "";
  } finally { input.disabled = false; }
});

byId("pRemoveCoverImage").addEventListener("click", () => {
  providerCoverImage = null;
  byId("pCoverImageInput").value = "";
  renderCoverImagePanel();
  renderPreview();
  toast("أزيلت صورة الواجهة من المسودة. احفظ التغييرات للتأكيد.");
});

byId("pItemImage").addEventListener("change", async event => {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  try {
    input.disabled = true;
    draftItemImage = await prepareWebpImage(file, { maxBytes: 50 * 1024, maxDimension: 1200, targetAspect: 1 });
    renderDraftItemImagePanel();
    toast("تم تجهيز صورة العنصر. أضف العنصر الآن.");
  } catch (error) {
    console.error(error);
    toast("تعذر تجهيز صورة العنصر. جرّب صورة أصغر أو أوضح.");
    input.value = "";
  } finally { input.disabled = false; }
});

byId("pRemoveItemImage").addEventListener("click", () => {
  draftItemImage = null;
  byId("pItemImage").value = "";
  renderDraftItemImagePanel();
});

byId("pCancelItemEdit")?.addEventListener("click", () => {
  resetItemEditor();
  toast("تم إلغاء تعديل العنصر.");
});

byId("pAddItem").addEventListener("click", event => {
  const name = byId("pItemName").value.trim();
  const price = Number(byId("pItemPrice").value || 0);
  const description = byId("pItemDescription").value.trim();
  const unit = byId("pItemUnit").value;
  const deliveryAvailable = byId("pDeliveryAvailable").checked;
  const deliveryFee = deliveryAvailable ? Number(byId("pDeliveryFee").value || 0) : 0;
  if (name.length < 2 || !Number.isFinite(price) || price <= 0) return toast("أدخل اسمًا وسعر وحدة أكبر من صفر.");
  if (!itemUnitLabels[unit]) return toast("اختر وحدة تسعير صحيحة.");
  if (!Number.isFinite(deliveryFee) || deliveryFee < 0) return toast("أدخل أجرة توصيل صحيحة.");
  if (editingItemIndex < 0 && providerItems.length >= 50) return toast("الحد الأقصى 50 عنصرًا.");

  const button = event.currentTarget;
  const isEditing = editingItemIndex >= 0;
  setBusy(button, true, isEditing ? "جارٍ حفظ التعديل…" : "جارٍ الإضافة…");
  try {
    const normalized = normalizedProviderItem({ name, price, description, unit, deliveryAvailable, deliveryFee, image: draftItemImage });
    if (isEditing) providerItems[editingItemIndex] = normalized;
    else providerItems.push(normalized);
    resetItemEditor();
    renderProviderItems();
    toast(isEditing ? "تم تعديل العنصر. احفظ التغييرات لرفع الصورة الجديدة وحذف القديمة." : "تمت إضافة العنصر. احفظ التغييرات لنشره للعملاء.");
  } catch (error) {
    console.error(error);
    toast(isEditing ? "تعذر تعديل العنصر." : "تعذر إضافة العنصر.");
  } finally {
    setBusy(button, false);
    if (editingItemIndex < 0) button.textContent = "＋ إضافة وحفظ العنصر";
  }
});

function renderPreview() {
  const category = currentProfile?.category || currentApplication?.category || "other";
  const theme = window.KarwaServiceThemes?.resolve?.({ category, serviceType:currentApplication?.serviceType || "", description:byId("pDescription")?.value || currentProfile?.description || "", items:providerItems }) || { image:"./theme-parcel.webp?v=73", accent:"#087b75", icon:"🧰", key:"parcel" };
  const cover = byId("previewThemeCover");
  const coverUrl = imageAssetPreviewUrl(providerCoverImage) || theme.image;
  if (cover) { cover.style.backgroundImage = `linear-gradient(180deg,rgba(3,15,24,.02),rgba(3,15,24,.2)),url('${coverUrl}')`; cover.style.setProperty("--preview-theme-accent", theme.accent); cover.dataset.theme = theme.key; }
  const themeIcon = byId("previewThemeIcon"); if (themeIcon) themeIcon.textContent = theme.icon;
  byId("previewCategory").textContent = categoryLabel(category);
  byId("previewName").textContent = byId("pBusinessName").value.trim() || "اسم النشاط";
  byId("previewDescription").textContent = byId("pDescription").value.trim() || "وصف النشاط";
  byId("previewAddress").textContent = `${byId("pCity").value.trim()} • ${byId("pAddress").value.trim()}`.replace(/^ • | • $/g, "") || "العنوان";
  byId("previewPhone").textContent = byId("pPhone").value.trim() || "الهاتف";
  byId("previewItems").innerHTML = providerItems.slice(0, 4).map(item => `
    <div class="catalog-item catalog-item-rich"><div class="preview-item-inline"><div class="catalog-item-media small ${imageAssetPreviewUrl(item.image) ? "has-image" : ""}">${previewMarkup(item.image, theme.icon || "🧰", item.name || "صورة العنصر")}</div><div><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.description || "")}</small><div class="catalog-item-tags"><span>لكل ${escapeHtml(itemUnitLabels[item.unit] || itemUnitLabels.item)}</span><span>${item.deliveryAvailable ? `توصيل ${money(item.deliveryFee)}` : "استلام"}</span></div></div></div><span class="price">${money(item.price)}</span></div>
  `).join("") || `<div class="empty">ستظهر عناصر خدمتك هنا.</div>`;
  byId("activeMetric").textContent = byId("pActive").checked ? "نشط" : "متوقف مؤقتًا";
}

function fillProviderForm(data) {
  const category = data.category || currentApplication?.category || "other";
  byId("providerHeroName").textContent = data.businessName || currentApplication?.businessName || currentUserData?.name || "شريك كروة";
  byId("pBusinessName").value = data.businessName || currentApplication?.businessName || "";
  byId("pCategory").value = categoryLabel(category);
  byId("pPhone").value = data.phone || currentApplication?.phone || "";
  byId("pCity").value = data.city || currentApplication?.city || "";
  byId("pAddress").value = data.address || currentApplication?.address || "";
  byId("pDescription").value = data.description || currentApplication?.description || "";
  byId("pActive").checked = data.active !== false;
  byId("categoryMetric").textContent = categoryLabel(category);
  providerLocation = data.location || null;
  providerCoverImage = normalizedImageAsset(data.coverImage || null);
  draftItemImage = null;
  editingItemIndex = -1;
  providerItems = Array.isArray(data.items) ? data.items.map(normalizedProviderItem) : [];
  byId("pGpsStatus").textContent = providerLocation?.latitude != null && providerLocation?.longitude != null
    ? `محفوظ ✓ ${Number(providerLocation.latitude).toFixed(5)}, ${Number(providerLocation.longitude).toFixed(5)}`
    : "لم يتم تحديد الموقع";
  renderCoverImagePanel();
  renderDraftItemImagePanel();
  byId("pItemEditBanner")?.classList.remove("show");
  byId("pCancelItemEdit").hidden = true;
  byId("pAddItem").textContent = "＋ إضافة وحفظ العنصر";
  renderProviderItems();
}

const requestStatusLabels = {
  pending: "طلب جديد",
  accepted: "تم القبول",
  completed: "مكتمل",
  rejected: "مرفوض",
  cancelled: "ملغي"
};

function renderProviderRequests(requests) {
  const pending = requests.filter(request => request.status === "pending").length;
  byId("requestsMetric").textContent = requests.length;
  const metricCard = byId("requestsMetricCard");
  const alertCount = byId("requestAlertCount");
  if (metricCard) metricCard.classList.toggle("has-alert", pending > 0);
  if (alertCount) {
    alertCount.textContent = pending > 99 ? "99+" : String(pending);
    alertCount.hidden = pending === 0;
  }
  byId("requestsStatus").textContent = pending ? `${pending} جديد` : "مباشر";
  byId("requestsStatus").className = pending ? "status" : "status ok";
  byId("providerRequestsList").innerHTML = requests.length
    ? requests.map(request => {
        const status = request.status || "pending";
        const deliveryAvailable = request.itemDeliveryAvailable === true || request.deliveryRequested === true || Number(request.itemDeliveryFee || request.deliveryFee || 0) > 0;
        const deliveryStatus = request.deliveryStatus || (request.deliveryRequested ? "awaitingCaptain" : "notRequested");
        const actions = status === "pending"
          ? `<div class="request-actions"><button class="button primary" type="button" data-request-action="accepted" data-request-id="${request.firestoreId}">موافقة على الحاجة • ${money(providerOperationFee(request))}</button><button class="button danger" type="button" data-request-action="rejected" data-request-id="${request.firestoreId}">رفض</button></div>`
          : status === "accepted"
            ? `<div class="request-actions">${deliveryStatus !== "awaitingCustomerChoice" ? `<button class="button primary" type="button" data-request-action="completed" data-request-id="${request.firestoreId}">تم إكمال الخدمة</button>` : ""}<button class="button danger" type="button" data-request-action="cancelled" data-request-id="${request.firestoreId}">إلغاء الطلب</button></div>`
            : "";
        let deliveryText = "🏪 استلام من النشاط";
        if (status === "pending") deliveryText = request.providerCategory === "restaurant"
          ? (request.deliveryRequested ? `🚚 العميل اختار التوصيل • ${money(request.deliveryFee || 0)}` : "🏪 العميل اختار الاستلام من المطعم")
          : (deliveryAvailable ? `🚚 التوصيل متاح (${money(request.itemDeliveryFee || request.deliveryFee || 0)}) — بعد موافقتك يختار العميل التوصيل أو الاستلام` : "🏪 هذه الخدمة للاستلام من النشاط");
        else if (deliveryStatus === "awaitingCustomerChoice") deliveryText = "⏳ بانتظار اختيار العميل: توصيل أو استلام";
        else if (deliveryStatus === "awaitingCaptain") deliveryText = `🚚 تم إرسال التوصيل إلى كباتن التوصيل المطابقين ضمن 10 كم • ${money(request.deliveryFee)}`;
        else if (deliveryStatus === "notRequested") deliveryText = "🏪 اختار العميل الاستلام من النشاط";
        else if (deliveryStatus === "notAvailable") deliveryText = "🏪 التوصيل غير متاح لهذه الخدمة";
        const requestVisualStatus = ["accepted", "completed", "rejected", "cancelled"].includes(status) ? status : "pending";
        return `<article class="request-card request-${requestVisualStatus}">
          <div class="request-card-head"><div><small>${escapeHtml(request.providerName || "نشاطك")}</small><h3>${escapeHtml(providerItemsTitle(request))}</h3></div><span class="status ${status === "completed" || status === "accepted" ? "ok" : status === "rejected" || status === "cancelled" ? "bad" : ""}">${escapeHtml(requestStatusLabels[status] || status)}</span></div>
          <p>${escapeHtml(request.requestText || "بدون تفاصيل إضافية")}</p>
          <div class="request-meta"><span>العميل: ${escapeHtml(request.customerName || "عميل كروة")}</span><span>${providerRequestItems(request).length} ${providerRequestItems(request).length===1?"صنف":"أصناف"}</span><span>قيمة الحاجة: ${money(request.subtotal || request.itemPrice)}</span></div>${providerItemsHtml(request)}
          ${request.customerEditedAt ? `<div class="notice" style="margin-top:10px"><strong>✏️ عدّل العميل الطلب ${Number(request.customerEditCount || 1).toLocaleString("ar-IQ")} مرة</strong><span>هذه هي أحدث كمية وملاحظات معتمدة. يبقى التعديل متاحًا للعميل حتى استلام مندوب التوصيل.</span></div>` : ""}
          <div class="request-meta"><span>${deliveryText}</span></div>
          ${request.pickupOtp && request.deliveryRequested ? `<div class="notice" style="margin-top:10px"><strong>🔐 رمز استلام الكابتن: ${escapeHtml(request.pickupOtp)}</strong><span>أعطِ هذا الرمز للكابتن فقط بعد وصوله فعليًا واستلامه الطلب منك. لا يبدأ التوصيل للعميل بدونه.</span></div>` : ""}
          ${request.providerNote ? `<p class="notice bad" style="margin-top:10px">${escapeHtml(request.providerNote)}</p>` : ""}
          ${actions}
        </article>`;
      }).join("")
    : `<div class="empty">لا توجد طلبات عملاء حتى الآن.</div>`;
}

byId("providerRequestsList").addEventListener("click", async event => {
  const button = event.target.closest("[data-request-action]");
  if (!button || !currentUser) return;
  const nextStatus = button.dataset.requestAction;
  const request = providerRequests.find(item => item.firestoreId === button.dataset.requestId);
  if (!request) return toast("تعذر العثور على الطلب.");
  const providerNote = nextStatus === "rejected"
    ? prompt("اكتب سبب رفض الطلب للعميل:", "الخدمة غير متاحة حاليًا")?.trim()
    : "";
  const cancellationReason = nextStatus === "cancelled" ? requestProviderCancellationReason() : "";
  if (nextStatus === "rejected" && !providerNote) return;
  if (nextStatus === "cancelled" && !cancellationReason) return;
  if (nextStatus === "accepted") {
    const requiredFee = providerOperationFee(request);
    if (walletAvailable() < requiredFee) {
      toast(`رصيدك غير كافٍ لقبول الطلب. يلزم ${requiredFee.toLocaleString("ar-IQ")} د.ع. اشحن المحفظة ثم اضغط الموافقة مرة أخرى.`);
      return;
    }
  }
  setBusy(button, true);
  try {
    if (nextStatus === "accepted") {
      const result=await karwaSensitiveAction("provider_accept_request",{requestId:request.firestoreId});
      if(Number.isFinite(Number(result?.balance))){currentUserData={...(currentUserData||{}),balance:Number(result.balance),bonusBalance:Number(result?.bonusBalance||0)};renderServiceWallet();}
      toast(request.deliveryRequested ? "تمت الموافقة وإرسال التوصيل فورًا إلى كباتن التوصيل المطابقين ضمن 10 كم" : (request.itemDeliveryAvailable===true ? "تمت الموافقة. ينتظر النظام الآن اختيار العميل للتوصيل أو الاستلام." : "تم قبول الطلب للاستلام من النشاط"));
    } else if (nextStatus === "cancelled") {
      await karwaProviderCancelRequest(request.firestoreId,cancellationReason);
      toast("تم إلغاء الطلب وتسجيل السبب للإدارة");
    } else {
      await updateDoc(doc(db, "serviceRequests", request.firestoreId), {
        status: nextStatus,
        providerNote: providerNote?.slice(0, 300) || "",
        statusUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      toast(nextStatus === "completed" ? "تم إكمال الطلب" : "تم رفض الطلب مع توضيح السبب");
    }
  } catch (error) {
    console.error(error);
    const code=String(error?.message||"").toUpperCase();
    if(code.includes("INSUFFICIENT_WALLET")){
      const requiredFee=providerOperationFee(request);
      toast(`رصيدك غير كافٍ لقبول الطلب. يلزم ${requiredFee.toLocaleString("ar-IQ")} د.ع. اشحن المحفظة ثم حاول مجددًا.`);
    } else if(code.includes("LOCATION_REQUIRED")){
      toast("تعذر إنشاء طلب التوصيل لأن موقع المطعم أو العميل غير محدد. حدّث الموقع ثم حاول مجددًا.");
    } else if(code.includes("REQUEST_NOT_AVAILABLE")||code.includes("TOPUP_ALREADY_REVIEWED")){
      toast("تم تحديث هذا الطلب بالفعل من جهاز آخر. ستتحدث القائمة تلقائيًا.");
    } else if(code.includes("REQUEST_NOT_FOUND")){
      toast("الطلب غير موجود أو تم حذفه.");
    } else if(code.includes("NOT_PROVIDER")){
      toast("هذا الطلب غير تابع لحساب الخدمة الحالي.");
    } else if(error?.message === "DELIVERY_COMPLETED"){
      toast("لا يمكن إلغاء الطلب بعد اكتمال التوصيل.");
    } else {
      toast("تعذر تحديث حالة الطلب. تحقق من الاتصال وحاول مرة أخرى.");
    }
  } finally {
    setBusy(button, false);
  }
});

async function openProvider() {
  showView("providerView");
  subscribeServiceTopups(currentUser);
  const [profileSnapshot, applicationSnapshot, restaurantSnapshot] = await Promise.all([
    getDoc(doc(db, "serviceProfiles", currentUser.uid)),
    getDoc(doc(db, "serviceApplications", currentUser.uid)),
    getDoc(doc(db, "restaurants", currentUser.uid))
  ]);
  currentApplication = applicationSnapshot.exists() ? applicationSnapshot.data() : null;
  const restaurant = restaurantSnapshot.exists() ? restaurantSnapshot.data() : null;
  currentProfile = profileSnapshot.exists() ? profileSnapshot.data() : {
    businessName: restaurant?.name || currentApplication?.businessName || "",
    category: currentApplication?.category || (restaurant ? "restaurant" : "other"),
    phone: restaurant?.phone || currentApplication?.phone || "",
    city: currentApplication?.city || "",
    address: restaurant?.address || currentApplication?.address || "",
    description: currentApplication?.description || "",
    location: restaurant?.location || currentApplication?.location || null,
    items: restaurant?.meals || [],
    active: restaurant?.active !== false
  };
  fillProviderForm(currentProfile);

  contentUnsubscribe?.();
  contentUnsubscribe = onSnapshot(doc(db, "serviceProfiles", currentUser.uid), snapshot => {
    if (!snapshot.exists()) return;
    currentProfile = snapshot.data();
    byId("activeMetric").textContent = currentProfile.active === false ? "متوقف مؤقتًا" : "نشط";
  }, error => console.error(error));

  requestsUnsubscribe?.();
  requestsUnsubscribe = onSnapshot(
    query(collection(db, "serviceRequests"), where("providerId", "==", currentUser.uid)),
    snapshot => {
      providerRequests = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }))
        .sort((a, b) => Number(b.createdAt?.seconds || 0) - Number(a.createdAt?.seconds || 0));
      renderProviderRequests(providerRequests);
      providerRequests.filter(request => request.status === "accepted" && request.deliveryStatus === "awaitingCaptain" && !request.pickupOtp && !pickupOtpBackfillIds.has(request.firestoreId)).forEach(request => {
        pickupOtpBackfillIds.add(request.firestoreId);
        karwaProviderBackfillPickupOtp(request.firestoreId).catch(error => {
          console.error("pickup OTP backfill failed", error);
          pickupOtpBackfillIds.delete(request.firestoreId);
        });
      });
    },
    error => {
      console.error(error);
      byId("providerRequestsList").innerHTML = `<div class="empty">تعذر تحميل طلبات العملاء.</div>`;
    }
  );
}

byId("pGpsBtn").addEventListener("click", async () => {
  const button = byId("pGpsBtn");
  setBusy(button, true, "جاري تثبيت GPS…");
  try {
    const position=await getServicePrecisePosition();
    providerLocation = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy };
    byId("pGpsStatus").textContent = `تم التحديد ✓ دقة ${Math.round(providerLocation.accuracy||0)} م • ${providerLocation.latitude.toFixed(5)}, ${providerLocation.longitude.toFixed(5)}`;
    toast("تم تحديث الموقع الجغرافي بدقة عالية");
  } catch(error) { handleServiceLocationError(error); }
  finally { setBusy(button, false); }
});

["pBusinessName", "pPhone", "pCity", "pAddress", "pDescription", "pActive"].forEach(id => {
  byId(id).addEventListener("input", renderPreview);
});

byId("providerForm").addEventListener("submit", async event => {
  event.preventDefault();
  const category = currentProfile?.category || currentApplication?.category || "other";
  const businessName = byId("pBusinessName").value.trim();
  const phone = byId("pPhone").value.trim();
  const city = byId("pCity").value.trim();
  const address = byId("pAddress").value.trim();
  const description = byId("pDescription").value.trim();
  const active = byId("pActive").checked;
  if (businessName.length < 2 || !validPhone(phone) || city.length < 2 || address.length < 3) return toast("أكمل بيانات النشاط بشكل صحيح.");
  if (!providerLocation) return toast("حدد موقع النشاط قبل نشره للعملاء.");
  if (category === "restaurant" && !providerItems.length) return toast("أضف وجبة واحدة على الأقل للمطعم.");

  const publishFee=fixedFee("publishFee",1000);
  const chargePublish=active&&currentProfile?.publishFeePaid!==true;
  const publishWalletPatch=chargePublish?walletDebitPatch(currentUserData||{},publishFee):null;
  if(chargePublish&&publishFee>0&&!publishWalletPatch)return toast(`يلزم ${publishFee.toLocaleString("ar-IQ")} د.ع لنشر النشاط لأول مرة. اشحن المحفظة ثم أعد المحاولة.`);
  const button = byId("saveProviderButton");
  const newlyUploadedPaths = [];
  setBusy(button, true, "جارٍ حفظ التغييرات ورفع الصور…");
  try {
    const coverNeededUpload = Boolean(normalizedImageAsset(providerCoverImage)?.draftBlob);
    const finalCoverImage = await uploadServiceAssetIfNeeded(providerCoverImage, "cover", businessName || category);
    if (coverNeededUpload && finalCoverImage?.path) newlyUploadedPaths.push(finalCoverImage.path);
    const finalItems = [];
    for (let index = 0; index < providerItems.length; index += 1) {
      const item = normalizedProviderItem(providerItems[index]);
      const imageNeededUpload = Boolean(normalizedImageAsset(item.image)?.draftBlob);
      const finalImage = await uploadServiceAssetIfNeeded(item.image, "items", item.name || `${category}-${index + 1}`);
      if (imageNeededUpload && finalImage?.path) newlyUploadedPaths.push(finalImage.path);
      finalItems.push({ ...item, image: finalImage });
    }
    const removedPaths=collectRemovedAssetPaths(currentProfile||{},finalCoverImage,finalItems);
    const profilePayload={ownerId:currentUser.uid,businessName,category,phone,city,address,description,location:providerLocation,items:finalItems.map(item=>({...item})),coverImage:finalCoverImage,active,updatedAt:serverTimestamp()};
    const restaurantPayload=category==="restaurant"?{ownerId:currentUser.uid,name:businessName,phone,address,location:providerLocation,meals:finalItems.map(item=>({...item})),coverImage:finalCoverImage,active,updatedAt:serverTimestamp()}:null;
    const publishResult=await karwaSensitiveAction("publish_service_profile",{profile:profilePayload,restaurant:restaurantPayload});
    if(Number.isFinite(Number(publishResult?.balance))){currentUserData={...(currentUserData||{}),balance:Number(publishResult.balance),bonusBalance:Number(publishResult?.bonusBalance||0)};renderServiceWallet();}
    await Promise.allSettled(removedPaths.map(deleteServiceAssetPath));
    currentProfile={...currentProfile,businessName,category,phone,city,address,description,location:providerLocation,items:finalItems,coverImage:finalCoverImage,active,publishFeePaid:currentProfile?.publishFeePaid===true||Boolean(publishResult?.charged),publishFeeAmount:currentProfile?.publishFeePaid===true?Number(currentProfile.publishFeeAmount||publishFee):(publishResult?.charged?Number(publishResult?.fee||publishFee):Number(currentProfile?.publishFeeAmount||0))};
    providerItems = finalItems.map(normalizedProviderItem);
    providerCoverImage = normalizedImageAsset(finalCoverImage);
    byId("providerHeroName").textContent = businessName;
    renderCoverImagePanel();
    renderDraftItemImagePanel();
    renderProviderItems();
    renderPreview();
    toast("تم حفظ ملف الخدمة والصور بنجاح");
  } catch (error) {
    console.error(error);
    await Promise.allSettled(newlyUploadedPaths.map(deleteServiceAssetPath));
    toast("تعذر حفظ التغييرات أو رفع الصور. تم تنظيف أي صور جديدة لم يكتمل حفظها.");
  } finally { setBusy(button, false); }
});

byId("serviceTopupForm")?.addEventListener("submit",async event=>{
  event.preventDefault();if(!currentUser)return;
  if(!serviceTransferTopupEnabled())return toast("طريقة الشحن بالتحويل متوقفة حاليًا من الإدارة.");
  const amount=Math.round(Number(byId("serviceTopupAmount")?.value||0));
  const transferReference=byId("serviceTopupReference")?.value.trim()||"";
  if(!Number.isFinite(amount)||amount<5000||amount>1000000||amount%5000!==0)return toast("الشحن بالتحويل يبدأ من 5,000 د.ع وبمضاعفات 5,000 فقط.");
  if(transferReference.length<3)return toast("اكتب مرجع التحويل");
  if(serviceHasPendingTopup())return toast("لديك طلب شحن قيد المراجعة. لا يمكن إرسال طلب آخر حتى تعتمد الإدارة الطلب أو ترفضه.");
  const button=event.submitter||byId("serviceTopupSubmit");setBusy(button,true,"جاري الإرسال…");
  try{const result=await karwaSensitiveAction("submit_topup",{amount,transferReference,customerName:currentUserData?.name||currentUser.displayName||"مزود خدمة",email:currentUser.email||"",accountType:"service"});serviceTopupRequests=[{firestoreId:result?.requestId||"",userId:currentUser.uid,amount,transferReference,status:"pending",createdAt:null},...serviceTopupRequests.filter(x=>x.firestoreId!==result?.requestId)];renderServiceTopupRequests();event.currentTarget.reset();toast("تم إرسال طلب الشحن مرة واحدة. انتظر قرار الإدارة قبل طلب جديد.");}catch(error){console.error(error);const msg=String(error?.message||"").toUpperCase();toast(msg.includes("TOPUP_TRANSFER_DISABLED")?"طريقة الشحن بالتحويل متوقفة حاليًا من الإدارة.":(["permission-denied","failed-precondition","already-exists"].includes(error?.code)||msg.includes("TOPUP_PENDING"))?"يوجد طلب شحن قيد المراجعة بالفعل. انتظر قرار الإدارة قبل إرسال طلب جديد.":"تعذر إرسال طلب الشحن");}finally{setBusy(button,false);updateServiceTopupFormState();}
});

byId("serviceTopupCardRedeemForm")?.addEventListener("submit",async event=>{
  event.preventDefault();if(!currentUser)return;
  if(!serviceCardTopupEnabled())return toast("طريقة الشحن بالكرت متوقفة حاليًا من الإدارة.");
  const code=String(byId("serviceTopupCardCode")?.value||"").replace(/\D/g,"");
  if(code.length!==16)return toast("أدخل رقم الكرت المكوّن من 16 رقمًا.");
  const button=event.submitter||byId("serviceRedeemTopupCard");setBusy(button,true,"جاري الشحن…");
  try{const result=await karwaRedeemTopupCard(code);currentUserData={...(currentUserData||{}),balance:Number(result?.balance ?? currentUserData?.balance ?? 0)};renderServiceWallet();event.currentTarget.reset();toast(`تم شحن ${Number(result?.amount||0).toLocaleString("ar-IQ")} د.ع بنجاح. الكرت أصبح مستخدمًا.`);}
  catch(error){console.error(error);const msg=String(error?.message||"");toast(msg.includes("TOPUP_CARD_METHOD_DISABLED")?"طريقة الشحن بالكرت متوقفة حاليًا من الإدارة.":msg.includes("TOPUP_CARD_USED")?"هذا الكرت مستخدم مسبقًا.":msg.includes("INVALID_TOPUP_CARD")?"رقم الكرت غير صحيح أو غير موجود.":msg.includes("TOPUP_CARD_DISABLED")?"هذا الكرت غير فعال.":"تعذر شحن الرصيد بالكرت.");}
  finally{setBusy(button,false);}
});

function clearRoleContent() {
  contentUnsubscribe?.();
  contentUnsubscribe = null;
  requestsUnsubscribe?.();
  requestsUnsubscribe = null;
  topupUnsubscribe?.();
  topupUnsubscribe = null;
  serviceTopupRequests = [];
  serviceTopupSnapshotReady = false;
  providerRequests = [];
}

onAuthStateChanged(auth, user => {
  if(user){registerServiceNativePushToken(user);window.setTimeout(()=>registerServiceNativePushToken(user),5000);}
  currentUser = user;
  activeRole = "";
  roleUnsubscribe?.();
  roleUnsubscribe = null;
  clearRoleContent();
  byId("logoutBtn").classList.toggle("hidden", !user);

  if (!user) {
    currentUserData = null;
    byId("accountName").textContent = "";
    setAuthMode(authMode);
    showView("authView");
    return;
  }

  showView("loadingView");
  roleUnsubscribe = onSnapshot(doc(db, "users", user.uid), async snapshot => {
    if (!snapshot.exists()) {
      byId("deniedText").textContent = "ملف الحساب غير مكتمل. سجّل الخروج ثم أنشئ حساب خدمة جديدًا.";
      showView("deniedView");
      return;
    }
    currentUserData = snapshot.data();
    const deviceCheck = await enforceDeviceSession(db,user,currentUserData);
    if (!deviceCheck.ok) {
      const message=deviceCheck.message;
      await signOut(auth);
      window.setTimeout(()=>{setAuthMode("login");showView("authView");byId("authMessage").textContent=message;},40);
      return;
    }
    byId("accountName").textContent = currentUserData.name || user.displayName || user.email || "";
    renderServiceWallet();
    const role = currentUserData.role;
    if (role === activeRole) return;
    activeRole = role;
    clearRoleContent();

    try {
      if (role === "serviceApplicant") await openApplicant();
      else if (role === "serviceProvider") await openProvider();
      else {
        byId("deniedText").textContent = role === "customer"
          ? "هذا حساب عميل. أنشئ حساب مزود خدمة مستقلًا للتقديم."
          : String(role || "").startsWith("driver")
            ? "هذا حساب كابتن. استخدم بوابة الكابتن لإدارة عملك."
            : "نوع الحساب الحالي لا يملك صلاحية فتح بوابة الخدمات.";
        showView("deniedView");
      }
    } catch (error) {
      console.error(error);
      toast("تعذر تحميل بيانات حساب الخدمة.");
      byId("deniedText").textContent = "تعذر قراءة ملف الخدمة. تحقق من نشر سياسات Supabase المرفقة.";
      showView("deniedView");
    }
  }, error => {
    console.error(error);
    byId("deniedText").textContent = "تعذر التحقق من صلاحية الحساب. تحقق من الاتصال وسياسات Supabase.";
    showView("deniedView");
  });
});

const karwaBonusExpiryRefresh=setInterval(()=>{if(currentUser)renderServiceWallet();},60000);
