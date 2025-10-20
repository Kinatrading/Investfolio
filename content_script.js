// MV3 content script for Steam listing pages with built-in i18n loader
(async function(){
  try{
    const href = location.href;
    if (!/steamcommunity\.com\/market\/listings\/\d+\//.test(href)) return;

    // ---- i18n loader ----
    function getStorage(key){
      return new Promise(res => chrome.storage.local.get([key], v => res(v && v[key])));
    }
    async function getI18n(){
      let lang = await getStorage('lang');
      if (!lang) lang = 'uk';
      const url = chrome.runtime.getURL(`${lang}.json`);
      let dict = {};
      try{
        const r = await fetch(url);
        dict = await r.json();
      }catch(e){ dict = {}; }
      const t = (key, fallback) => (dict && key in dict ? dict[key] : (fallback ?? key));
      return { t };
    }
    const { t } = await getI18n();

    // ---- Add Item button ----
    const btn = document.createElement('button');
    btn.textContent = t('add_item','Add item');
    btn.id = 'siu-add-item-btn';
    Object.assign(btn.style, {
      position: 'fixed', top: '90px', right: '20px', zIndex: '999999',
      padding: '10px 14px', fontSize: '14px', borderRadius: '8px',
      border: 'none', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
      background: '#0ea5e9', color: '#fff'
    });
    (document.querySelector('.market_listing_header') || document.body).appendChild(btn);

    // ---- Overlay panel ----
    const panel = document.createElement('div');
    panel.id = 'siu-add-panel';
    Object.assign(panel.style, {
      position: 'fixed', top: '130px', right: '20px', zIndex: '999999',
      display: 'grid', gridTemplateColumns: 'auto auto', gap: '6px 8px',
      padding: '10px', background: 'rgba(0,0,0,0.6)', color: '#fff',
      borderRadius: '8px', backdropFilter: 'blur(2px)'
    });

    function mk(label, id, ph){
      const l = document.createElement('label');
      l.textContent = label;
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.placeholder = ph || '';
      inp.id = id;
      Object.assign(inp.style, {
        padding: '6px 8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.2)',
        background: 'rgba(255,255,255,0.08)', color: '#fff'
      });
      l.style.alignSelf = 'center';
      panel.appendChild(l); panel.appendChild(inp);
      return inp;
    }

    // ---- Stats row ----
    const statsRow = document.createElement('div');
    Object.assign(statsRow.style, { gridColumn: '1 / -1', fontSize: '12px', opacity: '0.9', marginBottom: '2px' });
    statsRow.id = 'siu-stats';
    statsRow.textContent = t('loading','Loading…');
    panel.appendChild(statsRow);

    // ---- Localized inputs ----
    const qtyInp   = mk(t('к_сть','Qty'),            'siu-qty',       t('qty__ph','e.g., 1'));
    const priceInp = mk(t('ціна','Price'),           'siu-price',     t('price__ph','e.g., 2.50'));
    const abInp    = mk(t('alert_buy','Alert Buy ≤'),'siu-alert-buy', t('alert_buy__ph','e.g., 1.75'));
    const asInp    = mk(t('alert_sell','Alert Sell ≥'),'siu-alert-sell', t('alert_sell__ph','e.g., 3.20'));

    document.body.appendChild(panel);
    loadPortfolioStatsFor(getName());

    function getName(){
      const cand = ['#largeiteminfo_item_name','.market_listing_item_name','.hover_item_name','.market_listing_nav a:last-child','h1'];
      for (const sel of cand){
        const el = document.querySelector(sel);
        if (el && el.textContent && el.textContent.trim()) return el.textContent.trim();
      }
      try{
        const tail = decodeURIComponent(href.split('/').pop());
        return tail.replace(/\+/g, ' ').trim();
      }catch(e){}
      return 'Unknown item';
    }

    function loadPortfolioStatsFor(name){
      try{
        chrome.storage.local.get(['items'], (data)=>{
          try{
            const items = Array.isArray(data.items) ? data.items : [];
            const it = items.find(x => (x && (x.name||'').trim().toLowerCase()) === (name||'').trim().toLowerCase());
            const statsEl = document.getElementById('siu-stats');
            if (!it){ if (statsEl) statsEl.textContent = t('overlay_no_portfolio','Not in your portfolio yet.'); return; }
            const buys = Array.isArray(it.lots) ? it.lots : [];
            const sells = Array.isArray(it.sells) ? it.sells : [];
            const buysQty  = buys.reduce((s,x)=> s + (+x.qty||0), 0);
            const buysCost = buys.reduce((s,x)=> s + (+x.qty||0) * (+x.price||0), 0);
            const sellsQty = sells.reduce((s,x)=> s + (+x.qty||0), 0);
            const sellsCostRemoved = sells.reduce((s,x)=> s + (+x.qty||0) * (+x.avgCostAtSale||0), 0);
            const heldQty = buysQty - sellsQty;
            const netCost = buysCost - sellsCostRemoved;
            const avgCost = heldQty > 0 ? (netCost / heldQty) : 0;
            if (statsEl){
              const fmt = (n)=> (isFinite(n) ? Number(n).toFixed(2) : '0.00');
              const tpl = t('overlay_stats','You hold: {qty} pcs · avg. cost {avg}');
              statsEl.textContent = tpl.replace('{qty}', String(heldQty)).replace('{avg}', fmt(avgCost));
            }
          }catch(e){}
        });
      }catch(e){}
    }

    function sniffVarsFromHtml(){
      const html = document.documentElement.innerHTML || '';
      const out = {};
      let m;
      m = html.match(/Market_LoadOrderSpread\(\s*(\d+)\s*\)/);
      if (m) out.item_nameid = m[1];
      if (!out.item_nameid){
        m = html.match(/"item_nameid"\s*:\s*"?(\d+)"?/);
        if (m) out.item_nameid = m[1];
      }
      m = html.match(/g_strCountryCode\s*=\s*"([A-Z]{2})"/i);
      if (m) out.country = m[1];
      m = html.match(/g_strLanguage\s*=\s*"([^"]+)"/i);
      if (m) out.language = m[1];
      m = html.match(/"wallet_currency"\s*:\s*(\d+)/i);
      if (m) out.currency = m[1];
      return out;
    }

    function buildApiUrl(){
      const v = sniffVarsFromHtml();
      if (v.item_nameid){
        const country = v.country || 'US';
        const language = v.language || 'english';
        const currency = v.currency || '1';
        const u = new URL('https://steamcommunity.com/market/itemordershistogram');
        u.searchParams.set('country', country);
        u.searchParams.set('language', language);
        u.searchParams.set('currency', String(currency));
        u.searchParams.set('item_nameid', String(v.item_nameid));
        return u.toString();
      }
      let base = href.endsWith('/') ? href : href + '/';
      return base + 'render/?query=&start=0&count=100';
    }

    function toast(msg){
      const tdiv = document.createElement('div');
      tdiv.textContent = msg;
      Object.assign(tdiv.style, { position: 'fixed', bottom: '20px', right: '20px',
                                  background: 'rgba(0,0,0,0.8)', color: '#fff',
                                  padding: '10px 12px', borderRadius: '8px', zIndex: '999999' });
      document.body.appendChild(tdiv);
      setTimeout(()=> tdiv.remove(), 2500);
    }

    btn.addEventListener('click', function(){
      const qty = parseFloat((document.getElementById('siu-qty')||{}).value || '');
      const price = parseFloat((document.getElementById('siu-price')||{}).value || '');
      const alertBuy = parseFloat((document.getElementById('siu-alert-buy')||{}).value || '');
      const alertSell = parseFloat((document.getElementById('siu-alert-sell')||{}).value || '');
      const item = { name: getName(), url: href, api_url: buildApiUrl(), source: 'steam_listing', ts: Date.now() };
      chrome.runtime.sendMessage({ type: 'ADD_ITEM', item, qty, price, alertBuy, alertSell }, function(resp){
        if (chrome.runtime.lastError){
          toast(t('error','Error:') + ' ' + chrome.runtime.lastError.message);
        }else{
          toast(resp && resp.ok ? t('added_to_db','Added to DB') : t('saved','Saved'));
        }
      });
    });

  }catch(err){
    console.warn('SIU content script error', err);
  }
})();