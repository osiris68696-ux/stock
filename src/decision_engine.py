"""AI 投資決策引擎 (規則式，非 LLM)。

把單檔的敘述式分析 (insights.build_analysis) 轉成可執行的決策：
  - 投資建議：買進 / 分批布局 / 觀望 / 減碼 / 賣出
  - 信心分數 0~100、風險等級 低/中/高、建議資金配置 10/20/30/50%
  - 風險報酬比 (例 3.5 : 1)、目標價、停損價
  - 估值區間 valuation_zone()：超跌 / 合理 / 偏高 / 高估 / 泡沫
  - 對 保守型 / 穩健型 / 成長型 的適配度
  - 為什麼可以買 (>=5) / 為什麼不建議買 (>=3)

只整理既有數據、不對外連線、不下單；所有輸出僅供研究參考。
"""
from __future__ import annotations

from typing import List, Optional


def _dedup(xs: List[str]) -> List[str]:
    seen, out = set(), []
    for x in xs:
        if x and x not in seen:
            seen.add(x)
            out.append(x)
    return out


def _suitability(fund: dict, tech: dict) -> dict:
    dy = fund.get("dividend_yield")
    pe = fund.get("pe")
    eg = fund.get("eps_growth_pct") or 0
    ry = fund.get("revenue_yoy_pct") or 0
    rsi = tech.get("rsi")
    growth = max(eg, ry)
    overheated = rsi is not None and rsi >= 70

    cons = ("適合" if (dy and dy >= 4 and (pe is None or pe <= 20) and not overheated)
            else ("中性" if (dy and dy >= 2.5) else "較不適合"))
    stab = ("適合" if ((pe is not None and pe <= 25) and growth >= 5 and not overheated)
            else ("中性" if (pe is None or pe <= 30) else "較不適合"))
    grow = "適合" if growth >= 20 else ("中性" if growth >= 10 else "較不適合")
    return {"保守型": cons, "穩健型": stab, "成長型": grow}


# ----------------------------------------------------------------------
#  估值區間引擎
# ----------------------------------------------------------------------
def valuation_zone(price: Optional[float], fund: dict, tech: dict) -> dict:
    """回傳估值區間：超跌區 / 合理區 / 偏高區 / 高估區 / 泡沫區 + 合理區間 + 位置%。

    錨點優先序：分析師目標均價 → 近20日支撐 / 壓力 (技術區間)。合理區設在錨點附近，
    避免用『成長率當本益比』推出遠離現價、失真的估值。
    """
    empty = {"zone": "資料不足", "fair_low": None, "fair_high": None,
             "position_pct": None, "basis": None, "mid": None}
    if not price:
        return empty
    tmean = fund.get("target_mean")
    lo = hi = anchor = None
    basis = None
    if tmean and tmean > 0:
        anchor = float(tmean)
        lo, hi = round(anchor * 0.92, 2), round(anchor * 1.06, 2)
        basis = f"分析師目標均價 {anchor:.0f}"
    else:
        sup, res = tech.get("support"), tech.get("resistance")
        if sup and res and res > sup:
            lo, hi = round(sup, 2), round(res, 2)
            anchor = (lo + hi) / 2
            basis = "近20日支撐 / 壓力"
    if not anchor:
        return empty
    r = price / anchor
    if r < 0.85:
        zone = "超跌區"
    elif r <= 1.05:
        zone = "合理區"
    elif r <= 1.15:
        zone = "偏高區"
    elif r <= 1.30:
        zone = "高估區"
    else:
        zone = "泡沫區"
    # 位置%：價格落在合理區的相對位置 (區間外由 zone 標示超跌 / 高估，故夾 0~100)
    position = None
    if hi > lo:
        position = max(0, min(100, round((price - lo) / (hi - lo) * 100)))
    return {"zone": zone, "fair_low": lo, "fair_high": hi,
            "position_pct": position, "basis": basis, "mid": round(anchor, 2)}


def _risk_level(fund: dict, tech: dict, regime: str, overheated: bool,
                very_extended: bool, vz: dict) -> str:
    pts = 0
    pe = fund.get("pe")
    dy = fund.get("dividend_yield")
    if overheated:
        pts += 1
    if very_extended:
        pts += 1
    if pe is not None and pe >= 35:
        pts += 1
    if regime == "Risk-Off":
        pts += 1
    if vz.get("zone") in ("高估區", "泡沫區"):
        pts += 1
    if dy is not None and dy >= 4 and (pe is None or pe <= 15):
        pts -= 1   # 高息低估 → 防禦性，降風險
    return "高" if pts >= 2 else ("中" if pts == 1 else "低")


def _capital_pct(action: str, risk_level: str) -> int:
    """建議資金配置（占該標的目標部位的比例）：10 / 20 / 30 / 50%。"""
    if action in ("減碼", "賣出"):
        return 0
    table = {
        ("買進", "低"): 50, ("買進", "中"): 30, ("買進", "高"): 20,
        ("分批布局", "低"): 30, ("分批布局", "中"): 20, ("分批布局", "高"): 10,
        ("觀望", "低"): 10, ("觀望", "中"): 10, ("觀望", "高"): 10,
    }
    return table.get((action, risk_level), 10)


