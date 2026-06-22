"""市場掃描器：對 watchlist 的 scan_universe 逐檔取資料、評分，產生候選與排除清單。

台股技術面 / 配息：用 yfinance (.TW)；
台股法人 / 名稱：用 TWSE 官方資料 (TWSEClient)。
美股：用 yfinance + Finnhub。
"""
from __future__ import annotations

import logging
from typing import Dict, List

import analysis

logger = logging.getLogger(__name__)

PRICE_DIFF_LIMIT = 3.0   # 兩來源價格差異 > 3% → 標記資料異常、停止推薦


def cross_validate_price(a, b, name_a: str, name_b: str) -> dict:
    """價格交叉驗證。回傳 {ok, single, diff_pct, sources, note}。

    `b` 可為單一價格，或一組『近期參考收盤價』(list)。為避免兩來源因 EOD 公布
    時間差 (例：TWSE 官方收盤比 Yahoo 慢 1 個交易日) 而誤判，會取 `a` 與 `b`
    清單中最接近者比較——真正的資料錯誤 (如錯一個位數) 仍會被抓出。
    """
    refs = [float(x) for x in (b if isinstance(b, (list, tuple)) else [b])
            if x is not None]
    if a is None or not refs:
        return {"ok": True, "single": True, "diff_pct": None,
                "sources": {name_a: a, name_b: (refs[-1] if refs else None)},
                "note": f"單一來源（{name_a if a is not None else name_b}），未交叉驗證"}
    a = float(a)
    best = min(refs, key=lambda c: abs(c - a))
    diff = abs(a - best) / abs(best) * 100
    ok = diff <= PRICE_DIFF_LIMIT
    return {
        "ok": ok, "single": False, "diff_pct": round(diff, 2),
        "sources": {name_a: round(a, 2), name_b: round(best, 2)},
        "note": ("資料正常（雙來源一致）" if ok
                 else f"⚠️ 價格差異 {diff:.1f}% > {PRICE_DIFF_LIMIT:.0f}%，資料異常，已停止推薦"),
    }

# 美股名稱對照 (scan universe)
US_NAMES = {
    "SPY": "SPDR S&P 500", "QQQ": "Invesco QQQ", "VOO": "Vanguard S&P 500",
    "VTI": "Vanguard Total Market", "SCHD": "Schwab US Dividend",
    "NVDA": "NVIDIA", "AAPL": "Apple", "MSFT": "Microsoft", "GOOGL": "Alphabet",
    "AMZN": "Amazon", "META": "Meta", "TSLA": "Tesla",
    "AMD": "AMD", "PLTR": "Palantir", "AVGO": "Broadcom",
}

TW_CATEGORY_NAMES = {
    "etf": "ETF", "financial": "金融", "semiconductor": "半導體", "ai_server": "AI/伺服器",
}
US_CATEGORY_NAMES = {"etf": "ETF", "mega_cap": "大型權值", "growth": "成長股"}


# ----------------------------------------------------------------------
#  單檔資料組裝
# ----------------------------------------------------------------------
def build_tw_data(code: str, category: str, tw_client, us_client, fund_provider=None,
                  name: str = None) -> dict:
    """組裝單一台股的完整分析資料 (技術面 + 基本面)。"""
    daily = tw_client.get_daily(code) or {}
    name = name or daily.get("name") or code
    is_etf = category == "etf"

    hist, divs = us_client.get_history_and_dividends(f"{code}.TW", period="1y")
    ind = analysis.indicator_snapshot(hist)

    price = ind.get("close") if ind.get("close") is not None else daily.get("close")
    change_pct = ind.get("change_pct") if ind.get("change_pct") is not None else daily.get("change_pct")
    div_yield = us_client.dividend_yield(divs, price)
    # 交叉驗證：TWSE 官方收盤 vs Yahoo 近期收盤 (容忍 EOD 公布時間差，仍能抓出真錯誤)
    yf_recent = []
    try:
        if hist is not None and not hist.empty and "Close" in hist:
            yf_recent = [round(float(x), 2) for x in hist["Close"].dropna().iloc[-6:].tolist()]
    except Exception:
        pass
    data_quality = cross_validate_price(daily.get("close"), yf_recent, "TWSE", "yfinance")

    inst = tw_client.get_institutional(code) or {}
    sell_days = tw_client.get_consecutive_sell_days(code)

    fund = fund_provider.get_tw(code, price, is_etf=is_etf) if fund_provider else {}

    return {
        "symbol": code, "name": name, "market": "TW",
        "category": category, "category_name": TW_CATEGORY_NAMES.get(category, category),
        "is_etf": is_etf,
        "price": price, "change_pct": change_pct, "volume": ind.get("volume"),
        "ma5": ind.get("ma5"), "ma10": ind.get("ma10"),
        "ma20": ind.get("ma20"), "ma50": ind.get("ma50"), "ma60": ind.get("ma60"),
        "ma200": ind.get("ma200"),
        "support": ind.get("support"), "resistance": ind.get("resistance"),
        "dist_ma20_pct": ind.get("dist_ma20_pct"), "dist_ma50_pct": ind.get("dist_ma50_pct"),
        "dist_ma200_pct": ind.get("dist_ma200_pct"),
        "rsi": ind.get("rsi"), "volume_ratio": ind.get("volume_ratio"),
        "macd": ind.get("macd"), "macd_signal": ind.get("macd_signal"), "macd_hist": ind.get("macd_hist"),
        "signal": ind.get("signal"),
        "pe": fund.get("pe"), "dividend_yield": fund.get("dividend_yield") or div_yield,
        "fund": fund, "data_quality": data_quality,
        "inst_total": inst.get("total"), "inst_foreign": inst.get("foreign"),
        "inst_trust": inst.get("trust"), "inst_dealer": inst.get("dealer"),
        "inst_sell_days": sell_days,
        "margin": (tw_client.get_margin(code) or {}),
    }


