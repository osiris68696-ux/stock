"use strict";
/* ARES 股票分析 — GitHub Pages 純前端版
 * 安全：固定資料來源 (FinMind 開放 API，免金鑰)；不使用 eval/exec；不接受使用者自訂 URL；
 * 持股只存 localStorage；不含任何 .env / Token / Chat ID / 私人持股。
 */
const LS_KEY = "ares_holdings";
const FINMIND = "https://api.finmindtrade.com/api/v4/data";   // 固定來源，唯一允許的網域
const TW_RE = /^[0-9]{4,6}$/;
const US_RE = /^[A-Za-z]{1,10}$/;
const $ = (id) => document.getElementById(id);

/* ---------- localStorage 持股 ---------- */
function getHoldings() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { return []; } }
function setHoldings(list) { localStorage.setItem(LS_KEY, JSON.stringify(list)); renderHoldings(); }
function renderHoldings() {
  const box = $("holdings"); const list = getHoldings(); box.innerHTML = "";
  if (!list.length) { box.innerHTML = '<span class="muted">尚未加入任何持股</span>'; return; }
  list.forEach((h) => {
    const chip = document.createElement("span"); chip.className = "chip";
    const tip = h.cost ? ` ($${h.cost}×${h.qty || "?"})` : "";
    chip.innerHTML = `<a href="#" data-m="${esc(h.market)}" data-s="${esc(h.symbol)}">${esc(h.market)} ${esc(h.symbol)}${esc(tip)}</a> <b data-del="${esc(h.market)}:${esc(h.symbol)}">✕</b>`;
    box.appendChild(chip);
  });
}

/* ---------- 小工具 ---------- */
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function fmt(v, n = 2) { return (v == null || isNaN(v)) ? "—" : Number(v).toFixed(n); }
function pct(v) { return v == null || isNaN(v) ? "—" : (v >= 0 ? "🔺" : "🔻") + Number(v).toFixed(2) + "%"; }
function ul(items) { return "<ul>" + (items || []).map((x) => `<li>${esc(x)}</li>`).join("") + "</ul>"; }
function ago(days) { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); }

/* ---------- 技術指標 (純 JS) ---------- */
function sma(arr, n) { if (arr.length < n) return null; const s = arr.slice(-n).reduce((a, b) => a + b, 0); return s / n; }
function rsi(arr, period = 14) {
  if (arr.length < period + 1) return null;
  let gain = 0, loss = 0;
  for (let i = arr.length - period; i < arr.length; i++) {
    const ch = arr[i] - arr[i - 1];
    if (ch >= 0) gain += ch; else loss -= ch;
  }
  const ag = gain / period, al = loss / period;
  if (al === 0) return 100;
  const rs = ag / al; return 100 - 100 / (1 + rs);
}

/* ---------- 資料來源 (FinMind，固定網域) ---------- */
async function fm(dataset, id, start) {
  const u = `${FINMIND}?dataset=${encodeURIComponent(dataset)}&data_id=${encodeURIComponent(id)}` + (start ? `&start_date=${start}` : "");
  const r = await fetch(u);
  if (r.status === 402 || r.status === 429) throw new Error("資料來源限流，請稍候再試（公開 API 流量上限）");
  if (!r.ok) throw new Error("資料來源 HTTP " + r.status);
  const j = await r.json();
  if (j.status !== 200) throw new Error(j.msg || "資料來源回應異常");
  return j.data || [];
}

/* ---------- 分析組裝 ---------- */
function indicatorsFrom(closes, highs, lows) {
  const last = closes[closes.length - 1];
  const prev = closes.length > 1 ? closes[closes.length - 2] : null;
  const ma20 = sma(closes, 20), ma60 = sma(closes, 60);
  const r = rsi(closes, 14);
  let score = 0;
  if (ma20 != null) score += last > ma20 ? 1 : -1;
  if (ma20 != null && ma60 != null) score += ma20 > ma60 ? 1 : -1;
  if (r != null) { if (r >= 70) score -= 1; else if (r <= 30) score += 1; }
  const signal = score >= 2 ? "偏多 🟢" : score <= -2 ? "偏空 🔴" : "中性 ⚪";
  return {
    close: last, change_pct: prev ? (last - prev) / prev * 100 : null,
    ma5: sma(closes, 5), ma10: sma(closes, 10), ma20, ma60, rsi: r,
    support: lows.length >= 5 ? Math.min(...lows.slice(-20)) : null,
    resistance: highs.length >= 5 ? Math.max(...highs.slice(-20)) : null,
    signal,
  };
}

function simpleValuation(per, dy) {
  if (per == null || per <= 0) return null;
  let zone = per < 12 ? "便宜" : per <= 20 ? "合理偏低" : per <= 30 ? "合理偏高" : "偏高";
  let note = `本益比 ${fmt(per, 1)} → ${zone}`;
  if (dy != null) note += `、殖利率 ${fmt(dy, 2)}%`;
  return note;
}

