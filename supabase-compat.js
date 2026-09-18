import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm";

const SUPABASE_URL = "https://ndrcopijnkbpfrxzafzk.supabase.co";
const SUPABASE_KEY = "sb_publishable_7dMKIHQUj-C1GwQVXkU5oA_2zhc_IoS";
const browserFetch = globalThis.fetch.bind(globalThis);
const nativeSupabasePending = new Map();
let nativeSupabaseRequestCounter = 0;

function nativeSupabaseBridgeAvailable() {
  try { return typeof window !== "undefined" && typeof window.KarwaNative?.supabaseRequest === "function"; }
  catch (_) { return false; }
}

function nativeSupabaseHeaders(inputHeaders, initHeaders) {
  const headers = new Headers(inputHeaders || undefined);
  new Headers(initHeaders || undefined).forEach((value, key) => headers.set(key, value));
  const out = {};
  headers.forEach((value, key) => { out[key] = value; });
  return out;
}

function nativeSupabaseBody(body) {
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  return null;
}

function shouldUseNativeSupabase(url) {
  if (!nativeSupabaseBridgeAvailable()) return false;
  try {
    const parsed = new URL(String(url));
    if (parsed.origin !== SUPABASE_URL) return false;
    return parsed.pathname.startsWith("/auth/v1/") || parsed.pathname === "/functions/v1/public-signup";
  } catch (_) { return false; }
}

globalThis.__karwaNativeSupabaseResolve = (requestId, responseJson) => {
  const pending = nativeSupabasePending.get(String(requestId || ""));
  if (!pending) return;
  nativeSupabasePending.delete(String(requestId || ""));
  clearTimeout(pending.timer);
  try {
    pending.resolve(JSON.parse(String(responseJson || "{}")));
  } catch (error) {
    pending.reject(error);
  }
};

async function karwaSupabaseFetch(input, init = {}) {
  const url = typeof input === "string" || input instanceof URL ? String(input) : String(input?.url || "");
  if (!shouldUseNativeSupabase(url)) return browserFetch(input, init);

  const method = String(init?.method || input?.method || "GET").toUpperCase();
  const body = nativeSupabaseBody(init?.body);
  if (body === null) return browserFetch(input, init);
  const headers = nativeSupabaseHeaders(input?.headers, init?.headers);
  const requestId = `ks${Date.now().toString(36)}${(++nativeSupabaseRequestCounter).toString(36)}`;

  const nativeResult = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      nativeSupabasePending.delete(requestId);
      const error = new Error("NATIVE_SUPABASE_TIMEOUT");
      error.code = "auth/network-request-failed";
      reject(error);
    }, 18000);
    nativeSupabasePending.set(requestId, { resolve, reject, timer });
    try {
      window.KarwaNative.supabaseRequest(requestId, url, method, JSON.stringify(headers), body);
    } catch (error) {
      clearTimeout(timer);
      nativeSupabasePending.delete(requestId);
      reject(error);
    }
  });

  if (Number(nativeResult?.status || 0) <= 0) {
    const error = new TypeError(String(nativeResult?.error || "Native Supabase network request failed"));
    error.code = "auth/network-request-failed";
    throw error;
  }
  return new Response(String(nativeResult?.body || ""), {
    status: Number(nativeResult.status),
    headers: nativeResult?.headers || { "content-type": "application/json" }
  });
}

const client = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  global: { fetch: karwaSupabaseFetch }
});

const nowTs = () => {
  const ms = Date.now();
  return { seconds: Math.floor(ms / 1000), nanoseconds: (ms % 1000) * 1000000 };
};
const isObject = v => v && typeof v === "object" && !Array.isArray(v);
const cloneJson = v => v == null ? v : JSON.parse(JSON.stringify(v));
const autoId = () => globalThis.crypto?.randomUUID?.().replaceAll("-", "") || `${Date.now().toString(36)}${Math.random().toString(36).slice(2,18)}`;

