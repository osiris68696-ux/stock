"use strict";
/* 台美股智慧分析 — GitHub Pages 純前端
 * 安全：固定資料來源 FinMind 開放 API（免金鑰）；不使用 eval/exec；不接受使用者自訂 URL；
 * 持股只存 localStorage；無任何金鑰 / Token / Chat ID / 私人持股；K 線為 Canvas 即時繪製（非圖片、非 AI）。
 * FinMind 匿名僅日線（盤中/逐筆需付費等級），故價格一律標示「最新收盤價」，不偽裝即時報價。
 */
const LS_KEY = "twus_holdings";
const FINMIND = "https://api.finmindtrade.com/api/v4/data";   // 唯一允許的資料網域
const TW_RE = /^[0-9]{4,6}$/;
const US_RE = /^[A-Za-z]{1,10}$/;

// 前端股票名稱對照（純前端，無後端查詢）。key 一律小寫；中文小寫等同原字。
const SYMBOL_ALIASES = {
  "台積電": { market: "TW", symbol: "2330" }, "台積": { market: "TW", symbol: "2330" }, "tsmc": { market: "TW", symbol: "2330" },
  "鴻海": { market: "TW", symbol: "2317" }, "foxconn": { market: "TW", symbol: "2317" },
  "聯發科": { market: "TW", symbol: "2454" }, "mediatek": { market: "TW", symbol: "2454" },
  "台新新光金": { market: "TW", symbol: "2887" }, "台新金": { market: "TW", symbol: "2887" }, "新光金": { market: "TW", symbol: "2887" },
  "輝達": { market: "US", symbol: "NVDA" }, "nvidia": { market: "US", symbol: "NVDA" }, "nvda": { market: "US", symbol: "NVDA" },
  "蘋果": { market: "US", symbol: "AAPL" }, "apple": { market: "US", symbol: "AAPL" }, "aapl": { market: "US", symbol: "AAPL" },
  "微軟": { market: "US", symbol: "MSFT" }, "microsoft": { market: "US", symbol: "MSFT" }, "msft": { market: "US", symbol: "MSFT" },
  "qqq": { market: "US", symbol: "QQQ" },
  "特斯拉": { market: "US", symbol: "TSLA" }, "tesla": { market: "US", symbol: "TSLA" }, "tsla": { market: "US", symbol: "TSLA" },
  "谷歌": { market: "US", symbol: "GOOGL" }, "google": { market: "US", symbol: "GOOGL" }, "alphabet": { market: "US", symbol: "GOOGL" }, "googl": { market: "US", symbol: "GOOGL" },
  "臉書": { market: "US", symbol: "META" }, "meta": { market: "US", symbol: "META" },
  "亞馬遜": { market: "US", symbol: "AMZN" }, "amazon": { market: "US", symbol: "AMZN" }, "amzn": { market: "US", symbol: "AMZN" },
  "amd": { market: "US", symbol: "AMD" }, "超微": { market: "US", symbol: "AMD" },
};
// 解析輸入：trim → alias → 代號格式 → 中文/未知名稱提示。回傳 {market,symbol,switched} 或 {error}
function resolveSymbolInput(raw) {
  const t = String(raw || "").trim();
  if (!t) return { error: "請輸入股票代號或名稱。" };
  const hit = SYMBOL_ALIASES[t.toLowerCase()];
  if (hit) return { market: hit.market, symbol: hit.symbol, switched: true };
  if (TW_RE.test(t)) return { market: "TW", symbol: t };
  if (US_RE.test(t)) return { market: "US", symbol: t.toUpperCase() };
  if (/[一-鿿]/.test(t)) return { error: "目前純前端版尚未支援完整中文名稱搜尋，請輸入股票代號，或使用已建立的常用名稱。" };
  return { error: "目前尚未建立此名稱對照，請輸入股票代號，例如 TSLA。" };
}
const US_NEWS_RE = /^[A-Za-z][A-Za-z.\-]{0,9}$/;   // 美股新聞搜尋（可含 . 或 -，如 BRK.B）
const PRICE_TYPE = "最新收盤價（FinMind 日線資料，非即時逐筆報價）";
const $ = (id) => document.getElementById(id);

/* ---------- 工具 ---------- */
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function fmt(v, n = 2) { return (v == null || isNaN(v)) ? "—" : Number(v).toFixed(n); }
function thou(v) { return (v == null || isNaN(v)) ? "—" : Math.round(v).toLocaleString("en-US"); }
function pct(v) { return v == null || isNaN(v) ? "—" : (v >= 0 ? "▲ +" : "▼ ") + Number(v).toFixed(2) + "%"; }
function signed(v) { return v == null || isNaN(v) ? "—" : (v >= 0 ? "+" : "") + Math.round(v).toLocaleString("en-US"); }
function ul(items) { return "<ul>" + (items || []).map((x) => `<li>${esc(x)}</li>`).join("") + "</ul>"; }
function ago(days) { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); }
function daysBetween(iso) { return Math.round((Date.now() - new Date(iso + "T00:00:00").getTime()) / 86400000); }
function nowTime() { const d = new Date(); return d.toTimeString().slice(0, 8); }
function nowStamp() { const d = new Date(); return d.toISOString().slice(0, 10) + " " + d.toTimeString().slice(0, 8); }
function toast(msg) { let t = $("toast"); if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); } t.textContent = msg; t.className = "show"; clearTimeout(t._t); t._t = setTimeout(() => { t.className = ""; }, 2800); }

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

/* ---------- 技術指標 ---------- */
function sma(arr, n) { if (arr.length < n) return null; return arr.slice(-n).reduce((a, b) => a + b, 0) / n; }
function smaSeries(arr, n) { return arr.map((_, i) => i + 1 >= n ? arr.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n : null); }
function rsi(arr, period = 14) {
  if (arr.length < period + 1) return null;
  let g = 0, l = 0;
  for (let i = arr.length - period; i < arr.length; i++) { const c = arr[i] - arr[i - 1]; if (c >= 0) g += c; else l -= c; }
  const ag = g / period, al = l / period;
  if (al === 0) return 100;
  return 100 - 100 / (1 + ag / al);
}

/* ---------- FinMind ---------- */
async function fm(dataset, id, start) {
  const u = `${FINMIND}?dataset=${encodeURIComponent(dataset)}&data_id=${encodeURIComponent(id)}` + (start ? `&start_date=${start}` : "");
  const r = await fetch(u, { cache: "no-store" });
  if (r.status === 402 || r.status === 429) throw new Error("資料來源限流，請稍候再試（公開 API 流量上限）");
  if (!r.ok) throw new Error("資料來源 HTTP " + r.status);
  const j = await r.json();
  if (j.status !== 200) throw new Error(j.msg || "資料來源回應異常");
  return j.data || [];
}
async function fmSafe(dataset, id, start) { try { return await fm(dataset, id, start); } catch { return null; } }
function num(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }

/* ---------- 指標 ---------- */
function buildIndicators(bars) {
  const closes = bars.map((b) => b.c), highs = bars.map((b) => b.h), lows = bars.map((b) => b.l), vols = bars.map((b) => b.v);
  const last = closes[closes.length - 1], prev = closes.length > 1 ? closes[closes.length - 2] : null;
  const ma20 = sma(closes, 20), ma60 = sma(closes, 60), ma5 = sma(closes, 5), ma10 = sma(closes, 10), ma200 = sma(closes, 200), r = rsi(closes, 14);
  const support = lows.length >= 5 ? Math.min(...lows.slice(-20)) : null;
  const resistance = highs.length >= 5 ? Math.max(...highs.slice(-20)) : null;
  let volRatio = null;
  if (vols.length >= 21) { const avg = vols.slice(-21, -1).reduce((a, b) => a + b, 0) / 20; if (avg) volRatio = vols[vols.length - 1] / avg; }
  return { close: last, change_pct: prev ? (last - prev) / prev * 100 : null, ma5, ma10, ma20, ma60, ma200, rsi: r, support, resistance, volRatio, distMa20: ma20 ? (last - ma20) / ma20 * 100 : null };
}

/* ---------- 決策 ---------- */
function decide(ind, fund, market) {
  const { close, ma5, ma10, ma20, rsi: r, support: sup, resistance: res, distMa20 } = ind;
  const trendUp = ma20 && close > ma20 && ma5 && ma10 && ma5 > ma10 && ma10 > ma20;
  const overheated = r != null && r >= 75;
  const belowMa20 = ma20 != null && close < ma20;
  const nearSupport = sup && close <= sup * 1.05;
  const nearResistance = res && close >= res * 0.97;
  const farFromMa20 = distMa20 != null && distMa20 > 12;
  let position;
  if (belowMa20) position = "跌破均線"; else if (overheated) position = "過熱";
  else if (nearResistance || farFromMa20) position = "偏高"; else if (nearSupport) position = "接近支撐"; else position = "合理區";
  let score = 50;
  if (trendUp) score += 15; else if (ma20 && close > ma20) score += 8;
  if (belowMa20) score -= 20;
  if (r != null) { if (r >= 80) score -= 25; else if (r >= 70) score -= 12; else if (r <= 30) score += 10; }
  if (nearSupport) score += 10; if (nearResistance) score -= 8; if (farFromMa20) score -= 10;
  if (market === "TW" && fund.pe != null) { if (fund.pe > 0 && fund.pe < 12) score += 6; else if (fund.pe > 30) score -= 6; }
  score = Math.max(0, Math.min(100, Math.round(score)));
  let risk = "中";
  if (overheated || farFromMa20 || (fund.pe != null && fund.pe >= 35)) risk = "高";
  else if (r != null && r < 70 && !nearResistance && (distMa20 == null || Math.abs(distMa20) <= 8)) risk = "低";
  let action;
  if (overheated) action = "不建議追高"; else if (belowMa20) action = "觀望";
  else if (score >= 68) action = nearSupport ? "可分批觀察" : "可小量布局";
  else if (score >= 55) action = "可分批觀察"; else if (score >= 45) action = "觀望"; else action = "風險偏高";
  // 進場限制風控（內部）：RSI 過熱 (>=70) 一律否決積極建議，公開 UI 只在觸發時顯示「進場限制」
  let veto = false, vetoReason = null;
  if (r != null && r >= 70 && ["買進", "可小量布局", "可分批觀察"].includes(action)) {
    veto = true; vetoReason = `RSI ${fmt(r, 0)} 已進入過熱區`;
    action = r >= 78 ? "不建議追高" : "觀望（RSI 過熱否決）";
    score = Math.min(score, 45);
  }
  const seg = [];
  if (overheated) seg.push(`目前 RSI ${fmt(r, 0)} 短線過熱`); else if (r != null && r <= 30) seg.push(`RSI ${fmt(r, 0)} 偏低、短線超賣`);
  if (trendUp) seg.push("均線多頭排列、趨勢偏多"); else if (belowMa20) seg.push("股價跌破月線、趨勢轉弱"); else seg.push("趨勢中性");
  let advise;
  if (overheated) advise = "短線追價風險高；若已持有可續抱觀察，若尚未進場，建議等待回落接近支撐區再分批，新進場宜保守";
  else if (belowMa20) advise = "方向未明，建議先觀望、待股價站回均線再評估";
  else if (nearSupport) advise = "股價接近支撐，可分批布局並嚴設停損，避免單筆重壓";
  else if (nearResistance) advise = "股價接近壓力，不宜追高，可待回測支撐區再進場";
  else advise = "可分批觀察、避免單筆重壓，並留意均線與量能變化";
  return { position, score, risk, action, veto, vetoReason, operation: seg.join("，") + "；" + advise + "。", trendUp, overheated, belowMa20, nearSupport, nearResistance, farFromMa20 };
}

/* ---------- 選股邏輯：分類分流 ---------- */
const _US_TECH = new Set(["NVDA", "AMD", "TSM", "AVGO", "AAPL", "MSFT", "GOOGL", "GOOG", "META", "AMZN", "TSLA", "NFLX", "CRM", "ADBE", "ORCL", "QCOM", "INTC", "MU", "ASML", "SMCI", "ARM", "PLTR", "MRVL", "AMAT", "LRCX"]);
const _US_ETF = new Set(["SPY", "QQQ", "VOO", "VTI", "DIA", "IWM", "ARKK", "SCHD", "VYM", "XLF", "XLK", "GLD", "SLV", "VT", "VEA", "VWO"]);
function classifyCategory(a) {
  const i = a.ind;
  if (!i || i.ma20 == null || i.rsi == null) return "資料不足";
  if (a.market === "TW") {
    if (/^00/.test(a.symbol)) return "ETF";
    const ind = a.industry || "";
    if (/金融|保險|銀行|證券|金控/.test(ind)) return "金融股";
    if (/半導體|電子|光電|通信|電腦|資訊|軟體|網路/.test(ind)) return "成長科技股";
    const f = a.fund || {};
    if ((f.eps != null && f.revYoy != null && f.revYoy >= 20)) return "成長科技股";
    return "一般股";
  }
  if (_US_ETF.has(a.symbol)) return "ETF";
  if (_US_TECH.has(a.symbol)) return "成長科技股";
  return "一般股";
}
function categoryNote(cat) {
  return {
    "ETF": "ETF 適合分批 / 定期定額長期持有，分散個股風險；不宜短線追高。",
    "金融股": "金融股看殖利率、股價淨值比與利率環境；通常波動較低、偏存股配置。",
    "成長科技股": "成長科技股估值較高、波動大，須留意 RSI 過熱與追高風險，宜分批。",
    "一般股": "一般個股以基本面 + 技術面 + 籌碼面綜合判斷，避免一次重壓。",
    "資料不足": "目前技術 / 基本面資料不足，僅供參考，不宜據此積極進場。",
  }[cat] || "";
}

