(() => {
  "use strict";

  const governorates = Object.freeze([
    { id: "baghdad", name: "بغداد" },
    { id: "basra", name: "البصرة" },
    { id: "nineveh", name: "نينوى", label: "نينوى (الموصل)", aliases: ["الموصل", "موصل"] },
    { id: "erbil", name: "أربيل", aliases: ["اربيل"] },
    { id: "najaf", name: "النجف" },
    { id: "karbala", name: "كربلاء" },
    { id: "kirkuk", name: "كركوك" },
    { id: "duhok", name: "دهوك" },
    { id: "sulaymaniyah", name: "السليمانية" },
    { id: "anbar", name: "الأنبار", aliases: ["الانبار"] },
    { id: "babil", name: "بابل", aliases: ["الحلة"] },
    { id: "diyala", name: "ديالى" },
    { id: "dhi_qar", name: "ذي قار", aliases: ["الناصرية"] },
    { id: "saladin", name: "صلاح الدين" },
    { id: "wasit", name: "واسط", aliases: ["الكوت"] },
    { id: "maysan", name: "ميسان", aliases: ["العمارة"] },
    { id: "muthanna", name: "المثنى", aliases: ["السماوة"] },
    { id: "qadisiyah", name: "القادسية", label: "القادسية (الديوانية)", aliases: ["الديوانية", "القادسيه"] },
    { id: "halabja", name: "حلبجة" }
  ]);

  const normalizeKey = value => String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ");

  const aliases = new Map();
  governorates.forEach(item => {
    [item.name, item.label, ...(item.aliases || [])].filter(Boolean).forEach(value => aliases.set(normalizeKey(value), item.name));
  });

  function normalize(value) {
    return aliases.get(normalizeKey(value)) || "";
  }

  function enabledNames(settings = {}) {
    if (!Array.isArray(settings.enabledGovernorates)) return governorates.map(item => item.name);
    const requested = new Set(settings.enabledGovernorates.map(normalize).filter(Boolean));
    return governorates.map(item => item.name).filter(name => requested.has(name));
  }

  function isEnabled(settings = {}, value = "") {
    const name = normalize(value);
    return Boolean(name) && enabledNames(settings).includes(name);
  }

  function populateSelect(select, settings = {}, options = {}) {
    if (!select) return;
    const current = normalize(options.selected ?? select.value) || normalize(select.dataset.selected) || "";
    const enabled = new Set(enabledNames(settings));
    const includeDisabled = options.includeDisabled !== false;
    const placeholder = options.placeholder || "اختر المحافظة";
    select.innerHTML = "";
    const first = document.createElement("option");
    first.value = "";
    first.textContent = placeholder;
    first.disabled = true;
    select.appendChild(first);
    governorates.forEach(item => {
      if (!includeDisabled && !enabled.has(item.name)) return;
      const option = document.createElement("option");
      option.value = item.name;
      option.textContent = `${item.label || item.name}${enabled.has(item.name) ? "" : " — متوقفة"}`;
      option.disabled = !enabled.has(item.name) && current !== item.name;
      select.appendChild(option);
    });
    select.value = current && [...select.options].some(option => option.value === current) ? current : "";
    if (!select.value) first.selected = true;
  }

  function label(value) {
    const name = normalize(value);
    return governorates.find(item => item.name === name)?.label || name || String(value || "");
  }

  window.KarwaGovernorates = Object.freeze({ all: governorates, normalize, label, enabledNames, isEnabled, populateSelect });
})();
