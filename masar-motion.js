/* مَسار — طبقة الحركة: شاشة افتتاحية، دخول الواجهات، تأثير الضغط على الأزرار.
   تعمل في كل البوابات (عميل/كابتن/خدمات/إدارة) وتحترم «تقليل الحركة». */
(function () {
  "use strict";
  var KEY = "masar.splash.v1";
  var root = document.documentElement;
  var reduce = false, seen = false, splash = null, splashTimer = 0, killTimer = 0;
  try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (_) {}
  try { seen = sessionStorage.getItem(KEY) === "1"; } catch (_) {}
  /* وضع خفيف للأجهزة الضعيفة: بلا جسيمات ولا فلاتر ثقيلة (يُحفظ ويُكتشف أيضًا بقياس الإطارات) */
  var lite = false;
  try { lite = localStorage.getItem("masar.lite") === "1" || (navigator.deviceMemory && navigator.deviceMemory <= 3) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4); } catch (_) {}
  window.MASAR_LITE = !!lite;
  if (lite) root.classList.add("m-lite");
  function goLite() {
    if (window.MASAR_LITE) return;
    window.MASAR_LITE = true; root.classList.add("m-lite");
    try { localStorage.setItem("masar.lite", "1"); } catch (_) {}
  }
  function nativeSplashReady() { try { if (window.KarwaNative && KarwaNative.splashReady) KarwaNative.splashReady(); } catch (_) {} }
  var skipSplash = reduce || seen || /(privacy|delete-account)\.html$/.test(location.pathname);

  /* ───────── الشاشة الافتتاحية ───────── */
  var ROUTE = "M28 196C72 190 70 142 112 140S154 176 186 150C218 124 190 66 212 44";
  function splashMarkup() {
    return '' +
      '<div class="ms-bg" aria-hidden="true"></div><span class="ms-aurora a1" aria-hidden="true"></span><span class="ms-aurora a2" aria-hidden="true"></span><span class="ms-aurora a3" aria-hidden="true"></span><div class="ms-grid" aria-hidden="true"></div><div class="ms-particles" aria-hidden="true"></div>' +
      '<div class="ms-stage">' +
        '<div class="ms-art" aria-hidden="true">' +
          '<span class="ms-halo"></span><span class="ms-wave ms-wave-a"></span><span class="ms-wave ms-wave-b"></span><span class="ms-shock"></span><span class="ms-shock s2"></span>' +
          '<svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" class="ms-svg">' +
            '<defs><linearGradient id="msRoute" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#5eead4"/><stop offset="1" stop-color="#f4c85a"/></linearGradient>' +
            '<linearGradient id="msTile" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#12b3a6"/><stop offset="1" stop-color="#075d70"/></linearGradient></defs>' +
            '<path class="ms-route-base" d="' + ROUTE + '"/>' +
            '<path class="ms-route-glow" pathLength="1" d="' + ROUTE + '"/>' +
            '<path class="ms-route" pathLength="1" d="' + ROUTE + '"/>' +
            '<circle class="ms-pin-ring" cx="28" cy="196" r="13"/><circle class="ms-pin-dot" cx="28" cy="196" r="5"/>' +
            '<g class="ms-pin-end"><circle class="ms-pin-ring2" cx="212" cy="44" r="13"/><circle cx="212" cy="44" r="6" fill="#f4c85a"/><circle cx="212" cy="44" r="2.4" fill="#fff"/></g>' +
            '<circle r="4.2" fill="#a6f3e3" opacity=".6" class="ms-runner"><animateMotion dur="1.7s" begin="0.45s" fill="freeze" path="' + ROUTE + '" calcMode="spline" keyTimes="0;1" keySplines=".45 .05 .25 1"/></circle>' +
            '<circle r="5.5" fill="#fff" class="ms-runner"><animateMotion dur="1.7s" begin="0.35s" fill="freeze" path="' + ROUTE + '" calcMode="spline" keyTimes="0;1" keySplines=".45 .05 .25 1"/></circle>' +
            '<g class="ms-tile"><rect x="88" y="88" width="64" height="64" rx="20" fill="url(#msTile)" stroke="rgba(190,250,238,.6)" stroke-width="2"/>' +
            '<text x="120" y="133" fill="#fff" font-family="Tahoma,Arial,sans-serif" font-size="38" font-weight="800" text-anchor="middle">م</text></g>' +
          '</svg>' +
        '</div>' +
        '<h1 class="ms-word">مَسار</h1>' +
        '<p class="ms-tag"><span>رحلات</span><i></i><span>توصيل</span><i></i><span>خدمات</span></p>' +
      '</div>' +
      '<div class="ms-progress" aria-hidden="true"><span></span></div>';
  }

  /* جسيمات وشرارات بـ CSS فقط (تعمل على المعالج الرسومي دون إشغال خيط الصفحة) */
  function decorate(host) {
    if (window.MASAR_LITE) return;
    var box = host.querySelector(".ms-particles"); if (!box) return;
    var n = 16, html = "";
    for (var k = 0; k < n; k++) {
      html += '<i class="ms-p' + (k % 5 === 0 ? " gold" : "") + '" style="left:' + (Math.random() * 100).toFixed(1) + '%;--s:' + (1.5 + Math.random() * 2.5).toFixed(1) + 'px;--d:' + (3 + Math.random() * 3).toFixed(1) + 's;--t:' + (Math.random() * 1.6).toFixed(2) + 's"></i>';
    }
    box.innerHTML = html;
    setTimeout(function () {
      var art = host.querySelector(".ms-art"); if (!art || !host.isConnected) return;
      var out = "";
      for (var q = 0; q < 14; q++) {
        var ang = (q / 14) * 6.283 + Math.random() * .3, dist = 90 + Math.random() * 90;
        out += '<i class="ms-spark' + (q % 4 === 0 ? " gold" : "") + '" style="--dx:' + (Math.cos(ang) * dist).toFixed(0) + 'px;--dy:' + (Math.sin(ang) * dist).toFixed(0) + 'px"></i>';
      }
      var sp = document.createElement("div"); sp.className = "ms-sparks"; sp.innerHTML = out; art.appendChild(sp);
    }, 1250);
  }

  function endSplash() {
    if (!splash || splash.classList.contains("is-leaving")) return;
    clearTimeout(splashTimer);
    splash.classList.add("is-leaving");
    root.classList.remove("masar-splash-on");
    reveal();
    killTimer = setTimeout(removeSplash, 900);
  }
  function removeSplash() {
    clearTimeout(killTimer);
    if (splash && splash.parentNode) splash.parentNode.removeChild(splash);
    splash = null;
  }
  function startSplash() {
    root.classList.add("masar-splash-on");
    splash = document.createElement("div");
    splash.className = "masar-splash";
    splash.setAttribute("role", "presentation");
    splash.innerHTML = splashMarkup();
    root.appendChild(splash);
    try { sessionStorage.setItem(KEY, "1"); } catch (_) {}
    splash.addEventListener("click", endSplash);
    document.addEventListener("keydown", function onKey(e) {
      if (splash && (e.key === "Escape" || e.key === "Enter" || e.key === " ")) { endSplash(); document.removeEventListener("keydown", onKey); }
    });
    decorate(splash);
    /* الجدول الزمني يبدأ من أول إطار مرسوم فعلًا، ويُقاس معدل الإطارات لتخفيف التأثيرات عند الحاجة */
    var first = 0, frames = 0, tStart = 0;
    function tick(ts) {
      if (!splash) return;
      if (!first) {
        first = ts; tStart = ts; nativeSplashReady();
        splashTimer = setTimeout(endSplash, 3350);
      }
      frames++;
      if (ts - tStart >= 700 && !window.MASAR_LITE) {
        if (frames / ((ts - tStart) / 1000) < 38) goLite();
        tStart = Infinity;
      }
      if (ts - first < 1200) requestAnimationFrame(tick);
    }
    requestAnimationFrame(function (t) { requestAnimationFrame(tick); });
    /* شبكة أمان: لا تبقى الشاشة أبدًا أكثر من 6 ثوانٍ. */
    setTimeout(function () { endSplash(); removeSplash(); root.classList.remove("masar-splash-on"); }, 7500);
  }

  var revealed = false;
  function reveal() {
    if (revealed) return;
    revealed = true;
    root.classList.add("masar-revealed");
    setTimeout(function () { root.classList.remove("masar-revealed"); }, 1600);
  }

  if (!skipSplash) startSplash();

  /* ───────── دخول الواجهات عند إظهارها ───────── */
  var ENTER = ".view, .card, .panel, section, [role=tabpanel], .tracking-card, .wallet-card";
  var MAP = ".leaflet-container, .maplibregl-map, #driverView, #map, .layout";
  var DONE_MS = 950;
  function enter(el) {
    if (!el || el.nodeType !== 1 || el.classList.contains("m-enter")) return;
    if (!el.matches(ENTER) || el.closest(".masar-first-run, .masar-splash, .amrni-dialog-layer")) return;
    if (el.matches(MAP) || el.querySelector(MAP)) return;
    el.classList.add("m-enter");
    setTimeout(function () { el.classList.remove("m-enter"); }, DONE_MS);
  }
  var VISIBLE_OLD = /(^|\s)(hidden)(\s|$)/;
  function observe() {
    if (reduce || !window.MutationObserver) return;
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var r = records[i], el = r.target, old = r.oldValue || "";
        if (r.attributeName === "hidden") { if (!el.hidden) enter(el); continue; }
        var wasHidden = VISIBLE_OLD.test(old), isHidden = el.classList.contains("hidden");
        var gainedActive = el.classList.contains("active") && !/(^|\s)active(\s|$)/.test(old);
        if ((wasHidden && !isHidden) || gainedActive) enter(el);
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class", "hidden"], attributeOldValue: true });
  }

  /* ───────── تأثير الموجة + اهتزاز خفيف عند الضغط ───────── */
  var RIPPLE = ".primary, .primary-button, .secondary, .secondary-button, .danger, .text-button, .role-auth-action, .service-button, .vehicle-button, .nav-button, .customer-settings-action, .map-pick-button, .tab, .masar-intro-primary, .masar-intro-secondary, .amrni-dialog-button";
  var SKIP = ".leaflet-container *, .maplibregl-map *, :disabled, [aria-disabled=true]";
  function onPress(e) {
    if (e.button > 0) return;
    var t = e.target && e.target.closest ? e.target.closest(RIPPLE) : null;
    if (!t || t.matches(SKIP)) return;
    if (getComputedStyle(t).position === "static") t.style.position = "relative";
    var rect = t.getBoundingClientRect();
    var size = Math.max(rect.width, rect.height) * 2.1;
    var host = document.createElement("span");
    host.className = "m-ripple-host";
    host.setAttribute("aria-hidden", "true");
    var dot = document.createElement("span");
    dot.className = "m-ripple";
    dot.style.cssText = "width:" + size + "px;height:" + size + "px;left:" + (e.clientX - rect.left - size / 2) + "px;top:" + (e.clientY - rect.top - size / 2) + "px";
    host.appendChild(dot);
    t.appendChild(host);
    setTimeout(function () { if (host.parentNode) host.parentNode.removeChild(host); }, 700);
    try { if (navigator.vibrate && /primary|role-auth|masar-intro-primary/.test(t.className)) navigator.vibrate(6); } catch (_) {}
  }

  function ready() {
    if (skipSplash) { reveal(); requestAnimationFrame(nativeSplashReady); }
    if (!reduce) document.addEventListener("pointerdown", onPress, { passive: true });
    observe();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, { once: true });
  else ready();

  window.MasarMotion = { enter: enter, endSplash: endSplash };
})();
