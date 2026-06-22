"""公司基本面資料層 (價值 + 成長分析用)。

台股 (官方 + yfinance 互補)：
  - TWSE OpenAPI BWIBBU_ALL          → 本益比 P/E、殖利率、股價淨值比 P/B
  - TWSE OpenAPI t187ap05_L (月營收)  → 營收年增率 (官方)
  - TWSE OpenAPI t187ap14_L (財報)    → 基本每股盈餘 EPS、產業別
  - yfinance .TW .info               → Forward P/E、EPS成長率、分析師目標價/評等

美股：
  - yfinance .info                   → P/E、Forward P/E、EPS/營收成長、目標價、評等、產業
  - Finnhub (若有金鑰)               → 補充

所有 TWSE 連線一律經過 security.safe_get (白名單 + HTTPS + 驗證憑證)。
本模組只整理客觀數據，不產生買賣建議。
"""
from __future__ import annotations

import logging
from typing import Dict, Optional

import requests

import security
import us_stock_client

logger = logging.getLogger(__name__)

TWSE_BWIBBU = "https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL"
TWSE_REVENUE = "https://openapi.twse.com.tw/v1/opendata/t187ap05_L"
TWSE_FINSTAT = "https://openapi.twse.com.tw/v1/opendata/t187ap14_L"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AI-Stock-Research-Assistant",
    "Referer": "https://www.twse.com.tw/",
    "Accept": "application/json, text/plain, */*",
}
TIMEOUT = 30


