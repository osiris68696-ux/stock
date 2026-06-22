"use strict";
/* 台美股智慧分析 — GitHub Pages 純前端
 * 安全：固定資料來源 FinMind 開放 API（免金鑰）；不使用 eval/exec；不接受使用者自訂 URL；
 * 持股只存 localStorage；無 .env / Token / Chat ID / 私人持股；K 線為 Canvas 即時繪製（非圖片、非 AI 生成）。
 */
const LS_KEY = "twus_holdings";
const FINMIND = "https://api.finmindtrade.com/api/v4/data";   // 唯一允許的資料網域
const TW_RE = /^[0-9]{4,6}$/;
const US_RE = /^[A-Za-z]{1,10}$/;
const $ = (id) => document.getElementById(id);

/* ---------- 工具 ---------- */
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function fmt(v, n = 2) { return (v == null || isNaN(v)) ? "—" : Number(v).toFixed(n); }
function thou(v) { return (v == null || isNaN(v)) ? "—" : Math.round(v).toLocaleString("en-US"); }
function pct(v) { return v == null || isNaN(v) ? "—" : (v >= 0 ? "🔺" : "🔻") + Number(v).toFixed(2) + "%"; }
function signed(v) { return v == null || isNaN(v) ? "—" : (v >= 0 ? "+" : "") + Math.round(v).toLocaleString("en-US"); }
function ul(items) { return "<ul>" + (items || []).map((x) => `<li>${esc(x)}</li>`).join("") + "</ul>"; }
function ago(days) { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); }
function daysBetween(iso) { return Math.round((Date.now() - new Date(iso + "T00:00:00").getTime()) / 86400000); }

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

/* ---------- FinMind（固定網域） ---------- */
async function fm(dataset, id, start) {
  const u = `${FINMIND}?dataset=${encodeURIComponent(dataset)}&data_id=${encodeURIComponent(id)}` + (start ? `&start_date=${start}` : "");
  const r = await fetch(u);
  if (r.status === 402 || r.status === 429) throw new Error("資料來源限流，請稍候再試（公開 API 流量上限）");
  if (!r.ok) throw new Error("資料來源 HTTP " + r.status);
  const j = await r.json();
  if (j.status !== 200) throw new Error(j.msg || "資料來源回應異常");
  return j.data || [];
}
async function fmSafe(dataset, id, start) { try { return await fm(dataset, id, start); } catch { return null; } }
function num(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }

/* ---------- 指標組裝 ---------- */
function buildIndicators(bars) {
  const closes = bars.map((b) => b.c), highs = bars.map((b) => b.h), lows = bars.map((b) => b.l), vols = bars.map((b) => b.v);
  const last = closes[closes.length - 1], prev = closes.length > 1 ? closes[closes.length - 2] : null;
  const ma20 = sma(closes, 20), ma60 = sma(closes, 60), ma5 = sma(closes, 5), ma10 = sma(closes, 10);
  const r = rsi(closes, 14);
  const support = lows.length >= 5 ? Math.min(...lows.slice(-20)) : null;
  const resistance = highs.length >= 5 ? Math.max(...highs.slice(-20)) : null;
  let volRatio = null;
  if (vols.length >= 21) { const avg = vols.slice(-21, -1).reduce((a, b) => a + b, 0) / 20; if (avg) volRatio = vols[vols.length - 1] / avg; }
  return { close: last, change_pct: prev ? (last - prev) / prev * 100 : null, ma5, ma10, ma20, ma60, rsi: r, support, resistance, volRatio, distMa20: ma20 ? (last - ma20) / ma20 * 100 : null };
}