/* ---------- 選股邏輯：動態因果明細 ---------- */
function evaluateStockLogic(a) {
  const i = a.ind || {}, f = a.fund || {}, chip = a.chip || {}, d = a.decision || {};
  const cat = classifyCategory(a);
  const rsi = i.rsi, close = i.close, ma20 = i.ma20, ma5 = i.ma5, ma10 = i.ma10, sup = i.support, res = i.resistance;
  const noTech = ma20 == null || rsi == null || close == null;
  const distSup = (sup && close) ? (close - sup) / sup * 100 : null;
  const distRes = (res && close) ? (res - close) / res * 100 : null;
  const belowMa20 = ma20 != null && close != null && close < ma20;
  const aboveMa20 = ma20 != null && close != null && close >= ma20;
  const bullStack = ma5 && ma10 && ma20 && ma5 > ma10 && ma10 > ma20;
  const weakStack = ma5 && ma10 && ma20 && (ma5 < ma10 || ma10 < ma20);
  const instNet = (chip.ok && chip.foreign != null) ? chip.foreign + (chip.trust || 0) + (chip.dealer || 0) : null;
  const marginUp = chip.ok && chip.marginChg != null && chip.marginBal != null && chip.marginChg > Math.abs(chip.marginBal) * 0.03;
  const fundMissing = f.pe == null && f.eps == null && f.revYoy == null;

  const isETF = cat === "ETF", isUS = a.market !== "TW";
  const pass = [], risks = [], missing = [], veto = [], dataNotes = [];

  if (rsi != null) {
    if (rsi < 40) pass.push(`RSI 目前為 ${fmt(rsi, 0)}，已脫離高檔超買區、進入修正區，短線追高風險下降，但仍需確認趨勢是否止穩。`);
    else if (rsi <= 65) pass.push(`RSI 目前為 ${fmt(rsi, 0)}，位於健康區間，短線沒有明顯過熱。`);
  }
  if (distSup != null && distSup >= 0 && distSup < 6) pass.push(`目前股價距離支撐 ${fmt(sup)} 約 ${fmt(distSup, 1)}%，下檔具備觀察區間。`);
  if (aboveMa20) pass.push("股價仍站上 MA20，短線趨勢尚未完全轉弱。");
  if (bullStack) pass.push("短期均線維持多頭排列（MA5 > MA10 > MA20），代表短線趨勢仍偏強。");
  if (instNet != null && instNet > 0) pass.push("法人籌碼偏向買超，資金面對股價有支撐。");
  if (f.dy != null && f.dy >= 3) pass.push(`殖利率 ${fmt(f.dy, 2)}% 具備一定收益性，對長線配置有支撐。`);
  if (cat === "成長科技股" && belowMa20) pass.push("成長科技股波動較大，若能重新站回 MA20、量能配合，可再評估趨勢修復。");
  if (isETF) pass.push("ETF 適合分批或定期定額長期配置，不需用個股短線追價邏輯操作。");

  if (belowMa20) risks.push("股價已跌破 MA20，短線多頭結構轉弱，需等待重新站回均線。");
  if (weakStack && !belowMa20) risks.push("短期均線排列轉弱（MA5 < MA10 或 MA10 < MA20），趨勢尚未恢復多頭。");
  if (rsi != null && rsi > 80) risks.push(`RSI ${fmt(rsi, 0)} 進入明顯過熱區，短線不適合直接追高。`);
  else if (rsi != null && rsi > 75) risks.push(`RSI ${fmt(rsi, 0)} 已偏高，短線追價風險增加。`);
  if (distSup != null && distSup > 10) risks.push(`目前價格距離支撐較遠（約 ${fmt(distSup, 0)}%），若追高進場，停損空間較大。`);
  if (distRes != null && distRes >= 0 && distRes < 5) risks.push("目前股價接近壓力區，容易遇到解套賣壓或短線獲利了結。");
  if (marginUp && (instNet == null || instNet <= 0)) risks.push("融資增加但法人未同步買超，需留意散戶追高風險。");
  if (instNet != null && instNet < 0) risks.push("法人近期偏賣超，籌碼面尚未轉強。");
  // 基本面 / 籌碼面：依分類分流（ETF 不適用個股基本面；美股為資料源限制，非公司劣勢）
  if (isETF) {
    // ETF 不適用個股 EPS / P/E / P/B / 殖利率 / 營收成長率評分（保留於程式邏輯，不在主畫面顯示「資料不足」）；
    // ETF 改以技術面、價格位置、風險控制評分，不產生個股基本面 missing、也不因缺這些欄位扣分。
  } else if (isUS) {
    dataNotes.push("基本面：資料源限制 — 純前端版尚未接入穩定的美股基本面資料源，EPS / P/E / P/B / 營收成長率暫不納入完整評分；屬資料源限制，非公司基本面不佳。");
    dataNotes.push("籌碼面：資料源限制 — 美股無台股三大法人 / 融資融券格式，純前端版尚未接入機構持股 / Short Interest / 分析師評等，籌碼面保守處理；完整美股籌碼資料有限，分析結果僅供參考。");
  } else {
    if (fundMissing) risks.push("基本面資料不足，無法確認公司獲利與估值是否支撐目前股價。");
    if (f.eps == null) missing.push("EPS 資料不足");
    if (f.pe == null) missing.push("P/E 資料不足");
    if (f.pb == null) missing.push("P/B 資料不足");
    if (f.dy == null) missing.push("殖利率資料不足");
    if (f.revYoy == null) missing.push("營收成長率資料不足");
    if (!chip.ok) missing.push("三大法人 / 融資融券資料不足");
  }

  if (d.veto) veto.push(`${d.vetoReason}，最高評級限制為 C。`);
  // 美股因基本面 / 籌碼為資料源限制，最高評級鎖 C（可觀察、不給積極布局）；ETF 以技術面評估、不受此限
  const hardLimit = !!d.veto || isUS || (!isETF && missing.length >= 5);

  // 子分數
  let tech = 0; const techMax = 35;
  if (aboveMa20) tech += 12; if (bullStack) tech += 10;
  if (rsi != null && rsi >= 40 && rsi <= 65) tech += 8; else if (rsi != null && rsi >= 35 && rsi < 40) tech += 5;
  if (distSup != null && distSup >= 0 && distSup < 6) tech += 5; tech = Math.min(tech, techMax);
  let fund = null; const fundMax = 25;
  if (!fundMissing) { fund = 0; if (f.pe != null && f.pe > 0 && f.pe <= 25) fund += 8; if (f.pb != null && f.pb <= 2) fund += 5; if (f.dy != null && f.dy >= 3) fund += 6; if (f.revYoy != null && f.revYoy > 0) fund += 6; fund = Math.min(fund, fundMax); }
  let chipS = null; const chipMax = 20;
  if (chip.ok && instNet != null) { chipS = 0; if (instNet > 0) chipS += 10; if (chip.foreign > 0) chipS += 4; if (!marginUp) chipS += 6; chipS = Math.min(chipS, chipMax); }
  let riskS = 20; const riskMax = 20;
  if (belowMa20) riskS -= 8; if (rsi != null && rsi >= 75) riskS -= 8; if (distSup != null && distSup > 10) riskS -= 5; if (distRes != null && distRes >= 0 && distRes < 5) riskS -= 4; if (instNet != null && instNet < 0) riskS -= 3;
  riskS = Math.max(0, Math.min(riskMax, riskS));
  const nearSup = distSup != null && distSup >= 0 && distSup < 6, nearRes = distRes != null && distRes >= 0 && distRes < 5, farSup = distSup != null && distSup > 10;
  // 價格位置分（ETF 用）
  let posS = 8; const posMax = 15;
  if (nearSup) posS += 5; if (aboveMa20) posS += 2; if (nearRes) posS -= 4; if (farSup) posS -= 5; posS = Math.max(0, Math.min(posMax, posS));
  // 正規化：資料不足的面向不計入分母；ETF 以技術面 + 風險控制 + 價格位置評分（不看個股基本面/籌碼）
  let availMax, total;
  if (isETF) {
    availMax = techMax + riskMax + posMax;
    total = Math.round((tech + riskS + posS) / availMax * 100);
  } else {
    availMax = techMax + riskMax + (fund != null ? fundMax : 0) + (chipS != null ? chipMax : 0);
    total = Math.round((tech + riskS + (fund || 0) + (chipS || 0)) / availMax * 100);
  }

  let grade, label;
  if (total >= 80) { grade = "A"; label = "條件優良"; }
  else if (total >= 65) { grade = "B"; label = "條件良好"; }
  else if (total >= 40) { grade = "C"; label = "條件普通"; }
  else if (total >= 25) { grade = "D"; label = "條件偏弱"; }
  else { grade = "E"; label = "條件不足"; }
  if (hardLimit && (grade === "A" || grade === "B")) { grade = "C"; label = "條件普通（資料不足，評級受限）"; }
  const screen = (grade === "A" || grade === "B") ? "可分批觀察" : grade === "C" ? "觀察" : grade === "D" ? "偏弱觀望" : "不宜進場";

  // 最低輸出保證 (item 九)
  if (noTech) pass.length = 0, pass.push("資料不足，僅能做初步觀察，不建議依此結果進場。");
  while (pass.length < 2) { const fl = ["技術面尚未出現明顯破壞訊號，可持續觀察是否轉強。", "可等待更明確的進場訊號（站回均線、量能放大）再評估。"]; const x = fl.find((s) => !pass.includes(s)); if (!x) break; pass.push(x); }
  while (risks.length < 2) { const fl = ["整體趨勢尚未明確轉強，不宜單筆重壓。", "突發消息 / 財報 / 政策變化難以預測，需控制部位。"]; const x = fl.find((s) => !risks.includes(s)); if (!x) break; risks.push(x); }

  // 動態結論 + 決策摘要補充（ETF 早於 belowMa20 判斷，確保 ETF 用 ETF 語氣）
  let conclusion, decNote;
  if (d.veto) { conclusion = "目前 RSI 偏高、屬過熱不宜追高。若已持有可續抱觀察；尚未進場者建議等待回落接近支撐再分批。"; decNote = "RSI 已進入過熱區，不宜追高，建議等待回落接近支撐再評估。"; }
  else if (noTech) { conclusion = "資料不足，僅能做初步觀察，不建議依此結果進場。"; decNote = "技術 / 基本面資料不足，僅能初步觀察，不宜進場。"; }
  else if (isETF) {
    if (farSup) conclusion = "目前價格距離支撐較遠，短線不宜追高；若是長期配置，可採分批或定期定額方式降低進場風險。";
    else if (rsi != null && rsi >= 40 && rsi <= 65 && aboveMa20) conclusion = "目前 RSI 位於健康區間，短線沒有明顯過熱；ETF 可列入觀察，但仍建議分批或定期定額，不宜一次投入。";
    else conclusion = "ETF 類標的主要以追蹤標的走勢與價格位置判斷。若 RSI 健康且價格接近支撐，可考慮分批；若距離支撐過遠或接近壓力區，則不宜一次追高。";
    decNote = "ETF 以追蹤標的走勢與價格位置判斷，適合分批 / 定期定額長期配置，不宜短線一次追高。";
  }
  else if (belowMa20 && rsi != null && rsi < 65) { conclusion = `目前屬於「可觀察但不宜急買」。雖然 RSI ${fmt(rsi, 0)} 已回到健康區間、追高風險下降，但股價仍跌破 MA20、趨勢尚未修復；若重新站回均線並量能配合，再考慮分批觀察。` + (isUS ? "同時純前端版缺乏完整美股基本面與籌碼資料（資料源限制，非公司劣勢），因此不適合給出積極買進結論。" : ""); decNote = "RSI 位於健康區間，但股價跌破 MA20、趨勢尚未修復，仍需等待轉強訊號。"; }
  else if (belowMa20) { conclusion = "股價跌破 MA20、趨勢轉弱，建議先觀察是否重新站回均線再評估。"; decNote = "股價跌破 MA20，短線趨勢轉弱，建議先觀察是否重新站回均線。"; }
  else if (isUS) { conclusion = "技術面可參考，但純前端版缺乏完整美股基本面與籌碼資料（資料源限制，非公司劣勢），僅能初步觀察，不適合給出積極買進結論。"; decNote = "美股基本面 / 籌碼為資料源限制（非公司不佳），僅能初步觀察、不宜積極布局。"; }
  else if (grade === "A" || grade === "B") { conclusion = "各面向條件相對占優，可分批觀察、避免一次重壓，並留意均線與量能變化。"; decNote = "各面向條件占優，可分批觀察、避免一次重壓。"; }
  else { conclusion = "條件普通，建議分批觀察、貼近支撐再評估，避免追高。"; decNote = "條件普通，建議分批觀察、貼近支撐再評估。"; }

  // 選股邏輯「分析摘要」：依標的分類給不同敘述，並解釋風險控制分數（item 六~九）
  const riskLow = riskS <= riskMax * 0.4, riskGood = riskS >= riskMax * 0.7;
  const riskNote = riskLow
    ? `風險控制分數偏低（${riskS} / ${riskMax}），通常代表目前價格位置不夠安全${rsi != null && rsi >= 70 ? "（RSI 偏高、短線過熱）" : ""}${farSup ? "、距離支撐較遠" : ""}${nearRes ? "、接近壓力區" : ""}，若此時追高，停損空間較大。`
    : riskGood
      ? `風險控制分數較佳（${riskS} / ${riskMax}），代表目前價格位置相對安全、短線沒有明顯過熱，但仍建議分批而非一次投入。`
      : `風險控制分數中等（${riskS} / ${riskMax}），價格位置尚可，建議分批進場並留意均線與量能變化。`;
  // 標的屬性：依分類說明「這類標的該怎麼看」（不混入優勢 / 風險 / 操作，分段呈現）
  let attr;
  if (cat === "資料不足" || noTech) {
    attr = "目前技術 / 基本面資料不足，僅能做初步觀察，不建議只憑此結果進場。";
  } else if (isETF) {
    attr = "ETF 是一籃子標的，不適合用單一公司 EPS / P/E / P/B 判斷，應以追蹤標的走勢、價格位置（RSI、支撐 / 壓力）與風險控制為主，操作上偏分批、定期定額與長期配置，不宜短線追高。";
  } else if (isUS) {
    attr = "目前純前端版本尚未接入完整美股基本面與籌碼資料，因此美股分析主要依價格、均線、RSI、支撐 / 壓力判斷。這是資料源限制，不代表公司本身基本面不佳；完整美股基本面與籌碼資料有限，分析結果僅供參考。";
  } else if (cat === "金融股") {
    attr = "金融股通常以殖利率、股價淨值比（P/B）、利率環境與獲利穩定性評估，偏向防禦與存股配置；短線仍需留意是否過熱。";
  } else {
    attr = "一般個股需同時觀察基本面、技術面與籌碼面，並留意目前價格是否接近支撐或壓力，避免只靠單一面向判斷進場。";
  }

  return { cat, grade, label, total, screen, isETF, isUS, sub: { tech, techMax, fund, fundMax, chip: chipS, chipMax, risk: riskS, riskMax, pos: posS, posMax }, pass, risks, missing, dataNotes, veto, hardLimit, conclusion, decNote, attr, riskNote };
}

