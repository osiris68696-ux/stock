"""美股資料客戶端：yfinance (主) + Finnhub (輔)。

  - yfinance ：免金鑰，提供歷史 K 線、即時報價、ETF / 指數資料。
  - Finnhub  ：免費金鑰，提供即時報價、公司基本面、公司新聞。

兩者互補：yfinance 拿 OHLC 與歷史資料做技術分析，
Finnhub 補上即時報價與基本面 (P/E、市值、52 週高低…)。
"""
from __future__ import annotations

import logging
from typing import Dict, List, Optional

import pandas as pd
import yfinance as yf

import security

try:
    import finnhub
except ImportError:  # Finnhub 為選用
    finnhub = None

logger = logging.getLogger(__name__)


def _num(value) -> Optional[float]:
    try:
        if value is None:
            return None
        f = float(value)
        return f
    except (ValueError, TypeError):
        return None


def _pct(value) -> Optional[float]:
    """yfinance 比率 (0.852) → 百分比 (85.2)。"""
    f = _num(value)
    return round(f * 100, 2) if f is not None else None


def extract_fundamentals(info: dict, price: Optional[float], is_etf: bool = False) -> dict:
    """從 yfinance .info 萃取『單位對齊』的基本面 (美股 / 任何 yfinance 代號)。

    重要：明確區分 quarterly / TTM / forward EPS：
      - Trailing P/E 一律對應 TTM EPS (trailingEps)
      - Forward P/E 一律對應 Forward EPS (forwardEps)
      - 最近一季 EPS / 營收 YoY 來自 earningsQuarterlyGrowth / revenueGrowth
      - yfinance 未提供時回傳 None (顯示『資料不足』)，不硬推估。
    """
    info = info or {}
    ttm_eps = _num(info.get("trailingEps"))           # 過去 12 個月 EPS
    forward_eps = _num(info.get("forwardEps"))         # 分析師預估未來 12 個月 EPS
    trailing_pe = _num(info.get("trailingPE"))         # 應 = 價格 / TTM EPS
    forward_pe = _num(info.get("forwardPE"))           # 應 = 價格 / Forward EPS
    pe_source = "yfinance"

    # 單位對齊補算 (僅在 yfinance 缺值且分母正確時)
    if trailing_pe is None and price and ttm_eps and ttm_eps > 0:
        trailing_pe = round(price / ttm_eps, 2)
        pe_source = "計算(價格÷TTM EPS)"
    if forward_pe is None and price and forward_eps and forward_eps > 0:
        forward_pe = round(price / forward_eps, 2)

    eps_q_yoy = _pct(info.get("earningsQuarterlyGrowth"))
    if eps_q_yoy is None:
        eps_q_yoy = _pct(info.get("earningsGrowth"))
    rev_q_yoy = _pct(info.get("revenueGrowth"))

    eps_trend = "資料不足"
    if ttm_eps and forward_eps and ttm_eps > 0:
        chg = (forward_eps / ttm_eps - 1) * 100
        label = "成長" if chg > 3 else ("下滑" if chg < -3 else "持平")
        eps_trend = f"{label}（Forward EPS 較 TTM {chg:+.0f}%）"

    dy = _num(info.get("dividendYield"))
    if dy is not None:
        # 新版 yfinance 已是百分比 (0.49=0.49%)；極小值代表舊版比率 (0.0049) → 還原
        dy = round(dy * 100, 2) if 0 < dy < 0.2 else round(dy, 2)

    target = _num(info.get("targetMeanPrice"))
    upside = round((target / price - 1) * 100, 1) if (target and price) else None

    return {
        "market": "US", "is_etf": is_etf,
        "ttm_eps": ttm_eps, "forward_eps": forward_eps, "quarter_eps": None,
        "eps_growth_pct": eps_q_yoy,        # 最近一季 EPS YoY
        "revenue_yoy_pct": rev_q_yoy,       # 最近一季營收 YoY
        "revenue_cum_yoy_pct": None,
        "eps_trend": eps_trend,
        "pe": trailing_pe, "trailing_pe": trailing_pe, "forward_pe": forward_pe,
        "pe_source": pe_source,
        "pb": _num(info.get("priceToBook")),
        "peg": _num(info.get("pegRatio") or info.get("trailingPegRatio")),
        "profit_margin_pct": _pct(info.get("profitMargins")),
        "roe_pct": _pct(info.get("returnOnEquity")),
        "inst_held_pct": _pct(info.get("heldPercentInstitutions")),
        "short_pct_float": _pct(info.get("shortPercentOfFloat")),
        "dividend_yield": dy,
        "target_mean": target, "target_high": _num(info.get("targetHighPrice")),
        "target_low": _num(info.get("targetLowPrice")), "target_upside_pct": upside,
        "analyst_count": info.get("numberOfAnalystOpinions"),
        "recommendation": info.get("recommendationKey"),
        "sector": info.get("sector"), "industry": info.get("industry"),
        "next_earnings": None, "eps_estimate": None,
        "data_source": "yfinance",
    }