function firebaseLikeError(error, fallback = "unknown") {
  if (error?.code && String(error.code).includes("/")) return error;
  const message = String(error?.message || error || "Unknown error");
  const upper = message.toUpperCase();
  let code = fallback;
  if (upper.includes("PERMISSION") || upper.includes("ROW-LEVEL") || upper.includes("RLS")) code = "permission-denied";
  else if (upper.includes("TOPUP_PENDING") || upper.includes("UQ_KARWA_DOCUMENTS_ONE_PENDING_TOPUP") || upper.includes("UQ_TOPUP_REQUESTS_ONE_PENDING")) code = "failed-precondition";
  else if (upper.includes("DUPLICATE KEY") || upper.includes("UNIQUE CONSTRAINT")) code = "already-exists";
  else if (upper.includes("NOT_FOUND") || upper.includes("0 ROWS")) code = "not-found";
  else if (upper.includes("ABORTED") || upper.includes("CONFLICT")) code = "aborted";
  else if (upper.includes("NETWORK") || upper.includes("FETCH")) code = "unavailable";
  const e = new Error(message);
  e.code = code;
  e.details = error;
  return e;
}

function authError(error) {
  const msg = String(error?.message || error || "Auth error");
  const low = msg.toLowerCase();
  let code = "auth/unknown";
  if (low.includes("network") || low.includes("fetch") || low.includes("timeout") || low.includes("native_supabase")) code = "auth/network-request-failed";
  else if (low.includes("invalid login") || low.includes("invalid credentials")) code = "auth/invalid-credential";
  else if (low.includes("already") || low.includes("registered")) code = "auth/email-already-in-use";
  else if (low.includes("password") && low.includes("least")) code = "auth/weak-password";
  else if (low.includes("phone") || low.includes("invalid_phone")) code = "auth/invalid-phone";
  else if (low.includes("email")) code = "auth/invalid-email";
  const e = new Error(msg);
  e.code = code;
  return e;
}

function mapUser(user) {
  if (!user) return null;
  return {
    uid: user.id,
    email: user.email || "",
    displayName: user.user_metadata?.display_name || user.user_metadata?.name || "",
    emailVerified: Boolean(user.email_confirmed_at),
    metadata: user.user_metadata || {},
    _raw: user
  };
}

const auth = {
  currentUser: null,
  _ready: false
};
client.auth.getSession().then(({ data }) => {
  auth.currentUser = mapUser(data?.session?.user || null);
  auth._ready = true;
}).catch(() => { auth._ready = true; });
client.auth.onAuthStateChange((_event, session) => {
  auth.currentUser = mapUser(session?.user || null);
  auth._ready = true;
});


function normalizedSignupPhone(value) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return "";
  return raw.startsWith("+") ? `+${digits}` : digits;
}

function signupPhoneFromPage() {
  for (const id of ["authPhone", "driverPhone", "registerPhone"]) {
    const value = document.getElementById(id)?.value;
    const phone = normalizedSignupPhone(value);
    if (phone) return phone;
  }
  return "";
}

