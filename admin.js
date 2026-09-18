import { initializeApp } from "./supabase-compat.js?v=99";
import {
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut
} from "./supabase-compat.js?v=99";
import {
  collection,
  doc,
  getDoc,
  getSupabase,
  increment,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  karwaSensitiveAction
} from "./supabase-compat.js?v=99";

const app = initializeApp({ backend: "supabase", project: "karwa" }, "karwa-admin-portal");
const auth = getAuth(app);
const db = getSupabase(app);

async function registerAdminNativePushToken(user){
  if(!user)return false;let token="";try{token=String(window.KarwaNative?.getPushToken?.()||window.KarwaNotify?.getNativePushToken?.()||"").trim()}catch{}if(!token)return false;
  const id=`android_${token.slice(-36).replace(/[^a-zA-Z0-9_-]/g,"_")}`;
  try{await setDoc(doc(db,"users",user.uid,"pushTokens",id),{token,platform:"android",app:"karwa",role:"admin",updatedAt:serverTimestamp()},{merge:true});return true}catch(error){console.warn("تعذر تسجيل رمز إشعارات الإدارة",error);return false}
}
window.addEventListener("karwa-native-push-token",()=>{if(auth.currentUser)registerAdminNativePushToken(auth.currentUser)});

try {
  await setPersistence(auth, browserLocalPersistence);
} catch (error) {
  console.warn("تعذر تفعيل حفظ جلسة الإدارة", error);
}

const byId = id => document.getElementById(id);
const statuses = ["بانتظار كابتن", "الكابتن في الطريق", "وصل الكابتن", "بدأت الرحلة", "تم الوصول"];
const icons = { ride: "🚕", parcel: "📦", food: "🍽️", serviceDelivery: "🛵" };

const state = {
  user: null,
  users: [],
  applications: [],
  serviceApplications: [],
  serviceProfiles: [],
  restaurants: [],
  drivers: [],
  ratings: [],
  ratingsFilter: "all",
  orders: [],
  serviceRequests: [],
  topupRequests: [],
  deviceBindings: [],
  deviceLinks: [],
  deviceChangeRequests: [],
  pricingSettings: {},
  areaMap: null,
  areaBaseLayer: null,
  areaCenter: null,
  areaCircle: null,
  areaCenterMarker: null,
  areaMarkers: new Map(),
  roleUnsubscribe: null,
  dashboardUnsubscribes: []
};

const money = value => Number(value || 0).toLocaleString("ar-IQ") + " د.ع";

function isBikeVehicle(record = {}) {
  return String(record.vehicleType || "").trim().includes("دراجة");
}

function normalizeCaptainServiceType(record = {}) {
  const raw = String(record.serviceType || "").trim();
  const lower = raw.toLowerCase();
  if (lower === "other") return "other";
  if (isBikeVehicle(record)) return "delivery";
  if (["delivery", "parcel", "food", "servicedelivery"].includes(lower) || raw.includes("توصيل")) return "delivery";
  if (["taxi", "ride"].includes(lower) || raw.includes("تكسي")) return "taxi";
  return "";
}

function captainServiceLabel(record = {}) {
  const type = normalizeCaptainServiceType(record);
  if (type === "delivery") return "توصيل أغراض وطعام";
  if (type === "taxi") return "تكسي — نقل ركاب";
  if (type === "other") return "خدمات أخرى";
  return "غير محدد";
}

function captainServiceIcon(record = {}) {
  return normalizeCaptainServiceType(record) === "delivery" ? "🛵" : "🚕";
}

const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
})[char]);

