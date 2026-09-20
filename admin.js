import { initializeApp } from "./supabase-compat.js?v=113";
import {
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut
} from "./supabase-compat.js?v=113";
import {
  collection,
  doc,
  getDoc,
  getSupabase,
  increment,
  onSnapshot,
  subscribeGlobalPricing,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  karwaSensitiveAction,
  karwaAdminAccountAction,
  karwaCreateTopupCard,
  karwaListTopupCards
} from "./supabase-compat.js?v=113";

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
const governoratesApi = window.KarwaGovernorates;

const state = {
  user: null,
  users: [],
  applications: [],
  serviceApplications: [],
  serviceProfiles: [],
  restaurants: [],
  drivers: [],
  accountDirectory: [],
  accountDirectoryLoadedAt: 0,
  accountDirectoryLoading: false,
  ratings: [],
  ratingsFilter: "all",
  orders: [],
  serviceRequests: [],
  topupRequests: [],
  topupLocks: [],
  walletTransactions: [],
  topupCards: [],
  lastGeneratedTopupCardCode: "",
  deviceBindings: [],
  deviceLinks: [],
  deviceChangeRequests: [],
  pricingSettings: {},
  financeSettings: {},
  areaMap: null,
  areaBaseLayer: null,
  areaCenter: null,
  areaCircle: null,
  areaCenterMarker: null,
  areaMarkers: new Map(),
  roleUnsubscribe: null,
  dashboardUnsubscribes: []
};


function adminNotify(input={}){
  try{return window.KarwaNotify?.push?.({...input,native:input.native!==false});}catch(error){console.warn("تعذر إنشاء إشعار الإدارة",error);return null;}
}
function changedToPending(previous,item){return (!previous||previous.status!=="pending")&&(item?.status||"pending")==="pending";}

function recordCreatedMillis(item={}){
  const value=item.createdAt||item.submittedAt||item.requestedAt||item.updatedAt;
  if(value?.seconds)return Number(value.seconds)*1000;
  if(typeof value?.toMillis==="function")return Number(value.toMillis());
  const raw=item.createdAtISO||item.created_at||item.updated_at||value||0;
  const ms=new Date(raw).getTime();
  return Number.isFinite(ms)?ms:0;
}
function isNewRealtimeRecord(previous,item){return !previous&&!!item?.firestoreId;}
function notifyNewOrderForAdmin(order={}){
  const type=String(order.type||"");
  const label=type==="ride"?"طلب تكسي جديد":type==="parcel"?"طلب توصيل أغراض جديد":type==="serviceDelivery"?"طلب توصيل طعام/خدمة جديد":type==="food"?"طلب توصيل طعام جديد":"طلب جديد";
  const customer=order.customerName||order.userName||"عميل كروة";
  const route=order.route?` • ${String(order.route).slice(0,90)}`:"";
  adminNotify({title:label,body:`${customer}${route}`,type:"order",route:"#waitingOrdersPanel",tag:`admin-order-${order.firestoreId}`,forceNative:true});
  toast(label);
}
function notifyNewServiceRequestForAdmin(request={}){
  const restaurant=String(request.providerCategory||"").toLowerCase()==="restaurant";
  const label=restaurant?"طلب طعام جديد":"طلب خدمة جديد";
  const customer=request.customerName||"عميل كروة";
  const provider=request.providerName||request.businessName||"مزود الخدمة";
  const delivery=request.deliveryRequested===true?" • مع توصيل":"";
  adminNotify({title:label,body:`${customer} ← ${provider}${delivery}`,type:"service",route:"#waitingOrdersPanel",tag:`admin-service-request-${request.firestoreId}`,forceNative:true});
  toast(label);
}

const money = value => Number(value || 0).toLocaleString("ar-IQ") + " د.ع";

function financeTimestampMillis(value) {
  if (!value) return 0;
  if (Number.isFinite(Number(value?.seconds))) return Number(value.seconds) * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1e6);
  if (typeof value?.toMillis === "function") return Number(value.toMillis()) || 0;
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function financeRecordTime(item = {}, fields = []) {
  for (const field of fields) {
    const value = financeTimestampMillis(item?.[field]);
    if (value) return value;
  }
  return recordCreatedMillis(item);
}

function financeRoleKey(user = {}) {
  const role = String(user.role || "customer");
  if (["driver", "driverApplicant"].includes(role)) return "driver";
  if (["serviceProvider", "serviceApplicant"].includes(role)) return "serviceProvider";
  if (role === "admin") return "admin";
  return "customer";
}

function financeRoleLabel(role = "") {
  return ({ customer: "عميل", driver: "كابتن", serviceProvider: "خدمات أخرى", admin: "إدارة" })[role] || "حساب";
}

function financeWalletOf(user = {}) {
  const paid = Math.max(0, Number(user.balance || 0));
  const storedBonus = Math.max(0, Number(user.bonusBalance || 0));
  const bonus = storedBonus > 0 && financeTimestampMillis(user.bonusExpiresAt) > Date.now() ? storedBonus : 0;
  return { paid, bonus, storedBonus, available: paid + bonus };
}

function financeAccounts() {
  return state.users
    .filter(user => financeRoleKey(user) !== "admin")
    .map(user => ({ ...user, financeRole: financeRoleKey(user), wallet: financeWalletOf(user) }));
}

function financePeriodStart() {
  const now = new Date();
  const selected = byId("financePeriod")?.value || "all";
  let selectedStart = 0;
  if (selected === "today") selectedStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (selected === "7d") selectedStart = Date.now() - 7 * 86400000;
  if (selected === "30d") selectedStart = Date.now() - 30 * 86400000;
  if (selected === "month") selectedStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const resetStart = financeTimestampMillis(state.financeSettings?.reportStartAt);
  return Math.max(selectedStart, resetStart);
}

function financePeriodText() {
  const labels = { all: "منذ بداية السجل", today: "اليوم", "7d": "آخر 7 أيام", "30d": "آخر 30 يومًا", month: "هذا الشهر" };
  const selected = byId("financePeriod")?.value || "all";
  const resetStart = financeTimestampMillis(state.financeSettings?.reportStartAt);
  const suffix = resetStart ? ` • بعد آخر تصفير ${new Date(resetStart).toLocaleString("ar-IQ")}` : "";
  return `${labels[selected] || labels.all}${suffix}`;
}

function financeSnapshot() {
  const start = financePeriodStart();
  const inPeriod = value => {
    const time = financeTimestampMillis(value);
    return start <= 0 ? true : time >= start;
  };
  const recordInPeriod = (record, fields) => inPeriod(financeRecordTime(record, fields));
  const completedTrips = state.orders.filter(order => !order.cancelled && Number(order.statusIndex || 0) >= 4 && recordInPeriod(order, ["completedAt", "updatedAt", "createdAt"]));
  const completedServices = state.serviceRequests.filter(request => request.status === "completed" && recordInPeriod(request, ["statusUpdatedAt", "updatedAt", "createdAt"]));
  const approvedTopups = state.topupRequests.filter(request => request.status === "approved" && recordInPeriod(request, ["reviewedAt", "updatedAt", "createdAt"]));

  const fees = {
    customerTaxi: state.orders.filter(order => order.type === "ride" && (order.customerFeeCharged === true || Number(order.customerPlatformFee || 0) > 0) && recordInPeriod(order, ["createdAt"])).reduce((sum, order) => sum + Number(order.customerPlatformFee || 0), 0),
    customerDelivery: state.orders.filter(order => order.type !== "ride" && (order.customerFeeCharged === true || Number(order.customerPlatformFee || 0) > 0) && recordInPeriod(order, ["createdAt"])).reduce((sum, order) => sum + Number(order.customerPlatformFee || 0), 0),
    captainTaxi: state.orders.filter(order => order.type === "ride" && (order.captainFeeCharged === true || Number(order.captainPlatformFee || 0) > 0) && recordInPeriod(order, ["acceptedAt", "updatedAt"])).reduce((sum, order) => sum + Number(order.captainPlatformFee || 0), 0),
    captainDelivery: state.orders.filter(order => order.type !== "ride" && (order.captainFeeCharged === true || Number(order.captainPlatformFee || 0) > 0) && recordInPeriod(order, ["acceptedAt", "updatedAt"])).reduce((sum, order) => sum + Number(order.captainPlatformFee || 0), 0),
    customerService: state.serviceRequests.filter(request => (request.customerFeeCharged === true || Number(request.customerPlatformFee || 0) > 0) && recordInPeriod(request, ["createdAt"])).reduce((sum, request) => sum + Number(request.customerPlatformFee || 0), 0),
    providerRestaurant: state.serviceRequests.filter(request => request.providerCategory === "restaurant" && (request.providerFeeCharged === true || Number(request.providerPlatformFee || 0) > 0) && recordInPeriod(request, ["statusUpdatedAt", "updatedAt"])).reduce((sum, request) => sum + Number(request.providerPlatformFee || 0), 0),
    providerService: state.serviceRequests.filter(request => request.providerCategory !== "restaurant" && (request.providerFeeCharged === true || Number(request.providerPlatformFee || 0) > 0) && recordInPeriod(request, ["statusUpdatedAt", "updatedAt"])).reduce((sum, request) => sum + Number(request.providerPlatformFee || 0), 0),
    publish: state.serviceProfiles.filter(profile => profile.publishFeePaid === true && recordInPeriod(profile, ["publishFeePaidAt", "updatedAt"])).reduce((sum, profile) => sum + Number(profile.publishFeeAmount || 0), 0)
  };
  const platformFees = Object.values(fees).reduce((sum, value) => sum + Number(value || 0), 0);
  const tripSales = completedTrips.reduce((sum, order) => sum + Number(order.price || 0), 0);
  const providerSales = completedServices.reduce((sum, request) => sum + Number(request.subtotal || request.itemPrice || 0), 0);
  const captainEarnings = completedTrips.reduce((sum, order) => sum + Number(order.driverEarnings || 0), 0);
  const manualTopups = approvedTopups.reduce((sum, request) => sum + Number(request.amount || 0), 0);
  const ledger = state.walletTransactions.filter(transaction => recordInPeriod(transaction, ["createdAt"]));
  const creditTransactions = ledger.filter(transaction => transaction.direction === "credit");
  const ledgerCredits = creditTransactions.reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  const ledgerDebits = ledger.filter(transaction => transaction.direction === "debit").reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  const topupCreditTransactions = creditTransactions.filter(transaction => ["topup_credit", "topup_card_credit"].includes(String(transaction.kind || "")));
  const topupCredits = topupCreditTransactions.reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  const topups = topupCredits > 0 ? topupCredits : manualTopups;
  const topupCount = topupCreditTransactions.length || approvedTopups.length;
  const accounts = financeAccounts();
  const walletByRole = role => {
    const rows = accounts.filter(account => account.financeRole === role);
    return rows.reduce((summary, account) => ({ count: summary.count + 1, paid: summary.paid + account.wallet.paid, bonus: summary.bonus + account.wallet.bonus, available: summary.available + account.wallet.available }), { count: 0, paid: 0, bonus: 0, available: 0 });
  };
  const wallets = { customer: walletByRole("customer"), driver: walletByRole("driver"), serviceProvider: walletByRole("serviceProvider") };
  wallets.all = Object.values(wallets).reduce((summary, row) => ({ count: summary.count + row.count, paid: summary.paid + row.paid, bonus: summary.bonus + row.bonus, available: summary.available + row.available }), { count: 0, paid: 0, bonus: 0, available: 0 });
  return { start, fees, platformFees, completedTrips, completedServices, approvedTopups, tripSales, providerSales, grossSales: tripSales + providerSales, captainEarnings, topups, topupCount, ledgerCredits, ledgerDebits, wallets, accounts };
}

