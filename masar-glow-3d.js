/* مَسار — مسار متوهج + إصلاح اللمس على الخريطة المائلة 3D + تنبيه المخاطر.
   يُحمَّل قبل app.js وdriver.js. */
(function () {
  "use strict";

  /* ───────── مسار متوهج بين نقطتين (يعمل كطبقة Leaflet واحدة) ───────── */
  function glowLine(map, coords, o) {
    var L = window.L; o = o || {};
    var color = o.color || "#087b75", w = o.weight || 6, op = o.opacity == null ? 0.95 : o.opacity;
    var renderer = map._masarSvg || (map._masarSvg = L.svg({ padding: 0.6 }));
    function mk(extra) {
      return L.polyline(coords, Object.assign({ lineCap: "round", lineJoin: "round", interactive: false, renderer: renderer }, extra));
    }
    var layers = [
      mk({ color: color, weight: w + 16, opacity: 0.24, className: "m-route-halo" }),
      mk({ color: color, weight: w + 7, opacity: 0.48, className: "m-route-glow" }),
      mk({ color: color, weight: w, opacity: op, className: "m-route-core" }),
      mk({ color: "#ffffff", weight: Math.max(2, w * 0.38), opacity: 0.95, className: "m-route-flow" })
    ];
    var group = L.featureGroup(layers);
    /* رسم المسار تدريجيًا عند أول ظهور (مرة واحدة) */
    group.on("add", function () {
      try {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        var els = [layers[0], layers[1], layers[2]].map(function (l) { return l.getElement && l.getElement(); }).filter(Boolean);
        els.forEach(function (el) {
          el.setAttribute("pathLength", "1");
          el.style.transition = "none"; el.style.strokeDasharray = "1 1.01"; el.style.strokeDashoffset = "1";
        });
        void (els[0] && els[0].getBoundingClientRect());
        requestAnimationFrame(function () {
          els.forEach(function (el) { el.style.transition = "stroke-dashoffset 1.3s cubic-bezier(.4,.1,.2,1)"; el.style.strokeDashoffset = "0"; });
          setTimeout(function () { els.forEach(function (el) { el.style.transition = ""; el.style.strokeDasharray = ""; el.style.strokeDashoffset = ""; }); }, 1500);
        });
      } catch (_) {}
    });
    group.setLatLngs = function (c) { layers.forEach(function (l) { l.setLatLngs(c); }); return group; };
    return group;
  }

  /* ───────── تصحيح نقطة اللمس عندما تكون الخريطة مائلة ─────────
     يحوّل إحداثيات الشاشة إلى إحداثيات الخريطة المسطحة بحل تحويل المنظور (homography). */
  function solve(A, b) {
    var n = b.length, i, j, k, f;
    for (i = 0; i < n; i++) {
      var p = i;
      for (j = i + 1; j < n; j++) if (Math.abs(A[j][i]) > Math.abs(A[p][i])) p = j;
      var t = A[i]; A[i] = A[p]; A[p] = t; t = b[i]; b[i] = b[p]; b[p] = t;
      for (j = i + 1; j < n; j++) {
        f = A[j][i] / A[i][i];
        for (k = i; k < n; k++) A[j][k] -= f * A[i][k];
        b[j] -= f * b[i];
      }
    }
    var x = new Array(n);
    for (i = n - 1; i >= 0; i--) {
      var s = b[i];
      for (j = i + 1; j < n; j++) s -= A[i][j] * x[j];
      x[i] = s / A[i][i];
    }
    return x;
  }
  function screenToLocal(el, cx, cy) {
    var W = el.offsetWidth, H = el.offsetHeight, src = [[0, 0], [W, 0], [W, H], [0, H]], dst = [];
    src.forEach(function (pt) {
      var d = document.createElement("i");
      d.style.cssText = "position:absolute;width:0;height:0;visibility:hidden;pointer-events:none;left:" + pt[0] + "px;top:" + pt[1] + "px";
      el.appendChild(d);
      var r = d.getBoundingClientRect();
      el.removeChild(d);
      dst.push([r.left, r.top]);
    });
    var A = [], b = [];
    for (var i = 0; i < 4; i++) {          /* من الشاشة (x,y) إلى المحلي (u,v) */
      var x = dst[i][0], y = dst[i][1], u = src[i][0], v = src[i][1];
      A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -x * v, -y * v]); b.push(v);
    }
    var h = solve(A, b), den = h[6] * cx + h[7] * cy + 1;
    return [(h[0] * cx + h[1] * cy + h[2]) / den, (h[3] * cx + h[4] * cy + h[5]) / den];
  }
  function latLng(map, ev) {
    try {
      var el = map.getContainer(), oe = ev.originalEvent;
      if (!oe || typeof oe.clientX !== "number" || getComputedStyle(el).transform === "none") return ev.latlng;
      var p = screenToLocal(el, oe.clientX, oe.clientY);
      if (!isFinite(p[0]) || !isFinite(p[1])) return ev.latlng;
      return map.containerPointToLatLng(window.L.point(p[0], p[1]));
    } catch (_) { return ev.latlng; }
  }

  window.MasarMap3D = { glowLine: glowLine, latLng: latLng, _screenToLocal: screenToLocal };

  /* ───────── بعد تبديل 2D/3D أو وضع القيادة: أعد قياس الخريطة ───────── */
  var timer = 0;
  function remeasure() { clearTimeout(timer); timer = setTimeout(function () { window.dispatchEvent(new Event("resize")); }, 120); }
  function ready() {
    var targets = ["home", "driverView"].map(function (id) { return document.getElementById(id); }).filter(Boolean);
    if (!targets.length || !window.MutationObserver) return;
    var last = targets.map(function (t) { return t.className; });
    var mo = new MutationObserver(function () {
      targets.forEach(function (t, i) {
        var a = last[i].split(/\s+/).filter(function (c) { return c === "map-view-3d" || c === "driving-navigation-active"; }).sort().join();
        var b = t.className.split(/\s+/).filter(function (c) { return c === "map-view-3d" || c === "driving-navigation-active"; }).sort().join();
        last[i] = t.className;
        if (a !== b) remeasure();
      });
    });
    targets.forEach(function (t) { mo.observe(t, { attributes: true, attributeFilter: ["class"] }); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, { once: true }); else ready();

  /* ───────── تنبيه المخاطر: توهج أحمر للتوست ───────── */
  var DANGER = /(⚠|🚧|💥|⛔|🚦|خطر|عائق|حادث|ازدحام|حفريات|شارع مغلق|تنبيه طريق|أمامك)/;
  function watchToast() {
    var t = document.getElementById("toast");
    if (!t || !window.MutationObserver) return;
    new MutationObserver(function () { t.classList.toggle("m-toast-danger", DANGER.test(t.textContent || "")); })
      .observe(t, { childList: true, characterData: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watchToast, { once: true }); else watchToast();
})();
