
// ===== helpers (no async/await used) =====
function unescapeHtmlString(s){
  if (!s) return "";
  return String(s)
    .replace(/\\"/g, '"')
    .replace(/\\\//g, '/')
    .replace(/\\n/g, '')
    .replace(/\\t/g, '')
    .replace(/\\r/g, '');
}
function stripTags(s){ return String(s||"").replace(/<[^>]*>/g, ''); }
function parseRowFromTable(htmlStr){
  try{
    const un = unescapeHtmlString(htmlStr||"");
    const parts = un.split(/<tr[^>]*>/i).slice(1);
    if (parts.length >= 2){
      const first = parts[1];
      const cells = first.split(/<\/?td[^>]*>/i).map(x=>x.trim()).filter(Boolean);
      if (cells.length >= 2){
        const priceTxt = stripTags(cells[0]).trim();
        const qtyTxt = stripTags(cells[1]).trim();
        const price = parseFloat(priceTxt.replace(/[^\d,\.]/g,'').replace(',','.'));
        const qty = parseInt(qtyTxt.replace(/[^\d]/g,''), 10);
        return { price:isFinite(price)?price:null, qty:isFinite(qty)?qty:null };
      }
    }
  }catch(e){ console.warn("parseRowFromTable", e); }
  return { price:null, qty:null };
}

function pushLog(msg){
  try{
    chrome.storage.local.get(["logs"], function(st){
      var logs = st && st.logs ? st.logs : [];
      logs.push({ t: new Date().toISOString(), msg: String(msg).slice(0,500) });
      while (logs.length > 200) logs.shift();
      chrome.storage.local.set({ logs: logs });
    });
  }catch(e){}
}
function setDiag(obj){
  chrome.storage.local.get(["diag"], function(st){
    var diag = Object.assign({}, st && st.diag ? st.diag : {}, obj||{});
    chrome.storage.local.set({ diag: diag });
  });
}
function getAll(keys, cb){
  chrome.storage.local.get(keys, function(st){ cb(st||{}); });
}
function loadAll(cb){
  getAll(["items","settings"], function(st){
    cb({ items: st.items||[], settings: st.settings||{} });
  });
}
function saveItems(items, cb){
  chrome.storage.local.set({ items: items }, function(){ if(cb) cb(); });
}

// ====== fetch one item (Promise) ======
function fetchOne(it){
  return fetch(it.apiUrl, { cache: "no-cache" })
    .then(function(res){ return res.json(); })
    .then(function(data){
      var firstSell = {price:null, qty:null}, firstBuy={price:null, qty:null};
      if (data.sell_order_table) firstSell = parseRowFromTable(data.sell_order_table);
      if (data.buy_order_table) firstBuy = parseRowFromTable(data.buy_order_table);
      if (firstSell.price==null && data.lowest_sell_order){
        var p = parseFloat(String(data.lowest_sell_order).replace(/[^\d,\.]/g,'').replace(',','.'));
        if (isFinite(p)) firstSell.price = p;
      }
      if (firstBuy.price==null && data.highest_buy_order){
        var b = parseFloat(String(data.highest_buy_order).replace(/[^\d,\.]/g,'').replace(',','.'));
        if (isFinite(b)) firstBuy.price = b;
      }
      return { firstSell:firstSell, firstBuy:firstBuy, ts: new Date().toISOString() };
    });
}

function maybeNotify(item, firstSell, firstBuy, settings){
  try{ item.alertHits = (item.alertHits||0); }catch(e){}
  var fee = (item.feePct!=null ? item.feePct : (settings.feePct!=null ? settings.feePct : 0.15));
  var netBuyOrder = (firstBuy.price!=null) ? firstBuy.price * (1-fee) : null;
  var listing = firstSell.price;
  var messages = [];
  if (item.alertBuyAtOrBelow!=null && listing!=null && listing <= item.alertBuyAtOrBelow){
    messages.push("Listing ≤ ₴"+listing.toFixed(2)+" (≤ target ₴"+item.alertBuyAtOrBelow+")");
  }
  if (item.alertSellAtOrAbove!=null && netBuyOrder!=null && netBuyOrder >= item.alertSellAtOrAbove){
    messages.push("Buy-order net ≥ ₴"+netBuyOrder.toFixed(2)+" (≥ target ₴"+item.alertSellAtOrAbove+")");
  }
  if (messages.length){
    try{
      item.alertHits = (item.alertHits||0) + 1;
      item.lastAlertAt = new Date().toISOString();
      item.lastAlertMsg = messages.join("\\n");
    }catch(e){}
    chrome.notifications.create('', {
      type: 'basic',
      iconUrl: 'icon128.png',
      title: item.name || "Steam Invest Ultra",
      message: messages.join('\\n'),
      priority: 2
    });
    pushLog("ALERT "+(item.name||"")+": "+messages.join(" | "));
  }
}

// ====== batch scan (sequential) ======
function batchScan(){
  pushLog("batchScan start");
  var startedAt = Date.now();
  var touched = 0, errs = 0;

  loadAll(function(all){
    var items = all.items || [];
    var settings = all.settings || {};
    var delay = settings.batchDelayMs || 200;

    function next(i){
      if (i >= items.length){
        setDiag({ lastBatchAt: new Date().toISOString(), lastBatchMs: Date.now()-startedAt, lastBatchItems: touched, lastBatchErrors: errs });
        saveItems(items, function(){
          pushLog("batchScan done: items="+touched+", errors="+errs);
        });
        return;
      }
      var it = items[i];
      if (!it || !it.apiUrl){
        return setTimeout(function(){ next(i+1); }, 0);
      }
      fetchOne(it).then(function(res){
        it.firstSellPrice = res.firstSell.price;
        it.firstSellQty = res.firstSell.qty;
        it.firstBuyPrice = res.firstBuy.price;
        it.firstBuyQty = res.firstBuy.qty;
        it.lastFetchedAt = res.ts;
        it.priceHistory = it.priceHistory || [];
        it.priceHistory.push({ t: res.ts, s: it.firstSellPrice, b: it.firstBuyPrice });
        if (it.priceHistory.length > 600) it.priceHistory.shift();
        touched++;
        maybeNotify(it, res.firstSell, res.firstBuy, settings);
      }).catch(function(e){
        console.warn("batchScan error", e);
        errs++;
        pushLog("scan error: "+e);
      }).finally(function(){
        saveItems(items, function(){
          setTimeout(function(){ next(i+1); }, delay);
        });
      });
    }
    next(0);
  });
}

// ====== alarms ======
function resetAlarm(){
  pushLog("resetAlarm");
  loadAll(function(all){
    var mins = (all.settings && all.settings.autoRefreshMinutes) || 0;
    chrome.alarms.clear('autoRefresh', function(){
      if (mins > 0){
        chrome.alarms.create('autoRefresh', { periodInMinutes: Math.max(0.1, mins) });
        setDiag({ alarmMinutes: mins, alarmSetAt: new Date().toISOString() });
      }
    });
  });
}

// ====== lifecycle ======
chrome.runtime.onInstalled.addListener(function(){
  loadAll(function(all){
    var s = all.settings || {};
    var merged = {
      feePct: (s.feePct!=null ? s.feePct : 0.15),
      autoRefreshMinutes: (s.autoRefreshMinutes!=null ? s.autoRefreshMinutes : 0),
      batchDelayMs: (s.batchDelayMs!=null ? s.batchDelayMs : 200),
      valuationMode: s.valuationMode || 'sell',
      theme: s.theme || 'light'
    };
    chrome.storage.local.set({ settings: merged }, function(){
      resetAlarm();
    });
  });
});
chrome.runtime.onStartup.addListener(function(){ resetAlarm(); });

chrome.alarms.onAlarm.addListener(function(alarm){
  if (alarm && alarm.name === 'autoRefresh') batchScan();
});

// ====== messaging (UI ↔ SW) ======
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse){
  if (!msg) return;
  if (msg.type === 'batchScan'){
    batchScan();
    sendResponse({ ok:true });
    return true;
  }
  if (msg.type === 'getDiag'){
    getAll(["diag","logs","settings","items"], function(st){
      sendResponse({ diag: st.diag||{}, logs: st.logs||[], settings: st.settings||{}, items: st.items||[] });
    });
    return true;
  }
  if (msg.type === 'testAlert'){
    chrome.notifications.create('', {
      type: 'basic', iconUrl:'icon128.png', title: 'Тестове сповіщення', message: 'Це тест нотифікації від Steam Invest Ultra', priority: 2
    });
    pushLog('testAlert');
    sendResponse({ok:true});
    return true;
  }
});