function ensureCustomerSignupPhoneField() {
  const install = () => {
    const form = document.getElementById("authForm");
    const email = document.getElementById("authEmail")?.closest?.(".field");
    if (!form || !email || document.getElementById("authPhone") || document.getElementById("driverPhone") || document.getElementById("registerPhone")) return;

    const field = document.createElement("div");
    field.className = "field";
    field.id = "phoneField";
    field.hidden = true;
    field.innerHTML = '<label for="authPhone">رقم الهاتف</label><input id="authPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="مثال: 07501234567">';
    email.before(field);

    const input = field.querySelector("#authPhone");
    const submit = document.getElementById("authSubmit");
    const sync = () => {
      const registering = String(submit?.textContent || "").includes("إنشاء");
      field.hidden = !registering;
      if (input) input.required = registering;
    };
    sync();
    if (submit && globalThis.MutationObserver) {
      new MutationObserver(sync).observe(submit, { childList: true, subtree: true, characterData: true });
    }
    form.addEventListener("submit", event => {
      if (field.hidden) return;
      if (!normalizedSignupPhone(input?.value)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const message = document.getElementById("authMessage");
        if (message) message.textContent = "أدخل رقم هاتف صحيحًا من 8 إلى 15 رقمًا.";
        input?.focus?.();
      }
    }, true);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
}

ensureCustomerSignupPhoneField();

export const browserLocalPersistence = { type: "local" };
export function initializeApp(_config = {}, name = "[DEFAULT]") { return { name, backend: "supabase" }; }
export function getAuth() { return auth; }
export async function setPersistence() { return true; }
export function onAuthStateChanged(_auth, callback, errorCallback) {
  let active = true;

  // Supabase warns that running async API calls directly inside
  // onAuthStateChange can deadlock the client. Always dispatch the app
  // callback on a later task so sign-in/sign-out can finish first.
  const dispatch = user => {
    window.setTimeout(() => {
      if (!active) return;
      Promise.resolve()
        .then(() => callback(user))
        .catch(error => {
          const mapped = authError(error);
          if (errorCallback) errorCallback(mapped);
          else console.error("Auth state callback failed", mapped);
        });
    }, 0);
  };

  (async () => {
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      auth.currentUser = mapUser(data?.session?.user || null);
      auth._ready = true;
      dispatch(auth.currentUser);
    } catch (error) {
      if (active) errorCallback?.(authError(error));
    }
  })();

  const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
    auth.currentUser = mapUser(session?.user || null);
    auth._ready = true;
    dispatch(auth.currentUser);
  });
  return () => { active = false; listener?.subscription?.unsubscribe?.(); };
}
export async function signInWithEmailAndPassword(_auth, email, password) {
  const { data, error } = await client.auth.signInWithPassword({ email: String(email || "").trim(), password: String(password || "") });
  if (error) throw authError(error);
  auth.currentUser = mapUser(data.user);
  return { user: auth.currentUser };
}
export async function createUserWithEmailAndPassword(_auth, email, password) {
  let phone = signupPhoneFromPage();
  if (!phone && typeof globalThis.prompt === "function") {
    phone = normalizedSignupPhone(globalThis.prompt("أدخل رقم الهاتف لإنشاء حساب كروة:", "") || "");
  }
  if (!phone) {
    const e = new Error("INVALID_PHONE");
    e.code = "auth/invalid-phone";
    throw e;
  }
  try {
    const response = await karwaSupabaseFetch(`${SUPABASE_URL}/functions/v1/public-signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
      body: JSON.stringify({ email: String(email || "").trim(), password: String(password || ""), phone })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || `SIGNUP_${response.status}`);
  } catch (error) {
    throw authError(error);
  }
  const credential = await signInWithEmailAndPassword(_auth, email, password);
  const { error: phoneError } = await client.rpc("karwa_set_own_phone", { p_phone: phone });
  if (phoneError) {
    try {
      const { data: sessionData } = await client.auth.getSession();
      const token = sessionData?.session?.access_token;
      await client.functions.invoke("delete-self", {
        body: {},
        headers: token ? { Authorization: `Bearer ${token}` } : undefined
      });
    } catch (_) {}
    await client.auth.signOut().catch(() => {});
    auth.currentUser = null;
    throw authError(phoneError);
  }
  await client.auth.updateUser({ data: { phone } }).catch(() => {});
  return credential;
}
export async function updateProfile(user, values = {}) {
  const dataPatch = {};
  if (Object.prototype.hasOwnProperty.call(values, "displayName")) dataPatch.display_name = String(values.displayName || "");
  const { data, error } = await client.auth.updateUser({ data: dataPatch });
  if (error) throw authError(error);
  auth.currentUser = mapUser(data.user);
  if (user) Object.assign(user, auth.currentUser);
  return true;
}
export async function signOut() {
  const { error } = await client.auth.signOut();
  if (error) throw authError(error);
  auth.currentUser = null;
}
export async function deleteUser() {
  const { data: sessionData } = await client.auth.getSession();
  const token = sessionData?.session?.access_token;
  const { data, error } = await client.functions.invoke("delete-self", {
    body: {},
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  });
  if (error || data?.error) throw authError(error || data.error);
  await client.auth.signOut().catch(() => {});
  auth.currentUser = null;
}

export function getFirestore() { return { backend: "supabase", client }; }
export function getSupabase() { return getFirestore(); }

function refPath(parts) { return parts.map(v => String(v ?? "").replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/"); }
export function collection(base, ...segments) {
  const prefix = base?.type === "document" || base?.type === "collection" ? base.path : "";
  const path = refPath([prefix, ...segments]);
  return { type: "collection", path, id: path.split("/").pop() || "", db: base?.db || base };
}
export function doc(base, ...segments) {
  if (base?.type === "collection") {
    const id = segments.length ? String(segments[0]) : autoId();
    const path = refPath([base.path, id, ...segments.slice(1)]);
    return { type: "document", path, id: path.split("/").pop(), db: base.db };
  }
  const path = refPath(segments);
  return { type: "document", path, id: path.split("/").pop() || "", db: base };
}
export function where(field, op, value) { return { type: "where", field: String(field), op: String(op), value }; }
export function query(collectionRef, ...constraints) { return { type: "query", collection: collectionRef, constraints }; }
export function serverTimestamp() { return { __karwaTransform: "serverTimestamp" }; }
export function increment(by = 1) { return { __karwaTransform: "increment", by: Number(by || 0) }; }
export function arrayUnion(...values) { return { __karwaTransform: "arrayUnion", values }; }

function getField(obj, path) {
  return String(path || "").split(".").reduce((acc, key) => acc == null ? undefined : acc[key], obj);
}
function setField(obj, path, value) {
  const keys = String(path || "").split(".");
  let cursor = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!isObject(cursor[key])) cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[keys[keys.length - 1]] = value;
}
function sameValue(a,b) { try { return JSON.stringify(a) === JSON.stringify(b); } catch { return a === b; } }
function resolveValue(value, baseValue) {
  if (isObject(value) && value.__karwaTransform === "serverTimestamp") return nowTs();
  if (isObject(value) && value.__karwaTransform === "increment") return Number(baseValue || 0) + Number(value.by || 0);
  if (isObject(value) && value.__karwaTransform === "arrayUnion") {
    const out = Array.isArray(baseValue) ? [...baseValue] : [];
    for (const v of value.values || []) if (!out.some(x => sameValue(x, v))) out.push(resolveValue(v, undefined));
    return out;
  }
  if (Array.isArray(value)) return value.map((v,i) => resolveValue(v, Array.isArray(baseValue) ? baseValue[i] : undefined));
  if (value instanceof Date) return { seconds: Math.floor(value.getTime()/1000), nanoseconds: (value.getTime()%1000)*1000000 };
  if (isObject(value)) {
    const out = {};
    for (const [k,v] of Object.entries(value)) out[k] = resolveValue(v, isObject(baseValue) || Array.isArray(baseValue) ? baseValue?.[k] : undefined);
    return out;
  }
  return value;
}
function applyPatch(base, patch) {
  const out = isObject(base) ? cloneJson(base) : {};
  for (const [key, value] of Object.entries(patch || {})) {
    const current = getField(out, key);
    setField(out, key, resolveValue(value, current));
  }
  return out;
}
function hydrateValue(value) {
  if (Array.isArray(value)) return value.map(hydrateValue);
  if (isObject(value)) {
    if (Number.isFinite(value.seconds) && Number.isFinite(value.nanoseconds ?? 0) && Object.keys(value).every(k => ["seconds","nanoseconds"].includes(k))) {
      const seconds = Number(value.seconds), nanoseconds = Number(value.nanoseconds || 0);
      return { seconds, nanoseconds, toDate: () => new Date(seconds * 1000 + Math.floor(nanoseconds / 1e6)) };
    }
    const out = {};
    for (const [k,v] of Object.entries(value)) out[k] = hydrateValue(v);
    return out;
  }
  return value;
}

class DocSnapshot {
  constructor(ref, row) { this.ref = ref; this.id = ref.id; this._row = row || null; this.version = row?.version ?? null; }
  exists() { return Boolean(this._row); }
  data() { return this._row ? hydrateValue(cloneJson(this._row.data || {})) : undefined; }
}
class QuerySnapshot {
  constructor(docs) { this.docs = docs; this.size = docs.length; this.empty = docs.length === 0; }
  forEach(cb) { this.docs.forEach(cb); }
}
async function fetchRow(ref) {
  const { data, error } = await client.from("karwa_documents").select("path,data,version").eq("path", ref.path).maybeSingle();
  if (error) throw firebaseLikeError(error);
  return data || null;
}
export async function getDoc(ref) { return new DocSnapshot(ref, await fetchRow(ref)); }

function matchConstraint(data, c) {
  const actual = getField(data, c.field);
  if (c.op === "==") return sameValue(actual, c.value);
  if (c.op === "in") return Array.isArray(c.value) && c.value.some(v => sameValue(actual, v));
  if (c.op === "!=") return !sameValue(actual, c.value);
  if (c.op === ">") return actual > c.value;
  if (c.op === ">=") return actual >= c.value;
  if (c.op === "<") return actual < c.value;
  if (c.op === "<=") return actual <= c.value;
  return true;
}
async function fetchCollection(target) {
  const col = target?.type === "query" ? target.collection : target;
  const constraints = target?.type === "query" ? target.constraints.filter(c => c?.type === "where") : [];
  const { data, error } = await client.from("karwa_documents").select("path,data,version,doc_id").eq("parent_path", col.path);
  if (error) throw firebaseLikeError(error);
  return (data || []).filter(row => constraints.every(c => matchConstraint(row.data || {}, c))).map(row => {
    const ref = { type: "document", path: row.path, id: row.doc_id || row.path.split("/").pop(), db: col.db };
    return new DocSnapshot(ref, row);
  });
}

async function prepareOp(kind, ref, data, options = {}, knownRow = undefined, expectedVersion = undefined) {
  let row = knownRow;
  if (row === undefined && (kind !== "delete" || expectedVersion !== undefined)) row = await fetchRow(ref);
  const base = row?.data || {};
  let resolved = null;
  if (kind === "set") resolved = options?.merge ? applyPatch(base, data) : resolveValue(data, base);
  if (kind === "update") resolved = applyPatch(base, data);
  const op = { kind, path: ref.path };
  if (resolved !== null) op.data = resolved;
  if (kind === "set") op.merge = false;
  const version = expectedVersion !== undefined ? expectedVersion : undefined;
  if (version !== undefined && version !== null) op.expectedVersion = version;
  return op;
}
async function commitOps(ops) {
  const { error } = await client.rpc("karwa_apply_document_ops", { ops });
  if (error) throw firebaseLikeError(error);
}
export async function setDoc(ref, data, options = {}) {
  const row = options?.merge ? await fetchRow(ref) : undefined;
  const op = await prepareOp("set", ref, data, options, row);
  await commitOps([op]);
}
export async function updateDoc(ref, data) {
  const row = await fetchRow(ref);
  if (!row) throw firebaseLikeError(new Error("NOT_FOUND"), "not-found");
  const op = await prepareOp("update", ref, data, {}, row, row.version);
  await commitOps([op]);
}
export async function addDoc(collectionRef, data) {
  const ref = doc(collectionRef);
  await setDoc(ref, data);
  return ref;
}

export function writeBatch() {
  const pending = [];
  return {
    set(ref, data, options = {}) { pending.push({ kind: "set", ref, data, options }); return this; },
    update(ref, data) { pending.push({ kind: "update", ref, data, options: {} }); return this; },
    delete(ref) { pending.push({ kind: "delete", ref, data: null, options: {} }); return this; },
    async commit() {
      const ops = [];
      for (const item of pending) {
        const row = item.kind === "delete" ? undefined : await fetchRow(item.ref);
        if (item.kind === "update" && !row) throw firebaseLikeError(new Error("NOT_FOUND"), "not-found");
        ops.push(await prepareOp(item.kind, item.ref, item.data, item.options, row, item.kind === "update" ? row?.version : undefined));
      }
      await commitOps(ops);
    }
  };
}

export async function runTransaction(_db, updateFunction, options = {}) {
  const attempts = Math.max(1, Number(options.maxAttempts || 3));
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const reads = new Map();
    const pending = [];
    const tx = {
      async get(ref) {
        const row = await fetchRow(ref);
        reads.set(ref.path, row);
        return new DocSnapshot(ref, row);
      },
      set(ref, data, opts = {}) { pending.push({ kind: "set", ref, data, options: opts }); return tx; },
      update(ref, data) { pending.push({ kind: "update", ref, data, options: {} }); return tx; },
      delete(ref) { pending.push({ kind: "delete", ref, data: null, options: {} }); return tx; }
    };
    try {
      const result = await updateFunction(tx);
      const ops = [];
      const expectedUsed = new Set();
      for (const item of pending) {
        let row = reads.has(item.ref.path) ? reads.get(item.ref.path) : undefined;
        if (row === undefined && item.kind !== "delete") row = await fetchRow(item.ref);
        if (item.kind === "update" && !row) throw firebaseLikeError(new Error("NOT_FOUND"), "not-found");
        let expected;
        if (reads.has(item.ref.path) && !expectedUsed.has(item.ref.path)) {
          expected = row?.version ?? null;
          expectedUsed.add(item.ref.path);
        }
        ops.push(await prepareOp(item.kind, item.ref, item.data, item.options, row, expected));
      }
      await commitOps(ops);
      return result;
    } catch (error) {
      lastError = firebaseLikeError(error);
      if (lastError.code !== "aborted" || attempt === attempts - 1) throw lastError;
      await new Promise(r => setTimeout(r, 30 + attempt * 40));
    }
  }
  throw lastError;
}

export function onSnapshot(target, next, errorCallback) {
  let active = true;
  let timer = null;
  const isDoc = target?.type === "document";
  const refTarget = target?.type === "query" ? target.collection : target;
  const emit = async () => {
    if (!active) return;
    try {
      if (isDoc) next(new DocSnapshot(target, await fetchRow(target)));
      else next(new QuerySnapshot(await fetchCollection(target)));
    } catch (error) {
      if (active) errorCallback?.(firebaseLikeError(error));
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(emit, 25);
  };
  emit();
  const filter = isDoc ? `path=eq.${target.path}` : `parent_path=eq.${refTarget.path}`;
  const channel = client.channel(`karwa:${Math.random().toString(36).slice(2)}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "karwa_documents", filter }, schedule)
    .subscribe(status => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") errorCallback?.(firebaseLikeError(new Error(`Realtime ${status}`), "unavailable"));
    });
  return () => {
    active = false;
    clearTimeout(timer);
    client.removeChannel(channel).catch?.(() => {});
  };
}


