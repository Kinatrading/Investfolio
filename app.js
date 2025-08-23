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

const d_alarm = $("#d_alarm"); const d_alarm_at=$("#d_alarm_at"); const d_batch=$("#d_batch"); const d_stats=$("#d_stats"); const d_log=$("#diagLog");
const bodyEl = $("#body");

let state = { items: [], settings: { feePct: 0.15, autoRefreshMinutes: 0, batchDelayMs:200, valuationMode:'sell', theme:'light' } };
let depthCache = { sell: [], buy: [] };

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
  bodyEl.classList.toggle('dark', state.settings.theme==='dark');
  ensureShapes();
  renderAll();
  renderSettings();
}

async function save(){
  await chrome.storage.local.set({ items: state.items, settings: state.settings });
  renderAll();
}

function calc(it){
  const buysQty = it.lots.reduce((s,x)=> s + (x.qty||0), 0);
  const buysCost = it.lots.reduce((s,x)=> s + (x.qty||0) * (x.price||0), 0);
  const sellsQty = it.sells.reduce((s,x)=> s + (x.qty||0), 0);
  const sellsCostRemoved = it.sells.reduce((s,x)=> s + (x.qty||0) * (x.avgCostAtSale||0), 0);
  const heldQty = buysQty - sellsQty;
  const netCost = buysCost - sellsCostRemoved;
  const avgCost = heldQty > 0 ? netCost / heldQty : 0;
  const fee = (it.feePct!=null ? it.feePct : state.settings.feePct);
  const realized = it.sells.reduce((s,x)=> s + x.qty * ( (x.price*(1-fee)) - (x.avgCostAtSale||0) ), 0);
  const marketPrice = state.settings.valuationMode==='buy'
    ? (it.firstBuyPrice!=null ? it.firstBuyPrice*(1-fee) : null)
    : (it.firstSellPrice!=null ? it.firstSellPrice*(1-fee) : null);
  const marketValue = (marketPrice!=null) ? marketPrice * heldQty : null;
  const unrealized = (marketValue!=null) ? (marketValue - netCost) : null;
  const roi = (unrealized!=null && netCost>0) ? (unrealized/netCost*100) : null;
  const vol = volatility(it); // std dev of last 30 market prices (gross)
  return { heldQty, avgCost, netCost, realized, marketPrice, unrealized, roi, vol };
}

function volatility(it){
  const prices = (it.priceHistory||[]).slice(-30).map(p => (state.settings.valuationMode==='buy'? p.b : p.s)).filter(v=>Number.isFinite(v));
  if (prices.length<2) return null;
  const m = sum(prices)/prices.length;
  const variance = sum(prices.map(v => (v-m)*(v-m))) / (prices.length-1);
  return Math.sqrt(variance);
}

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

