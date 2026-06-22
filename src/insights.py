"""把投資論點知識庫 (config/insights.json) 與即時數據合成為敘述式個股分析。

每檔產生：推薦等級(★)、推薦理由、風險因素、產業趨勢、外資動向(台股)、
最近財報(美股)、法說/財報重點、未來催化劑、結論。
不足 100 字者由 main 過濾掉，不列入推薦 (避免只剩排名)。
本模組只整理既有數據與知識庫，不對外連線、不下買賣指令。
"""
from __future__ import annotations

import json
import logging
from typing import Optional

import industry_trend_engine
import security

logger = logging.getLogger(__name__)


def load_insights(path: str) -> dict:
    try:
        security.validate_read_path(path)
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        logger.info("已載入投資論點知識庫：stocks %d、sectors %d。",
                    len(data.get("stocks", {})), len(data.get("sectors", {})))
        return data
    except Exception as exc:
        logger.warning("讀取 insights.json 失敗：%s", exc)
        return {"sectors": {}, "stocks": {}}


def _pctv(v) -> str:
    return "資料不足" if v is None else f"{v:+.0f}%"


def _num(v, digits=1) -> str:
    return "資料不足" if v is None else f"{v:.{digits}f}"


def _stars(composite: float) -> int:
    if composite >= 8.5:
        return 5
    if composite >= 7.5:
        return 4
    if composite >= 6.5:
        return 3
    if composite >= 5.5:
        return 2
    return 1


def _conclusion(reco: dict, fund: dict, regime: str) -> str:
    pe = fund.get("pe")
    eg = fund.get("eps_growth_pct") or 0
    up = fund.get("target_upside_pct")
    rsi = (reco.get("data") or {}).get("rsi")
    overheated = rsi is not None and rsi >= 70
    cheap = pe is not None and pe <= 20
    overpriced = (pe is not None and pe >= 35) or (up is not None and up < 0)
    strong_growth = eg >= 20

    if regime == "Risk-Off":
        return "觀察（避險環境，宜小量分批或等回檔，暫不追高）"
    if overheated or overpriced:
        return "暫不追高（短線過熱 / 估值偏貴，待回檔靠近均線再分批）"
    if cheap and eg >= 10:
        return "可分批（估值合理、成長明確，適合零股長期布局）"
    if strong_growth:
        return "中性偏多（成長動能強，逢回分批、避免追高）"
    return "觀察（可納入零股長期布局觀察清單，分批為宜）"


def _fundamentals_block(fund: dict, market: str) -> list:
    """基本面分析：營收趨勢 / EPS 趨勢 / P/E·PEG / 毛利率。資料不足明確標示。"""
    lines = []
    # 營收趨勢
    ry = fund.get("revenue_yoy_pct")
    rc = fund.get("revenue_cum_yoy_pct")
    if ry is not None:
        basis = "官方月營收 YoY" if (market == "TW" and fund.get("revenue_yoy_basis")) else "最近一季營收 YoY"
        extra = f"、累計 YoY {rc:+.0f}%" if rc is not None else ""
        lines.append(f"營收趨勢：{basis} {ry:+.0f}%{extra}")
    else:
        lines.append("營收趨勢：資料不足")
    # EPS 趨勢
    eg = fund.get("eps_growth_pct")
    trend = fund.get("eps_trend")
    if eg is not None or (trend and "資料不足" not in trend):
        lines.append(f"EPS 趨勢：最近一季 YoY {_pctv(eg)}；{trend or '資料不足'}")
    else:
        lines.append("EPS 趨勢：資料不足")
    # P/E · PEG
    pe, fpe, peg = fund.get("pe"), fund.get("forward_pe"), fund.get("peg")
    lines.append(f"本益比 / PEG：P/E {_num(pe)} → 預估 {_num(fpe)}；PEG {_num(peg, 2)}")
    # ROE
    roe = fund.get("roe_pct")
    lines.append(f"ROE：{roe:.1f}%" if roe is not None else "ROE：資料不足")
    # 殖利率
    dy = fund.get("dividend_yield")
    lines.append(f"殖利率：{dy:.1f}%" if dy is not None else "殖利率：資料不足")
    # 毛利率 / 獲利能力
    pm = fund.get("profit_margin_pct")
    lines.append(f"獲利能力：淨利率 {pm:.1f}%" if pm is not None else "獲利能力：毛利率 / 淨利率資料不足")
    return lines