// Pricing is global for the whole Karwa system. Realtime is the fast path,
// while polling/focus refresh is a deliberate fallback for Android WebView or
// temporarily disconnected Realtime sockets so every signed-in user converges
// on the same price configuration without needing to sign out or reload.
export function subscribeGlobalPricing(next, errorCallback, options = {}) {
  let active = true;
  let lastSignature = "";
  let pollTimer = null;
  let channel = null;
  const pollMs = Math.max(5000, Number(options.pollMs || 12000));

  const deliver = value => {
    if (!active) return;
    const data = isObject(value) ? hydrateValue(value) : {};
    let signature = "";
    try { signature = JSON.stringify(data); } catch (_) { signature = String(Date.now()); }
    if (signature === lastSignature) return;
    lastSignature = signature;
    next?.(cloneJson(data));
  };

  const refresh = async () => {
    if (!active) return;
    try {
      const { data, error } = await client
        .from("karwa_documents")
        .select("data,version,updated_at")
        .eq("path", "appSettings/pricing")
        .maybeSingle();
      if (error) throw error;
      deliver(data?.data || {});
    } catch (error) {
      if (active) errorCallback?.(firebaseLikeError(error));
    }
  };

  const scheduleRefresh = () => {
    if (!active) return;
    globalThis.setTimeout(refresh, 20);
  };

  refresh();
  channel = client.channel(`karwa:global-pricing:${Math.random().toString(36).slice(2)}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "karwa_documents", filter: "path=eq.appSettings/pricing" }, payload => {
      if (payload?.new?.data) deliver(payload.new.data);
      else scheduleRefresh();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "app_settings", filter: "key=eq.pricing" }, payload => {
      if (payload?.new?.value) deliver(payload.new.value);
      else scheduleRefresh();
    })
    .subscribe(status => {
      if ((status === "CHANNEL_ERROR" || status === "TIMED_OUT") && active) {
        errorCallback?.(firebaseLikeError(new Error(`Pricing Realtime ${status}`), "unavailable"));
      }
    });

  pollTimer = globalThis.setInterval(refresh, pollMs);
  const onWake = () => { if (!globalThis.document || document.visibilityState !== "hidden") refresh(); };
  globalThis.addEventListener?.("focus", onWake);
  globalThis.addEventListener?.("online", onWake);
  globalThis.document?.addEventListener?.("visibilitychange", onWake);

  return () => {
    active = false;
    if (pollTimer) globalThis.clearInterval(pollTimer);
    globalThis.removeEventListener?.("focus", onWake);
    globalThis.removeEventListener?.("online", onWake);
    globalThis.document?.removeEventListener?.("visibilitychange", onWake);
    if (channel) client.removeChannel(channel).catch?.(() => {});
  };
}

async function karwaRpc(name, args = {}) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw firebaseLikeError(error);
  return hydrateValue(data);
}
export async function karwaSensitiveAction(action, payload = {}) {
  return karwaRpc("karwa_sensitive_action", { p_action: String(action || ""), p_payload: resolveValue(payload, undefined) || {} });
}
export async function karwaSensitiveAux(action, payload = {}) {
  return karwaRpc("karwa_sensitive_aux", { p_action: String(action || ""), p_payload: resolveValue(payload, undefined) || {} });
}
export async function karwaDriverAutoComplete(orderId) { return karwaRpc("karwa_driver_auto_complete_order", { p_order_id: String(orderId || "") }); }
export async function karwaProviderCancelRequest(requestId, reason) { return karwaRpc("karwa_provider_cancel_request", { p_request_id: String(requestId || ""), p_reason: String(reason || "") }); }
export async function karwaProviderBackfillPickupOtp(requestId) { return karwaRpc("karwa_provider_backfill_pickup_otp", { p_request_id: String(requestId || "") }); }
export async function karwaCustomerCancelOrder(orderId, reason) { return karwaRpc("karwa_customer_cancel_order", { p_order_id: String(orderId || ""), p_reason: String(reason || "") }); }
export async function karwaCustomerCancelServiceRequest(requestId, reason) { return karwaRpc("karwa_customer_cancel_service_request", { p_request_id: String(requestId || ""), p_reason: String(reason || "") }); }

export function getStorage() { return { backend: "supabase-storage" }; }
function parseStoragePath(path) {
  const clean = String(path || "").replace(/^\/+/, "");
  const [first, ...rest] = clean.split("/");
  if (["service-assets", "driver-documents"].includes(first)) return { bucket: first, objectPath: rest.join("/"), fullPath: clean };
  return { bucket: "service-assets", objectPath: clean, fullPath: `service-assets/${clean}` };
}
export function ref(_storage, path) {
  const parsed = parseStoragePath(path);
  return { type: "storage", ...parsed, name: parsed.objectPath.split("/").pop() || "" };
}
export async function uploadBytes(storageReference, blob, metadata = {}) {
  const options = { upsert: false, contentType: metadata.contentType || blob?.type || undefined, cacheControl: metadata.cacheControl || undefined };
  const { data, error } = await client.storage.from(storageReference.bucket).upload(storageReference.objectPath, blob, options);
  if (error) throw firebaseLikeError(error);
  return { ref: storageReference, metadata: { ...metadata, fullPath: storageReference.fullPath, size: blob?.size || 0 }, data };
}
export async function getDownloadURL(storageReference) {
  const { data } = client.storage.from(storageReference.bucket).getPublicUrl(storageReference.objectPath);
  return data?.publicUrl || "";
}
export async function deleteObject(storageReference) {
  const { error } = await client.storage.from(storageReference.bucket).remove([storageReference.objectPath]);
  if (error) throw firebaseLikeError(error);
}

export const __karwaSupabase = client;