class USStockClient:
    def __init__(self, finnhub_api_key: Optional[str] = None):
        self.finnhub_api_key = finnhub_api_key or security.get_env("FINNHUB_API_KEY")
        self.finnhub_client = None
        if self.finnhub_api_key and self.finnhub_api_key != "your_finnhub_api_key_here" and finnhub:
            try:
                self.finnhub_client = finnhub.Client(api_key=self.finnhub_api_key)
                logger.info("Finnhub 已啟用。")
            except Exception as exc:
                logger.warning("Finnhub 初始化失敗，將只用 yfinance：%s", exc)
        else:
            logger.info("未設定 FINNHUB_API_KEY，將只用 yfinance。")
        self._info_cache: Dict[str, dict] = {}

    def get_info(self, symbol: str) -> dict:
        """取得 yfinance 的 .info (基本面 / 分析師目標價等)，每個代號只抓一次。"""
        if symbol in self._info_cache:
            return self._info_cache[symbol]
        info: dict = {}
        if security.api_over_limit():
            logger.warning("已達每日 API 上限，略過 info %s", symbol)
            self._info_cache[symbol] = info
            return info
        security.note_api_call()
        try:
            info = yf.Ticker(symbol).get_info() or {}
        except Exception as exc:
            logger.debug("yfinance info %s 失敗：%s", symbol, exc)
        self._info_cache[symbol] = info
        return info

    def get_earnings(self, symbol: str) -> dict:
        """取得下次財報 / 法說日期與市場預估 (yfinance calendar)。"""
        out = {"next_date": None, "eps_estimate": None, "revenue_estimate": None}
        if security.api_over_limit():
            return out
        security.note_api_call()
        try:
            cal = yf.Ticker(symbol).calendar
            if isinstance(cal, dict):
                dates = cal.get("Earnings Date")
                if dates:
                    out["next_date"] = str(dates[0]) if isinstance(dates, (list, tuple)) else str(dates)
                out["eps_estimate"] = cal.get("Earnings Average")
                out["revenue_estimate"] = cal.get("Revenue Average")
        except Exception as exc:
            logger.debug("yfinance calendar %s 失敗：%s", symbol, exc)
        return out

    # ------------------------------------------------------------------
    #  yfinance
    # ------------------------------------------------------------------
    def get_history(self, symbol: str, period: str = "6mo", interval: str = "1d") -> pd.DataFrame:
        """取得歷史 K 線 (DataFrame)。失敗回傳空 DataFrame。

        symbol 為任意 yfinance 代號 (美股直接用代號；台股加 .TW / .TWO)。
        """
        if security.api_over_limit():
            logger.warning("已達每日 API 上限，略過 history %s", symbol)
            return pd.DataFrame()
        security.note_api_call()
        try:
            df = yf.Ticker(symbol).history(period=period, interval=interval, auto_adjust=False)
            return df if df is not None else pd.DataFrame()
        except Exception as exc:
            logger.warning("yfinance 抓取 %s 歷史失敗：%s", symbol, exc)
            return pd.DataFrame()

    def get_history_and_dividends(self, symbol: str, period: str = "1y", interval: str = "1d"):
        """一次抓歷史 K 線與配息序列 (共用同一個 Ticker，省一次請求)。"""
        empty_div = pd.Series(dtype=float)
        if security.api_over_limit():
            logger.warning("已達每日 API 上限，略過 %s", symbol)
            return pd.DataFrame(), empty_div
        security.note_api_call()
        try:
            ticker = yf.Ticker(symbol)
            df = ticker.history(period=period, interval=interval, auto_adjust=False)
            try:
                divs = ticker.dividends
            except Exception:
                divs = empty_div
            return (df if df is not None else pd.DataFrame()), (divs if divs is not None else empty_div)
        except Exception as exc:
            logger.warning("yfinance 抓取 %s 失敗：%s", symbol, exc)
            return pd.DataFrame(), empty_div

    @staticmethod
    def dividend_yield(divs: pd.Series, price: Optional[float]) -> Optional[float]:
        """以近 12 個月實際配息 / 現價 估算年化殖利率 (%)。"""
        try:
            if divs is None or len(divs) == 0 or not price:
                return None
            idx = divs.index
            tz = getattr(idx, "tz", None)
            now = pd.Timestamp.now(tz=tz) if tz is not None else pd.Timestamp.now()
            cutoff = now - pd.Timedelta(days=365)
            recent = divs[divs.index >= cutoff]
            total = float(recent.sum())
            if total <= 0:
                return None
            return round(total / float(price) * 100, 2)
        except Exception:
            return None

    def get_quote(self, symbol: str, history: Optional[pd.DataFrame] = None) -> dict:
        """整合報價：以 yfinance 歷史計算收盤 / 漲跌，再用 Finnhub 補即時與基本面。

        可傳入已抓好的 history (DataFrame) 重複使用，避免重複請求。
        """
        quote = {
            "symbol": symbol,
            "price": None,
            "prev_close": None,
            "change": None,
            "change_pct": None,
            "volume": None,
            "currency": "USD",
        }

        df = history if history is not None else self.get_history(symbol, period="5d", interval="1d")
        if df is not None and not df.empty and "Close" in df:
            closes = df["Close"].dropna()
            if len(closes) >= 1:
                quote["price"] = float(closes.iloc[-1])
            if len(closes) >= 2:
                quote["prev_close"] = float(closes.iloc[-2])
            if "Volume" in df and not df["Volume"].dropna().empty:
                quote["volume"] = int(df["Volume"].dropna().iloc[-1])

        # Finnhub 即時報價優先 (c=現價, pc=昨收)
        fh = self.get_finnhub_quote(symbol)
        if fh:
            if fh.get("c"):
                quote["price"] = fh["c"]
            if fh.get("pc"):
                quote["prev_close"] = fh["pc"]

        if quote["price"] is not None and quote["prev_close"]:
            quote["change"] = round(quote["price"] - quote["prev_close"], 4)
            quote["change_pct"] = round(quote["change"] / quote["prev_close"] * 100, 2)

        return quote

    # ------------------------------------------------------------------
    #  Finnhub
    # ------------------------------------------------------------------
    def get_finnhub_quote(self, symbol: str) -> Optional[dict]:
        if not self.finnhub_client:
            return None
        try:
            return self.finnhub_client.quote(symbol)
        except Exception as exc:
            logger.debug("Finnhub quote %s 失敗：%s", symbol, exc)
            return None

    def get_basic_financials(self, symbol: str) -> dict:
        """回傳常用基本面指標 (P/E、市值、52 週高低、Beta、殖利率)。

        優先用 Finnhub；若未設金鑰或失敗，退而用 yfinance .info (較慢，盡力而為)。
        """
        result: Dict[str, Optional[float]] = {
            "pe": None, "market_cap": None, "52w_high": None,
            "52w_low": None, "beta": None, "dividend_yield": None,
        }

        if self.finnhub_client:
            try:
                data = self.finnhub_client.company_basic_financials(symbol, "all")
                metric = data.get("metric", {}) if data else {}
                result.update({
                    "pe": metric.get("peTTM") or metric.get("peNormalizedAnnual"),
                    "market_cap": metric.get("marketCapitalization"),
                    "52w_high": metric.get("52WeekHigh"),
                    "52w_low": metric.get("52WeekLow"),
                    "beta": metric.get("beta"),
                    "dividend_yield": metric.get("currentDividendYieldTTM"),
                })
                if result["pe"] is not None:
                    return result
            except Exception as exc:
                logger.debug("Finnhub 基本面 %s 失敗：%s", symbol, exc)

        # yfinance 後備 (沒有 Finnhub 金鑰時；共用 get_info 快取，不重複請求)
        try:
            info = self.get_info(symbol)
            result["pe"] = result["pe"] or info.get("trailingPE")
            result["market_cap"] = result["market_cap"] or info.get("marketCap")
            result["52w_high"] = result["52w_high"] or info.get("fiftyTwoWeekHigh")
            result["52w_low"] = result["52w_low"] or info.get("fiftyTwoWeekLow")
            result["beta"] = result["beta"] or info.get("beta")
        except Exception as exc:
            logger.debug("yfinance 基本面 %s 失敗：%s", symbol, exc)

        return result

    def get_company_news(self, symbol: str, days: int = 5, limit: int = 5) -> List[dict]:
        """取得公司近期新聞 (Finnhub)。"""
        if not self.finnhub_client:
            return []
        from datetime import date, timedelta
        today = date.today()
        frm = (today - timedelta(days=days)).isoformat()
        to = today.isoformat()
        try:
            raw = self.finnhub_client.company_news(symbol, _from=frm, to=to) or []
        except Exception as exc:
            logger.debug("Finnhub 新聞 %s 失敗：%s", symbol, exc)
            return []
        news = []
        for item in raw[:limit]:
            news.append({
                "title": item.get("headline"),
                "link": item.get("url"),
                "source": item.get("source", "Finnhub"),
                "summary": item.get("summary", ""),
            })
        return news

    # ------------------------------------------------------------------
    #  整合：watchlist
    # ------------------------------------------------------------------
    def get_watchlist_data(self, stocks: list) -> list:
        results = []
        for item in stocks:
            symbol = item["symbol"]
            history = self.get_history(symbol, period="6mo", interval="1d")
            quote = self.get_quote(symbol, history=history)
            financials = self.get_basic_financials(symbol)
            results.append({
                "symbol": symbol,
                "name": item.get("name", symbol),
                "quote": quote,
                "financials": financials,
                "history": history,
            })
        return results
