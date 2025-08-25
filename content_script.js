
// MV3 content script for Steam listing pages
(function(){
  try{
    // Only on listing pages
    const href = location.href;
    if (!/steamcommunity\.com\/market\/listings\/\d+\//.test(href)) return;

    // Create button
    const btn = document.createElement('button');
    btn.textContent = 'Додати предмет';
    btn.id = 'siu-add-item-btn';
    btn.style.position = 'fixed';
    btn.style.top = '90px';
    btn.style.right = '20px';
    btn.style.zIndex = '999999';
    btn.style.padding = '10px 14px';
    btn.style.fontSize = '14px';
    btn.style.borderRadius = '8px';
    btn.style.border = 'none';
    btn.style.cursor = 'pointer';
    btn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
    // Steam light/dark aware
    const isDark = document.documentElement.classList.contains('darkmode') || document.body.classList.contains('darkmode');
    function paint(){
      const dark = isDark;
      btn.style.background = dark ? '#1a9fff' : '#0ea5e9';
      btn.style.color = '#fff';
    }
    paint();

    // Try to insert into header if exists, else fixed
    const header = document.querySelector('.market_listing_header') || document.querySelector('#BG_top') || document.body;
    header.appendChild(btn);
    // Create input panel
    const panel = document.createElement('div');
    panel.id = 'siu-add-panel';
    panel.style.position = 'fixed';
    panel.style.top = '130px';
    panel.style.right = '20px';
    panel.style.zIndex = '999999';
    panel.style.display = 'grid';
    panel.style.gridTemplateColumns = 'auto auto';
    panel.style.gap = '6px 8px';
    panel.style.padding = '10px';
    panel.style.background = 'rgba(0,0,0,0.6)';
    panel.style.color = '#fff';
    panel.style.borderRadius = '8px';
    panel.style.backdropFilter = 'blur(2px)';
    function mk(label, id, ph){
      const l = document.createElement('label');
      l.textContent = label;
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.placeholder = ph || '';
      inp.id = id;
      inp.style.padding = '6px 8px';
      inp.style.borderRadius = '6px';
      inp.style.border = '1px solid rgba(255,255,255,0.2)';
      inp.style.background = 'rgba(255,255,255,0.08)';
      inp.style.color = '#fff';
      l.style.alignSelf = 'center';
      panel.appendChild(l);
      panel.appendChild(inp);
      return inp;
    }
    const qtyInp   = mk('Кількість','siu-qty','напр., 1');
    const priceInp = mk('Ціна','siu-price','напр., 2.50');
    const abInp    = mk('Alert buy ≤','siu-alert-buy','напр., 1.75');
    const asInp    = mk('Alert sell ≥','siu-alert-sell','напр., 3.20');
    document.body.appendChild(panel);

    function getName(){
      const cand = [
        '#largeiteminfo_item_name',
        '.market_listing_item_name',
        '.hover_item_name',
        '.market_listing_nav a:last-child',
        'h1'
      ];
      for (const sel of cand){
        const el = document.querySelector(sel);
        if (el && el.textContent && el.textContent.trim().length > 0){
          return el.textContent.trim();
        }
      }
      // Fallback: decode from URL path tail
      try{
        const tail = decodeURIComponent(href.split('/').pop());
        return tail.replace(/\+/g, ' ').trim();
      }catch(e){}
      return 'Unknown item';
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
      // Fallback: render endpoint (less ideal)
      let base = href.endsWith('/') ? href : href + '/';
      return base + 'render/?query=&start=0&count=100';
    }


    function toast(msg){
      const t = document.createElement('div');
      t.textContent = msg;
      t.style.position = 'fixed';
      t.style.bottom = '20px';
      t.style.right = '20px';
      t.style.background = 'rgba(0,0,0,0.8)';
      t.style.color = '#fff';
      t.style.padding = '10px 12px';
      t.style.borderRadius = '8px';
      t.style.zIndex = '999999';
      document.body.appendChild(t);
      setTimeout(()=> t.remove(), 2500);
    }

    btn.addEventListener('click', function(){
      const qty = parseFloat((document.getElementById('siu-qty')||{}).value || '');
      const price = parseFloat((document.getElementById('siu-price')||{}).value || '');
      const alertBuy = parseFloat((document.getElementById('siu-alert-buy')||{}).value || '');
      const alertSell = parseFloat((document.getElementById('siu-alert-sell')||{}).value || '');
      const item = {
        name: getName(),
        url: href,
        api_url: buildApiUrl(),
        source: 'steam_listing',
        ts: Date.now()
      };
      chrome.runtime.sendMessage({ type: 'ADD_ITEM', item, qty, price, alertBuy, alertSell }, function(resp){
        if (chrome.runtime.lastError){
          toast('Помилка: ' + chrome.runtime.lastError.message);
        }else{
          toast(resp && resp.ok ? 'Додано до бази' : 'Збережено');
        }
      });
    });

  }catch(err){
    // silent
    console.warn('SIU content script error', err);
  }
})();