/* ---------- 文字段落 ---------- */
function fundamentalExplain(fund, market) {
  if (market !== "TW") return "美股基本面（EPS / P/E / P/B / 殖利率 / 營收）純前端版資料不足，未硬推估；完整基本面建議搭配券商或官方資料。";
  const p = [];
  if (fund.pe != null) p.push(`P/E ${fmt(fund.pe, 1)} ${fund.pe < 12 ? "屬合理偏低" : fund.pe <= 20 ? "屬合理區間" : fund.pe <= 30 ? "略偏高" : "偏高"}`);
  if (fund.pb != null) p.push(`P/B ${fmt(fund.pb, 2)} ${fund.pb < 1 ? "低於每股淨值" : fund.pb <= 1.5 ? "尚屬合理" : fund.pb <= 3 ? "已不算便宜" : "偏高"}`);
  if (fund.dy != null) p.push(`殖利率 ${fmt(fund.dy, 2)}% ${fund.dy >= 5 ? "具吸引力" : fund.dy >= 3 ? "具一定收益性" : "偏低"}`);
  let s = p.length ? p.join("、") + "。" : "本益比 / 淨值比 / 殖利率資料不足。";
  if (fund.pe != null && fund.pb != null) {
    if (fund.pe <= 20 && fund.pb <= 1.5) s += "整體估值偏低、屬相對便宜位置，但仍需搭配股價位置與籌碼變化判斷。";
    else if (fund.pe > 30 || fund.pb > 3) s += "整體估值偏高，需留意回檔風險。";
    else s += "代表目前不是明顯低估位置，須搭配股價位置與籌碼變化判斷進場時機。";
  }
  return s;
}
function technicalExplain(ind) {
  const { close, ma5, ma10, ma20, rsi: r, support: sup, resistance: res } = ind;
  const p = [];
  if (ma20 && close > ma20) p.push("目前股價站上 MA20、趨勢偏多"); else if (ma20) p.push("目前股價跌破 MA20、趨勢偏空");
  if (ma5 && ma10 && ma20) { if (ma5 > ma10 && ma10 > ma20) p.push("且 MA5 > MA10 > MA20，短線維持多頭排列"); else if (ma5 < ma10 && ma10 < ma20) p.push("且均線呈空頭排列"); }
  let s = p.join("，") + "；";
  if (r != null) { if (r >= 75) s += `RSI 已達 ${fmt(r, 0)}，短線過熱、不適合直接追高，較適合等待拉回`; else if (r <= 30) s += `RSI ${fmt(r, 0)} 偏低、短線超賣，可留意反彈`; else s += `RSI ${fmt(r, 0)} 位於健康區間`; }
  if (sup && close <= sup * 1.05) s += "；目前接近支撐區，下檔風險相對有限"; else if (res && close >= res * 0.97) s += "；目前接近壓力區，上檔空間有限、不宜追價";
  return s + "。";
}
function buildChip(inst, margin, market) {
  if (market !== "TW" || (!inst && !margin)) {
    return { ok: false, note: market === "TW" ? "籌碼面資料不足，純前端版本目前無法完整取得三大法人與融資融券資料。" : "籌碼面：資料源限制 — 美股無台股式三大法人 / 融資融券制度，純前端版尚未接入機構持股 / Short Interest / 分析師評等資料（非公司劣勢）。",
      explain: "籌碼面主要用來觀察主力資金流向，若法人持續買超且融資未過熱，通常代表籌碼較健康；若股價上漲但融資大增，則需留意散戶追高風險。" };
  }
  const o = { ok: true };
  if (inst) { o.foreign = inst.foreign; o.trust = inst.trust; o.dealer = inst.dealer; }
  if (margin) { o.marginBal = margin.marginBal; o.marginChg = margin.marginChg; o.shortBal = margin.shortBal; o.shortChg = margin.shortChg; }
  const buys = inst && (inst.foreign > 0 || inst.trust > 0);
  const marginUp = margin && margin.marginChg > Math.abs(margin.marginBal) * 0.03;
  let read = "籌碼面主要用來觀察主力資金流向：";
  if (buys && !marginUp) read += "法人偏買超、融資未明顯增加，籌碼相對健康；"; else if (marginUp) read += "融資明顯增加，需留意散戶追高風險；"; else read += "法人買賣超與融資變化平淡；";
  read += "若法人持續買超且融資未過熱通常較健康，若股價上漲但融資大增則需留意追高風險。";
  o.explain = read; return o;
}
function buyReasons(ind, fund, d, market, chip) {
  const r = [];
  if (ind.ma20 && ind.close > ind.ma20) r.push("股價站上 MA20，月線趨勢偏多");
  if (d.trendUp) r.push("MA5 / MA10 / MA20 呈多頭排列");
  if (d.nearSupport) r.push("現價接近支撐區，下檔風險相對有限");
  if (market === "TW" && fund.pe != null && fund.pe <= 18) r.push(`本益比 ${fmt(fund.pe, 1)} 相對合理`);
  if (market === "TW" && fund.dy != null && fund.dy >= 4) r.push(`殖利率 ${fmt(fund.dy, 2)}% 具吸引力`);
  if (ind.rsi != null && ind.rsi <= 35) r.push(`RSI ${fmt(ind.rsi, 0)} 偏低、短線超賣，具反彈機會`);
  if (chip && chip.ok && (chip.foreign > 0 || chip.trust > 0)) r.push("法人偏買超，籌碼面偏正向");
  if (ind.volRatio != null && ind.volRatio >= 1.2 && ind.change_pct > 0) r.push("成交量放大配合上漲");
  if (!d.belowMa20 && !d.overheated) r.push("技術趨勢尚未轉弱，結構仍偏多");
  const fill = ["可分批降低平均成本、避免一次重壓", "屬可長期追蹤標的", "若回測支撐不破，續抱條件仍在"];
  for (const f of fill) { if (r.length >= 3) break; if (!r.includes(f)) r.push(f); }
  return r.slice(0, 6);
}
function avoidReasons(ind, fund, d, market, chip) {
  const r = [];
  if (ind.rsi != null && ind.rsi >= 70) r.push(`RSI ${fmt(ind.rsi, 0)} 過熱，短線追價風險高`);
  if (d.farFromMa20) r.push(`股價偏離 MA20 約 ${fmt(ind.distMa20, 0)}%，距離支撐過遠`);
  if (d.nearResistance) r.push("股價接近壓力區，上檔空間有限");
  if (market === "TW" && fund.pe != null && fund.pe >= 30) r.push(`本益比 ${fmt(fund.pe, 1)} 偏高，估值不便宜`);
  if (ind.ma5 && ind.ma20 && (ind.ma5 - ind.ma20) / ind.ma20 * 100 > 8) r.push("MA5 過度偏離 MA20，短線乖離過大");
  if (d.belowMa20) r.push("股價跌破月線，趨勢轉弱");
  if (d.overheated) r.push("價格位於短線高檔，新進場套牢風險升高");
  if (chip && chip.ok && chip.marginChg != null && chip.marginChg > Math.abs(chip.marginBal) * 0.03) r.push("融資增加過快，需留意散戶追高");
  if (chip && !chip.ok) r.push("籌碼面資料不足，無法確認主力動向");
  const fill = ["大盤系統性風險仍在，不宜單筆重壓", "突發消息 / 財報 / 政策變化無法預測", "若跌破支撐應嚴守停損"];
  for (const f of fill) { if (r.length >= 3) break; if (!r.includes(f)) r.push(f); }
  return r.slice(0, 6);
}
function priceZones(ind) {
  const { close, support: sup, resistance: res } = ind;
  if (!sup || !res) return null;
  let posNote;
  if (close <= sup * 1.03) posNote = "接近支撐，相對安全，可分批布局";
  else if (close >= res * 0.97) posNote = "接近短線高檔，等待回落較安全"; else posNote = "位於合理觀察區間，建議分批、勿追高";
  return `支撐區：${fmt(sup)} 附近\n合理觀察區：${fmt(sup)} ~ ${fmt(res)}\n壓力區：${fmt(res)} 附近\n不建議追高區：高於 ${fmt(res)}\n目前位置：${posNote}。`;
}
function conclusion(ind, d) {
  let state;
  if (d.overheated && (d.trendUp || (ind.ma20 && ind.close > ind.ma20))) state = "趨勢偏多但短線過熱";
  else if (d.belowMa20) state = "趨勢轉弱、方向未明"; else if (d.trendUp) state = "趨勢偏多、結構健康"; else state = "趨勢中性、區間整理";
  if (d.overheated) return `目前屬於「${state}」。雖然股價仍在均線上方，但 RSI 已達過熱區，短線追價風險偏高。若已持有可續抱觀察；若尚未進場，不建議直接追高，較適合等待回落接近支撐區再分批，新進場需保守。`;
  if (d.belowMa20) return `目前屬於「${state}」。建議觀望、待股價站回均線並確認支撐後再評估，不宜貿然進場。`;
  if (d.nearSupport) return `目前屬於「${state}」。現價接近支撐，可分批布局並嚴設停損；若跌破支撐則先離場觀望。`;
  return `目前屬於「${state}」。可分批觀察、避免追高，並留意均線與量能變化；接近支撐再加碼較穩健。`;
}

