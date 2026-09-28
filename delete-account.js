import { initializeApp, getAuth, onAuthStateChanged, signInWithEmailAndPassword, getSupabase, collection, doc, setDoc, serverTimestamp } from "./supabase-compat.js?v=120";

const app = initializeApp({ backend: "supabase", project: "karwa" }, "masar-account-deletion");
const auth = getAuth(app);
const db = getSupabase(app);
const byId = id => document.getElementById(id);
const form = byId("requestForm");
let currentUser = null;
onAuthStateChanged(auth, user => {
  currentUser = user;
  byId("signInFields").hidden = !!user;
  byId("email").required = !user;
  byId("password").required = !user;
  byId("signedIn").hidden = !user;
  byId("signedIn").textContent = user ? `الحساب الجاري: ${user.email || user.uid}` : "";
});
form.addEventListener("submit", async event => {
  event.preventDefault();
  const button = byId("submitButton"), message = byId("message");
  button.disabled = true; message.textContent = "جارٍ إرسال الطلب…"; message.classList.remove("ok");
  try {
    const user = currentUser || (await signInWithEmailAndPassword(auth, byId("email").value.trim(), byId("password").value)).user;
    if (!user?.uid) throw new Error("تعذر التحقق من الحساب.");
    await setDoc(doc(collection(db, "supportTickets")), {
      userId: user.uid,
      category: "طلب حذف الحساب والبيانات",
      message: `طلب حذف الحساب والبيانات المرتبطة به. ${byId("reason").value.trim()}`.trim(),
      status: "open", createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    message.textContent = "تم استلام طلب الحذف في مركز الدعم. احتفظ بإمكانية الدخول حتى تراجع الإدارة الطلب.";
    message.classList.add("ok");
    form.reset();
  } catch (error) {
    console.error("Account deletion request", error);
    message.textContent = "تعذر إرسال الطلب. تحقق من تسجيل الدخول والاتصال ثم حاول مجددًا.";
  } finally { button.disabled = false; }
});
