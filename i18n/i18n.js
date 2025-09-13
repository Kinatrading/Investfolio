
(function(){
  const STORAGE_KEY = "ext_lang";
  let current = "uk";
  let _lastDict = null;

  async function loadDict(lang){
    const base = (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function')
      ? chrome.runtime.getURL('i18n/')
      : (document.currentScript && document.currentScript.src
         ? document.currentScript.src.replace(/i18n\/i18n\.js.*/, 'i18n/')
         : 'i18n/');
    const url = `${base}${lang}.json`;
    const res = await fetch(url);
    return await res.json();
  }

  function applyDict(dict){
    _lastDict = dict;
    document.querySelectorAll("[data-i18n-key]").forEach(el=>{
      const key = el.getAttribute("data-i18n-key");
      if (dict[key] !== undefined){
        el.textContent = dict[key];
      }
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(el=>{
      const key = el.getAttribute("data-i18n-placeholder");
      if (dict[key] !== undefined){
        el.setAttribute("placeholder", dict[key]);
      }
    });
    document.querySelectorAll("[data-i18n-title]").forEach(el=>{
      const key = el.getAttribute("data-i18n-title");
      if (dict[key] !== undefined){
        el.setAttribute("title", dict[key]);
      }
    });
    document.querySelectorAll("option[data-i18n-key]").forEach(op=>{
      const k = op.getAttribute("data-i18n-key");
      if (dict[k] !== undefined) op.textContent = dict[k];
    });
    const btn = document.getElementById("langBtn");
    if (btn){
      btn.textContent = (current === "en") ? "UKR" : "ENG";
      btn.title = (current === "en") ? "Switch to Ukrainian" : "Перемкнути на англійську";
    }
    document.documentElement.setAttribute("data-lang", current);
  }

  async function setLang(lang){
    current = lang;
    try{ await chrome.storage.local.set({[STORAGE_KEY]: lang}); }catch(e){}
    const dict = await loadDict(lang);
    applyDict(dict);
  }

  async function init(){
    try{
      const res = await new Promise(r=> chrome.storage.local.get([STORAGE_KEY], r));
      if (res && typeof res[STORAGE_KEY] === "string") current = res[STORAGE_KEY];
    }catch(e){}
    await setLang(current);
    const btn = document.getElementById("langBtn");
    if (btn){
      btn.addEventListener("click", async ()=>{
        current = (current === "en") ? "uk" : "en";
        await setLang(current);
      });
    }
  }

  (function(){
    let rafId = null;
    const mo = new MutationObserver(()=>{
      if (!_lastDict) return;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(()=>{ applyDict(_lastDict); });
    });
    try{ mo.observe(document.documentElement, {subtree:true, childList:true, characterData:true}); }catch(e){}
  })();

  window.__i18n = { setLang, getLang: ()=>current };
  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