def build_us_data(symbol: str, category: str, us_client, fund_provider=None) -> dict:
    """組裝單一美股 / 美股 ETF 的完整分析資料 (技術面 + 基本面)。"""
    is_etf = category == "etf"
    hist, divs = us_client.get_history_and_dividends(symbol, period="1y")
    ind = analysis.indicator_snapshot(hist)
    price = ind.get("close")

    fin = us_client.get_basic_financials(symbol)
    div_yield = us_client.dividend_yield(divs, price)
    if div_yield is None and fin.get("dividend_yield"):
        div_yield = round(float(fin["dividend_yield"]), 2)

    fund = fund_provider.get_us(symbol, price, is_etf=is_etf) if fund_provider else {}
    # 交叉驗證：yfinance 收盤 vs Finnhub 報價 (無金鑰時為單一來源)
    fq = us_client.get_finnhub_quote(symbol)
    fin_price = fq.get("c") if fq else None
    data_quality = cross_validate_price(price, fin_price, "yfinance", "Finnhub")

    return {
        "symbol": symbol, "name": US_NAMES.get(symbol, symbol), "market": "US",
        "category": category, "category_name": US_CATEGORY_NAMES.get(category, category),
        "is_etf": is_etf,
        "price": price, "change_pct": ind.get("change_pct"), "volume": ind.get("volume"),
        "ma5": ind.get("ma5"), "ma10": ind.get("ma10"),
        "ma20": ind.get("ma20"), "ma50": ind.get("ma50"), "ma60": ind.get("ma60"),
        "ma200": ind.get("ma200"),
        "support": ind.get("support"), "resistance": ind.get("resistance"),
        "dist_ma20_pct": ind.get("dist_ma20_pct"), "dist_ma50_pct": ind.get("dist_ma50_pct"),
        "dist_ma200_pct": ind.get("dist_ma200_pct"),
        "rsi": ind.get("rsi"), "volume_ratio": ind.get("volume_ratio"),
        "macd": ind.get("macd"), "macd_signal": ind.get("macd_signal"), "macd_hist": ind.get("macd_hist"),
        "signal": ind.get("signal"),
        "pe": fund.get("pe") or fin.get("pe"), "dividend_yield": fund.get("dividend_yield") or div_yield,
        "fund": fund, "data_quality": data_quality,
        "inst_total": None, "inst_sell_days": 0, "margin": {},
    }


# ----------------------------------------------------------------------
#  掃描
# ----------------------------------------------------------------------
def scan_taiwan(universe: Dict[str, list], tw_client, us_client, strategy, ctx,
                fund_provider=None) -> List[dict]:
    """掃描台股 universe，回傳每檔的評估結果 list。"""
    results, seen = [], set()
    for category, codes in universe.items():
        for code in codes:
            if code in seen:
                continue
            seen.add(code)
            try:
                d = build_tw_data(code, category, tw_client, us_client, fund_provider)
                results.append(strategy.evaluate(d, ctx))
            except Exception as exc:
                logger.warning("掃描台股 %s 失敗：%s", code, exc)
    logger.info("台股掃描完成，共 %d 檔。", len(results))
    return results


def scan_us(universe: Dict[str, list], us_client, strategy, ctx, fund_provider=None) -> List[dict]:
    """掃描美股 universe，回傳每檔的評估結果 list。"""
    results, seen = [], set()
    for category, symbols in universe.items():
        for symbol in symbols:
            if symbol in seen:
                continue
            seen.add(symbol)
            try:
                d = build_us_data(symbol, category, us_client, fund_provider)
                results.append(strategy.evaluate(d, ctx))
            except Exception as exc:
                logger.warning("掃描美股 %s 失敗：%s", symbol, exc)
    logger.info("美股掃描完成，共 %d 檔。", len(results))
    return results


# ----------------------------------------------------------------------
#  候選 / 排除挑選
# ----------------------------------------------------------------------
def pick_candidates(results: List[dict], limit: int = 8) -> List[dict]:
    """挑出候選並排序：ETF 優先，其次評分高者。"""
    cands = [r for r in results if r.get("candidate")]
    cands.sort(key=lambda r: (r.get("is_etf", False), r.get("score", 0)), reverse=True)
    return cands[:limit]


def pick_avoid(results: List[dict], limit: int = 12) -> List[dict]:
    """挑出『不適合追價』清單。"""
    avoid = [r for r in results if r.get("avoid")]
    avoid.sort(key=lambda r: r.get("data", {}).get("rsi") or 0, reverse=True)
    return avoid[:limit]


def pick_buy_watch(tw_results: List[dict], us_results: List[dict], limit: int = 6) -> List[dict]:
    """跨市場挑出『今日最適合分批觀察』：ETF 優先、評分高者優先。"""
    cands = [r for r in (tw_results + us_results) if r.get("candidate")]
    cands.sort(key=lambda r: (r.get("is_etf", False), r.get("score", 0)), reverse=True)
    return cands[:limit]