def _ma_pos(label: str, dist):
    if dist is None:
        return f"{label} 資料不足"
    return f"{'站上' if dist >= 0 else '跌破'}{label}（{dist:+.1f}%）"


def _technical_block(d: dict) -> list:
    """技術面：MA5/10/20/60、支撐 / 壓力、RSI、追價 vs 觀察。"""
    rsi = d.get("rsi")
    ma_line = (f"MA5 {_num(d.get('ma5'))} / MA10 {_num(d.get('ma10'))} / "
               f"MA20 {_num(d.get('ma20'))} / MA60 {_num(d.get('ma60'))} / MA200 {_num(d.get('ma200'))}")
    pos = "、".join([_ma_pos("20MA", d.get("dist_ma20_pct")),
                    _ma_pos("50MA", d.get("dist_ma50_pct")),
                    _ma_pos("200MA", d.get("dist_ma200_pct"))])
    sr = f"支撐 {_num(d.get('support'))} / 壓力 {_num(d.get('resistance'))}（近20日低 / 高）"
    mh = d.get("macd_hist")
    macd_str = ("資料不足" if d.get("macd") is None
                else f"DIF {_num(d.get('macd'), 2)} / DEA {_num(d.get('macd_signal'), 2)}、"
                     f"柱狀 {_num(mh, 2)}（{'多方' if (mh or 0) > 0 else '空方'}）")
    rsi_str = "資料不足" if rsi is None else (f"{rsi:.0f}（過熱）" if rsi >= 70
                                          else (f"{rsi:.0f}（偏弱）" if rsi <= 30 else f"{rsi:.0f}（健康）"))
    dist20 = d.get("dist_ma20_pct")
    if rsi is not None and rsi >= 70:
        verdict = "短線過熱，只適合觀察、不宜追價"
    elif dist20 is not None and dist20 > 8:
        verdict = "已偏離均線，只適合觀察、待回檔"
    elif dist20 is not None and abs(dist20) <= 5:
        verdict = "貼近均線，可分批布局（非一次重壓）"
    else:
        verdict = "中性，分批觀察為宜"
    # 建議停損：近20日支撐 (若低於現價) 否則現價 -10%
    price, sup = d.get("price"), d.get("support")
    if sup and price and sup < price * 0.99:
        stop_str = f"{_num(sup)}（近20日支撐）"
    elif price:
        stop_str = f"{_num(price * 0.90)}（現價 -10%）"
    else:
        stop_str = "資料不足"
    return [f"均線：{ma_line}", f"均線位置：{pos}", f"支撐 / 壓力：{sr}",
            f"建議停損：{stop_str}", f"RSI：{rsi_str}", f"MACD：{macd_str}", f"研判：{verdict}"]


def _chip_block(d: dict) -> str:
    """籌碼面：台股三大法人 + 融資 / 融券；美股以分析師立場替代並標示。"""
    if d.get("market") != "TW":
        fund = d.get("fund") or {}
        rec, n = fund.get("recommendation"), fund.get("analyst_count")
        inst = fund.get("inst_held_pct")
        short = fund.get("short_pct_float")
        parts = []
        parts.append(f"分析師評等 {rec}（{n or 0} 位）" if rec else "分析師評等 資料不足")
        parts.append(f"機構持股 {inst:.0f}%" if inst is not None else "機構持股 資料不足")
        parts.append(f"Short Interest {short:.1f}%（占流通股）" if short is not None else "Short Interest 資料不足")
        return "美股籌碼：" + "、".join(parts)
    f, t, dl = d.get("inst_foreign"), d.get("inst_trust"), d.get("inst_dealer")
    sd = d.get("inst_sell_days") or 0
    parts = [f"外資 {f:+,}" if f is not None else "外資 資料不足",
             f"投信 {t:+,}" if t is not None else "投信 資料不足",
             f"自營商 {dl:+,}" if dl is not None else "自營商 資料不足"]
    chip = "三大法人(張)：" + "、".join(parts)
    if sd >= 3:
        chip += f"（外資連賣 {sd} 天）"
    mg = d.get("margin") or {}
    mb, sb = mg.get("margin_balance"), mg.get("short_balance")
    mc, sc = mg.get("margin_change"), mg.get("short_change")
    if mb is not None or sb is not None:
        chip += (f"｜融資餘額 {mb:,} 張({mc:+,})" if mb is not None else "｜融資 資料不足")
        chip += (f"、融券餘額 {sb:,} 張({sc:+,})" if sb is not None else "、融券 資料不足")
    else:
        chip += "｜融資券資料不足"
    return chip


