"""Web 公開版的單檔分析服務。

提供「使用者自行輸入股票代號」的分析，重用既有分析模組。
安全：不讀取 .env、不碰 Telegram、不使用我的私人持股；只分析使用者輸入的代號。
持股由前端存 localStorage，伺服器只負責「分析單一代號」，不儲存任何使用者資料。
"""
from __future__ import annotations

import logging
import re
from datetime import date

import decision_engine
import fundamentals as fundamentals_mod
import insights
import market_regime
import recommend
import scanner
import strategy as strategy_mod
from fundamentals import FundamentalsProvider
from twse_client import TWSEClient
from us_stock_client import USStockClient

logger = logging.getLogger(__name__)

import os
import security

_STRATEGY_PATH = os.path.join(security.PROJECT_ROOT, "config", "strategy.json")
_INSIGHTS_PATH = os.path.join(security.PROJECT_ROOT, "config", "insights.json")

_TW_RE = re.compile(r"^[0-9]{4,6}$")        # 台股代號 (4~6 碼，含 00878 等 ETF)
_US_RE = re.compile(r"^[A-Za-z]{1,10}$")     # 美股代號 (1~10 個英文字母)

# 程序內快取 (跨請求重用，省 API)
_state = {"date": None, "tw": None, "us": None, "fund": None,
          "strategy": None, "insights": None, "regime": None, "mctx": None}


def _ensure_state():
    today = date.today().isoformat()
    if _state["date"] == today and _state["strategy"] is not None:
        return
    us = USStockClient()
    tw = TWSEClient()
    mctx = _market_ctx(us)
    _state.update({
        "date": today,
        "tw": tw, "us": us, "mctx": mctx,
        "fund": FundamentalsProvider(us),
        "strategy": strategy_mod.Strategy.load(_STRATEGY_PATH),
        "insights": insights.load_insights(_INSIGHTS_PATH),
    })
    try:
        _state["regime"] = market_regime.classify(mctx, us, tw)
    except Exception as exc:
        logger.warning("Web 取市場狀態失敗：%s", exc)
        _state["regime"] = {"regime": "Neutral", "score": 0, "signals": []}


def _market_ctx(us_client):
    ctx = {}
    try:
        import analysis
        for ind in analysis.get_market_indicators(us_client, [
            {"symbol": "^VIX", "name": "VIX"}, {"symbol": "DX-Y.NYB", "name": "DXY"},
            {"symbol": "^TNX", "name": "TNX"}]):
            s = ind["symbol"].upper()
            if "VIX" in s:
                ctx["vix"] = ind["value"]
            elif "DX" in s:
                ctx["dxy_change_pct"] = ind["change_pct"]
            elif "TNX" in s:
                ctx["tnx"] = ind["value"]
    except Exception:
        pass
    return ctx


def validate_symbol(symbol: str, market: str):
    symbol = (symbol or "").strip().upper()
    market = (market or "").strip().upper()
    if market not in ("TW", "US"):
        return None, None, "market 必須是 TW 或 US"
    if market == "TW" and not _TW_RE.match(symbol):
        return None, None, "台股代號格式不正確 (例 2330)"
    if market == "US" and not _US_RE.match(symbol):
        return None, None, "美股代號格式不正確 (例 AAPL)"
    return symbol, market, None