function renderAll(){
  // filter by search/tags
  const query = ($("#search").value||"").toLowerCase().trim();
  const filter = (it)=>{
    if (!query) return true;
    return it.name.toLowerCase().includes(query) || (it.tags||"").toLowerCase().includes(query);
  };

  // Select
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
    renderDepth(); // from last fetch parse cache
  }

  // Portfolio table
  tbody.innerHTML = "";
  let rows = state.items.filter(filter);
  rows = applySort(rows);
  let totalInvested=0, totalRealized=0, totalUnreal=0;
  for (const it of rows){
    const m = calc(it);
    totalInvested+=m.netCost; totalRealized+=m.realized; if (m.unrealized!=null) totalUnreal+=m.unrealized;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${it.name}</td>
      <td>${it.tags||""}</td>
      <td>${m.heldQty}</td>
      <td>${fmt(m.avgCost)}</td>
      <td>${fmt(m.netCost)}</td>
      <td>${m.marketPrice!=null? fmt(m.marketPrice):""}</td>
      <td>${m.unrealized!=null? fmt(m.unrealized):""}</td>
      <td>${m.roi!=null? fmt(m.roi):""}</td>
      <td>${m.vol!=null? fmt(m.vol):""}</td>
      <td>${it.firstSellPrice!=null? fmt(it.firstSellPrice):""} ${it.firstSellQty!=null?`×${it.firstSellQty}`:""}</td>
      <td>${it.firstBuyPrice!=null? fmt(it.firstBuyPrice):""} ${it.firstBuyQty!=null?`×${it.firstBuyQty}`:""}</td>
      <td><input class="alertBuy" data-id="${it.id}" type="number" step="0.01" value="${it.alertBuyAtOrBelow??""}" style="width:8em"/></td>
      <td><input class="alertSell" data-id="${it.id}" type="number" step="0.01" value="${it.alertSellAtOrAbove??""}" style="width:9em"/></td>
      <td>${it.itemUrl ? `<a target="_blank" href="${it.itemUrl}">open</a>` : ""} <button class="action-btn" data-edit-itemurl="${it.id}">✎</button></td>
      <td>${it.apiUrl ? `<a target="_blank" href="${it.apiUrl}">open</a>` : ""} <button class="action-btn" data-edit-apiurl="${it.id}">✎</button></td>
      <td>${alertStatus(it)}</td>
      <td>${it.lastFetchedAt||""}</td>
      <td><button class="action-btn" data-del-item="${it.id}">🗑️</button></td>
    `;
    tbody.appendChild(tr);
  }
  summaryEl.textContent = `Позицій: ${rows.length} • Нетто вкладено: ₴${fmt(totalInvested)} • Realized PnL: ₴${fmt(totalRealized)} • Unrealized PnL: ₴${fmt(totalUnreal)}`;
  hdrUnreal.textContent = `Unrealized ₴${fmt(totalUnreal)}`;

  // History
  histBody.innerHTML = "";
  const hrows = [];
  for (const it of state.items){
    for (const b of it.lots) hrows.push({ itemId: it.id, kind:"buy", id:b.id, date:b.date, name:it.name, qty:b.qty, price:b.price, avg:"", pnl:"" });
    for (const s of it.sells) {
      const fee = (it.feePct!=null ? it.feePct : state.settings.feePct);
      const pnl = s.qty * ( (s.price*(1-fee)) - (s.avgCostAtSale||0) );
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

  // attach handlers
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
        const qty = prompt("К-сть:", rec.qty);
        if (qty===null) return;
        const price = prompt("Ціна (грн):", rec.price);
        if (price===null) return;
        const date = prompt("Дата (YYYY-MM-DD):", rec.date||todayISO());
        if (date===null) return;
        rec.qty = parseInt(qty,10);
        rec.price = parseFloat(price);
        rec.date = date;
        save();
      } else {
        const rec = it.sells.find(x=>x.id===id);
        const qty = prompt("К-сть:", rec.qty);
        if (qty===null) return;
        const price = prompt("Ціна (грн):", rec.price);
        if (price===null) return;
        const avg = prompt("Avg cost @ sale:", rec.avgCostAtSale);
        if (avg===null) return;
        const date = prompt("Дата (YYYY-MM-DD):", rec.date||todayISO());
        if (date===null) return;
        rec.qty = parseInt(qty,10);
        rec.price = parseFloat(price);
        rec.avgCostAtSale = parseFloat(avg);
        rec.date = date;
        save();
      }
    }
  };
}

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



// підключення до th
document.querySelectorAll("th.sortable").forEach(th => {
  th.addEventListener("click", () => sortItems(th.dataset.key));
});



function renderDepth(){
  const tb = $("#depth tbody");
  tb.innerHTML = "";
  const rows = [];
  let cum=0;
  for (const r of (depthCache.sell||[])){
    cum += (r.qty||0);
    rows.push(`<tr><td>sell</td><td>${fmt(r.price)}</td><td>${r.qty||""}</td><td>${cum}</td></tr>`);
  }
  cum=0;
  for (const r of (depthCache.buy||[])){
    cum += (r.qty||0);
    rows.push(`<tr><td>buy</td><td>${fmt(r.price)}</td><td>${r.qty||""}</td><td>${cum}</td></tr>`);
  }
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

async function saveSettings(){ await chrome.storage.local.set({ settings: state.settings }); }

let currentSort = { key: null, asc: true };

function sortItems(key) {
  if (currentSort.key === key) {
    currentSort.asc = !currentSort.asc;
  } else {
    currentSort.key = key;
    currentSort.asc = true;
  }

  state.items.sort((a, b) => {
    let va, vb;
    switch (key) {
      case "name":
        va = a.name.toLowerCase();
        vb = b.name.toLowerCase();
        break;
      case "qty":
        va = a.qty || 0; vb = b.qty || 0;
        break;
      case "avg":
        va = a.avgCost || 0; vb = b.avgCost || 0;
        break;
      case "invested":
        va = a.netInvested || 0; vb = b.netInvested || 0;
        break;
      case "market":
        va = a.marketPrice || 0; vb = b.marketPrice || 0;
        break;
      case "unreal":
        va = a.unrealized || 0; vb = b.unrealized || 0;
        break;
      case "roi":
        va = a.roiPct || 0; vb = b.roiPct || 0;
        break;
      case "vol":
        va = a.volatility || 0; vb = b.volatility || 0;
        break;
      default:
        va = 0; vb = 0;
    }
    if (va < vb) return currentSort.asc ? -1 : 1;
    if (va > vb) return currentSort.asc ? 1 : -1;
    return 0;
  });
  renderDepth(); // твоя функція рендеру
}

// ====== events ======
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
  const bodyEl = document.getElementById('body');
  bodyEl.classList.toggle('dark', state.settings.theme==='dark');
  await saveSettings();
});

$("#createItemBtn").addEventListener("click", ()=>{
  const name = $("#name").value.trim();
  const tags = $("#tags").value.trim();
  const itemUrl = $("#itemUrl").value.trim();
  const apiUrl = $("#apiUrl").value.trim();
  if (!name){ alert("Вкажіть назву."); return; }
  state.items.push({ id: uid(), name, tags, itemUrl, apiUrl, lots: [], sells: [], firstSellPrice:null, firstSellQty:null, firstBuyPrice:null, firstBuyQty:null, lastFetchedAt:null, priceHistory:[] });
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
  const feeInput = parseFloat($("#itemFeePct").value);
  if (!Number.isFinite(qty) || qty<=0 || !Number.isFinite(price)){ alert("Заповніть коректно продаж."); return; }
  const m = calc(it);
  if (m.heldQty < qty){ alert("Недостатньо кількості в портфелі."); return; }
  const avgBefore = m.avgCost;
  const fee = Number.isFinite(feeInput) ? (feeInput/100) : (it.feePct!=null ? it.feePct : state.settings.feePct);
  it.sells.push({ id: uid(), qty, price, date, avgCostAtSale: avgBefore, feePctAtSale: fee });
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

async function fetchOne(it){
  if (!it.apiUrl){ throw new Error("No API URL"); }
  const res = await fetch(it.apiUrl, { cache: "no-cache" });
  const data = await res.json();
  function unescapeHtmlString(s){ return s.replace(/\\"/g,'"').replace(/\\\//g,'/').replace(/\\n/g,'').replace(/\\t/g,'').replace(/\\r/g,''); }
  function stripTags(s){ return s.replace(/<[^>]*>/g,''); }
  function parseRowFromTable(htmlStr){
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
    return { price:null, qty:null };
  }
  let firstSell = {price:null, qty:null}, firstBuy = {price:null, qty:null};
  if (data.sell_order_table) firstSell = parseRowFromTable(data.sell_order_table);
  if (data.buy_order_table) firstBuy = parseRowFromTable(data.buy_order_table);
  if (firstSell.price==null && data.lowest_sell_order){
    firstSell.price = parseFloat(String(data.lowest_sell_order).replace(/[^\d,\.]/g,'').replace(',','.'));
  }
  if (firstBuy.price==null && data.highest_buy_order){
    firstBuy.price = parseFloat(String(data.highest_buy_order).replace(/[^\d,\.]/g,'').replace(',','.'));
  }
  it.firstSellPrice = firstSell.price;
  it.firstSellQty = firstSell.qty;
  it.firstBuyPrice = firstBuy.price;
  it.firstBuyQty = firstBuy.qty;
  it.lastFetchedAt = new Date().toISOString();
  it.priceHistory = it.priceHistory || [];
  it.priceHistory.push({ t: it.lastFetchedAt, s: it.firstSellPrice, b: it.firstBuyPrice });
  if (it.priceHistory.length > 600) it.priceHistory.shift();

  // depth top5
  depthCache.sell = data.sell_order_table ? parseTopN(data.sell_order_table, 5) : [];
  depthCache.buy = data.buy_order_table ? parseTopN(data.buy_order_table, 5) : [];

  return it;
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
  for (const it of state.items){
    if (it.apiUrl) window.open(it.apiUrl, "_blank");
  }
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
  }catch(err){
    alert("Не вдалось імпортувати JSON.");
  }
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
  renderBreakeven(it);
  drawChart(it);
  renderDepth();
});

$("#roiTarget").addEventListener("keydown", (e)=>{ if(e.key==='Enter') $("#calcRoiBtn").click(); });
$("#search").addEventListener("input", renderAll);

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

// Hotkeys
document.addEventListener("keydown", (e)=>{
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase()==='s'){ $("#scanAllBtn").click(); }
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase()==='f'){ $("#fetchBtn").click(); }
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase()==='o'){ $("#openAllBtn").click(); }
});

$("#opDate").value = todayISO();
load();
bindSorting();

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
        d_log.value = logs.map(x => `[${x.t}] ${x.msg}`).join('\\n');
      }catch(e){
        d_log.value = 'diag error: '+e;
      }
      resolve();
    });
  });
}
$("#diagRefresh").addEventListener("click", refreshDiag);
$("#diagBatch").addEventListener("click", ()=> chrome.runtime.sendMessage({type:'batchScan'}));
$("#diagTest").addEventListener("click", ()=> chrome.runtime.sendMessage({type:'testAlert'}));

refreshDiag();