/* ---------- K 線（Canvas，桌機滾輪/拖曳、手機單指平移/雙指縮放） ---------- */
function drawKline(canvas, bars, view, support, resistance) {
  if (!canvas || !bars || bars.length < 2) return;
  const end = Math.min(bars.length, Math.max(view.count, view.end)), start = Math.max(0, end - view.count);
  const data = bars.slice(start, end);
  if (data.length < 1) return;
  const closes = bars.map((b) => b.c);
  const ma5 = smaSeries(closes, 5).slice(start, end), ma20 = smaSeries(closes, 20).slice(start, end);
  const lows = data.map((b) => b.l), highs = data.map((b) => b.h), vols = data.map((b) => b.v);
  const dpr = window.devicePixelRatio || 1, cssW = canvas.clientWidth || 600, cssH = 340;
  canvas.width = cssW * dpr; canvas.height = cssH * dpr;
  const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cssW, cssH);
  const padL = 8, padT = 8, priceH = cssH * 0.72, volTop = priceH + 14, volH = cssH - volTop - 16;
  const W = cssW - padL - 54, n = data.length, slot = W / n, bw = Math.max(1.5, slot * 0.62);
  const inclS = support != null, inclR = resistance != null;
  let pMin = Math.min(...lows, inclS ? support : Infinity, inclR ? resistance : Infinity);
  let pMax = Math.max(...highs, inclS ? support : -Infinity, inclR ? resistance : -Infinity);
  const padP = (pMax - pMin) * 0.06 || 1; pMin -= padP; pMax += padP;
  const yP = (v) => padT + (pMax - v) / (pMax - pMin) * (priceH - padT);
  const vMax = Math.max(...vols) || 1, yV = (v) => volTop + (1 - v / vMax) * volH;
  ctx.strokeStyle = "#1f2632"; ctx.fillStyle = "#8a93a6"; ctx.font = "10px system-ui"; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { const v = pMax - (pMax - pMin) * i / 4, y = yP(v); ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + W, y); ctx.stroke(); ctx.fillText(v.toFixed(1), padL + W + 4, y + 3); }
  ctx.setLineDash([4, 3]);
  if (inclS) { ctx.strokeStyle = "#2ebd6b"; ctx.beginPath(); ctx.moveTo(padL, yP(support)); ctx.lineTo(padL + W, yP(support)); ctx.stroke(); ctx.fillStyle = "#2ebd6b"; ctx.fillText("支撐 " + support.toFixed(1), padL + 2, yP(support) - 3); }
  if (inclR) { ctx.strokeStyle = "#ff7a45"; ctx.beginPath(); ctx.moveTo(padL, yP(resistance)); ctx.lineTo(padL + W, yP(resistance)); ctx.stroke(); ctx.fillStyle = "#ff7a45"; ctx.fillText("壓力 " + resistance.toFixed(1), padL + 2, yP(resistance) + 10); }
  ctx.setLineDash([]);
  data.forEach((b, i) => {
    const x = padL + slot * i + slot / 2, up = b.c >= b.o, col = up ? "#2ee6a6" : "#ff4d62";
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, yP(b.h)); ctx.lineTo(x, yP(b.l)); ctx.stroke();
    const yo = yP(b.o), yc = yP(b.c); ctx.fillRect(x - bw / 2, Math.min(yo, yc), bw, Math.max(1, Math.abs(yc - yo)));
    ctx.fillRect(x - bw / 2, yV(b.v), bw, volTop + volH - yV(b.v));
  });
  const line = (arr, color) => { ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.beginPath(); let st = false; arr.forEach((v, i) => { if (v == null) return; const x = padL + slot * i + slot / 2, y = yP(v); if (!st) { ctx.moveTo(x, y); st = true; } else ctx.lineTo(x, y); }); ctx.stroke(); };
  line(ma5, "#4da3ff"); line(ma20, "#ffcf4d");
  let hi = 0, lo = 0;
  for (let i = 1; i < data.length; i++) { if (data[i].h > data[hi].h) hi = i; if (data[i].l < data[lo].l) lo = i; }
  const mark = (idx, val, up) => { const x = padL + slot * idx + slot / 2, y = yP(val); ctx.fillStyle = up ? "#ef8a4d" : "#4dd0a0"; ctx.beginPath(); ctx.arc(x, y, 2.6, 0, 6.3); ctx.fill(); ctx.font = "10px system-ui"; ctx.textAlign = idx > data.length / 2 ? "right" : "left"; ctx.fillText((up ? "高 " : "低 ") + val.toFixed(1), idx > data.length / 2 ? x - 5 : x + 5, up ? y - 5 : y + 11); ctx.textAlign = "left"; };
  if (data.length > 2) { mark(hi, data[hi].h, true); mark(lo, data[lo].l, false); }
}
function drawGoldLine(canvas, bars, view, support, resistance) {
  if (!canvas || !bars || bars.length < 2) return;
  canvas._bars = bars;
  const end = Math.min(bars.length, Math.max(view.count, view.end)), start = Math.max(0, end - view.count);
  const data = bars.slice(start, end); if (data.length < 2) return;
  const closes = bars.map((b) => b.c);
  const ma20 = smaSeries(closes, 20).slice(start, end), ma60 = smaSeries(closes, 60).slice(start, end), ma200 = smaSeries(closes, 200).slice(start, end);
  const cl = data.map((b) => b.c);
  const dpr = window.devicePixelRatio || 1, cssW = canvas.clientWidth || 600, cssH = 340;
  canvas.width = cssW * dpr; canvas.height = cssH * dpr;
  const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cssW, cssH);
  const padL = 8, padT = 12, padB = 22, padR = 60, H = cssH - padT - padB, W = cssW - padL - padR, n = data.length, slot = W / (n - 1);
  const inclS = support != null, inclR = resistance != null;
  let pMin = Math.min(...cl, inclS ? support : Infinity, inclR ? resistance : Infinity), pMax = Math.max(...cl, inclS ? support : -Infinity, inclR ? resistance : -Infinity);
  const pad = (pMax - pMin) * 0.08 || 1; pMin -= pad; pMax += pad;
  const yP = (v) => padT + (pMax - v) / (pMax - pMin) * H, xAt = (i) => padL + slot * i;
  ctx.strokeStyle = "#1f2632"; ctx.fillStyle = "#8a93a6"; ctx.font = "10px system-ui"; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { const v = pMax - (pMax - pMin) * i / 4, y = yP(v); ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + W, y); ctx.stroke(); ctx.fillText(v.toFixed(0), padL + W + 4, y + 3); }
  ctx.fillText("USD/oz", padL + W + 4, padT - 2);
  const ticks = Math.min(5, n - 1);
  for (let t = 0; t <= ticks; t++) { const i = Math.round(t / ticks * (n - 1)), lbl = data[i].date.slice(2).replace(/-/g, "/"); ctx.textAlign = t === 0 ? "left" : (t === ticks ? "right" : "center"); ctx.fillText(lbl, xAt(i), cssH - 7); }
  ctx.textAlign = "left";
  ctx.setLineDash([4, 3]);
  if (inclS) { ctx.strokeStyle = "#2ebd6b"; ctx.beginPath(); ctx.moveTo(padL, yP(support)); ctx.lineTo(padL + W, yP(support)); ctx.stroke(); ctx.fillStyle = "#2ebd6b"; ctx.fillText("Support " + support.toFixed(0), padL + 2, yP(support) - 3); }
  if (inclR) { ctx.strokeStyle = "#ff7a45"; ctx.beginPath(); ctx.moveTo(padL, yP(resistance)); ctx.lineTo(padL + W, yP(resistance)); ctx.stroke(); ctx.fillStyle = "#ff7a45"; ctx.fillText("Resistance " + resistance.toFixed(0), padL + 2, yP(resistance) + 11); }
  ctx.setLineDash([]);
  const line = (arr, color, w) => { ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath(); let st = false; arr.forEach((v, i) => { if (v == null) return; const x = xAt(i), y = yP(v); if (!st) { ctx.moveTo(x, y); st = true; } else ctx.lineTo(x, y); }); ctx.stroke(); };
  line(ma200, "#7a8aa0", 1.1); line(ma60, "#b388ff", 1.3); line(ma20, "#4da3ff", 1.3); line(cl, "#ffd24d", 2.2);
  let hi = 0, lo = 0; for (let i = 1; i < cl.length; i++) { if (cl[i] > cl[hi]) hi = i; if (cl[i] < cl[lo]) lo = i; }
  const mark = (i, up) => { const x = xAt(i), y = yP(cl[i]); ctx.fillStyle = up ? "#ef8a4d" : "#4dd0a0"; ctx.beginPath(); ctx.arc(x, y, 3, 0, 6.3); ctx.fill(); ctx.textAlign = i > n / 2 ? "right" : "left"; ctx.fillText((up ? "高 " : "低 ") + cl[i].toFixed(0), i > n / 2 ? x - 5 : x + 5, up ? y - 6 : y + 12); ctx.textAlign = "left"; };
  mark(hi, true); mark(lo, false);
}
function setupKline(wrap, bars, support, resistance, initial, defaultCount, lineMode) {
  const canvas = wrap.querySelector("canvas");
  const view = { count: Math.min(defaultCount || 60, bars.length), end: bars.length };
  if (initial) { view.count = Math.min(bars.length, Math.max(10, initial.count || 60)); view.end = Math.max(view.count, Math.min(bars.length, bars.length - (initial.endOffset || 0))); }
  canvas._view = view; canvas._barsLen = bars.length;
  const clamp = () => { view.count = Math.max(10, Math.min(bars.length, Math.round(view.count))); view.end = Math.max(view.count, Math.min(bars.length, Math.round(view.end))); };
  const redraw = () => { clamp(); (lineMode ? drawGoldLine : drawKline)(canvas, bars, view, support, resistance); const l = wrap.querySelector(".kl-range"); if (l) l.textContent = view.count + " 根"; };
  canvas._redraw = redraw;
  const slot = () => (canvas.clientWidth - 62) / view.count;
  const center = () => { const r = canvas.getBoundingClientRect(); return r.left + r.width / 2; };
  const zoomAt = (clientX, factor) => { const rect = canvas.getBoundingClientRect(), W = canvas.clientWidth - 62; const frac = Math.max(0, Math.min(1, (clientX - rect.left - 8) / W)); const gb = (view.end - view.count) + frac * view.count; view.count *= factor; clamp(); view.end = Math.round(gb + (1 - frac) * view.count); redraw(); };
  wrap.querySelectorAll("[data-kl]").forEach((btn) => btn.addEventListener("click", () => { const a = btn.getAttribute("data-kl"); if (a === "in") zoomAt(center(), 0.7); else if (a === "out") zoomAt(center(), 1.4); else if (a === "reset") { view.count = Math.min(defaultCount || 60, bars.length); view.end = bars.length; redraw(); } else if (a === "max") { view.count = bars.length; view.end = bars.length; redraw(); } else { view.count = +a; view.end = bars.length; redraw(); } }));
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(e.clientX, e.deltaY > 0 ? 1.15 : 0.87); }, { passive: false });
  const pts = new Map();
  canvas.addEventListener("pointerdown", (e) => { try { canvas.setPointerCapture(e.pointerId); } catch {} pts.set(e.pointerId, e.clientX); canvas.style.cursor = "grabbing"; });
  canvas.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    if (pts.size === 1) { const prev = pts.get(e.pointerId), db = Math.round((e.clientX - prev) / slot()); if (db !== 0) { view.end -= db; pts.set(e.pointerId, e.clientX); redraw(); } }
    else if (pts.size === 2) { const xs = [...pts.values()], prevSp = Math.abs(xs[0] - xs[1]), mid = (xs[0] + xs[1]) / 2; pts.set(e.pointerId, e.clientX); const ys = [...pts.values()], sp = Math.abs(ys[0] - ys[1]); if (prevSp > 4 && sp > 4) zoomAt(mid, prevSp / sp); }
  });
  const rel = (e) => { pts.delete(e.pointerId); if (!pts.size) canvas.style.cursor = "grab"; };
  canvas.addEventListener("pointerup", rel); canvas.addEventListener("pointercancel", rel);
  canvas.style.cursor = "grab"; redraw();
}

/* ---------- 取數 ---------- */
async function analyzeTW(code) {
  const [price, per, info, instRaw, marginRaw, revRaw, finRaw] = await Promise.all([
    fm("TaiwanStockPrice", code, ago(400)), fmSafe("TaiwanStockPER", code, ago(30)), fmSafe("TaiwanStockInfo", code),
    fmSafe("TaiwanStockInstitutionalInvestorsBuySell", code, ago(12)), fmSafe("TaiwanStockMarginPurchaseShortSale", code, ago(15)),
    fmSafe("TaiwanStockMonthRevenue", code, ago(430)), fmSafe("TaiwanStockFinancialStatements", code, ago(500)),
  ]);
  if (!price.length) throw new Error("EMPTY");
  const bars = price.map((d) => ({ date: d.date, o: d.open, h: d.max, l: d.min, c: d.close, v: d.Trading_Volume }));
  const ind = buildIndicators(bars);
  const fund = { pe: null, pb: null, dy: null, eps: null, revYoy: null };
  if (per && per.length) { const p = per[per.length - 1]; fund.pe = num(p.PER); fund.pb = num(p.PBR); fund.dy = num(p.dividend_yield); }
  if (finRaw && finRaw.length) { const eps = finRaw.filter((r) => r.type === "EPS").sort((a, b) => a.date < b.date ? -1 : 1); if (eps.length) { const l4 = eps.slice(-4).map((r) => num(r.value)).filter((x) => x != null); if (l4.length) fund.eps = l4.reduce((a, b) => a + b, 0); } }
  if (revRaw && revRaw.length >= 13) { const s = revRaw.slice().sort((a, b) => a.date < b.date ? -1 : 1), last = s[s.length - 1], y = s.find((r) => r.revenue_month === last.revenue_month && r.revenue_year === last.revenue_year - 1); if (y && y.revenue) fund.revYoy = (last.revenue - y.revenue) / y.revenue * 100; }
  let inst = null;
  if (instRaw && instRaw.length) { const ld = instRaw.reduce((m, r) => r.date > m ? r.date : m, ""), day = instRaw.filter((r) => r.date === ld), net = (ns) => day.filter((r) => ns.includes(r.name)).reduce((a, r) => a + (r.buy - r.sell), 0) / 1000; inst = { foreign: net(["Foreign_Investor", "Foreign_Dealer_Self"]), trust: net(["Investment_Trust"]), dealer: net(["Dealer_self", "Dealer_Hedging"]) }; }
  let margin = null;
  if (marginRaw && marginRaw.length) { const m = marginRaw[marginRaw.length - 1]; margin = { marginBal: num(m.MarginPurchaseTodayBalance), marginChg: num(m.MarginPurchaseTodayBalance) - num(m.MarginPurchaseYesterdayBalance), shortBal: num(m.ShortSaleTodayBalance), shortChg: num(m.ShortSaleTodayBalance) - num(m.ShortSaleYesterdayBalance) }; }
  return { market: "TW", symbol: code, name: info && info.length ? info[0].stock_name : code, industry: info && info.length ? info[0].industry_category : null, bars, ind, fund, chip: buildChip(inst, margin, "TW"), lastDate: bars[bars.length - 1].date, rows: bars.length, source: "FinMind 股價資料（TaiwanStockPrice，日線）" };
}
async function analyzeUS(sym) {
  const price = await fm("USStockPrice", sym, ago(400));
  if (!price.length) throw new Error("EMPTY");
  const bars = price.map((d) => ({ date: d.date, o: d.Open, h: d.High, l: d.Low, c: d.Close, v: d.Volume }));
  return { market: "US", symbol: sym.toUpperCase(), name: sym.toUpperCase(), industry: null, bars, ind: buildIndicators(bars), fund: { pe: null, pb: null, dy: null, eps: null, revYoy: null }, chip: buildChip(null, null, "US"), lastDate: bars[bars.length - 1].date, rows: bars.length, source: "FinMind 股價資料（USStockPrice，日線）" };
}
function holdingPnl(price, cost, qty) {
  if (!cost || !qty || !price) return null;
  const ret = (price - cost) / cost * 100, pnl = (price - cost) * qty;
  let suggestion = "續抱觀察"; const notes = [];
  if (ret <= -15) { suggestion = "注意停損"; notes.push(`目前虧損 ${fmt(ret, 1)}%，檢視基本面是否轉壞並嚴設停損`); }
  else if (ret >= 30) { suggestion = "可考慮部分停利"; notes.push(`目前獲利 ${fmt(ret, 1)}%，可部分停利、續抱核心`); }
  else notes.push("報酬在合理區間，續抱觀察");
  return { cost, qty, marketValue: price * qty, ret, pnl, suggestion, notes };
}

/* ---------- 浮動股價：自動更新（全域單一 timer，單一結果模型） ---------- */
let GTIMER = null, CUR = null, SEQ = 0;
function stopAuto() { if (GTIMER) { clearInterval(GTIMER); GTIMER = null; } }
function setGlobalAuto(ms) { stopAuto(); if (ms > 0) GTIMER = setInterval(() => { if (!CUR || !$("centerResult").querySelector(".result")) { stopAuto(); return; } refreshCurrent(SEQ, false); }, ms); }
window.addEventListener("beforeunload", stopAuto);