def analyze_stock(symbol: str, market: str) -> dict:
    """分析單一代號，回傳 JSON 友善 dict。任何失敗都回傳 error 欄位。"""
    symbol, market, err = validate_symbol(symbol, market)
    if err:
        return {"ok": False, "error": err}
    try:
        _ensure_state()
        strat = _state["strategy"]
        regime_info = _state["regime"]
        ctx = {"regime": regime_info.get("regime")}

        if market == "TW":
            d = scanner.build_tw_data(symbol, "custom", _state["tw"], _state["us"], _state["fund"])
        else:
            d = scanner.build_us_data(symbol, "custom", _state["us"], _state["fund"])

        if d.get("price") is None:
            return {"ok": False, "error": f"查無 {symbol} 的行情資料，請確認代號。"}

        ev = strat.evaluate(d, ctx)
        reco = recommend.score_one(ev, strat, regime_info, {}, [], mode=strat.scoring_mode)
        # 補抓財報日 (僅單檔)
        try:
            _state["fund"].attach_earnings(d["fund"], symbol, market)
        except Exception:
            pass
        a = insights.build_analysis(reco, regime_info, None, [], _state["insights"],
                                    _state.get("mctx"))
        a["decision"] = decision_engine.decide(a, regime_info.get("regime", "Neutral"))

        return {
            "ok": True,
            "symbol": symbol, "name": a["name"], "market": market,
            "price": a["price"], "change_pct": a.get("change_pct"),
            "stars": a["stars"], "composite": a["composite"], "factors": a["factors"],
            "reasons": a["reasons"], "risks": a["risks"], "catalysts": a["catalysts"],
            "fundamentals": a.get("fundamentals_detail", []),
            "industry_trend": a["industry_trend"], "industry_verdict": a.get("industry_verdict"),
            "technical": a.get("technical_position", []),
            "chip": a.get("chip"),
            "data_quality": a.get("data_quality"),
            "earnings": a.get("earnings"), "mgmt": a.get("mgmt"),
            "next_earnings": a.get("next_earnings"),
            "conclusion": a["conclusion"],
            "decision": a["decision"],
            "regime": regime_info.get("regime"),
            "disclaimer": "以上僅為資料整理與趨勢分析，不構成投資建議。",
        }
    except Exception as exc:
        logger.exception("Web 分析 %s 失敗：%s", symbol, exc)
        return {"ok": False, "error": f"分析失敗：{str(exc)[:80]}"}


# ----------------------------------------------------------------------
#  持股損益分析 (使用者輸入成本/股數；伺服器不儲存、不寫檔)
# ----------------------------------------------------------------------
def _holding_advice(ret_pct: float, price: float, decision: dict) -> dict:
    """由報酬率 + 決策 + 目標/停損，給出 續抱/加碼/減碼/停利/停損 建議。不儲存任何資料。"""
    action = decision.get("action")
    target, stop = decision.get("target"), decision.get("stop")
    notes = []
    suggestion = "續抱"
    if stop and price and price <= stop:
        suggestion = "停損"
        notes.append(f"已跌破停損價 {stop}，建議執行停損、控制虧損")
    elif target and price and price >= target:
        suggestion = "停利"
        notes.append(f"已達目標價 {target}，可分批停利、保留核心部位")
    elif action in ("賣出", "減碼"):
        suggestion = "減碼"
        notes.append(f"決策引擎建議「{action}」，宜降低部位")
    elif action in ("買進", "分批布局") and ret_pct < 20:
        suggestion = "加碼"
        notes.append(f"決策引擎建議「{action}」，可逢回分批加碼、攤平成本")
    else:
        notes.append("趨勢與基本面尚穩，續抱觀察、暫不加碼")

    if ret_pct <= -15:
        notes.append(f"目前虧損 {ret_pct:.1f}%，務必檢視基本面是否轉壞並嚴守停損")
    elif ret_pct >= 30:
        notes.append(f"目前獲利 {ret_pct:.1f}%，可考慮部分停利、續抱核心")
    return {"suggestion": suggestion, "notes": notes}


def analyze_holding(symbol: str, market: str, cost, qty) -> dict:
    """分析單檔 + 持股損益。cost/qty 僅用於即時計算，不寫入任何檔案 / DB / log。"""
    res = analyze_stock(symbol, market)
    if not res.get("ok"):
        return res
    price = res.get("price")
    try:
        cost = float(cost)
        qty = float(qty)
    except (TypeError, ValueError):
        return res   # 沒給有效持股就只回分析
    if cost <= 0 or qty <= 0 or not price:
        return res
    ret_pct = (price - cost) / cost * 100
    pnl = (price - cost) * qty
    res["holding"] = {
        "cost": round(cost, 2), "qty": qty,
        "cost_value": round(cost * qty, 2), "market_value": round(price * qty, 2),
        "pnl": round(pnl, 2), "return_pct": round(ret_pct, 2),
        **_holding_advice(ret_pct, price, res["decision"]),
    }
    return res
