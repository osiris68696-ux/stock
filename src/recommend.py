"""由上而下 (top-down) 推薦引擎。

優先分析總體市場環境，再逐層往下。推薦綜合分由 5 個因子加權 (見 strategy.json
recommendation_weights，預設)：

    大盤趨勢 40%  +  產業趨勢 25%  +  基本面 20%  +  技術面 10%  +  新聞事件 5%

設計重點：
  - 技術面僅 10%，且過熱 / 追高 / 爆量 / 法人連賣的個股『直接排除』，
    避免因單一熱門股短線上漲而被拉高分數。
  - 聚焦低估值、成長性佳、可零股長期布局的標的。
  - 基本面內部的『價值 vs 成長』傾向由市場狀態 (regime) 動態決定 (沿用 modes)。
ETF 不在此推薦 (改於零股 / 定期定額候選區)。本引擎只做觀察分級，不下買賣指令。
"""
from __future__ import annotations

import logging
from typing import List, Optional

import news as news_module

logger = logging.getLogger(__name__)


def _clamp(x: float, lo: float = 0.0, hi: float = 10.0) -> float:
    return max(lo, min(hi, x))


def component_scores(d: dict, ev: dict, strat) -> dict:
    """回傳價值 / 成長 / 技術 / 風險 / 股息 子分數與理由 (供因子計算)。"""
    fund = d.get("fund") or {}
    v = strat.fund["value"]
    g = strat.fund["growth"]

    value = growth = dividend = risk = 0
    vr: List[str] = []
    gr: List[str] = []

    pe = fund.get("pe")
    pb = fund.get("pb")
    peg = fund.get("peg")
    fpe = fund.get("forward_pe")
    if pe is not None:
        if pe <= v["pe_cheap"]:
            value += 2
            vr.append(f"本益比 {pe:.1f} 偏低")
        elif pe <= v["pe_fair"]:
            value += 1
            vr.append(f"本益比 {pe:.1f} 合理")
    if pb is not None and pb <= v["pb_cheap"]:
        value += 1
        vr.append(f"股價淨值比 {pb:.1f} 偏低")
    if peg is not None and 0 < peg <= v["peg_good"]:
        value += 1
        vr.append(f"PEG {peg:.2f} 合理")
    if fpe is not None and pe is not None and 0 < fpe < pe:
        value += 1
        vr.append("預估本益比低於現值（獲利看增）")

    dy = fund.get("dividend_yield")
    if dy is not None:
        if dy >= v["dividend_yield_good"]:
            dividend += 2
            vr.append(f"殖利率 {dy:.1f}%（佳）")
        elif dy >= v["dividend_yield_good"] / 2:
            dividend += 1

    eg = fund.get("eps_growth_pct")
    ry = fund.get("revenue_yoy_pct")
    up = fund.get("target_upside_pct")
    rec = fund.get("recommendation")
    if eg is not None:
        if eg >= g["eps_growth_strong"]:
            growth += 2
            gr.append(f"EPS 年增 {eg:.0f}%（高成長）")
        elif eg >= g["eps_growth_good"]:
            growth += 1
            gr.append(f"EPS 年增 {eg:.0f}%")
        elif eg < 0:
            growth -= 1
            gr.append(f"EPS 年減 {eg:.0f}%")
    if ry is not None:
        if ry >= g["revenue_yoy_strong"]:
            growth += 2
            gr.append(f"營收年增 {ry:.0f}%（強勁）")
        elif ry >= g["revenue_yoy_good"]:
            growth += 1
            gr.append(f"營收年增 {ry:.0f}%")
        elif ry < 0:
            growth -= 1
            gr.append(f"營收年減 {ry:.0f}%")
    if up is not None and up >= g["target_upside_good"]:
        growth += 1
        gr.append(f"分析師目標價上檔 {up:.0f}%")
    if rec in ("buy", "strong_buy"):
        growth += 1

    technical = ev.get("score", 0)

    rsi = d.get("rsi")
    dist20 = d.get("dist_ma20_pct")
    sell_days = d.get("inst_sell_days") or 0
    if rsi is not None:
        if 30 <= rsi < 70:
            risk += 1
        elif rsi >= 75 or rsi <= 25:
            risk -= 1
    if dist20 is not None:
        if abs(dist20) <= 8:
            risk += 1
        elif dist20 > 15:
            risk -= 1
    if sell_days >= 3:
        risk -= 1

    return {"value": value, "growth": growth, "technical": technical,
            "risk": risk, "dividend": dividend,
            "value_reasons": vr, "growth_reasons": gr}