/* ---------- 主流程：單一最新結果，分流到 中央 / 右側 / 底部 三欄 ---------- */
function clearResult(loadingMsg) {
  stopAuto();
  $("centerResult").innerHTML = loadingMsg ? `<div class="result"><div class="muted">${esc(loadingMsg)}</div></div>` : "";
  $("rightResult").innerHTML = ""; $("bottomResult").innerHTML = "";
}
// 手機版（≤720px）預設收合基本面 / 技術面 / 籌碼面 / 資料來源；桌機展開
function syncAccordion() {
  const mob = window.matchMedia("(max-width: 980px)").matches;
  document.querySelectorAll("#rightResult .info-section").forEach((d) => {
    if (mob) d.removeAttribute("open"); else d.setAttribute("open", "");
  });
}
// HUD 狀態機：ready（查詢前）/ loading（查詢中）/ done（完成）/ error（失敗）/ hide（隱藏）
let HUD_T0 = 0;
function symDisplay(market, symbol) { return `${market === "US" ? "美股" : "台股"} ${symbol}`; }
function setHudState(state, sym) {
  const h = $("hud"); if (!h) return;
  if (state === "hide") { h.classList.add("is-hidden"); return; }
  h.classList.remove("is-hidden", "is-loading", "is-done", "is-error");
  if (state === "loading") h.classList.add("is-loading");
  else if (state === "done") h.classList.add("is-done");
  else if (state === "error") h.classList.add("is-error");
  // state "ready" → 不加 class
  if (sym != null) h.querySelectorAll(".hud-sym").forEach((s) => { s.textContent = sym; });
}
// 查詢完成：loading 至少停留 400ms → 顯示「分析完成」→ 600ms 後淡出，讓結果成為主畫面
function finishHud(symbol, market) {
  const wait = Math.max(0, 400 - (Date.now() - HUD_T0));
  setTimeout(() => {
    if (!CUR || CUR.symbol !== symbol) { setHudState("hide"); return; }   // 已被新查詢取代
    setHudState("done", symDisplay(market, symbol));
    setTimeout(() => { if (CUR && CUR.symbol === symbol) setHudState("hide"); }, 600);
  }, wait);
}
async function analyze(symbol, market, cost, qty) {
  symbol = String(symbol || "").trim().toUpperCase();
  const seq = ++SEQ; stopAuto();
  if (market === "TW" && !TW_RE.test(symbol)) { clearResult(); setHudState("hide"); $("centerResult").innerHTML = `<div class="result"><div class="err">⚠️ 台股代號格式不正確（例 2330）</div></div>`; return; }
  if (market === "US" && !US_RE.test(symbol)) { clearResult(); setHudState("hide"); $("centerResult").innerHTML = `<div class="result"><div class="err">⚠️ 美股代號格式不正確（例 AAPL）</div></div>`; return; }
  CUR = { symbol, market, cost: parseFloat(cost) || null, qty: parseFloat(qty) || null, autoVal: "off", lastClose: null };
  HUD_T0 = Date.now();
  setHudState("loading", symDisplay(market, symbol));                         // 查詢中狀態（不直接消失）
  clearResult();                                                              // 載入提示改由 HUD 顯示
  await refreshCurrent(seq, true);
}
async function refreshCurrent(seq, isFirst) {
  if (seq == null) seq = SEQ;
  const p = CUR; if (!p) return;
  const st = $("centerResult").querySelector(".upd-status"); if (st) st.textContent = "更新中…";
  try {
    const a = p.market === "TW" ? await analyzeTW(p.symbol) : await analyzeUS(p.symbol);
    if (seq !== SEQ) return;                       // 已被新查詢取代 → 丟棄（避免持股診斷競態）
    a.decision = decide(a.ind, a.fund, a.market);
    a.holding = holdingPnl(a.ind.close, p.cost, p.qty);
    let initView = null;
    const oldCv = $("centerResult").querySelector("canvas.kline");
    if (oldCv && oldCv._view) initView = { count: oldCv._view.count, endOffset: oldCv._barsLen - oldCv._view.end };
    const prevClose = p.lastClose;
    const R = renderResult(a, { updatedAt: nowStamp(), autoVal: p.autoVal });
    $("centerResult").innerHTML = R.center; $("rightResult").innerHTML = R.right; $("bottomResult").innerHTML = R.bottom;
    p.lastClose = a.ind.close;
    const wrap = $("centerResult").querySelector(".kline-wrap");
    if (wrap) setupKline(wrap, a.bars, a.ind.support, a.ind.resistance, initView);
    setupCurControls();
    syncAccordion();
    if (isFirst) finishHud(p.symbol, p.market); else setHudState("hide");   // 完成：done→淡出；自動更新不再顯示 HUD
    if (!isFirst && prevClose != null && a.ind.close != null && a.ind.close !== prevClose) flashCur(a.ind.close > prevClose);
  } catch (e) {
    if (seq !== SEQ) return;
    const msg = e.message === "EMPTY" ? "查無最新股價資料，請確認股票代號或稍後再試。" : "查詢失敗，請確認代號或稍後再試。";
    if (isFirst) { setHudState("error", symDisplay(p.market, p.symbol)); $("centerResult").innerHTML = `<div class="result"><div class="err">⚠️ ${esc(msg)}</div></div>`; setTimeout(() => { if (CUR && CUR.symbol === p.symbol) setHudState("hide"); }, 1600); }
    else { const st2 = $("centerResult").querySelector(".upd-status"); if (st2) { st2.textContent = msg; st2.classList.add("upd-err"); } }
  }
}
function flashCur(up) { const px = $("centerResult").querySelector(".px"); if (!px) return; px.classList.remove("flash-up", "flash-down"); void px.offsetWidth; px.classList.add(up ? "flash-up" : "flash-down"); setTimeout(() => px.classList.remove("flash-up", "flash-down"), 800); }
function setupCurControls() {
  const btn = $("centerResult").querySelector(".upd-btn"); if (btn) btn.addEventListener("click", () => refreshCurrent(SEQ, false));
  const sel = $("centerResult").querySelector(".upd-auto");
  if (sel && CUR) { sel.value = CUR.autoVal; sel.addEventListener("change", () => { CUR.autoVal = sel.value; setGlobalAuto({ off: 0, "30": 30000, "60": 60000, "300": 300000 }[sel.value] || 0); }); }
}

// 對建議影響：依各面向得分比例給出正面 / 中性 / 中性偏空 / 負面
function impactFromRatio(r) {
  if (r == null) return { t: "資料受限", c: "imp-neu" };
  if (r >= 0.7) return { t: "正面", c: "imp-pos" };
  if (r >= 0.5) return { t: "中性", c: "imp-neu" };
  if (r >= 0.3) return { t: "中性偏空", c: "imp-soft" };
  return { t: "負面", c: "imp-neg" };
}
// 評分拆解：把每個面向的「分數 + 加分原因 + 扣分 / 保留原因 + 對建議影響」結構化（選股邏輯・綜合分析用）
function scoreBreakdown(a, L) {
  const i = a.ind || {}, f = a.fund || {}, chip = a.chip || {}, s = L.sub;
  const rsi = i.rsi, close = i.close, ma20 = i.ma20, ma5 = i.ma5, ma10 = i.ma10, sup = i.support, res = i.resistance;
  const aboveMa20 = ma20 != null && close != null && close >= ma20, belowMa20 = ma20 != null && close != null && close < ma20;
  const bullStack = ma5 && ma10 && ma20 && ma5 > ma10 && ma10 > ma20, weakStack = ma5 && ma10 && ma20 && (ma5 < ma10 || ma10 < ma20);
  const distSup = (sup && close) ? (close - sup) / sup * 100 : null, distRes = (res && close) ? (res - close) / res * 100 : null;
  const nearSup = distSup != null && distSup >= 0 && distSup < 6, farSup = distSup != null && distSup > 10, nearRes = distRes != null && distRes >= 0 && distRes < 5;
  const instNet = (chip.ok && chip.foreign != null) ? chip.foreign + (chip.trust || 0) + (chip.dealer || 0) : null;
  const marginUp = chip.ok && chip.marginChg != null && chip.marginBal != null && chip.marginChg > Math.abs(chip.marginBal) * 0.03;
  const overheated = rsi != null && rsi >= 70;
  const ratio = (v, max) => (v == null || !max) ? null : v / max;
  const rows = [];

  // 技術面（所有類別都有）
  { const plus = [], minus = [];
    if (aboveMa20) plus.push("股價站上 MA20，短線趨勢未轉弱");
    if (bullStack) plus.push("MA5 > MA10 > MA20 多頭排列");
    if (rsi != null && rsi >= 40 && rsi <= 65) plus.push(`RSI ${fmt(rsi, 0)} 位於健康區間`);
    if (nearSup) plus.push(`接近支撐 ${fmt(sup)}，下檔有觀察區`);
    if (belowMa20) minus.push("股價跌破 MA20，短線結構轉弱");
    if (weakStack && !belowMa20) minus.push("短均線排列轉弱（MA5<MA10 或 MA10<MA20）");
    if (rsi != null && rsi >= 75) minus.push(`RSI ${fmt(rsi, 0)} 偏高、短線過熱`);
    if (farSup) minus.push(`距支撐約 ${fmt(distSup, 0)}%，追高停損空間大`);
    if (nearRes) minus.push("接近壓力區，易遇解套賣壓");
    if (!plus.length) plus.push("技術面無明顯加分項");
    if (!minus.length) minus.push("技術面無明顯破壞訊號");
    rows.push({ label: "技術面評分", score: s.tech, max: s.techMax, plus, minus, minusLabel: "扣分原因", impact: impactFromRatio(ratio(s.tech, s.techMax)) });
  }

  if (L.isETF) {
    const plus = [], minus = [];
    if (nearSup) plus.push("價格接近支撐，分批風險較低");
    if (aboveMa20) plus.push("價格位於 MA20 上方");
    if (nearRes) minus.push("接近壓力區，不宜一次追高");
    if (farSup) minus.push("距支撐較遠，宜分批 / 定期定額");
    if (!plus.length) plus.push("價格位置中性");
    if (!minus.length) minus.push("無明顯追高風險");
    rows.push({ label: "價格位置評分", score: s.pos, max: s.posMax, plus, minus, minusLabel: "保留原因", impact: impactFromRatio(ratio(s.pos, s.posMax)) });
  } else {
    // 基本面
    const plus = [], minus = [];
    if (L.isUS) { minus.push("美股基本面為資料源限制（非公司不佳），暫不納入完整評分"); plus.push("以價格 / 均線 / RSI 為主要判斷依據"); }
    else {
      if (f.pe != null && f.pe > 0 && f.pe <= 25) plus.push(`本益比 ${fmt(f.pe, 1)} 屬合理`);
      if (f.pb != null && f.pb <= 2) plus.push(`P/B ${fmt(f.pb, 2)} 不算偏高`);
      if (f.dy != null && f.dy >= 3) plus.push(`殖利率 ${fmt(f.dy, 2)}% 具收益性`);
      if (f.revYoy != null && f.revYoy > 0) plus.push(`營收 YoY +${fmt(f.revYoy, 1)}% 成長`);
      if (f.pe != null && f.pe > 30) minus.push(`本益比 ${fmt(f.pe, 1)} 偏高、估值不便宜`);
      if (f.eps == null && f.pe == null) minus.push("基本面資料不足，無法確認獲利與估值");
      if (!plus.length) plus.push("基本面無明顯加分項");
      if (!minus.length) minus.push("估值中性，留意產業景氣循環");
    }
    rows.push({ label: "基本面評分", score: s.fund, max: s.fundMax, plus, minus, minusLabel: "保留原因", impact: impactFromRatio(ratio(s.fund, s.fundMax)) });

    // 籌碼面
    const cplus = [], cminus = [];
    if (L.isUS) { cminus.push("美股無台股式三大法人 / 融資券，籌碼面為資料源限制"); cplus.push("以價格與量能變化間接觀察資金動向"); }
    else if (!chip.ok) { cminus.push("三大法人 / 融資融券資料不足"); cplus.push("暫無法確認主力動向，保守處理"); }
    else {
      if (instNet != null && instNet > 0) cplus.push("法人偏買超，資金面支撐股價");
      if (chip.foreign != null && chip.foreign > 0) cplus.push("外資買超");
      if (!marginUp) cplus.push("融資未過熱，籌碼相對健康");
      if (instNet != null && instNet < 0) cminus.push("法人偏賣超，籌碼尚未轉強");
      if (marginUp) cminus.push("融資增加較快，留意散戶追高");
      if (!cplus.length) cplus.push("籌碼面無明顯加分項");
      if (!cminus.length) cminus.push("籌碼面無明顯警訊");
    }
    rows.push({ label: "籌碼面評分", score: s.chip, max: s.chipMax, plus: cplus, minus: cminus, minusLabel: "保留原因", impact: impactFromRatio(ratio(s.chip, s.chipMax)) });
  }

  // 風險控制（含「是否過熱 / 是否適合追高」）
  { const plus = [], minus = [];
    if (overheated) minus.push(`RSI ${fmt(rsi, 0)} 過熱，不適合追高`);
    if (farSup) minus.push("距支撐較遠，停損空間大");
    if (nearRes) minus.push("接近壓力區，套牢風險升高");
    if (belowMa20) minus.push("跌破 MA20，趨勢轉弱");
    if (instNet != null && instNet < 0) minus.push("法人賣超，資金面偏弱");
    if (!minus.length) minus.push("目前無明顯追高風險");
    plus.push((!overheated && !farSup && !nearRes) ? "價格位置相對安全、無明顯過熱" : "建議分批進場、嚴設停損以控制風險");
    rows.push({ label: "風險控制評分", score: s.risk, max: s.riskMax, plus, minus, minusLabel: "扣分原因",
      overheated: overheated ? "是" : "否", chase: (overheated || farSup || belowMa20) ? "不建議追高" : "可分批",
      impact: impactFromRatio(ratio(s.risk, s.riskMax)) });
  }
  return rows;
}