def _f(value) -> Optional[float]:
    if value is None:
        return None
    s = str(value).replace(",", "").replace("%", "").strip()
    if s in ("", "--", "-", "N/A", "null"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _pct(value) -> Optional[float]:
    """把 yfinance 的比率 (0.852) 轉成百分比 (85.2)。"""
    f = _f(value)
    return round(f * 100, 2) if f is not None else None


def _first(record: dict, *keys):
    for k in keys:
        if k in record and record[k] not in (None, ""):
            return record[k]
    return None


class FundamentalsProvider:
    """提供台股 / 美股統一基本面字典；台股全市場資料一次抓取後快取。"""

    def __init__(self, us_client, session: Optional[requests.Session] = None):
        self.us_client = us_client
        self.session = session or requests.Session()
        self.session.headers.update(HEADERS)
        self._bwibbu: Optional[Dict[str, dict]] = None
        self._rev: Optional[Dict[str, dict]] = None
        self._eps: Optional[Dict[str, dict]] = None

    # --- TWSE 全市場資料 (經 security.safe_get) ---
    def _get_json(self, url: str):
        try:
            resp = security.safe_get(url, session=self.session, timeout=TIMEOUT)
            resp.raise_for_status()
            data = resp.json()
            return data if isinstance(data, list) else []
        except security.SecurityError as exc:
            logger.info("安全政策略過：%s", exc)
            return []
        except Exception as exc:
            logger.warning("基本面抓取失敗 %s : %s", url, exc)
            return []

    def _ensure_tw(self) -> None:
        if self._bwibbu is not None:
            return
        self._bwibbu = {r["Code"]: r for r in self._get_json(TWSE_BWIBBU) if r.get("Code")}
        self._rev = {r["公司代號"]: r for r in self._get_json(TWSE_REVENUE) if r.get("公司代號")}
        self._eps = {r["公司代號"]: r for r in self._get_json(TWSE_FINSTAT) if r.get("公司代號")}
        logger.info("台股基本面快取完成：P/E %d 檔、月營收 %d 檔、EPS %d 檔。",
                    len(self._bwibbu), len(self._rev), len(self._eps))

    # ------------------------------------------------------------------
    #  台股
    # ------------------------------------------------------------------
    def get_tw(self, code: str, price: Optional[float], is_etf: bool = False) -> dict:
        self._ensure_tw()
        b = self._bwibbu.get(code, {})
        rev = self._rev.get(code, {})
        eps = self._eps.get(code, {})

        pe = _f(b.get("PEratio"))
        pb = _f(b.get("PBratio"))
        dy = _f(b.get("DividendYield"))
        if pe is not None and pe <= 0:
            pe = None
        if pb is not None and pb <= 0:
            pb = None

        revenue_yoy = _f(rev.get("營業收入-去年同月增減(%)"))
        revenue_cum_yoy = _f(rev.get("累計營業收入-前期比較增減(%)"))
        q_eps = _f(_first(eps, "基本每股盈餘(元)", "基本每股盈餘（元）"))
        sector = _first(rev, "產業別") or _first(eps, "產業別")
        rev_month = _first(rev, "資料年月")

        info = {} if is_etf else self.us_client.get_info(f"{code}.TW")
        fund = us_stock_client.extract_fundamentals(info, price, is_etf=is_etf)
        fund["market"] = "TW"
        # 以證交所官方資料為主，覆蓋 yfinance；台股營收年增採官方『月營收』YoY
        if pe is not None:
            fund["pe"] = pe
            fund["trailing_pe"] = pe
            fund["pe_source"] = "TWSE BWIBBU(月底本益比)"
        if pb is not None:
            fund["pb"] = pb
        if dy is not None:
            fund["dividend_yield"] = dy
        if revenue_yoy is not None:
            fund["revenue_yoy_pct"] = revenue_yoy
            fund["revenue_yoy_basis"] = f"官方月營收 YoY ({rev_month})"
        fund["revenue_cum_yoy_pct"] = revenue_cum_yoy
        fund["quarter_eps"] = q_eps     # 官方最新季 EPS
        fund["sector"] = sector or fund.get("sector")
        fund["data_source"] = "TWSE + yfinance"
        return fund

    # ------------------------------------------------------------------
    #  美股
    # ------------------------------------------------------------------
    def get_us(self, symbol: str, price: Optional[float], is_etf: bool = False) -> dict:
        info = {} if is_etf else self.us_client.get_info(symbol)
        return us_stock_client.extract_fundamentals(info, price, is_etf=is_etf)

    # ------------------------------------------------------------------
    #  下次法說 / 財報 (只對少數要顯示的標的呼叫，避免拖慢全市場掃描)
    # ------------------------------------------------------------------
    def attach_earnings(self, fund: dict, symbol: str, market: str) -> dict:
        yf_symbol = f"{symbol}.TW" if market == "TW" else symbol
        e = self.us_client.get_earnings(yf_symbol)
        fund["next_earnings"] = e.get("next_date")
        fund["eps_estimate"] = _f(e.get("eps_estimate"))
        return fund


# ----------------------------------------------------------------------
#  文字輔助：估值 / 成長判斷、法說摘要
# ----------------------------------------------------------------------
def valuation_verdict(fund: dict) -> str:
    pe = fund.get("pe")
    peg = fund.get("peg")
    if pe is None:
        return "估值資料不足"
    if pe <= 15:
        base = "估值偏低（相對便宜）"
    elif pe <= 25:
        base = "估值合理"
    else:
        base = "估值偏高"
    if peg is not None and 0 < peg <= 1:
        base += "，PEG<1 成長相對便宜"
    return base


def growth_verdict(fund: dict) -> str:
    eg = fund.get("eps_growth_pct")
    ry = fund.get("revenue_yoy_pct")
    best = max([x for x in (eg, ry) if x is not None], default=None)
    if best is None:
        return "成長資料不足"
    if best >= 30:
        return "高成長"
    if best >= 10:
        return "穩健成長"
    if best < 0:
        return "成長轉弱（年減）"
    return "成長平緩"


def earnings_summary(fund: dict) -> str:
    """『法說 / 財報重點』(非逐字稿)，明確標示 EPS 單位與資料來源。"""
    parts = []
    if fund.get("quarter_eps") is not None:
        parts.append(f"最新季EPS {fund['quarter_eps']:.2f}")
    if fund.get("ttm_eps") is not None:
        parts.append(f"TTM EPS {fund['ttm_eps']:.2f}")
    if fund.get("forward_eps") is not None:
        parts.append(f"Forward EPS {fund['forward_eps']:.2f}")
    if fund.get("eps_growth_pct") is not None:
        parts.append(f"最近一季EPS YoY {fund['eps_growth_pct']:+.0f}%")
    if fund.get("revenue_yoy_pct") is not None:
        basis = fund.get("revenue_yoy_basis", "最近一季營收 YoY")
        parts.append(f"營收年增 {fund['revenue_yoy_pct']:+.0f}%（{basis if 'YoY' in basis else basis}）"
                     if fund.get("revenue_yoy_basis") else f"營收年增 {fund['revenue_yoy_pct']:+.0f}%")
    if fund.get("recommendation"):
        n = fund.get("analyst_count") or 0
        parts.append(f"分析師評等 {fund['recommendation']}（{n}位）")
    if fund.get("target_mean") is not None:
        up = fund.get("target_upside_pct")
        up_s = f"，上檔 {up:.0f}%" if up is not None else ""
        parts.append(f"目標均價 {fund['target_mean']:.1f}{up_s}")
    if fund.get("next_earnings"):
        est = fund.get("eps_estimate")
        est_s = f"（市場預估 EPS {est:.2f}）" if est is not None else ""
        parts.append(f"下次財報約 {fund['next_earnings']}{est_s}")
    return "；".join(parts) if parts else "資料不足"


def fundamental_summary(fund: dict) -> str:
    """完整公司基本面摘要 (供 /fundamental 與報告使用)，含單位與來源標示。"""
    def g(k, fmt="{:.2f}", suffix=""):
        v = fund.get(k)
        return (fmt.format(v) + suffix) if v is not None else "資料不足"

    lines = [
        f"  TTM EPS：{g('ttm_eps')}　Forward EPS：{g('forward_eps')}　最新季EPS：{g('quarter_eps')}",
        f"  Trailing P/E：{g('trailing_pe', '{:.1f}')}（用 TTM EPS）　Forward P/E：{g('forward_pe', '{:.1f}')}（用 Forward EPS）",
        f"  最近一季 EPS YoY：{g('eps_growth_pct', '{:+.0f}', '%')}　營收年增：{g('revenue_yoy_pct', '{:+.0f}', '%')}",
        f"  EPS 趨勢：{fund.get('eps_trend', '資料不足')}",
        f"  分析師評等：{fund.get('recommendation') or '資料不足'}（{fund.get('analyst_count') or 0}位）"
        f"　目標均價：{g('target_mean', '{:.1f}')}（上檔 {g('target_upside_pct', '{:+.0f}', '%')}）",
        f"  下次財報：{fund.get('next_earnings') or '資料不足'}",
        f"  資料來源：{fund.get('data_source', 'yfinance')}；P/E 來源：{fund.get('pe_source', 'yfinance')}",
    ]
    return "\n".join(lines)