/* ---------- 決策摘要 ---------- */
function decide(ind, fund, market) {
  const { close, ma5, ma10, ma20, rsi: r, support: sup, resistance: res, distMa20 } = ind;
  const trendUp = ma20 && close > ma20 && ma5 && ma10 && ma5 > ma10 && ma10 > ma20;
  const overheated = r != null && r >= 75;
  const belowMa20 = ma20 != null && close < ma20;
  const nearSupport = sup && close <= sup * 1.05;
  const nearResistance = res && close >= res * 0.97;
  const farFromMa20 = distMa20 != null && distMa20 > 12;

  let position;
  if (belowMa20) position = "跌破均線";
  else if (overheated) position = "過熱";
  else if (nearResistance || farFromMa20) position = "偏高";
  else if (nearSupport) position = "接近支撐";
  else position = "合理區";

  let score = 50;
  if (trendUp) score += 15; else if (ma20 && close > ma20) score += 8;
  if (belowMa20) score -= 20;
  if (r != null) { if (r >= 80) score -= 25; else if (r >= 70) score -= 12; else if (r <= 30) score += 10; }
  if (nearSupport) score += 10;
  if (nearResistance) score -= 8;
  if (farFromMa20) score -= 10;
  if (market === "TW" && fund.pe != null) { if (fund.pe > 0 && fund.pe < 12) score += 6; else if (fund.pe > 30) score -= 6; }
  score = Math.max(0, Math.min(100, Math.round(score)));

  let risk = "中";
  if (overheated || farFromMa20 || (fund.pe != null && fund.pe >= 35)) risk = "高";
  else if (r != null && r < 70 && !nearResistance && (distMa20 == null || Math.abs(distMa20) <= 8)) risk = "低";

  let action;
  if (overheated) action = "不建議追高";
  else if (belowMa20) action = "觀望";
  else if (score >= 68) action = nearSupport ? "可分批觀察" : "可小量布局";
  else if (score >= 55) action = "可分批觀察";
  else if (score >= 45) action = "觀望";
  else action = "風險偏高";

  const seg = [];
  if (overheated) seg.push(`目前 RSI ${fmt(r, 0)} 短線過熱`);
  else if (r != null && r <= 30) seg.push(`RSI ${fmt(r, 0)} 偏低、短線超賣`);
  if (trendUp) seg.push("均線多頭排列、趨勢偏多");
  else if (belowMa20) seg.push("股價跌破月線、趨勢轉弱");
  else seg.push("趨勢中性");
  let advise;
  if (overheated) advise = "短線追價風險高；若已持有可續抱觀察，若尚未進場，建議等待回落接近支撐區再分批，新進場宜保守";
  else if (belowMa20) advise = "方向未明，建議先觀望、待股價站回均線再評估";
  else if (nearSupport) advise = "股價接近支撐，可分批布局並嚴設停損，避免單筆重壓";
  else if (nearResistance) advise = "股價接近壓力，不宜追高，可待回測支撐區再進場";
  else advise = "可分批觀察、避免單筆重壓，並留意均線與量能變化";
  const operation = seg.join("，") + "；" + advise + "。";

  return { position, score, risk, action, operation, trendUp, overheated, belowMa20, nearSupport, nearResistance, farFromMa20 };
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
  if (sup && close <= sup * 1.05) s += "；目前接近支撐區，下檔風險相對有限";
  else if (res && close >= res * 0.97) s += "；目前接近壓力區，上檔空間有限、不宜追價";
  return s + "。";
}
function buildChip(inst, margin, market) {
  if (market !== "TW" || (!inst && !margin)) {
    return { ok: false,
      note: market === "TW" ? "籌碼面資料不足，純前端版本目前無法完整取得三大法人與融資融券資料。" : "美股無台股式三大法人 / 融資融券制度，純前端版籌碼面資料不足。",
      explain: "籌碼面主要用來觀察主力資金流向，若法人持續買超且融資未過熱，通常代表籌碼較健康；若股價上漲但融資大增，則需留意散戶追高風險。" };
  }
  const o = { ok: true };
  if (inst) { o.foreign = inst.foreign; o.trust = inst.trust; o.dealer = inst.dealer; }
  if (margin) { o.marginBal = margin.marginBal; o.marginChg = margin.marginChg; o.shortBal = margin.shortBal; o.shortChg = margin.shortChg; }
  const buys = inst && (inst.foreign > 0 || inst.trust > 0);
  const marginUp = margin && margin.marginChg > Math.abs(margin.marginBal) * 0.03;
  let read = "籌碼面主要用來觀察主力資金流向：";
  if (buys && !marginUp) read += "法人偏買超、融資未明顯增加，籌碼相對健康；";
  else if (marginUp) read += "融資明顯增加，需留意散戶追高風險；";
  else read += "法人買賣超與融資變化平淡；";
  read += "若法人持續買超且融資未過熱通常較健康，若股價上漲但融資大增則需留意追高風險。";
  o.explain = read;
  return o;
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
  else if (close >= res * 0.97) posNote = "接近短線高檔，等待回落較安全";
  else posNote = "位於合理觀察區間，建議分批、勿追高";
  return `支撐區：${fmt(sup)} 附近\n合理觀察區：${fmt(sup)} ~ ${fmt(res)}\n壓力區：${fmt(res)} 附近\n不建議追高區：高於 ${fmt(res)}\n目前位置：${posNote}。`;
}
function conclusion(ind, d) {
  let state;
  if (d.overheated && (d.trendUp || (ind.ma20 && ind.close > ind.ma20))) state = "趨勢偏多但短線過熱";
  else if (d.belowMa20) state = "趨勢轉弱、方向未明";
  else if (d.trendUp) state = "趨勢偏多、結構健康";
  else state = "趨勢中性、區間整理";
  if (d.overheated) return `目前屬於「${state}」。雖然股價仍在均線上方，但 RSI 已達過熱區，短線追價風險偏高。若已持有可續抱觀察；若尚未進場，不建議直接追高，較適合等待回落接近支撐區再分批，新進場需保守。`;
  if (d.belowMa20) return `目前屬於「${state}」。建議觀望、待股價站回均線並確認支撐後再評估，不宜貿然進場。`;
  if (d.nearSupport) return `目前屬於「${state}」。現價接近支撐，可分批布局並嚴設停損；若跌破支撐則先離場觀望。`;
  return `目前屬於「${state}」。可分批觀察、避免追高，並留意均線與量能變化；接近支撐再加碼較穩健。`;
}

