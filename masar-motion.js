/* مَسار — طبقة الحركة: شاشة افتتاحية، دخول الواجهات، تأثير الضغط على الأزرار.
   تعمل في كل البوابات (عميل/كابتن/خدمات/إدارة) وتحترم «تقليل الحركة». */
(function () {
  "use strict";
  var KEY = "masar.splash.v1";
  var root = document.documentElement;
  var reduce = false, seen = false, splash = null, splashTimer = 0, killTimer = 0;
  try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (_) {}
  try { seen = sessionStorage.getItem(KEY) === "1"; } catch (_) {}
  var skipSplash = reduce || seen || /(privacy|delete-account)\.html$/.test(location.pathname);

  /* ───────── الشاشة الافتتاحية ───────── */
  var ROUTE = "M28 196C72 190 70 142 112 140S154 176 186 150C218 124 190 66 212 44";
  function splashMarkup() {
    return '' +
      '<div class="ms-bg" aria-hidden="true"></div><span class="ms-aurora a1" aria-hidden="true"></span><span class="ms-aurora a2" aria-hidden="true"></span><span class="ms-aurora a3" aria-hidden="true"></span><div class="ms-grid" aria-hidden="true"></div><canvas class="ms-canvas" aria-hidden="true"></canvas>' +
      '<div class="ms-stage">' +
        '<div class="ms-art" aria-hidden="true">' +
          '<span class="ms-halo"></span><span class="ms-wave ms-wave-a"></span><span class="ms-wave ms-wave-b"></span><span class="ms-shock"></span><span class="ms-shock s2"></span>' +
          '<svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" class="ms-svg">' +
            '<defs><linearGradient id="msRoute" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#5eead4"/><stop offset="1" stop-color="#f4c85a"/></linearGradient>' +
            '<linearGradient id="msTile" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#12b3a6"/><stop offset="1" stop-color="#075d70"/></linearGradient></defs>' +
            '<path class="ms-route-base" d="' + ROUTE + '"/>' +
            '<path class="ms-route" pathLength="1" d="' + ROUTE + '"/>' +
            '<circle class="ms-pin-ring" cx="28" cy="196" r="13"/><circle class="ms-pin-dot" cx="28" cy="196" r="5"/>' +
            '<g class="ms-pin-end"><circle class="ms-pin-ring2" cx="212" cy="44" r="13"/><circle cx="212" cy="44" r="6" fill="#f4c85a"/><circle cx="212" cy="44" r="2.4" fill="#fff"/></g>' +
            '<circle r="3" fill="#a6f3e3" opacity=".35" class="ms-runner"><animateMotion dur="1.7s" begin="0.55s" fill="freeze" path="' + ROUTE + '" calcMode="spline" keyTimes="0;1" keySplines=".45 .05 .25 1"/></circle>' +
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

  /* جسيمات متوهجة + شرارات عند ظهور الشعار (Canvas خفيف) */
  function startParticles(host) {
    var cv = host.querySelector(".ms-canvas"); if (!cv || !cv.getContext) return;
    var ctx = cv.getContext("2d"), dpr = Math.min(window.devicePixelRatio || 1, 2), W = 0, H = 0, parts = [], sparks = [], last = 0, t0 = 0;
    var N = (navigator.hardwareConcurrency || 4) <= 4 ? 34 : 60;
    function size() { W = cv.clientWidth; H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    size(); window.addEventListener("resize", size);
    function rnd(a, b) { return a + Math.random() * (b - a); }
    for (var i = 0; i < N; i++) parts.push({ x: rnd(0, W), y: rnd(0, H), r: rnd(.6, 2.2), v: rnd(6, 22), a: rnd(.15, .6), p: rnd(0, 6.28), gold: Math.random() < .22 });
    function burst() {
      var art = host.querySelector(".ms-art"); if (!art) return;
      var b = art.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      for (var k = 0; k < 46; k++) { var ang = rnd(0, 6.28), sp = rnd(70, 260); sparks.push({ x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 0, max: rnd(.7, 1.3), r: rnd(1, 2.6), gold: k % 4 === 0 }); }
    }
    setTimeout(burst, 1300);
    function frame(ts) {
      if (!host.isConnected) { window.removeEventListener("resize", size); return; }
      if (!t0) t0 = ts; var dt = Math.min(.05, (ts - (last || ts)) / 1000); last = ts;
      var fade = Math.min(1, (ts - t0) / 700);
      ctx.clearRect(0, 0, W, H); ctx.globalCompositeOperation = "lighter";
      parts.forEach(function (p) {
        p.y -= p.v * dt; p.p += dt * 1.4; if (p.y < -6) { p.y = H + 6; p.x = rnd(0, W); }
        var tw = .55 + .45 * Math.sin(p.p), x = p.x + Math.sin(p.p * .6) * 6;
        ctx.beginPath(); ctx.fillStyle = p.gold ? "rgba(244,200,90," + p.a * tw * fade + ")" : "rgba(130,240,222," + p.a * tw * fade + ")";
        ctx.shadowColor = p.gold ? "#f4c85a" : "#5eead4"; ctx.shadowBlur = 8; ctx.arc(x, p.y, p.r, 0, 6.283); ctx.fill();
      });
      for (var j = sparks.length - 1; j >= 0; j--) {
        var s = sparks[j]; s.life += dt; if (s.life > s.max) { sparks.splice(j, 1); continue; }
        s.vx *= .965; s.vy = s.vy * .965 + 40 * dt; s.x += s.vx * dt; s.y += s.vy * dt;
        var al = 1 - s.life / s.max;
        ctx.beginPath(); ctx.fillStyle = s.gold ? "rgba(255,214,110," + al + ")" : "rgba(160,255,238," + al + ")";
        ctx.shadowColor = s.gold ? "#f4c85a" : "#5eead4"; ctx.shadowBlur = 12; ctx.arc(s.x, s.y, s.r * (.4 + al), 0, 6.283); ctx.fill();
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
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
    splashTimer = setTimeout(endSplash, 3350);
    startParticles(splash);
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
    if (skipSplash) reveal();
    if (!reduce) document.addEventListener("pointerdown", onPress, { passive: true });
    observe();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, { once: true });
  else ready();

  window.MasarMotion = { enter: enter, endSplash: endSplash };
})();
