/* global chrome */
const $ = (s) => document.querySelector(s);
const tbody = $("#tbl tbody");
const histBody = $("#hist tbody");
const summaryEl = $("#summary");
const itemSelect = $("#itemSelect");
const mkt = $("#mkt");
const links = $("#links");
const chart = $("#chart");
const hdrUnreal = $("#hdrUnreal");
const rootEl = document.documentElement; // <html>, щоб тема працювала всюди

// ---- сортування (існуюча логіка з індикаторами) ----
let sortState = { key: null, dir: 'desc' }; // 'asc' | 'desc'
function getSortVal(it, key){
  const m = calc(it);
  switch(key){
    case 'name': return (it.name||'').toLowerCase();
    case 'qty': return m.heldQty ?? -Infinity;
    case 'avg': return m.avgCost ?? -Infinity;
    case 'invested': return m.netCost ?? -Infinity;
    case 'market': return m.marketPrice ?? -Infinity;
    case 'unreal': return m.unrealized ?? -Infinity;
    case 'roi': return m.roi ?? -Infinity;
    case 'vol': return m.vol ?? -Infinity;
    case 'sell1': return it.firstSellPrice ?? -Infinity;
    case 'buy1': return it.firstBuyPrice ?? -Infinity;
    case 'last': return new Date(it.lastFetchedAt||0).getTime();
    default: return 0;
  }
}
function applySort(arr){
  if (!sortState.key) return arr;
  const key = sortState.key, dir = sortState.dir;
  return arr.slice().sort((a,b)=>{
    const va = getSortVal(a,key), vb = getSortVal(b,key);
    let cmp;
    if (typeof va === 'string' || typeof vb === 'string'){
      cmp = String(va).localeCompare(String(vb));
    } else {
      const A = (va==null ? -Infinity : va);
      const B = (vb==null ? -Infinity : vb);
      cmp = A < B ? -1 : (A > B ? 1 : 0);
    }
    return dir==='asc' ? cmp : -cmp;
  });
}
function updateSortIndicators(){
  document.querySelectorAll('#tbl thead th[data-sort]').forEach(th=>{
    const arrow = th.querySelector('.arrow');
    if (!arrow) return;
    arrow.textContent = (sortState.key===th.dataset.sort) ? (sortState.dir==='asc'?'▲':'▼') : '';
  });
}
function bindSorting(){
  document.querySelectorAll('#tbl thead th[data-sort]').forEach(th=>{
    th.addEventListener('click', ()=>{
      const key = th.dataset.sort;
      if (sortState.key === key){
        sortState.dir = (sortState.dir==='asc'?'desc':'asc');
      } else {
        sortState.key = key;
        sortState.dir = (key==='name') ? 'asc' : 'desc';
      }
      updateSortIndicators();
      renderAll();
    });
  });
  updateSortIndicators();
}

// ---- діагностика з шапки ----
const d_alarm = $("#d_alarm"), d_alarm_at=$("#d_alarm_at"), d_batch=$("#d_batch"), d_stats=$("#d_stats"), d_log=$("#diagLog");

// ---- state ----
let state = { items: [], settings: { feePct: 0.15, autoRefreshMinutes: 0, batchDelayMs:200, valuationMode:'sell', telegramBotToken:'', telegramChatId:'', telegramParseMode:'MarkdownV2', theme:'light' } };
let depthCache = { sell: [], buy: [] };

// ---- utils ----
function uid(){ return Math.random().toString(36).slice(2, 9); }
function todayISO(){ return new Date().toISOString().slice(0,10); }
function fmt(n){ return (Number.isFinite(n) ? Number(n).toFixed(2) : ""); }
function sum(a){ return a.reduce((s,x)=>s+(x||0),0); }

function alertStatus(it){
  const fee = (it.feePct!=null ? it.feePct : state.settings.feePct);
  const listing = it.firstSellPrice;
  const netBuy = it.firstBuyPrice!=null ? it.firstBuyPrice*(1-fee) : null;
  const aBuy = it.alertBuyAtOrBelow;
  const aSell = it.alertSellAtOrAbove;
  const tags=[];
  if (aBuy!=null && Number.isFinite(listing)){
    if (listing <= aBuy) tags.push("BUY🔥");
    else tags.push(`buy: ${fmt(listing)}>${fmt(aBuy)}`);
  }
  if (aSell!=null && Number.isFinite(netBuy)){
    if (netBuy >= aSell) tags.push("SELL✅");
    else tags.push(`sell(net): ${fmt(netBuy)}<${fmt(aSell)}`);
  }
  if (it.alertHits) tags.push(`hits:${it.alertHits}`);
  if (it.lastAlertAt) tags.push(`last:${it.lastAlertAt}`);
  return tags.join(" | ");
}

function ensureShapes(){
  for (const it of state.items){
    it.lots ||= [];
    it.sells ||= [];
    it.itemUrl ||= "";
    it.apiUrl ||= "";
    it.tags ||= "";
    it.priceHistory ||= [];
    for (const b of it.lots){ b.id ||= uid(); }
    for (const s of it.sells){ s.id ||= uid(); }
  }
}

async function load(){
  const { items=[], settings={} } = await chrome.storage.local.get(["items","settings"]);
  state.items = items; state.settings = Object.assign(state.settings, settings||{});
  rootEl.classList.toggle('dark', state.settings.theme==='dark'); // темна тема на <html>
  ensureShapes();
  renderAll();
  renderSettings();
}

async function save(){
  await chrome.storage.local.set({ items: state.items, settings: state.settings });
  renderAll();
}

// ---- фінмодель ----