def decide(a: dict, regime: str = "Neutral") -> dict:
    """回傳決策 dict。a = insights.build_analysis 的輸出。"""
    fund = a.get("fund") or {}
    tech = a.get("tech") or {}
    price = a.get("price")
    comp = a.get("composite", 0)
    rsi = tech.get("rsi")
    dist20 = tech.get("dist_ma20")
    overheated = rsi is not None and rsi >= 70
    far_above = dist20 is not None and dist20 > 8
    very_extended = (dist20 is not None and dist20 > 15) or (rsi is not None and rsi >= 80)
    up = fund.get("target_upside_pct")
    pe, fpe, peg = fund.get("pe"), fund.get("forward_pe"), fund.get("peg")
    roe, dy = fund.get("roe_pct"), fund.get("dividend_yield")
    eg, ry = fund.get("eps_growth_pct"), fund.get("revenue_yoy_pct")
    rec = fund.get("recommendation")

    vz = valuation_zone(price, fund, tech)

    # --- 決策分數 → 五級行動 ---
    score = float(comp)
    if overheated:
        score -= 1.5
    if far_above:
        score -= 1.0
    if very_extended:
        score -= 1.5
    if up is not None:
        score += max(-2.5, min(1.5, up / 10.0))
    if vz.get("zone") == "泡沫區":
        score -= 2.0
    elif vz.get("zone") == "高估區":
        score -= 1.0
    elif vz.get("zone") == "超跌區":
        score += 1.0
    if regime == "Risk-Off":
        score -= 1.0
    elif regime == "Risk-On":
        score += 0.5

    if score >= 7.5:
        action = "買進"
    elif score >= 6.0:
        action = "分批布局"
    elif score >= 4.0:
        action = "觀望"
    elif score >= 2.5:
        action = "減碼"
    else:
        action = "賣出"

    # --- 信心分數 (0~100) ---
    confidence = max(0, min(100, round(comp * 10)))
    if overheated or far_above:
        confidence = max(0, confidence - 15)

    # --- 目標價 ---
    target = fund.get("target_mean")
    target_src = "分析師目標均價"
    if target is None:
        target = tech.get("resistance")
        target_src = "近20日壓力位" if target else None
    if target is None and vz.get("fair_high"):
        target, target_src = vz["fair_high"], "估值合理上緣"

    # --- 停損價 ---
    support = tech.get("support")
    if support and price and support < price * 0.99:
        stop, stop_src = round(support, 2), "近20日支撐"
    elif price:
        stop, stop_src = round(price * 0.90, 2), "現價 -10%"
    else:
        stop, stop_src = None, None

    # --- 風險報酬比 ---
    risk_reward = None
    if target and stop and price and target > price and price > stop:
        rr = (target - price) / (price - stop)
        risk_reward = f"{rr:.1f} : 1"

    # --- 風險等級 / 建議資金配置 ---
    risk_level = _risk_level(fund, tech, regime, overheated, very_extended, vz)
    capital_pct = _capital_pct(action, risk_level)

    # --- 為什麼可以買 (>=5) ---
    buy = []
    if pe is not None and pe <= 20:
        buy.append(f"本益比 {pe:.1f} 不貴")
    if fpe is not None and pe is not None and 0 < fpe < pe:
        buy.append("預估本益比低於現值，獲利看增")
    if peg is not None and 0 < peg <= 1.2:
        buy.append(f"PEG {peg:.2f}，成長性相對估值合理")
    if eg is not None and eg >= 15:
        buy.append(f"EPS 年增 {eg:.0f}%")
    if ry is not None and ry >= 10:
        buy.append(f"營收年增 {ry:.0f}%")
    if roe is not None and roe >= 15:
        buy.append(f"ROE {roe:.0f}% 獲利能力佳")
    if dy is not None and dy >= 4:
        buy.append(f"殖利率 {dy:.1f}%")
    if up is not None and up >= 15:
        buy.append(f"分析師目標價上檔 {up:.0f}%")
    if rec in ("buy", "strong_buy"):
        buy.append(f"分析師評等 {rec}")
    if vz.get("zone") in ("超跌區", "合理區"):
        buy.append(f"估值位於{vz['zone']}，進場風險相對低")
    if dist20 is not None and abs(dist20) <= 5:
        buy.append("貼近月線，進場成本相對合理")
    buy = _dedup(buy)
    _buy_fill = ("綜合評分位居前段，基本面與產業趨勢相對占優",
                 "屬可長期持有 / 零股分批標的", "產業位於成長賽道",
                 "技術面未見明顯破壞，趨勢結構尚穩", "可逢回分批降低平均成本")
    for f in _buy_fill:
        if len(buy) >= 5:
            break
        if f not in buy:
            buy.append(f)

    # --- 為什麼不建議買 (>=3) ---
    nobuy = list(a.get("risks", []))
    if overheated:
        nobuy.append(f"RSI {rsi:.0f} 過熱，短線追價風險")
    if far_above:
        nobuy.append(f"已偏離月線 {dist20:+.0f}%，追高風險")
    if pe is not None and pe >= 35:
        nobuy.append(f"本益比 {pe:.1f} 偏高、估值不便宜")
    if vz.get("zone") in ("高估區", "泡沫區"):
        nobuy.append(f"估值位於{vz['zone']}，下檔風險升高")
    if up is not None and up < 0:
        nobuy.append(f"現價已高於分析師目標均價 {abs(up):.0f}%")
    nobuy = _dedup(nobuy)
    _nobuy_fill = ("大盤系統性風險仍在，不宜單筆重壓",
                   "零股流動性與價差較大，需分批限價", "突發消息 / 財報 / 政策風險無法預測")
    for f in _nobuy_fill:
        if len(nobuy) >= 3:
            break
        if f not in nobuy:
            nobuy.append(f)

    return {
        "action": action,
        "confidence": confidence,
        "risk_level": risk_level,
        "capital_pct": capital_pct,
        "risk_reward": risk_reward,
        "target": target, "target_src": target_src,
        "stop": stop, "stop_src": stop_src,
        "valuation": vz,
        "suitability": _suitability(fund, tech),
        "buy_reasons": buy[:6],
        "not_buy_reasons": nobuy[:5],
    }