// ====== open window on toolbar click ======
chrome.action.onClicked.addListener(function(){
  var url = chrome.runtime.getURL("app.html");
  chrome.windows.create({ url: url, type: "popup", width: 1200, height: 860 });
});



// === Autofill API link plumbing ===
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse){
  try{
    if (!msg || msg.type !== 'FETCH_API_LINK') return;
    (async function(){
      try{
        const listingUrl = String(msg.listingUrl||'').trim();
        if (!/^https:\/\/steamcommunity\.com\/market\/listings\//i.test(listingUrl)){
          return sendResponse({ ok:false, error:'Неправильна сторінка предмета' });
        }
        // Open hidden tab
        const tab = await chrome.tabs.create({ url: listingUrl, active: false });
        await waitForTabComplete(tab.id);
        // Extract item_nameid
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: function(){
            try{
              const html = document.documentElement.innerHTML;
              const m1 = html.match(/Market_LoadOrderSpread\(\s*(\d+)\s*\)/);
              if (m1 && m1[1]) return { ok:true, itemNameId: m1[1] };
              const m2 = html.match(/"item_nameid"\s*:\s*"(\d+)"/);
              if (m2 && m2[1]) return { ok:true, itemNameId: m2[1] };
              const scripts = Array.from(document.scripts).map(s => s.textContent || '');
              for (const s of scripts){
                const m = s.match(/Market_LoadOrderSpread\(\s*(\d+)\s*\)/) || s.match(/"item_nameid"\s*:\s*"(\d+)"/);
                if (m && m[1]) return { ok:true, itemNameId: m[1] };
              }
              return { ok:false, error:'item_nameid not found' };
            } catch(e){ return { ok:false, error: String(e) }; }
          }
        });
        try { await chrome.tabs.remove(tab.id); } catch(e){}
        if (!result || !result.itemNameId){
          return sendResponse({ ok:false, error: (result && result.error) || 'item_nameid not found' });
        }
        const params = new URLSearchParams({
          country: 'US',
          language: 'english',
          currency: '1',
          item_nameid: String(result.itemNameId),
          two_factor: '0'
        });
        const apiUrl = 'https://steamcommunity.com/market/itemordershistogram?' + params.toString();
        sendResponse({ ok:true, apiUrl });
      } catch (e){
        sendResponse({ ok:false, error: String(e && e.message || e) });
      }
    })();
    return true;
  } catch(e){
    sendResponse({ ok:false, error:String(e) });
  }
});

function waitForTabComplete(tabId){
  return new Promise(function(resolve, reject){
    const to = setTimeout(function(){ cleanup(); reject(new Error('timeout loading listing page')); }, 30000);
    function onUpdated(id, info){
      if (id===tabId && info && info.status==='complete'){
        clearTimeout(to); cleanup(); resolve();
      }
    }
    function cleanup(){ chrome.tabs.onUpdated.removeListener(onUpdated); }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}
