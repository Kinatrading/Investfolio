// Minimal i18n helper (vanilla, no frameworks)
(function(){
  const STORAGE_KEY = "ext_lang";
  let current = localStorage.getItem(STORAGE_KEY) || "uk";
  let dict = null;

  async function loadDict(lang){
    let url;
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
        url = chrome.runtime.getURL(`i18n/${lang}.json`);
      } else if (document.currentScript && document.currentScript.src) {
        const base = document.currentScript.src.replace(/i18n\/i18n\.js.*$/, 'i18n/');
        url = `${base}${lang}.json`;
      } else {
        url = `i18n/${lang}.json`;
      }
      const res = await fetch(url);
      return await res.json();
    } catch (e) {
      console.warn("i18n fetch failed", e);
      return {};
    }
  }

  async function setLang(lang){
    current = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    dict = await loadDict(lang);
    // Apply text to any elements that declare data-i18n keys
    document.querySelectorAll("[data-i18n]").forEach(el=>{
      const key = el.getAttribute("data-i18n");
      if (key && dict && dict[key]) el.textContent = dict[key];
    });
  }

  function t(key, fallback=""){
    return (dict && dict[key]) || fallback || key;
  }

  // expose
  window.i18n = { t, setLang, get lang(){ return current; } };

  // auto-init
  setLang(current);
})();
