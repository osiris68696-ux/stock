"use strict";
const LS_KEY = "ai_stock_holdings";
const $ = (id) => document.getElementById(id);

function getHoldings() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; }
  catch { return []; }
}
function setHoldings(list) {
  localStorage.setItem(LS_KEY, JSON.stringify(list));
  renderHoldings();
}
function renderHoldings() {
  const list = getHoldings();
  const box = $("holdings");
  box.innerHTML = "";
  if (!list.length) { box.innerHTML = '<span class="muted">尚未加入任何持股</span>'; return; }
  list.forEach((h) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    const tip = (h.cost ? ` ($${h.cost}×${h.qty || "?"})` : "");
    chip.innerHTML = `<a href="#" data-m="${h.market}" data-s="${h.symbol}">${h.market} ${h.symbol}${tip}</a> <b data-del="${h.market}:${h.symbol}">✕</b>`;
    box.appendChild(chip);
  });
}

function stars(n) { return "★".repeat(n) + "☆".repeat(5 - n); }
function pct(v) { return v == null ? "—" : (v >= 0 ? "🔺" : "🔻") + v.toFixed(2) + "%"; }
function ul(items) { return "<ul>" + (items || []).map((x) => `<li>${esc(x)}</li>`).join("") + "</ul>"; }
function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

async function analyze(symbol, market, into, cost, qty) {
  const card = document.createElement("div");
  card.className = "card result";
  card.innerHTML = `<div class="muted">分析 ${market} ${symbol} 中…</div>`;
  into.prepend(card);
  try {
    let url = `/api/analyze?symbol=${encodeURIComponent(symbol)}&market=${market}`;
    if (cost) url += `&cost=${encodeURIComponent(cost)}&qty=${encodeURIComponent(qty || 0)}`;
    const r = await fetch(url);
    const d = await r.json();
    if (!d.ok) { card.innerHTML = `<div class="err">⚠️ ${esc(d.error || "分析失敗")}</div>`; return; }
    card.innerHTML = renderResult(d);
  } catch (e) {
    card.innerHTML = `<div class="err">⚠️ 連線失敗：${esc(e.message)}</div>`;
  }
}

function renderResult(d) {
  const dec = d.decision || {};
  const su = dec.suitability || {};
  const vz = dec.valuation || {};
  const dq = d.data_quality || {};
  const tgt = dec.target != null ? `${dec.target}（${esc(dec.target_src || "")}）` : "資料不足";
  const stp = dec.stop != null ? `${dec.stop}（${esc(dec.stop_src || "")}）` : "資料不足";
  const vzStr = (vz.zone && vz.zone !== "資料不足")
    ? `${esc(vz.zone)}（合理區 ${vz.fair_low}~${vz.fair_high}${vz.position_pct != null ? "，位置 " + vz.position_pct + "%" : ""}）`
    : "資料不足";
  // 資料品質警示
  let dqHtml = "";
  if (dq && dq.ok === false) dqHtml = `<div class="err">⚠️ 資料異常：${esc(dq.note || "")}</div>`;
  // 持股損益
  let holdHtml = "";
  if (d.holding) {
    const h = d.holding;
    const cls = h.return_pct >= 0 ? "pnl-up" : "pnl-down";
    holdHtml = `<div class="holding">
      <h4>💼 我的持股損益</h4>
      <p>成本 ${h.cost}　股數 ${h.qty}　市值 ${h.market_value}</p>
      <p class="${cls}">報酬率 ${h.return_pct}%　損益 ${h.pnl}</p>
      <p>建議：<b>${esc(h.suggestion)}</b></p>${ul(h.notes)}
    </div>`;
  }
  return `
    <div class="rhead">
      <h3>${esc(d.symbol)} ${esc(d.name || "")} <span class="stars">${stars(d.stars)}</span></h3>
      <div class="price">${d.price ?? "—"} <span>${pct(d.change_pct)}</span></div>
      <div class="badge">綜合分 ${d.composite}/10　市場 ${esc(d.regime || "")}</div>
    </div>
    ${dqHtml}${holdHtml}
    <div class="grid">
      <div><h4>🤖 投資決策</h4>
        <p><b>${esc(dec.action || "—")}</b>　信心 ${dec.confidence ?? "—"}/100　風險 ${esc(dec.risk_level || "—")}</p>
        <p>建議資金配置 ${dec.capital_pct ?? "—"}%　｜風險報酬比 ${esc(dec.risk_reward || "—")}</p>
        <p>目標價 ${esc(tgt)}<br/>停損價 ${esc(stp)}</p>
        <p>估值區間：<b>${vzStr}</b></p>
        <p class="muted">保守型 ${esc(su["保守型"]||"")}｜穩健型 ${esc(su["穩健型"]||"")}｜成長型 ${esc(su["成長型"]||"")}</p>
        <p>👍 為什麼可以買</p>${ul(dec.buy_reasons)}
        <p>👎 為什麼不建議買</p>${ul(dec.not_buy_reasons)}
      </div>
      <div><h4>📌 推薦理由</h4>${ul(d.reasons)}
        <h4>🧱 基本面</h4>${ul(d.fundamentals)}
      </div>
      <div><h4>📐 技術面</h4>${ul(d.technical)}
        <h4>🏦 籌碼面</h4><p>${esc(d.chip || "資料不足")}</p>
      </div>
      <div><h4>🏭 產業趨勢 ${d.industry_verdict ? "【" + esc(d.industry_verdict) + "】" : ""}</h4><p>${esc(d.industry_trend || "")}</p>
        <h4>🚀 催化劑</h4>${ul(d.catalysts)}
        <h4>⚠️ 風險</h4>${ul(d.risks)}
      </div>
    </div>
    <p class="conclusion">✅ 結論：${esc(d.conclusion || "")}</p>
    <p class="disc">${esc(d.disclaimer || "")}</p>`;
}

$("go").addEventListener("click", () => {
  const s = $("symbol").value.trim();
  if (s) analyze(s, $("market").value, $("results"), $("cost").value.trim(), $("qty").value.trim());
});
$("symbol").addEventListener("keydown", (e) => { if (e.key === "Enter") $("go").click(); });
$("save").addEventListener("click", () => {
  const s = $("symbol").value.trim().toUpperCase();
  if (!s) return;
  const m = $("market").value;
  const cost = parseFloat($("cost").value) || null;
  const qty = parseFloat($("qty").value) || null;
  const list = getHoldings().filter((h) => !(h.symbol === s && h.market === m));
  list.push({ symbol: s, market: m, cost: cost, qty: qty });
  setHoldings(list);
});
$("holdings").addEventListener("click", (e) => {
  const del = e.target.getAttribute("data-del");
  if (del) { const [m, s] = del.split(":"); setHoldings(getHoldings().filter((h) => !(h.market === m && h.symbol === s))); return; }
  const a = e.target.closest("a");
  if (a) {
    e.preventDefault();
    const m = a.getAttribute("data-m"), s = a.getAttribute("data-s");
    const h = getHoldings().find((x) => x.market === m && x.symbol === s) || {};
    analyze(s, m, $("results"), h.cost, h.qty);
  }
});
$("analyzeAll").addEventListener("click", () => getHoldings().forEach((h) => analyze(h.symbol, h.market, $("results"), h.cost, h.qty)));
$("clearAll").addEventListener("click", () => { if (confirm("清空我的持股？")) setHoldings([]); });

renderHoldings();