function renderFinanceAccounts(snapshot = financeSnapshot()) {
  const table = byId("financeAccountTable");
  if (!table) return;
  const search = String(byId("financeAccountSearch")?.value || "").trim().toLocaleLowerCase("ar");
  const role = byId("financeRoleFilter")?.value || "all";
  const rows = snapshot.accounts
    .filter(account => role === "all" || account.financeRole === role)
    .filter(account => !search || [account.name, account.email, financeRoleLabel(account.financeRole)].some(value => String(value || "").toLocaleLowerCase("ar").includes(search)))
    .sort((a, b) => b.wallet.available - a.wallet.available || String(a.name || "").localeCompare(String(b.name || ""), "ar"));
  if (byId("financeAccountsCount")) byId("financeAccountsCount").textContent = `${rows.length} حساب`;
  const header = `<div class="finance-account-row header"><span>الحساب</span><span>النوع</span><span>المشحون</span><span>المجاني الصالح</span><span>المتاح الفعلي</span></div>`;
  table.innerHTML = header + (rows.length ? rows.map(account => {
    const expired = account.wallet.storedBonus > 0 && account.wallet.bonus === 0 ? ` • منتهي ${money(account.wallet.storedBonus)}` : "";
    return `<div class="finance-account-row"><span class="finance-account-identity"><strong>${escapeHtml(account.name || "مستخدم كروة")}</strong><small>${escapeHtml(account.email || account.firestoreId || "—")}</small></span><span class="finance-account-role">${financeRoleLabel(account.financeRole)}</span><span>${money(account.wallet.paid)}</span><span title="${escapeHtml(expired.trim())}">${money(account.wallet.bonus)}${expired ? " *" : ""}</span><strong class="finance-account-total">${money(account.wallet.available)}</strong></div>`;
  }).join("") : `<div class="finance-account-row"><span class="muted">لا توجد حسابات مطابقة.</span></div>`);
}

function renderFinancialReport() {
  if (!byId("financialReport")) return;
  const snapshot = financeSnapshot();
  const setWallet = (prefix, wallet) => {
    const value = byId(`finance${prefix}Wallet`), meta = byId(`finance${prefix}WalletMeta`);
    if (value) value.textContent = money(wallet.available);
    if (meta) meta.textContent = `${wallet.count} حساب • مشحون ${money(wallet.paid)} • مجاني ${money(wallet.bonus)}`;
  };
  setWallet("Customer", snapshot.wallets.customer);
  setWallet("Captain", snapshot.wallets.driver);
  setWallet("Service", snapshot.wallets.serviceProvider);
  setWallet("All", snapshot.wallets.all);
  if (byId("customerWalletBalance")) byId("customerWalletBalance").textContent = money(snapshot.wallets.customer.available);
  if (byId("captainWalletBalance")) byId("captainWalletBalance").textContent = money(snapshot.wallets.driver.available);
  if (byId("serviceWalletBalance")) byId("serviceWalletBalance").textContent = money(snapshot.wallets.serviceProvider.available);
  const completedCount = snapshot.completedTrips.length + snapshot.completedServices.length;
  if (byId("financialReportBadge")) byId("financialReportBadge").textContent = `${completedCount} عملية مكتملة`;
  if (byId("financePeriodLabel")) byId("financePeriodLabel").textContent = financePeriodText();
  if (byId("financeUpdatedAt")) byId("financeUpdatedAt").textContent = `آخر تحديث: ${new Date().toLocaleString("ar-IQ")}`;
  byId("financeKpiGrid").innerHTML = [
    ["إجمالي المبيعات المكتملة", snapshot.grossSales, `${snapshot.completedTrips.length} رحلة • ${snapshot.completedServices.length} خدمة`],
    ["إيراد كروة من الرسوم", snapshot.platformFees, "رسوم ثابتة بدون عمولة نسبية"],
    ["أرباح الكباتن", snapshot.captainEarnings, `${snapshot.completedTrips.length} رحلة مكتملة`],
    ["مبيعات مزودي الخدمات", snapshot.providerSales, `${snapshot.completedServices.length} طلب خدمة مكتمل`],
    ["الشحنات المضافة للمحافظ", snapshot.topups, `${snapshot.topupCount} عملية شحن يدوي أو كرت`],
    ["حركة سجل المحفظة", snapshot.ledgerCredits - snapshot.ledgerDebits, `دائن ${money(snapshot.ledgerCredits)} • مدين ${money(snapshot.ledgerDebits)}`]
  ].map(([label, value, note]) => `<div class="finance-kpi"><small>${label}</small><strong>${money(value)}</strong><em>${note}</em></div>`).join("");
  const feeRows = [
    ["رسوم العملاء — تكسي", snapshot.fees.customerTaxi], ["رسوم العملاء — توصيل", snapshot.fees.customerDelivery],
    ["رسوم العملاء — خدمات ومطاعم", snapshot.fees.customerService], ["رسوم الكباتن — تكسي", snapshot.fees.captainTaxi],
    ["رسوم الكباتن — توصيل", snapshot.fees.captainDelivery], ["رسوم المطاعم", snapshot.fees.providerRestaurant],
    ["رسوم الخدمات الأخرى", snapshot.fees.providerService], ["رسوم نشر الأنشطة", snapshot.fees.publish]
  ];
  byId("financeFeeBreakdown").innerHTML = feeRows.map(([label, value]) => `<div class="finance-fee-row"><span>${label}</span><strong>${money(value)}</strong></div>`).join("");
  const resetAt = financeTimestampMillis(state.financeSettings?.reportStartAt);
  if (byId("financeResetMeta")) byId("financeResetMeta").textContent = resetAt ? `يبدأ التقرير الحالي من ${new Date(resetAt).toLocaleString("ar-IQ")}. آخر منفذ: ${state.financeSettings?.lastResetByEmail || "مدير النظام"}` : "لم يتم تصفير التقرير سابقًا.";
  renderFinanceAccounts(snapshot);
}

function financeCsvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function exportFinancialReportCsv() {
  const snapshot = financeSnapshot();
  const lines = [
    ["تقرير كروة المالي", financePeriodText()],
    ["تاريخ التصدير", new Date().toLocaleString("ar-IQ")],
    [],
    ["المؤشر", "القيمة (د.ع)"],
    ["إجمالي المبيعات المكتملة", snapshot.grossSales],
    ["إيراد كروة من الرسوم", snapshot.platformFees],
    ["أرباح الكباتن", snapshot.captainEarnings],
    ["مبيعات مزودي الخدمات", snapshot.providerSales],
    ["الشحنات المضافة للمحافظ", snapshot.topups],
    [],
    ["اسم الحساب", "البريد", "النوع", "الرصيد المشحون", "الرصيد المجاني الصالح", "الرصيد المتاح الفعلي"],
    ...snapshot.accounts.sort((a, b) => b.wallet.available - a.wallet.available).map(account => [account.name || "مستخدم كروة", account.email || "", financeRoleLabel(account.financeRole), account.wallet.paid, account.wallet.bonus, account.wallet.available])
  ];
  const csv = "\ufeff" + lines.map(row => row.map(financeCsvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `karwa-financial-report-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast("تم تجهيز التقرير المالي بصيغة CSV");
}

async function commitFinanceBatches(items, apply, size = 35) {
  for (let index = 0; index < items.length; index += size) {
    const batch = writeBatch(db);
    items.slice(index, index + size).forEach(item => apply(batch, item));
    await batch.commit();
  }
}

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

function openAdminPanel(panelId, { scroll = false, remember = true } = {}) {
  const target = byId(String(panelId || "").replace(/^#/, ""));
  if (!target?.classList.contains("admin-panel")) return false;
  document.querySelectorAll(".admin-panel").forEach(panel => {
    const open = panel === target;
    panel.classList.toggle("is-open", open);
    panel.querySelector(":scope > .card-heading")?.setAttribute("aria-expanded", String(open));
  });
  document.querySelectorAll(".admin-module-card").forEach(card => card.classList.toggle("is-active", card.getAttribute("href") === `#${target.id}`));
  if (remember) {
    try { sessionStorage.setItem("karwaAdminOpenPanel", target.id); } catch (_) {}
    if (location.hash !== `#${target.id}`) history.replaceState(null, "", `#${target.id}`);
  }
  if (target.id === "areaMapPanel") window.setTimeout(() => { state.areaMap?.invalidateSize(); renderAdminAreaMap(); }, 80);
  if (scroll) window.setTimeout(() => target.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  return true;
}

function setupAdminSections() {
  document.querySelectorAll(".admin-panel").forEach(panel => {
    const heading = panel.querySelector(":scope > .card-heading");
    if (!heading) return;
    heading.setAttribute("role", "button");
    heading.setAttribute("tabindex", "0");
    heading.setAttribute("aria-controls", panel.id);
    heading.setAttribute("aria-expanded", "false");
    const toggle = () => {
      if (panel.classList.contains("is-open")) {
        panel.classList.remove("is-open");
        heading.setAttribute("aria-expanded", "false");
        document.querySelector(`.admin-module-card[href="#${panel.id}"]`)?.classList.remove("is-active");
        return;
      }
      openAdminPanel(panel.id, { scroll: false });
    };
    heading.addEventListener("click", toggle);
    heading.addEventListener("keydown", event => {
      if (!["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      toggle();
    });
  });
  document.querySelectorAll(".admin-module-card[href^='#']").forEach(card => card.addEventListener("click", event => {
    event.preventDefault();
    openAdminPanel(card.getAttribute("href"), { scroll: true });
  }));
  window.addEventListener("hashchange", () => openAdminPanel(location.hash, { scroll: true, remember: false }));
}
setupAdminSections();

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
  const pendingServiceRequests = state.serviceRequests.filter(request =>
    !request.cancelled && (request.status || "pending") === "pending"
  ).length;
  const driversAttention = state.drivers.filter(driver =>
    driver.blocked === true || Number(driver.warningCount || 0) > 0
  ).length;
  const completedTrips = state.orders.filter(order =>
    !order.cancelled && Number(order.statusIndex || 0) >= 4
  ).length;
  const completedServices = state.serviceRequests.filter(request => request.status === "completed").length;
  const deviceChanges = state.deviceChangeRequests.filter(item => (item.status || "pending") === "pending").length;

  return {
    captainApplications,
    serviceApplications,
    topups,
    waitingOrders,
    pendingServiceRequests,
    driversAttention,
    completedTrips,
    completedFinancial: completedTrips + completedServices,
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
  setModuleNotification("navOrdersCount", counts.waitingOrders + counts.pendingServiceRequests);
  setModuleNotification("navFinanceCount", counts.completedFinancial, false);
  setModuleNotification("navRatingsCount", counts.ratings, false);
  setModuleNotification("navDevicesCount", counts.deviceChanges);

  setPanelNotification("pendingTopupsBadge", counts.topups, "بانتظار المراجعة");
  setPanelNotification("serviceApplicationsBadge", counts.serviceApplications, "بانتظار المراجعة");
  setPanelNotification("captainApplicationsBadge", counts.captainApplications, "بانتظار المراجعة");
  setPanelNotification("driversAttentionBadge", counts.driversAttention, "يحتاج متابعة");
  setPanelNotification("waitingOrdersBadge", counts.waitingOrders + counts.pendingServiceRequests, "طلب وارد الآن");
  setPanelNotification("financialReportBadge", counts.completedFinancial, "عملية مكتملة");
  setPanelNotification("ratingsBadge", counts.ratings, "تقييم");

  const actionable = counts.topups + counts.serviceApplications + counts.captainApplications + counts.driversAttention + counts.waitingOrders + counts.pendingServiceRequests + counts.deviceChanges;
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
  byId("pendingCount").textContent = notifications.captainApplications + notifications.serviceApplications + notifications.topups + notifications.pendingServiceRequests + notifications.deviceChanges;
  byId("ordersCount").textContent = state.orders.length + state.serviceRequests.length;
  byId("liveTripsCount").textContent = state.orders.filter(o => !o.cancelled && Number(o.statusIndex||0) > 0 && Number(o.statusIndex||0) < 4).length;
  byId("cancelledTripsCount").textContent = state.orders.filter(o => o.cancelled).length;
  byId("onlineDriversCount").textContent = state.drivers.filter(d => d.online === true && d.blocked !== true).length;
  const completed=state.orders.filter(o=>!o.cancelled&&Number(o.statusIndex||0)>=4);
  const completedServices=state.serviceRequests.filter(request=>request.status==="completed");
  const gross=completed.reduce((n,o)=>n+Number(o.price||0),0)+completedServices.reduce((n,request)=>n+Number(request.subtotal||request.itemPrice||0),0);
  const orderFees=state.orders.reduce((n,o)=>n+Number(o.customerPlatformFee||0)+Number(o.captainPlatformFee||0),0);
  const serviceFees=state.serviceRequests.reduce((n,r)=>n+Number(r.customerPlatformFee||0)+Number(r.providerPlatformFee||0),0);
  const publishFees=state.serviceProfiles.reduce((n,p)=>n+(p.publishFeePaid===true?Number(p.publishFeeAmount||0):0),0);
  const platformFees=orderFees+serviceFees+publishFees;
  const payout=completed.reduce((n,o)=>n+Number(o.driverEarnings||0),0);
  byId("grossRevenue").textContent=money(gross);byId("commissionRevenue").textContent=money(platformFees);byId("driversPayout").textContent=money(payout);
  renderAdminNotifications();
  renderFinancialReport();
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
  const captainEarnings = completedOrders.reduce((sum,o) => sum + Number(o.driverEarnings || 0), 0);
  const captainUser = state.users.find(user => user.firestoreId === driver.firestoreId) || {};
  const captainWallet = financeWalletOf(captainUser);
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
      <div class="captain-balance"><small>الرصيد الفعلي المتاح في محفظة الكابتن</small><strong>${money(captainWallet.available)}</strong><div class="actual-balance-detail"><span>مشحون: <b>${money(captainWallet.paid)}</b></span><span>مجاني صالح: <b>${money(captainWallet.bonus)}</b></span><span>أرباح الرحلات المكتملة: <b>${money(captainEarnings)}</b></span></div></div>
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
      <div class="order-meta account-activity-inline">${accountLastActivityInline(driver.firestoreId)}</div>
      <div class="order-actions"><button class="secondary" data-action="warn-driver" data-id="${driver.firestoreId}">إرسال تنبيه</button>${blockAction}<button class="danger" data-action="delete-account" data-id="${escapeHtml(driver.firestoreId)}" data-name="${escapeHtml(driver.name || captainUser.name || "كابتن كروة")}" data-email="${escapeHtml(driver.email || captainUser.email || "")}" data-role="driver" data-category="${escapeHtml(captainServiceLabel(driver))}">حذف الكابتن نهائيًا</button></div>
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
byId("financePeriod")?.addEventListener("change", renderFinancialReport);
byId("financeAccountSearch")?.addEventListener("input", () => renderFinanceAccounts());
byId("financeRoleFilter")?.addEventListener("change", () => renderFinanceAccounts());
byId("exportFinanceCsv")?.addEventListener("click", exportFinancialReportCsv);
byId("printFinanceReport")?.addEventListener("click", () => {
  openAdminPanel("financePanel", { scroll: false });
  renderFinancialReport();
  window.print();
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
  const applicationUid = String(application.userId || application.ownerId || application.firestoreId || "");
  const restaurant = state.restaurants.find(item => item.firestoreId === applicationUid || item.firestoreId === application.firestoreId || item.ownerId === applicationUid);
  const profile = state.serviceProfiles.find(item => item.firestoreId === applicationUid || item.firestoreId === application.firestoreId || item.ownerId === applicationUid);
  const category = application.category || profile?.category || (restaurant ? "restaurant" : "other");
  const businessName = application.businessName || profile?.businessName || restaurant?.name || application.name || "مزود خدمة";
  const ownerName = application.ownerName || profile?.ownerName || application.name || "—";
  const address = application.address || profile?.address || restaurant?.address || "—";
  const location = application.location || profile?.location || restaurant?.location;
  const gps = location?.latitude != null && location?.longitude != null ? `${Number(location.latitude).toFixed(5)}, ${Number(location.longitude).toFixed(5)}` : "غير محدد";
  const items = profile?.items || restaurant?.meals || [];
  const hasLocation = Number.isFinite(Number(location?.latitude)) && Number.isFinite(Number(location?.longitude));
  const providerUid = String(profile?.firestoreId || profile?.ownerId || restaurant?.ownerId || applicationUid);
  const providerRating = providerRatingSummary(providerUid);
  const providerUser = state.users.find(user => user.firestoreId === providerUid) || {};
  const providerWallet = financeWalletOf(providerUser);
  const blocked = profile?.blocked === true || restaurant?.blocked === true;
  const warningCount = Number(profile?.warningCount || 0);
  const visibleStatus = blocked ? "محظور" : labels[status] || status;
  const statusClass = blocked ? "rejected" : status;
  const reviewActions = status === "pending" ? `<div class="order-actions"><button class="primary" data-action="approve-service" data-source="${source}" data-id="${application.firestoreId}" ${hasLocation ? "" : 'disabled title="يجب أن يحدد المزود موقع GPS أولًا"'}>${hasLocation ? "قبول وتفعيل" : "GPS مطلوب قبل القبول"}</button><button class="danger" data-action="reject-service" data-source="${source}" data-id="${application.firestoreId}">رفض مع ملاحظة</button></div>` : "";
  const moderationActions = providerUid && (status === "approved" || profile?.approvalStatus === "approved")
    ? `<div class="order-actions service-moderation-actions"><button class="secondary" data-action="warn-service-provider" data-id="${escapeHtml(providerUid)}">إرسال تنبيه</button>${blocked ? `<button class="secondary" data-action="unblock-service-provider" data-id="${escapeHtml(providerUid)}">إعادة التفعيل</button>` : `<button class="danger" data-action="block-service-provider" data-id="${escapeHtml(providerUid)}">حظر صاحب الخدمة</button>`}<button class="danger" data-action="delete-account" data-id="${escapeHtml(providerUid)}" data-name="${escapeHtml(businessName)}" data-email="${escapeHtml(application.email || providerUser.email || "")}" data-role="serviceProvider" data-category="${escapeHtml(serviceCategoryLabels[category] || serviceCategoryLabels.other)}">حذف الحساب نهائيًا</button></div>`
    : "";
  return `<article class="order-card service-application-card ${blocked ? "is-blocked" : ""}">
    <div class="order-top"><h3>🧰 ${escapeHtml(businessName)}</h3><span class="status-chip ${statusClass}">${escapeHtml(visibleStatus)}</span></div>
    <p class="order-route">${escapeHtml(serviceCategoryLabels[category] || serviceCategoryLabels.other)} • ${escapeHtml(application.city || profile?.city || "—")}</p>
    <div class="order-meta"><span>صاحب الخدمة: ${escapeHtml(ownerName)}</span><span>الهاتف: ${escapeHtml(application.phone || profile?.phone || restaurant?.phone || "—")}</span></div>
    <div class="order-meta"><span>البريد: ${escapeHtml(application.email || "—")}</span><span>العنوان: ${escapeHtml(address)}</span><span>GPS: ${escapeHtml(gps)}</span></div>
    ${application.description ? `<p class="admin-note">${escapeHtml(application.description)}</p>` : ""}
    <div class="order-meta"><span>العناصر المضافة: ${Array.isArray(items) ? items.length : 0}</span><span>★ ${providerRating.count ? providerRating.average.toFixed(1) : "جديد"} • ${providerRating.count} تقييم</span><span>⚠ ${warningCount} تنبيه</span>${application.legacy ? `<span>طلب قديم — مدعوم تلقائيًا</span>` : ""}</div>
    <div class="captain-balance"><small>الرصيد الفعلي المتاح للخدمة</small><strong>${money(providerWallet.available)}</strong><div class="actual-balance-detail"><span>مشحون: <b>${money(providerWallet.paid)}</b></span><span>مجاني صالح: <b>${money(providerWallet.bonus)}</b></span></div></div>
    ${application.reviewNote ? `<p class="admin-note danger-note">ملاحظة المراجعة: ${escapeHtml(application.reviewNote)}</p>` : ""}
    ${profile?.warningMessage ? `<p class="admin-note">آخر تنبيه: ${escapeHtml(profile.warningMessage)}</p>` : ""}
    ${blocked && profile?.blockReason ? `<p class="admin-note danger-note">سبب الحظر: ${escapeHtml(profile.blockReason)}</p>` : ""}
    <div class="order-meta account-activity-inline">${accountLastActivityInline(providerUid)}</div>
    ${reviewActions}${moderationActions}
  </article>`;
}

function renderServiceApplications() {
  const modernIds = new Set(state.serviceApplications.map(item => item.firestoreId));
  const legacyApplications = state.applications
    .filter(item => item.serviceType === "other" && !modernIds.has(item.firestoreId))
    .map(item => ({ ...item, legacy: true }));
  const baseApplications = [...state.serviceApplications, ...legacyApplications];
  const knownProviderIds = new Set(baseApplications.flatMap(item => [item.firestoreId, item.userId, item.ownerId].filter(Boolean).map(String)));
  const profileApplications = state.serviceProfiles
    .filter(profile => !knownProviderIds.has(String(profile.firestoreId)) && !knownProviderIds.has(String(profile.ownerId || "")))
    .map(profile => ({ ...profile, userId: profile.ownerId || profile.firestoreId, status: profile.approvalStatus || "approved", profileOnly: true }));
  const allProviders = [...baseApplications, ...profileApplications];
  const categoryFilter = byId("serviceCategoryFilter")?.value || "all";
  const term = String(byId("serviceProviderSearchInput")?.value || "").trim().toLocaleLowerCase("ar");
  const filtered = allProviders.filter(application => {
    const uid = String(application.userId || application.ownerId || application.firestoreId || "");
    const profile = state.serviceProfiles.find(item => item.firestoreId === uid || item.ownerId === uid || item.firestoreId === application.firestoreId);
    const restaurant = state.restaurants.find(item => item.firestoreId === uid || item.ownerId === uid || item.firestoreId === application.firestoreId);
    const category = application.category || profile?.category || (restaurant ? "restaurant" : "other");
    if (categoryFilter !== "all" && category !== categoryFilter) return false;
    if (!term) return true;
    return [application.businessName, profile?.businessName, restaurant?.name, application.ownerName, profile?.ownerName, application.name, application.phone, profile?.phone, restaurant?.phone, application.email, application.city, profile?.city, serviceCategoryLabels[category]]
      .some(value => String(value || "").toLocaleLowerCase("ar").includes(term));
  });
  const sorted = filtered.sort((a, b) => {
    const auid = String(a.userId || a.ownerId || a.firestoreId || "");
    const buid = String(b.userId || b.ownerId || b.firestoreId || "");
    const ap = state.serviceProfiles.find(item => item.firestoreId === auid || item.ownerId === auid || item.firestoreId === a.firestoreId);
    const bp = state.serviceProfiles.find(item => item.firestoreId === buid || item.ownerId === buid || item.firestoreId === b.firestoreId);
    if (ap?.blocked === true && bp?.blocked !== true) return -1;
    if (bp?.blocked === true && ap?.blocked !== true) return 1;
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (b.status === "pending" && a.status !== "pending") return 1;
    return Number(b.submittedAt?.seconds || b.updatedAt?.seconds || 0) - Number(a.submittedAt?.seconds || a.updatedAt?.seconds || 0);
  });
  if (byId("serviceProviderSearchCount")) byId("serviceProviderSearchCount").textContent = (term || categoryFilter !== "all") ? `${sorted.length} من ${allProviders.length}` : `${allProviders.length} مزود خدمة`;
  byId("serviceApplicationsList").innerHTML = sorted.length
    ? sorted.map(serviceApplicationCard).join("")
    : `<div class="empty"><span>🧰</span>${term || categoryFilter !== "all" ? "لا يوجد مزود خدمة مطابق للبحث أو الصنف المحدد." : "لا توجد طلبات مزودي خدمات بعد."}</div>`;
}

byId("serviceProviderSearchInput")?.addEventListener("input", renderServiceApplications);
byId("serviceCategoryFilter")?.addEventListener("change", renderServiceApplications);

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

function serviceRequestAdminCard(request) {
  const restaurant=String(request.providerCategory||"").toLowerCase()==="restaurant";
  const status=String(request.status||"pending");
  const statusLabel=status==="pending"?(restaurant?"بانتظار المطعم":"بانتظار مزود الخدمة"):status==="accepted"?"مقبول":status==="rejected"?"مرفوض":status;
  const title=request.requestText||request.itemName||(restaurant?"طلب طعام":"طلب خدمة");
  const delivery=request.deliveryRequested===true?"نعم":"لا";
  const total=Number(request.totalPrice||request.subtotal||0);
  return `<article class="order-card service-request-admin-card">
    <div class="order-top"><h3>${restaurant?"🍽️":"🧰"} ${escapeHtml(title)}</h3><span class="status-chip ${status==="pending"?"pending":status==="accepted"?"approved":"cancelled"}">${escapeHtml(statusLabel)}</span></div>
    <p class="order-route">${escapeHtml(request.customerName||"عميل كروة")} ← ${escapeHtml(request.providerName||"مزود الخدمة")}</p>
    <div class="order-bottom"><div class="order-meta"><span>النوع: ${restaurant?"مطعم/طعام":"خدمة"}</span><span>التوصيل: ${delivery}</span></div>${total>0?`<span class="order-price">${money(total)}</span>`:""}${request.customerAddress?`<div class="order-meta"><span>عنوان العميل: ${escapeHtml(request.customerAddress)}</span></div>`:""}</div>
  </article>`;
}

function renderOrders() {
  const waiting = state.orders.filter(order =>
    !order.cancelled && !order.driverId && Number(order.statusIndex || 0) === 0
  ).map(item=>({kind:"order",item,at:recordCreatedMillis(item)}));
  const serviceWaiting = state.serviceRequests.filter(request =>
    !request.cancelled && (request.status || "pending") === "pending"
  ).map(item=>({kind:"service",item,at:recordCreatedMillis(item)}));
  const sorted = [...waiting,...serviceWaiting].sort((a,b)=>b.at-a.at);
  byId("ordersList").innerHTML = sorted.length
    ? sorted.map(row=>row.kind==="order"?orderCard(row.item):serviceRequestAdminCard(row.item)).join("")
    : `<div class="empty"><span>✅</span>لا توجد طلبات جديدة حالياً.</div>`;
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
  const transferToggle=byId("topupTransferEnabled"),cardToggle=byId("topupCardEnabled");
  if(transferToggle&&document.activeElement!==transferToggle)transferToggle.checked=c.topupTransferEnabled!==false;
  if(cardToggle&&document.activeElement!==cardToggle)cardToggle.checked=c.topupCardEnabled!==false;
  renderTopupMethodAdminControls();
}
function selectedGovernorateNames(){
  return [...document.querySelectorAll('#governoratesGrid input[data-governorate]:checked')].map(input=>input.dataset.governorate).filter(Boolean);
}
function renderGovernorateDraftSummary(){
  const total=governoratesApi?.all?.length||19,enabled=selectedGovernorateNames().length;
  const summary=byId("governoratesSummary"),badge=byId("governoratesStatusBadge"),nav=byId("navGovernoratesCount");
  if(summary){summary.textContent=enabled===total?"الخدمة متاحة في جميع المحافظات":enabled===0?"الخدمة متوقفة في جميع المحافظات":`الخدمة متاحة في ${enabled} من ${total} محافظة`;summary.classList.toggle("off",enabled===0);}
  if(badge){badge.textContent=`${enabled} محافظة فعالة`;badge.className=`status-chip ${enabled?"approved":"cancelled"}`;}
  if(nav)nav.textContent=`${enabled}/${total}`;
}
function renderGovernorateSettings(){
  const host=byId("governoratesGrid");if(!host||!governoratesApi)return;
  const enabled=new Set(governoratesApi.enabledNames(state.pricingSettings||{}));
  host.innerHTML=governoratesApi.all.map(governorate=>`<label class="governorate-control"><input type="checkbox" data-governorate="${escapeHtml(governorate.name)}" ${enabled.has(governorate.name)?"checked":""}><span class="governorate-control-icon">${escapeHtml(governorate.icon||"📍")}</span><span><strong>${escapeHtml(governorate.label||governorate.name)}</strong><small>${enabled.has(governorate.name)?"الخدمة فعالة":"الخدمة متوقفة"}</small></span><b>${enabled.has(governorate.name)?"مفعّلة":"متوقفة"}</b></label>`).join("");
  host.querySelectorAll("input[data-governorate]").forEach(input=>input.addEventListener("change",()=>{
    const card=input.closest(".governorate-control");card?.classList.toggle("is-disabled",!input.checked);
    const small=card?.querySelector("small"),status=card?.querySelector(":scope > b");if(small)small.textContent=input.checked?"الخدمة فعالة":"الخدمة متوقفة";if(status)status.textContent=input.checked?"مفعّلة":"متوقفة";
    renderGovernorateDraftSummary();
  }));
  host.querySelectorAll(".governorate-control").forEach(card=>card.classList.toggle("is-disabled",!card.querySelector("input")?.checked));
  renderGovernorateDraftSummary();
}
function setAllGovernorates(enabled){
  document.querySelectorAll('#governoratesGrid input[data-governorate]').forEach(input=>{input.checked=enabled;input.dispatchEvent(new Event("change"));});
}
byId("enableAllGovernorates")?.addEventListener("click",()=>setAllGovernorates(true));
byId("disableAllGovernorates")?.addEventListener("click",()=>{
  if(confirm("سيؤدي إيقاف الكل إلى تعطيل التسجيل والنشر وقبول الطلبات في جميع المحافظات. هل تريد المتابعة؟"))setAllGovernorates(false);
});
byId("governoratesSettingsForm")?.addEventListener("submit",async event=>{
  event.preventDefault();if(!state.user||!governoratesApi)return;
  const enabledGovernorates=selectedGovernorateNames();
  if(!enabledGovernorates.length&&!confirm("لم تُفعّل أي محافظة. ستتوقف الخدمة ميدانيًا في العراق بالكامل. حفظ هذا القرار؟"))return;
  const button=byId("saveGovernorates");busy(button,true,"جارٍ التطبيق…");
  try{
    await setDoc(doc(db,"appSettings","pricing"),{enabledGovernorates,governoratesUpdatedAt:serverTimestamp(),governoratesUpdatedBy:state.user.uid},{merge:true});
    state.pricingSettings={...(state.pricingSettings||{}),enabledGovernorates};renderGovernorateSettings();
    toast(enabledGovernorates.length?`تم تشغيل الخدمة في ${enabledGovernorates.length} محافظة`:`تم إيقاف الخدمة في جميع المحافظات`);
  }catch(error){console.error(error);toast("تعذر حفظ تشغيل المحافظات");}finally{busy(button,false);}
});
function renderTopupMethodAdminControls(){
  const transfer=byId("topupTransferEnabled")?.checked ?? (state.pricingSettings?.topupTransferEnabled!==false);
  const card=byId("topupCardEnabled")?.checked ?? (state.pricingSettings?.topupCardEnabled!==false);
  const summary=byId("topupMethodsSummary");
  if(summary){summary.classList.toggle("off",!transfer&&!card);summary.textContent=transfer&&card?"الطريقتان تعملان":transfer?"التحويل اليدوي فقط مفعّل":card?"كروت الشحن فقط مفعّلة":"جميع طرق الشحن متوقفة";}
  const status=byId("topupCardMethodStatus");if(status){status.textContent=card?"مفعّل":"متوقف";status.className=`status-chip ${card?"approved":"cancelled"}`;}
  const generate=byId("generateTopupCard"),amount=byId("topupCardAmount");if(generate)generate.disabled=!card;if(amount)amount.disabled=!card;
  document.querySelectorAll("[data-topup-card-amount]").forEach(button=>button.disabled=!card);
}
function renderTopupCardsAdmin(){
  const box=byId("topupCardsAdminList");if(!box)return;
  const rows=Array.isArray(state.topupCards)?state.topupCards:[];
  if(!rows.length){box.innerHTML='<p class="muted">لا توجد بطاقات مولدة بعد.</p>';return;}
  box.innerHTML=rows.map(card=>{
    const used=card.status==="redeemed";
    const date=card.createdAt?new Date(card.createdAt).toLocaleString("ar-IQ"):"—";
    const redeemed=card.redeemedAt?new Date(card.redeemedAt).toLocaleString("ar-IQ"):"";
    const who=card.redeemedByName||card.redeemedByEmail||"مستخدم كروة";
    return `<div class="topup-card-history-row"><div><strong>${money(card.amount)} • <span class="topup-card-code-mask">•••• •••• •••• ${escapeHtml(card.last4||"----")}</span></strong><small>توليد: ${escapeHtml(date)}${used?` • استُخدم بواسطة ${escapeHtml(who)}${redeemed?` • ${escapeHtml(redeemed)}`:""}`:" • لم يُستخدم بعد"}</small></div><span class="topup-card-state ${used?"redeemed":""}">${used?"مستخدم":"فعال"}</span></div>`;
  }).join("");
}
async function refreshTopupCardsAdmin(){
  if(!state.user)return;
  try{const rows=await karwaListTopupCards(100);state.topupCards=Array.isArray(rows)?rows:[];renderTopupCardsAdmin();}
  catch(error){console.warn("تعذر تحميل بطاقات الشحن",error);}
}
byId("topupTransferEnabled")?.addEventListener("change",renderTopupMethodAdminControls);
byId("topupCardEnabled")?.addEventListener("change",renderTopupMethodAdminControls);
byId("topupMethodsAdminForm")?.addEventListener("submit",async event=>{
  event.preventDefault();if(!state.user)return;
  const transfer=byId("topupTransferEnabled")?.checked===true,card=byId("topupCardEnabled")?.checked===true;
  const button=event.submitter||byId("saveTopupMethods");busy(button,true,"جارٍ الحفظ…");
  try{
    await setDoc(doc(db,"appSettings","pricing"),{topupTransferEnabled:transfer,topupCardEnabled:card,updatedAt:serverTimestamp(),updatedBy:state.user.uid},{merge:true});
    state.pricingSettings={...(state.pricingSettings||{}),topupTransferEnabled:transfer,topupCardEnabled:card};renderTopupMethodAdminControls();
    toast(transfer&&card?"تم تشغيل طريقتي الشحن":transfer?"تم تشغيل التحويل اليدوي فقط":card?"تم تشغيل كروت الشحن فقط":"تم إيقاف جميع طرق الشحن");
  }catch(error){console.error(error);toast("تعذر حفظ طرق الشحن");}finally{busy(button,false);}
});
document.querySelectorAll("[data-topup-card-amount]").forEach(button=>button.addEventListener("click",()=>{const input=byId("topupCardAmount");if(input)input.value=button.dataset.topupCardAmount||"5000";}));
byId("topupCardGeneratorForm")?.addEventListener("submit",async event=>{
  event.preventDefault();if(!state.user)return;
  if(byId("topupCardEnabled")?.checked===false)return toast("فعّل طريقة كروت الشحن أولًا ثم ولّد الكرت.");
  const amount=Math.round(Number(byId("topupCardAmount")?.value||0));
  if(!Number.isFinite(amount)||amount<1000||amount>1000000||amount%1000!==0)return toast("قيمة الكرت يجب أن تكون من 1,000 إلى 1,000,000 د.ع وبمضاعفات 1,000.");
  const button=event.submitter||byId("generateTopupCard");busy(button,true,"جاري التوليد…");
  try{
    const result=await karwaCreateTopupCard(amount);
    state.lastGeneratedTopupCardCode=String(result?.code||"");
    const cardBox=byId("generatedTopupCard");if(cardBox)cardBox.hidden=false;
    if(byId("generatedTopupCardCode"))byId("generatedTopupCardCode").textContent=result?.formattedCode||state.lastGeneratedTopupCardCode;
    if(byId("generatedTopupCardAmount"))byId("generatedTopupCardAmount").textContent=money(result?.amount||amount);
    await refreshTopupCardsAdmin();toast("تم توليد كرت جديد. انسخ الرقم الآن قبل مغادرة الصفحة.");
  }catch(error){console.error(error);toast(String(error?.message||"").includes("INVALID_CARD_AMOUNT")?"قيمة الكرت غير صالحة.":"تعذر توليد كرت الشحن");}
  finally{busy(button,false);}
});
byId("copyGeneratedTopupCard")?.addEventListener("click",async()=>{
  const code=state.lastGeneratedTopupCardCode;if(!code)return toast("ولّد كرتًا أولًا");
  try{await navigator.clipboard.writeText(code);toast("تم نسخ رقم الكرت");}
  catch(_){toast(code);}
});

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
  let preferredPanel=location.hash;
  if(!preferredPanel){try{preferredPanel=sessionStorage.getItem("karwaAdminOpenPanel")||"";}catch(_){}}
  if(preferredPanel)openAdminPanel(preferredPanel,{scroll:false,remember:false});
  let captainAppsReady=false, serviceAppsReady=false, topupsReady=false, ordersReady=false, serviceRequestsReady=false, deviceChangesReady=false;
  let previousCaptainApps=new Map(), previousServiceApps=new Map(), previousTopups=new Map(), previousOrders=new Map(), previousServiceRequests=new Map(), previousDeviceChanges=new Map();
  // Authentication and the rest of the dashboard must not depend on any map CDN.
  loadAdminLeaflet()
    .then(() => { initializeAdminAreaMap(); window.setTimeout(()=>{state.areaMap?.invalidateSize();renderAdminAreaMap();},80); })
    .catch(error => { console.warn("تعذر تحميل خريطة الإدارة", error); showAdminMapLoadError(); });
  refreshTopupCardsAdmin();
  loadAccountDirectory().catch(error => console.warn("تعذر تحميل دليل الحسابات", error));
  const topupCardsPoll=setInterval(refreshTopupCardsAdmin,8000);
  const accountDirectoryPoll=setInterval(()=>loadAccountDirectory({quiet:true}).catch(()=>{}),5*60*1000);
  const usersUnsubscribe = onSnapshot(collection(db, "users"), snapshot => {
    state.users = snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    renderMetrics();
    renderDrivers();
    renderServiceApplications();
    renderCancellations();
    renderDeviceManagement();
    renderAdminAreaMap();
  });
  const applicationsUnsubscribe = onSnapshot(collection(db, "driverApplications"), snapshot => {
    const incoming=snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    if(captainAppsReady)incoming.forEach(item=>{
      const old=previousCaptainApps.get(item.firestoreId);
      if(changedToPending(old,item))adminNotify({title:"طلب تسجيل كابتن جديد",body:`${item.fullName||item.name||"كابتن جديد"} أرسل طلب انضمام يحتاج المراجعة.`,type:"admin",route:"#captainApplicationsPanel",tag:`admin-captain-${item.firestoreId}`,forceNative:true});
    });
    state.applications=incoming;
    previousCaptainApps=new Map(incoming.map(item=>[item.firestoreId,item]));captainAppsReady=true;
    state.applications.forEach(item => repairLegacyCaptainService("driverApplications", item));
    renderApplications();
    renderServiceApplications();
    renderMetrics();
  });
  const serviceApplicationsUnsubscribe = onSnapshot(collection(db, "serviceApplications"), snapshot => {
    const incoming=snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    if(serviceAppsReady)incoming.forEach(item=>{
      const old=previousServiceApps.get(item.firestoreId);
      if(changedToPending(old,item))adminNotify({title:"طلب خدمة جديد",body:`${item.businessName||item.ownerName||"مزود خدمة"} أرسل طلب تفعيل يحتاج المراجعة.`,type:"admin",route:"#servicesPanel",tag:`admin-service-${item.firestoreId}`,forceNative:true});
    });
    state.serviceApplications=incoming;
    previousServiceApps=new Map(incoming.map(item=>[item.firestoreId,item]));serviceAppsReady=true;
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
    const incoming=snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    if(ordersReady)incoming.forEach(item=>{
      const old=previousOrders.get(item.firestoreId);
      if(isNewRealtimeRecord(old,item))notifyNewOrderForAdmin(item);
    });
    state.orders = incoming;
    previousOrders=new Map(incoming.map(item=>[item.firestoreId,item]));ordersReady=true;
    renderOrders();
    renderDrivers();
    renderMetrics();
    renderCancellations();
  });
  const serviceRequestsUnsubscribe = onSnapshot(collection(db, "serviceRequests"), snapshot => {
    const incoming=snapshot.docs.map(item => ({ ...item.data(), firestoreId: item.id }));
    if(serviceRequestsReady)incoming.forEach(item=>{
      const old=previousServiceRequests.get(item.firestoreId);
      if(isNewRealtimeRecord(old,item))notifyNewServiceRequestForAdmin(item);
    });
    state.serviceRequests = incoming;
    previousServiceRequests=new Map(incoming.map(item=>[item.firestoreId,item]));serviceRequestsReady=true;
    renderOrders();
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
    const incoming=snapshot.docs.map(item=>({...item.data(),firestoreId:item.id}));
    if(topupsReady)incoming.forEach(item=>{
      const old=previousTopups.get(item.firestoreId);
      if(changedToPending(old,item))adminNotify({title:"طلب شحن رصيد جديد",body:`${item.customerName||"مستخدم كروة"} طلب شحن ${money(item.amount)}.`,type:"wallet",route:"#topupsPanel",tag:`admin-topup-${item.firestoreId}`,forceNative:true});
    });
    state.topupRequests=incoming;
    previousTopups=new Map(incoming.map(item=>[item.firestoreId,item]));topupsReady=true;
    renderTopupRequests();
    renderMetrics();
  });
  const topupLocksUnsubscribe = onSnapshot(collection(db,"topupLocks"), snapshot => {
    state.topupLocks = snapshot.docs.map(item=>({...item.data(),firestoreId:item.id}));
  });
  const walletTransactionsUnsubscribe = onSnapshot(collection(db,"walletTransactions"), snapshot => {
    state.walletTransactions = snapshot.docs.map(item=>({...item.data(),firestoreId:item.id}));
    renderFinancialReport();
  });
  const financeSettingsUnsubscribe = onSnapshot(doc(db,"appSettings","finance"), snapshot => {
    state.financeSettings = snapshot.exists() ? (snapshot.data() || {}) : {};
    renderFinancialReport();
  }, error => console.warn("تعذر تحميل إعدادات التقرير المالي", error));
  const deviceBindingsUnsubscribe = onSnapshot(collection(db,"deviceBindings"), snapshot => {
    state.deviceBindings = snapshot.docs.map(item=>({...item.data(),firestoreId:item.id}));
    renderDeviceManagement();
  });
  const deviceLinksUnsubscribe = onSnapshot(collection(db,"accountDeviceLinks"), snapshot => {
    state.deviceLinks = snapshot.docs.map(item=>({...item.data(),firestoreId:item.id}));
    renderDeviceManagement();
  });
  const deviceChangesUnsubscribe = onSnapshot(collection(db,"deviceChangeRequests"), snapshot => {
    const incoming=snapshot.docs.map(item=>({...item.data(),firestoreId:item.id}));
    if(deviceChangesReady)incoming.forEach(item=>{
      const old=previousDeviceChanges.get(item.firestoreId);
      if(changedToPending(old,item))adminNotify({title:"طلب تغيير جهاز جديد",body:`${item.accountName||"مستخدم كروة"} طلب نقل حسابه إلى جهاز جديد.`,type:"admin",route:"#deviceManagementPanel",tag:`admin-device-${item.firestoreId}`,forceNative:true});
    });
    state.deviceChangeRequests = incoming;
    previousDeviceChanges=new Map(incoming.map(item=>[item.firestoreId,item]));deviceChangesReady=true;
    renderDeviceManagement();
    renderMetrics();
  });
  const pricingUnsubscribe = subscribeGlobalPricing(settings => {
    state.pricingSettings = settings || {};
    renderPricingSettings();
    renderGovernorateSettings();
  }, error => console.warn("تعذر مزامنة التسعيرة العامة", error));
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
    topupLocksUnsubscribe,
    walletTransactionsUnsubscribe,
    financeSettingsUnsubscribe,
    deviceBindingsUnsubscribe,
    deviceLinksUnsubscribe,
    deviceChangesUnsubscribe,
    pricingUnsubscribe,
    ()=>clearInterval(topupCardsPoll),
    ()=>clearInterval(accountDirectoryPoll)
  );
}

function accountRoleLabel(role) {
  return ({ customer:"عميل", driver:"كابتن", serviceProvider:"خدمات أخرى" })[role] || "حساب";
}
function accountActivityMillis(account = {}) {
  const parsed = new Date(account.lastActivityAt || account.lastSignInAt || account.createdAt || "").getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}
function accountActivityText(account = {}) {
  const millis = accountActivityMillis(account);
  if (!millis) return "لا يوجد نشاط مسجل";
  const days = Math.max(0, Number(account.idleDays || Math.floor((Date.now() - millis) / 86400000)));
  if (days === 0) return "نشط اليوم";
  if (days === 1) return "منذ يوم";
  if (days < 30) return `منذ ${days.toLocaleString("ar-IQ")} يوم`;
  const months = Math.floor(days / 30);
  if (months === 1) return "منذ شهر";
  if (months === 2) return "منذ شهرين";
  if (months < 12) return `منذ ${months.toLocaleString("ar-IQ")} أشهر`;
  const years = Math.floor(months / 12);
  return years === 1 ? "منذ سنة" : `منذ ${years.toLocaleString("ar-IQ")} سنوات`;
}
function accountDirectoryEntry(uid) {
  return state.accountDirectory.find(account => account.id === uid) || null;
}
function accountLastActivityInline(uid) {
  const account = accountDirectoryEntry(uid);
  return account ? `<span><b>آخر نشاط:</b> ${escapeHtml(accountActivityText(account))}</span>` : `<span><b>آخر نشاط:</b> جارٍ التحقق</span>`;
}
function renderAccountDirectory() {
  const accounts = state.accountDirectory.filter(account => account.role !== "admin");
  const term = String(byId("accountDirectorySearch")?.value || "").trim().toLocaleLowerCase("ar");
  const role = byId("accountDirectoryRole")?.value || "all";
  const category = byId("accountDirectoryCategory")?.value || "all";
  const minimumIdle = Math.max(0, Number(byId("accountDirectoryIdle")?.value || 0));
  const filtered = accounts.filter(account => {
    if (role !== "all" && account.role !== role) return false;
    if (category === "driver-taxi" && (account.role !== "driver" || !String(account.serviceType || "").toLowerCase().match(/taxi|ride|تكسي/))) return false;
    if (category === "driver-delivery" && (account.role !== "driver" || !String(account.serviceType || "").toLowerCase().match(/delivery|parcel|food|توصيل/))) return false;
    if (category !== "all" && !category.startsWith("driver-") && (account.role !== "serviceProvider" || account.category !== category)) return false;
    if (minimumIdle && Number(account.idleDays || 0) < minimumIdle) return false;
    if (!term) return true;
    return [account.name, account.businessName, account.email, account.phone, account.city, account.categoryLabel, accountRoleLabel(account.role)]
      .some(value => String(value || "").toLocaleLowerCase("ar").includes(term));
  }).sort((a,b) => Number(b.idleDays || 0) - Number(a.idleDays || 0));
  const month = accounts.filter(account => Number(account.idleDays || 0) >= 30).length;
  const twoMonths = accounts.filter(account => Number(account.idleDays || 0) >= 60).length;
  if (byId("accountDirectoryTotal")) byId("accountDirectoryTotal").textContent = String(accounts.length);
  if (byId("accountDirectoryMonth")) byId("accountDirectoryMonth").textContent = String(month);
  if (byId("accountDirectoryTwoMonths")) byId("accountDirectoryTwoMonths").textContent = String(twoMonths);
  if (byId("accountDirectoryFiltered")) byId("accountDirectoryFiltered").textContent = String(filtered.length);
  if (byId("inactiveAccountsBadge")) byId("inactiveAccountsBadge").textContent = `${month} خامل`;
  if (byId("navInactiveAccountsCount")) byId("navInactiveAccountsCount").textContent = String(month);
  const host = byId("accountDirectoryList");
  if (!host) return;
  host.innerHTML = filtered.length ? filtered.map(account => {
    const idle = Number(account.idleDays || 0);
    const name = account.businessName || account.name || account.email || "حساب كروة";
    const categoryText = account.role === "serviceProvider" ? (serviceCategoryLabels[account.category] || serviceCategoryLabels.other) : account.role === "driver" ? (account.serviceTypeLabel || "كابتن") : "عميل كروة";
    const activityDate = accountActivityMillis(account) ? new Date(accountActivityMillis(account)).toLocaleString("ar-IQ") : "غير مسجل";
    const cardClass = idle >= 60 ? "is-critical" : idle >= 30 ? "is-idle" : "";
    return `<article class="account-directory-card ${cardClass}">
      <div class="account-directory-identity"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(account.email || "بدون بريد")}</small><span class="account-directory-role">${escapeHtml(accountRoleLabel(account.role))}</span></div>
      <div class="account-directory-cell"><small>الهاتف</small><b>${escapeHtml(account.phone || "—")}</b></div>
      <div class="account-directory-cell"><small>الصنف</small><b>${escapeHtml(categoryText)}</b></div>
      <div class="account-directory-cell"><small>آخر نشاط</small><b>${escapeHtml(accountActivityText(account))}</b><small>${escapeHtml(activityDate)}</small></div>
      <button class="danger" type="button" data-action="delete-account" data-id="${escapeHtml(account.id)}" data-name="${escapeHtml(name)}" data-email="${escapeHtml(account.email || "")}" data-role="${escapeHtml(account.role)}" data-category="${escapeHtml(categoryText)}">حذف نهائي</button>
    </article>`;
  }).join("") : `<div class="empty"><span>🔎</span>${state.accountDirectoryLoading ? "جاري تحميل الحسابات…" : "لا توجد حسابات مطابقة للتصفية المحددة."}</div>`;
}
async function loadAccountDirectory({quiet=false} = {}) {
  if (state.accountDirectoryLoading) return;
  state.accountDirectoryLoading = true;
  if (!quiet) {
    const host = byId("accountDirectoryList");
    if (host && !state.accountDirectory.length) host.innerHTML = `<div class="empty"><span>⏳</span>جاري قراءة آخر نشاط للحسابات…</div>`;
  }
  const refresh = byId("refreshAccountDirectory");
  if (!quiet) busy(refresh, true, "جاري التحديث…");
  try {
    const result = await karwaAdminAccountAction("list");
    state.accountDirectory = Array.isArray(result?.accounts) ? result.accounts : [];
    state.accountDirectoryLoadedAt = Date.now();
    if (byId("accountDirectoryUpdated")) byId("accountDirectoryUpdated").textContent = `آخر تحديث: ${new Date().toLocaleString("ar-IQ")} • النشاط الأحدث بين تسجيل الدخول واستخدام التطبيق`;
    renderAccountDirectory();
    renderDrivers();
    renderServiceApplications();
  } catch (error) {
    console.error("Account directory load failed", error);
    if (!quiet) toast(error?.code === "permission-denied" ? "لا تملك صلاحية قراءة سجل الحسابات" : "تعذر تحميل آخر نشاط للحسابات");
    if (byId("accountDirectoryUpdated")) byId("accountDirectoryUpdated").textContent = "تعذر تحديث الحسابات. تحقق من الاتصال ثم أعد المحاولة.";
  } finally {
    state.accountDirectoryLoading = false;
    renderAccountDirectory();
    if (!quiet) busy(refresh, false);
  }
}

let pendingAccountDeletion = null;
function openAccountDeleteModal(target) {
  pendingAccountDeletion = target;
  byId("accountDeleteName").textContent = target.name || "حساب كروة";
  byId("accountDeleteMeta").textContent = `${accountRoleLabel(target.role)}${target.category ? ` • ${target.category}` : ""}${target.email ? ` • ${target.email}` : ""}`;
  byId("accountDeletePhrase").value = "";
  byId("accountDeleteError").textContent = "";
  byId("accountDeleteModal").hidden = false;
  window.setTimeout(() => byId("accountDeletePhrase")?.focus(), 30);
}
function closeAccountDeleteModal() {
  byId("accountDeleteModal").hidden = true;
  pendingAccountDeletion = null;
  byId("accountDeleteError").textContent = "";
}
byId("accountDeleteClose")?.addEventListener("click", closeAccountDeleteModal);
byId("accountDeleteCancel")?.addEventListener("click", closeAccountDeleteModal);
byId("accountDeleteModal")?.addEventListener("click", event => { if (event.target === event.currentTarget) closeAccountDeleteModal(); });
byId("accountDeleteForm")?.addEventListener("submit", async event => {
  event.preventDefault();
  const target = pendingAccountDeletion;
  if (!target) return;
  const phrase = String(byId("accountDeletePhrase")?.value || "").trim();
  if (phrase !== "حذف نهائي") {
    byId("accountDeleteError").textContent = "اكتب عبارة «حذف نهائي» كما هي للمتابعة.";
    byId("accountDeletePhrase")?.focus();
    return;
  }
  const button = byId("accountDeleteSubmit");
  busy(button, true, "جارٍ الحذف الكامل…");
  byId("accountDeleteError").textContent = "";
  try {
    await karwaAdminAccountAction("delete", { userId: target.id, confirmation: phrase });
    state.accountDirectory = state.accountDirectory.filter(account => account.id !== target.id);
    closeAccountDeleteModal();
    renderAccountDirectory();
    toast("تم حذف الحساب نهائيًا مع بياناته وملفاته المرتبطة");
    window.setTimeout(() => loadAccountDirectory({quiet:true}).catch(()=>{}), 900);
  } catch (error) {
    console.error("Account deletion failed", error);
    const message = String(error?.message || "");
    byId("accountDeleteError").textContent = message.includes("ADMIN_SELF_DELETE_FORBIDDEN") ? "لا يمكن للمدير حذف حسابه أثناء استخدام لوحة الإدارة." : message.includes("ADMIN_ACCOUNT_DELETE_FORBIDDEN") ? "لا يمكن حذف حساب إدارة بهذه الأداة." : "تعذر إكمال الحذف. لم يتم حذف حساب المصادقة، أعد المحاولة بعد التحقق من الاتصال.";
  } finally {
    busy(button, false);
  }
});
for (const id of ["accountDirectorySearch","accountDirectoryRole","accountDirectoryCategory","accountDirectoryIdle"]) {
  byId(id)?.addEventListener(id === "accountDirectorySearch" ? "input" : "change", renderAccountDirectory);
}
byId("refreshAccountDirectory")?.addEventListener("click", () => loadAccountDirectory());

document.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button || !state.user) return;
  const id = button.dataset.id;
  busy(button, true);
  try {
    if (button.dataset.action === "delete-account") {
      openAccountDeleteModal({
        id,
        name: button.dataset.name || "حساب كروة",
        email: button.dataset.email || "",
        role: button.dataset.role || "customer",
        category: button.dataset.category || ""
      });
    } else if (button.dataset.action === "zero-wallet-balances") {
      const confirmation = prompt('هذه العملية ستجعل الرصيد المشحون والمجاني لكل العملاء والكباتن والخدمات صفرًا. اكتب "تصفير" للمتابعة:')?.trim();
      if (confirmation !== "تصفير") return toast("تم إلغاء تصفير الأرصدة");
      const targets = financeAccounts().filter(account => account.wallet.paid > 0 || account.wallet.storedBonus > 0 || account.bonusExpiresAt);
      await commitFinanceBatches(targets, (batch, account) => batch.update(doc(db, "users", account.firestoreId), {
        balance: 0,
        bonusBalance: 0,
        bonusExpiresAt: null,
        updatedAt: serverTimestamp()
      }));
      await setDoc(doc(db, "appSettings", "finance"), {
        lastBalanceResetAt: serverTimestamp(),
        lastBalanceResetBy: state.user.uid,
        lastBalanceResetByEmail: state.user.email || "",
        lastBalanceResetCount: targets.length,
        updatedAt: serverTimestamp()
      }, { merge: true });
      const resetIds = new Set(targets.map(account => account.firestoreId));
      state.users = state.users.map(user => resetIds.has(user.firestoreId) ? { ...user, balance: 0, bonusBalance: 0, bonusExpiresAt: null } : user);
      renderMetrics();
      renderDrivers();
      renderServiceApplications();
      toast(`تم تصفير أرصدة ${targets.length} حساب بنجاح`);
    } else if (button.dataset.action === "reset-finance-report") {
      const confirmation = prompt('سيبدأ التقرير المالي من هذه اللحظة مع إبقاء الطلبات القديمة محفوظة. اكتب "تصفير التقرير" للمتابعة:')?.trim();
      if (confirmation !== "تصفير التقرير") return toast("تم إلغاء تصفير التقرير");
      const resetAt = serverTimestamp();
      const localResetAt = { seconds: Math.floor(Date.now() / 1000), nanoseconds: (Date.now() % 1000) * 1000000 };
      await setDoc(doc(db, "appSettings", "finance"), {
        reportStartAt: resetAt,
        lastResetBy: state.user.uid,
        lastResetByEmail: state.user.email || "",
        updatedAt: resetAt
      }, { merge: true });
      state.financeSettings = { ...(state.financeSettings || {}), reportStartAt: localResetAt, lastResetBy: state.user.uid, lastResetByEmail: state.user.email || "" };
      renderFinancialReport();
      toast("تم تصفير التقرير المالي وبدأت فترة جديدة");
    } else if (button.dataset.action === "delete-financial-records") {
      const confirmation = prompt('سيتم حذف طلبات الشحن وسجل حركات المحفظة وأقفال الشحن نهائيًا، وبدء التقرير من جديد، من دون حذف الطلبات التشغيلية. اكتب "حذف السجلات" للمتابعة:')?.trim();
      if (confirmation !== "حذف السجلات") return toast("تم إلغاء حذف السجلات المالية");
      const records = [
        ...state.topupRequests.map(item => ({ collection: "topupRequests", id: item.firestoreId })),
        ...state.walletTransactions.map(item => ({ collection: "walletTransactions", id: item.firestoreId })),
        ...state.topupLocks.map(item => ({ collection: "topupLocks", id: item.firestoreId }))
      ].filter(item => item.id);
      await commitFinanceBatches(records, (batch, item) => batch.delete(doc(db, item.collection, item.id)));
      const deletedAt = serverTimestamp();
      const localDeletedAt = { seconds: Math.floor(Date.now() / 1000), nanoseconds: (Date.now() % 1000) * 1000000 };
      await setDoc(doc(db, "appSettings", "finance"), {
        reportStartAt: deletedAt,
        lastResetBy: state.user.uid,
        lastResetByEmail: state.user.email || "",
        lastRecordsDeletedAt: deletedAt,
        lastRecordsDeletedBy: state.user.uid,
        lastRecordsDeletedByEmail: state.user.email || "",
        lastRecordsDeletedCount: records.length,
        updatedAt: serverTimestamp()
      }, { merge: true });
      state.financeSettings = { ...(state.financeSettings || {}), reportStartAt: localDeletedAt, lastResetBy: state.user.uid, lastResetByEmail: state.user.email || "" };
      state.topupRequests = [];
      state.walletTransactions = [];
      state.topupLocks = [];
      renderTopupRequests();
      renderMetrics();
      toast(`تم حذف ${records.length} سجلًا ماليًا`);
    } else if (button.dataset.action === "approve-device-change") {
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
      const governorate = governoratesApi?.normalize(application.governorate || application.city || existingProfile?.governorate || existingProfile?.city || restaurant?.governorate || restaurant?.city) || "";
      if(!governorate)throw new Error("INVALID_GOVERNORATE");
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
        city: governorate,
        governorate,
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
          city: governorate,
          governorate,
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
    } else if (button.dataset.action === "warn-service-provider") {
      const profile = state.serviceProfiles.find(item => item.firestoreId === id || item.ownerId === id);
      if (!profile) throw new Error("SERVICE_PROFILE_NOT_FOUND");
      const note = prompt(`اكتب التنبيه الذي سيظهر لصاحب ${serviceCategoryLabels[profile.category] || "الخدمة"}:`, "يرجى الالتزام بسياسة الخدمة")?.trim();
      if (!note) return;
      await setDoc(doc(db, "serviceProfiles", id), {
        warningCount: increment(1),
        warningMessage: note.slice(0, 300),
        lastWarnedAt: serverTimestamp(),
        lastWarnedBy: state.user.uid,
        updatedAt: serverTimestamp()
      }, { merge: true });
      toast("تم إرسال التنبيه لصاحب الخدمة");
    } else if (button.dataset.action === "block-service-provider") {
      const profile = state.serviceProfiles.find(item => item.firestoreId === id || item.ownerId === id);
      if (!profile) throw new Error("SERVICE_PROFILE_NOT_FOUND");
      const reason = prompt(`اكتب سبب حظر صاحب ${serviceCategoryLabels[profile.category] || "الخدمة"}:`, "مخالفة سياسة الخدمة")?.trim();
      if (!reason) return;
      const batch = writeBatch(db);
      batch.set(doc(db, "serviceProfiles", id), {
        blocked: true,
        active: false,
        blockReason: reason.slice(0, 300),
        blockedAt: serverTimestamp(),
        blockedBy: state.user.uid,
        updatedAt: serverTimestamp()
      }, { merge: true });
      const restaurant = state.restaurants.find(item => item.firestoreId === id || item.ownerId === id);
      if (restaurant) batch.set(doc(db, "restaurants", restaurant.firestoreId), {
        blocked: true,
        active: false,
        blockReason: reason.slice(0, 300),
        blockedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });
      await batch.commit();
      toast("تم حظر صاحب الخدمة وإخفاء نشاطه وإيقاف استقبال الطلبات");
    } else if (button.dataset.action === "unblock-service-provider") {
      if (!confirm("هل تريد رفع الحظر؟ سيبقى النشاط غير منشور حتى يفعّله صاحبه من جديد.")) return;
      const batch = writeBatch(db);
      batch.set(doc(db, "serviceProfiles", id), {
        blocked: false,
        active: false,
        blockReason: "",
        unblockedAt: serverTimestamp(),
        unblockedBy: state.user.uid,
        updatedAt: serverTimestamp()
      }, { merge: true });
      const restaurant = state.restaurants.find(item => item.firestoreId === id || item.ownerId === id);
      if (restaurant) batch.set(doc(db, "restaurants", restaurant.firestoreId), {
        blocked: false,
        active: false,
        blockReason: "",
        unblockedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });
      await batch.commit();
      toast("تم رفع الحظر. يستطيع صاحب الخدمة نشر نشاطه من جديد.");
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
      const city = governoratesApi?.normalize(application.governorate || application.city) || "";
      if(!city)throw new Error("INVALID_GOVERNORATE");
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
        vehicleCondition: String(application.vehicleCondition || "").trim(), plate, city, governorate: city,
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