/* ---------- K 線（Canvas，支援縮放/拖曳） ---------- */
function drawKline(canvas, bars, view, support, resistance) {
  if (!canvas || !bars || bars.length < 2) return;
  const end = Math.min(bars.length, Math.max(view.count, view.end));
  const start = Math.max(0, end - view.count);
  const data = bars.slice(start, end);
  if (data.length < 1) return;
  const closes = bars.map((b) => b.c);
  const ma5all = smaSeries(closes, 5), ma20all = smaSeries(closes, 20);
  const ma5 = ma5all.slice(start, end), ma20 = ma20all.slice(start, end);
  const lows = data.map((b) => b.l), highs = data.map((b) => b.h), vols = data.map((b) => b.v);

  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 600, cssH = 340;
  canvas.width = cssW * dpr; canvas.height = cssH * dpr;
  const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const padL = 8, padR = 54, padT = 8;
  const priceH = cssH * 0.72, volTop = priceH + 14, volH = cssH - volTop - 16;
  const W = cssW - padL - padR, n = data.length, slot = W / n, bw = Math.max(1.5, slot * 0.62);

  const inclS = support != null, inclR = resistance != null;
  let pMin = Math.min(...lows, inclS ? support : Infinity, inclR ? resistance : Infinity);
  let pMax = Math.max(...highs, inclS ? support : -Infinity, inclR ? resistance : -Infinity);
  const padP = (pMax - pMin) * 0.06 || 1; pMin -= padP; pMax += padP;
  const yP = (v) => padT + (pMax - v) / (pMax - pMin) * (priceH - padT);
  const vMax = Math.max(...vols) || 1, yV = (v) => volTop + (1 - v / vMax) * volH;

  ctx.strokeStyle = "#222834"; ctx.fillStyle = "#8a93a6"; ctx.font = "10px system-ui"; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { const v = pMax - (pMax - pMin) * i / 4, y = yP(v); ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + W, y); ctx.stroke(); ctx.fillText(v.toFixed(1), padL + W + 4, y + 3); }

  ctx.setLineDash([4, 3]);
  if (inclS) { ctx.strokeStyle = "#2ebd6b"; ctx.beginPath(); ctx.moveTo(padL, yP(support)); ctx.lineTo(padL + W, yP(support)); ctx.stroke(); ctx.fillStyle = "#2ebd6b"; ctx.fillText("支撐 " + support.toFixed(1), padL + 2, yP(support) - 3); }
  if (inclR) { ctx.strokeStyle = "#ff7a45"; ctx.beginPath(); ctx.moveTo(padL, yP(resistance)); ctx.lineTo(padL + W, yP(resistance)); ctx.stroke(); ctx.fillStyle = "#ff7a45"; ctx.fillText("壓力 " + resistance.toFixed(1), padL + 2, yP(resistance) + 10); }
  ctx.setLineDash([]);

  data.forEach((b, i) => {
    const x = padL + slot * i + slot / 2, up = b.c >= b.o, col = up ? "#ef4d4d" : "#2ebd6b";
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, yP(b.h)); ctx.lineTo(x, yP(b.l)); ctx.stroke();
    const yo = yP(b.o), yc = yP(b.c), top = Math.min(yo, yc), h = Math.max(1, Math.abs(yc - yo));
    ctx.fillRect(x - bw / 2, top, bw, h);
    ctx.fillRect(x - bw / 2, yV(b.v), bw, volTop + volH - yV(b.v));
  });
  const line = (arr, color) => { ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.beginPath(); let st = false; arr.forEach((v, i) => { if (v == null) return; const x = padL + slot * i + slot / 2, y = yP(v); if (!st) { ctx.moveTo(x, y); st = true; } else ctx.lineTo(x, y); }); ctx.stroke(); };
  line(ma5, "#4da3ff"); line(ma20, "#ffcf4d");
}