function toast(message) {
  const element = byId("toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(window.adminToast);
  window.adminToast = setTimeout(() => element.classList.remove("show"), 2800);
}

function busy(button, active, text = "جاري التنفيذ…") {
  if (active) {
    button.dataset.label = button.textContent;
    button.textContent = text;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

function authMessage(error) {
  const messages = {
    "auth/invalid-credential": "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
    "auth/invalid-email": "البريد الإلكتروني غير صحيح.",
    "auth/too-many-requests": "محاولات كثيرة؛ حاول بعد قليل.",
    "auth/network-request-failed": "تعذر الاتصال بالإنترنت."
  };
  return messages[error.code] || "تعذر تسجيل الدخول.";
}

function activationUid(application, fallbackId = "") {
  return String(application?.userId || fallbackId || "").trim();
}

function activationUserPayload(application, role) {
  const name = String(application?.ownerName || application?.name || application?.businessName || "مستخدم كروة").trim() || "مستخدم كروة";
  const email = String(application?.email || "").trim();
  return {
    name,
    email,
    role,
    balance: 0,
    bonusBalance: 0,
    bonusExpiresAt: null,
    welcomeBonusGranted: false,
    welcomeBonusEvaluated: true,
    notifications: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
}

function adminRoleLabel(role="") {
  return ({customer:"عميل",driver:"كابتن",driverApplicant:"طلب كابتن",serviceProvider:"خدمات أخرى",serviceApplicant:"طلب خدمات",admin:"إدارة"})[role] || role || "حساب";
}
function deviceRoleFamily(role="") {
  if (["driver","driverApplicant"].includes(role)) return "driver";
  if (["serviceProvider","serviceApplicant"].includes(role)) return "service";
  return "customer";
}
function userForDevice(uid){return state.users.find(item=>item.firestoreId===uid)||{};}
function currentDeviceLink(uid){return state.deviceLinks.find(item=>item.firestoreId===uid)||null;}
function renderDeviceManagement(){
  const requests=[...state.deviceChangeRequests].sort((a,b)=>{const ap=(a.status||"pending")==="pending"?0:1,bp=(b.status||"pending")==="pending"?0:1;if(ap!==bp)return ap-bp;return Number(b.requestedAt?.seconds||0)-Number(a.requestedAt?.seconds||0);});
  const pending=requests.filter(item=>(item.status||"pending")==="pending");
  const badge=byId("deviceChangesBadge");if(badge){badge.textContent=`${pending.length} طلب تغيير`;badge.classList.toggle("no-items",pending.length===0);}
  const requestHost=byId("deviceChangeRequestsList");
  if(requestHost){
    requestHost.innerHTML=requests.length?requests.map(req=>{
      const uid=req.userId||req.firestoreId,user=userForDevice(uid),link=currentDeviceLink(uid),oldKey=link?.deviceKey||"غير مسجل",status=req.status||"pending";
      const statusLabel=status==="approved"?"تم الاستبدال":status==="rejected"?"مرفوض":"بانتظار القرار";
      const actions=status==="pending"?`<div class="order-actions"><button class="primary" data-action="approve-device-change" data-id="${escapeHtml(req.firestoreId)}">السماح واستبدال الجهاز</button><button class="danger" data-action="reject-device-change" data-id="${escapeHtml(req.firestoreId)}">رفض الطلب</button></div>`:"";
      return `<article class="device-admin-card ${status}"><div class="device-admin-head"><div><strong>${escapeHtml(req.accountName||user.name||"مستخدم كروة")}</strong><small> • ${escapeHtml(req.email||user.email||"")} • ${escapeHtml(adminRoleLabel(req.accountRole||user.role))}</small></div><span class="status-chip ${status==='approved'?'approved':status==='rejected'?'cancelled':'pending'}">${statusLabel}</span></div><div class="device-pair"><div><small>المعرف الحالي</small><code class="device-id">${escapeHtml(oldKey)}</code><small>${escapeHtml(link?.deviceLabel||"—")}</small></div><div><small>المعرف الجديد المطلوب</small><code class="device-id">${escapeHtml(req.newDeviceKey||"—")}</code><small>${escapeHtml(req.newDeviceLabel||"Android")}</small></div></div>${req.reviewNote?`<p class="admin-note">${escapeHtml(req.reviewNote)}</p>`:""}${actions}</article>`;
    }).join(""):`<p class="muted">لا توجد طلبات تغيير جهاز.</p>`;
  }
  const boundHost=byId("boundDevicesList");
  if(boundHost){
    const rows=[...state.deviceLinks].sort((a,b)=>String(userForDevice(a.firestoreId).name||a.firestoreId).localeCompare(String(userForDevice(b.firestoreId).name||b.firestoreId),"ar"));
    boundHost.innerHTML=rows.length?rows.map(link=>{const user=userForDevice(link.firestoreId);return `<div class="device-bound-row"><div><strong>${escapeHtml(user.name||link.firestoreId)}</strong><small>${escapeHtml(adminRoleLabel(user.role||link.roleFamily))} • ${escapeHtml(user.email||"")}</small></div><div><code class="device-id">${escapeHtml(link.deviceKey||"—")}</code><small>${escapeHtml(link.deviceLabel||"Android")}</small></div></div>`;}).join(""):`<p class="muted">لا توجد أجهزة مرتبطة بعد.</p>`;
  }
}

function activationErrorMessage(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  if (code.includes("permission-denied")) return "رفض Supabase عملية التفعيل. تحقق من سياسات RLS وRPC في Supabase ثم أعد المحاولة.";
  if (code.includes("invalid-argument") || /undefined|unsupported field/i.test(message)) return "بيانات طلب التسجيل قديمة أو ناقصة. حدّث الصفحة وأعد المحاولة بعد ترقية قاعدة Supabase.";
  if (/NOT_FOUND|MISSING_UID/.test(message)) return "تعذر العثور على حساب الطلب أو UID الخاص به.";
  return `تعذر تنفيذ العملية${code ? ` (${code})` : ""}. راجع سجل المتصفح للتفاصيل.`;
}

function showView(name) {
  byId("authView").classList.toggle("hidden", name !== "auth");
  byId("deniedView").classList.toggle("hidden", name !== "denied");
  byId("dashboardView").classList.toggle("hidden", name !== "dashboard");
  byId("logoutButton").classList.toggle("hidden", name === "auth");
  byId("adminNotificationsLink").classList.toggle("hidden", name !== "dashboard");
}

function clearDashboardListeners() {
  state.dashboardUnsubscribes.forEach(unsubscribe => unsubscribe?.());
  state.dashboardUnsubscribes = [];
}

function adminNotificationCounts() {
  const captainApplications = state.applications.filter(item =>
    (item.status || "pending") === "pending" && normalizeCaptainServiceType(item) !== "other"
  ).length;
  const modernServiceIds = new Set(state.serviceApplications.map(item => item.firestoreId));
  const legacyServiceApplications = state.applications.filter(item =>
    normalizeCaptainServiceType(item) === "other" && !modernServiceIds.has(item.firestoreId)
  );
  const serviceApplications = [...state.serviceApplications, ...legacyServiceApplications]
    .filter(item => (item.status || "pending") === "pending").length;
  const topups = state.topupRequests.filter(item => (item.status || "pending") === "pending").length;
  const waitingOrders = state.orders.filter(order =>
    !order.cancelled && !order.driverId && Number(order.statusIndex || 0) === 0
  ).length;
  const driversAttention = state.drivers.filter(driver =>
    driver.blocked === true || Number(driver.warningCount || 0) > 0
  ).length;
  const completedTrips = state.orders.filter(order =>
    !order.cancelled && Number(order.statusIndex || 0) >= 4
  ).length;
  const deviceChanges = state.deviceChangeRequests.filter(item => (item.status || "pending") === "pending").length;

  return {
    captainApplications,
    serviceApplications,
    topups,
    waitingOrders,
    driversAttention,
    completedTrips,
    deviceChanges,
    ratings: state.ratings.length
  };
}

function setModuleNotification(id, count, alert = true) {
  const badge = byId(id);
  if (!badge) return;
  badge.textContent = String(count);
  badge.setAttribute("aria-label", `${count} إشعار`);
  badge.classList.toggle("has-items", alert && count > 0);
  badge.closest(".admin-module-card")?.classList.toggle("has-alerts", alert && count > 0);
}

function setPanelNotification(id, count, suffix) {
  const badge = byId(id);
  if (!badge) return;
  badge.textContent = `${count} ${suffix}`;
  badge.classList.toggle("no-items", count === 0);
}

function renderAdminNotifications() {
  const counts = adminNotificationCounts();
  setModuleNotification("navTopupsCount", counts.topups);
  setModuleNotification("navServicesCount", counts.serviceApplications);
  setModuleNotification("navCaptainsCount", counts.captainApplications);
  setModuleNotification("navDriversCount", counts.driversAttention);
  setModuleNotification("navOrdersCount", counts.waitingOrders);
  setModuleNotification("navFinanceCount", counts.completedTrips, false);
  setModuleNotification("navRatingsCount", counts.ratings, false);

  setPanelNotification("pendingTopupsBadge", counts.topups, "بانتظار المراجعة");
  setPanelNotification("serviceApplicationsBadge", counts.serviceApplications, "بانتظار المراجعة");
  setPanelNotification("captainApplicationsBadge", counts.captainApplications, "بانتظار المراجعة");
  setPanelNotification("driversAttentionBadge", counts.driversAttention, "يحتاج متابعة");
  setPanelNotification("waitingOrdersBadge", counts.waitingOrders, "بانتظار كابتن");
  setPanelNotification("financialReportBadge", counts.completedTrips, "رحلة مكتملة");
  setPanelNotification("ratingsBadge", counts.ratings, "تقييم");

  const actionable = counts.topups + counts.serviceApplications + counts.captainApplications + counts.driversAttention + counts.waitingOrders + counts.deviceChanges;
  const globalBadge = byId("globalNotificationsBadge");
  const notificationsLink = byId("adminNotificationsLink");
  const heroCount = byId("heroActionCount");
  if (globalBadge) {
    globalBadge.textContent = String(actionable);
    globalBadge.setAttribute("aria-label", `${actionable} إجراء يحتاج متابعة`);
  }
  notificationsLink?.classList.toggle("no-alerts", actionable === 0);
  if (heroCount) {
    heroCount.textContent = actionable ? `${actionable} إجراء يحتاج متابعة` : "لا توجد إجراءات معلّقة";
    heroCount.classList.toggle("has-items", actionable > 0);
  }
}

let adminDashboardUid = "";
let adminAccessCheckToken = 0;

async function verifyAdminAccess(user) {
  if (!user?.uid) return false;

  // Fast, normalized server-side check. The RPC is SECURITY INVOKER and can
  // only read the signed-in user's own profile through the existing RLS rule.
  try {
    const { data, error } = await db.client.rpc("karwa_is_admin");
    if (!error && data === true) return true;
  } catch (error) {
    console.warn("تعذر فحص صلاحية الإدارة عبر RPC", error);
  }

  // Direct normalized profile fallback.
  try {
    const { data, error } = await db.client
      .from("profiles")
      .select("role,active")
      .eq("id", user.uid)
      .maybeSingle();
    if (!error && data?.role === "admin" && data?.active !== false) return true;
  } catch (error) {
    console.warn("تعذر فحص صلاحية الإدارة من profiles", error);
  }

  // Compatibility fallback for the document bridge.
  try {
    const snapshot = await getDoc(doc(db, "users", user.uid));
    return snapshot.exists() && snapshot.data()?.role === "admin";
  } catch (error) {
    console.warn("تعذر فحص صلاحية الإدارة من users", error);
    return false;
  }
}

async function verifyAdminAccessWithRetry(user, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    if (await verifyAdminAccess(user)) return true;
    if (i < attempts - 1) await new Promise(resolve => setTimeout(resolve, 250 + i * 200));
  }
  return false;
}

async function enterAdminPortal(user) {
  const token = ++adminAccessCheckToken;
  if (user) state.user = user;
  if (!user) {
    adminDashboardUid = "";
    showView("auth");
    return false;
  }

  const status = byId("authError");
  if (status && !byId("authView")?.classList.contains("hidden")) status.textContent = "جاري التحقق من صلاحية الإدارة…";
  const allowed = await verifyAdminAccessWithRetry(user);
  if (token !== adminAccessCheckToken || auth.currentUser?.uid !== user.uid) return false;

  if (!allowed) {
    adminDashboardUid = "";
    if (status) status.textContent = "";
    showView("denied");
    return false;
  }

  try {
    // Supabase already persists the authenticated session in localStorage.
    // Keep only a harmless marker/email for UX; never store the password ourselves.
    try {
      localStorage.setItem("karwa.admin.remembered", "1");
      localStorage.setItem("karwa.admin.lastEmail", String(user.email || ""));
    } catch (_) {}
    if (adminDashboardUid !== user.uid) {
      adminDashboardUid = user.uid;
      openDashboard();
    } else {
      showView("dashboard");
    }
    if (status) status.textContent = "";
    return true;
  } catch (error) {
    // Never leave a valid admin on a blank page because a dashboard module failed.
    console.error("Admin dashboard initialization failed", error);
    showView("dashboard");
    const toastBox = byId("toast");
    if (toastBox) {
      toastBox.textContent = "تم الدخول للإدارة، لكن تعذر تحميل أحد أقسام اللوحة. حدّث الصفحة مرة واحدة.";
      toastBox.classList.add("show");
    }
    return true;
  }
}

byId("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  const button = byId("loginButton");
  byId("authError").textContent = "";
  busy(button, true, "جاري الدخول…");
  try {
    // The auth observer below performs the single authorization transition.
    // Avoid calling enterAdminPortal here as well; duplicate transitions caused
    // a race where the login form disappeared before the dashboard opened.
    await signInWithEmailAndPassword(auth, byId("email").value.trim(), byId("password").value);
    byId("authError").textContent = "جاري التحقق من صلاحية الإدارة…";
  } catch (error) {
    console.error("Admin sign-in failed", { code: error?.code, message: error?.message });
    byId("authError").textContent = authMessage(error);
  } finally {
    busy(button, false);
  }
});

// "خروج من الإدارة" leaves the admin page but intentionally keeps the
// Supabase session on this device. Reopening admin.html restores it directly.
byId("logoutButton").addEventListener("click", () => {
  try { localStorage.setItem("karwa.admin.remembered", "1"); } catch (_) {}
  window.location.href = "./index.html";
});

// This button is only shown on the denied-access screen and must clear the
// invalid/non-admin session so another account can be used.
byId("deniedLogout").addEventListener("click", async () => {
  try {
    await signOut(auth);
  } finally {
    try {
      localStorage.removeItem("karwa.admin.remembered");
      localStorage.removeItem("karwa.admin.lastEmail");
    } catch (_) {}
  }
});

function renderMetrics() {
  const notifications = adminNotificationCounts();
  byId("usersCount").textContent = state.users.filter(user => !user.role || user.role === "customer").length;
  byId("driversCount").textContent = state.drivers.length;
  byId("serviceProvidersCount").textContent = state.users.filter(user => user.role === "serviceProvider").length;
  byId("blockedCount").textContent = state.drivers.filter(driver => driver.blocked === true).length;
  byId("pendingCount").textContent = notifications.captainApplications + notifications.serviceApplications + notifications.topups + notifications.deviceChanges;
  byId("ordersCount").textContent = state.orders.length;
  byId("liveTripsCount").textContent = state.orders.filter(o => !o.cancelled && Number(o.statusIndex||0) > 0 && Number(o.statusIndex||0) < 4).length;
  byId("cancelledTripsCount").textContent = state.orders.filter(o => o.cancelled).length;
  byId("onlineDriversCount").textContent = state.drivers.filter(d => d.online === true && d.blocked !== true).length;
  const completed=state.orders.filter(o=>!o.cancelled&&Number(o.statusIndex||0)>=4);
  const gross=completed.reduce((n,o)=>n+Number(o.price||0),0);
  const orderFees=state.orders.reduce((n,o)=>n+Number(o.customerPlatformFee||0)+Number(o.captainPlatformFee||0),0);
  const serviceFees=state.serviceRequests.reduce((n,r)=>n+Number(r.customerPlatformFee||0)+Number(r.providerPlatformFee||0),0);
  const publishFees=state.serviceProfiles.reduce((n,p)=>n+(p.publishFeePaid===true?Number(p.publishFeeAmount||0):0),0);
  const platformFees=orderFees+serviceFees+publishFees;
  const payout=completed.reduce((n,o)=>n+Number(o.driverEarnings||0),0);
  byId("grossRevenue").textContent=money(gross);byId("commissionRevenue").textContent=money(platformFees);byId("driversPayout").textContent=money(payout);
  const byDriver={};completed.forEach(o=>{const k=o.driverName||"غير معيّن";byDriver[k]=(byDriver[k]||0)+Number(o.driverEarnings||0)});
  byId("financialReport").innerHTML=completed.length?`<div class="order-meta"><span>رحلات مكتملة: ${completed.length}</span><span>متوسط الطلب: ${money(gross/completed.length)}</span></div>${Object.entries(byDriver).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([name,value])=>`<div class="order-meta"><strong>${escapeHtml(name)}</strong><span>${money(value)}</span></div>`).join("")}`:`<p class="muted">لا توجد رحلات مكتملة بعد.</p>`;
  renderAdminNotifications();
}

function ratingSummary(driverId) {
  const ratings = state.ratings.filter(item => item.driverId === driverId || (item.targetType === "driver" && item.targetId === driverId));
  const average = ratings.length
    ? ratings.reduce((total, item) => total + Number(item.score || 0), 0) / ratings.length
    : 0;
  return { count: ratings.length, average };
}

function providerRatingSummary(providerId) {
  const ratings = state.ratings.filter(item => item.providerId === providerId || (item.targetType === "provider" && item.targetId === providerId));
  const average = ratings.length
    ? ratings.reduce((total, item) => total + Number(item.score || 0), 0) / ratings.length
    : 0;
  return { count: ratings.length, average };
}

function normalizedRatingType(rating = {}) {
  if (rating.ratingType === "service" || rating.targetType === "provider" || rating.providerId) return "service";
  if (rating.ratingType === "delivery") return "delivery";
  if (rating.ratingType === "taxi") return "taxi";
  return "taxi";
}

function ratingTypeLabel(type) {
  return ({ taxi: "تكسي", delivery: "توصيل", service: "خدمات أخرى" })[type] || "تقييم";
}

function driverTripSummary(driverId) {
  const trips = state.orders.filter(order => order.driverId === driverId);
  return {
    total: trips.length,
    completed: trips.filter(order => !order.cancelled && Number(order.statusIndex || 0) >= 4).length,
    cancelled: trips.filter(order => order.cancelled === true).length,
    active: trips.filter(order => !order.cancelled && Number(order.statusIndex || 0) < 4).length
  };
}

function driverOrderState(order) {
  if (order.cancelled) return { label: "ملغاة", css: "cancelled" };
  if (Number(order.statusIndex || 0) >= 4) return { label: "مكتملة", css: "complete" };
  return { label: "جارية", css: "active" };
}

function driverTripDetail(order) {
  const tripState = driverOrderState(order);
  const completed = !order.cancelled && Number(order.statusIndex || 0) >= 4;
  const code = order.id || order.orderCode || order.firestoreId;
  return `
    <div class="captain-trip-row">
      <div class="captain-trip-head">
        <strong>${icons[order.type] || "🧾"} ${escapeHtml(order.title || "رحلة كروة")}</strong>
        <span class="status-chip ${tripState.css}">${tripState.label}</span>
      </div>
      <p class="order-route">${escapeHtml(order.route || "-")}</p>
      <div class="order-meta"><span>رمز الرحلة: <b>${escapeHtml(code)}</b></span><span>قيمة الرحلة: ${money(order.price)}</span></div>
      ${completed ? `<div class="order-meta trip-money"><span>رسوم كروة: ${money(Number(order.customerPlatformFee||0)+Number(order.captainPlatformFee||0))}</span><span>أجرة الكابتن: <b>${money(order.driverEarnings)}</b></span></div>` : ""}
      ${order.cancelled ? `<p class="admin-note danger-note">سبب الإلغاء: ${escapeHtml(order.cancellationReason || "غير مسجل")}</p><div class="order-meta"><span>ألغى بواسطة: ${escapeHtml(order.cancelledByName || cancellationRoleLabel(order.cancelledByRole || order.cancelledBy))}</span><span>${escapeHtml(order.cancelledByEmail || "البريد غير مسجل")}</span></div>` : ""}
      <div class="order-meta trip-dates">${order.acceptedAt?.seconds ? `<span>القبول: ${new Date(order.acceptedAt.seconds*1000).toLocaleString("ar-IQ")}</span>` : ""}${order.completedAt?.seconds ? `<span>الإكمال: ${new Date(order.completedAt.seconds*1000).toLocaleString("ar-IQ")}</span>` : ""}</div>
    </div>`;
}

function driverCard(driver) {
  const rating = ratingSummary(driver.firestoreId);
  const trips = driverTripSummary(driver.firestoreId);
  const driverOrders = state.orders.filter(order => order.driverId === driver.firestoreId)
    .sort((a,b) => Number(b.acceptedAt?.seconds || b.createdAt?.seconds || 0) - Number(a.acceptedAt?.seconds || a.createdAt?.seconds || 0));
  const completedOrders = driverOrders.filter(o => !o.cancelled && Number(o.statusIndex || 0) >= 4);
  const activeOrders = driverOrders.filter(o => !o.cancelled && Number(o.statusIndex || 0) < 4);
  const cancelledOrders = driverOrders.filter(o => o.cancelled === true);
  const captainBalance = completedOrders.reduce((sum,o) => sum + Number(o.driverEarnings || 0), 0);
  const blocked = driver.blocked === true;
  const status = blocked ? "محظور" : driver.online ? "متصل" : "غير متصل";
  const statusClass = blocked ? "rejected" : driver.online ? "approved" : "pending";
  const warningCount = Number(driver.warningCount || 0);
  const blockAction = blocked
    ? `<button class="secondary" data-action="unblock-driver" data-id="${driver.firestoreId}">إعادة التفعيل</button>`
    : `<button class="danger" data-action="block-driver" data-id="${driver.firestoreId}">حظر الكابتن</button>`;
  return `
    <article class="order-card driver-management-card captain-account-card">
      <div class="order-top">
        <h3>${captainServiceIcon(driver)} ${escapeHtml(driver.name || "كابتن كروة")}</h3>
        <span class="status-chip ${statusClass}">${status}</span>
      </div>
      <div class="captain-profile-grid">
        <span><small>رقم الهاتف</small><b>${escapeHtml(driver.phone || "بدون هاتف")}</b></span>
        <span><small>البريد</small><b>${escapeHtml(driver.email || "-")}</b></span>
        <span><small>المدينة</small><b>${escapeHtml(driver.city || "-")}</b></span>
        <span><small>نوع الخدمة</small><b>${captainServiceLabel(driver)}</b></span>
        <span><small>المركبة</small><b>${escapeHtml(driver.vehicleType || "-")}</b></span>
        <span><small>رقم اللوحة</small><b>${escapeHtml(driver.plate || "-")}</b></span>
        ${!isBikeVehicle(driver) ? `<span><small>السيارة / الموديل</small><b>${escapeHtml(driver.vehicleMake || "-")} ${escapeHtml(driver.vehicleModel || "")}</b></span><span><small>حالة السيارة</small><b>${escapeHtml(driver.vehicleCondition || "غير محددة")}</b></span>` : `<span><small>نطاق العمل</small><b>توصيل أغراض وطعام</b></span>`}
      </div>
      <div class="captain-balance"><small>رصيد الكابتن من الرحلات المكتملة</small><strong>${money(captainBalance)}</strong></div>
      <div class="order-meta driver-trip-stats">
        <span><strong>${trips.completed}</strong> مكتملة</span>
        <span><strong>${trips.cancelled}</strong> ملغاة</span>
        <span><strong>${trips.active}</strong> جارية</span>
        <span><strong>${trips.total}</strong> إجمالي الرحلات</span>
      </div>
      <div class="reputation-row"><span class="stars">★ ${rating.count ? rating.average.toFixed(1) : "جديد"}</span><span>${rating.count} تقييم</span><span class="warning-count">⚠ ${warningCount} تنبيه</span></div>
      <div class="captain-trip-groups">
        <details ${activeOrders.length ? "open" : ""}><summary>الرحلات الجارية <b>${activeOrders.length}</b></summary><div class="captain-trip-list">${activeOrders.length ? activeOrders.map(driverTripDetail).join("") : `<p class="muted">لا توجد رحلات جارية.</p>`}</div></details>
        <details><summary>الرحلات المكتملة <b>${completedOrders.length}</b></summary><div class="captain-trip-list">${completedOrders.length ? completedOrders.map(driverTripDetail).join("") : `<p class="muted">لا توجد رحلات مكتملة.</p>`}</div></details>
        <details><summary>الرحلات الملغاة <b>${cancelledOrders.length}</b></summary><div class="captain-trip-list">${cancelledOrders.length ? cancelledOrders.map(driverTripDetail).join("") : `<p class="muted">لا توجد رحلات ملغاة.</p>`}</div></details>
      </div>
      ${driver.warningMessage ? `<p class="admin-note">آخر تنبيه: ${escapeHtml(driver.warningMessage)}</p>` : ""}
      ${blocked && driver.blockReason ? `<p class="admin-note danger-note">سبب الحظر: ${escapeHtml(driver.blockReason)}</p>` : ""}
      <div class="order-actions"><button class="secondary" data-action="warn-driver" data-id="${driver.firestoreId}">إرسال تنبيه</button>${blockAction}</div>
    </article>`;
}
function renderDrivers() {
  const term=String(byId("driverSearchInput")?.value||"").trim().toLocaleLowerCase("ar");
  const filteredDrivers=term?state.drivers.filter(driver=>[driver.name,driver.phone,driver.email,driver.city,driver.plate,driver.vehicleType,captainServiceLabel(driver)].some(value=>String(value||"").toLocaleLowerCase("ar").includes(term))):state.drivers;
  const sorted = [...filteredDrivers].sort((a, b) => {
    if (a.blocked === true && b.blocked !== true) return -1;
    if (b.blocked === true && a.blocked !== true) return 1;
    const completedDiff = driverTripSummary(b.firestoreId).completed - driverTripSummary(a.firestoreId).completed;
    if (completedDiff) return completedDiff;
    return String(a.name || "").localeCompare(String(b.name || ""), "ar");
  });
  if(byId("driverSearchCount"))byId("driverSearchCount").textContent=term?`${sorted.length} من ${state.drivers.length}`:`${state.drivers.length} كابتن`;
  byId("driversList").innerHTML = sorted.length
    ? sorted.map(driverCard).join("")
    : `<div class="empty"><span>🔎</span>${term?"لا يوجد كابتن مطابق لعبارة البحث.":"لا يوجد كباتن معتمدون بعد."}</div>`;
}
byId("driverSearchInput")?.addEventListener("input",renderDrivers);

function renderRatings() {
  const all = [...state.ratings];
  const typed = type => all.filter(item => normalizedRatingType(item) === type);
  const avg = list => list.length ? list.reduce((sum, item) => sum + Number(item.score || 0), 0) / list.length : 0;
  const totalAverage = avg(all);
  const taxi = typed("taxi"), delivery = typed("delivery"), service = typed("service");
  if (byId("ratingsAverage")) byId("ratingsAverage").textContent = all.length ? totalAverage.toFixed(1) : "—";
  if (byId("ratingsTaxiCount")) byId("ratingsTaxiCount").textContent = String(taxi.length);
  if (byId("ratingsDeliveryCount")) byId("ratingsDeliveryCount").textContent = String(delivery.length);
  if (byId("ratingsServiceCount")) byId("ratingsServiceCount").textContent = String(service.length);

  const selected = state.ratingsFilter || "all";
  const filtered = all.filter(item => selected === "all" || normalizedRatingType(item) === selected);
  const sorted = filtered.sort((a, b) => Number(b.createdAt?.seconds || 0) - Number(a.createdAt?.seconds || 0));
  byId("ratingsList").innerHTML = sorted.length
    ? sorted.map(rating => {
      const type = normalizedRatingType(rating);
      const score = Math.max(0, Math.min(5, Number(rating.score || 0)));
      const targetName = rating.targetName || rating.providerName || rating.driverName || "خدمة كروة";
      const reference = rating.referenceCode || rating.orderCode || rating.itemName || "";
      const tags = Array.isArray(rating.tags) ? rating.tags.slice(0, 4) : [];
      const created = rating.createdAt?.seconds ? new Date(rating.createdAt.seconds * 1000).toLocaleString("ar-IQ") : "";
      return `<article class="review-card review-card-pro">
        <div class="review-card-head"><div><strong>${escapeHtml(targetName)}</strong><small>${escapeHtml(reference)}</small></div><span class="rating-type-chip ${type}">${ratingTypeLabel(type)}</span></div>
        <div class="review-stars-row"><span class="stars" aria-label="${score} من 5">${"★".repeat(score)}${"☆".repeat(5 - score)}</span><b>${score.toFixed(1)}</b></div>
        ${tags.length ? `<div class="review-tags">${tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
        ${rating.comment ? `<p>${escapeHtml(rating.comment)}</p>` : `<p class="muted">بدون تعليق مكتوب.</p>`}
        <div class="review-meta"><span>العميل: ${escapeHtml(rating.customerName || "عميل كروة")}</span>${created ? `<span>${escapeHtml(created)}</span>` : ""}</div>
      </article>`;
    }).join("")
    : `<div class="empty"><span>★</span>لا توجد تقييمات في هذا القسم بعد.</div>`;
  renderAdminNotifications();
}

byId("ratingsTypeFilter")?.addEventListener("change", event => {
  state.ratingsFilter = event.target.value || "all";
  renderRatings();
});

function applicationCard(application) {
  const status = application.status || "pending";
  const labels = { pending: "قيد المراجعة", approved: "مقبول", rejected: "مرفوض" };
  const complete = application.profileComplete !== false;
  const actions = status === "pending" ? `<div class="order-actions"><button class="primary" data-action="approve" data-id="${application.firestoreId}" ${complete ? "" : 'disabled title="بانتظار إكمال بيانات الكابتن"'}>${complete ? "قبول وتفعيل" : "بانتظار إكمال البيانات"}</button><button class="danger" data-action="reject" data-id="${application.firestoreId}">رفض / إلغاء</button></div>` : "";
  return `<article class="order-card"><div class="order-top"><h3>${captainServiceIcon(application)} ${escapeHtml(application.name)}</h3><span class="status-chip ${status}">${labels[status] || escapeHtml(status)}</span></div><p class="order-route">${escapeHtml(application.city)} • ${escapeHtml(application.vehicleType)} • ${escapeHtml(application.plate)}</p><div class="order-meta"><span>الخدمة: <b>${captainServiceLabel(application)}</b></span></div>${!isBikeVehicle(application) ? `<div class="order-meta"><span>السيارة: ${escapeHtml(application.vehicleMake || "-")} ${escapeHtml(application.vehicleModel || "")}</span><span>الحالة: ${escapeHtml(application.vehicleCondition || "غير محددة")}</span></div>` : `<div class="order-meta"><span>دراجة — توصيل أغراض وطعام فقط</span></div>`}<div class="order-meta"><span>${escapeHtml(application.phone)}</span><span>${escapeHtml(application.email)}</span></div>${actions}</article>`;
}
function renderApplications() {
  const sorted = state.applications.filter(item => normalizeCaptainServiceType(item) !== "other").sort((a, b) => {
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (b.status === "pending" && a.status !== "pending") return 1;
    return String(b.submittedAt?.seconds || "").localeCompare(String(a.submittedAt?.seconds || ""));
  });
  byId("applicationsList").innerHTML = sorted.length
    ? sorted.map(applicationCard).join("")
    : `<div class="empty"><span>🚘</span>لا توجد طلبات انضمام بعد.</div>`;
}

const serviceCategoryLabels = {
  restaurant: "مطعم ومأكولات",
  grocery: "بقالة ومتجر غذائي",
  retail: "تسوق ومنتجات",
  maintenance: "صيانة وإصلاح",
  home: "خدمات منزلية",
  health: "صحة وعناية",
  other: "خدمة أخرى"
};

function serviceApplicationCard(application) {
  const status = application.status || "pending";
  const labels = { pending: "قيد المراجعة", approved: "مقبول", rejected: "مرفوض" };
  const source = application.legacy ? "legacy" : "service";
  const restaurant = state.restaurants.find(item => item.firestoreId === application.firestoreId || item.ownerId === application.userId);
  const profile = state.serviceProfiles.find(item => item.firestoreId === application.firestoreId || item.ownerId === application.userId);
  const category = application.category || profile?.category || (restaurant ? "restaurant" : "other");
  const businessName = application.businessName || profile?.businessName || restaurant?.name || application.name || "مزود خدمة";
  const ownerName = application.ownerName || application.name || "—";
  const address = application.address || profile?.address || restaurant?.address || "—";
  const location = application.location || profile?.location || restaurant?.location;
  const gps = location?.latitude != null && location?.longitude != null ? `${Number(location.latitude).toFixed(5)}, ${Number(location.longitude).toFixed(5)}` : "غير محدد";
  const items = profile?.items || restaurant?.meals || [];
  const hasLocation = Number.isFinite(Number(location?.latitude)) && Number.isFinite(Number(location?.longitude));
  const providerRating = providerRatingSummary(application.firestoreId || application.userId);
  const actions = status === "pending" ? `<div class="order-actions"><button class="primary" data-action="approve-service" data-source="${source}" data-id="${application.firestoreId}" ${hasLocation ? "" : 'disabled title="يجب أن يحدد المزود موقع GPS أولًا"'}>${hasLocation ? "قبول وتفعيل" : "GPS مطلوب قبل القبول"}</button><button class="danger" data-action="reject-service" data-source="${source}" data-id="${application.firestoreId}">رفض مع ملاحظة</button></div>` : "";
  return `<article class="order-card service-application-card">
    <div class="order-top"><h3>🧰 ${escapeHtml(businessName)}</h3><span class="status-chip ${status}">${labels[status] || escapeHtml(status)}</span></div>
    <p class="order-route">${escapeHtml(serviceCategoryLabels[category] || serviceCategoryLabels.other)} • ${escapeHtml(application.city || profile?.city || "—")}</p>
    <div class="order-meta"><span>صاحب الخدمة: ${escapeHtml(ownerName)}</span><span>الهاتف: ${escapeHtml(application.phone || profile?.phone || restaurant?.phone || "—")}</span></div>
    <div class="order-meta"><span>البريد: ${escapeHtml(application.email || "—")}</span><span>العنوان: ${escapeHtml(address)}</span><span>GPS: ${escapeHtml(gps)}</span></div>
    ${application.description ? `<p class="admin-note">${escapeHtml(application.description)}</p>` : ""}
    <div class="order-meta"><span>العناصر المضافة: ${Array.isArray(items) ? items.length : 0}</span><span>★ ${providerRating.count ? providerRating.average.toFixed(1) : "جديد"} • ${providerRating.count} تقييم</span>${application.legacy ? `<span>طلب قديم — مدعوم تلقائيًا</span>` : ""}</div>
    ${application.reviewNote ? `<p class="admin-note danger-note">ملاحظة المراجعة: ${escapeHtml(application.reviewNote)}</p>` : ""}
    ${actions}
  </article>`;
}

function renderServiceApplications() {
  const modernIds = new Set(state.serviceApplications.map(item => item.firestoreId));
  const legacyApplications = state.applications
    .filter(item => item.serviceType === "other" && !modernIds.has(item.firestoreId))
    .map(item => ({ ...item, legacy: true }));
  const sorted = [...state.serviceApplications, ...legacyApplications].sort((a, b) => {
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (b.status === "pending" && a.status !== "pending") return 1;
    return Number(b.submittedAt?.seconds || b.updatedAt?.seconds || 0) - Number(a.submittedAt?.seconds || a.updatedAt?.seconds || 0);
  });
  byId("serviceApplicationsList").innerHTML = sorted.length
    ? sorted.map(serviceApplicationCard).join("")
    : `<div class="empty"><span>🧰</span>لا توجد طلبات مزودي خدمات بعد.</div>`;
}

function orderCard(order) {
  const statusIndex = Number(order.statusIndex || 0);
  const status = order.cancelled ? "ملغي" : statuses[statusIndex] || "غير معروف";
  const statusClass = order.cancelled ? "cancelled" : statusIndex >= 4 ? "complete" : "active";
  const cancel = !order.cancelled && statusIndex < 4
    ? `<div class="order-actions"><button class="danger" data-action="cancel-order" data-id="${order.firestoreId}">إلغاء إداري</button></div>`
    : "";
  return `
    <article class="order-card">
      <div class="order-top">
        <h3>${icons[order.type] || "🧾"} ${escapeHtml(order.title)}</h3>
        <span class="status-chip ${statusClass}">${escapeHtml(status)}</span>
      </div>
      <p class="order-route">${escapeHtml(order.route)}</p>
      <div class="order-bottom">
        <div class="order-meta">
          <span>${escapeHtml(order.id)}</span>
          <span>${order.driverName ? `الكابتن: ${escapeHtml(order.driverName)}` : "بانتظار كابتن"}</span>
        </div>
        <span class="order-price">${money(order.price)}</span>
        ${Number(order.surgeMultiplier||1)>1?`<div class="order-meta"><span>طلب مرتفع ×${Number(order.surgeMultiplier).toFixed(2)}</span></div>`:""}
        ${Number(order.discountAmount||0)>0?`<div class="order-meta"><span>خصم ${money(order.discountAmount)}</span><span>${escapeHtml(order.couponCode||"")}</span></div>`:""}
        ${Array.isArray(order.dispatchCandidateIds)?`<div class="order-meta"><span>مرشحو التوزيع: ${order.dispatchCandidateIds.length}</span><span>الجولة ${Number(order.dispatchRound||1)}</span></div>`:""}
        ${Number(order.statusIndex||0)>=4&&!order.cancelled?`<div class="order-meta"><span>رسوم كروة: ${money(Number(order.customerPlatformFee||0)+Number(order.captainPlatformFee||0))}</span><span>أجرة الكابتن: ${money(order.driverEarnings)}</span></div>`:""}
        ${order.autoCompletedByGPS===true?`<div class="order-meta"><span>📍 إكمال تلقائي عبر GPS</span><span>العميل والكابتن وصلا ضمن ${Number(order.autoArrivalRadiusM||120)} م من الوجهة</span></div>`:""}
      </div>
      ${order.cancelled ? `<p class="admin-note danger-note">سبب الإلغاء: ${escapeHtml(order.cancellationReason || "غير مسجل")}</p><div class="order-meta"><span>ألغى بواسطة: ${escapeHtml(order.cancelledByName || cancellationRoleLabel(order.cancelledByRole || order.cancelledBy))}</span><span>${escapeHtml(order.cancelledByEmail || "البريد غير مسجل")}</span></div>` : ""}
      ${order.acceptedAt ? `<div class="order-meta"><span>قبول: ${new Date(order.acceptedAt.seconds*1000).toLocaleString("ar-IQ")}</span>${order.completedAt ? `<span>إكمال: ${new Date(order.completedAt.seconds*1000).toLocaleString("ar-IQ")}</span>` : ""}</div>` : ""}
      ${cancel}
    </article>`;
}

function renderOrders() {
  const waiting = state.orders.filter(order =>
    !order.cancelled && !order.driverId && Number(order.statusIndex || 0) === 0
  );
  const sorted = [...waiting].sort((a, b) =>
    String(b.createdAtISO || "").localeCompare(String(a.createdAtISO || ""))
  );
  byId("ordersList").innerHTML = sorted.length
    ? sorted.map(orderCard).join("")
    : `<div class="empty"><span>✅</span>لا توجد طلبات بانتظار كابتن حالياً.</div>`;
}
function cancellationRoleLabel(role) {
  return ({ customer:"عميل", driver:"كابتن", serviceProvider:"خدمات أخرى", admin:"الإدارة" })[role] || "مستخدم";
}

function cancellationOperationLabel(item, source) {
  if (source === "service") return item.providerCategory === "restaurant" ? "طلب مطعم" : "طلب خدمة";
  return ({ ride:"تكسي", parcel:"توصيل أغراض", food:"توصيل طعام", serviceDelivery:"توصيل خدمة" })[item.type] || "طلب كروة";
}

function cancellationTimestamp(item) {
  const value = item.cancelledAt || item.statusUpdatedAt || item.updatedAt || item.createdAt;
  if (value?.seconds) return Number(value.seconds) * 1000;
  if (typeof value?.toMillis === "function") return value.toMillis();
  const n = new Date(value || 0).getTime();
  return Number.isFinite(n) ? n : 0;
}

function cancellationActor(item, source) {
  const explicitRole = String(item.cancelledByRole || item.cancelledBy || (source === "service" ? "customer" : "")).trim();
  const role = ["customer","driver","serviceProvider","admin"].includes(explicitRole) ? explicitRole : "customer";
  const fallbackId = item.cancelledByUserId || (role === "driver" ? item.driverId : role === "serviceProvider" ? item.providerId : source === "service" ? item.customerId : item.userId) || "";
  const user = state.users.find(entry => entry.firestoreId === fallbackId) || {};
  let fallbackName = user.name || "";
  if (!fallbackName && role === "driver") fallbackName = item.driverName || "كابتن كروة";
  if (!fallbackName && role === "serviceProvider") fallbackName = item.providerName || "مزود خدمة";
  if (!fallbackName && role === "customer") fallbackName = item.customerName || "عميل كروة";
  if (!fallbackName && role === "admin") fallbackName = "إدارة كروة";
  return {
    role,
    id: fallbackId,
    name: item.cancelledByName || fallbackName || "غير معروف",
    email: item.cancelledByEmail || user.email || (role === "admin" && state.user?.uid === fallbackId ? state.user?.email || "" : "") || ""
  };
}

function cancellationRecords() {
  const orderRows = state.orders.filter(item => item.cancelled === true).map(item => ({ source:"order", item }));
  const serviceRows = state.serviceRequests.filter(item => item.status === "cancelled").map(item => ({ source:"service", item }));
  return [...orderRows, ...serviceRows].sort((a,b) => cancellationTimestamp(b.item) - cancellationTimestamp(a.item));
}

function renderCancellations() {
  const list = byId("cancellationsList");
  if (!list) return;
  const rows = cancellationRecords();
  const filter = byId("cancellationRoleFilter")?.value || "all";
  const filtered = rows.filter(row => filter === "all" || cancellationActor(row.item, row.source).role === filter);
  if (byId("cancellationsBadge")) byId("cancellationsBadge").textContent = `${rows.length} إلغاء`;
  if (byId("navCancellationsCount")) byId("navCancellationsCount").textContent = String(rows.length);
  list.innerHTML = filtered.length ? filtered.map(({source,item}) => {
    const actor = cancellationActor(item, source);
    const dateMs = cancellationTimestamp(item);
    const code = source === "service" ? (item.firestoreId || "—") : (item.id || item.orderCode || item.firestoreId || "—");
    const title = source === "service" ? (item.itemName || item.providerName || "طلب خدمة") : (item.title || "طلب كروة");
    const reason = String(item.cancellationReason || item.providerNote || "لم يُسجل سبب في النسخ القديمة").trim();
    return `<article class="cancellation-card">
      <div class="cancellation-head"><div><small>${escapeHtml(cancellationOperationLabel(item, source))}</small><strong>${escapeHtml(title)}</strong></div><span class="cancellation-chip">${escapeHtml(cancellationRoleLabel(actor.role))}</span></div>
      <div class="cancellation-reason">سبب الإلغاء: ${escapeHtml(reason)}</div>
      <div class="cancellation-user"><b>${escapeHtml(actor.name)}</b><small>${escapeHtml(actor.email || "البريد غير مسجل")} • UID: ${escapeHtml(actor.id || "غير متوفر")}</small></div>
      <div class="cancellation-meta"><span>رقم العملية: ${escapeHtml(code)}</span><span>${dateMs ? new Date(dateMs).toLocaleString("ar-IQ") : "وقت الإلغاء غير متوفر"}</span>${source === "service" ? `<span>النشاط: ${escapeHtml(item.providerName || "—")}</span>` : item.driverName ? `<span>الكابتن: ${escapeHtml(item.driverName)}</span>` : ""}</div>
    </article>`;
  }).join("") : `<div class="empty"><span>✓</span>لا توجد إلغاءات مطابقة للفلتر.</div>`;
}

byId("cancellationRoleFilter")?.addEventListener("change", renderCancellations);

function repairLegacyCaptainService(collectionName, record) {
  const normalized = normalizeCaptainServiceType(record);
  if (!["taxi", "delivery"].includes(normalized) || record.serviceType === normalized) return;
  // تصحيح آمن للسجلات القديمة: الدراجة/قيم التوصيل الوصفية تصبح delivery بدل أن تبقى محسوبة كتكسي.
  updateDoc(doc(db, collectionName, record.firestoreId), {
    serviceType: normalized,
    updatedAt: serverTimestamp()
  }).catch(error => console.warn("تعذر تصحيح نوع خدمة الكابتن القديم", record.firestoreId, error));
}

function settingNumber(value,fallback,min=0,max=100000){const n=Number(value);return Math.max(min,Math.min(max,Number.isFinite(n)?n:fallback));}
function renderPricingSettings(){
  const c=state.pricingSettings||{};
  const values={
    ridePerKmEconomy:c.ridePerKmEconomy??650,ridePerKmTaxi:c.ridePerKmTaxi??800,ridePerKmFamily:c.ridePerKmFamily??980,
    publishFee:c.publishFee??1000,
    customerTaxiFee:c.customerTaxiFee??c.customerOrderFee??250,
    customerDeliveryFee:c.customerDeliveryFee??c.customerOrderFee??250,
    customerServiceFee:c.customerServiceFee??c.customerOrderFee??250,
    captainTaxiFee:c.captainTaxiFee??c.captainOrderFee??250,
    captainDeliveryFee:c.captainDeliveryFee??c.captainOrderFee??250,
    providerRestaurantFee:c.providerRestaurantFee??c.providerOrderFee??250,
    providerServiceFee:c.providerServiceFee??c.providerOrderFee??250,
    signupBonusAmount:c.signupBonusAmount??1000,signupBonusHours:c.signupBonusHours??24,
    referralDiscountPercent:c.referralDiscountPercent??10,referralMaxDiscount:c.referralMaxDiscount??3000
  };
  Object.entries(values).forEach(([id,value])=>{const el=byId(id);if(el&&document.activeElement!==el)el.value=String(Number(value));});
  const bonusToggle=byId("signupBonusEnabled");if(bonusToggle&&document.activeElement!==bonusToggle)bonusToggle.checked=c.signupBonusEnabled!==false;
  ["topupTransferLabel","topupTransferId","topupCardHolder"].forEach(id=>{const el=byId(id);if(el&&document.activeElement!==el)el.value=String(c[id]||"");});
}
function renderTopupRequests(){
  const box=byId("topupRequestsAdmin"); if(!box)return;
  const rows=[...state.topupRequests].sort((a,b)=>Number(b.createdAt?.seconds||0)-Number(a.createdAt?.seconds||0));
  renderAdminNotifications();
  if(!rows.length){box.innerHTML='<p class="muted">لا توجد طلبات شحن بعد.</p>';return;}
  const labels={pending:"قيد المراجعة",approved:"معتمد",rejected:"مرفوض"};
  const accountLabels={customer:"عميل",captain:"كابتن",service:"خدمات أخرى",driver:"كابتن",other:"خدمات أخرى"};
  box.innerHTML=rows.map(x=>{const status=x.status||"pending";const date=x.createdAt?.seconds?new Date(x.createdAt.seconds*1000).toLocaleString("ar-IQ"):"—";const accountType=accountLabels[x.accountType]||accountLabels[x.accountRole]||"عميل";return `<article class="topup-admin-row ${escapeHtml(status)}"><div class="topup-admin-head"><div><strong>${escapeHtml(x.customerName||"مشترك")}</strong><small> • ${escapeHtml(x.email||"")} • <b>${escapeHtml(accountType)}</b></small></div><span class="status-chip ${status==='approved'?'approved':status==='rejected'?'cancelled':'pending'}">${labels[status]||escapeHtml(status)}</span></div><div class="order-meta"><span>نوع التسجيل: <b>${escapeHtml(accountType)}</b></span><span>المبلغ: <b>${money(x.amount)}</b></span><span>المرجع: <b>${escapeHtml(x.transferReference||"—")}</b></span><span>${date}</span></div>${status==='pending'?`<div class="topup-admin-actions"><button class="primary" data-action="approve-topup" data-id="${x.firestoreId}">اعتماد وإضافة الرصيد</button><button class="danger" data-action="reject-topup" data-id="${x.firestoreId}">رفض</button></div>`:`${x.reviewNote?`<p class="admin-note">${escapeHtml(x.reviewNote)}</p>`:""}`}</article>`;}).join("");
}

byId("pricingSettingsForm")?.addEventListener("submit",async event=>{
  event.preventDefault(); if(!state.user)return;
  const button=byId("savePricingSettings"); busy(button,true,"جارٍ الحفظ…");
  try{
    const payload={updatedAt:serverTimestamp(),updatedBy:state.user.uid};
    payload.ridePerKmEconomy=settingNumber(byId("ridePerKmEconomy")?.value,650,0,10000);
    payload.ridePerKmTaxi=settingNumber(byId("ridePerKmTaxi")?.value,800,0,10000);
    payload.ridePerKmFamily=settingNumber(byId("ridePerKmFamily")?.value,980,0,10000);
    payload.publishFee=Math.round(settingNumber(byId("publishFee")?.value,1000));
    payload.customerTaxiFee=Math.round(settingNumber(byId("customerTaxiFee")?.value,250));
    payload.customerDeliveryFee=Math.round(settingNumber(byId("customerDeliveryFee")?.value,250));
    payload.customerServiceFee=Math.round(settingNumber(byId("customerServiceFee")?.value,250));
    payload.captainTaxiFee=Math.round(settingNumber(byId("captainTaxiFee")?.value,250));
    payload.captainDeliveryFee=Math.round(settingNumber(byId("captainDeliveryFee")?.value,250));
    payload.providerRestaurantFee=Math.round(settingNumber(byId("providerRestaurantFee")?.value,250));
    payload.providerServiceFee=Math.round(settingNumber(byId("providerServiceFee")?.value,250));
    // حقول توافق للإصدارات القديمة، بينما Phase 74 يستخدم الرسوم التفصيلية أعلاه.
    payload.customerOrderFee=payload.customerTaxiFee;
    payload.captainOrderFee=payload.captainDeliveryFee;
    payload.providerOrderFee=payload.providerServiceFee;
    payload.signupBonusEnabled=byId("signupBonusEnabled")?.checked!==false;
    payload.signupBonusAmount=Math.round(settingNumber(byId("signupBonusAmount")?.value,1000,0,100000));
    payload.signupBonusHours=Math.round(settingNumber(byId("signupBonusHours")?.value,24,1,168));
    payload.topupTransferLabel=(byId("topupTransferLabel")?.value||"Mastercard محلي").trim().slice(0,60);
    payload.topupTransferId=(byId("topupTransferId")?.value||"").trim().slice(0,80);
    payload.topupCardHolder=(byId("topupCardHolder")?.value||"").trim().slice(0,80);
    payload.referralDiscountPercent=Math.max(0,Math.min(100,Number(byId("referralDiscountPercent")?.value||10)));
    payload.referralMaxDiscount=Math.max(0,Math.min(100000,Math.round(Number(byId("referralMaxDiscount")?.value||3000))));
    await setDoc(doc(db,"appSettings","pricing"),payload,{merge:true}); toast("تم حفظ التسعيرة والرسوم الثابتة وإعدادات الرصيد");
  }catch(error){console.error(error);toast("تعذر حفظ الإعدادات");}finally{busy(button,false);}
});


const ADMIN_AREA_RADIUS_KM = 10;
const ADMIN_MAP_STYLE = "https://tiles.openfreemap.org/styles/bright";

// Phase 90.5: map libraries must never block admin authentication.
// Load Leaflet only after the dashboard has opened. If both CDNs fail,
// the rest of the admin portal continues working and only the map shows an error.
let adminLeafletPromise = null;
function ensureAdminLeafletCss(href) {
  if ([...document.styleSheets].some(sheet => String(sheet.href || "").includes("leaflet"))) return;
  if (document.querySelector('link[data-karwa-leaflet-css]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.karwaLeafletCss = "1";
  document.head.appendChild(link);
}
function loadScriptWithTimeout(src, timeout = 7000) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    let done = false;
    const finish = (ok, error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!ok) script.remove();
      ok ? resolve(true) : reject(error || new Error("SCRIPT_LOAD_FAILED"));
    };
    script.src = src;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => finish(true);
    script.onerror = () => finish(false, new Error(`تعذر تحميل ${src}`));
    const timer = setTimeout(() => finish(false, new Error(`انتهت مهلة تحميل ${src}`)), timeout);
    document.head.appendChild(script);
  });
}
async function loadAdminLeaflet() {
  if (window.L) return true;
  if (adminLeafletPromise) return adminLeafletPromise;
  adminLeafletPromise = (async () => {
    const sources = [
      { css: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css", js: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js" },
      { css: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", js: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" }
    ];
    let lastError = null;
    for (const source of sources) {
      try {
        ensureAdminLeafletCss(source.css);
        await loadScriptWithTimeout(source.js);
        if (window.L) return true;
      } catch (error) { lastError = error; }
    }
    throw lastError || new Error("LEAFLET_UNAVAILABLE");
  })();
  return adminLeafletPromise;
}
function showAdminMapLoadError() {
  const host = byId("adminAreaMap");
  if (host) host.innerHTML = '<div style="position:absolute;inset:0;display:grid;place-items:center;padding:24px;text-align:center;background:#f3f7f8;color:#51677a;font-weight:800">تعذر تحميل مكتبة الخريطة الآن. بقية لوحة الإدارة تعمل بشكل طبيعي.</div>';
}

function adminAreaValidPoint(value){
  const latitude=Number(value?.latitude ?? value?.lat), longitude=Number(value?.longitude ?? value?.lng);
  return Number.isFinite(latitude)&&Number.isFinite(longitude)&&latitude>=-90&&latitude<=90&&longitude>=-180&&longitude<=180?{latitude,longitude}:null;
}
function adminAreaDistanceKm(a,b){
  const p=adminAreaValidPoint(a),q=adminAreaValidPoint(b);if(!p||!q)return Infinity;
  const r=6371,toRad=v=>Number(v)*Math.PI/180,dLat=toRad(q.latitude-p.latitude),dLng=toRad(q.longitude-p.longitude);
  const x=Math.sin(dLat/2)**2+Math.cos(toRad(p.latitude))*Math.cos(toRad(q.latitude))*Math.sin(dLng/2)**2;
  return 2*r*Math.asin(Math.sqrt(x));
}
function adminAreaUser(uid){return state.users.find(item=>item.firestoreId===uid)||{};}
function adminAreaIcon(kind,online=true,subtype=""){
  const symbol=kind==="driver"?(subtype==="delivery"?"🛵":"🚕"):(subtype==="restaurant"?"🍽️":"🧰");
  return window.L.divIcon({className:"",html:`<div class="admin-map-pin ${kind==="service"?"service":""} ${kind==="driver"&&!online?"offline":""}">${symbol}</div>`,iconSize:[44,44],iconAnchor:[22,38]});
}
function adminAreaEntities(){
  const rows=[];
  for(const driver of state.drivers){
    const point=adminAreaValidPoint(driver);if(!point)continue;
    const user=adminAreaUser(driver.firestoreId||driver.userId),service=normalizeCaptainServiceType(driver);
    rows.push({key:`driver:${driver.firestoreId}`,kind:"driver",subtype:service,point,name:driver.name||user.name||"كابتن كروة",email:driver.email||user.email||"—",phone:driver.phone||user.phone||"—",online:driver.online===true&&!driver.blocked,status:driver.blocked?"محظور":driver.online?"متصل":"غير متصل",detail:captainServiceLabel(driver),updatedAt:driver.locationUpdatedAt||driver.updatedAt});
  }
  const seenServices=new Set();
  for(const profile of state.serviceProfiles){
    const point=adminAreaValidPoint(profile.location);if(!point)continue;
    const uid=String(profile.ownerId||profile.firestoreId||"");seenServices.add(uid);
    const user=adminAreaUser(uid),category=String(profile.category||"other");
    rows.push({key:`service:${profile.firestoreId}`,kind:"service",subtype:category,point,name:profile.businessName||profile.ownerName||user.name||"خدمة كروة",email:user.email||profile.email||"—",phone:profile.phone||user.phone||"—",online:profile.active===true,status:profile.approvalStatus==="approved"?(profile.active?"نشط":"معتمد غير منشور"):(profile.approvalStatus||"قيد المراجعة"),detail:serviceCategoryLabels[category]||serviceCategoryLabels.other,updatedAt:profile.updatedAt});
  }
  for(const restaurant of state.restaurants){
    const uid=String(restaurant.ownerId||restaurant.firestoreId||"");if(seenServices.has(uid))continue;
    const point=adminAreaValidPoint(restaurant.location);if(!point)continue;
    const user=adminAreaUser(uid);
    rows.push({key:`restaurant:${restaurant.firestoreId}`,kind:"service",subtype:"restaurant",point,name:restaurant.name||user.name||"مطعم كروة",email:user.email||restaurant.email||"—",phone:restaurant.phone||user.phone||"—",online:restaurant.active===true,status:restaurant.active?"نشط":"غير نشط",detail:"مطعم ومأكولات",updatedAt:restaurant.updatedAt});
  }
  return rows;
}
function adminAreaTimeText(value){
  const ms=value?.toMillis?.()??(Number(value?.seconds)?Number(value.seconds)*1000:new Date(value||0).getTime());
  if(!Number.isFinite(ms)||ms<=0)return "";const min=Math.max(0,Math.round((Date.now()-ms)/60000));return min<1?"الآن":min<60?`منذ ${min} د`:`منذ ${Math.round(min/60)} س`;
}
function initializeAdminAreaMap(){
  if(!window.L||state.areaMap||!byId("adminAreaMap"))return;
  let stored=null;try{stored=JSON.parse(localStorage.getItem("karwa.admin.areaCenter")||"null")}catch{}
  state.areaCenter=adminAreaValidPoint(stored)||{latitude:33.3152,longitude:44.3661};
  state.areaMap=window.L.map("adminAreaMap",{zoomControl:false,attributionControl:false,preferCanvas:true}).setView([state.areaCenter.latitude,state.areaCenter.longitude],12);
  if(window.L.maplibreGL)state.areaBaseLayer=window.L.maplibreGL({style:ADMIN_MAP_STYLE}).addTo(state.areaMap);else window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19}).addTo(state.areaMap);
  window.L.control.zoom({position:"bottomleft"}).addTo(state.areaMap);
  state.areaMap.on("click",event=>setAdminAreaCenter({latitude:event.latlng.lat,longitude:event.latlng.lng},true));
  setAdminAreaCenter(state.areaCenter,false);
  window.setTimeout(()=>state.areaMap?.invalidateSize(),120);
}
function setAdminAreaCenter(point,persist=true){
  const safe=adminAreaValidPoint(point);if(!safe)return;state.areaCenter=safe;
  if(persist)try{localStorage.setItem("karwa.admin.areaCenter",JSON.stringify(safe))}catch{}
  if(state.areaMap){
    const ll=[safe.latitude,safe.longitude];
    if(state.areaCenterMarker)state.areaCenterMarker.setLatLng(ll);else state.areaCenterMarker=window.L.marker(ll,{icon:window.L.divIcon({className:"",html:'<div class="admin-map-center-pin"></div>',iconSize:[30,30],iconAnchor:[15,15]}),zIndexOffset:1200}).addTo(state.areaMap).bindTooltip("مركز نطاق 10 كم",{direction:"top"});
    if(state.areaCircle)state.areaCircle.setLatLng(ll);else state.areaCircle=window.L.circle(ll,{radius:ADMIN_AREA_RADIUS_KM*1000,color:"#087b75",weight:2,fillColor:"#19a69a",fillOpacity:.07,dashArray:"8 7"}).addTo(state.areaMap);
  }
  renderAdminAreaMap();
}
function clearAdminAreaMarkers(){for(const marker of state.areaMarkers.values())try{state.areaMap?.removeLayer(marker)}catch{}state.areaMarkers.clear();}
function renderAdminAreaMap(){
  if(!state.areaMap||!state.areaCenter)return;
  const showDrivers=byId("adminAreaDrivers")?.checked!==false,showServices=byId("adminAreaServices")?.checked!==false;
  const rows=adminAreaEntities().filter(x=>(x.kind==="driver"?showDrivers:showServices)).map(x=>({...x,distance:adminAreaDistanceKm(state.areaCenter,x.point)})).filter(x=>x.distance<=ADMIN_AREA_RADIUS_KM).sort((a,b)=>a.distance-b.distance);
  clearAdminAreaMarkers();
  for(const row of rows){
    const marker=window.L.marker([row.point.latitude,row.point.longitude],{icon:adminAreaIcon(row.kind,row.online,row.subtype),riseOnHover:true,title:row.name}).addTo(state.areaMap);
    const freshness=adminAreaTimeText(row.updatedAt),label=`${row.name}${row.kind==="driver"&&!row.online?" • غير متصل":""}`;
    marker.bindTooltip(escapeHtml(label),{direction:"top",offset:[0,-30],opacity:.96});
    marker.bindPopup(`<div class="admin-area-popup"><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.detail)} • ${escapeHtml(row.status)} • ${row.distance.toFixed(1)} كم</small><div class="email">${escapeHtml(row.email)}</div><small>الهاتف: ${escapeHtml(row.phone)}</small>${freshness?`<small>آخر تحديث: ${escapeHtml(freshness)}</small>`:""}</div>`);
    state.areaMarkers.set(row.key,marker);
  }
  const count=rows.length,drivers=rows.filter(x=>x.kind==="driver").length,services=count-drivers;
  if(byId("adminAreaMapCount"))byId("adminAreaMapCount").textContent=`${count} موقع`;
  if(byId("adminAreaMapSummary"))byId("adminAreaMapSummary").textContent=`ضمن 10 كم: ${drivers} كابتن • ${services} خدمة`;
  if(byId("adminAreaMapCenterText"))byId("adminAreaMapCenterText").textContent=`المركز ${state.areaCenter.latitude.toFixed(5)}, ${state.areaCenter.longitude.toFixed(5)} • اضغط الخريطة لتغييره`;
  const host=byId("adminAreaMapResults");if(host)host.innerHTML=rows.length?rows.map(row=>`<button type="button" class="admin-area-result" data-area-key="${escapeHtml(row.key)}"><span class="ico">${row.kind==="driver"?(row.subtype==="delivery"?"🛵":"🚕"):(row.subtype==="restaurant"?"🍽️":"🧰")}</span><span><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.email)} • ${escapeHtml(row.status)}</small></span><b>${row.distance.toFixed(1)} كم</b></button>`).join(""):`<p class="muted">لا توجد كباتن أو خدمات لها موقع داخل نطاق 10 كم من النقطة المحددة.</p>`;
}
function fitAdminAreaRadius(){if(!state.areaMap||!state.areaCircle)return;state.areaMap.fitBounds(state.areaCircle.getBounds(),{padding:[28,28]});}
function locateAdminArea(){
  if(!navigator.geolocation)return toast("الموقع غير مدعوم في هذا المتصفح");
  const button=byId("adminAreaMapLocate");busy(button,true,"جاري تحديد الموقع…");
  navigator.geolocation.getCurrentPosition(position=>{const point={latitude:position.coords.latitude,longitude:position.coords.longitude};setAdminAreaCenter(point,true);state.areaMap?.setView([point.latitude,point.longitude],13);busy(button,false);},()=>{busy(button,false);toast("تعذر تحديد الموقع. اختر نقطة مباشرة من الخريطة.");},{enableHighAccuracy:true,timeout:12000,maximumAge:30000});
}
function setupAdminAreaMapControls(){
  byId("adminAreaMapLocate")?.addEventListener("click",locateAdminArea);
  byId("adminAreaMapFit")?.addEventListener("click",fitAdminAreaRadius);
  byId("adminAreaDrivers")?.addEventListener("change",renderAdminAreaMap);
  byId("adminAreaServices")?.addEventListener("change",renderAdminAreaMap);
  byId("adminAreaMapResults")?.addEventListener("click",event=>{const button=event.target.closest?.("[data-area-key]");if(!button)return;const marker=state.areaMarkers.get(button.dataset.areaKey);if(marker){state.areaMap.setView(marker.getLatLng(),15,{animate:true});marker.openPopup();}});
}
setupAdminAreaMapControls();

function openDashboard() {
  clearDashboardListeners();
  showView("dashboard");
  // Authentication and the rest of the dashboard must not depend on any map CDN.
  loadAdminLeaflet()
    .then(() => { initializeAdminAreaMap(); window.setTimeout(()=>{state.areaMap?.invalidateSize();renderAdminAreaMap();},80); })
    .catch(error => { console.warn("تعذر تحميل خريطة الإدارة", error); showAdminMapLoadError(); });
  const usersUnsubscribe = onSnapshot(collection(db, "users"), snapshot => {
    state.users = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    renderMetrics();
    renderCancellations();
    renderDeviceManagement();
    renderAdminAreaMap();
  });
  const applicationsUnsubscribe = onSnapshot(collection(db, "driverApplications"), snapshot => {
    state.applications = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    state.applications.forEach(item => repairLegacyCaptainService("driverApplications", item));
    renderApplications();
    renderServiceApplications();
    renderMetrics();
  });
  const serviceApplicationsUnsubscribe = onSnapshot(collection(db, "serviceApplications"), snapshot => {
    state.serviceApplications = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    renderServiceApplications();
    renderMetrics();
  });
  const serviceProfilesUnsubscribe = onSnapshot(collection(db, "serviceProfiles"), snapshot => {
    state.serviceProfiles = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    renderServiceApplications();
    renderMetrics();
    renderAdminAreaMap();
  });
  const restaurantsUnsubscribe = onSnapshot(collection(db, "restaurants"), snapshot => {
    state.restaurants = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    renderServiceApplications();
    renderAdminAreaMap();
  });
  const ordersUnsubscribe = onSnapshot(collection(db, "orders"), snapshot => {
    state.orders = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    renderOrders();
    renderDrivers();
    renderMetrics();
    renderCancellations();
  });
  const serviceRequestsUnsubscribe = onSnapshot(collection(db, "serviceRequests"), snapshot => {
    state.serviceRequests = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    renderMetrics();
    renderCancellations();
  });
  const driversUnsubscribe = onSnapshot(collection(db, "drivers"), snapshot => {
    state.drivers = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    state.drivers.forEach(item => repairLegacyCaptainService("drivers", item));
    renderDrivers();
    renderMetrics();
    renderAdminAreaMap();
  });
  const ratingsUnsubscribe = onSnapshot(collection(db, "ratings"), snapshot => {
    state.ratings = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    renderDrivers();
    renderServiceApplications();
    renderRatings();
  });
  const topupsUnsubscribe = onSnapshot(collection(db,"topupRequests"), snapshot => {
    state.topupRequests = snapshot.docs.map(item=>({...item.data(),firestoreId:item.id}));
    renderTopupRequests();
  });
  const deviceBindingsUnsubscribe = onSnapshot(collection(db,"deviceBindings"), snapshot => {
    state.deviceBindings = snapshot.docs.map(item=>({...item.data(),firestoreId:item.id}));
    renderDeviceManagement();
  });
  const deviceLinksUnsubscribe = onSnapshot(collection(db,"accountDeviceLinks"), snapshot => {
    state.deviceLinks = snapshot.docs.map(item=>({...item.data(),firestoreId:item.id}));
    renderDeviceManagement();
  });
  const deviceChangesUnsubscribe = onSnapshot(collection(db,"deviceChangeRequests"), snapshot => {
    state.deviceChangeRequests = snapshot.docs.map(item=>({...item.data(),firestoreId:item.id}));
    renderDeviceManagement();
    renderMetrics();
  });
  const pricingUnsubscribe = onSnapshot(doc(db,"appSettings","pricing"), snapshot => {
    state.pricingSettings = snapshot.exists()?snapshot.data():{};
    renderPricingSettings();
  });
  state.dashboardUnsubscribes.push(
    usersUnsubscribe,
    applicationsUnsubscribe,
    serviceApplicationsUnsubscribe,
    serviceProfilesUnsubscribe,
    restaurantsUnsubscribe,
    ordersUnsubscribe,
    serviceRequestsUnsubscribe,
    driversUnsubscribe,
    ratingsUnsubscribe,
    topupsUnsubscribe,
    deviceBindingsUnsubscribe,
    deviceLinksUnsubscribe,
    deviceChangesUnsubscribe,
    pricingUnsubscribe
  );
}

document.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button || !state.user) return;
  const id = button.dataset.id;
  busy(button, true);
  try {
    if (button.dataset.action === "approve-device-change") {
      await runTransaction(db, async transaction => {
        const requestRef=doc(db,"deviceChangeRequests",id);
        const requestSnap=await transaction.get(requestRef);
        if(!requestSnap.exists())throw new Error("DEVICE_REQUEST_NOT_FOUND");
        const request=requestSnap.data();
        if((request.status||"pending")!=="pending")throw new Error("DEVICE_REQUEST_REVIEWED");
        const uid=String(request.userId||id);
        const newKey=String(request.newDeviceKey||"");
        if(!/^KDW1-[A-F0-9]{64}$/.test(newKey))throw new Error("BAD_DEVICE_KEY");
        const linkRef=doc(db,"accountDeviceLinks",uid);
        const userRef=doc(db,"users",uid);
        const [linkSnap,userSnap,newBindingSnap]=await Promise.all([
          transaction.get(linkRef),transaction.get(userRef),transaction.get(doc(db,"deviceBindings",newKey))
        ]);
        if(!userSnap.exists())throw new Error("USER_NOT_FOUND");
        if(newBindingSnap.exists()&&newBindingSnap.data().userId!==uid)throw new Error("DEVICE_ALREADY_BOUND");
        const oldKey=linkSnap.exists()?String(linkSnap.data().deviceKey||""):"";
        let oldBindingSnap=null;
        if(oldKey&&oldKey!==newKey)oldBindingSnap=await transaction.get(doc(db,"deviceBindings",oldKey));
        const user=userSnap.data(),family=deviceRoleFamily(user.role),label=String(request.newDeviceLabel||"Android").slice(0,120);
        if(oldKey&&oldKey!==newKey&&oldBindingSnap?.exists()){
          transaction.update(doc(db,"deviceBindings",oldKey),{status:"replaced",replacedBy:newKey,replacedAt:serverTimestamp(),replacedByAdmin:state.user.uid,updatedAt:serverTimestamp()});
          transaction.delete(doc(db,"deviceAccess",uid,"devices",oldKey));
        }
        transaction.set(doc(db,"deviceBindings",newKey),{deviceKey:newKey,userId:uid,roleFamily:family,status:"active",deviceLabel:label,boundAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});
        transaction.set(linkRef,{userId:uid,deviceKey:newKey,roleFamily:family,deviceLabel:label,boundAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});
        transaction.set(doc(db,"deviceAccess",uid,"devices",newKey),{active:true,boundAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});
        transaction.update(userRef,{deviceBound:true,updatedAt:serverTimestamp()});
        transaction.update(requestRef,{status:"approved",oldDeviceKey:oldKey,reviewedBy:state.user.uid,reviewedAt:serverTimestamp(),updatedAt:serverTimestamp()});
      });
      toast("تم استبدال الجهاز. يمكن للمستخدم تسجيل الدخول من الهاتف الجديد الآن.");
    } else if (button.dataset.action === "reject-device-change") {
      const note=prompt("سبب رفض تغيير الجهاز:","تعذر التحقق من طلب استبدال الهاتف")?.trim();
      if(!note)return;
      await updateDoc(doc(db,"deviceChangeRequests",id),{status:"rejected",reviewNote:note.slice(0,200),reviewedBy:state.user.uid,reviewedAt:serverTimestamp(),updatedAt:serverTimestamp()});
      toast("تم رفض طلب تغيير الجهاز");
    } else if (button.dataset.action === "approve-topup") {
      await karwaSensitiveAction("review_topup",{requestId:id,decision:"approved",note:""});
      toast("تم اعتماد الشحن وإضافة نفس المبلغ إلى الرصيد المشحون");
    } else if (button.dataset.action === "reject-topup") {
      const note=prompt("سبب الرفض:","تعذر مطابقة التحويل")?.trim(); if(!note)return;
      await karwaSensitiveAction("review_topup",{requestId:id,decision:"rejected",note:note.slice(0,200)});
      toast("تم رفض / إلغاء طلب الشحن ويمكن للمستخدم إرسال طلب جديد");
    } else if (button.dataset.action === "approve-service") {
      const legacy = button.dataset.source === "legacy";
      const application = legacy
        ? state.applications.find(item => item.firestoreId === id && normalizeCaptainServiceType(item) === "other")
        : state.serviceApplications.find(item => item.firestoreId === id);
      if (!application) throw new Error("NOT_FOUND");
      const accountUid = activationUid(application, id);
      if (!accountUid) throw new Error("MISSING_UID");
      const existingUser = state.users.find(item => item.firestoreId === accountUid);
      const existingProfile = state.serviceProfiles.find(item => item.firestoreId === accountUid || item.ownerId === accountUid);
      const restaurant = state.restaurants.find(item => item.firestoreId === accountUid || item.ownerId === accountUid);
      const category = String(application.category || existingProfile?.category || (restaurant ? "restaurant" : "other")).trim() || "other";
      const businessName = String(application.businessName || existingProfile?.businessName || restaurant?.name || application.name || "مزود خدمة").trim() || "مزود خدمة";
      const ownerName = String(application.ownerName || application.name || existingUser?.name || "مزود خدمة").trim() || "مزود خدمة";
      const phone = String(application.phone || existingProfile?.phone || restaurant?.phone || "").trim();
      const address = String(application.address || existingProfile?.address || restaurant?.address || "").trim();
      const location = application.location || existingProfile?.location || restaurant?.location || null;
      if (!Number.isFinite(Number(location?.latitude)) || !Number.isFinite(Number(location?.longitude))) {
        toast("لا يمكن اعتماد النشاط قبل أن يحدد مزود الخدمة موقع GPS.");
        return;
      }
      const items = Array.isArray(existingProfile?.items) ? existingProfile.items : Array.isArray(restaurant?.meals) ? restaurant.meals : [];
      const batch = writeBatch(db);
      batch.update(doc(db, legacy ? "driverApplications" : "serviceApplications", id), {
        status: "approved",
        reviewNote: "",
        reviewedBy: state.user.uid,
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      batch.set(doc(db, "users", accountUid), existingUser
        ? { role: "serviceProvider", updatedAt: serverTimestamp() }
        : activationUserPayload(application, "serviceProvider"), { merge: true });
      batch.set(doc(db, "serviceProfiles", accountUid), {
        ownerId: accountUid,
        ownerName,
        businessName,
        category,
        phone,
        city: String(application.city || existingProfile?.city || "").trim(),
        address,
        description: String(application.description || existingProfile?.description || "").trim(),
        location: { latitude: Number(location.latitude), longitude: Number(location.longitude) },
        items,
        active: false,
        publishFeePaid: Boolean(existingProfile?.publishFeePaid),
        approvalStatus: "approved",
        approvedBy: state.user.uid,
        approvedAt: serverTimestamp(),
        createdAt: existingProfile?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });
      if (category === "restaurant") {
        const restaurantPayload = {
          ownerId: accountUid,
          name: businessName,
          phone,
          address,
          meals: items,
          active: false,
          approvalStatus: "approved",
          approvedBy: state.user.uid,
          approvedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          location: { latitude: Number(location.latitude), longitude: Number(location.longitude) }
        };
        batch.set(doc(db, "restaurants", accountUid), restaurantPayload, { merge: true });
      }
      await batch.commit();
      toast(existingUser ? "تم قبول مزود الخدمة وفتح لوحته الخاصة" : "تم قبول مزود الخدمة وإصلاح ملف المستخدم القديم تلقائيًا");
    } else if (button.dataset.action === "reject-service") {
      const note = prompt("سبب الرفض أو البيانات المطلوب تعديلها:", "يرجى استكمال بيانات النشاط")?.trim();
      if (!note) return;
      const legacy = button.dataset.source === "legacy";
      const application = legacy
        ? state.applications.find(item => item.firestoreId === id && normalizeCaptainServiceType(item) === "other")
        : state.serviceApplications.find(item => item.firestoreId === id);
      if (!application) throw new Error("NOT_FOUND");
      if (application.profileComplete === false) { toast("لا يمكن اعتماد الكابتن قبل إكمال بيانات الطلب"); return; }
      const batch = writeBatch(db);
      batch.update(doc(db, legacy ? "driverApplications" : "serviceApplications", id), {
        status: "rejected",
        reviewNote: note.slice(0, 300),
        reviewedBy: state.user.uid,
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      if (legacy) {
        batch.set(doc(db, "restaurants", id), {
          active: false,
          approvalStatus: "rejected",
          reviewNote: note.slice(0, 300),
          updatedAt: serverTimestamp()
        }, { merge: true });
      }
      await batch.commit();
      toast("تم رفض الطلب وإرسال الملاحظة لمزود الخدمة");
    } else if (button.dataset.action === "approve") {
      const application = state.applications.find(item => item.firestoreId === id);
      if (!application) throw new Error("NOT_FOUND");
      const accountUid = activationUid(application, id);
      if (!accountUid) throw new Error("MISSING_UID");
      const existingUser = state.users.find(item => item.firestoreId === accountUid);
      const normalizedServiceType = normalizeCaptainServiceType(application);
      if (!["taxi", "delivery"].includes(normalizedServiceType)) {
        toast("نوع خدمة الكابتن غير صالح للاعتماد. اختر تكسي أو توصيل.");
        return;
      }
      const captainName = String(application.name || existingUser?.name || "كابتن كروة").trim() || "كابتن كروة";
      const captainEmail = String(application.email || existingUser?.email || "").trim();
      const captainPhone = String(application.phone || "").trim();
      const vehicleType = String(application.vehicleType || "").trim();
      const plate = String(application.plate || "").trim();
      const city = String(application.city || "").trim();
      // الدراجة تُعامل دائمًا كتوصيل، كما يتم توحيد أي قيمة قديمة مثل «توصيل أغراض وطعام» إلى delivery.
      const batch = writeBatch(db);
      batch.update(doc(db, "driverApplications", id), {
        serviceType: normalizedServiceType,
        status: "approved",
        reviewedBy: state.user.uid,
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      batch.set(doc(db, "users", accountUid), existingUser
        ? { role: "driver", updatedAt: serverTimestamp() }
        : activationUserPayload({ ...application, name: captainName, email: captainEmail }, "driver"), { merge: true });
      batch.set(doc(db, "drivers", accountUid), {
        userId: accountUid, name: captainName, email: captainEmail, phone: captainPhone,
        serviceType: normalizedServiceType, vehicleType,
        vehicleMake: String(application.vehicleMake || "").trim(), vehicleModel: String(application.vehicleModel || "").trim(),
        vehicleCondition: String(application.vehicleCondition || "").trim(), plate, city,
        online: false, blocked: false, warningCount: 0, warningMessage: "",
        approvedAt: serverTimestamp(), updatedAt: serverTimestamp()
      }, { merge: true });
      await batch.commit();
      toast(existingUser ? "تم قبول الكابتن وتفعيل حسابه" : "تم قبول الكابتن وإصلاح ملف المستخدم القديم تلقائيًا");
    } else if (button.dataset.action === "reject") {
      const note = prompt("سبب الرفض أو المطلوب تعديله:", "يرجى مراجعة بيانات المركبة")?.trim();
      if (!note) return;
      const rejectBatch = writeBatch(db);
      rejectBatch.update(doc(db, "driverApplications", id), {
        status: "rejected",
        reviewNote: note,
        reviewedBy: state.user.uid,
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      await rejectBatch.commit();
      toast("تم رفض الطلب مع إرسال الملاحظة");
    } else if (button.dataset.action === "warn-driver") {
      const note = prompt("اكتب التنبيه الذي سيظهر للكابتن:", "يرجى الالتزام بسياسة الخدمة")?.trim();
      if (!note) return;
      await updateDoc(doc(db, "drivers", id), {
        warningCount: increment(1),
        warningMessage: note.slice(0, 300),
        lastWarnedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      toast("تم إرسال التنبيه للكابتن");
    } else if (button.dataset.action === "block-driver") {
      const reason = prompt("اكتب سبب حظر الكابتن:", "مخالفة سياسة الخدمة")?.trim();
      if (!reason) return;
      await updateDoc(doc(db, "drivers", id), {
        blocked: true,
        online: false,
        blockReason: reason.slice(0, 300),
        blockedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      toast("تم حظر الكابتن وإيقاف استقبال الطلبات");
    } else if (button.dataset.action === "unblock-driver") {
      if (!confirm("هل تريد إعادة تفعيل هذا الكابتن؟")) return;
      await updateDoc(doc(db, "drivers", id), {
        blocked: false,
        online: false,
        blockReason: "",
        unblockedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      toast("تمت إعادة تفعيل الكابتن");
    } else if (button.dataset.action === "cancel-order") {
      if (!confirm("هل تريد إلغاء هذا الطلب إداريًا؟")) return;
      const reason = prompt("اكتب سبب الإلغاء الإداري. السبب مطلوب وسيظهر في سجل الإلغاءات:", "")?.trim();
      if (!reason || reason.length < 3) { toast("يجب كتابة سبب واضح للإلغاء."); return; }
      const adminProfile = state.users.find(item => item.firestoreId === state.user?.uid) || {};
      await updateDoc(doc(db, "orders", id), {
        cancelled: true,
        cancellationReason: reason.slice(0,300),
        cancelledBy: "admin",
        cancelledByRole: "admin",
        cancelledByUserId: state.user?.uid || "",
        cancelledByName: adminProfile.name || state.user?.displayName || "إدارة كروة",
        cancelledByEmail: state.user?.email || adminProfile.email || "",
        cancelledAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      toast("تم إلغاء الطلب وتسجيل السبب وهوية المدير");
    }
  } catch (error) {
    console.error("Admin operation failed", { action: button.dataset.action, id, code: error?.code, message: error?.message, error });
    if(String(error?.message||"").includes("DEVICE_ALREADY_BOUND")) toast("الهاتف الجديد مرتبط حاليًا بحساب آخر؛ لا يمكن استبداله قبل معالجة ذلك الحساب.");
    else if(String(error?.message||"").includes("DEVICE_REQUEST_REVIEWED")) toast("تمت مراجعة طلب تغيير الجهاز مسبقًا.");
    else toast(activationErrorMessage(error));
  } finally {
    busy(button, false);
  }
});

let adminAuthEventSequence = 0;

async function handleAdminAuthState(user, sequence) {
  // IMPORTANT: this function must run OUTSIDE Supabase onAuthStateChange.
  // Supabase documents a deadlock when async Supabase calls are made inside
  // the auth-state callback. The callback below only schedules this function.
  if (sequence !== adminAuthEventSequence) return;

  if (state.roleUnsubscribe) {
    try { state.roleUnsubscribe(); } catch (_) {}
    state.roleUnsubscribe = null;
  }

  if (!user) {
    adminAccessCheckToken++;
    adminDashboardUid = "";
    clearDashboardListeners();
    showView("auth");
    return;
  }

  // These operations use Supabase and therefore are deliberately deferred
  // until after the auth callback has completely returned.
  registerAdminNativePushToken(user).catch?.(() => {});
  window.setTimeout(() => registerAdminNativePushToken(user).catch?.(() => {}), 5000);

  const allowed = await enterAdminPortal(user);
  if (sequence !== adminAuthEventSequence || !allowed) return;

  // Realtime document monitoring is secondary. If it briefly reports a stale
  // document, re-check the normalized profile before revoking dashboard access.
  state.roleUnsubscribe = onSnapshot(doc(db, "users", user.uid), snapshot => {
    if (snapshot.exists() && snapshot.data()?.role === "admin") return;
    // Also defer the fallback check so the realtime callback remains lightweight.
    window.setTimeout(async () => {
      const stillAdmin = await verifyAdminAccessWithRetry(user, 2);
      if (!stillAdmin && auth.currentUser?.uid === user.uid) {
        adminDashboardUid = "";
        clearDashboardListeners();
        showView("denied");
      }
    }, 0);
  }, error => {
    console.warn("تعذر تحديث صلاحية الإدارة لحظيًا", error);
  });
}

onAuthStateChanged(auth, user => {
  // Never perform a Supabase request here. Supabase's current docs warn that
  // async API calls from onAuthStateChange can deadlock the client.
  state.user = user;
  const sequence = ++adminAuthEventSequence;
  window.setTimeout(() => {
    handleAdminAuthState(user, sequence).catch(error => {
      console.error("Admin auth transition failed", error);
      if (auth.currentUser?.uid === user?.uid) {
        const status = byId("authError");
        if (status) status.textContent = "تعذر إكمال فتح لوحة الإدارة. أعد المحاولة.";
        showView("auth");
      }
    });
  }, 0);
});