function renderResult(a, meta) {
  const { ind: i, fund: f, decision: d, market: m } = a;
  const actCls = (d.action === "可分批觀察" || d.action === "可小量布局") ? "good" : (d.action === "不建議追高" || d.action === "風險偏高") ? "bad" : "neutral";
  const dir = i.change_pct == null ? "" : i.change_pct >= 0 ? "px-up" : "px-down";
  const lag = daysBetween(a.lastDate), recent = lag <= 4;
  const statusTxt = recent ? "正常" : "可能延遲";

  const chgAbs = (i.change != null) ? i.change : ((i.close != null && i.change_pct != null) ? i.close - i.close / (1 + i.change_pct / 100) : null);
  const arrow = i.change_pct == null ? "" : i.change_pct >= 0 ? "▲" : "▼";
  const mktTag = m === "TW" ? "台股" : "美股";
  // 股票報價主卡：橫向大卡，左=名稱/現價大字，右=更新狀態與控制
  const header = `<div class="quote-hero">
      <div class="qh-left">
        <div class="qh-name"><h3>${esc(a.name)} <span class="code">${esc(a.symbol)}</span></h3><span class="mkt-tag">${mktTag}</span>${a.industry ? `<span class="muted qh-ind">· ${esc(a.industry)}</span>` : ""}</div>
        <div class="qh-price"><span class="px ${dir}">${fmt(i.close)}</span><span class="chg ${dir}">${arrow} ${chgAbs != null ? fmt(Math.abs(chgAbs)) : ""} (${pct(i.change_pct)})</span></div>
      </div>
      <div class="qh-right">
        <div class="qh-meta"><div><span>更新時間</span><b class="upd-status">${esc(meta.updatedAt)}</b></div><div><span>資料日</span><b>${esc(a.lastDate)}</b></div><div><span>價格類型</span><b>${PRICE_TYPE}</b></div><div><span>狀態</span><b>${statusTxt}</b></div></div>
        <div class="updctrls"><button class="upd-btn"><span aria-hidden="true">↻</span> 更新價格</button><label class="autolbl">自動更新 <select class="upd-auto"><option value="off">關閉</option><option value="30">每 30 秒</option><option value="60">每 1 分</option><option value="300">每 5 分</option></select></label></div>
      </div>
    </div>
    <p class="px-note">目前價格以 FinMind 最新可取得資料為準，可能不是即時逐筆報價。</p>
    ${recent ? "" : `<p class="warn">⚠ 資料可能延遲，請以證交所、NASDAQ/NYSE 或券商報價為準。</p>`}`;

  let hold = "";
  if (a.holding) { const h = a.holding, cls = h.ret >= 0 ? "pnl-up" : "pnl-down"; hold = `<div class="holding"><b>💼 我的持股</b>　成本 ${fmt(h.cost)}　股數 ${fmt(h.qty, 0)}　市值 ${fmt(h.marketValue)}　<span class="${cls}">報酬 ${fmt(h.ret)}%／損益 ${fmt(h.pnl)}</span>　建議：<b>${esc(h.suggestion)}</b></div>`; }

  const L = evaluateStockLogic(a);
  // 投資決策摘要：橫向 badge 化 + 信心分數環
  const decision = `<div class="block decision decision-hero">
      <div class="dh-main"><h4>① 投資決策摘要</h4>
        <div class="dh-badges"><span class="badge ${actCls}">建議 ${esc(d.action)}</span><span class="dh-b">信心分數 <b>${d.score}/100</b></span><span class="dh-b">風險等級 <b>${esc(d.risk)}</b></span><span class="dh-b">目前位置 <b>${esc(d.position)}</b></span></div>
        <p class="op">${esc(d.operation)}</p><p class="sl-note">📌 ${esc(L.decNote)}</p></div>
      <div class="dh-ring" style="--p:${d.score == null ? 0 : d.score}"><div class="dh-ring-core"><b>${d.score == null ? "—" : d.score}</b><span>信心分數</span></div></div>
    </div>`;
  // 進場限制：只有真正觸發風控（RSI 過熱 / 內部 veto）時才顯示，用使用者語言、不顯示工程字眼
  let limitBlock = "";
  if (d.veto || d.overheated) {
    let reason = `RSI ${fmt(i.rsi, 0)} ${i.rsi >= 75 ? "已進入過熱區" : "偏高、接近過熱"}`;
    if (d.farFromMa20) reason += "，且價格已明顯偏離均線、距離支撐過遠";
    reason += "，若此時追價，回檔風險較高。";
    limitBlock = `<div class="block limit"><h4>⛔ 進場限制：不建議追高</h4><p>原因：${esc(reason)}</p></div>`;
  }
  const liArr = (arr) => arr.map((x) => `<li>${esc(x)}</li>`).join("");
  const subLabel = (v, max) => v != null ? `${v} / ${max}` : (L.isUS ? "資料源限制" : "資料不足");
  // 評分拆解（結構化）：每個面向的 分數 + 加分原因 + 扣分 / 保留原因 + 對建議影響
  const bd = scoreBreakdown(a, L);
  const bdHTML = bd.map((r) => `<div class="sl-brow">
        <div class="sl-bhead"><span class="sl-bname">${esc(r.label)}</span><b class="sl-bscore">${subLabel(r.score, r.max)}</b><span class="impact ${r.impact.c}">${esc(r.impact.t)}</span></div>
        <div class="sl-bcols"><div class="sl-bplus"><i>加分原因</i><ul>${liArr(r.plus)}</ul></div><div class="sl-bminus"><i>${esc(r.minusLabel)}</i><ul>${liArr(r.minus)}</ul></div></div>
        ${r.overheated != null ? `<div class="sl-brisk"><span>是否過熱：<b>${esc(r.overheated)}</b></span><span>是否適合追高：<b>${esc(r.chase)}</b></span></div>` : ""}
      </div>`).join("");
  const z = priceZones(i);
  const passCard = `<div class="block sl-pass"><h5>🟢 支持觀察理由</h5><ul>${liArr(L.pass)}</ul></div>`;
  const riskCard = `<div class="block sl-risk"><h5>🔴 扣分 / 風險理由</h5><p class="sl-risknote">${esc(L.riskNote)}</p><ul>${liArr(L.risks)}</ul></div>`;
  const zoneCard = `<div class="block sl-zone"><h5>📐 價格區間 / 進場參考</h5>${z ? `<pre class="zones">${esc(z)}</pre>` : "<p>資料不足</p>"}</div>`;
  // 選股邏輯・綜合分析（中央）：標的屬性 + 評分拆解 + 支持/扣分/價格 三卡（為什麼這樣評分、如何影響決策）
  const selSummary = `<div class="block selection sl-analysis">
      <h4>🧮 選股邏輯・綜合分析　<small>${esc(L.grade)}｜${esc(L.label)}</small></h4>
      <p class="sl-meta">標的分類：<span class="cat-badge ${L.cat === "資料不足" ? "cat-na" : ""}">${esc(L.cat)}</span>　｜選股分數：<b>${L.total} / 100</b>　｜初步篩選：<b>${esc(L.screen)}</b></p>
      <div class="sl-grid2"><div class="sl-attr"><h5>標的屬性</h5><p>${esc(L.attr)}</p></div><div class="sl-scores"><h5>評分拆解</h5>${bdHTML}</div></div>
      <div class="sl-cards3">${passCard}${riskCard}${zoneCard}</div>
    </div>`;

  let fundamental;
  if (L.cat === "ETF") {
    fundamental = `<details class="block info-section" open><summary>④ 標的屬性　<small>ETF</small></summary>` + ul([
      "類型：ETF（一籃子成分股，非單一公司）",
      "評估方式：以追蹤標的走勢、價格位置與風險控制為主",
      "適合策略：分批、定期定額、長期配置",
      "注意事項：短線仍需避開過熱與距離支撐過遠的位置",
    ]) + `</details>`;
  } else if (m !== "TW") {
    fundamental = `<details class="block info-section" open><summary>④ 基本面　<small>資料源限制</small></summary><p>基本面：<b>資料源限制</b></p>`
      + `<p class="exp">目前純前端版本尚未接入穩定的美股基本面資料源，因此 EPS、P/E、P/B、營收成長率暫不納入完整評分。這是資料源限制，不代表該公司基本面不佳。完整美股基本面資料有限，分析結果僅供參考。</p></details>`;
  } else {
    const fundList = [
      `EPS（近四季合計）：${f.eps != null ? fmt(f.eps, 2) : "資料不足"}`, `本益比 P/E：${f.pe != null ? fmt(f.pe, 1) : "資料不足"}`, `股價淨值比 P/B：${f.pb != null ? fmt(f.pb, 2) : "資料不足"}`,
      `殖利率：${f.dy != null ? fmt(f.dy, 2) + "%" : "資料不足"}`, `營收成長率（YoY）：${f.revYoy != null ? (f.revYoy >= 0 ? "+" : "") + fmt(f.revYoy, 1) + "%" : "資料不足"}`,
    ];
    fundamental = `<details class="block info-section" open><summary>④ 基本面　<small>買什麼公司</small></summary>${ul(fundList)}<p class="exp">${esc(fundamentalExplain(f, m))}</p></details>`;
  }

  const volTxt = i.volRatio != null ? `今量為 20 日均量 ${fmt(i.volRatio, 2)} 倍` : "資料不足";
  const techList = [`MA5：${fmt(i.ma5)}　MA10：${fmt(i.ma10)}`, `MA20：${fmt(i.ma20)}　MA60：${fmt(i.ma60)}`, `RSI：${i.rsi == null ? "—" : fmt(i.rsi, 0) + (i.rsi >= 70 ? "（過熱）" : i.rsi <= 30 ? "（偏弱）" : "（健康）")}`, `支撐：${fmt(i.support)}　壓力：${fmt(i.resistance)}`, `成交量變化：${volTxt}`];
  const technical = `<details class="block info-section" open><summary>⑤ 技術面　<small>什麼時候買賣</small></summary>${ul(techList)}<p class="exp">${esc(technicalExplain(i))}</p></details>`;

  let chipBody;
  if (a.chip.ok) { const c = a.chip, it = [];
    if (c.foreign != null) it.push(`三大法人（張）：外資 ${signed(c.foreign)}、投信 ${signed(c.trust)}、自營商 ${signed(c.dealer)}`);
    if (c.marginBal != null) it.push(`融資餘額：${thou(c.marginBal)} 張（增減 ${signed(c.marginChg)}）`);
    if (c.shortBal != null) it.push(`融券餘額：${thou(c.shortBal)} 張（增減 ${signed(c.shortChg)}）`);
    chipBody = ul(it) + `<p class="exp">${esc(c.explain)}</p>`;
  } else chipBody = `<p>${esc(a.chip.note)}</p><p class="exp">${esc(a.chip.explain)}</p>`;
  const chip = `<details class="block info-section" open><summary>⑥ 籌碼面　<small>看主力動向</small></summary>${chipBody}</details>`;

  const kline = `<div class="block kline-wrap"><h4>② K 線圖　<small>近 60 日 · 電腦：滾輪縮放／拖曳平移　手機：雙指縮放／單指平移</small></h4>
      <div class="kl-tools"><button data-kl="in">＋ 放大</button><button data-kl="out">－ 縮小</button><button data-kl="reset">⟲ 重設</button><button data-kl="30">30日</button><button data-kl="60">60日</button><button data-kl="120">120日</button><span class="kl-range"></span></div>
      <canvas class="kline"></canvas>
      <div class="legend"><span class="lg up">綠 漲</span><span class="lg dn">紅 跌</span><span class="lg ma5">MA5</span><span class="lg ma20">MA20</span><span class="lg sup">支撐</span><span class="lg res">壓力</span></div></div>`;

  // 操作觀點 + 結論（中央底部並排；手機版結論移到右欄）
  const opCard = `<div class="block sl-op"><h4>🎛 操作觀點</h4><p>${esc(L.conclusion)}</p></div>`;
  const conclDesktop = `<div class="block conclusion concl-desktop"><h4>結論</h4><p>${esc(conclusion(i, d))}</p></div>`;
  const conclMobile = `<div class="block conclusion concl-mobile"><h4>結論</h4><p>${esc(conclusion(i, d))}</p></div>`;
  const conclRow = `<div class="center-conclrow">${opCard}${conclDesktop}</div>`;
  // 資料來源（精簡）：短欄位 + 一行交叉比對提醒（不做大型交叉驗證卡，item 12/13）
  const srcList = [`資料來源：${esc(a.source)}`, `資料日期：${esc(a.lastDate)}`, `最新收盤：${fmt(i.close)}`, `資料筆數：${a.rows} 筆`];
  const source = `<details class="block source info-section" open><summary>資料來源</summary>${ul(srcList)}${recent ? "" : `<p class="warn">⚠ 資料可能延遲，請以交易所或券商報價為準。</p>`}<p class="exp">提醒：單一資料來源可能有誤差或延遲，請與交易所或券商報價交叉比對。</p></details>`;

  // 中央主欄：股票主卡 → (K線 + 投資決策摘要) → 進場限制 → 選股邏輯・綜合分析 → (操作觀點 + 結論)
  const center = `<div class="result">${header}${hold}`
    + `<div class="center-midrow">${kline}${decision}</div>${limitBlock}${selSummary}${conclRow}`
    + `<p class="disc">以上為公開資料整理與技術指標，僅供研究，不構成投資建議。</p></div>`;
  // 右欄：資料明細面板 = 基本面 / 技術面 / 籌碼面 / 資料來源（+ 手機版結論，桌機隱藏）
  const right = `<div class="result side-result">${fundamental}${technical}${chip}${source}${conclMobile}</div>`;
  return { left: "", center, right, bottom: "" };
}

/* ===================== 黃金價格分析 ===================== */
const GOLD_API = "https://api.gold-api.com/price/XAU";   // XAU/USD 現價（免金鑰、CORS *）
const OZ_G = 31.1034768, QIAN_G = 3.75, TAEL_G = 37.5;
const GOLD_EXT = [
  ["Google News：黃金價格", "https://news.google.com/search?q=%E9%BB%83%E9%87%91%E5%83%B9%E6%A0%BC&hl=zh-TW"],
  ["Google News：XAUUSD gold price", "https://news.google.com/search?q=XAUUSD%20gold%20price&hl=en-US"],
  ["鉅亨網：黃金", "https://www.cnyes.com/search/all?keyword=%E9%BB%83%E9%87%91"],
  ["Yahoo 股市：黃金", "https://tw.stock.yahoo.com/quote/GC=F"],
];
let GOLD_TIMER = null, GOLD_AUTO = "off", GOLD_LASTPRICE = null;
function stopGoldAuto() { if (GOLD_TIMER) { clearInterval(GOLD_TIMER); GOLD_TIMER = null; } }
function setGoldAuto(ms) { stopGoldAuto(); if (ms > 0) GOLD_TIMER = setInterval(() => { if (!$("goldBody")) { stopGoldAuto(); return; } refreshGold(); }, ms); }
window.addEventListener("beforeunload", stopGoldAuto);