function calc(it){
  const buys = Array.isArray(it.lots) ? it.lots : [];
  const sells = Array.isArray(it.sells) ? it.sells : [];

  const buysQty  = buys.reduce((s,x)=> s + (+x.qty||0), 0);
  const buysCost = buys.reduce((s,x)=> s + (+x.qty||0) * (+x.price||0), 0);

  const sellsQty = sells.reduce((s,x)=> s + (+x.qty||0), 0);
  const sellsCostRemoved = sells.reduce((s,x)=> s + (+x.qty||0) * (+x.avgCostAtSale||0), 0);

  const heldQty = buysQty - sellsQty;
  const netCost = buysCost - sellsCostRemoved;
  const avgCost = heldQty > 0 ? netCost / heldQty : 0;

  const fee = (it.feePct!=null ? it.feePct : state.settings.feePct);

  const realized = sells.reduce((s,x)=> s + (+x.qty||0) * ( (+x.price||0) - (+x.avgCostAtSale||0) ), 0);

  const marketPrice = state.settings.valuationMode==='buy'
    ? (it.firstBuyPrice!=null ? (+it.firstBuyPrice)*(1-fee) : null)
    : (it.firstSellPrice!=null ? (+it.firstSellPrice)*(1-fee) : null);

  const marketValue = (marketPrice!=null) ? marketPrice * heldQty : null;
  const unrealized = (marketValue!=null) ? (marketValue - netCost) : null;
  const roi = (unrealized!=null && netCost>0) ? (unrealized/netCost*100) : null;
  const vol = volatility(it); // std dev останніх 30 цін

  // Реалізовані показники
  const realizedValue = sells.reduce((s,x)=> s + (+x.qty||0) * (+x.price||0), 0);
  const realizedQty = sellsQty;
  const realizedAvgSell = realizedQty>0 ? (realizedValue / realizedQty) : null;

  return { heldQty, avgCost, netCost, realized, marketPrice, unrealized, roi, vol, realizedQty, realizedAvgSell };
}


function volatility(it){
  const prices = (it.priceHistory||[]).slice(-30).map(p => (state.settings.valuationMode==='buy'? p.b : p.s)).filter(v=>Number.isFinite(v));
  if (prices.length<2) return null;
  const m = sum(prices)/prices.length;
  const variance = sum(prices.map(v => (v-m)*(v-m))) / (prices.length-1);
  return Math.sqrt(variance);
}

