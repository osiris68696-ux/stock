"use strict";
/* 台美股智慧分析 — GitHub Pages 純前端
 * 安全：固定資料來源 FinMind 開放 API（免金鑰）；不使用 eval/exec；不接受使用者自訂 URL；
 * 持股只存 localStorage；無 .env / Token / Chat ID / 私人持股；K 線為 Canvas 即時繪製（非圖片、非 AI）。
 * FinMind 匿名僅日線（盤中/逐筆需付費等級），故價格一律標示「最新收盤價」，不偽裝即時報價。
 */
const LS_KEY = "twus_holdings";
const FINMIND = "https://api.finmindtrade.com/api/v4/data";   // 唯一允許的資料網域
const TW_RE = /^[0-9]{4,6}$/;
const US_RE = /^[A-Za-z]{1,10}$/;
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
  const seg = [];
  if (overheated) seg.push(`目前 RSI ${fmt(r, 0)} 短線過熱`); else if (r != null && r <= 30) seg.push(`RSI ${fmt(r, 0)} 偏低、短線超賣`);
  if (trendUp) seg.push("均線多頭排列、趨勢偏多"); else if (belowMa20) seg.push("股價跌破月線、趨勢轉弱"); else seg.push("趨勢中性");
  let advise;
  if (overheated) advise = "短線追價風險高；若已持有可續抱觀察，若尚未進場，建議等待回落接近支撐區再分批，新進場宜保守";
  else if (belowMa20) advise = "方向未明，建議先觀望、待股價站回均線再評估";
  else if (nearSupport) advise = "股價接近支撐，可分批布局並嚴設停損，避免單筆重壓";
  else if (nearResistance) advise = "股價接近壓力，不宜追高，可待回測支撐區再進場";
  else advise = "可分批觀察、避免單筆重壓，並留意均線與量能變化";
  return { position, score, risk, action, operation: seg.join("，") + "；" + advise + "。", trendUp, overheated, belowMa20, nearSupport, nearResistance, farFromMa20 };
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
    return { ok: false, note: market === "TW" ? "籌碼面資料不足，純前端版本目前無法完整取得三大法人與融資融券資料。" : "美股無台股式三大法人 / 融資融券制度，純前端版籌碼面資料不足。",
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
    const x = padL + slot * i + slot / 2, up = b.c >= b.o, col = up ? "#ef4d4d" : "#2ebd6b";
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
function setupKline(wrap, bars, support, resistance, initial, defaultCount) {
  const canvas = wrap.querySelector("canvas");
  const view = { count: Math.min(defaultCount || 60, bars.length), end: bars.length };
  if (initial) { view.count = Math.min(bars.length, Math.max(10, initial.count || 60)); view.end = Math.max(view.count, Math.min(bars.length, bars.length - (initial.endOffset || 0))); }
  canvas._view = view; canvas._barsLen = bars.length;
  const clamp = () => { view.count = Math.max(10, Math.min(bars.length, Math.round(view.count))); view.end = Math.max(view.count, Math.min(bars.length, Math.round(view.end))); };
  const redraw = () => { clamp(); drawKline(canvas, bars, view, support, resistance); const l = wrap.querySelector(".kl-range"); if (l) l.textContent = view.count + " 日"; };
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

/* ---------- 浮動股價：自動更新（全域單一 timer） ---------- */
let GTIMER = null;
function stopAuto() { if (GTIMER) { clearInterval(GTIMER); GTIMER = null; } }
function setAuto(card, ms) {
  stopAuto();
  if (ms > 0) GTIMER = setInterval(() => { if (!document.body.contains(card)) { stopAuto(); return; } refreshCard(card); }, ms);
}
window.addEventListener("beforeunload", stopAuto);

/* ---------- 主流程 ---------- */
async function analyze(symbol, market, cost, qty) {
  symbol = String(symbol || "").trim().toUpperCase();
  stopAuto();                                   // 重新分析 → 清掉舊 timer
  const card = document.createElement("div"); card.className = "card result";
  card.innerHTML = `<div class="muted">分析 ${esc(market)} ${esc(symbol)} 中…</div>`;
  $("results").prepend(card);
  if (market === "TW" && !TW_RE.test(symbol)) { card.innerHTML = `<div class="err">⚠️ 台股代號格式不正確（例 2330）</div>`; return; }
  if (market === "US" && !US_RE.test(symbol)) { card.innerHTML = `<div class="err">⚠️ 美股代號格式不正確（例 AAPL）</div>`; return; }
  card._params = { symbol, market, cost: parseFloat(cost) || null, qty: parseFloat(qty) || null };
  card._autoVal = "off"; card._lastClose = null;
  await refreshCard(card, true);
}

async function refreshCard(card, isFirst) {
  const p = card._params;
  const s = card.querySelector(".upd-status"); if (s) s.textContent = "更新中…";
  try {
    const a = p.market === "TW" ? await analyzeTW(p.symbol) : await analyzeUS(p.symbol);
    a.decision = decide(a.ind, a.fund, a.market);
    a.holding = holdingPnl(a.ind.close, p.cost, p.qty);
    let initView = null;
    const oldCv = card.querySelector(".kline canvas, canvas.kline");
    if (oldCv && oldCv._view) initView = { count: oldCv._view.count, endOffset: oldCv._barsLen - oldCv._view.end };
    const prevClose = card._lastClose;
    card.innerHTML = renderResult(a, { updatedAt: nowStamp(), autoVal: card._autoVal });
    card._lastClose = a.ind.close;
    const wrap = card.querySelector(".kline-wrap");
    if (wrap) setupKline(wrap, a.bars, a.ind.support, a.ind.resistance, initView);
    setupCardControls(card);
    if (!isFirst && prevClose != null && a.ind.close != null && a.ind.close !== prevClose) flashPrice(card, a.ind.close > prevClose);
  } catch (e) {
    if (e.message === "EMPTY") { const msg = "查無最新股價資料，請確認股票代號或稍後再試。"; isFirst ? (card.innerHTML = `<div class="err">⚠️ ${msg}</div>`) : setUpdErr(card, msg); }
    else { const msg = isFirst ? "資料更新失敗，請稍後重試。" : "更新失敗，請稍後再試。"; isFirst ? (card.innerHTML = `<div class="err">⚠️ ${esc(e.message || msg)}</div>`) : setUpdErr(card, msg); }
  }
}
function setUpdErr(card, msg) { const s = card.querySelector(".upd-status"); if (s) { s.textContent = msg; s.classList.add("upd-err"); } }
function flashPrice(card, up) { const px = card.querySelector(".px"); if (!px) return; px.classList.remove("flash-up", "flash-down"); void px.offsetWidth; px.classList.add(up ? "flash-up" : "flash-down"); setTimeout(() => px.classList.remove("flash-up", "flash-down"), 800); }

function setupCardControls(card) {
  const btn = card.querySelector(".upd-btn"); if (btn) btn.addEventListener("click", () => refreshCard(card));
  const sel = card.querySelector(".upd-auto");
  if (sel) { sel.value = card._autoVal; sel.addEventListener("change", () => { card._autoVal = sel.value; const ms = { off: 0, "30": 30000, "60": 60000, "300": 300000 }[sel.value] || 0; setAuto(card, ms); }); }
}

function renderResult(a, meta) {
  const { ind: i, fund: f, decision: d, market: m } = a;
  const actCls = (d.action === "可分批觀察" || d.action === "可小量布局") ? "good" : (d.action === "不建議追高" || d.action === "風險偏高") ? "bad" : "neutral";
  const dir = i.change_pct == null ? "" : i.change_pct >= 0 ? "px-up" : "px-down";
  const lag = daysBetween(a.lastDate), recent = lag <= 4;
  const statusTxt = recent ? "正常" : "可能延遲";

  const header = `<div class="rhead"><h3>${esc(a.name)} <span class="code">${esc(a.symbol)}</span>${a.industry ? ` <span class="muted">· ${esc(a.industry)}</span>` : ""}</h3></div>
    <div class="ticker"><span class="px ${dir}">${fmt(i.close)}</span><span class="chg ${dir}">${pct(i.change_pct)}</span></div>
    <div class="updbar">
      <div class="updctrls">
        <button class="upd-btn"><span aria-hidden="true">↻</span> 更新價格</button>
        <label class="autolbl">自動更新
          <select class="upd-auto"><option value="off">關閉</option><option value="30">每 30 秒</option><option value="60">每 1 分</option><option value="300">每 5 分</option></select>
        </label>
      </div>
      <div class="updmeta"><span class="upd-status">最後更新：${esc(meta.updatedAt)}</span>｜資料日：${esc(a.lastDate)}｜價格類型：${PRICE_TYPE}｜資料狀態：${statusTxt}</div>
    </div>
    <p class="px-note">目前價格以 FinMind 最新可取得資料為準，可能不是即時逐筆報價。</p>
    ${recent ? "" : `<p class="warn">⚠ 資料可能延遲，請以證交所、NASDAQ/NYSE 或券商報價為準。</p>`}
    <div class="sumbadges"><span class="badge ${actCls}">${esc(d.action)}</span><span>信心 <b>${d.score}</b>/100</span><span>風險 <b>${esc(d.risk)}</b></span><span>位置 <b>${esc(d.position)}</b></span></div>`;

  let hold = "";
  if (a.holding) { const h = a.holding, cls = h.ret >= 0 ? "pnl-up" : "pnl-down"; hold = `<div class="holding"><b>💼 我的持股</b>　成本 ${fmt(h.cost)}　股數 ${fmt(h.qty, 0)}　市值 ${fmt(h.marketValue)}　<span class="${cls}">報酬 ${fmt(h.ret)}%／損益 ${fmt(h.pnl)}</span>　建議：<b>${esc(h.suggestion)}</b></div>`; }

  const decision = `<div class="block decision"><h4>① 投資決策摘要</h4><p>建議：<b>${esc(d.action)}</b>　｜信心分數：${d.score}/100　｜風險等級：${esc(d.risk)}　｜目前位置：${esc(d.position)}</p><p class="op">${esc(d.operation)}</p></div>`;

  const fundList = m === "TW" ? [
    `EPS（近四季合計）：${f.eps != null ? fmt(f.eps, 2) : "資料不足"}`, `本益比 P/E：${f.pe != null ? fmt(f.pe, 1) : "資料不足"}`, `股價淨值比 P/B：${f.pb != null ? fmt(f.pb, 2) : "資料不足"}`,
    `殖利率：${f.dy != null ? fmt(f.dy, 2) + "%" : "資料不足"}`, `營收成長率（YoY）：${f.revYoy != null ? (f.revYoy >= 0 ? "+" : "") + fmt(f.revYoy, 1) + "%" : "資料不足"}`,
  ] : ["EPS：資料不足", "本益比 P/E：資料不足", "股價淨值比 P/B：資料不足", "殖利率：資料不足", "營收成長率（YoY）：資料不足"];
  const fundamental = `<div class="block"><h4>② 基本面　<small>買什麼公司</small></h4>${ul(fundList)}<p class="exp">${esc(fundamentalExplain(f, m))}</p></div>`;

  const volTxt = i.volRatio != null ? `今量為 20 日均量 ${fmt(i.volRatio, 2)} 倍` : "資料不足";
  const techList = [`MA5：${fmt(i.ma5)}　MA10：${fmt(i.ma10)}`, `MA20：${fmt(i.ma20)}　MA60：${fmt(i.ma60)}`, `RSI：${i.rsi == null ? "—" : fmt(i.rsi, 0) + (i.rsi >= 70 ? "（過熱）" : i.rsi <= 30 ? "（偏弱）" : "（健康）")}`, `支撐：${fmt(i.support)}　壓力：${fmt(i.resistance)}`, `成交量變化：${volTxt}`];
  const technical = `<div class="block"><h4>③ 技術面　<small>什麼時候買賣</small></h4>${ul(techList)}<p class="exp">${esc(technicalExplain(i))}</p></div>`;

  let chipBody;
  if (a.chip.ok) { const c = a.chip, it = [];
    if (c.foreign != null) it.push(`三大法人（張）：外資 ${signed(c.foreign)}、投信 ${signed(c.trust)}、自營商 ${signed(c.dealer)}`);
    if (c.marginBal != null) it.push(`融資餘額：${thou(c.marginBal)} 張（增減 ${signed(c.marginChg)}）`);
    if (c.shortBal != null) it.push(`融券餘額：${thou(c.shortBal)} 張（增減 ${signed(c.shortChg)}）`);
    chipBody = ul(it) + `<p class="exp">${esc(c.explain)}</p>`;
  } else chipBody = `<p>${esc(a.chip.note)}</p><p class="exp">${esc(a.chip.explain)}</p>`;
  const chip = `<div class="block"><h4>④ 籌碼面　<small>看主力動向</small></h4>${chipBody}</div>`;

  const kline = `<div class="block kline-wrap"><h4>⑤ K 線圖　<small>近 60 日 · 電腦：滾輪縮放／拖曳平移　手機：雙指縮放／單指平移</small></h4>
      <div class="kl-tools"><button data-kl="in">＋ 放大</button><button data-kl="out">－ 縮小</button><button data-kl="reset">⟲ 重設</button><button data-kl="30">30日</button><button data-kl="60">60日</button><button data-kl="120">120日</button><span class="kl-range"></span></div>
      <canvas class="kline"></canvas>
      <div class="legend"><span class="lg up">紅 漲</span><span class="lg dn">綠 跌</span><span class="lg ma5">MA5</span><span class="lg ma20">MA20</span><span class="lg sup">支撐</span><span class="lg res">壓力</span></div></div>`;

  const buy = `<div class="block buy"><h4>⑥ 為什麼可以買 / 偏多理由</h4>${ul(buyReasons(i, f, d, m, a.chip))}</div>`;
  const nobuy = `<div class="block nobuy"><h4>⑦ 為什麼不建議買 / 風險理由</h4>${ul(avoidReasons(i, f, d, m, a.chip))}</div>`;
  const z = priceZones(i);
  const zones = `<div class="block"><h4>⑧ 價格區間 / 進場參考</h4>${z ? `<pre class="zones">${esc(z)}</pre>` : "<p>資料不足</p>"}</div>`;
  const concl = `<div class="block conclusion"><h4>⑨ 結論</h4><p>${esc(conclusion(i, d))}</p></div>`;
  const srcList = [`資料來源：${esc(a.source)}`, `最新資料日期：${esc(a.lastDate)}`, `最新收盤價：${fmt(i.close)}`, `資料筆數：${a.rows} 筆`, `是否為最近交易日資料：${recent ? "是（" + lag + " 天內）" : "否（距今約 " + lag + " 天）"}`, `價格類型：${PRICE_TYPE}`];
  const source = `<div class="block source"><h4>⑩ 資料來源與更新時間</h4>${ul(srcList)}${recent ? "" : `<p class="warn">⚠ 資料可能延遲，請以證交所、NASDAQ/NYSE 或券商報價為準。</p>`}
      <p class="exp">K 線圖資料來源：FinMind 股價資料；K 線為前端 Canvas 即時繪製，非圖片、非 AI 生成。</p>
      <p class="exp">此版本為純前端版本，資料以 FinMind 為主，<b>未進行雙來源（TWSE / Yahoo / Finnhub）交叉驗證</b>。</p></div>`;

  return header + hold + decision + `<div class="aspects">${fundamental}${technical}${chip}</div>` + kline + `<div class="aspects two">${buy}${nobuy}</div>` + zones + concl + source + `<p class="disc">以上為公開資料整理與技術指標，僅供研究，不構成投資建議。</p>`;
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
function setGoldAuto(ms) { stopGoldAuto(); if (ms > 0) GOLD_TIMER = setInterval(() => { if (!$("gold")) { stopGoldAuto(); return; } refreshGold(); }, ms); }
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
    if (wrap) setupKline(wrap, g.bars, g.ind.support, g.ind.resistance, initView, Math.min(252, g.bars.length));
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
    chart = `<div class="block kline-wrap"><h4>⑤ 歷年金價圖　<small>美元黃金期貨 · 電腦：滾輪縮放／拖曳　手機：雙指縮放／單指平移</small></h4>
      <div class="kl-tools"><button data-kl="in">＋ 放大</button><button data-kl="out">－ 縮小</button><button data-kl="reset">⟲ 重設</button>
        <button data-kl="21">1M</button><button data-kl="63">3M</button><button data-kl="126">6M</button><button data-kl="252">1Y</button><button data-kl="756">3Y</button><button data-kl="1260">5Y</button><button data-kl="max">Max</button><span class="kl-range"></span></div>
      <canvas class="kline"></canvas>
      <div class="legend"><span class="lg up">紅 漲</span><span class="lg dn">綠 跌</span><span class="lg ma5">MA5</span><span class="lg ma20">MA20</span><span class="lg sup">支撐</span><span class="lg res">壓力</span></div>
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
let rzT; window.addEventListener("resize", () => { clearTimeout(rzT); rzT = setTimeout(() => { document.querySelectorAll(".kline").forEach((cv) => { if (cv._redraw) cv._redraw(); }); }, 150); });

/* ---------- 事件 ---------- */
function ensureGold() { if (!$("goldBody").querySelector(".gold-result")) loadGold(); }
function goldEntry() { $("gold").scrollIntoView({ behavior: "smooth", block: "start" }); ensureGold(); }
document.querySelectorAll(".feature").forEach((b) => b.addEventListener("click", () => { const id = b.getAttribute("data-goto"); const t = $(id); if (t) { t.scrollIntoView({ behavior: "smooth", block: "start" }); if (id === "gold") { ensureGold(); return; } const inp = t.querySelector("input,select"); if (inp) setTimeout(() => inp.focus(), 300); } }));
function scrollFocus(secId, inpId) { $(secId).scrollIntoView({ behavior: "smooth", block: "start" }); setTimeout(() => { const i = $(inpId); if (i) i.focus(); }, 320); }
document.querySelectorAll("[data-act]").forEach((el) => {
  const handler = () => {
    const act = el.getAttribute("data-act");
    if (act === "twnews") scrollFocus("twnews", "tw-news-sym");
    else if (act === "usnews") scrollFocus("usnews", "us-news-sym");
    else if (act === "gold") goldEntry();
  };
  el.addEventListener("click", handler);
  el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handler(); } });
});
{ const gl = $("goldLoad"); if (gl) gl.addEventListener("click", loadGold); }

/* ---------- 新聞外部搜尋（只開外部分頁，不 fetch 新聞 API） ---------- */
function openSearch(url) { window.open(url, "_blank", "noopener,noreferrer"); }
function gNews(q, lang) { return "https://news.google.com/search?q=" + encodeURIComponent(q) + "&hl=" + lang; }
document.querySelectorAll("[data-news]").forEach((btn) => btn.addEventListener("click", () => {
  const mkt = btn.getAttribute("data-news"), kind = btn.getAttribute("data-kind");
  if (mkt === "tw") {
    const s = $("tw-news-sym").value.trim();
    if (!TW_RE.test(s)) { toast("請輸入有效台股代號，例如 2330、2454、2317。"); return; }
    if (kind === "news") openSearch(gNews(s + " 台股 新聞", "zh-TW"));
    else if (kind === "fin") openSearch(gNews(s + " 財報 基本面", "zh-TW"));
    else if (kind === "chip") openSearch(gNews(s + " 外資 投信 自營商 融資 融券", "zh-TW"));
    else openSearch("https://tw.stock.yahoo.com/quote/" + encodeURIComponent(s));
  } else {
    const s = $("us-news-sym").value.trim().toUpperCase();
    if (!US_NEWS_RE.test(s)) { toast("請輸入有效美股代號，例如 AAPL、NVDA、MSFT。"); return; }
    if (kind === "news") openSearch(gNews(s + " stock news", "en-US"));
    else if (kind === "fin") openSearch(gNews(s + " earnings financials", "en-US"));
    else if (kind === "analyst") openSearch(gNews(s + " analyst rating target price", "en-US"));
    else openSearch("https://finance.yahoo.com/quote/" + encodeURIComponent(s));
  }
}));
$("go").addEventListener("click", () => { const s = $("symbol").value.trim(); if (s) analyze(s, $("market").value); });
$("symbol").addEventListener("keydown", (e) => { if (e.key === "Enter") $("go").click(); });
$("save").addEventListener("click", () => { const s = $("h-symbol").value.trim().toUpperCase(); if (!s) return; const m = $("h-market").value, cost = parseFloat($("cost").value) || null, qty = parseFloat($("qty").value) || null; const list = getHoldings().filter((h) => !(h.symbol === s && h.market === m)); list.push({ symbol: s, market: m, cost, qty }); setHoldings(list); });
$("h-symbol").addEventListener("keydown", (e) => { if (e.key === "Enter") $("save").click(); });
$("holdings").addEventListener("click", (e) => { const del = e.target.getAttribute("data-del"); if (del) { const [m, s] = del.split(":"); setHoldings(getHoldings().filter((h) => !(h.market === m && h.symbol === s))); return; } const a = e.target.closest("a"); if (a) { e.preventDefault(); const m = a.getAttribute("data-m"), s = a.getAttribute("data-s"); const h = getHoldings().find((x) => x.market === m && x.symbol === s) || {}; analyze(s, m, h.cost, h.qty); } });
$("analyzeAll").addEventListener("click", () => { const list = getHoldings(); if (!list.length) { toast("尚未加入持股，請先在上方加入持股。"); return; } list.forEach((h) => analyze(h.symbol, h.market, h.cost, h.qty)); });
$("clearAll").addEventListener("click", () => { if (confirm("清空我的持股？")) setHoldings([]); });

renderHoldings();
