(function () {
  "use strict";
  const storageKey = "masar.firstRun.completed.v1";
  let completed = false;
  try { completed = localStorage.getItem(storageKey) === "1"; } catch (_) {
    try { completed = sessionStorage.getItem(storageKey) === "1"; } catch (_) {}
  }
  if (completed) {
    document.documentElement.classList.remove("masar-intro-candidate");
    window.MasarFirstRun = { setAuthenticated() {} };
    return;
  }

  let overlay;
  let resolved = false;
  let visible = false;
  let fallbackTimer;
  const markup = `
    <div class="masar-intro-shell">
      <div class="masar-intro-content">
        <div class="masar-intro-brand"><span class="masar-intro-mark" aria-hidden="true">م</span><span>مَسار</span></div>
        <section class="masar-intro-home" id="masarIntroHome" aria-labelledby="masarIntroTitle">
          <span class="masar-intro-kicker">مسارك يبدأ من هنا</span>
          <h1 id="masarIntroTitle">كل مشوار له بداية أسهل.</h1>
          <p>رحلات، توصيل وخدمات قريبة منك في تجربة واحدة واضحة. اختر نوع حسابك وابدأ بخطوات بسيطة.</p>
          <div class="masar-intro-actions">
            <button type="button" class="masar-intro-primary" id="masarIntroStart">بدء البرنامج <span aria-hidden="true">←</span></button>
            <button type="button" class="masar-intro-secondary" id="masarIntroInstructions" aria-controls="masarIntroGuide" aria-expanded="false">تعليمات الاستخدام</button>
          </div>
          <a class="masar-intro-privacy" href="./privacy.html?return=index.html">سياسة الخصوصية</a>
        </section>
        <section class="masar-intro-guide" id="masarIntroGuide" aria-labelledby="masarIntroGuideTitle" hidden>
          <span class="masar-intro-kicker">دليلك السريع</span>
          <h2 id="masarIntroGuideTitle">كيف تستخدم مَسار؟</h2>
          <p>اختر البوابة المناسبة لك، ثم أنشئ حسابًا أو سجّل الدخول للمتابعة.</p>
          <ol class="masar-guide-list">
            <li><b>١</b><span><strong>للعميل</strong>حدد موقعك وخدمتك، أرسل الطلب وتابع حالته. لا تحتاج إلى شحن أو اشتراك.</span></li>
            <li><b>٢</b><span><strong>للكابتن</strong>أكمل بياناتك، ثم شاهد الطلبات القريبة. قبول الطلبات يتطلب تفعيل الاشتراك.</span></li>
            <li><b>٣</b><span><strong>لمزود الخدمة</strong>سجّل نشاطك وأدر خدماتك. قبول الطلبات يتطلب اعتماد الحساب وتفعيل الاشتراك.</span></li>
          </ol>
          <div class="masar-intro-actions">
            <button type="button" class="masar-intro-primary" id="masarGuideStart">بدء البرنامج <span aria-hidden="true">←</span></button>
            <button type="button" class="masar-intro-secondary" id="masarGuideBack">العودة إلى الترحيب</button>
          </div>
        </section>
      </div>
      <div class="masar-intro-art" aria-hidden="true">
        <svg class="masar-route-graphic" viewBox="0 0 440 440" xmlns="http://www.w3.org/2000/svg">
          <circle cx="220" cy="220" r="164" fill="none" stroke="rgba(154,235,227,.12)" stroke-width="1"/>
          <circle cx="220" cy="220" r="113" fill="none" stroke="rgba(154,235,227,.12)" stroke-width="1"/>
          <path d="M55 270h85m32-183v55m190 76h54M289 326v50M76 130l42 29m215-49 35-22M72 354l60-24" fill="none" stroke="rgba(154,235,227,.19)" stroke-width="3" stroke-linecap="round"/>
          <path class="masar-route-base" d="M100 317C143 312 144 243 189 243S222 287 260 258C301 228 274 151 344 125"/>
          <path class="masar-route-line" d="M100 317C143 312 144 243 189 243S222 287 260 258C301 228 274 151 344 125"/>
          <circle class="masar-route-ring" cx="100" cy="317" r="16"/><circle class="masar-route-dot" cx="100" cy="317" r="5"/>
          <circle class="masar-route-ring" cx="344" cy="125" r="16"/><circle class="masar-route-dot" cx="344" cy="125" r="5"/>
          <rect x="196" y="179" width="52" height="52" rx="16" fill="#092e41" stroke="rgba(166,243,227,.55)" stroke-width="2"/>
          <text x="222" y="213" fill="#baf6e9" font-family="Tahoma,Arial,sans-serif" font-size="26" font-weight="bold" text-anchor="middle">م</text>
        </svg>
        <span class="masar-intro-art-label">وجهتك أقرب مع مَسار</span>
      </div>
    </div>`;

  function ensureOverlay() {
    if (overlay || !document.body) return;
    overlay = document.createElement("div");
    overlay.className = "masar-first-run";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "masarIntroTitle");
    overlay.hidden = true;
    overlay.innerHTML = markup;
    const page = location.pathname.split("/").pop();
    const returnPage = page === "driver.html" || page === "services.html" ? page : "index.html";
    overlay.querySelector(".masar-intro-privacy").href = `./privacy.html?return=${returnPage}`;
    document.body.appendChild(overlay);
    const home = overlay.querySelector("#masarIntroHome");
    const guide = overlay.querySelector("#masarIntroGuide");
    const guideButton = overlay.querySelector("#masarIntroInstructions");
    function setGuide(open) {
      home.hidden = open;
      guide.hidden = !open;
      overlay.setAttribute("aria-labelledby", open ? "masarIntroGuideTitle" : "masarIntroTitle");
      guideButton.setAttribute("aria-expanded", String(open));
      overlay.querySelector(open ? "#masarGuideStart" : "#masarIntroStart").focus({ preventScroll: true });
    }
    guideButton.addEventListener("click", () => setGuide(true));
    overlay.querySelector("#masarGuideBack").addEventListener("click", () => setGuide(false));
    ["#masarIntroStart", "#masarGuideStart"].forEach(selector => overlay.querySelector(selector).addEventListener("click", finish));
    overlay.addEventListener("keydown", event => {
      if (event.key === "Escape" && !guide.hidden) { event.preventDefault(); setGuide(false); return; }
      if (event.key !== "Tab") return;
      const focusable = [...overlay.querySelectorAll("button:not([hidden]),a[href]")].filter(el => el.getClientRects().length);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  }

  function show() {
    if (completed || visible) return;
    ensureOverlay();
    if (!overlay) return;
    overlay.hidden = false;
    visible = true;
    document.documentElement.classList.remove("masar-intro-candidate");
    document.body.classList.add("masar-onboarding-open");
    overlay.querySelector("#masarIntroStart").focus({ preventScroll: true });
  }

  function hide() {
    document.documentElement.classList.remove("masar-intro-candidate");
    document.body?.classList.remove("masar-onboarding-open");
    if (overlay) overlay.hidden = true;
    visible = false;
  }

  function finish() {
    completed = true;
    try { localStorage.setItem(storageKey, "1"); } catch (_) {
      try { sessionStorage.setItem(storageKey, "1"); } catch (_) {}
    }
    hide();
    (document.querySelector("#roleEntryGrid .role-auth-action") || document.querySelector("#authView input, #authView button, #auth input, #auth button") || document.querySelector("main button"))?.focus({ preventScroll: true });
  }

  window.MasarFirstRun = {
    setAuthenticated(userSignedIn) {
      resolved = true;
      clearTimeout(fallbackTimer);
      if (userSignedIn) hide();
      else show();
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ensureOverlay, { once: true });
  else ensureOverlay();
  fallbackTimer = setTimeout(() => { if (!resolved) show(); }, 5000);
})();
