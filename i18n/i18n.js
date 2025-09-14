/**
 * Lightweight i18n for the extension.
 * Compatible with:
 *  - data-i18n-key="..." for element text
 *  - data-i18n-placeholder="..." for input placeholders
 * Exposes window.__extI18n with getLang()/setLang(langCode) where langCode is 'ukr' or 'eng'.
 */
(function(){
  const STORAGE_KEY = "ext_lang";       // stores 'ukr' | 'eng'
  const CODE_TO_FILE = { ukr: "uk", eng: "en" };
  const FILE_TO_CODE = { uk: "ukr", en: "eng" };

  let current = (localStorage.getItem(STORAGE_KEY) || "").toLowerCase();
  if (!current || !CODE_TO_FILE[current]) {
    // try from <html lang="...">
    const htmlLang = (document.documentElement.lang || "uk").slice(0,2).toLowerCase();
    current = FILE_TO_CODE[htmlLang] || "ukr";
  }
  let dict = null;

  function urlFor(langFile){
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      return chrome.runtime.getURL(`i18n/${langFile}.json`);
    }
    if (document.currentScript && document.currentScript.src) {
      const base = document.currentScript.src.replace(/i18n\/i18n\.js.*$/, 'i18n/');
      return `${base}${langFile}.json`;
    }
    return `i18n/${langFile}.json`;
  }

  async function load(langCode){ // 'ukr' | 'eng'
    const file = CODE_TO_FILE[langCode] || "uk";
    const res = await fetch(urlFor(file));
    const json = await res.json();
    return { file, json };
  }

  function applyTranslations(){
    if (!dict) return;
    // text nodes by key
    document.querySelectorAll("[data-i18n-key]").forEach(el=>{
      const key = el.getAttribute("data-i18n-key");
      if (key && dict[key]) el.textContent = dict[key];
    });
    // placeholders
    document.querySelectorAll("[data-i18n-placeholder]").forEach(el=>{
      const key = el.getAttribute("data-i18n-placeholder");
      if (key && dict[key] && "placeholder" in el) el.placeholder = dict[key];
    });
    // Optional: title tooltips
    document.querySelectorAll("[data-i18n-title]").forEach(el=>{
      const key = el.getAttribute("data-i18n-title");
      if (key && dict[key]) el.title = dict[key];
    });
  }

  async function setLang(langCode){ // 'ukr' | 'eng'
    if (!CODE_TO_FILE[langCode]) langCode = "ukr";
    current = langCode;
    localStorage.setItem(STORAGE_KEY, current);
    const { file, json } = await load(current);
    dict = json;
    // reflect in <html lang="...">
    document.documentElement.lang = file;
    applyTranslations();
  }

  function getLang(){ return current; }

  // expose the legacy-compatible API for app.js
  window.__extI18n = { getLang, setLang };

  // init
  setLang(current);
})();
