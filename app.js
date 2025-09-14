async function buildFullPortfolioReportText(){

  const fmt = n => (isFinite(n) ? Number(n).toFixed(2) : "0.00");
  const esc = s => String(s ?? "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;").replace(/'/g,"&#39;");

  const SELL_ROI = 25;   // > 25% = продавати
  const BUY_ROI  = -25;  // < -25% = докупити

  let totalInvested = 0, totalUnreal = 0, totalQty = 0;

  const sell = [], buy = [], mid = [];

  for (const it of (state.items || [])) {
    const m = calc(it) || {};
    const invested = m.netCost ?? 0;
    const unreal   = m.unrealized ?? 0;
    const qty      = m.heldQty ?? it.amount ?? it.qty ?? 0;

    if (!qty) continue;                 // ❗ пропускаємо 0

    const roi = invested > 0 ? (unreal / invested * 100) : 0;

    totalInvested += invested;
    totalUnreal   += unreal;
    totalQty      += (Number(qty) || 0);

    const nm = esc(it?.name || "");
    const line = `• <b>${nm}</b> — к-сть ${qty}, нетто ${fmt(invested)}, PnL ${fmt(unreal)}, ROI ${fmt(roi)}%`;

    if (roi > SELL_ROI)      sell.push({ roi, line });
    else if (roi < BUY_ROI)  buy.push({ roi, line });
    else                     mid.push({ roi, line });
  }

  sell.sort((a,b)=> b.roi - a.roi);
  buy .sort((a,b)=> a.roi - b.roi);
  mid .sort((a,b)=> Math.abs(b.roi) - Math.abs(a.roi));

  const pnl = totalUnreal;
  const roiTot = totalInvested > 0 ? (pnl / totalInvested * 100) : 0;

	const totals = portfolioTotals();
	const bucket = await loadRealizedTotal();
	const totalRealizedAll = totals.totalRealized + (bucket.pnl || 0);
  // ==== DIFFERENCE SECTION ====
  const prevSnap = await loadSnapshot();
  const currSnap = buildSnapshot(state.items);
  const { bought, sold } = diffSnapshots(prevSnap, currSnap);

  
  // === Aggregates for local diff report ===
  let spentBuy = 0, soldGross = 0, soldNet = 0;
  try {
    // Use the same arrays that are rendered in the report
    spentBuy  = (Array.isArray(bought) ? bought : []).reduce((s,x)=> s + Number(x.delta||0)*Number(x.price||0), 0);
    soldGross = (Array.isArray(sold)   ? sold   : []).reduce((s,x)=> s + Number(x.delta||0)*Number(x.price||0), 0);
    // Net realized: sum over sold of qty * (sellPrice - avgCostFromPrevSnap)
    const snap = prevSnap || {};
    soldNet = (Array.isArray(sold) ? sold : []).reduce((s,x)=>{
      const prev = snap[x.name] || {};
      const buyQty = Number(prev.buyQty || 0);
      const buyValue = Number(prev.buyValue || 0);
      const avgCost = buyQty > 0 ? (buyValue / buyQty) : 0;
      const qty = Number(x.delta||0);
      const price = Number(x.price||0);
      return s + qty * (price - avgCost);
    }, 0);
  } catch(e){ console.warn("Aggregate calc failed", e); }
const lines = [
    "<b>📊 Steam Invest Ultra</b>",
    `<b>Позицій:</b> ${state.items?.length || 0}`,
    `<b>К-сть (шт, активних):</b> ${totalQty}`,
    `<b>Інвестовано:</b> ${fmt(totalInvested)}`,
	`<b>Realized PnL:</b> ₴${fmt(totalRealizedAll)}`,
    `<b>PnL:</b> ${fmt(pnl)}  <b>ROI:</b> ${fmt(roiTot)}%`,
    ""
  ];

  if (bought.length || sold.length){
    if (bought.length){
      lines.push(`<b>🆕 Куплено:</b>`);
      for (const r of bought){
        lines.push(`• ${esc(r.name)} — +${r.delta} шт × ${fmt(r.price)}`);
      }
    }
    if (sold.length){
      if (bought.length) lines.push("");
      lines.push(`<b>💸 Продано:</b>`);
      for (const r of sold){
        lines.push(`• ${esc(r.name)} — −${r.delta} шт × ${fmt(r.price)}`);
      }
    }
    lines.push("");
  } else {
    lines.push(`<i>Змін від попереднього звіту не виявлено</i>`, "");
  }

  // ==== ROI BLOCKS ====
  lines.push(
    `<b>🔥 Можна продавати (ROI &gt; ${SELL_ROI}%):</b> ${sell.length ? "" : "—"}`,
    sell.map(x=>("🔥 " + x.line)),
    "",
    `<b>🤔 Під питанням докупити (ROI &lt; ${Math.abs(BUY_ROI)}%):</b> ${buy.length ? "" : "—"}`,
    buy.map(x=>("🧲 " + x.line)),
    "",
    `<b>📎 Решта (від −${Math.abs(BUY_ROI)}% до +${SELL_ROI}%):</b> ${mid.length ? "" : "—"}`,
    mid.map(x=>("📎 " + x.line)),
  );
  const flat = (arr)=>arr.flat ? arr.flat() : [].concat(...arr);
// plain-text transform: strip tags & decode entities
const stripTags = (s)=>String(s||"").replace(/<[^>]*>/g,"");
const decode = (s)=>stripTags(s)
  .replace(/&lt;/g,"<").replace(/&gt;/g,">")
  .replace(/&amp;/g,"&").replace(/&quot;/g,'"')
  .replace(/&#39;/g,"'");
const text = flat(lines).filter(Boolean).map(decode).join("\n");
return text;
}

document.getElementById("savePortfolioFullBtn")?.addEventListener("click", async ()=>{
  try{
    const fullReport = await buildFullPortfolioReportText(); // генератор звіту як для Telegram
    const blob = new Blob([fullReport], {type: "text/plain;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `portfolio_report_${new Date().toISOString().slice(0,10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }catch(e){
    alert("Не вдалося сформувати звіт: " + (e?.message || e));
  }
});
function makeHistoryMarker(row){
  const parts = [
    row.actedOn || '',
    row.name || '',
    row.acted || '',
    String(row.price||''),
    row.classid || '',
    row.instanceid || '',
    row.rid || '',
    row.purchaseid || '',
    row.listingid || '',
    row.contentHash || ''
  ];
  const s = parts.join('||');
  let h = 0;
  for (let i=0;i<s.length;i++){ h = ((h<<5)-h) + s.charCodeAt(i); h|=0; }
  return `H${h}`;
}
// i18n bootstrap
try{(function(){const s=document.createElement('script');s.src=chrome.runtime.getURL('i18n/i18n.js');document.documentElement.appendChild(s);})();}catch(e){}
/* global chrome */
const $ = (s) => document.querySelector(s);
const tbody = $("#tbl tbody");
const histBody = $("#hist tbody");
const summaryEl = $("#summary");
const itemSelect = $("#itemSelect");
const mkt = $("#mkt");
const links = $("#links");
const chart = null;
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
  populateSettingsUI();
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
  const min = Math.min(data), max = Math.max(data);
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

// ---- Aggregated Realized PnL bucket (persists even if items are deleted) ----
async function loadRealizedTotal(){
  const st = await chrome.storage.local.get('realizedTotal');
  return st && st.realizedTotal ? st.realizedTotal : { pnl: 0, qty: 0, value: 0, updatedAt: 0 };
}
async function addToRealizedTotal(delta){
  const cur = await loadRealizedTotal();
  cur.pnl   += Number(delta?.pnl   || 0);
  cur.qty   += Number(delta?.qty   || 0);
  cur.value += Number(delta?.value || 0);
  cur.updatedAt = Date.now();
  await chrome.storage.local.set({ realizedTotal: cur });
  return cur;
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
    `;
    tbody.appendChild(tr);
  }

  // агреговані показники реалізації для підсумку
  let aggQty = 0, aggValue = 0;
  for (const it of rows){
    const m2 = calc(it);
    if (m2.realizedQty){ aggQty += m2.realizedQty; aggValue += m2.realizedQty * (m2.realizedAvgSell||0); }
  }
  const aggAvg = aggQty>0 ? (aggValue/aggQty) : null;

  (async ()=>{
    const totals = portfolioTotals();
    const bucket = await loadRealizedTotal();
    const totalInvested = totals.totalInvested;
    const totalUnreal   = totals.totalUnreal;
    const totalRealizedAll = totals.totalRealized + (bucket.pnl||0);
    const line = `Позицій: ${rows.length} • Нетто вкладено: ₴${fmt(totalInvested)} • Realized PnL (вкл. архів): ₴${fmt(totalRealizedAll)}  • Unrealized PnL: ₴${fmt(totalUnreal)}`;
    summaryEl.textContent = line;
  })();

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
  tbody.onclick = async (e) => {
    const t = e.target;
    if (t.dataset.delItem){
      if (confirm("Видалити позицію разом з історією?")){
        const it = state.items.find(x=>x.id===t.dataset.delItem);
        if (it){
          const m = calc(it) || {};
          // Add realized PnL of this item to persistent bucket before deletion
          await addToRealizedTotal({
            pnl:   Number(m.realized||0),
            qty:   Number(m.realizedQty||0),
            value: Number((m.realizedQty||0) * (m.realizedAvgSell||0) || 0)
          });
        }
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
        if (!rec){ alert("Запис не знайдено"); return; }
        const qty = prompt("К-сть:", rec.qty);  if (qty===null) return;
        const price = prompt("Ціна (грн):", rec.price); if (price===null) return;
        const date = prompt("Дата (YYYY-MM-DD):", rec.date||todayISO()); if (date===null) return;
        rec.qty = parseInt(qty,10);
        rec.price = parseFloat(price);
        rec.date = date;
        save();
      } else {
        const rec = it.sells.find(x=>x.id===id);
        if (!rec){ alert("Запис не знайдено"); return; }
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
  const tokEl = document.querySelector("#tgToken");
  const chatEl = document.querySelector("#tgChatId");
  if (tokEl){ const v = tokEl.value.trim(); if (v && !/^\*+$/.test(v)) state.settings.telegramBotToken = v; }
  if (chatEl) state.settings.telegramChatId = chatEl.value.trim();
  const chat2El = document.querySelector('#tgChatIdPersonal');
  if (chat2El) state.settings.telegramChatIdPersonal = chat2El.value.trim();
  await chrome.storage.local.set({ settings: state.settings });
  populateSettingsUI();
}


function maskTokenDisplay(tok){
  if (!tok) return "";
  return "*".repeat(Math.min(24, Math.max(12, tok.length)));
}

function populateSettingsUI(){
  try{
    const s = state.settings || {};
    const feeEl = document.getElementById("feePct");
    const autoEl = document.getElementById("autoRefreshMinutes");
    const batchEl = document.getElementById("batchDelayMs");
    const valEl = document.getElementById("valuationMode");
    const tokEl = document.getElementById("tgToken");
    const chatEl = document.getElementById("tgChatId");
    const chat2El = document.getElementById("tgChatIdPersonal");
    if (feeEl) feeEl.value = ( (s.feePct!=null ? s.feePct : 0.15) * 100 ).toFixed(1);
    if (autoEl) autoEl.value = s.autoRefreshMinutes || 0;
    if (batchEl) batchEl.value = s.batchDelayMs || 200;
    if (valEl) valEl.value = s.valuationMode || 'sell';
    if (tokEl) tokEl.value = s.telegramBotToken ? maskTokenDisplay(s.telegramBotToken) : "";
    if (chatEl) chatEl.value = s.telegramChatId || "";
    if (chat2El) chat2El.value = s.telegramChatIdPersonal || "";
  }catch(e){}
}
function debounce(fn, ms=200){ let t; return (a)=>{ clearTimeout(t); t=setTimeout(()=>fn(a), ms); }; }
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

let __pnlArrCache = null;
function resizePnlCanvas(cvs){
  const dpr = window.devicePixelRatio || 1;
  const cssW = Math.floor(cvs.clientWidth || cvs.getBoundingClientRect().width || 540);
  let cssH = Math.floor(cvs.clientHeight || cvs.getBoundingClientRect().height || 0);
  if (cssH < 40) { cssH = 260; cvs.style.height = cssH+'px'; }
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

  const yMin = Math.min(inv, rea, unr);
  const yMax = Math.max(inv, rea, unr);

  const left = 64, right = 10, top = 10, bottom = 28;
  const W = Math.max(10, w - left - right);
  const H = Math.max(10, h - top - bottom);

  const { ticks: yTicks, start: yStart, end: yEnd } = niceTicks(yMin, yMax, 6);
  const yScale = v => top + (H - (v - yStart) / (yEnd - yStart) * H);

  const xTicksCount = Math.min(7, arr.length);
  const xTicks = [];
  for (let i = 0; i < xTicksCount; i++){
    const t = t0 + i * (t1 - t0) / (xTicksCount - 1);
    xTicks.push(t);
  }
  const xScale = t => left + (t - t0) / Math.max(1, (t1 - t0)) * W;

  const css = getComputedStyle(rootEl);
  const gridCol  = css.getPropertyValue('--axis-grid').trim()  || 'rgba(0,0,0,.12)';
  const textCol  = css.getPropertyValue('--axis-text').trim()  || '#444';
  const frameCol = css.getPropertyValue('--axis-frame').trim() || 'rgba(0,0,0,.35)';

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

  ctx.strokeStyle = frameCol;
  ctx.strokeRect(left, top, W, H);
  ctx.restore();

  const isDark =
    document.documentElement.classList.contains('dark') ||
    (document.body && document.body.classList.contains('dark'));

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

// === Snapshot helpers (кумулятивні покупки/продажі для точних цін)
function itemKey(it){ return (it && (it.id || it.name)) || ""; }

async function loadSnapshot(){
  const { tgLastSnapshotV2 } = await chrome.storage.local.get("tgLastSnapshotV2");
  return tgLastSnapshotV2 || {};
}
async function saveSnapshot(snap){
  await chrome.storage.local.set({ tgLastSnapshotV2: snap || {} });
}

// побудова знімка на базі всіх предметів (щоб врахувати продажі навіть якщо qty зараз 0)
function buildSnapshot(items){
  const snap = {};
  for (const it of items || []){
    const m   = calc(it) || {};
    const heldQty = Number(m.heldQty ?? it.amount ?? it.qty ?? 0) || 0;

    let buyQty = 0, buyValue = 0;
    for (const r of (it.lots || [])){
      const q = Number(r.qty)||0;
      const p = Number(r.price)||0; // якщо треба нетто — додай комісію тут
      buyQty   += q;
      buyValue += q * p;
    }

    let sellQty = 0, sellValue = 0;
    for (const r of (it.sells || [])){
      const q = Number(r.qty)||0;
      const p = Number(r.priceNet ?? r.price ?? 0);
      sellQty   += q;
      sellValue += q * p;
    }

    if (!buyQty && !sellQty && !heldQty) continue;

    const key = itemKey(it);
    if (!key) continue;

    snap[key] = {
      name: it.name || key,
      heldQty,
      buyQty, buyValue,
      sellQty, sellValue
    };
  }
  return snap;
}

// різниця між знімками -> нові покупки/продажі із середньою ціною за інтервал (= ΔВартість/ΔК-сть)
function diffSnapshots(prev, curr){
  const bought = []; // {name, delta, price}
  const sold   = []; // {name, delta, price}
  const keys = new Set([...Object.keys(prev||{}), ...Object.keys(curr||{})]);

  for (const k of keys){
    const P = prev[k] || { buyQty:0, buyValue:0, sellQty:0, sellValue:0, heldQty:0, name:k };
    const C = curr[k] || { buyQty:0, buyValue:0, sellQty:0, sellValue:0, heldQty:0, name:k };

    const dBuyQty   = C.buyQty   - P.buyQty;
    const dBuyValue = C.buyValue - P.buyValue;
    if (dBuyQty > 0){
      bought.push({ name: C.name || P.name || k, delta: dBuyQty, price: dBuyValue / dBuyQty });
    }

    const dSellQty   = C.sellQty   - P.sellQty;
    const dSellValue = C.sellValue - P.sellValue;
    if (dSellQty > 0){
      sold.push({ name: C.name || P.name || k, delta: dSellQty, price: dSellValue / dSellQty });
    }
  }
  bought.sort((a,b)=> b.delta - a.delta);
  sold  .sort((a,b)=> b.delta - a.delta);
  return { bought, sold };
}

// ---- Telegram buttons ----

document.getElementById("savePortfolioFullBtn")?.addEventListener("click", async ()=>{
  try{
    const text = await buildFullPortfolioReportText();
    const blob = new Blob([text], {type:"text/plain"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `portfolio_full_${new Date().toISOString().slice(0,10)}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }catch(e){
    alert("Не вдалося сформувати звіт: " + (e?.message||e));
  }
});
document.getElementById("sendTgSummaryBtn")?.addEventListener("click", async ()=>{
  const fmt = n => (isFinite(n) ? Number(n).toFixed(2) : "0.00");
  const esc = s => String(s ?? "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;").replace(/'/g,"&#39;");

  const SELL_ROI = 25;   // > 25% = продавати
  const BUY_ROI  = -25;  // < -25% = докупити

  let totalInvested = 0, totalUnreal = 0, totalQty = 0;

  const sell = [], buy = [], mid = [];

  for (const it of (state.items || [])) {
    const m = calc(it) || {};
    const invested = m.netCost ?? 0;
    const unreal   = m.unrealized ?? 0;
    const qty      = m.heldQty ?? it.amount ?? it.qty ?? 0;

    if (!qty) continue;                 // ❗ пропускаємо 0

    const roi = invested > 0 ? (unreal / invested * 100) : 0;

    totalInvested += invested;
    totalUnreal   += unreal;
    totalQty      += (Number(qty) || 0);

    const nm = esc(it?.name || "");
    const line = `• <b>${nm}</b> — к-сть ${qty}, нетто ${fmt(invested)}, PnL ${fmt(unreal)}, ROI ${fmt(roi)}%`;

    if (roi > SELL_ROI)      sell.push({ roi, line });
    else if (roi < BUY_ROI)  buy.push({ roi, line });
    else                     mid.push({ roi, line });
  }

  sell.sort((a,b)=> b.roi - a.roi);
  buy .sort((a,b)=> a.roi - b.roi);
  mid .sort((a,b)=> Math.abs(b.roi) - Math.abs(a.roi));

  const pnl = totalUnreal;
  const roiTot = totalInvested > 0 ? (pnl / totalInvested * 100) : 0;

	const totals = portfolioTotals();
	const bucket = await loadRealizedTotal();
	const totalRealizedAll = totals.totalRealized + (bucket.pnl || 0);
  // ==== DIFFERENCE SECTION ====
  const prevSnap = await loadSnapshot();
  const currSnap = buildSnapshot(state.items);
  const { bought, sold } = diffSnapshots(prevSnap, currSnap);

  
  // === Aggregates for local diff report ===
  let spentBuy = 0, soldGross = 0, soldNet = 0;
  try {
    // Use the same arrays that are rendered in the report
    spentBuy  = (Array.isArray(bought) ? bought : []).reduce((s,x)=> s + Number(x.delta||0)*Number(x.price||0), 0);
    soldGross = (Array.isArray(sold)   ? sold   : []).reduce((s,x)=> s + Number(x.delta||0)*Number(x.price||0), 0);
    // Net realized: sum over sold of qty * (sellPrice - avgCostFromPrevSnap)
    const snap = prevSnap || {};
    soldNet = (Array.isArray(sold) ? sold : []).reduce((s,x)=>{
      const prev = snap[x.name] || {};
      const buyQty = Number(prev.buyQty || 0);
      const buyValue = Number(prev.buyValue || 0);
      const avgCost = buyQty > 0 ? (buyValue / buyQty) : 0;
      const qty = Number(x.delta||0);
      const price = Number(x.price||0);
      return s + qty * (price - avgCost);
    }, 0);
  } catch(e){ console.warn("Aggregate calc failed", e); }
const lines = [
    "<b>📊 Steam Invest Ultra</b>",
    `<b>Позицій:</b> ${state.items?.length || 0}`,
    `<b>К-сть (шт, активних):</b> ${totalQty}`,
    `<b>Інвестовано:</b> ${fmt(totalInvested)}`,
	`<b>Realized PnL:</b> ₴${fmt(totalRealizedAll)}`,
    `<b>PnL:</b> ${fmt(pnl)}  <b>ROI:</b> ${fmt(roiTot)}%`,
    ""
  ];

  if (bought.length || sold.length){
    if (bought.length){
      lines.push(`<b>🆕 Куплено:</b>`);
      for (const r of bought){
        lines.push(`• ${esc(r.name)} — +${r.delta} шт × ${fmt(r.price)}`);
      }
    }
    if (sold.length){
      if (bought.length) lines.push("");
      lines.push(`<b>💸 Продано:</b>`);
      for (const r of sold){
        lines.push(`• ${esc(r.name)} — −${r.delta} шт × ${fmt(r.price)}`);
      }
    }
    lines.push("");
  } else {
    lines.push(`<i>Змін від попереднього звіту не виявлено</i>`, "");
  }

  // ==== ROI BLOCKS ====
  lines.push(
    `<b>🔥 Можна продавати (ROI &gt; ${SELL_ROI}%):</b> ${sell.length ? "" : "—"}`,
    sell.map(x=>("🔥 " + x.line)),
    "",
    `<b>🤔 Під питанням докупити (ROI &lt; ${Math.abs(BUY_ROI)}%):</b> ${buy.length ? "" : "—"}`,
    buy.map(x=>("🧲 " + x.line)),
    "",
    `<b>📎 Решта (від −${Math.abs(BUY_ROI)}% до +${SELL_ROI}%):</b> ${mid.length ? "" : "—"}`,
    mid.map(x=>("📎 " + x.line)),
  );

  // ==== Відправка по рядках ====
  const maxLen = 3500;
  let buf = "";
  let ok = true, lastErr = "";

  async function sendChunk(text){
    const res = await chrome.runtime.sendMessage({
      type: 'SEND_TELEGRAM',
      payload: { text, parseMode: 'HTML' }
    });
    if (!res?.ok){ ok = false; lastErr = res?.error || "Telegram error"; }
  }

  for (const line of lines){
    const candidate = buf ? (buf + "\n" + line) : line;
    if (candidate.length > maxLen){
      if (buf) await sendChunk(buf);
      buf = line;
    } else {
      buf = candidate;
    }
  }
  if (buf) await sendChunk(buf);

  if (ok) await saveSnapshot(currSnap);
  alert(ok ? "Відправлено в Telegram" : ("Помилка Telegram: " + lastErr));
});



document.getElementById("sendTgShortBtn")?.addEventListener("click", async ()=>{
  const fmt = n => (isFinite(n) ? Number(n).toFixed(2) : "0.00");
  const esc = s => String(s ?? "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;").replace(/'/g,"&#39;");

  const SELL_ROI = 25;   // > 25% = продавати
  const BUY_ROI  = -25;  // < -25% = докупити

  let totalInvested = 0, totalUnreal = 0, totalQty = 0;

  const sell = [], buy = [], mid = [];

  for (const it of (state.items || [])) {
    const m = calc(it) || {};
    const invested = m.netCost ?? 0;
    const unreal   = m.unrealized ?? 0;
    const qty      = m.heldQty ?? it.amount ?? it.qty ?? 0;

    if (!qty) continue;                 // ❗ пропускаємо 0

    const roi = invested > 0 ? (unreal / invested * 100) : 0;

    totalInvested += invested;
    totalUnreal   += unreal;
    totalQty      += (Number(qty) || 0);

    const nm = esc(it?.name || "");
    const line = `• <b>${nm}</b> — к-сть ${qty}, нетто ${fmt(invested)}, PnL ${fmt(unreal)}, ROI ${fmt(roi)}%`;

    if (roi > SELL_ROI)      sell.push({ roi, line });
    else if (roi < BUY_ROI)  buy.push({ roi, line });
    else                     mid.push({ roi, line });
  }

  sell.sort((a,b)=> b.roi - a.roi);
  buy .sort((a,b)=> a.roi - b.roi);
  mid .sort((a,b)=> Math.abs(b.roi) - Math.abs(a.roi));

  const pnl = totalUnreal;
  const roiTot = totalInvested > 0 ? (pnl / totalInvested * 100) : 0;

	const totals = portfolioTotals();
	const bucket = await loadRealizedTotal();
	const totalRealizedAll = totals.totalRealized + (bucket.pnl || 0);
  // ==== DIFFERENCE SECTION ====
  const prevSnap = await loadSnapshot();
  const currSnap = buildSnapshot(state.items);
  const { bought, sold } = diffSnapshots(prevSnap, currSnap);

  const lines = [
    "<b>📊 Steam Invest Ultra — короткий звіт</b>",
    `<b>Позицій:</b> ${state.items?.length || 0}`,
    `<b>К-сть (шт, активних):</b> ${totalQty}`,
    `<b>Інвестовано:</b> ${fmt(totalInvested)}`,
	`<b>Realized PnL:</b> ₴${fmt(totalRealizedAll)}`,
    `<b>PnL:</b> ${fmt(pnl)}  <b>ROI:</b> ${fmt(roiTot)}%`,
    ""
  ];

  if (bought.length || sold.length){
    if (bought.length){
      lines.push(`<b>🆕 Куплено:</b>`);
      for (const r of bought){
        lines.push(`• ${esc(r.name)} — +${r.delta} шт × ${fmt(r.price)}`);
      }
    }
    if (sold.length){
      if (bought.length) lines.push("");
      lines.push(`<b>💸 Продано:</b>`);
      for (const r of sold){
        lines.push(`• ${esc(r.name)} — −${r.delta} шт × ${fmt(r.price)}`);
      }
    }
    lines.push("");
  } else {
    lines.push(`<i>Змін від попереднього звіту не виявлено</i>`, "");
  }

  // ==== ROI BLOCKS ====
  lines.push(
    `<b>🔥 Можна продавати (ROI &gt; ${SELL_ROI}%):</b> ${sell.length ? "" : "—"}`,
    sell.map(x=>("🔥 " + x.line)),
    "",
    `<b>🤔 Під питанням докупити (ROI &lt; ${Math.abs(BUY_ROI)}%):</b> ${buy.length ? "" : "—"}`,
    buy.map(x=>("🧲 " + x.line)),
    ""
    );

  // ==== Відправка по рядках ====
  const maxLen = 3500;
  let buf = "";
  let ok = true, lastErr = "";

  async function sendChunk(text){
    const res = await chrome.runtime.sendMessage({
      type: 'SEND_TELEGRAM',
      payload: { text, parseMode: 'HTML' }
    });
    if (!res?.ok){ ok = false; lastErr = res?.error || "Telegram error"; }
  }

  for (const line of lines){
    const candidate = buf ? (buf + "\n" + line) : line;
    if (candidate.length > maxLen){
      if (buf) await sendChunk(buf);
      buf = line;
    } else {
      buf = candidate;
    }
  }
  if (buf) await sendChunk(buf);

  if (ok) await saveSnapshot(currSnap);
  alert(ok ? "Відправлено в Telegram" : ("Помилка Telegram: " + lastErr));
});

// Шорткати пошуку й live-search
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

(function setupLiveSearch(){
  let search = document.querySelector("#search");
  const table = document.querySelector("#tbl, #portfolioTable") || document.querySelector("table");
  if (!table) return;
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

  function filterRows(q){
    if (!tbody) return;
    const needle = (q||"").trim().toLowerCase();
    const rows = Array.from(tbody.rows);
    for (const tr of rows){
      const name = (tr.cells[0]?.textContent || "").toLowerCase();
      const tags = (tr.cells[1]?.textContent || "").toLowerCase();
      const ok = !needle || name.includes(needle) || tags.includes(needle);
      tr.style.display = ok ? "" : "none";
    }
  }

  let t;
  search.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => filterRows(search.value), 120);
  });

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

  filterRows(search.value);
})();



// ===== Steam History integration =====
let steamHistory = [];
let steamStart = 0;

async function fetchSteamChunk(start=0, count=100){
  const url = `https://steamcommunity.com/market/myhistory/render/?query=&start=${start}&count=${count}`;
  try{
    const res = await fetch(url, { credentials:'include', headers:{ 'Accept':'application/json' }});
    if (res.status === 429){
      $("#steamStatus").textContent = "429 — за багато запитів. Спроба ще раз за 30с";
      await new Promise(r=>setTimeout(r, 30000));
      return await fetchSteamChunk(start, count);
    }
    const data = await res.json();
    if (!data || !data.success) throw new Error("Bad response");
    const parser = new DOMParser();
    const htmlDoc = parser.parseFromString(data.results_html, "text/html");
    const rows = htmlDoc.querySelectorAll(".market_recent_listing_row");
    const parsePrice = (s)=> Number(String(s||"").replace(/[^\d.,-]/g,"").replace(",", ".").match(/-?\d+(\.\d+)?/)?.[0]||0);

    // build icon map from assets
    const assets = data.assets||{};
    const iconMap = {};
    for (const appid in assets){
      const appAssets = assets[appid]||{};
      for (const aid in appAssets){
        const a = appAssets[aid];
        const k = `${a.classid||''}_${a.instanceid||''}`;
        if (k && a.icon_url) iconMap[k] = a.icon_url.startsWith('http') ? a.icon_url : `https://community.akamai.steamstatic.com/economy/image/${a.icon_url}`;
      }
    }

    const out = [];
    rows.forEach(row=>{
      const actedOn = row.querySelector(".market_listing_listed_date")?.textContent.trim() || "";
      const classid = row.getAttribute('data-classid') || row.dataset.classid || '';
      const instanceid = row.getAttribute('data-instanceid') || row.dataset.instanceid || '';
      const icon = iconMap[`${classid}_${instanceid}`] || '';
      const name = row.querySelector(".market_listing_item_name")?.textContent.trim() || "";
      const priceStr = row.querySelector(".market_listing_price")?.textContent.trim() || "";
      const symbol = row.querySelector(".market_listing_gainorloss")?.textContent.trim() || "";
      const acted = symbol === "+" ? "bought" : (symbol === "−" || symbol === "-" ? "sold" : "unknown");
      const price = parsePrice(priceStr);
      const rid = row.getAttribute('id') || '';
      const purchaseid = row.getAttribute('data-purchaseid') || row.dataset.purchaseid || '';
      const listingid = row.getAttribute('data-listingid') || row.dataset.listingid || '';
      const outer = row.outerHTML || '';
      let ch = 0; for (let i=0;i<outer.length;i++){ ch = ((ch<<5)-ch) + outer.charCodeAt(i); ch|=0; }
      const contentHash = `C${ch}`;
      if (name && price>0 && (acted==="bought"||acted==="sold")){
        out.push({ actedOn, name, acted, price, icon, classid, instanceid, rid, purchaseid, listingid, contentHash });
      }
    });
    return out;
  }catch(e){
    $("#steamStatus").textContent = "Помилка завантаження історії: " + e.message;
    return [];
  }
}

function renderSteamHistory(){
  const body = $("#steamHist tbody");
  body.innerHTML = "";
  for (let i=0;i<steamHistory.length;i++){
    const r = steamHistory[i];
    const tr = document.createElement("tr");
    const actUa = r.acted==="bought"?"Купівля":"Продаж";
    tr.innerHTML = `
      <td>${r.actedOn||""}</td>
      <td>${actUa}</td>
      <td>${r.icon?`<img src='${r.icon}' alt='' style='width:28px;height:28px;border-radius:4px'>`:''}</td>
      <td>${r.name}</td>
      <td>${fmt(r.price)}</td>
      <td><button class="applyBtn" data-idx="${i}">Застосувати</button></td>
    `;
    body.appendChild(tr);
  }
}

async function applySteamRow(idx){
  const r = steamHistory[idx];
  if (!r) return;
  let it = state.items.find(x => (x.name||"").trim().toLowerCase() === r.name.trim().toLowerCase());
  if (r.acted === "bought"){
    if (!it){
      it = { id: uid(), name: r.name, tags:"", itemUrl:"", apiUrl:"", lots:[], sells:[], firstSellPrice:null, firstBuyPrice:null, firstBuyQty:null, lastFetchedAt:null, priceHistory:[] };
      state.items.push(it);
    }
    it.lots.push({ id: uid(), qty: 1, price: r.price, date: todayISO() });
    await save();
    $("#steamStatus").textContent = `Додано 1 шт "${r.name}" в портфель.`;
  } else if (r.acted === "sold"){
    if (!it){ alert("В портфелі не знайдено такої позиції для списання."); return; }
    const m = calc(it);
    if ((m.heldQty||0) < 1){ alert("Недостатньо кількості в портфелі для списання 1 шт."); return; }
    it.sells.push({ id: uid(), qty: 1, price: r.price, date: todayISO(), avgCostAtSale: m.avgCost });
    await save();
    $("#steamStatus").textContent = `Списано 1 шт "${r.name}" (продаж).`;
  }
  renderAll();
}

document.addEventListener("DOMContentLoaded", ()=>{
  $("#loadSteam100")?.addEventListener("click", async ()=>{
    steamStart = 0;
    $("#steamStatus").textContent = "Завантаження";
    const chunk = await fetchSteamChunk(steamStart, 100);
    steamHistory = chunk;
    steamStart += chunk.length;
    $("#steamStatus").textContent = `Отримано ${chunk.length} записів.`;
    renderSteamHistory();
  });
  $("#loadSteamMore")?.addEventListener("click", async ()=>{
    $("#steamStatus").textContent = "Завантаження ще";
    const chunk = await fetchSteamChunk(steamStart, 100);
    steamHistory = steamHistory.concat(chunk);
    steamStart += chunk.length;
    $("#steamStatus").textContent = `Всього ${steamHistory.length} записів.`;
    renderSteamHistory();
  });
  $("#steamHist")?.addEventListener("click", (e)=>{
    const t = e.target;
    if (t.classList.contains("applyBtn")){
      const idx = Number(t.dataset.idx);
      applySteamRow(idx);
    }
  });

  
  $("#forceHistoryMarker")?.addEventListener("click", async ()=>{
    try{
      if (!Array.isArray(steamHistory) || steamHistory.length === 0){
        alert("Спершу завантаж історію Steam.");
        return;
      }
      const newest = steamHistory[0];
      const marker = typeof makeHistoryMarker === 'function' ? makeHistoryMarker(newest) : (newest.rid || newest.purchaseid || newest.listingid || Date.now().toString());
      await chrome.storage?.local?.set?.({ [STORAGE_KEY_LAST_HIST_MARKER]: marker });
      // Скидаємо локальні лічильники перегортання (на випадок якщо вони існують)
      try{ window.steamStart = 0; }catch(e){}
      $("#steamStatus").textContent = "Точку історії оновлено (як при першому запуску).";
}catch(e){
      $("#steamStatus").textContent = "Помилка: "+(e?.message||e);
    }
  });
});
// ===== end Steam History =====



// ===== Inventory =====
let fullInventory = [];

async function getOwnSteamID(){
  // robust: follow /my/inventory/, handle vanity -> xml, numeric profiles, g_steamID
  let res;
  try{
    res = await fetch("https://steamcommunity.com/my/inventory/", { credentials:'include' });
  }catch(e){ throw new Error("NET error @ /my/inventory/: "+(e?.message||e)); }
  const url = res.url || "";
  let mvan = url.match(/\/id\/([^\/?#]+)/);
  if (mvan){
    const xmlRes = await fetch(`https://steamcommunity.com/id/${mvan[1]}/?xml=1`, { credentials:'include' });
    const xml = await xmlRes.text();
    const mid = xml.match(/<steamID64>(\d{17})<\/steamID64>/);
    if (mid) return mid[1];
  }
  let mprof = url.match(/\/profiles\/(\d{17})/);
  if (mprof) return mprof[1];
  try{
    const r2 = await fetch("https://steamcommunity.com/my?l=english", { credentials:'include' });
    const html = await r2.text();
    const m = html.match(/\"g_steamID\"\s*:\s*\"(\d{17})\"/);
    if (m) return m[1];
  }catch{}
  const manual = prompt("Не вдалося визначити SteamID. Введи 17-значний SteamID:");
  if (manual && /^\d{17}$/.test(manual)) return manual;
  throw new Error("SteamID не визначено");
}

function resolveLang(){
  const htmlLang = (document.documentElement.lang||'').toLowerCase();
  if (htmlLang.startsWith('uk')) return 'ukrainian';
  if (htmlLang.startsWith('ru')) return 'russian';
  if (htmlLang.startsWith('cs')) return 'czech';
  if (htmlLang.startsWith('en')) return 'english';
  return 'english';
}

async function fetchInventoryPageLegacy(steamid, appid, contextid, start=""){
  const base = `https://steamcommunity.com/profiles/${steamid}/inventory/json/${appid}/${contextid}?l=${resolveLang()}`;
  const url = start ? `${base}/?start=${encodeURIComponent(start)}` : base;
  const res = await fetch(url, { credentials:'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
  const data = await res.json();
  const assets = [], descriptions = [];
  const rgInv = data.rgInventory || {};
  const rgDesc = data.rgDescriptions || {};
  for (const k in rgInv){
    const a = rgInv[k];
    assets.push({ appid: String(appid), contextid: String(contextid), assetid: String(a.id), classid: String(a.classid), instanceid: String(a.instanceid), amount: String(a.amount||"1") });
  }
  for (const k in rgDesc){
    const d = rgDesc[k];
    descriptions.push({ classid:String(d.classid), instanceid:String(d.instanceid), name:d.name, market_name:d.market_name, market_hash_name:d.market_hash_name, icon_url:d.icon_url, tradable:Number(d.tradable||0) });
  }
  return { assets, descriptions, more_items: Boolean(data.more), last_assetid: data.last_assetid };
}

async function fetchInventoryJSONPaged(steamid, appid, contextid){
  const lang = resolveLang();
  const mkBase = ()=> `https://steamcommunity.com/inventory/${steamid}/${appid}/${contextid}?l=${encodeURIComponent(lang)}&count=2000&t=${Date.now()}&r=${Math.random().toString(36).slice(2)}`;
  let more = true, last_assetid = "", pages=0;
  const allAssets=[], allDescs=[];
  while (more){
    const url = mkBase() + (last_assetid ? `&start_assetid=${encodeURIComponent(last_assetid)}` : '');
    let tries=0;
    while(true){
      try{
        const res = await fetch(url, { credentials:'include' });
        if (!res.ok){
          const body = await res.text().catch(()=>'');
          if (res.status===429 || res.status>=500 || /duplicate/i.test(body)){
            if (++tries<=4){ await new Promise(r=>setTimeout(r, 600*tries)); continue; }
          }
          const err = new Error(`HTTP ${res.status} @ ${url}`); err.httpStatus=res.status; throw err;
        }
        const data = await res.json();
        if (data.assets) allAssets.push(...data.assets);
        if (data.descriptions) allDescs.push(...data.descriptions);
        more = Boolean(data.more_items);
        last_assetid = data.last_assetid;
        break;
      }catch(e){
        if (++tries<=4){ await new Promise(r=>setTimeout(r, 600*tries)); continue; }
        throw e;
      }
    }
    await new Promise(r=>setTimeout(r, 300));
  }
  return { assets: allAssets, descriptions: allDescs };
}

async function fetchInventoryAll(appid=730, contextid=2){
  const steamid = await getOwnSteamID();
  $("#invStatus").textContent = "Читаю інвентар…";
  let data=null;
  try{
    data = await fetchInventoryJSONPaged(steamid, appid, contextid);
  }catch(e1){
    try{ data = await fetchInventoryPageLegacy(steamid, appid, contextid); }
    catch(e2){ $("#invStatus").textContent = e1.message; throw e1; }
  }
  const assets = data.assets||[];
  const descs  = data.descriptions||[];
  
const map = {};
const classMap = {}; // fallback by classid
for (const d of descs){
  const key = `${String(d.classid)}_${String(d.instanceid)}`;
  map[key] = d;
  if (!classMap[String(d.classid)]) classMap[String(d.classid)] = d;
}
const acc = [];
for (const a of assets){
  const key = `${String(a.classid)}_${String(a.instanceid)}`;
  let d = map[key] || classMap[String(a.classid)] || {};
  const name = d.market_hash_name || d.market_name || d.name || "";
  const iconSrc = d.icon_url || d.icon_url_large || "";
  const icon = iconSrc ? (String(iconSrc).startsWith("http") ? iconSrc : `https://community.akamai.steamstatic.com/economy/image/${iconSrc}`) : "";
  const tradFlag = Number(d.tradable||0)===1;
  const markFlag = Number(d.marketable||0)===1;
  const tradable = tradFlag && markFlag;
  acc.push({ name, icon, tradable, classid: String(a.classid), instanceid: String(a.instanceid), amount: Number(a.amount||1), assetid: String(a.assetid||""), effectiveTradable: tradable, rawTrad: tradFlag?1:0, rawMark: markFlag?1:0 });
}
const grouped = {};

  for (const it of acc){
    const k = `${it.classid}_${it.instanceid}_${it.effectiveTradable?1:0}`;
    if (!grouped[k]) grouped[k] = { name: it.name, icon: it.icon, tradable: it.effectiveTradable, classid: it.classid, instanceid: it.instanceid, qty:0, assetids:[], rawTradYes:0, rawMarkYes:0 };
    grouped[k].qty += Number(it.amount || 1);
    grouped[k].rawTradYes += it.rawTrad ? (it.amount||1) : 0;
    grouped[k].rawMarkYes += it.rawMark ? (it.amount||1) : 0;
    grouped[k].assetids.push(it.assetid);
  }
  fullInventory = Object.values(grouped).sort((a,b)=> a.name.localeCompare(b.name));
  $("#invStatus").textContent = `Готово. Унікальних предметів: ${fullInventory.length}`;
  renderInventory();
}

function renderInventory(){
  const body = $("#invTbl tbody");
  const q = ($("#invSearch")?.value||"").trim().toLowerCase();
  body.innerHTML = "";
  for (const r of fullInventory){
    if (q && !r.name.toLowerCase().includes(q)) continue;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.icon?`<img src="${r.icon}" alt="" style="width:28px;height:28px;border-radius:4px">`:''}</td>
      <td>${r.name}</td>
      <td>${r.qty}</td>
      <td title="trad:${r.rawTradYes||0}/${r.qty} • market:${r.rawMarkYes||0}/${r.qty}">${r.tradable? "YES":"NO"}</td>
      <td><button class="btnAddInv" data-name="${r.name.replace(/"/g,'&quot;')}">+ в портфель</button></td>
    `;
    body.appendChild(tr);
  }
}

async function addInvToPortfolio(name){
  let it = state.items.find(x => (x.name||"").trim().toLowerCase() === name.trim().toLowerCase());
  if (!it){
    it = { id: uid(), name, tags:"", itemUrl:"", apiUrl:"", lots:[], sells:[], firstSellPrice:null, firstBuyPrice:null, firstBuyQty:null, lastFetchedAt:null, priceHistory:[] };
    state.items.push(it);
  }
  it.lots.push({ id: uid(), qty: 1, price: 0, date: todayISO() });
  await save();
  renderAll();
}

document.addEventListener("DOMContentLoaded", ()=>{
  $("#loadInvBtn")?.addEventListener("click", ()=> fetchInventoryAll().catch(e=> $("#invStatus").textContent = "Помилка: "+e.message ));
  $("#invSearch")?.addEventListener("input", ()=> renderInventory());
  $("#invTbl")?.addEventListener("click", (e)=>{
    const t = e.target;
    if (t.classList.contains("btnAddInv")){
      addInvToPortfolio(t.dataset.name);
    }
  });
});
// ===== end inventory =====


// ===== Local save (short summary) =====
document.getElementById("saveLocalSummaryBtn")?.addEventListener("click", async ()=>{
  try{
    const fmt = n => (isFinite(n) ? Number(n).toFixed(2) : "0.00");
    const pad = n => String(n).padStart(2,'0');

    const currSnap = (typeof buildSnapshot === "function" ? buildSnapshot(state.items) : {});

    const resp = await chrome.storage.local.get(["lastLocalSummarySnap", "lastLocalSummaryTotals"]);
    const prevSnap = resp?.lastLocalSummarySnap || null;
    const prevTotals = resp?.lastLocalSummaryTotals || null;

    let totalInvested = 0, totalUnreal = 0, totalQty = 0;
    for (const it of (state.items || [])) {
      const m = (typeof calc === "function" ? (calc(it) || {}) : {});
      const invested = m.netCost ?? 0;
      const unreal   = m.unrealized ?? 0;
      const qty      = m.heldQty ?? it.amount ?? it.qty ?? 0;
      totalInvested += invested;
      totalUnreal   += unreal;
      totalQty      += qty;
    }
    const totals = (typeof portfolioTotals === "function" ? portfolioTotals() : { totalRealized: 0 });
    const bucket = (typeof loadRealizedTotal === "function" ? (await loadRealizedTotal()) : { pnl: 0 });
    const totalRealizedAll = (totals.totalRealized || 0) + (bucket.pnl || 0);
    const currTotals = { totalInvested, totalUnreal, totalQty, totalRealizedAll };

    let bought = [], sold = []; let spentBuy = 0; let soldGross = 0; let soldNet = 0;
    if (prevSnap && typeof diffSnapshots === "function"){
      const d = diffSnapshots(prevSnap, currSnap) || {};
      bought = d.bought || [];
      // сума витраченого на купівлі в цьому періоді
      spentBuy = (bought || []).reduce((s,x)=> s + (Number(x.delta||0) * Number(x.price||0)), 0);
      sold   = d.sold   || [];

      // map by display name from prevSnap to handle localized names vs keys
      let nameMap = {};
      try {
        for (const k of Object.keys(prevSnap || {})) {
          const rec = (prevSnap || {})[k] || {};
          if (rec && rec.name) { nameMap[rec.name] = rec; }
        }
      } catch(e) {}
      // compute aggregates
      soldGross = (sold || []).reduce((s,x)=> s + (Number(x.delta||0) * Number(x.price||0)), 0);
      (function(){
        soldNet = (sold || []).reduce((s,x)=>{
          const prev = (prevSnap && prevSnap[x.name]) || nameMap[x.name] || {};
          const buyQty = Number(prev.buyQty || 0);
          const buyValue = Number(prev.buyValue || 0);
          const avgCost = buyQty > 0 ? (buyValue / buyQty) : 0;
          return s + Number(x.delta||0) * (Number(x.price||0) - avgCost);
        }, 0);
      })();
          // сума отриманого з продаж (брутто) та чистими (від середньої собівартості з prevSnap)
      soldGross = (sold || []).reduce((s,x)=> s + (Number(x.delta||0) * Number(x.price||0)), 0);
      (function(){
        const snap = prevSnap || {};
        soldNet = (sold || []).reduce((s,x)=>{
          const prev = snap[x.name] || {};
          const buyQty = Number(prev.buyQty || 0);
          const buyValue = Number(prev.buyValue || 0);
          const avgCost = buyQty > 0 ? (buyValue / buyQty) : 0;
          return s + Number(x.delta||0) * (Number(x.price||0) - avgCost);
        }, 0);
      })();
    
    }

    const lines = [];
    const now = new Date();
    const stamp = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    lines.push(`📄 Звіт змін (локально) — ${stamp}`);

    if (!prevSnap){
      lines.push("");
      lines.push("Базовий знімок стану збережено (раніше не було з чим порівняти).");
      lines.push(`Позицій: ${state.items?.length || 0}`);
    } else {
      if (bought.length || sold.length){
        if (bought.length){
          lines.push("");
          lines.push("🆕 Куплено з моменту минулого звіту:");
          for (const x of bought){
            lines.push(`  + ${x.name} ×${x.delta} за ₴${fmt(x.price)}`);
          }
        }
        if (sold.length){
          lines.push("");
          lines.push("💸 Продано з моменту минулого звіту:");
          for (const x of sold){
            lines.push(`  − ${x.name} ×${x.delta} за ₴${fmt(x.price)}`);
          }
        }
      } else {
        lines.push("");
        lines.push("Змін у купівлях/продажах не виявлено.");
      }

      const prevT = prevTotals || { totalInvested:0, totalUnreal:0, totalQty:0, totalRealizedAll:0 };
      const dInv = currTotals.totalInvested - (prevT.totalInvested||0);
      const dUnr = currTotals.totalUnreal   - (prevT.totalUnreal||0);
      const dQty = currTotals.totalQty      - (prevT.totalQty||0);
      const dReal= currTotals.totalRealizedAll - (prevT.totalRealizedAll||0);
      soldNet = dReal; // tie net sales to realized PnL delta for the period
lines.push("");
      lines.push("Δ Підсумки від минулого звіту:");
lines.push(`  💳 Витрачено на купівлю: ₴${fmt(spentBuy)}`);
lines.push(`  💵 Отримано з продаж (брутто): ₴${fmt(soldGross)}`);
      lines.push(`  💸 Отримано з продаж (чистими): ₴${fmt(soldNet)}`);
lines.push(`  💰 Зміна інвестованого (нетто): ₴${fmt(dInv)} (тепер ₴${fmt(currTotals.totalInvested)})`);
lines.push(`  📉 ∆ Unrealized PnL: ₴${fmt(dUnr)} (тепер ₴${fmt(currTotals.totalUnreal)})`);
      lines.push(`  📦 ∆ К-сть активних: ${dQty >= 0 ? "+" + Math.trunc(dQty) : Math.trunc(dQty)} (тепер ${Math.trunc(currTotals.totalQty)})`);
      lines.push(`  📈 ∆ Realized PnL: ₴${fmt(dReal)} (тепер ₴${fmt(currTotals.totalRealizedAll)})`);
    }

    const text = lines.join("\n");

    const fname = `report_changes_${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}.txt`;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);

    await chrome.storage.local.set({ 
      lastLocalSummarySnap: currSnap,
      lastLocalSummaryTotals: currTotals
    });
  } catch(err){
    console.error("Save local summary (diff) failed:", err);
    alert("Не вдалося зберегти звіт зі змінами: " + (err?.message || err));
  }
});


// ===== Auto-update Portfolio from Steam History =====
const STORAGE_KEY_LAST_HIST_MARKER = 'lastSteamHistoryMarker';

async function autoUpdatePortfolioFromHistory(){
  $("#steamStatus").textContent = "Оновлення портфелю з історії…";
  let marker = (await chrome.storage?.local?.get?.([STORAGE_KEY_LAST_HIST_MARKER]))?.[STORAGE_KEY_LAST_HIST_MARKER];
  if (marker == null){
    // First run: fetch first page, set marker to first row and exit
    const chunk = await fetchSteamChunk(0, 100);
    if (chunk.length){
      const newest = makeHistoryMarker(chunk[0]);
      await chrome.storage.local.set({ [STORAGE_KEY_LAST_HIST_MARKER]: newest });
      $("#steamStatus").textContent = "Перший запуск: зафіксовано поточний стан історії. Натисни ще раз, щоб обробити нові події.";
    } else {
      $("#steamStatus").textContent = "Історія порожня.";
    }
    return;
  }

  // Iterate pages until we find marker or run out
  let start = 0;
  const pageSize = 100;
  let found = false;
  let toProcess = []; // newest -> older (before marker)
  let newestMarkerThisRun = null;

  while(true){
    const page = await fetchSteamChunk(start, pageSize);
    if (page.length === 0) break;
    if (!newestMarkerThisRun) newestMarkerThisRun = makeHistoryMarker(page[0]);
    for (const row of page){
      const m = makeHistoryMarker(row);
      if (m === marker){ found = true; break; }
      toProcess.push(row);
    }
    if (found) break;
    start += page.length;
    // Safety: avoid infinite loops
    if (page.length < pageSize) break;
    await new Promise(r=>setTimeout(r, 300));
  }

  if (!toProcess.length){
    $("#steamStatus").textContent = found ? "Нових записів немає." : "Не знайшов попередню позицію — можливо історію обрізано.";
    if (found && newestMarkerThisRun) await chrome.storage.local.set({ [STORAGE_KEY_LAST_HIST_MARKER]: newestMarkerThisRun });
    return;
  }

  // Process newest -> older (reverse to apply chronological order oldest->newest)
  toProcess.reverse();
  let applied = 0, skipped = 0, errors = 0;
  for (const r of toProcess){
    try{
      const it = state.items.find(x => (x.name||"").trim().toLowerCase() === r.name.trim().toLowerCase());
      if (!it){
        skipped++; // skip items not in portfolio
        continue;
      }
      if (r.acted === "bought"){
        // Only update existing items; do NOT create new ones
        it.lots = Array.isArray(it.lots) ? it.lots : [];
        it.lots.push({ id: uid(), qty: 1, price: r.price, date: todayISO() });
        applied++;
      } else if (r.acted === "sold"){
        const m = calc(it);
        if ((m.heldQty||0) < 1){
          skipped++; // can't sell nonexistent qty
          continue;
        }
        it.sells = Array.isArray(it.sells) ? it.sells : [];
        it.sells.push({ id: uid(), qty: 1, price: r.price, date: todayISO(), avgCostAtSale: m.avgCost });
        applied++;
      } else {
        skipped++;
      }
    }catch(e){
      console.error("apply error", e);
      errors++;
    }
  }

  await save();
  if (newestMarkerThisRun) await chrome.storage.local.set({ [STORAGE_KEY_LAST_HIST_MARKER]: newestMarkerThisRun });
  $("#steamStatus").textContent = `Готово: застосовано ${applied}, пропущено ${skipped}${errors ? ", помилок: " + errors : ""}.`;
}

document.addEventListener("DOMContentLoaded", () => {
  $("#updatePortfolioAuto")?.addEventListener("click", autoUpdatePortfolioFromHistory);
});


// --- Language toggle ---
(function(){
  const btn = document.getElementById('langBtn');
  if (!btn) return;
  function update(){
    try{
      const cur = window.__extI18n ? window.__extI18n.getLang() : 'ukr';
      // Show the *other* option on the button
      btn.textContent = (cur === 'eng') ? 'UKR' : 'ENG';
      btn.setAttribute('aria-label', cur === 'eng' ? 'Switch to Ukrainian' : 'Перемкнути на англійську');
      btn.title = btn.getAttribute('aria-label');
    }catch(e){}
  }
  btn.addEventListener('click', ()=>{
    try{
      const cur = window.__extI18n ? window.__extI18n.getLang() : 'ukr';
      const next = (cur === 'eng') ? 'ukr' : 'eng';
      if (window.__extI18n) window.__extI18n.setLang(next);
    }catch(e){}
    update();
  });
  // wait a tick for i18n to init
  setTimeout(update, 50);
})();