function setupKline(wrap, bars, support, resistance) {
  const canvas = wrap.querySelector("canvas");
  const view = { count: Math.min(60, bars.length), end: bars.length };
  const clamp = () => { view.count = Math.max(10, Math.min(bars.length, Math.round(view.count))); view.end = Math.max(view.count, Math.min(bars.length, Math.round(view.end))); };
  const redraw = () => { clamp(); drawKline(canvas, bars, view, support, resistance); const lbl = wrap.querySelector(".kl-range"); if (lbl) lbl.textContent = view.count + " 日"; };
  canvas._redraw = redraw;
  const slot = () => (canvas.clientWidth - 62) / view.count;

  wrap.querySelectorAll("[data-kl]").forEach((btn) => btn.addEventListener("click", () => {
    const a = btn.getAttribute("data-kl");
    if (a === "in") view.count *= 0.7;
    else if (a === "out") view.count *= 1.4;
    else if (a === "reset") { view.count = Math.min(60, bars.length); view.end = bars.length; }
    else view.count = +a;
    redraw();
  }));
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); view.count *= (e.deltaY > 0 ? 1.15 : 0.87); redraw(); }, { passive: false });

  const pts = new Map();
  canvas.addEventListener("pointerdown", (e) => { try { canvas.setPointerCapture(e.pointerId); } catch {} pts.set(e.pointerId, e.clientX); canvas.style.cursor = "grabbing"; });
  canvas.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    if (pts.size === 1) { const prev = pts.get(e.pointerId), db = Math.round((e.clientX - prev) / slot()); if (db !== 0) { view.end -= db; pts.set(e.pointerId, e.clientX); redraw(); } }
    else if (pts.size === 2) { const xs = [...pts.values()], prevSp = Math.abs(xs[0] - xs[1]); pts.set(e.pointerId, e.clientX); const ys = [...pts.values()], sp = Math.abs(ys[0] - ys[1]); if (prevSp > 4 && sp > 4) { view.count *= prevSp / sp; redraw(); } }
  });
  const release = (e) => { pts.delete(e.pointerId); if (!pts.size) canvas.style.cursor = "grab"; };
  canvas.addEventListener("pointerup", release); canvas.addEventListener("pointercancel", release);
  canvas.style.cursor = "grab";
  redraw();
}