async function fetchGoldSpot() {
  const r = await fetch(GOLD_API, { cache: "no-store" });
  if (!r.ok) throw new Error("GOLD_HTTP " + r.status);
  const j = await r.json();
  if (j == null || j.price == null) throw new Error("GOLD_EMPTY");
  return { price: Number(j.price), updatedAt: j.updatedAt || null };
}
async function fetchGoldHistory() {
  const raw = await fmSafe("TaiwanFuturesDaily", "GDF", ago(2200));
  if (!raw || !raw.length) return null;
  const byDate = {};
  for (const r of raw) { const c = num(r.close), v = num(r.volume) || 0; if (!c || c <= 0) continue; const d = r.date; if (!byDate[d] || v > byDate[d].v) byDate[d] = { date: d, o: num(r.open), h: num(r.max), l: num(r.min), c, v }; }
  const bars = Object.values(byDate).filter((b) => b.o > 0 && b.h > 0 && b.l > 0).sort((a, b) => a.date < b.date ? -1 : 1);
  return bars.length ? bars : null;
}
async function fetchUsdTwd() {
  const d = await fmSafe("TaiwanExchangeRate", "USD", ago(20));
  if (!d || !d.length) return null;
  const m = d[d.length - 1], sb = num(m.spot_buy), ss = num(m.spot_sell), cb = num(m.cash_buy), cs = num(m.cash_sell);
  if (sb && ss) return (sb + ss) / 2; if (cb && cs) return (cb + cs) / 2; return null;
}
async function buildGold() {
  const spot = await fetchGoldSpot();                      // 現價必須成功；失敗則整體報錯
  const [hist, rate] = await Promise.all([fetchGoldHistory().catch(() => null), fetchUsdTwd().catch(() => null)]);
  const bars = hist && hist.length >= 5 ? hist : null;
  let ind = null, rets = null, prevClose = null, change = null;
  if (bars) {
    ind = buildIndicators(bars);
    const cl = bars.map((b) => b.c), ret = (n) => cl.length > n ? (cl[cl.length - 1] / cl[cl.length - 1 - n] - 1) * 100 : null;
    rets = { m1: ret(21), m3: ret(63), y1: ret(252) };
    prevClose = bars[bars.length - 1].c; change = (spot.price - prevClose) / prevClose * 100;
  }
  return { current: spot.price, updatedAt: spot.updatedAt, bars, ind, rets, rate, change, histAvailable: !!bars, lastDate: bars ? bars[bars.length - 1].date : null, rows: bars ? bars.length : 0 };
}
function decideGold(g) {
  const i = g.ind; if (!i) return null;
  const cur = g.current, { ma20, ma60, rsi: r, support: sup, resistance: res } = i;
  const dist20 = ma20 ? (cur - ma20) / ma20 * 100 : null;
  const aboveMa20 = ma20 && cur > ma20, aboveMa60 = ma60 && cur > ma60;
  const overheated = r != null && r >= 70, belowMa20 = ma20 != null && cur < ma20;
  const nearSupport = sup && cur <= sup * 1.04, nearResistance = res && cur >= res * 0.97, far = dist20 != null && dist20 > 10;
  const trend = (aboveMa20 && aboveMa60) ? "偏多" : belowMa20 ? "偏空" : "中性";
  const position = belowMa20 ? "跌破均線" : overheated ? "過熱" : (nearResistance || far) ? "偏高" : nearSupport ? "接近支撐" : "合理區";
  let score = 50;
  if (aboveMa20) score += 8; if (aboveMa60) score += 8; if (ma20 && ma60 && ma20 > ma60) score += 6;
  if (belowMa20) score -= 18; if (r != null) { if (r >= 75) score -= 18; else if (r >= 70) score -= 10; else if (r <= 35) score += 8; }
  if (nearSupport) score += 8; if (nearResistance) score -= 6; if (far) score -= 8;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const risk = (overheated || far) ? "高" : (r != null && r < 65 && !nearResistance && (dist20 == null || Math.abs(dist20) <= 7)) ? "低" : "中";
  let action;
  if (overheated) action = "不建議追高"; else if (belowMa20) action = "觀望";
  else if (score >= 66) action = nearSupport ? "可分批觀察" : "可小量布局"; else if (score >= 54) action = "可分批觀察"; else if (score >= 44) action = "觀望"; else action = "風險偏高";
  const seg = [];
  if (aboveMa20 && aboveMa60) seg.push("金價站上中期均線、趨勢偏多"); else if (belowMa20) seg.push("金價跌破中期均線、趨勢轉弱"); else seg.push("金價趨勢中性");
  if (overheated) seg.push(`RSI ${fmt(r, 0)} 偏高、短線過熱`); else if (r != null && r <= 35) seg.push(`RSI ${fmt(r, 0)} 偏低`);
  let adv;
  if (overheated) adv = "短線距離支撐較遠、追價風險高，不建議一次追高；若想配置黃金，較適合等待回落接近支撐區後分批";
  else if (belowMa20) adv = "方向未明，建議觀望、待站回均線再評估配置";
  else if (nearSupport) adv = "目前接近支撐，可小額分批布局並控制部位，黃金宜作為長期資產配置";
  else if (nearResistance || far) adv = "距離支撐較遠 / 接近壓力，不建議一次追高，可等待回落分批";
  else adv = "可分批觀察、避免一次買滿，黃金宜作為長期避險與資產配置工具，而非短線追價";
  return { trend, position, score, risk, action, operation: seg.join("，") + "；" + adv + "。", aboveMa20, aboveMa60, overheated, belowMa20, nearSupport, nearResistance, far, dist20 };
}
function goldBuy(g, d) {
  const r = [], i = g.ind;
  if (d.aboveMa20) r.push("金價站上 MA20，中短線趨勢偏多");
  if (d.aboveMa60) r.push("金價站上 MA60，中期趨勢仍偏多");
  if (d.nearSupport) r.push("現價接近支撐區，下檔風險相對有限");
  if (i && i.rsi != null && i.rsi <= 40) r.push(`RSI ${fmt(i.rsi, 0)} 偏低，短線有反彈機會`);
  if (g.rets && g.rets.y1 != null && g.rets.y1 > 0) r.push(`近一年上漲 ${fmt(g.rets.y1, 0)}%，長期趨勢向上`);
  r.push("黃金具避險與資產配置價值，適合長期小額分批配置");
  const fill = ["可分批降低平均成本、避免一次買滿", "作為投組避險工具，分散股票風險"];
  for (const f of fill) { if (r.length >= 3) break; if (!r.includes(f)) r.push(f); }
  return r.slice(0, 6);
}
function goldAvoid(g, d) {
  const r = [], i = g.ind;
  if (d.overheated) r.push(`RSI ${i ? fmt(i.rsi, 0) : "—"} 偏高、短線過熱，不宜一次追高`);
  if (d.far) r.push(`金價偏離 MA20 約 ${fmt(d.dist20, 0)}%，距離支撐過遠`);
  if (d.nearResistance) r.push("金價接近壓力 / 高位附近，追高套牢風險升高");
  r.push("美元若轉強通常壓抑金價");
  r.push("利率維持高檔可能壓抑無息資產的黃金");
  if (g.rets && g.rets.m1 != null && g.rets.m1 > 8) r.push(`近一個月已上漲 ${fmt(g.rets.m1, 0)}%，短線漲多易回檔`);
  const fill = ["短線漲多容易回檔，宜分批進場", "金價接近歷史高位時不宜重壓"];
  for (const f of fill) { if (r.length >= 3) break; if (!r.includes(f)) r.push(f); }
  return r.slice(0, 6);
}
function goldConclusion(g, d) {
  if (!d) return "目前僅取得金價現價，歷史 / 技術資料不足，無法給出完整趨勢判斷；建議搭配外部金價網站確認走勢後再決定配置。";
  if (d.overheated) return "目前金價趨勢仍偏多，但短線已接近壓力區、RSI 偏高，不建議一次追高。若目的是長期資產配置，可採小額分批；若是短線交易，建議等待回落接近支撐區再觀察。";
  if (d.belowMa20) return "目前金價跌破中短期均線、方向未明，建議觀望，待站回均線並確認支撐後再評估配置。";
  if (d.nearSupport) return "目前金價接近支撐區，若作長期資產配置可小額分批布局並控制部位；跌破支撐則先觀望。";
  return "目前金價趨勢中性偏多，建議分批、避免一次買滿；黃金宜作為長期避險與資產配置工具，而非股票式短線追價。";
}
function goldFresh(updatedAt) {
  if (!updatedAt) return { type: "最新可取得資料", recent: true };
  const mins = (Date.now() - new Date(updatedAt).getTime()) / 60000;
  return { type: mins <= 30 ? "近即時資料（公開資料，非券商即時逐筆）" : (mins <= 1440 ? "延遲資料（公開資料）" : "最新可取得資料"), recent: mins <= 1440 };
}

async function loadGold() {
  const body = $("goldBody");
  body.innerHTML = `<div class="muted">載入金價分析中…</div>`;
  await refreshGold(true);
}
async function refreshGold(isFirst) {
  const body = $("goldBody");
  const s = body.querySelector(".upd-status"); if (s) s.textContent = "更新中…";
  try {
    const g = await buildGold();
    g.decision = decideGold(g);
    let initView = null;
    const oldCv = body.querySelector("canvas.kline");
    if (oldCv && oldCv._view) initView = { count: oldCv._view.count, endOffset: oldCv._barsLen - oldCv._view.end };
    const prev = GOLD_LASTPRICE;
    body.innerHTML = renderGold(g, { updatedAt: nowStamp(), autoVal: GOLD_AUTO });
    GOLD_LASTPRICE = g.current;
    const wrap = body.querySelector(".kline-wrap");
    if (wrap) setupKline(wrap, g.bars, g.ind.support, g.ind.resistance, initView, Math.min(252, g.bars.length), true);
    setupGoldControls();
    if (!isFirst && prev != null && g.current !== prev) { const px = body.querySelector(".px"); if (px) { px.classList.add(g.current > prev ? "flash-up" : "flash-down"); setTimeout(() => px.classList.remove("flash-up", "flash-down"), 800); } }
  } catch (e) {
    const ext = GOLD_EXT.map(([t, u]) => `<a href="${u}">${esc(t)}</a>`).join(" ・ ");
    body.innerHTML = `<div class="err">⚠️ 黃金價格資料來源暫時不可用，請稍後再試或改用外部金價網站。</div><p class="news-links">${ext}</p>`;
  }
}
function setupGoldControls() {
  const body = $("goldBody");
  const btn = body.querySelector(".upd-btn"); if (btn) btn.addEventListener("click", () => refreshGold(false));
  const sel = body.querySelector(".upd-auto");
  if (sel) { sel.value = GOLD_AUTO; sel.addEventListener("change", () => { GOLD_AUTO = sel.value; setGoldAuto({ off: 0, "30": 30000, "60": 60000, "300": 300000 }[sel.value] || 0); }); }
}
function renderGold(g, meta) {
  const d = g.decision, fr = goldFresh(g.updatedAt);
  const dir = g.change == null ? "" : g.change >= 0 ? "px-up" : "px-down";
  const actCls = d ? ((d.action === "可分批觀察" || d.action === "可小量布局") ? "good" : (d.action === "不建議追高" || d.action === "風險偏高") ? "bad" : "neutral") : "neutral";
  const header = `<div class="rhead"><h3>國際金價 <span class="code">XAU/USD</span></h3></div>
    <div class="ticker"><span class="px ${dir}">$${fmt(g.current)}</span><span class="unit">/ oz</span><span class="chg ${dir}">${g.change == null ? "（無前日對比）" : pct(g.change)}</span></div>
    <div class="updbar"><div class="updctrls"><button class="upd-btn"><span aria-hidden="true">↻</span> 更新金價</button>
      <label class="autolbl">自動更新 <select class="upd-auto"><option value="off">關閉</option><option value="30">每 30 秒</option><option value="60">每 1 分</option><option value="300">每 5 分</option></select></label></div>
      <div class="updmeta"><span class="upd-status">最後更新：${esc(meta.updatedAt)}</span>｜現價來源：Gold-API.com｜價格類型：${esc(fr.type)}</div></div>
    <p class="px-note">目前價格以公開資料來源最新可取得資料為準，可能不是即時逐筆報價。</p>
    ${d ? `<div class="sumbadges"><span class="badge ${actCls}">${esc(d.action)}</span><span>信心 <b>${d.score}</b>/100</span><span>風險 <b>${esc(d.risk)}</b></span><span>趨勢 <b>${esc(d.trend)}</b></span><span>位置 <b>${esc(d.position)}</b></span></div>` : ""}`;

  let twd;
  if (g.rate) { const perG = g.current * g.rate / OZ_G; twd = ul([`約當台幣 / 克：${thou(perG)} 元`, `約當台幣 / 錢：${thou(perG * QIAN_G)} 元`, `約當台幣 / 台兩：${thou(perG * TAEL_G)} 元`]) + `<p class="exp">匯率 USD/TWD ≈ ${fmt(g.rate, 2)}（FinMind 即期中價）；換算：1 oz = 31.1035 克、1 錢 = 3.75 克、1 台兩 = 37.5 克。</p>`; }
  else twd = "<p>台幣換算資料不足。</p>";
  const twdB = `<div class="block"><h4>② 台幣換算</h4>${twd}</div>`;
  const stateB = d ? `<div class="block decision"><h4>③ 金價狀態 / 操作建議</h4><p>趨勢：<b>${esc(d.trend)}</b>　｜位置：${esc(d.position)}　｜建議：<b>${esc(d.action)}</b>　｜風險：${esc(d.risk)}　｜信心：${d.score}/100</p><p class="op">${esc(d.operation)}</p></div>`
    : `<div class="block decision"><h4>③ 金價狀態 / 操作建議</h4><p>歷史 / 技術資料不足，僅提供現價；完整趨勢判斷請搭配外部金價走勢圖。</p></div>`;

  let tech;
  if (g.ind) { const i = g.ind, R = g.rets;
    const techList = [`MA5：${fmt(i.ma5)}　MA20：${fmt(i.ma20)}`, `MA60：${fmt(i.ma60)}　MA200：${i.ma200 != null ? fmt(i.ma200) : "資料不足"}`,
      `RSI：${i.rsi == null ? "—" : fmt(i.rsi, 0) + (i.rsi >= 70 ? "（過熱）" : i.rsi <= 30 ? "（偏弱）" : "（健康）")}`, `支撐：${fmt(i.support)}　壓力：${fmt(i.resistance)}`,
      `近1月：${R && R.m1 != null ? (R.m1 >= 0 ? "+" : "") + fmt(R.m1, 1) + "%" : "資料不足"}　近3月：${R && R.m3 != null ? (R.m3 >= 0 ? "+" : "") + fmt(R.m3, 1) + "%" : "資料不足"}　近1年：${R && R.y1 != null ? (R.y1 >= 0 ? "+" : "") + fmt(R.y1, 1) + "%" : "資料不足"}`];
    const cur = g.current, p = [];
    if (i.ma20 && cur > i.ma20) p.push("目前金價站上 MA20"); if (i.ma60 && cur > i.ma60) p.push("並站上 MA60，中短線趨勢仍偏多");
    let ex = p.join("，") || "金價位於均線下方、趨勢偏弱"; ex += "；";
    ex += i.rsi == null ? "RSI 資料不足。" : i.rsi >= 70 ? `RSI 已達 ${fmt(i.rsi, 0)}，短線可能過熱，較不適合一次追高。` : i.rsi <= 30 ? `RSI ${fmt(i.rsi, 0)} 偏低、短線超賣。` : `RSI ${fmt(i.rsi, 0)} 位於健康區間。`;
    tech = `<div class="block"><h4>④ 技術面</h4>${ul(techList)}<p class="exp">${esc(ex)}</p></div>`;
  } else tech = `<div class="block"><h4>④ 技術面</h4><p>歷史資料不足，無法計算均線 / RSI / 支撐壓力。</p></div>`;

  let chart;
  if (g.histAvailable) {
    chart = `<div class="block kline-wrap"><h4>⑤ 歷年金價圖（曲線）　<small>USD/oz · 電腦：滾輪縮放／拖曳　手機：雙指縮放／單指平移</small></h4>
      <div class="kl-tools"><button data-kl="in">＋ 放大</button><button data-kl="out">－ 縮小</button><button data-kl="reset">⟲ 重設</button>
        <button data-kl="21">1M</button><button data-kl="63">3M</button><button data-kl="126">6M</button><button data-kl="252">1Y</button><button data-kl="756">3Y</button><button data-kl="1260">5Y</button><button data-kl="max">Max</button><span class="kl-range"></span></div>
      <canvas class="kline"></canvas>
      <div class="legend"><span class="lg gp">Gold Price</span><span class="lg m20">MA20</span><span class="lg m60">MA60</span><span class="lg sup">Support</span><span class="lg res">Resistance</span></div>
      <p class="exp">⚠ FinMind 台灣黃金期貨 GDF 為美元計價黃金期貨，僅作為國際金價歷史走勢近似，不等於 XAU/USD 現貨逐筆歷史資料。</p></div>`;
  } else {
    const ext = GOLD_EXT.map(([t, u]) => `<a href="${u}">${esc(t)}</a>`).join(" ・ ");
    chart = `<div class="block"><h4>⑤ 歷年金價圖</h4><p>歷史金價資料來源暫時不可用，請稍後再試或改用外部金價網站。</p><p class="news-links">${ext}</p></div>`;
  }

  const newsCats = "美元走勢 ・ 聯準會 / 利率 ・ 通膨 ・ 地緣政治 ・ 央行買金 ・ 避險需求";
  const newsLinks = GOLD_EXT.map(([t, u]) => `<a href="${u}">${esc(t)}</a>`).join(" ・ ");
  const news = `<div class="block"><h4>⑥ 黃金相關新聞</h4><p class="exp">影響金價的常見主題：${newsCats}。</p>
    <p>新聞來源受限於純前端 CORS，部分新聞需開啟外部搜尋連結查看：</p><p class="news-links">${newsLinks}</p></div>`;

  const buyB = d ? `<div class="block buy"><h4>⑦ 為什麼可以入手 / 偏多理由</h4>${ul(goldBuy(g, d))}</div>` : "";
  const avoidB = d ? `<div class="block nobuy"><h4>⑧ 為什麼不建議追高 / 風險理由</h4>${ul(goldAvoid(g, d))}</div>` : "";
  const conclB = `<div class="block conclusion"><h4>⑨ 黃金入手判斷 · 結論</h4><p>${esc(goldConclusion(g, d))}</p></div>`;

  const lag = g.lastDate ? daysBetween(g.lastDate) : null;
  const recent = lag == null ? fr.recent : lag <= 4;
  const srcList = [`現價來源：Gold-API.com（XAU/USD，公開資料）`, `歷史 / 技術來源：FinMind 台灣黃金期貨（GDF，美元計價，近似國際金價）`, `最新資料時間：${esc(meta.updatedAt)}（現價）${g.lastDate ? "｜歷史資料日：" + esc(g.lastDate) : ""}`, `資料筆數：${g.rows} 筆（歷史）`, `價格類型：${esc(fr.type)}`, `是否延遲：${recent ? "正常" : "可能延遲"}`];
  const source = `<div class="block source"><h4>⑩ 資料來源與更新時間</h4>${ul(srcList)}${recent ? "" : `<p class="warn">⚠ 資料可能延遲，請以證交所、NASDAQ/NYSE 或券商報價為準。</p>`}
    <p class="exp">圖表為前端 Canvas 即時繪製，非圖片、非 AI 生成。</p>
    <p class="exp">此版本為純前端版本，金價資料以公開資料來源為主，<b>未進行雙來源交叉驗證</b>。</p></div>`;

  return `<div class="gold-result">` + header + twdB + stateB + tech + chart + news + `<div class="aspects two">${buyB}${avoidB}</div>` + conclB + source + `<p class="disc">以上為公開資料整理與技術指標，僅供研究，不構成投資建議。黃金宜作為長期資產配置工具。</p></div>`;
}