def _mgmt_focus(name: str, symbol: str, fund: dict, catalysts: list, headlines: list) -> str:
    parts = []
    ry, eg = fund.get("revenue_yoy_pct"), fund.get("eps_growth_pct")
    if ry is not None or eg is not None:
        parts.append(f"最近一季營收 YoY {_pctv(ry)}、EPS YoY {_pctv(eg)}")
    if catalysts:
        parts.append("市場關注：" + "、".join(catalysts[:2]))
    rel = [h for h in (headlines or [])
           if (name and name in (h.get("title") or "")) or (symbol and symbol in (h.get("source") or ""))]
    if rel:
        parts.append("近期新聞「" + (rel[0].get("title") or "")[:36] + "」")
    if fund.get("eps_estimate") is not None:
        parts.append(f"市場預估下季 EPS {fund['eps_estimate']:.2f}")
    return "；".join(parts) if parts else "財報 / 法說重點資料不足"


def build_analysis(reco: dict, regime_info: dict, trend: Optional[dict],
                   headlines: list, kb: dict, ctx: dict = None) -> dict:
    """為單一推薦標的組出完整敘述式分析。"""
    d = reco["data"]
    fund = reco.get("fund") or {}
    market = d.get("market")
    cat = d.get("category")
    symbol, name = reco["symbol"], reco["name"]
    regime = regime_info.get("regime", "Neutral")

    stock_kb = (kb.get("stocks") or {}).get(symbol, {})
    sec_kb = (kb.get("sectors") or {}).get(cat, {})

    # --- 推薦理由：論點 + 數據 ---
    reasons = list(stock_kb.get("thesis") or sec_kb.get("thesis") or [])
    pe, fpe = fund.get("pe"), fund.get("forward_pe")
    eg, ry = fund.get("eps_growth_pct"), fund.get("revenue_yoy_pct")
    dy, up = fund.get("dividend_yield"), fund.get("target_upside_pct")
    if eg is not None and eg >= 15:
        reasons.append(f"EPS 預估年增 {eg:.0f}%")
    if ry is not None and ry >= 10:
        reasons.append(f"營收年增 {ry:.0f}%")
    if pe is not None and fpe is not None and 0 < fpe < pe:
        reasons.append(f"Forward P/E {fpe:.1f} 低於現值 {pe:.1f}（獲利看增）")
    elif pe is not None and pe <= 15:
        reasons.append(f"本益比 {pe:.1f} 偏低")
    if dy is not None and dy >= 4:
        reasons.append(f"殖利率 {dy:.1f}%")
    if up is not None and up >= 15:
        reasons.append(f"分析師目標價上檔 {up:.0f}%")

    # --- 風險：論點 + 數據 ---
    risks = list(stock_kb.get("risks") or sec_kb.get("risks") or [])
    rsi = d.get("rsi")
    if rsi is not None and rsi >= 68:
        risks.append(f"RSI {rsi:.0f} 偏高，短線追價風險")
    if pe is not None and pe >= 35 and not d.get("is_etf"):
        risks.append(f"本益比 {pe:.1f} 偏高、估值不便宜")
    if up is not None and up <= -10:
        risks.append(f"現價已高於分析師目標均價約 {abs(up):.0f}%")

    # --- 未來催化劑 ---
    catalysts = list(stock_kb.get("catalysts") or sec_kb.get("catalysts") or [])
    if fund.get("next_earnings"):
        catalysts.append(f"下次財報 {fund['next_earnings']}（留意法說展望）")

    # --- 產業趨勢 (industry_trend_engine：保證不輸出『資料不足』) ---
    ite = industry_trend_engine.industry_trend(
        d.get("category"), d.get("category_name"), symbol, trend, ctx)
    sector_note = stock_kb.get("sector_note") or sec_kb.get("sector_note") or ""
    industry_verdict = ite["verdict"]
    industry_trend = f"【{industry_verdict}】{ite['narrative']}"
    if sector_note and sector_note not in industry_trend:
        industry_trend += f"（{sector_note}）"

    # --- 外資動向 (台股，即時) ---
    foreign = None
    if market == "TW":
        it, ifor, sd = d.get("inst_total"), d.get("inst_foreign"), d.get("inst_sell_days") or 0
        parts = []
        if it is not None:
            parts.append(f"三大法人{'買超' if it >= 0 else '賣超'} {abs(it):,} 張")
        if ifor is not None:
            parts.append(f"外資 {ifor:+,} 張")
        if sd >= 3:
            parts.append(f"外資連賣 {sd} 天（籌碼偏弱）")
        elif it is not None and it >= 0:
            parts.append("近期無連續賣超")
        foreign = "；".join(parts) if parts else "法人動向資料不足"

    mgmt = _mgmt_focus(name, symbol, fund,
                       stock_kb.get("catalysts") or sec_kb.get("catalysts") or [], headlines)
    conclusion = _conclusion(reco, fund, regime)
    stars = _stars(reco["composite"])

    # 去重保序
    def dedup(xs):
        seen, out = set(), []
        for x in xs:
            if x not in seen:
                seen.add(x)
                out.append(x)
        return out

    reasons, risks, catalysts = dedup(reasons)[:5], dedup(risks)[:4], dedup(catalysts)[:4]

    # --- 詳細區塊：基本面 / 技術面 / 籌碼面 ---
    fundamentals_detail = _fundamentals_block(fund, market)
    technical_position = _technical_block(d)
    chip = _chip_block(d)

    text = ("".join(reasons + risks + catalysts) + industry_trend + (foreign or "")
            + mgmt + conclusion + "".join(fundamentals_detail) + "".join(technical_position) + chip)

    return {
        "symbol": symbol, "name": name, "market": market,
        "category_name": d.get("category_name"),
        "stars": stars, "composite": reco["composite"], "price": d.get("price"),
        "change_pct": d.get("change_pct"),
        "factors": reco.get("factors", {}),
        "reasons": reasons, "risks": risks, "catalysts": catalysts,
        "industry_trend": industry_trend, "industry_verdict": industry_verdict,
        "foreign": foreign,
        "fundamentals_detail": fundamentals_detail,
        "technical_position": technical_position,
        "chip": chip,
        "data_quality": d.get("data_quality") or {"ok": True, "single": True, "note": "—"},
        "tech": {"rsi": d.get("rsi"), "dist_ma20": d.get("dist_ma20_pct"),
                 "dist_ma50": d.get("dist_ma50_pct"), "dist_ma200": d.get("dist_ma200_pct"),
                 "support": d.get("support"), "resistance": d.get("resistance"),
                 "ma20": d.get("ma20"), "ma50": d.get("ma50"), "signal": d.get("signal"),
                 "macd": d.get("macd"), "macd_signal": d.get("macd_signal"),
                 "macd_hist": d.get("macd_hist")},
        "earnings": {"revenue_yoy": ry, "eps_yoy": eg,
                     "ttm_eps": fund.get("ttm_eps"), "forward_eps": fund.get("forward_eps")},
        "mgmt": mgmt, "next_earnings": fund.get("next_earnings"),
        "conclusion": conclusion, "analysis_len": len(text), "fund": fund,
    }
