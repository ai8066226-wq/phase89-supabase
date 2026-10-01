/* مَسار — أزرار الرجوع: داخل الواجهات واللوحات، وزر الرجوع في أندرويد/المتصفح. */
(function () {
  "use strict";
  function backBtn(extra) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "masar-back" + (extra ? " " + extra : "");
    b.setAttribute("aria-label", "رجوع");
    b.innerHTML = '<span aria-hidden="true">→</span><b>رجوع</b>';
    return b;
  }
  function visible(el) { return !!el && !el.hidden && !el.classList.contains("hidden") && el.getClientRects().length > 0; }

  /* رجوع داخل لوحة منبثقة = يضغط زر إغلاقها الأصلي */
  var PANELS = [
    ["map-options-header", "customerOptionsClose"],
    ["customer-settings-header", "customerSettingsClose"],
    ["driver-options-header", null, ".driver-options-close"],
    ["driver-settings-header", null, ".driver-settings-close"]
  ];
  function panelBacks() {
    PANELS.forEach(function (p) {
      document.querySelectorAll("." + p[0]).forEach(function (head) {
        if (head.querySelector(".masar-back")) return;
        var close = p[1] ? document.getElementById(p[1]) : head.querySelector(p[2]);
        if (!close) return;
        var b = backBtn("masar-back-panel");
        b.addEventListener("click", function () { close.click(); });
        head.insertBefore(b, head.firstChild);
      });
    });
  }

  /* واجهة العميل: طلباتي / المحفظة / حسابي → رجوع إلى الرئيسية */
  function customer() {
    var main = document.querySelector("main");
    if (!main || !document.getElementById("home")) return;
    function goHome() { var h = document.querySelector('[data-view="home"]'); if (h) h.click(); }
    main.querySelectorAll(".view").forEach(function (v) {
      if (v.id === "home" || v.querySelector(":scope > .masar-viewbar")) return;
      var bar = document.createElement("div"); bar.className = "masar-viewbar";
      var b = backBtn();
      b.addEventListener("click", function () { if (history.state && history.state.masar) history.back(); else goHome(); });
      bar.appendChild(b); v.insertBefore(bar, v.firstChild);
    });
    function activeId() { var a = main.querySelector(".view.active"); return a ? a.id : "home"; }
    var cur = activeId();
    new MutationObserver(function () {
      var id = activeId();
      if (id === cur) return;
      if (cur === "home") { try { history.pushState({ masar: id }, ""); } catch (_) {} }
      else if (id === "home" && history.state && history.state.masar) { try { history.back(); } catch (_) {} }
      cur = id;
    }).observe(main, { subtree: true, attributes: true, attributeFilter: ["class"] });
    window.addEventListener("popstate", function () { if (activeId() !== "home") goHome(); });
  }

  /* بوابات الكابتن/الخدمات/الإدارة: شاشات الدخول والتسجيل → رجوع إلى الرئيسية */
  function portals() {
    if (document.getElementById("home")) return;
    var ids = ["authView", "applicationView", "deniedView", "blockedView", "serviceBlockedView"];
    var els = ids.map(function (i) { return document.getElementById(i); }).filter(Boolean);
    if (!els.length) return;
    var b = backBtn("masar-back-float");
    b.hidden = true;
    b.addEventListener("click", function () {
      if (document.referrer && history.length > 1 && new URL(document.referrer, location.href).origin === location.origin) history.back();
      else location.href = "./index.html";
    });
    document.body.appendChild(b);
    function sync() { var h = !els.some(visible); if (b.hidden !== h) b.hidden = h; }
    new MutationObserver(sync).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });
    sync();
  }

  function ready() {
    customer(); portals(); panelBacks();
    var pt = 0;
    new MutationObserver(function () { clearTimeout(pt); pt = setTimeout(panelBacks, 250); }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, { once: true }); else ready();
})();
