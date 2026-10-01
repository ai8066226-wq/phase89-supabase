/* مَسار — مؤثرات متقدمة (ميل 3D، ظهور عند التمرير). تحترم «تقليل الحركة». */
(function () {
  "use strict";
  var reduce = false;
  try { reduce = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (_) {}
  if (reduce) return;

  /* ───────── ميل 3D للبطاقات عند التمرير بالفأرة أو اللمس ───────── */
  var TILT = ".role-entry-card, .admin-module-card, .stat, .metric, .payment-card, .wallet-card, .vehicle-button, .service-button";
  var cur = null, rect = null, raf = 0, pt = null;
  function apply() {
    raf = 0; if (!cur || !pt) return;
    var x = (pt.x - rect.left) / rect.width - .5, y = (pt.y - rect.top) / rect.height - .5;
    cur.style.setProperty("--ry", (x * 12).toFixed(2) + "deg");
    cur.style.setProperty("--rx", (-y * 10).toFixed(2) + "deg");
  }
  function over(e) {
    var t = e.target.closest && e.target.closest(TILT);
    if (!t || t === cur || t.matches(":disabled")) return;
    if (e.pointerType === "touch" && e.type !== "pointerdown") return;
    release();
    cur = t; rect = t.getBoundingClientRect();
    if (rect.width > 520 || rect.height > 420) { cur = null; return; }
    t.classList.remove("m-tilt-rest"); t.classList.add("m-tilting");
    pt = { x: e.clientX, y: e.clientY }; apply();
  }
  function move(e) {
    if (!cur) return;
    if (e.pointerType === "touch" && !(e.buttons & 1) && e.pressure === 0) return;
    pt = { x: e.clientX, y: e.clientY };
    if (!raf) raf = requestAnimationFrame(apply);
  }
  function release() {
    if (!cur) return;
    var el = cur; cur = null;
    el.classList.remove("m-tilting"); el.classList.add("m-tilt-rest");
    el.style.removeProperty("--rx"); el.style.removeProperty("--ry");
    setTimeout(function () { el.classList.remove("m-tilt-rest"); }, 700);
  }
  document.addEventListener("pointerover", function (e) { if (e.pointerType === "mouse") over(e); }, { passive: true });
  document.addEventListener("pointerdown", function (e) { if (e.pointerType === "touch") over(e); }, { passive: true });
  document.addEventListener("pointermove", move, { passive: true });
  document.addEventListener("pointerout", function (e) { if (cur && e.pointerType === "mouse" && !cur.contains(e.relatedTarget)) release(); }, { passive: true });
  ["pointerup", "pointercancel"].forEach(function (n) { document.addEventListener(n, function (e) { if (e.pointerType === "touch") release(); }, { passive: true }); });

  /* ───────── ظهور البطاقات عند التمرير إليها ─────────
     العناصر الموجودة داخل الشاشة لحظة إضافتها لا تتحرك (لا وميض عند التحديث اللحظي)،
     وما كان خارجها يظهر بحركة عند الوصول إليه. */
  var SR = "main .card:not(.map-card):not(.tracking-card), main .order-card, main .admin-module-card, .kn-item";
  var SKIP = "#driverView, .map-card, .leaflet-container, .masar-first-run, .masar-splash, .modal, .driver-options-drawer";
  if (!("IntersectionObserver" in window)) return;
  var seen = new WeakSet();
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      var el = en.target; io.unobserve(el);
      el.classList.add("m-sr-in"); el.classList.remove("m-sr");
      setTimeout(function () { el.classList.remove("m-sr-in"); }, 900);
    });
  }, { rootMargin: "0px 0px -6% 0px", threshold: .06 });
  function tag(el) {
    if (seen.has(el) || el.closest(SKIP)) return;
    seen.add(el);
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;                       /* مخفي الآن: لا نخفيه مرتين */
    if (r.top < innerHeight && r.bottom > 0) return;         /* ظاهر فعلًا: بلا حركة */
    el.classList.add("m-sr"); io.observe(el);
    setTimeout(function () { if (el.classList.contains("m-sr")) { el.classList.remove("m-sr"); io.unobserve(el); } }, 3500);
  }
  function scan(root) {
    if (root.nodeType !== 1) return;
    if (root.matches(SR)) tag(root);
    root.querySelectorAll && root.querySelectorAll(SR).forEach(tag);
  }
  function start() {
    scan(document.body);
    var q = [], t = 0;
    new MutationObserver(function (ms) {
      ms.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) q.push(n); }); });
      if (!t) t = setTimeout(function () { var l = q; q = []; t = 0; l.forEach(scan); }, 60);
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true }); else start();
})();
