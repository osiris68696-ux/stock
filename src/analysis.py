"""技術分析與市場指標。

提供：
  - 技術指標：MA(5/20/60)、RSI(14)、MACD
  - 個股 / ETF 訊號判斷 (規則式，非投資建議)
  - 市場指標：VIX 波動率、DXY 美元指數、美國 10 年期公債殖利率
"""
from __future__ import annotations

import logging
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


# ----------------------------------------------------------------------
#  技術指標
# ----------------------------------------------------------------------
def sma(series: pd.Series, window: int) -> Optional[float]:
    s = series.dropna()
    if len(s) < window:
        return None
    return float(s.rolling(window).mean().iloc[-1])


def rsi(series: pd.Series, period: int = 14) -> Optional[float]:
    s = series.dropna()
    if len(s) < period + 1:
        return None
    delta = s.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi_series = 100 - (100 / (1 + rs))
    val = rsi_series.iloc[-1]
    return round(float(val), 1) if pd.notna(val) else None


def macd(series: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> dict:
    s = series.dropna()
    if len(s) < slow + signal:
        return {"macd": None, "signal": None, "hist": None}
    ema_fast = s.ewm(span=fast, adjust=False).mean()
    ema_slow = s.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    hist = macd_line - signal_line
    return {
        "macd": round(float(macd_line.iloc[-1]), 3),
        "signal": round(float(signal_line.iloc[-1]), 3),
        "hist": round(float(hist.iloc[-1]), 3),
    }


# ----------------------------------------------------------------------
#  訊號判斷 (規則式)
# ----------------------------------------------------------------------
def analyze_price_series(close: pd.Series) -> dict:
    """從收盤價序列計算指標並給出多空訊號分數。"""
    if close is None or close.dropna().empty:
        return {"signal": "資料不足", "score": 0, "indicators": {}}

    last = float(close.dropna().iloc[-1])
    ma5 = sma(close, 5)
    ma20 = sma(close, 20)
    ma60 = sma(close, 60)
    r = rsi(close, 14)
    m = macd(close)

    score = 0
    reasons = []

    if ma20 is not None:
        if last > ma20:
            score += 1
            reasons.append("站上月線(MA20)")
        else:
            score -= 1
            reasons.append("跌破月線(MA20)")
    if ma20 is not None and ma60 is not None:
        if ma20 > ma60:
            score += 1
            reasons.append("均線多頭排列")
        else:
            score -= 1
            reasons.append("均線空頭排列")
    if r is not None:
        if r >= 70:
            score -= 1
            reasons.append(f"RSI {r} 偏高(過熱)")
        elif r <= 30:
            score += 1
            reasons.append(f"RSI {r} 偏低(超賣)")
    if m["hist"] is not None:
        if m["hist"] > 0:
            score += 1
            reasons.append("MACD 柱狀為正")
        else:
            score -= 1
            reasons.append("MACD 柱狀為負")

    if score >= 2:
        signal = "偏多 🟢"
    elif score <= -2:
        signal = "偏空 🔴"
    else:
        signal = "中性 ⚪"

    return {
        "signal": signal,
        "score": score,
        "reasons": reasons,
        "indicators": {
            "close": round(last, 2),
            "ma5": round(ma5, 2) if ma5 else None,
            "ma20": round(ma20, 2) if ma20 else None,
            "ma60": round(ma60, 2) if ma60 else None,
            "rsi": r,
            "macd": m["macd"],
            "macd_signal": m["signal"],
            "macd_hist": m["hist"],
        },
    }


def analyze_history(df: pd.DataFrame) -> dict:
    """輸入 yfinance 歷史 DataFrame，回傳技術分析結果。"""
    if df is None or df.empty or "Close" not in df:
        return {"signal": "資料不足", "score": 0, "indicators": {}}
    return analyze_price_series(df["Close"])


def indicator_snapshot(df: pd.DataFrame) -> dict:
    """從 yfinance 歷史 DataFrame 算出篩選 / 評分需要的所有指標 (扁平 dict)。

    包含：收盤、漲跌%、量、量能比 (今量/20日均量)、MA20/MA50/MA60、
    距 MA20/MA50 百分比、RSI、技術訊號與分數。
    """
    out = {
        "close": None, "change_pct": None, "volume": None, "volume_ratio": None,
        "ma5": None, "ma10": None, "ma20": None, "ma50": None, "ma60": None, "ma200": None,
        "rsi": None, "support": None, "resistance": None,
        "macd": None, "macd_signal": None, "macd_hist": None,
        "dist_ma20_pct": None, "dist_ma50_pct": None, "dist_ma200_pct": None,
        "signal": "資料不足", "score": 0, "reasons": [],
    }
    if df is None or df.empty or "Close" not in df:
        return out

    close = df["Close"].dropna()
    if close.empty:
        return out

    last = float(close.iloc[-1])
    out["close"] = round(last, 2)
    if len(close) >= 2:
        prev = float(close.iloc[-2])
        if prev:
            out["change_pct"] = round((last - prev) / prev * 100, 2)

    ma5 = sma(close, 5)
    ma10 = sma(close, 10)
    ma20 = sma(close, 20)
    ma50 = sma(close, 50)
    ma60 = sma(close, 60)
    ma200 = sma(close, 200)
    out["ma5"] = round(ma5, 2) if ma5 else None
    out["ma10"] = round(ma10, 2) if ma10 else None
    out["ma20"] = round(ma20, 2) if ma20 else None
    out["ma50"] = round(ma50, 2) if ma50 else None
    out["ma60"] = round(ma60, 2) if ma60 else None
    out["ma200"] = round(ma200, 2) if ma200 else None
    if ma20:
        out["dist_ma20_pct"] = round((last - ma20) / ma20 * 100, 2)
    if ma50:
        out["dist_ma50_pct"] = round((last - ma50) / ma50 * 100, 2)
    if ma200:
        out["dist_ma200_pct"] = round((last - ma200) / ma200 * 100, 2)
    out["rsi"] = rsi(close, 14)

    # 支撐 / 壓力：近 20 日低 / 高
    try:
        if "Low" in df and "High" in df:
            lows = df["Low"].dropna()
            highs = df["High"].dropna()
            if len(lows) >= 5:
                out["support"] = round(float(lows.iloc[-20:].min()), 2)
            if len(highs) >= 5:
                out["resistance"] = round(float(highs.iloc[-20:].max()), 2)
    except Exception:
        pass

    if "Volume" in df:
        vol = df["Volume"].dropna()
        if not vol.empty:
            out["volume"] = int(vol.iloc[-1])
            if len(vol) >= 21:
                avg = float(vol.iloc[-21:-1].mean())
                if avg:
                    out["volume_ratio"] = round(float(vol.iloc[-1]) / avg, 2)

    tech = analyze_price_series(close)
    out["signal"] = tech["signal"]
    out["score"] = tech["score"]
    out["reasons"] = tech.get("reasons", [])
    ind = tech.get("indicators", {})
    out["macd"] = ind.get("macd")
    out["macd_signal"] = ind.get("macd_signal")
    out["macd_hist"] = ind.get("macd_hist")
    return out


# ----------------------------------------------------------------------
#  ETF 分析
# ----------------------------------------------------------------------
def analyze_etf(symbol: str, name: str, df: pd.DataFrame) -> dict:
    """ETF 分析：技術訊號 + 近期報酬 (1個月 / 3個月)。"""
    result = {"symbol": symbol, "name": name, "signal": "資料不足",
              "indicators": {}, "ret_1m": None, "ret_3m": None}
    if df is None or df.empty or "Close" not in df:
        return result

    close = df["Close"].dropna()
    tech = analyze_price_series(close)
    result.update(tech)

    def ret(n_days: int):
        if len(close) > n_days:
            past = close.iloc[-n_days - 1]
            now = close.iloc[-1]
            if past:
                return round((now / past - 1) * 100, 2)
        return None

    result["ret_1m"] = ret(21)   # 約 1 個月交易日
    result["ret_3m"] = ret(63)   # 約 3 個月交易日
    return result


# ----------------------------------------------------------------------
#  市場指標 (VIX / DXY / 10Y)
# ----------------------------------------------------------------------
def get_market_indicators(us_client, indicators_config: list) -> list:
    """抓取 VIX / DXY / 美國10年期公債殖利率等總經指標。"""
    results = []
    for item in indicators_config:
        symbol = item["symbol"]
        name = item["name"]
        quote = us_client.get_quote(symbol)
        interpretation = _interpret_indicator(symbol, quote.get("price"), quote.get("change_pct"))
        results.append({
            "symbol": symbol,
            "name": name,
            "value": quote.get("price"),
            "change": quote.get("change"),
            "change_pct": quote.get("change_pct"),
            "note": interpretation,
        })
    return results


def _interpret_indicator(symbol: str, value: Optional[float], change_pct: Optional[float]) -> str:
    """對 VIX / DXY / 殖利率給出白話解讀。"""
    if value is None:
        return "—"
    s = symbol.upper()

    if "VIX" in s:
        if value >= 30:
            return "市場恐慌、波動劇烈，風險偏高"
        if value >= 20:
            return "波動升溫，留意風險"
        return "市場情緒平穩"
    if "DX" in s:  # 美元指數
        trend = "走強" if (change_pct or 0) > 0 else "走弱"
        extra = "(美元強通常壓抑風險資產與新興市場)" if (change_pct or 0) > 0 else "(美元弱有利風險資產)"
        return f"美元{trend} {extra}"
    if "TNX" in s or "^TNX" in s:  # 10 年期殖利率 (^TNX 報價為殖利率*10? yfinance ^TNX 已是百分比)
        if value >= 4.5:
            return "殖利率偏高，壓抑成長股估值"
        if value <= 3.5:
            return "殖利率偏低，有利成長股"
        return "殖利率中性區間"
    return "—"