function simpleDecision(ind, per) {
  const reasons = [], cautions = [];
  if (ind.rsi != null && ind.rsi >= 75) cautions.push(`RSI ${fmt(ind.rsi, 0)} 過熱，短線追價風險`);
  if (ind.rsi != null && ind.rsi <= 30) reasons.push(`RSI ${fmt(ind.rsi, 0)} 偏低（超賣）`);
  if (ind.ma20 != null && ind.close > ind.ma20) reasons.push("站上月線 (MA20)"); else if (ind.ma20 != null) cautions.push("跌破月線 (MA20)");
  if (ind.ma20 != null && ind.ma60 != null && ind.ma20 > ind.ma60) reasons.push("均線多頭排列");
  if (per != null && per > 0 && per < 15) reasons.push(`本益比 ${fmt(per, 1)} 不貴`);
  if (per != null && per >= 30) cautions.push(`本益比 ${fmt(per, 1)} 偏高`);
  let action;
  if (ind.signal.startsWith("偏多") && cautions.length === 0) action = "偏多 · 可分批觀察";
  else if (ind.signal.startsWith("偏空")) action = "偏空 · 觀望";
  else if (ind.rsi != null && ind.rsi >= 75) action = "過熱 · 觀望不追高";
  else action = "中性 · 分批觀察";
  return { action, reasons, cautions };
}

function holdingPnl(price, cost, qty) {
  if (!cost || !qty || !price) return null;
  const ret = (price - cost) / cost * 100;
  const pnl = (price - cost) * qty;
  let suggestion = "續抱觀察";
  const notes = [];
  if (ret <= -15) { suggestion = "注意停損"; notes.push(`虧損 ${fmt(ret, 1)}%，檢視基本面並嚴設停損`); }
  else if (ret >= 30) { suggestion = "可考慮部分停利"; notes.push(`獲利 ${fmt(ret, 1)}%，可部分停利、續抱核心`); }
  else notes.push("報酬在合理區間，續抱觀察");
  return { cost, qty, market_value: price * qty, return_pct: ret, pnl, suggestion, notes };
}

/* TW：價格 + PER/PBR/殖利率 + 名稱 */
async function analyzeTW(code) {
  const [price, per, info] = await Promise.all([
    fm("TaiwanStockPrice", code, ago(400)),
    fm("TaiwanStockPER", code, ago(20)).catch(() => []),
    fm("TaiwanStockInfo", code).catch(() => []),
  ]);
  if (!price.length) throw new Error(`查無 ${code} 的台股資料，請確認代號`);
  const closes = price.map((d) => d.close), highs = price.map((d) => d.max), lows = price.map((d) => d.min);
  const ind = indicatorsFrom(closes, highs, lows);
  const pe = per.length ? per[per.length - 1].PER : null;
  const pb = per.length ? per[per.length - 1].PBR : null;
  const dy = per.length ? per[per.length - 1].dividend_yield : null;
  const name = info.length ? info[0].stock_name : code;
  const industry = info.length ? info[0].industry_category : null;
  return { market: "TW", symbol: code, name, industry, ind, fund: { pe, pb, dy }, full: true };
}

/* US：價格 + 技術 (基本面/籌碼需後端) */
async function analyzeUS(sym) {
  const price = await fm("USStockPrice", sym, ago(400));
  if (!price.length) throw new Error(`查無 ${sym} 的美股資料，請確認代號`);
  const closes = price.map((d) => d.Close), highs = price.map((d) => d.High), lows = price.map((d) => d.Low);
  const ind = indicatorsFrom(closes, highs, lows);
  return { market: "US", symbol: sym.toUpperCase(), name: sym.toUpperCase(), ind, fund: {}, full: false };
}

async function analyze(symbol, market, cost, qty) {
  symbol = String(symbol || "").trim();
  if (market === "TW") symbol = symbol.toUpperCase();
  if (market === "US") symbol = symbol.toUpperCase();
  const card = document.createElement("div"); card.className = "card result";
  card.innerHTML = `<div class="muted">分析 ${esc(market)} ${esc(symbol)} 中…</div>`;
  $("results").prepend(card);
  // 代號格式驗證 (擋注入；不接受任意輸入)
  if (market === "TW" && !TW_RE.test(symbol)) { card.innerHTML = `<div class="err">⚠️ 台股代號格式不正確（例 2330）</div>`; return; }
  if (market === "US" && !US_RE.test(symbol)) { card.innerHTML = `<div class="err">⚠️ 美股代號格式不正確（例 AAPL）</div>`; return; }
  try {
    const a = market === "TW" ? await analyzeTW(symbol) : await analyzeUS(symbol);
    a.holding = holdingPnl(a.ind.close, parseFloat(cost) || null, parseFloat(qty) || null);
    card.innerHTML = renderResult(a);
  } catch (e) {
    card.innerHTML = `<div class="err">⚠️ ${esc(e.message || "分析失敗")}</div>
      <p class="muted">若為 CORS / 限流，請稍後再試；完整分析請改用本機 Python 版。</p>`;
  }
}