/* ---------- 取數 ---------- */
async function analyzeTW(code) {
  const [price, per, info, instRaw, marginRaw, revRaw, finRaw] = await Promise.all([
    fm("TaiwanStockPrice", code, ago(400)),
    fmSafe("TaiwanStockPER", code, ago(30)),
    fmSafe("TaiwanStockInfo", code),
    fmSafe("TaiwanStockInstitutionalInvestorsBuySell", code, ago(12)),
    fmSafe("TaiwanStockMarginPurchaseShortSale", code, ago(15)),
    fmSafe("TaiwanStockMonthRevenue", code, ago(430)),
    fmSafe("TaiwanStockFinancialStatements", code, ago(500)),
  ]);
  if (!price.length) throw new Error(`查無 ${code} 的台股資料，請確認代號`);
  const bars = price.map((d) => ({ date: d.date, o: d.open, h: d.max, l: d.min, c: d.close, v: d.Trading_Volume }));
  const ind = buildIndicators(bars);
  const fund = { pe: null, pb: null, dy: null, eps: null, revYoy: null };
  if (per && per.length) { const p = per[per.length - 1]; fund.pe = num(p.PER); fund.pb = num(p.PBR); fund.dy = num(p.dividend_yield); }
  if (finRaw && finRaw.length) { const eps = finRaw.filter((r) => r.type === "EPS").sort((a, b) => a.date < b.date ? -1 : 1); if (eps.length) { const l4 = eps.slice(-4).map((r) => num(r.value)).filter((x) => x != null); if (l4.length) fund.eps = l4.reduce((a, b) => a + b, 0); } }
  if (revRaw && revRaw.length >= 13) { const s = revRaw.slice().sort((a, b) => a.date < b.date ? -1 : 1); const last = s[s.length - 1]; const y = s.find((r) => r.revenue_month === last.revenue_month && r.revenue_year === last.revenue_year - 1); if (y && y.revenue) fund.revYoy = (last.revenue - y.revenue) / y.revenue * 100; }
  let inst = null;
  if (instRaw && instRaw.length) { const ld = instRaw.reduce((m, r) => r.date > m ? r.date : m, ""); const day = instRaw.filter((r) => r.date === ld); const net = (ns) => day.filter((r) => ns.includes(r.name)).reduce((a, r) => a + (r.buy - r.sell), 0) / 1000; inst = { foreign: net(["Foreign_Investor", "Foreign_Dealer_Self"]), trust: net(["Investment_Trust"]), dealer: net(["Dealer_self", "Dealer_Hedging"]) }; }
  let margin = null;
  if (marginRaw && marginRaw.length) { const m = marginRaw[marginRaw.length - 1]; margin = { marginBal: num(m.MarginPurchaseTodayBalance), marginChg: num(m.MarginPurchaseTodayBalance) - num(m.MarginPurchaseYesterdayBalance), shortBal: num(m.ShortSaleTodayBalance), shortChg: num(m.ShortSaleTodayBalance) - num(m.ShortSaleYesterdayBalance) }; }
  return { market: "TW", symbol: code, name: info && info.length ? info[0].stock_name : code, industry: info && info.length ? info[0].industry_category : null, bars, ind, fund, chip: buildChip(inst, margin, "TW"), lastDate: bars[bars.length - 1].date, rows: bars.length, source: "FinMind 股價資料（TaiwanStockPrice）" };
}
async function analyzeUS(sym) {
  const price = await fm("USStockPrice", sym, ago(400));
  if (!price.length) throw new Error(`查無 ${sym} 的美股資料，請確認代號`);
  const bars = price.map((d) => ({ date: d.date, o: d.Open, h: d.High, l: d.Low, c: d.Close, v: d.Volume }));
  const ind = buildIndicators(bars);
  return { market: "US", symbol: sym.toUpperCase(), name: sym.toUpperCase(), industry: null, bars, ind, fund: { pe: null, pb: null, dy: null, eps: null, revYoy: null }, chip: buildChip(null, null, "US"), lastDate: bars[bars.length - 1].date, rows: bars.length, source: "FinMind 股價資料（USStockPrice）" };
}