# ----------------------------------------------------------------------
#  五大因子 (各 0~10)
# ----------------------------------------------------------------------
def market_score(regime_info: dict) -> float:
    """大盤趨勢分數 (0~10)，由市場狀態票數正規化；同一天對所有個股相同。"""
    sigs = regime_info.get("signals") or []
    n = len(sigs) or 1
    return round(_clamp((regime_info.get("score", 0) + n) / (2 * n) * 10), 2)


def _fundamental_score(sc: dict, mode_weights: dict) -> float:
    """基本面分數 (0~10)：價值 + 成長 + 股息，依市場狀態決定的傾向加權。"""
    raw = (mode_weights.get("value", 1) * sc["value"]
           + mode_weights.get("growth", 1) * sc["growth"]
           + mode_weights.get("dividend", 1) * sc["dividend"])
    return round(_clamp(raw), 2)


def _technical_score(sc: dict) -> float:
    """技術面分數 (0~10)：過熱在 component_scores/技術分內已被壓低。"""
    return round(_clamp((sc["technical"] + 4) / 8 * 10), 2)


def build_recommendations(results: List[dict], strat, regime_info: dict,
                          industry_scores: dict, headlines: list,
                          mode: Optional[str] = None, top_n: int = 3) -> List[dict]:
    """由上而下挑出個股 (排除 ETF 與過熱/追高個股)。"""
    rw = strat.rec_weights
    mw = strat.weights(mode)                  # 基本面內部的價值/成長傾向
    scored = []
    for ev in results:
        d = ev.get("data", {})
        if d.get("is_etf"):
            continue
        if not (d.get("data_quality") or {}).get("ok", True):   # 價格交叉驗證異常 → 停止推薦
            continue
        if ev.get("avoid"):                   # 過熱 / 追高 / 爆量 / 法人連賣 → 不推薦 (避免追熱門股)
            continue
        fund = d.get("fund") or {}
        if fund.get("pe") is None and fund.get("eps_growth_pct") is None and fund.get("revenue_yoy_pct") is None:
            continue
        scored.append(score_one(ev, strat, regime_info, industry_scores, headlines, mode))

    scored.sort(key=lambda x: x["composite"], reverse=True)
    return scored[:top_n]


def score_one(ev: dict, strat, regime_info: dict, industry_scores: dict,
              headlines: list, mode: Optional[str] = None) -> dict:
    """對單一標的算出推薦 dict (不做任何排除；Web 單檔查詢用)。"""
    rw = strat.rec_weights
    mw = strat.weights(mode)
    d = ev.get("data", {})
    sc = component_scores(d, ev, strat)
    f_market = market_score(regime_info)
    f_industry = industry_scores.get(d.get("category_name"), 5.0)
    f_fund = _fundamental_score(sc, mw)
    f_tech = _technical_score(sc)
    f_news = news_module.headline_score(d.get("name"), d.get("symbol"), headlines)
    composite = round(
        rw["market"] * f_market + rw["industry"] * f_industry
        + rw["fundamental"] * f_fund + rw["technical"] * f_tech + rw["news"] * f_news, 2)
    reasons = [f"產業趨勢分 {f_industry:.0f}/10"]
    reasons += (sc["value_reasons"] + sc["growth_reasons"])[:4]
    if not (sc["value_reasons"] or sc["growth_reasons"]):
        reasons.append("基本面中性")
    return {
        "symbol": d.get("symbol"), "name": d.get("name"), "market": d.get("market"),
        "category_name": d.get("category_name"), "price": d.get("price"),
        "data": d, "fund": fund_of(d),
        "factors": {"market": f_market, "industry": f_industry,
                    "fundamental": f_fund, "technical": f_tech, "news": f_news},
        "composite": composite,
        "value": sc["value"], "growth": sc["growth"], "tech": sc["technical"],
        "risk": sc["risk"], "dividend": sc["dividend"],
        "reasons": reasons, "tech_signal": d.get("signal"),
    }


def fund_of(d: dict) -> dict:
    return d.get("fund") or {}