/* ---------- resize 重繪 ---------- */
let rzT; window.addEventListener("resize", () => { clearTimeout(rzT); rzT = setTimeout(() => { document.querySelectorAll(".kline").forEach((cv) => { if (cv._redraw) cv._redraw(); }); syncAccordion(); }, 150); });

/* ---------- 事件 ---------- */
function ensureGold() { if (!$("goldBody").querySelector(".gold-result")) loadGold(); }
// 桌機：黃金分析渲染到中央主畫面（重用 buildGold/renderGold/setupKline，不新增 API）
async function loadGoldCenter() {
  stopAuto(); CUR = null; SEQ++; setHudState("hide");
  $("centerResult").innerHTML = `<div class="result"><div class="muted">載入金價分析中…</div></div>`;
  $("rightResult").innerHTML = ""; $("bottomResult").innerHTML = "";
  try {
    const g = await buildGold(); g.decision = decideGold(g);
    $("centerResult").innerHTML = `<div class="result">${renderGold(g, { updatedAt: nowStamp(), autoVal: "off" })}</div>`;
    const wrap = $("centerResult").querySelector(".kline-wrap");
    if (wrap) setupKline(wrap, g.bars, g.ind.support, g.ind.resistance, null, Math.min(252, g.bars.length), true);
    const btn = $("centerResult").querySelector(".upd-btn"); if (btn) btn.addEventListener("click", () => loadGoldCenter());
    const sel = $("centerResult").querySelector(".upd-auto"); if (sel) { sel.value = "off"; sel.disabled = true; }   // 中央版不自動更新，避免與股票 timer 衝突
  } catch (e) {
    const ext = GOLD_EXT.map(([t, u]) => `<a href="${u}">${esc(t)}</a>`).join(" ・ ");
    $("centerResult").innerHTML = `<div class="result"><div class="err">⚠️ 黃金價格資料來源暫時不可用，請稍後再試。</div><p class="news-links">${ext}</p></div>`;
  }
}

/* ---------- Modal 彈窗 ---------- */
function openModal(id) { const m = $(id); if (!m) return; document.querySelectorAll(".modal.open").forEach((o) => { if (o !== m) closeModal(o); }); m.classList.add("open"); m.setAttribute("aria-hidden", "false"); document.body.classList.add("modal-open"); const inp = m.querySelector("input"); if (inp) setTimeout(() => inp.focus(), 70); }
function closeModal(m) { m.classList.remove("open"); m.setAttribute("aria-hidden", "true"); if (!document.querySelector(".modal.open")) document.body.classList.remove("modal-open"); }
document.querySelectorAll(".modal").forEach((m) => m.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => closeModal(m))));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".modal.open").forEach(closeModal); });

document.querySelectorAll(".feature").forEach((b) => b.addEventListener("click", () => { const t = $(b.getAttribute("data-goto")); if (t) { t.scrollIntoView({ behavior: "smooth", block: "start" }); const inp = t.querySelector("input,select"); if (inp) setTimeout(() => inp.focus(), 300); } }));
document.querySelectorAll("[data-act]").forEach((el) => {
  const handler = () => {
    const act = el.getAttribute("data-act");
    if (act === "twnews") openModal("modal-twnews");
    else if (act === "usnews") openModal("modal-usnews");
    else if (act === "focus-symbol") { const q = $("query"); if (q) q.scrollIntoView({ behavior: "smooth", block: "center" }); setTimeout(() => { const tw = $("tw-search"); if (tw) tw.focus(); }, 320); }
    else if (act === "focus-holdings") { const h = $("myholdings"); if (h) { h.scrollIntoView({ behavior: "smooth", block: "start" }); setTimeout(() => $("h-symbol").focus(), 320); } }
    else if (act === "gold") {
      if (window.matchMedia("(min-width: 981px)").matches) { loadGoldCenter(); const c = $("query"); if (c) c.scrollIntoView({ behavior: "smooth", block: "start" }); }
      else { openModal("modal-gold"); ensureGold(); requestAnimationFrame(() => { const cv = $("goldBody").querySelector("canvas.kline"); if (cv && cv._redraw) cv._redraw(); }); }
    }
  };
  el.addEventListener("click", handler);
  el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handler(); } });
});
{ const gl = $("goldLoad"); if (gl) gl.addEventListener("click", loadGold); }

/* ---------- 新聞外部搜尋（CORS 限制下不 fetch 新聞 API；改為渲染可點擊的外部搜尋連結 + 空狀態） ---------- */
function openSearch(url) { window.open(url, "_blank", "noopener,noreferrer"); }
function gNews(q, lang) { return "https://news.google.com/search?q=" + encodeURIComponent(q) + "&hl=" + lang; }
// 依市場 / 代號產生外部搜尋目標（順序對應 data-kind：news / fin / chip|analyst / yahoo）
function newsTargets(mkt, sym) {
  if (mkt === "tw") return [
    ["📰 台股新聞", gNews(sym + " 台股 新聞", "zh-TW")],
    ["📊 財報 / 基本面", gNews(sym + " 財報 基本面", "zh-TW")],
    ["🏦 法人 / 籌碼", gNews(sym + " 外資 投信 自營商 融資 融券", "zh-TW")],
    ["📈 Yahoo 股市", "https://tw.stock.yahoo.com/quote/" + encodeURIComponent(sym)],
  ];
  return [
    ["📰 美股新聞", gNews(sym + " stock news", "en-US")],
    ["📊 財報 / Earnings", gNews(sym + " earnings financials", "en-US")],
    ["🎯 分析師評等", gNews(sym + " analyst rating target price", "en-US")],
    ["📈 Yahoo Finance", "https://finance.yahoo.com/quote/" + encodeURIComponent(sym)],
  ];
}
// 把搜尋連結渲染進 modal 結果區（即使彈窗被瀏覽器阻擋，使用者仍可看到並點擊連結）
function renderNewsLinks(mkt, sym) {
  const box = $(mkt === "tw" ? "tw-news-result" : "us-news-result"); if (!box) return;
  const links = newsTargets(mkt, sym).map(([t, u]) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${esc(t)}</a>`).join(" ");
  box.innerHTML = `<p class="nr-head">${esc(sym)} 的外部搜尋連結（新分頁開啟）：</p><p class="news-links">${links}</p>`
    + `<p class="nr-note muted">新聞 / 法人消息屬外部來源，純前端版於 CORS 限制下不直接抓取新聞內容，改以可點擊連結呈現。</p>`;
}
document.querySelectorAll("[data-news]").forEach((btn) => btn.addEventListener("click", () => {
  const mkt = btn.getAttribute("data-news"), kind = btn.getAttribute("data-kind");
  const raw = (mkt === "tw" ? $("tw-news-sym").value : $("us-news-sym").value).trim();
  const sym = mkt === "tw" ? raw : raw.toUpperCase();
  const box = $(mkt === "tw" ? "tw-news-result" : "us-news-result");
  const re = mkt === "tw" ? TW_RE : US_NEWS_RE;
  if (!re.test(sym)) {
    const msg = mkt === "tw" ? "請先輸入有效台股代號，例如 2330、2454、2317。" : "請先輸入有效美股代號，例如 AAPL、NVDA、MSFT。";
    if (box) box.innerHTML = `<span class="muted">${esc(msg)}</span>`;
    toast(msg); return;
  }
  const targets = newsTargets(mkt, sym);
  const idxMap = { news: 0, fin: 1, chip: 2, analyst: 2, yahoo: 3 };
  const idx = idxMap[kind] == null ? 0 : idxMap[kind];
  renderNewsLinks(mkt, sym);     // 先渲染可見連結（空狀態 / 結果都看得到）
  openSearch(targets[idx][1]);   // 再嘗試開啟使用者點選的搜尋（被阻擋時上方連結仍可點）
}));
// 股票快查：台股 / 美股 兩列各自查詢；alias 命中跨市場時自動切換並提示
function runSearch(raw, preferMarket) {
  const r = resolveSymbolInput(raw);
  if (r.error) { toast(r.error); return; }
  if (r.market !== preferMarket) toast(`已辨識為${r.market === "US" ? "美股" : "台股"} ${r.symbol}`);
  analyze(r.symbol, r.market);
}
$("go-tw").addEventListener("click", () => runSearch($("tw-search").value, "TW"));
$("go-us").addEventListener("click", () => runSearch($("us-search").value, "US"));
$("tw-search").addEventListener("keydown", (e) => { if (e.key === "Enter") $("go-tw").click(); });
$("us-search").addEventListener("keydown", (e) => { if (e.key === "Enter") $("go-us").click(); });
$("save").addEventListener("click", () => {
  const r = resolveSymbolInput($("h-symbol").value);
  if (r.error) { toast(r.error); return; }
  const m = r.market, s = r.symbol;          // 存入實際代號，不存中文名稱
  if (m !== $("h-market").value) $("h-market").value = m;
  $("h-symbol").value = s;
  const cost = parseFloat($("cost").value) || null, qty = parseFloat($("qty").value) || null;
  const list = getHoldings().filter((h) => !(h.symbol === s && h.market === m));
  list.push({ symbol: s, market: m, cost, qty });
  setHoldings(list);
});
$("h-symbol").addEventListener("keydown", (e) => { if (e.key === "Enter") $("save").click(); });
$("holdings").addEventListener("click", (e) => { const del = e.target.getAttribute("data-del"); if (del) { const [m, s] = del.split(":"); setHoldings(getHoldings().filter((h) => !(h.market === m && h.symbol === s))); return; } const a = e.target.closest("a"); if (a) { e.preventDefault(); const m = a.getAttribute("data-m"), s = a.getAttribute("data-s"); const h = getHoldings().find((x) => x.market === m && x.symbol === s) || {}; analyze(s, m, h.cost, h.qty); } });
$("analyzeAll").addEventListener("click", () => { const list = getHoldings(); if (!list.length) { toast("尚未加入持股，請先在上方加入持股。"); return; } list.forEach((h) => analyze(h.symbol, h.market, h.cost, h.qty)); });
$("clearAll").addEventListener("click", () => { if (confirm("清空我的持股？")) setHoldings([]); });
// 熱門快捷查詢：填入左側查詢面板並直接分析（analyze 內部 ++SEQ + stopAuto + 清空舊結果，只顯示最新一次）
document.querySelectorAll(".quick").forEach((b) => b.addEventListener("click", () => {
  const m = b.getAttribute("data-qm"), s = b.getAttribute("data-qs");
  if (!m || !s) return;
  $("market").value = m; $("symbol").value = s;
  analyze(s, m);
}));

// 右側黃金現價小卡（只抓 Gold-API 現價，點卡片開啟完整黃金分析 modal）
async function loadGoldMini() {
  const el = $("goldMiniBody"); if (!el) return;
  try { const g = await fetchGoldSpot(); el.innerHTML = `<div class="gm-price">$${fmt(g.price)}</div><div class="gm-sub">XAU/USD ・ USD/oz</div>`; }
  catch { el.innerHTML = `<span class="muted">金價暫時無法取得，點下方開啟分析。</span>`; }
}

renderHoldings();
loadGoldMini();

// 前端防複製（一般阻擋；輸入框 / 下拉聚焦時不影響正常輸入與選取）
(function () {
  const editable = (el) => !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
  document.addEventListener("contextmenu", (e) => { if (!editable(e.target)) e.preventDefault(); });
  document.addEventListener("copy", (e) => { if (!editable(e.target)) e.preventDefault(); });
  document.addEventListener("keydown", (e) => {
    if (editable(e.target)) return;
    const k = (e.key || "").toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (k === "c" || k === "s" || k === "u")) e.preventDefault();
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (k === "i" || k === "j" || k === "c")) e.preventDefault();
    if (k === "f12") e.preventDefault();
  });
})();