// ---- спарклайн обраного айтема (як було) ----
function drawChart(item){
  if (!chart || !chart.getContext) return;
  const ctx = chart.getContext("2d");
  ctx.clearRect(0,0,chart.width,chart.height);
  const hist = item?.priceHistory || [];
  if (!hist.length) return;
  const data = hist.slice(-60).map(p => (state.settings.valuationMode==='buy' ? p.b : p.s)).filter(x => x!=null);
  if (data.length < 2) return;
  const min = Math.min(...data), max = Math.max(...data);
  const pad = 8;
  const w = chart.width - pad*2, h = chart.height - pad*2;
  ctx.beginPath();
  data.forEach((v,i)=>{
    const x = pad + i*(w/(data.length-1));
    const y = pad + (max===min? h/2 : h - (v-min)/(max-min)*h);
    if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#0ea5e9";
  ctx.stroke();
}

function renderSettings(){
  $("#feePct").value = (state.settings.feePct*100).toFixed(2).replace(/\.?0+$/,'');
  $("#autoRefreshMinutes").value = String(state.settings.autoRefreshMinutes||0);
  $("#batchDelayMs").value = String(state.settings.batchDelayMs||200);
  $("#valuationMode").value = state.settings.valuationMode||'sell';
}

function portfolioTotals(){
  let totalInvested=0, totalRealized=0, totalUnreal=0;
  for (const it of state.items){
    const m=calc(it);
    totalInvested+=m.netCost; totalRealized+=m.realized; if (m.unrealized!=null) totalUnreal+=m.unrealized;
  }
  return { totalInvested, totalRealized, totalUnreal };
}

// ---- головний рендер ----
function renderAll(){
  // фільтр по пошуку/теґах
  const query = ($("#search").value||"").toLowerCase().trim();
  const filter = (it)=>{
    if (!query) return true;
    return it.name.toLowerCase().includes(query) || (it.tags||"").toLowerCase().includes(query);
  };

  // селект
  itemSelect.innerHTML = "";
  for (const it of state.items.filter(filter)){
    const opt = document.createElement("option");
    opt.value = it.id; opt.textContent = it.name;
    itemSelect.appendChild(opt);
  }
  const selId = itemSelect.value || (itemSelect.options[0]?.value);
  if (selId) itemSelect.value = selId;
  const sel = state.items.find(x=>x.id===itemSelect.value);
  if (sel){
    links && (links.innerHTML = `${sel.itemUrl?`<a target="_blank" href="${sel.itemUrl}">Предмет</a>`:"(немає посилання)"}<br>` +
      `${sel.apiUrl?`<a target="_blank" href="${sel.apiUrl}">API</a>`:"(немає API URL)"}<br>` +
      `<span class="note">Теги: ${sel.tags||"(немає)"}</span>`);
    drawChart(sel);
    renderBreakeven(sel);
    renderDepth();
  }

  // таблиця портфелю
  tbody.innerHTML = "";
  let rows = state.items.filter(filter);
  rows = applySort(rows);
  let totalInvested=0, totalRealized=0, totalUnreal=0;
  for (const it of rows){
    const m = calc(it);
    totalInvested+=m.netCost; totalRealized+=m.realized; if (m.unrealized!=null) totalUnreal+=m.unrealized;

    const tr = document.createElement("tr");
    
    
    tr.innerHTML = `
      <td>${it.itemUrl ? `<a href="${it.itemUrl}" target="_blank" rel="noopener noreferrer">${it.name}</a>` : it.name}</td>
	  <td>${it.tags||""}</td>
      <td>${m.heldQty}</td>
      <td>${fmt(m.avgCost)}</td>
      <td>${fmt(m.netCost)}</td>
      <td>${m.marketPrice!=null? fmt(m.marketPrice):""}</td>
      <td>${m.unrealized!=null? fmt(m.unrealized):""}</td>
      <td>${m.roi!=null? fmt(m.roi):""}</td>
      <td>${m.vol!=null? fmt(m.vol):""}</td>
      <td>${it.firstSellPrice!=null? fmt(it.firstSellPrice):""} ${it.firstSellQty!=null?('×'+it.firstSellQty):""}</td>
      <td>${it.firstBuyPrice!=null? fmt(it.firstBuyPrice):""} ${it.firstBuyQty!=null?('×'+it.firstBuyQty):""}</td>
      <td><input class="alertBuy" data-id="${it.id}" type="number" step="0.01" value="${it.alertBuyAtOrBelow??""}" style="width:8em"/></td>
      <td><input class="alertSell" data-id="${it.id}" type="number" step="0.01" value="${it.alertSellAtOrAbove??""}" style="width:9em"/></td>
      <td title="Середня ціна по всіх продажах">${(m.realizedQty>0 && m.realizedAvgSell!=null)? fmt(m.realizedAvgSell):""}</td>
      <td title="Загальна кількість проданих одиниць">${m.realizedQty>0? m.realizedQty:""}</td>
      <td>${alertStatus(it)}</td>
      <td>${it.lastFetchedAt || it.createdAt || ""}</td>
      <td><button class="action-btn" data-del-item="${it.id}">🗑️</button></td>
    `
    tbody.appendChild(tr);
  }
    // агреговані показники реалізації для підсумку
  let aggQty = 0, aggValue = 0;
  for (const it of rows){
    const m2 = calc(it);
    if (m2.realizedQty){ aggQty += m2.realizedQty; aggValue += m2.realizedQty * (m2.realizedAvgSell||0); }
  }
  const aggAvg = aggQty>0 ? (aggValue/aggQty) : null;
summaryEl.textContent = `Позицій: ${rows.length} • Нетто вкладено: ₴${fmt(totalInvested)} • Realized PnL: ₴${fmt(totalRealized)}  • Unrealized PnL: ₴${fmt(totalUnreal)}`;
  hdrUnreal.textContent = `Unrealized ₴${fmt(totalUnreal)}`;

  // історія
  histBody.innerHTML = "";
  const hrows = [];
  for (const it of state.items){
    for (const b of it.lots) hrows.push({ itemId: it.id, kind:"buy", id:b.id, date:b.date, name:it.name, qty:b.qty, price:b.price, avg:"", pnl:"" });
    for (const s of it.sells) {
      const pnl = s.qty * ( s.price - (s.avgCostAtSale||0) );
      hrows.push({ itemId: it.id, kind:"sell", id:s.id, date:s.date, name:it.name, qty:s.qty, price:s.price, avg:s.avgCostAtSale, pnl });
    }
  }
  hrows.sort((a,b)=> String(a.date).localeCompare(String(b.date)));
  for (const r of hrows){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.date||""}</td>
      <td>${r.kind==="buy"?"Buy":"Sell"}</td>
      <td>${r.name}</td>
      <td>${r.qty}</td>
      <td>${fmt(r.price)}</td>
      <td>${fmt(r.avg)}</td>
      <td>${fmt(r.pnl)}</td>
      <td>
        <button class="action-btn" data-edit="${r.itemId}:${r.kind}:${r.id}">✎</button>
        <button class="action-btn" data-del="${r.itemId}:${r.kind}:${r.id}">🗑️</button>
      </td>
    `;
    histBody.appendChild(tr);
  }

  // хендлери
  tbody.onclick = (e)=>{
    const t = e.target;
    if (t.dataset.delItem){
      if (confirm("Видалити позицію разом з історією?")){
        state.items = state.items.filter(x=>x.id!==t.dataset.delItem);
        save();
      }
    }
    if (t.dataset.editItemurl){
      const it = state.items.find(x=>x.id===t.dataset.editItemurl);
      const val = prompt("Item URL:", it.itemUrl||"");
      if (val!==null){ it.itemUrl = val.trim(); save(); }
    }
    if (t.dataset.editApiurl){
      const it = state.items.find(x=>x.id===t.dataset.editApiurl);
      const val = prompt("API URL:", it.apiUrl||"");
      if (val!==null){ it.apiUrl = val.trim(); save(); }
    }
  };
  tbody.onchange = (e)=>{
    const t = e.target;
    if (t.classList.contains("alertBuy")){
      const it = state.items.find(x=>x.id===t.dataset.id);
      it.alertBuyAtOrBelow = t.value ? parseFloat(t.value) : null;
      save();
    }
    if (t.classList.contains("alertSell")){
      const it = state.items.find(x=>x.id===t.dataset.id);
      it.alertSellAtOrAbove = t.value ? parseFloat(t.value) : null;
      save();
    }
  };
  histBody.onclick = (e)=>{
    const t = e.target;
    if (t.dataset.del){
      const [itemId, kind, id] = t.dataset.del.split(":");
      const it = state.items.find(x=>x.id===itemId);
      if (!it) return;
      if (confirm("Видалити запис історії?")){
        if (kind==="buy") it.lots = it.lots.filter(x=>x.id!==id);
        else it.sells = it.sells.filter(x=>x.id!==id);
        save();
      }
    }
    if (t.dataset.edit){
      const [itemId, kind, id] = t.dataset.edit.split(":");
      const it = state.items.find(x=>x.id===itemId);
      if (!it) return;
      if (kind==="buy"){
        const rec = it.lots.find(x=>x.id===id);
        const qty = prompt("К-сть:", rec.qty);  if (qty===null) return;
        const price = prompt("Ціна (грн):", rec.price); if (price===null) return;
        const date = prompt("Дата (YYYY-MM-DD):", rec.date||todayISO()); if (date===null) return;
        rec.qty = parseInt(qty,10);
        rec.price = parseFloat(price);
        rec.date = date;
        save();
      } else {
        const rec = it.sells.find(x=>x.id===id);
        const qty = prompt("К-сть:", rec.qty); if (qty===null) return;
        const price = prompt("Ціна (грн):", rec.price); if (price===null) return;
        const avg = prompt("Avg cost @ sale:", rec.avgCostAtSale); if (avg===null) return;
        const date = prompt("Дата (YYYY-MM-DD):", rec.date||todayISO()); if (date===null) return;
        rec.qty = parseInt(qty,10);
        rec.price = parseFloat(price);
        rec.avgCostAtSale = parseFloat(avg);
        rec.date = date;
        save();
      }
    }
  };
}

// ---- break-even ----
function renderBreakeven(it){
  const fee = (it.feePct!=null ? it.feePct : state.settings.feePct);
  const avg = calc(it).avgCost;
  const listingForBE = avg/(1-fee);
  $("#breakeven").innerHTML = `
    <div class="note">Avg: ₴${fmt(avg)}, Fee: ${(fee*100).toFixed(1)}%</div>
    <div>Break-even listing: <b>₴${fmt(listingForBE)}</b></div>
    <div>Break-even instant (buy-order net): <b>₴${fmt(avg)}</b></div>
  `;
}

// ---- глибина ринку ----
function renderDepth(){
  const tb = $("#depth tbody");
  tb.innerHTML = "";
  const rows = [];
  let cum=0;
  for (const r of (depthCache.sell||[])){ cum += (r.qty||0); rows.push(`<tr><td>sell</td><td>${fmt(r.price)}</td><td>${r.qty||""}</td><td>${cum}</td></tr>`); }
  cum=0;
  for (const r of (depthCache.buy||[])){ cum += (r.qty||0); rows.push(`<tr><td>buy</td><td>${fmt(r.price)}</td><td>${r.qty||""}</td><td>${cum}</td></tr>`); }
  tb.innerHTML = rows.join("");
}
function parseTopN(htmlStr, n){
  try{
    const un = htmlStr.replace(/\\"/g,'"').replace(/\\\//g,'/').replace(/\\n/g,'').replace(/\\t/g,'').replace(/\\r/g,'');
    const rows = un.split(/<tr[^>]*>/i).slice(1).slice(1, n+1);
    const out=[];
    for (const r of rows){
      const cells = r.split(/<\/?td[^>]*>/i).map(x=>x.trim()).filter(Boolean);
      if (cells.length>=2){
        const price = parseFloat(cells[0].replace(/<[^>]*>/g,'').replace(/[^\d,\.]/g,'').replace(',','.'));
        const qty = parseInt(cells[1].replace(/<[^>]*>/g,'').replace(/[^\d]/g,''),10);
        out.push({price, qty});
      }
    }
    return out;
  }catch(e){ return []; }
}

// ---- налаштування ----
async function saveSettings(){
  // pick up current inputs
  const tokEl = document.querySelector("#tgToken");
  const chatEl = document.querySelector("#tgChatId");
  if (tokEl) state.settings.telegramBotToken = tokEl.value.trim();
  if (chatEl) state.settings.telegramChatId = chatEl.value.trim();
  await chrome.storage.local.set({ settings: state.settings });
}


function debounce(fn, ms=200){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }
// ---- події UI ----
$("#saveSettingsBtn").addEventListener("click", async ()=>{
  state.settings.feePct = Math.max(0, parseFloat($("#feePct").value||"0")/100);
  state.settings.autoRefreshMinutes = Math.max(0, parseInt($("#autoRefreshMinutes").value||"0",10));
  state.settings.batchDelayMs = Math.max(50, parseInt($("#batchDelayMs").value||"200",10));
  state.settings.valuationMode = $("#valuationMode").value || 'sell';
  await saveSettings();
  alert("Збережено. Авто-оновлення перебудовано у фоновому режимі.");
});

$("#themeBtn").addEventListener("click", async ()=>{
  state.settings.theme = (state.settings.theme==='dark'?'light':'dark');
  rootEl.classList.toggle('dark', state.settings.theme==='dark'); // клас на <html>
  await saveSettings();
});

$("#createItemBtn").addEventListener("click", ()=>{
  const name = $("#name").value.trim();
  const tags = $("#tags").value.trim();
  const itemUrl = $("#itemUrl").value.trim();
  const apiUrl = $("#apiUrl").value.trim();
  if (!name){ alert("Вкажіть назву."); return; }
  // додано createdAt: щоб дата з'являлась одразу
  state.items.push({ id: uid(), name, tags, itemUrl, apiUrl, createdAt: todayISO(), lots: [], sells: [], firstSellPrice:null, firstSellQty:null, firstBuyPrice:null, firstBuyQty:null, lastFetchedAt:null, priceHistory:[] });
  $("#name").value = ""; $("#tags").value=""; $("#itemUrl").value=""; $("#apiUrl").value="";
  save();
});

$("#addBuyBtn").addEventListener("click", ()=>{
  const it = state.items.find(x=>x.id===itemSelect.value);
  if (!it){ alert("Немає вибраної позиції."); return; }
  const qty = parseInt($("#buyQty").value, 10);
  const price = parseFloat($("#buyPrice").value);
  const date = $("#opDate").value || todayISO();
  if (!Number.isFinite(qty) || qty<=0 || !Number.isFinite(price)){ alert("Заповніть коректно купівлю."); return; }
  it.lots.push({ id: uid(), qty, price, date });
  save();
});

$("#addSellBtn").addEventListener("click", ()=>{
  const it = state.items.find(x=>x.id===itemSelect.value);
  if (!it){ alert("Немає вибраної позиції."); return; }
  const qty = parseInt($("#sellQty").value, 10);
  const price = parseFloat($("#sellPrice").value);
  const date = $("#opDate").value || todayISO();
if (!Number.isFinite(qty) || qty<=0 || !Number.isFinite(price)){ alert("Заповніть коректно продаж."); return; }
  const m = calc(it);
  if (m.heldQty < qty){ alert("Недостатньо кількості в портфелі."); return; }
  const avgBefore = m.avgCost;
it.sells.push({ id: uid(), qty, price, date, avgCostAtSale: avgBefore });
  save();
});

$("#editLinksBtn").addEventListener("click", ()=>{
  const it = state.items.find(x=>x.id===itemSelect.value);
  if (!it){ alert("Немає вибраної позиції."); return; }
  const newItem = prompt("Item URL:", it.itemUrl||"");
  if (newItem!==null) it.itemUrl = newItem.trim();
  const newApi = prompt("API URL:", it.apiUrl||"");
  if (newApi!==null) it.apiUrl = newApi.trim();
  const fee = prompt("Комісія для позиції, % (опц.):", it.feePct!=null ? (it.feePct*100) : "");
  if (fee!==null && fee!==""){
    const f = parseFloat(fee);
    if (Number.isFinite(f)) it.feePct = Math.max(0, f/100);
  }
  const tags = prompt("Теги (через кому):", it.tags||"");
  if (tags!==null) it.tags = tags.trim();
  save();
});

// ---- запит до Steam API itemordershistogram ----
async function fetchOne(it){
  if (!it.apiUrl){ throw new Error("No API URL"); }
  const res = await fetch(it.apiUrl, { cache: "no-cache" });
  const data = await res.json();

  function unescapeHtmlString(s){ return String(s||"").replace(/\\"/g,'"').replace(/\\\//g,'/').replace(/\\n/g,'').replace(/\\t/g,'').replace(/\\r/g,''); }
  function stripTags(s){ return String(s||"").replace(/<[^>]*>/g,''); }
  function parseRowFromTable(htmlStr){
    try{
      const un = unescapeHtmlString(htmlStr||"");
      const rows = un.split(/<tr[^>]*>/i).slice(1);
      if (rows.length>=2){
        const cells = rows[1].split(/<\/?td[^>]*>/i).map(x=>x.trim()).filter(Boolean);
        if (cells.length>=2){
          const priceTxt = stripTags(cells[0]).trim();
          const qtyTxt = stripTags(cells[1]).trim();
          const price = parseFloat(priceTxt.replace(/[^\d,\.]/g,'').replace(',','.'));
          const qty = parseInt(qtyTxt.replace(/[^\d]/g,''),10);
          return { price, qty };
        }
      }
    
    } catch(e) {}
    return { price:null, qty:null };
  }

  let firstSell = {price:null, qty:null}, firstBuy = {price:null, qty:null};
  if (data.sell_order_table) firstSell = parseRowFromTable(data.sell_order_table);
  if (data.buy_order_table) firstBuy = parseRowFromTable(data.buy_order_table);
  if (firstSell.price==null && data.lowest_sell_order){
    const p = parseFloat(String(data.lowest_sell_order).replace(/[^\d,\.]/g,'').replace(',','.'));
    if (isFinite(p)) firstSell.price = p;
  }
  if (firstBuy.price==null && data.highest_buy_order){
    const b = parseFloat(String(data.highest_buy_order).replace(/[^\d,\.]/g,'').replace(',','.'));
    if (isFinite(b)) firstBuy.price = b;
  }

  it.firstSellPrice = firstSell.price; it.firstSellQty = firstSell.qty;
  it.firstBuyPrice = firstBuy.price;   it.firstBuyQty = firstBuy.qty;
  it.lastFetchedAt = new Date().toISOString();

  // історія цін для графіків
  it.priceHistory = it.priceHistory || [];
  it.priceHistory.push({ t: it.lastFetchedAt, s: it.firstSellPrice, b: it.firstBuyPrice });
  if (it.priceHistory.length > 600) it.priceHistory.shift();

  // depth top5
  depthCache.sell = data.sell_order_table ? parseTopN(data.sell_order_table, 5) : [];
  depthCache.buy  = data.buy_order_table ? parseTopN(data.buy_order_table, 5) : [];
  return it;
}

$("#fetchBtn").addEventListener("click", async ()=>{
  const it = state.items.find(x=>x.id===itemSelect.value);
  if (!it){ alert("Немає вибраної позиції."); return; }
  try{
    await fetchOne(it);
    const fee = (it.feePct!=null ? it.feePct : state.settings.feePct);
    const netSell = it.firstSellPrice!=null ? it.firstSellPrice*(1-fee) : null;
    const netBuy = it.firstBuyPrice!=null ? it.firstBuyPrice*(1-fee) : null;
    mkt.textContent = `Sell₴: ${fmt(it.firstSellPrice)} / Buy₴: ${fmt(it.firstBuyPrice)}  | Нетто: sell ${fmt(netSell)} / buy ${fmt(netBuy)}`;
    await save();
  }catch(e){
    console.error(e);
    alert("Не вдалося отримати дані (перевір API URL).");
  }
});

$("#scanAllBtn").addEventListener("click", ()=>{
  chrome.runtime.sendMessage({type:'batchScan'}, (resp)=>{
    if (resp && resp.ok) console.log("Batch scan started");
  });
});

$("#openAllBtn").addEventListener("click", ()=>{
  for (const it of state.items){ if (it.apiUrl) window.open(it.apiUrl, "_blank"); }
});

$("#exportJsonBtn").addEventListener("click", ()=>{
  const data = { items: state.items, settings: state.settings };
  const blob = new Blob([JSON.stringify(data,null,2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "steam_invest_ultra.json"; a.click();
  URL.revokeObjectURL(url);
});

$("#importFile").addEventListener("change", async (e)=>{
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  try{
    const data = JSON.parse(text);
    if (data.items) state.items = data.items;
    if (data.settings) state.settings = Object.assign(state.settings, data.settings);
    await save();
    alert("Імпорт виконано.");
  }catch(err){ alert("Не вдалось імпортувати JSON."); }
  e.target.value = "";
});

$("#clearBtn").addEventListener("click", async ()=>{
  if (confirm("Очистити всі дані портфеля?")){
    state.items = [];
    await save();
  }
});

itemSelect.addEventListener("change", ()=>{
  const it = state.items.find(x=>x.id===itemSelect.value);
  renderBreakeven(it); drawChart(it); renderDepth();
});

$("#roiTarget").addEventListener("keydown", (e)=>{ if(e.key==='Enter') $("#calcRoiBtn").click(); });
$("#search").addEventListener("input", debounce(()=>{ renderAll(); }, 150));

$("#calcRoiBtn").addEventListener("click", ()=>{
  const it = state.items.find(x=>x.id===itemSelect.value);
  if (!it) return;
  const m = calc(it);
  const fee = (it.feePct!=null ? it.feePct : state.settings.feePct);
  const roi = parseFloat($("#roiTarget").value||"0")/100;
  const targetNet = m.avgCost * (1+roi);
  const listingRequired = targetNet/(1-fee);
  $("#roiOut").textContent = `Для ROI ${Math.round(roi*100)}% лістинг ≈ ₴${fmt(listingRequired)} (нетто буде ₴${fmt(targetNet)})`;
});

// Хоткеї
document.addEventListener("keydown", (e)=>{
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase()==='s'){ $("#scanAllBtn").click(); }
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase()==='f'){ $("#fetchBtn").click(); }
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase()==='o'){ $("#openAllBtn").click(); }
});

$("#opDate").value = todayISO();
load();
bindSorting();

// ---- діагностика з background ----
async function refreshDiag(){
  return new Promise((resolve)=>{
    chrome.runtime.sendMessage({type:'getDiag'}, (resp)=>{
      try{
        const st = resp||{};
        d_alarm.textContent = (st.diag?.alarmMinutes!=null)? String(st.diag.alarmMinutes): (state.settings.autoRefreshMinutes||0);
        d_alarm_at.textContent = st.diag?.alarmSetAt || '(невідомо)';
        d_batch.textContent = st.diag?.lastBatchAt || '(ще не було)';
        const ms = st.diag?.lastBatchMs||0;
        const items = st.diag?.lastBatchItems||0;
        const errs = st.diag?.lastBatchErrors||0;
        d_stats.textContent = `${items} / ${errs} / ${ms}ms`;
        const logs = st.logs||[];
        d_log.value = logs.map(x => `[${x.t}] ${x.msg}`).join('\n');
      }catch(e){ d_log.value = 'diag error: '+e; }
      resolve();
    });
  });
}
$("#diagRefresh").addEventListener("click", refreshDiag);
$("#diagBatch").addEventListener("click", ()=> chrome.runtime.sendMessage({type:'batchScan'}));
$("#diagTest").addEventListener("click", ()=> chrome.runtime.sendMessage({type:'testAlert'}));
refreshDiag();

// ---- Автозаповнення API URL зі сторінки предмета ----
(function(){
  const btn = document.getElementById('autofillApiBtn');
  if (!btn) return;
  btn.addEventListener('click', function(){
    const urlEl = document.getElementById('itemUrl');
    const apiEl = document.getElementById('apiUrl');
    if (!urlEl || !apiEl){ alert('Не знайдено поля itemUrl/apiUrl'); return; }
    const listingUrl = String(urlEl.value||'').trim();
    if (!listingUrl){ alert('Вкажи лінк на сторінку предмета (Steam Market).'); return; }
    btn.disabled = true; btn.textContent = '⌛ Отримую…';
    chrome.runtime.sendMessage({ type:'FETCH_API_LINK', listingUrl }, function(resp){
      btn.disabled = false; btn.textContent = '➕ Автозаповнити API';
      if (chrome.runtime.lastError){ alert('Помилка: '+chrome.runtime.lastError.message); return; }
      if (!resp || !resp.ok){ alert('Не вдалося отримати API-лінк: '+(resp && resp.error ? resp.error : 'невідома помилка')); return; }
      apiEl.value = resp.apiUrl || '';
    });
  });
})();

// ---- Live-оновлення з background: миттєво перераховуємо Unrealized ----
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.items && changes.items.newValue) {
    try { state.items = changes.items.newValue; renderAll(); }
    catch(e){ console.warn('storage.onChanged renderAll error', e); }
  }
});

// ======== Динаміка портфелю (timeseries) ========

// зберігання таймсеріалу
const pnlChart = document.getElementById('pnlChart');
async function loadMetrics(){
  return new Promise(resolve => {
    chrome.storage.local.get({ metrics_timeseries_v1: [] }, (data)=> resolve(data.metrics_timeseries_v1 || []));
  });
}
function saveMetrics(arr){
  return new Promise(resolve => chrome.storage.local.set({ metrics_timeseries_v1: arr }, resolve));
}
async function saveMetricsPoint(point){
  try{
    const arr = await loadMetrics();
    const last = arr[arr.length-1];
    const tooSoon = last && (Date.now() - last.t < 30000);
    const same = last && last.invested===point.invested && last.realized===point.realized && last.unrealized===point.unrealized;
    if (!(tooSoon && same)){
      arr.push(point);
      if (arr.length>2000) arr.splice(0, arr.length-2000);
      await saveMetrics(arr);
      drawPortfolioChart(arr);
    }
  }catch(e){ console.warn('saveMetricsPoint', e); }
}

// «красиві» тики по Y та форматери
function niceTicks(min, max, maxTicks = 6){
  const span = max - min || 1;
  const step0 = span / Math.max(1, maxTicks - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = start; v <= end + 1e-9; v += step) ticks.push(v);
  return { ticks, start, end };
}
const fmtMoney = v => `₴${v.toFixed(2)}`;
const fmtDate = t => new Date(t).toLocaleDateString([], { day:'2-digit', month:'short' });

// респонсивний канвас (на всю ширину)
let __pnlArrCache = null;
function resizePnlCanvas(cvs){
  const dpr = window.devicePixelRatio || 1;
  const cssW = Math.floor(cvs.clientWidth || cvs.getBoundingClientRect().width || 540);
  let cssH = Math.floor(cvs.clientHeight || cvs.getBoundingClientRect().height || 0);
  if (cssH < 40) { cssH = 260; cvs.style.height = cssH+'px'; } // дефолт
  const need = cvs.width !== cssW * dpr || cvs.height !== cssH * dpr;
  if (need){
    const ctx = cvs.getContext('2d');
    cvs.width  = cssW * dpr;
    cvs.height = cssH * dpr;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.scale(dpr, dpr);
  }
}
window.addEventListener('resize', ()=>{
  if (!pnlChart) return;
  resizePnlCanvas(pnlChart);
  if (__pnlArrCache) drawPortfolioChart(__pnlArrCache);
});

// основний малюнок timeseries
function drawPortfolioChart(arr){
  const cvs = document.getElementById('pnlChart');
  if (!cvs || !cvs.getContext) return;
  __pnlArrCache = arr;
  resizePnlCanvas(cvs);

  const ctx = cvs.getContext('2d');
  const w = Math.floor(cvs.clientWidth || 540);
  const h = Math.floor(cvs.clientHeight || 260);

  ctx.clearRect(0,0,w,h);
  if (!arr || arr.length < 2) return;

  const inv = arr.map(p=>p.invested);
  const rea = arr.map(p=>p.realized);
  const unr = arr.map(p=>p.unrealized);
  const t0 = arr[0].t, t1 = arr[arr.length-1].t;

  const yMin = Math.min(...inv, ...rea, ...unr);
  const yMax = Math.max(...inv, ...rea, ...unr);

  // поля
  const left = 64, right = 10, top = 10, bottom = 28;
  const W = Math.max(10, w - left - right);
  const H = Math.max(10, h - top - bottom);

  // скейли
  const { ticks: yTicks, start: yStart, end: yEnd } = niceTicks(yMin, yMax, 6);
  const yScale = v => top + (H - (v - yStart) / (yEnd - yStart) * H);

  const xTicksCount = Math.min(7, arr.length);
  const xTicks = [];
  for (let i = 0; i < xTicksCount; i++){
    const t = t0 + i * (t1 - t0) / (xTicksCount - 1);
    xTicks.push(t);
  }
  const xScale = t => left + (t - t0) / Math.max(1, (t1 - t0)) * W;

  // кольори з теми
  const css = getComputedStyle(rootEl);
  const gridCol  = css.getPropertyValue('--axis-grid').trim()  || 'rgba(0,0,0,.12)';
  const textCol  = css.getPropertyValue('--axis-text').trim()  || '#444';
  const frameCol = css.getPropertyValue('--axis-frame').trim() || 'rgba(0,0,0,.35)';

  // сітка та підписи
  ctx.save();
  ctx.strokeStyle = gridCol;
  ctx.fillStyle   = textCol;
  ctx.lineWidth = 1;
  ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial';

  yTicks.forEach(val=>{
    const y = yScale(val);
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + W, y); ctx.stroke();
    ctx.fillText(fmtMoney(val), 6, y - 2);
  });

  xTicks.forEach((t)=>{
    const x = xScale(t);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + H); ctx.stroke();
    const lbl = fmtDate(t);
    const tw = ctx.measureText(lbl).width;
    ctx.fillText(lbl, Math.min(Math.max(x - tw/2, left), left + W - tw), h - 8);
  });

  // рамка
  ctx.strokeStyle = frameCol;
  ctx.strokeRect(left, top, W, H);
  ctx.restore();

  // лінії
// кольори з теми

// ----- лінії (завжди видимі в обох темах)
// ----- лінії (видимі в обох темах)
const isDark =
  document.documentElement.classList.contains('dark') ||
  (document.body && document.body.classList.contains('dark'));

// якщо є css-змінні — використай їх; інакше фолбек за темою
const themeEl = document.querySelector('html.dark, body.dark') || document.documentElement;

const S1 = css.getPropertyValue('--series-1').trim();
const S2 = css.getPropertyValue('--series-2').trim();
const S3 = css.getPropertyValue('--series-3').trim();

const col1 = S1 || (isDark ? '#ffffff' : '#111111'); // invested
const col2 = S2 || (isDark ? '#ffffff' : '#333333'); // realized
const col3 = S3 || (isDark ? '#ffffff' : '#555555'); // unrealized

function drawLine(series, color){
  ctx.beginPath();
  series.forEach((v,i)=>{
    const x = xScale(arr[i].t);
    const y = yScale(v);
    if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.lineWidth = 2.25;
  ctx.strokeStyle = color;
  if (isDark) { ctx.shadowColor = color; ctx.shadowBlur = 2; } else { ctx.shadowBlur = 0; }
  ctx.stroke();
}

drawLine(inv, col1);
drawLine(rea, col2);
drawLine(unr, col3);


}

// лог і перемальовування після кожного renderAll
const __renderAll = renderAll;
renderAll = function(){
  __renderAll.apply(this, arguments);
  try{
    let invested=0, realized=0, unrealized=0;
    for (const it of state.items){
      const m = calc(it);
      invested += m.netCost;
      realized += m.realized;
      if (m.unrealized!=null) unrealized += m.unrealized;
    }
    loadMetrics().then(drawPortfolioChart);
    saveMetricsPoint({ t: Date.now(), invested, realized, unrealized });
  }catch(e){ console.warn('metrics calc error', e); }
};


// ---- Telegram buttons ----
document.getElementById("sendTgSummaryBtn")?.addEventListener("click", async ()=>{
  const fmt = n => (isFinite(n) ? Number(n).toFixed(2) : "0.00");

  let totalInvested = 0, totalUnreal = 0;
  const lines = [];

  for (const it of (state.items || [])) {
    const mm = calc(it);
    const invested = mm?.netCost ?? 0;
    const unreal   = mm?.unrealized ?? 0;
    totalInvested += invested;
    totalUnreal   += unreal;
    const nm = tgEscapeHtml(it?.name || "");
    // У КОЖНОМУ РЯДКУ теги збалансовані (відкрили/закрили у межах рядка)
    lines.push(`• <b>${nm}</b> — нетто ${fmt(invested)}, PnL ${fmt(unreal)}`);
  }

  const pnl = totalUnreal;
  const roi = totalInvested > 0 ? (pnl / totalInvested * 100) : 0;

  const header = [
    "<b>📊 Steam Invest Ultra</b>",
    `<b>Позицій:</b> ${state.items?.length || 0}`,
    `<b>Інвестовано:</b> ${fmt(totalInvested)}`,
    `<b>PnL:</b> ${fmt(pnl)}  <b>ROI:</b> ${fmt(roi)}%`,
    ""
  ];

  // Ріжемо ПО РЯДКАХ, а не по символах — HTML не ламаємо
  const maxLen = 3500;     // запас до ліміту Telegram (~4096)
  let buf = header.join("\n");
  let ok = true, lastErr = "";

  async function sendChunk(text){
    const res = await chrome.runtime.sendMessage({
      type: 'SEND_TELEGRAM',
      payload: { text, parseMode: 'HTML' }
    });
    if (!res?.ok){ ok = false; lastErr = res?.error || "Telegram error"; }
  }

  for (const line of lines){
    if ((buf + "\n" + line).length > maxLen){
      await sendChunk(buf);
      buf = "";
    }
    buf += (buf ? "\n" : "") + line;
  }
  if (buf) await sendChunk(buf);

  alert(ok ? "Відправлено в Telegram" : ("Помилка Telegram: " + lastErr));
});


// Шорткат "/" → фокус у пошук, Esc → очистити
function focusSearchHotkey(ev){
  const tag = (document.activeElement?.tagName||"").toLowerCase();
  if (ev.key === "/" && tag !== "input" && tag !== "textarea"){
    ev.preventDefault(); const el = $("#search"); if (el){ el.focus(); el.select(); }
  }
  if (ev.key === "Escape"){
    const el = $("#search"); if (el && el.value){ el.value=""; renderAll(); }
  }
}
window.addEventListener("keydown", focusSearchHotkey);
function tgEscapeHtml(s){
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


// ===== Live search (DOM filter) =====
(function setupLiveSearch(){
  // 1) інпут: візьмемо існуючий #search; якщо його немає — створимо над таблицею
  let search = document.querySelector("#search");
  const table = document.querySelector("#tbl, #portfolioTable") || document.querySelector("table");
  if (!table) return; // немає таблиці — нічого робити
  const tbody = table.tBodies && table.tBodies[0] ? table.tBodies[0] : table.querySelector("tbody");

  if (!search){
    const wrap = document.createElement("div");
    wrap.style.margin = ".5rem 0";
    search = document.createElement("input");
    search.id = "search";
    search.type = "search";
    search.placeholder = "Пошук за назвою або тегами… (натисни /)";
    search.style.cssText = "width:100%;max-width:420px;padding:.5rem .75rem;border-radius:8px;";
    wrap.appendChild(search);
    table.parentNode.insertBefore(wrap, table);
  }

  // 2) функція фільтрації по тексту (назва + теги)
  function filterRows(q){
    if (!tbody) return;
    const needle = (q||"").trim().toLowerCase();
    const rows = Array.from(tbody.rows);
    let shown = 0;
    for (const tr of rows){
      // 0-й стовпець — Назва, 1-й — Теги (підлаштуй, якщо інші індекси)
      const name = (tr.cells[0]?.textContent || "").toLowerCase();
      const tags = (tr.cells[1]?.textContent || "").toLowerCase();
      const ok = !needle || name.includes(needle) || tags.includes(needle);
      tr.style.display = ok ? "" : "none";
      if (ok) shown++;
    }
    // опційно — виводити кількість знайдених
    // console.log("found:", shown);
  }

  // 3) debounce, обробники і хоткеї
  let t;
  search.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => filterRows(search.value), 120);
  });

  // шорткати: "/" — фокус, "Esc" — очистити
  window.addEventListener("keydown", (ev)=>{
    const tag = (document.activeElement?.tagName||"").toLowerCase();
    if (ev.key === "/" && tag !== "input" && tag !== "textarea"){
      ev.preventDefault();
      search.focus(); search.select();
    }
    if (ev.key === "Escape" && document.activeElement === search){
      search.value = "";
      filterRows("");
    }
  });

  // 4) первинний прогін (якщо в інпуті щось лишилось)
  filterRows(search.value);
})();
