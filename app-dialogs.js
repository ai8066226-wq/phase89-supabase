(function () {
  "use strict";

  const queue = [];
  let active = null;
  let ui = null;
  let previousFocus = null;

  const copy = {
    confirm: { title: "تأكيد الإجراء", icon: "✓", confirmText: "متابعة", cancelText: "رجوع" },
    prompt: { title: "أدخل التفاصيل", icon: "✎", confirmText: "حفظ ومتابعة", cancelText: "إلغاء" },
    alert: { title: "تنبيه", icon: "i", confirmText: "حسنًا", cancelText: "" }
  };

  function ensureUi() {
    if (ui || !document.body) return ui;
    const style = document.createElement("style");
    style.id = "amrni-dialog-styles";
    style.textContent = `
      body.amrni-dialog-open{overflow:hidden!important}.amrni-dialog-layer{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:max(18px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(18px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));background:rgba(3,15,25,.72);backdrop-filter:blur(13px) saturate(.85);-webkit-backdrop-filter:blur(13px) saturate(.85);direction:rtl;font-family:Tahoma,Arial,sans-serif;opacity:1;transition:opacity .18s ease}
      .amrni-dialog-layer[hidden]{display:none!important}.amrni-dialog-card{position:relative;width:min(440px,100%);overflow:hidden;border:1px solid rgba(255,255,255,.72);border-radius:29px;background:linear-gradient(180deg,#fff 0%,#f7fafb 100%);box-shadow:0 32px 100px rgba(0,12,23,.48);transform:translateY(0) scale(1);animation:amrniDialogIn .22s cubic-bezier(.2,.8,.2,1)}
      .amrni-dialog-card:before{content:"";position:absolute;inset:0 0 auto;height:7px;background:linear-gradient(90deg,#071827,#087b75 57%,#f4c85a)}
      .amrni-dialog-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:22px 22px 0}.amrni-dialog-brand{display:flex;align-items:center;gap:9px;color:#476071;font-size:10px;font-weight:900}.amrni-dialog-brand-mark{width:34px;height:34px;display:grid;place-items:center;border-radius:11px;color:#fff;background:linear-gradient(145deg,#0b4f70,#087b75);box-shadow:0 8px 18px rgba(8,123,117,.22);font-size:17px}.amrni-dialog-close{width:39px;height:39px;display:grid;place-items:center;border:1px solid #dce6eb;border-radius:13px;color:#365164;background:#f3f7f8;font:400 24px/1 Arial;cursor:pointer;transition:.16s}.amrni-dialog-close:hover{background:#e9f2f3;transform:translateY(-1px)}
      .amrni-dialog-body{padding:8px 24px 24px;text-align:center}.amrni-dialog-icon{width:76px;height:76px;margin:8px auto 14px;display:grid;place-items:center;border:1px solid #bde3de;border-radius:25px;color:#087b75;background:linear-gradient(145deg,#e8faf7,#fff);box-shadow:0 13px 32px rgba(8,123,117,.14);font:900 33px/1 Tahoma,Arial,sans-serif}.amrni-dialog-kicker{display:inline-flex;padding:6px 10px;border-radius:999px;color:#08736d;background:#e6f6f3;font-size:10px;font-weight:900}.amrni-dialog-title{margin:11px 0 7px;color:#102b3e;font-size:24px;line-height:1.35}.amrni-dialog-message{max-width:360px;margin:0 auto;color:#607686;font-size:13px;line-height:1.85;white-space:pre-wrap}.amrni-dialog-field{display:grid;gap:7px;margin:18px 0 0;text-align:right}.amrni-dialog-field[hidden]{display:none!important}.amrni-dialog-label{color:#29475b;font-size:11px;font-weight:900}.amrni-dialog-input{width:100%;min-height:50px;max-height:150px;resize:vertical;padding:12px 14px;border:1.5px solid #ccdbe1;border-radius:15px;color:#173248;background:#fff;font:700 13px/1.75 Tahoma,Arial,sans-serif;outline:none;box-sizing:border-box;transition:.16s}.amrni-dialog-input:focus{border-color:#15958b;box-shadow:0 0 0 4px rgba(8,123,117,.12)}.amrni-dialog-hint{min-height:17px;color:#778a98;font-size:9px}.amrni-dialog-error{min-height:19px;margin:8px 0 0;color:#b4233a;font-size:10px;font-weight:900}.amrni-dialog-actions{display:grid;grid-template-columns:1fr 1.25fr;gap:9px;margin-top:17px}.amrni-dialog-button{min-height:51px;padding:10px 15px;border-radius:15px;font:900 13px Tahoma,Arial,sans-serif;cursor:pointer;transition:transform .16s,box-shadow .16s,opacity .16s}.amrni-dialog-button:hover{transform:translateY(-1px)}.amrni-dialog-cancel{border:1px solid #d7e2e7;color:#536d7d;background:#fff}.amrni-dialog-confirm{border:0;color:#fff;background:linear-gradient(135deg,#123a52,#087b75);box-shadow:0 12px 27px rgba(8,123,117,.22)}.amrni-dialog-card[data-tone="danger"]:before{background:linear-gradient(90deg,#5b1320,#b4233a,#f4c85a)}.amrni-dialog-card[data-tone="danger"] .amrni-dialog-icon{color:#a51f35;border-color:#f1c9d1;background:#fff1f3}.amrni-dialog-card[data-tone="danger"] .amrni-dialog-kicker{color:#a51f35;background:#ffebef}.amrni-dialog-card[data-tone="danger"] .amrni-dialog-confirm{background:linear-gradient(135deg,#8f1e32,#c3344c);box-shadow:0 12px 27px rgba(180,35,58,.22)}.amrni-dialog-card[data-tone="warning"] .amrni-dialog-icon{color:#8b5c00;border-color:#f0dca8;background:#fff8e6}.amrni-dialog-card[data-tone="warning"] .amrni-dialog-kicker{color:#815500;background:#fff3d2}.amrni-dialog-card[data-mode="alert"] .amrni-dialog-actions{grid-template-columns:1fr}.amrni-dialog-card[data-mode="alert"] .amrni-dialog-cancel{display:none}
      @keyframes amrniDialogIn{from{opacity:0;transform:translateY(16px) scale(.975)}to{opacity:1;transform:translateY(0) scale(1)}}
      @media(max-width:520px){.amrni-dialog-layer{place-items:end center;padding:12px}.amrni-dialog-card{border-radius:27px 27px 22px 22px}.amrni-dialog-head{padding:19px 18px 0}.amrni-dialog-body{padding:6px 18px 19px}.amrni-dialog-icon{width:68px;height:68px;border-radius:22px;font-size:29px}.amrni-dialog-title{font-size:21px}.amrni-dialog-actions{grid-template-columns:1fr 1.2fr}.amrni-dialog-button{min-height:49px}}
      @media(prefers-reduced-motion:reduce){.amrni-dialog-card{animation:none}.amrni-dialog-layer,.amrni-dialog-button,.amrni-dialog-close{transition:none}}
    `;
    document.head.appendChild(style);

    const layer = document.createElement("div");
    layer.className = "amrni-dialog-layer";
    layer.hidden = true;
    layer.setAttribute("aria-hidden", "true");
    layer.innerHTML = `
      <section class="amrni-dialog-card" role="dialog" aria-modal="true" aria-labelledby="amrniDialogTitle" aria-describedby="amrniDialogMessage">
        <header class="amrni-dialog-head">
          <div class="amrni-dialog-brand"><span class="amrni-dialog-brand-mark">آ</span><span>مَسار الآمن</span></div>
          <button class="amrni-dialog-close" type="button" aria-label="إغلاق">×</button>
        </header>
        <div class="amrni-dialog-body">
          <div class="amrni-dialog-icon" aria-hidden="true"></div>
          <span class="amrni-dialog-kicker"></span>
          <h2 class="amrni-dialog-title" id="amrniDialogTitle"></h2>
          <p class="amrni-dialog-message" id="amrniDialogMessage"></p>
          <label class="amrni-dialog-field" hidden>
            <span class="amrni-dialog-label"></span>
            <textarea class="amrni-dialog-input" rows="3"></textarea>
            <small class="amrni-dialog-hint"></small>
          </label>
          <p class="amrni-dialog-error" aria-live="polite"></p>
          <div class="amrni-dialog-actions">
            <button class="amrni-dialog-button amrni-dialog-cancel" type="button"></button>
            <button class="amrni-dialog-button amrni-dialog-confirm" type="button"></button>
          </div>
        </div>
      </section>`;
    document.body.appendChild(layer);

    ui = {
      layer,
      card: layer.querySelector(".amrni-dialog-card"),
      close: layer.querySelector(".amrni-dialog-close"),
      icon: layer.querySelector(".amrni-dialog-icon"),
      kicker: layer.querySelector(".amrni-dialog-kicker"),
      title: layer.querySelector(".amrni-dialog-title"),
      message: layer.querySelector(".amrni-dialog-message"),
      field: layer.querySelector(".amrni-dialog-field"),
      label: layer.querySelector(".amrni-dialog-label"),
      input: layer.querySelector(".amrni-dialog-input"),
      hint: layer.querySelector(".amrni-dialog-hint"),
      error: layer.querySelector(".amrni-dialog-error"),
      cancel: layer.querySelector(".amrni-dialog-cancel"),
      confirm: layer.querySelector(".amrni-dialog-confirm")
    };

    ui.cancel.addEventListener("click", cancelActive);
    ui.close.addEventListener("click", cancelActive);
    ui.confirm.addEventListener("click", confirmActive);
    ui.layer.addEventListener("click", event => { if (event.target === ui.layer && active?.dismissible !== false) cancelActive(); });
    ui.input.addEventListener("input", () => { ui.error.textContent = ""; });
    document.addEventListener("keydown", event => {
      if (!active) return;
      if (event.key === "Escape" && active.dismissible !== false) { event.preventDefault(); cancelActive(); return; }
      if (event.key === "Enter" && active.mode !== "prompt") { event.preventDefault(); confirmActive(); return; }
      if (event.key === "Enter" && active.mode === "prompt" && (!active.multiline || event.ctrlKey || event.metaKey)) { event.preventDefault(); confirmActive(); }
    });
    return ui;
  }

  function focusableElements() {
    return ui ? [...ui.card.querySelectorAll("button:not([disabled]),textarea:not([disabled]),input:not([disabled])")].filter(element => !element.hidden && element.offsetParent !== null) : [];
  }

  function trapTab(event) {
    if (!active || event.key !== "Tab") return;
    const items = focusableElements();
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function resultForCancel() {
    return active?.mode === "confirm" ? false : active?.mode === "prompt" ? null : true;
  }

  function finish(value) {
    if (!active) return;
    const resolve = active.resolve;
    active = null;
    document.removeEventListener("keydown", trapTab);
    ui.layer.hidden = true;
    ui.layer.setAttribute("aria-hidden", "true");
    document.body.classList.remove("amrni-dialog-open");
    if (previousFocus && typeof previousFocus.focus === "function") previousFocus.focus({ preventScroll: true });
    previousFocus = null;
    resolve(value);
    window.setTimeout(showNext, 0);
  }

  function cancelActive() { finish(resultForCancel()); }

  function confirmActive() {
    if (!active) return;
    if (active.mode !== "prompt") return finish(true);
    const raw = ui.input.value;
    const value = active.trim === false ? raw : raw.trim();
    if (active.required && !value) { ui.error.textContent = active.requiredMessage || "يرجى إدخال البيانات المطلوبة."; ui.input.focus(); return; }
    if (active.minLength && value.length < active.minLength) { ui.error.textContent = active.validationMessage || `اكتب ${active.minLength} أحرف على الأقل.`; ui.input.focus(); return; }
    if (active.expectedValue != null && value !== String(active.expectedValue)) { ui.error.textContent = active.validationMessage || "النص المدخل غير مطابق لعبارة التأكيد."; ui.input.focus(); return; }
    finish(value);
  }

  function showNext() {
    if (active || !queue.length) return;
    if (!document.body) { document.addEventListener("DOMContentLoaded", showNext, { once: true }); return; }
    ensureUi();
    active = queue.shift();
    const preset = copy[active.mode] || copy.confirm;
    previousFocus = document.activeElement;
    ui.card.dataset.mode = active.mode;
    ui.card.dataset.tone = active.tone || "default";
    ui.icon.textContent = active.icon || preset.icon;
    ui.kicker.textContent = active.kicker || (active.tone === "danger" ? "إجراء حساس" : active.tone === "warning" ? "مراجعة مطلوبة" : "تأكيد آمن");
    ui.title.textContent = active.title || preset.title;
    ui.message.textContent = active.message || "";
    ui.cancel.textContent = active.cancelText || preset.cancelText;
    ui.confirm.textContent = active.confirmText || preset.confirmText;
    ui.close.hidden = active.dismissible === false;
    ui.field.hidden = active.mode !== "prompt";
    ui.error.textContent = "";
    if (active.mode === "prompt") {
      const replacement = document.createElement(active.multiline === false ? "input" : "textarea");
      replacement.className = "amrni-dialog-input";
      if (replacement.tagName === "TEXTAREA") replacement.rows = Number(active.rows || 3);
      else replacement.type = active.inputType || "text";
      replacement.value = active.defaultValue == null ? "" : String(active.defaultValue);
      replacement.placeholder = active.placeholder || "";
      replacement.autocomplete = active.autocomplete || "off";
      replacement.inputMode = active.inputMode || "text";
      if (replacement.tagName === "TEXTAREA" || replacement.type !== "number") replacement.maxLength = Number(active.maxLength || 300);
      replacement.setAttribute("aria-label", active.label || "البيانات المطلوبة");
      ui.input.replaceWith(replacement);
      ui.input = replacement;
      ui.input.addEventListener("input", () => { ui.error.textContent = ""; });
      ui.label.textContent = active.label || "التفاصيل";
      ui.hint.textContent = active.hint || (active.required ? "هذا الحقل مطلوب للمتابعة" : "يمكنك الإلغاء والعودة من دون حفظ");
    }
    ui.layer.hidden = false;
    ui.layer.setAttribute("aria-hidden", "false");
    document.body.classList.add("amrni-dialog-open");
    document.addEventListener("keydown", trapTab);
    window.requestAnimationFrame(() => (active.mode === "prompt" ? ui.input : ui.confirm).focus({ preventScroll: true }));
  }

  function open(options = {}) {
    return new Promise(resolve => {
      queue.push({ mode: "confirm", dismissible: true, trim: true, ...options, resolve });
      showNext();
    });
  }

  const api = {
    open,
    confirm(message, options = {}) { return open({ ...options, mode: "confirm", message: String(message || "") }); },
    prompt(message, defaultValue = "", options = {}) { return open({ ...options, mode: "prompt", message: String(message || ""), defaultValue }); },
    alert(message, options = {}) { return open({ ...options, mode: "alert", message: String(message || "") }); }
  };

  window.AmrniDialog = api;
  window.amrniAlert = api.alert;
})();