function renderResult(a) {
  const i = a.ind, f = a.fund;
  const dec = simpleDecision(i, f.pe);
  const val = a.market === "TW" ? simpleValuation(f.pe, f.dy) : null;
  let holdHtml = "";
  if (a.holding) {
    const h = a.holding, cls = h.return_pct >= 0 ? "pnl-up" : "pnl-down";
    holdHtml = `<div class="holding"><h4>💼 我的持股損益</h4>
      <p>成本 ${fmt(h.cost)}　股數 ${fmt(h.qty, 0)}　市值 ${fmt(h.market_value)}</p>
      <p class="${cls}">報酬率 ${fmt(h.return_pct)}%　損益 ${fmt(h.pnl)}</p>
      <p>建議：<b>${esc(h.suggestion)}</b></p>${ul(h.notes)}</div>`;
  }
  const techList = [
    `均線：MA5 ${fmt(i.ma5)} / MA10 ${fmt(i.ma10)} / MA20 ${fmt(i.ma20)} / MA60 ${fmt(i.ma60)}`,
    `支撐 / 壓力：${fmt(i.support)} / ${fmt(i.resistance)}（近20日低 / 高）`,
    `RSI：${i.rsi == null ? "—" : fmt(i.rsi, 0) + (i.rsi >= 70 ? "（過熱）" : i.rsi <= 30 ? "（偏弱）" : "（健康）")}`,
    `技術訊號：${i.signal}`,
  ];
  const fundList = a.market === "TW"
    ? [`本益比 P/E：${fmt(f.pe, 1)}`, `股價淨值比 P/B：${fmt(f.pb, 2)}`, `殖利率：${f.dy == null ? "—" : fmt(f.dy, 2) + "%"}`]
    : ["美股完整基本面 / 籌碼分析需 Python 後端，純前端版僅提供價格與技術指標"];
  const usNote = a.market === "US"
    ? `<div class="warn">ℹ️ 美股資料來源需後端支援，GitHub Pages 純前端版暫不支援完整即時分析（基本面 / 籌碼 / AI 決策）。本頁提供價格與技術指標。</div>` : "";
  return `
    <div class="rhead">
      <h3>${esc(a.symbol)} ${esc(a.name || "")}${a.industry ? ` <span class="muted">· ${esc(a.industry)}</span>` : ""}</h3>
      <div class="price">${fmt(i.close)} <span>${pct(i.change_pct)}</span></div>
    </div>
    ${usNote}${holdHtml}
    <div class="grid">
      <div><h4>🤖 簡化研判（純前端規則式）</h4>
        <p><b>${esc(dec.action)}</b></p>
        ${val ? `<p>估值：${esc(val)}</p>` : ""}
        ${dec.reasons.length ? "<p>👍 偏多訊號</p>" + ul(dec.reasons) : ""}
        ${dec.cautions.length ? "<p>👎 留意</p>" + ul(dec.cautions) : ""}
        <p class="muted">完整 AI 決策引擎（信心 / 風險等級 / 資金配置 / 風報比 / 估值區間）需 Python 後端。</p>
      </div>
      <div><h4>📐 技術面</h4>${ul(techList)}</div>
      <div><h4>🧱 基本面</h4>${ul(fundList)}</div>
    </div>
    <p class="disc">以上為公開資料整理與技術指標，僅供研究，不構成投資建議。</p>`;
}

/* ---------- 事件 ---------- */
$("go").addEventListener("click", () => {
  const s = $("symbol").value.trim();
  if (s) analyze(s, $("market").value, $("cost").value.trim(), $("qty").value.trim());
});
$("symbol").addEventListener("keydown", (e) => { if (e.key === "Enter") $("go").click(); });
$("save").addEventListener("click", () => {
  const s = $("symbol").value.trim().toUpperCase(); if (!s) return;
  const m = $("market").value;
  const cost = parseFloat($("cost").value) || null, qty = parseFloat($("qty").value) || null;
  const list = getHoldings().filter((h) => !(h.symbol === s && h.market === m));
  list.push({ symbol: s, market: m, cost, qty }); setHoldings(list);
});
$("holdings").addEventListener("click", (e) => {
  const del = e.target.getAttribute("data-del");
  if (del) { const [m, s] = del.split(":"); setHoldings(getHoldings().filter((h) => !(h.market === m && h.symbol === s))); return; }
  const a = e.target.closest("a");
  if (a) { e.preventDefault(); const m = a.getAttribute("data-m"), s = a.getAttribute("data-s");
    const h = getHoldings().find((x) => x.market === m && x.symbol === s) || {};
    analyze(s, m, h.cost, h.qty); }
});
$("analyzeAll").addEventListener("click", () => getHoldings().forEach((h) => analyze(h.symbol, h.market, h.cost, h.qty)));
$("clearAll").addEventListener("click", () => { if (confirm("清空我的持股？")) setHoldings([]); });

renderHoldings();