/* ---------- 持股損益 ---------- */
function holdingPnl(price, cost, qty) {
  if (!cost || !qty || !price) return null;
  const ret = (price - cost) / cost * 100, pnl = (price - cost) * qty;
  let suggestion = "續抱觀察"; const notes = [];
  if (ret <= -15) { suggestion = "注意停損"; notes.push(`目前虧損 ${fmt(ret, 1)}%，檢視基本面是否轉壞並嚴設停損`); }
  else if (ret >= 30) { suggestion = "可考慮部分停利"; notes.push(`目前獲利 ${fmt(ret, 1)}%，可部分停利、續抱核心`); }
  else notes.push("報酬在合理區間，續抱觀察");
  return { cost, qty, marketValue: price * qty, ret, pnl, suggestion, notes };
}

/* ---------- 主流程 ---------- */
async function analyze(symbol, market, cost, qty) {
  symbol = String(symbol || "").trim().toUpperCase();
  const card = document.createElement("div"); card.className = "card result";
  card.innerHTML = `<div class="muted">分析 ${esc(market)} ${esc(symbol)} 中…</div>`;
  $("results").prepend(card);
  if (market === "TW" && !TW_RE.test(symbol)) { card.innerHTML = `<div class="err">⚠️ 台股代號格式不正確（例 2330）</div>`; return; }
  if (market === "US" && !US_RE.test(symbol)) { card.innerHTML = `<div class="err">⚠️ 美股代號格式不正確（例 AAPL）</div>`; return; }
  try {
    const a = market === "TW" ? await analyzeTW(symbol) : await analyzeUS(symbol);
    a.decision = decide(a.ind, a.fund, a.market);
    a.holding = holdingPnl(a.ind.close, parseFloat(cost) || null, parseFloat(qty) || null);
    card.innerHTML = renderResult(a);
    const wrap = card.querySelector(".kline-wrap");
    if (wrap) setupKline(wrap, a.bars, a.ind.support, a.ind.resistance);
  } catch (e) {
    card.innerHTML = `<div class="err">⚠️ ${esc(e.message || "分析失敗")}</div><p class="muted">若為流量限制，請稍後再試。</p>`;
  }
}

