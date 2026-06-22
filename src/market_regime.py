"""市場狀態 (Market Regime) 判斷：Risk-On / Neutral / Risk-Off。

每天先綜合下列訊號判斷市場狀態，再由 main 依 strategy 的 regime_mode_map
動態選擇推薦權重模式 (不固定使用單一模式)：

  - VIX 波動率
  - DXY 美元指數 (日變動)
  - 美國 10 年期公債殖利率
  - NASDAQ 趨勢 (^IXIC)
  - S&P 500 趨勢 (^GSPC)
  - 台股加權指數趨勢 (^TWII)
  - 外資買賣超 (全市場合計)

指數透過 yfinance (query1/2.finance.yahoo.com，白名單內) 取得，每個 +1/0/-1 票，
總分 >= +2 為 Risk-On、<= -2 為 Risk-Off、其餘 Neutral。
"""
from __future__ import annotations

import logging

import analysis

logger = logging.getLogger(__name__)

INDICES = [("^IXIC", "NASDAQ"), ("^GSPC", "S&P 500"), ("^TWII", "台股加權")]


def _index_trend(us_client, symbol: str):
    """回傳 (vote, snapshot, note)：依站上/跌破均線判斷指數趨勢。"""
    snap = analysis.indicator_snapshot(us_client.get_history(symbol, period="6mo"))
    close, ma20, ma50 = snap.get("close"), snap.get("ma20"), snap.get("ma50")
    if close and ma20 and ma50:
        if close > ma20 and ma20 >= ma50:
            return 1, snap, "多頭排列(站上均線)"
        if close < ma20 and ma20 < ma50:
            return -1, snap, "空頭排列(跌破均線)"
    d = snap.get("dist_ma50_pct")
    if d is not None:
        if d > 1:
            return 1, snap, "站上季線"
        if d < -1:
            return -1, snap, "跌破季線"
    return 0, snap, "區間盤整"


def classify(ctx: dict, us_client, tw_client) -> dict:
    """回傳 {regime, score, signals, up_reasons, down_reasons}。"""
    signals = []

    def add(name, value, vote, note):
        signals.append({"name": name, "value": value, "vote": vote, "note": note})

    # --- VIX ---
    vix = ctx.get("vix")
    if vix is not None:
        vote = 1 if vix < 17 else (-1 if vix > 25 else 0)
        note = {1: "低波動(偏多)", 0: "波動中性", -1: "高波動(避險)"}[vote]
        add("VIX", f"{vix:.1f}", vote, note)

    # --- DXY 美元指數 (日變動) ---
    dxy = ctx.get("dxy_change_pct")
    if dxy is not None:
        vote = 1 if dxy <= -0.2 else (-1 if dxy >= 0.5 else 0)
        note = {1: "美元走弱(利風險資產)", 0: "美元持平", -1: "美元走強(避險)"}[vote]
        add("DXY 美元指數", f"{dxy:+.2f}%", vote, note)

    # --- 美國 10 年期公債殖利率 ---
    tnx = ctx.get("tnx")
    if tnx is not None:
        vote = 1 if tnx <= 3.5 else (-1 if tnx >= 4.5 else 0)
        note = {1: "殖利率偏低(利成長)", 0: "殖利率中性", -1: "殖利率偏高(壓成長)"}[vote]
        add("美10年期殖利率", f"{tnx:.2f}%", vote, note)

    # --- NASDAQ / S&P500 / 台股加權 趨勢 ---
    for symbol, name in INDICES:
        vote, snap, note = _index_trend(us_client, symbol)
        val = f"{snap.get('close')}" if snap.get("close") is not None else "—"
        d = snap.get("dist_ma50_pct")
        if d is not None:
            val += f"（距季線 {d:+.1f}%）"
        add(f"{name}趨勢", val, vote, note)

    # --- 外資買賣超 (全市場合計，張) ---
    fn = tw_client.get_market_foreign_net()
    if fn is not None:
        vote = 1 if fn > 5000 else (-1 if fn < -5000 else 0)
        note = {1: "外資買超(偏多)", 0: "外資中性", -1: "外資賣超(偏空)"}[vote]
        add("外資買賣超", f"{fn:+,} 張", vote, note)

    score = sum(s["vote"] for s in signals)
    if score >= 2:
        regime = "Risk-On"
    elif score <= -2:
        regime = "Risk-Off"
    else:
        regime = "Neutral"

    up_reasons = [f"{s['name']} {s['value']}（{s['note']}）" for s in signals if s["vote"] > 0]
    down_reasons = [f"{s['name']} {s['value']}（{s['note']}）" for s in signals if s["vote"] < 0]

    logger.info("市場狀態：%s（分數 %+d）", regime, score)
    return {"regime": regime, "score": score, "signals": signals,
            "up_reasons": up_reasons, "down_reasons": down_reasons}


# 各狀態的白話說明 (給報告 / Telegram 顯示推薦原因)
REGIME_EXPLAIN = {
    "Risk-On": "風險偏好升溫 → 動態提高『成長股』權重（growth_mode）。",
    "Neutral": "市場中性 → 採用『平衡』權重（balanced_mode）。",
    "Risk-Off": "避險情緒升高 → 提高『ETF / 高股息 / 金融股 / 風險控管』權重（defensive_mode）。",
}