function renderResult(a) {
  const { ind: i, fund: f, decision: d, market: m } = a;
  const actCls = (d.action === "可分批觀察" || d.action === "可小量布局") ? "good" : (d.action === "不建議追高" || d.action === "風險偏高") ? "bad" : "neutral";

  const header = `<div class="rhead">
      <h3>${esc(a.name)} <span class="code">${esc(a.symbol)}</span>${a.industry ? ` <span class="muted">· ${esc(a.industry)}</span>` : ""}</h3>
      <div class="price">${fmt(i.close)} <span>${pct(i.change_pct)}</span></div>
    </div>
    <div class="sumbadges"><span class="badge ${actCls}">${esc(d.action)}</span><span>信心 <b>${d.score}</b>/100</span><span>風險 <b>${esc(d.risk)}</b></span><span>位置 <b>${esc(d.position)}</b></span></div>`;

  let hold = "";
  if (a.holding) { const h = a.holding, cls = h.ret >= 0 ? "pnl-up" : "pnl-down"; hold = `<div class="holding"><b>💼 我的持股</b>　成本 ${fmt(h.cost)}　股數 ${fmt(h.qty, 0)}　市值 ${fmt(h.marketValue)}　<span class="${cls}">報酬 ${fmt(h.ret)}%／損益 ${fmt(h.pnl)}</span>　建議：<b>${esc(h.suggestion)}</b></div>`; }

  const decision = `<div class="block decision"><h4>① 投資決策摘要</h4>
      <p>建議：<b>${esc(d.action)}</b>　｜信心分數：${d.score}/100　｜風險等級：${esc(d.risk)}　｜目前位置：${esc(d.position)}</p>
      <p class="op">${esc(d.operation)}</p></div>`;

  const fundList = m === "TW" ? [
    `EPS（近四季合計）：${f.eps != null ? fmt(f.eps, 2) : "資料不足"}`,
    `本益比 P/E：${f.pe != null ? fmt(f.pe, 1) : "資料不足"}`, `股價淨值比 P/B：${f.pb != null ? fmt(f.pb, 2) : "資料不足"}`,
    `殖利率：${f.dy != null ? fmt(f.dy, 2) + "%" : "資料不足"}`, `營收成長率（YoY）：${f.revYoy != null ? (f.revYoy >= 0 ? "+" : "") + fmt(f.revYoy, 1) + "%" : "資料不足"}`,
  ] : ["EPS：資料不足", "本益比 P/E：資料不足", "股價淨值比 P/B：資料不足", "殖利率：資料不足", "營收成長率（YoY）：資料不足"];
  const fundamental = `<div class="block"><h4>② 基本面　<small>買什麼公司</small></h4>${ul(fundList)}<p class="exp">${esc(fundamentalExplain(f, m))}</p></div>`;

  const volTxt = i.volRatio != null ? `今量為 20 日均量 ${fmt(i.volRatio, 2)} 倍` : "資料不足";
  const techList = [`MA5：${fmt(i.ma5)}　MA10：${fmt(i.ma10)}`, `MA20：${fmt(i.ma20)}　MA60：${fmt(i.ma60)}`,
    `RSI：${i.rsi == null ? "—" : fmt(i.rsi, 0) + (i.rsi >= 70 ? "（過熱）" : i.rsi <= 30 ? "（偏弱）" : "（健康）")}`,
    `支撐：${fmt(i.support)}　壓力：${fmt(i.resistance)}`, `成交量變化：${volTxt}`];
  const technical = `<div class="block"><h4>③ 技術面　<small>什麼時候買賣</small></h4>${ul(techList)}<p class="exp">${esc(technicalExplain(i))}</p></div>`;

  let chipBody;
  if (a.chip.ok) { const c = a.chip, it = [];
    if (c.foreign != null) it.push(`三大法人（張）：外資 ${signed(c.foreign)}、投信 ${signed(c.trust)}、自營商 ${signed(c.dealer)}`);
    if (c.marginBal != null) it.push(`融資餘額：${thou(c.marginBal)} 張（增減 ${signed(c.marginChg)}）`);
    if (c.shortBal != null) it.push(`融券餘額：${thou(c.shortBal)} 張（增減 ${signed(c.shortChg)}）`);
    chipBody = ul(it) + `<p class="exp">${esc(c.explain)}</p>`;
  } else chipBody = `<p>${esc(a.chip.note)}</p><p class="exp">${esc(a.chip.explain)}</p>`;
  const chip = `<div class="block"><h4>④ 籌碼面　<small>看主力動向</small></h4>${chipBody}</div>`;

  const kline = `<div class="block kline-wrap"><h4>⑤ K 線圖　<small>近 60 日 · 滾輪縮放 / 拖曳平移</small></h4>
      <div class="kl-tools"><button data-kl="in">＋ 放大</button><button data-kl="out">－ 縮小</button><button data-kl="reset">⟲ 重設</button>
        <button data-kl="30">30日</button><button data-kl="60">60日</button><button data-kl="120">120日</button><span class="kl-range"></span></div>
      <canvas class="kline"></canvas>
      <div class="legend"><span class="lg up">紅 漲</span><span class="lg dn">綠 跌</span><span class="lg ma5">MA5</span><span class="lg ma20">MA20</span><span class="lg sup">支撐</span><span class="lg res">壓力</span></div></div>`;

  const buy = `<div class="block buy"><h4>⑥ 為什麼可以買 / 偏多理由</h4>${ul(buyReasons(i, f, d, m, a.chip))}</div>`;
  const nobuy = `<div class="block nobuy"><h4>⑦ 為什麼不建議買 / 風險理由</h4>${ul(avoidReasons(i, f, d, m, a.chip))}</div>`;
  const z = priceZones(i);
  const zones = `<div class="block"><h4>⑧ 價格區間 / 進場參考</h4>${z ? `<pre class="zones">${esc(z)}</pre>` : "<p>資料不足</p>"}</div>`;
  const concl = `<div class="block conclusion"><h4>⑨ 結論</h4><p>${esc(conclusion(i, d))}</p></div>`;

  // ⑩ 資料來源與更新時間
  const lag = daysBetween(a.lastDate);
  const recent = lag <= 4;
  const delayWarn = recent ? "" : `<p class="warn">⚠ 資料可能延遲，請以證交所、NASDAQ/NYSE 或券商報價為準。</p>`;
  const srcList = [`資料來源：${esc(a.source)}`, `最新資料日期：${esc(a.lastDate)}`, `最新收盤價：${fmt(i.close)}`,
    `資料筆數：${a.rows} 筆`, `是否為最近交易日資料：${recent ? "是（" + lag + " 天內）" : "否（距今約 " + lag + " 天）"}`];
  const source = `<div class="block source"><h4>⑩ 資料來源與更新時間</h4>${ul(srcList)}${delayWarn}
      <p class="exp">K 線圖資料來源：FinMind 股價資料；K 線為前端 Canvas 即時繪製，非圖片、非 AI 生成。</p>
      <p class="exp">此版本為純前端版本，資料以 FinMind 為主，<b>未進行雙來源（TWSE / Yahoo / Finnhub）交叉驗證</b>。</p></div>`;

  return header + hold + decision +
    `<div class="aspects">${fundamental}${technical}${chip}</div>` + kline +
    `<div class="aspects two">${buy}${nobuy}</div>` + zones + concl + source +
    `<p class="disc">以上為公開資料整理與技術指標，僅供研究，不構成投資建議。</p>`;
}

/* ---------- resize 重繪 K 線 ---------- */
let rzT; window.addEventListener("resize", () => { clearTimeout(rzT); rzT = setTimeout(() => { document.querySelectorAll(".kline").forEach((cv) => { if (cv._redraw) cv._redraw(); }); }, 150); });

/* ---------- 事件 ---------- */
document.querySelectorAll(".feature").forEach((b) => b.addEventListener("click", () => { const t = $(b.getAttribute("data-goto")); if (t) { t.scrollIntoView({ behavior: "smooth", block: "start" }); const inp = t.querySelector("input,select"); if (inp) setTimeout(() => inp.focus(), 300); } }));
$("go").addEventListener("click", () => { const s = $("symbol").value.trim(); if (s) analyze(s, $("market").value, $("cost").value.trim(), $("qty").value.trim()); });
$("symbol").addEventListener("keydown", (e) => { if (e.key === "Enter") $("go").click(); });
$("save").addEventListener("click", () => { const s = $("symbol").value.trim().toUpperCase(); if (!s) return; const m = $("market").value, cost = parseFloat($("cost").value) || null, qty = parseFloat($("qty").value) || null; const list = getHoldings().filter((h) => !(h.symbol === s && h.market === m)); list.push({ symbol: s, market: m, cost, qty }); setHoldings(list); });
$("holdings").addEventListener("click", (e) => { const del = e.target.getAttribute("data-del"); if (del) { const [m, s] = del.split(":"); setHoldings(getHoldings().filter((h) => !(h.market === m && h.symbol === s))); return; } const a = e.target.closest("a"); if (a) { e.preventDefault(); const m = a.getAttribute("data-m"), s = a.getAttribute("data-s"); const h = getHoldings().find((x) => x.market === m && x.symbol === s) || {}; analyze(s, m, h.cost, h.qty); } });
$("analyzeAll").addEventListener("click", () => getHoldings().forEach((h) => analyze(h.symbol, h.market, h.cost, h.qty)));
$("clearAll").addEventListener("click", () => { if (confirm("清空我的持股？")) setHoldings([]); });

renderHoldings();
