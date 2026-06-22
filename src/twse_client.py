"""台股資料客戶端 (TWSE 上市 + TPEx 上櫃)。

資料來源皆為免費、免金鑰的政府 OpenAPI：
  - 台灣證券交易所  TWSE  https://openapi.twse.com.tw/
  - 證券櫃買中心    TPEx  https://www.tpex.org.tw/openapi/

提供：
  - 個股每日成交資訊 (開高低收 / 量 / 漲跌)
  - 三大法人 (外資 / 投信 / 自營商) 買賣超

注意：OpenAPI 一次回傳「最近一個交易日」全市場資料，
本模組會抓一次後建立快取，再依股票代號查詢。
"""
from __future__ import annotations

import logging
from typing import Dict, Optional

import requests

import security

logger = logging.getLogger(__name__)

# --- 資料端點 ---
# 上市個股每日成交：OpenAPI (穩定)
TWSE_STOCK_DAY_ALL = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL"
# 上市三大法人：改用證交所 RWD JSON (OpenAPI 的 /v1/fund/* 目前回傳維護頁，故用此來源)
TWSE_RWD_T86 = "https://www.twse.com.tw/rwd/zh/fund/T86"
# 上市融資融券 (per-stock)：OpenAPI
TWSE_MARGIN = "https://openapi.twse.com.tw/v1/exchangeReport/MI_MARGN"
# 上櫃：櫃買中心 OpenAPI
TPEX_DAILY = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes"
TPEX_INSTI = "https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AI-Stock-Research-Assistant",
    "Referer": "https://www.twse.com.tw/",
    "Accept": "application/json, text/plain, */*",
}
TIMEOUT = 25


# ----------------------------------------------------------------------
#  小工具
# ----------------------------------------------------------------------
def _to_float(value) -> Optional[float]:
    """把 '1,234.5' / '--' / '' 之類字串安全轉成 float。"""
    if value is None:
        return None
    s = str(value).replace(",", "").replace("+", "").strip()
    if s in ("", "--", "-", "N/A", "null", "X"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _to_int(value) -> Optional[int]:
    f = _to_float(value)
    return int(f) if f is not None else None


def _first(record: dict, *keys):
    """回傳 record 中第一個存在且非空的 key 值。"""
    for k in keys:
        if k in record and record[k] not in (None, ""):
            return record[k]
    return None


# ----------------------------------------------------------------------
#  主客戶端
# ----------------------------------------------------------------------
class TWSEClient:
    """台股 (上市 + 上櫃) 資料客戶端，內建當日全市場快取。"""

    def __init__(self, session: Optional[requests.Session] = None):
        self.session = session or requests.Session()
        self.session.headers.update(HEADERS)
        self._daily_cache: Optional[Dict[str, dict]] = None
        self._insti_cache: Optional[Dict[str, dict]] = None
        # 三大法人多日序列 (最近日在前)：list[ {code: 三大法人合計(張)} ]
        self._insti_days: Optional[list] = None
        self._margin_cache: Optional[Dict[str, dict]] = None

    # --- 低階 HTTP (一律經過 security.safe_get：白名單 + HTTPS + 驗證憑證) ---
    def _get(self, url: str):
        return security.safe_get(url, session=self.session, timeout=TIMEOUT)

    def _get_json(self, url: str):
        try:
            resp = self._get(url)
            resp.raise_for_status()
            data = resp.json()
            return data if isinstance(data, list) else []
        except security.SecurityError as exc:   # 非白名單 (例如 TPEx 上櫃) → 安全略過
            logger.info("安全政策略過：%s", exc)
            return []
        except Exception as exc:  # 網路 / JSON / HTTP 任何問題都不讓主流程掛掉
            logger.warning("抓取失敗 %s : %s", url, exc)
            return []

    # ------------------------------------------------------------------
    #  每日行情
    # ------------------------------------------------------------------
    def _build_daily_cache(self) -> Dict[str, dict]:
        cache: Dict[str, dict] = {}

        # 上市
        for row in self._get_json(TWSE_STOCK_DAY_ALL):
            code = row.get("Code")
            if not code:
                continue
            cache[code] = {
                "code": code,
                "name": row.get("Name"),
                "market": "上市",
                "open": _to_float(row.get("OpeningPrice")),
                "high": _to_float(row.get("HighestPrice")),
                "low": _to_float(row.get("LowestPrice")),
                "close": _to_float(row.get("ClosingPrice")),
                "change": _to_float(row.get("Change")),
                "volume": _to_int(row.get("TradeVolume")),       # 股
                "value": _to_int(row.get("TradeValue")),         # 元
                "transactions": _to_int(row.get("Transaction")),
            }

        # 上櫃 (TPEx 欄位名稱與 TWSE 不同，用候選 key 容錯)
        for row in self._get_json(TPEX_DAILY):
            code = _first(row, "SecuritiesCompanyCode", "Code", "代號", "股票代號")
            if not code:
                continue
            cache[str(code)] = {
                "code": str(code),
                "name": _first(row, "CompanyName", "Name", "名稱"),
                "market": "上櫃",
                "open": _to_float(_first(row, "Open", "OpeningPrice", "開盤")),
                "high": _to_float(_first(row, "High", "HighestPrice", "最高")),
                "low": _to_float(_first(row, "Low", "LowestPrice", "最低")),
                "close": _to_float(_first(row, "Close", "ClosingPrice", "收盤")),
                "change": _to_float(_first(row, "Change", "漲跌")),
                "volume": _to_int(_first(row, "TradingShares", "TradeVolume", "成交股數")),
                "value": _to_int(_first(row, "TransactionAmount", "TradeValue", "成交金額")),
                "transactions": _to_int(_first(row, "TransactionNumber", "Transaction", "成交筆數")),
            }

        logger.info("台股每日行情快取完成，共 %d 檔。", len(cache))
        return cache

    def get_daily(self, code: str) -> Optional[dict]:
        """取得單一股票的當日行情；找不到回傳 None。"""
        if self._daily_cache is None:
            self._daily_cache = self._build_daily_cache()
        data = self._daily_cache.get(str(code))
        if data and data.get("close") is not None and data.get("change") is not None:
            base = data["close"] - data["change"]
            data["change_pct"] = round(data["change"] / base * 100, 2) if base else None
        return data

    # ------------------------------------------------------------------
    #  三大法人
    # ------------------------------------------------------------------
    @staticmethod
    def _parse_insti_row(row: dict, code: str, market: str) -> dict:
        """從 T86 / TPEx 三大法人原始列解析外資 / 投信 / 自營商買賣超。

        欄位名稱在不同來源略有差異，故以關鍵字掃描所有欄位，
        只挑「買賣超 / 差額 / difference / net」性質的數值欄位加總。
        單位由「股」換算為「張」(/1000)。
        """
        foreign = trust = dealer = 0.0
        total: Optional[float] = None
        found = False

        for key, val in row.items():
            k = str(key)
            kl = k.lower()
            is_net = (
                "diff" in kl or "net" in kl
                or "買賣超" in k or "差額" in k or "淨額" in k or "淨買" in k
            )
            if not is_net:
                continue
            num = _to_float(val)
            if num is None:
                continue

            if "total" in kl or "合計" in k or "三大法人" in k:
                total = num
                continue
            if "foreign" in kl or "外資" in k or "外陸資" in k:
                foreign += num
                found = True
            elif "trust" in kl or "investment" in kl or "投信" in k:
                trust += num
                found = True
            elif "dealer" in kl or "自營" in k:
                # 只取「自營商買賣超」合計，排除自行買賣 / 避險明細，避免重複計算
                if "自行" in k or "避險" in k or "hedg" in kl or "self" in kl:
                    continue
                dealer += num
                found = True

        if total is None and found:
            total = foreign + trust + dealer

        def lots(x: Optional[float]) -> Optional[int]:
            return int(round(x / 1000)) if x is not None else None

        return {
            "code": str(code),
            "market": market,
            "foreign": lots(foreign) if found else None,  # 外資 (含外資自營商)，單位：張
            "trust": lots(trust) if found else None,       # 投信
            "dealer": lots(dealer) if found else None,      # 自營商
            "total": lots(total),                           # 三大法人合計
        }

    def _fetch_t86_date(self, ds: str) -> Optional[list]:
        """抓某一交易日 (YYYYMMDD) 的上市三大法人 (RWD JSON)。

        回傳 list[dict]；當天無資料 (假日 / 尚未產出) 回傳 None。
        回應為欄位 (fields) + 資料列 (data) 的二維結構，轉成 list[dict]。
        """
        url = f"{TWSE_RWD_T86}?date={ds}&selectType=ALLBUT0999&response=json"
        try:
            resp = self._get(url)
            payload = resp.json()
        except security.SecurityError as exc:
            logger.info("安全政策略過：%s", exc)
            return None
        except Exception as exc:
            logger.debug("RWD T86 %s 失敗：%s", ds, exc)
            return None
        if payload.get("stat") == "OK" and payload.get("data"):
            fields = payload.get("fields") or []
            return [dict(zip(fields, row)) for row in payload["data"]]
        return None

    def _build_insti_cache(self, max_days: int = 4) -> None:
        """建立三大法人快取：最近 max_days 個交易日 (上市) + 當日上櫃。"""
        from datetime import date, timedelta

        self._insti_days = []          # 最近日在前，每筆 {code: 合計(張)}
        self._insti_cache = {}         # 最近交易日的完整解析 {code: parsed}

        today = date.today()
        collected = 0
        for back in range(0, 14):
            if collected >= max_days:
                break
            day = today - timedelta(days=back)
            if day.weekday() >= 5:     # 週末略過
                continue
            rows = self._fetch_t86_date(day.strftime("%Y%m%d"))
            if not rows:
                continue
            net_map: Dict[str, Optional[int]] = {}
            for row in rows:
                code = _first(row, "證券代號", "Code")
                if not code:
                    continue
                code = str(code).strip()
                parsed = self._parse_insti_row(row, code, "上市")
                net_map[code] = parsed["total"]
                if collected == 0:     # 最近交易日存完整資料
                    self._insti_cache[code] = parsed
            self._insti_days.append(net_map)
            collected += 1
            if collected == 1:
                logger.info("三大法人(上市) 最新日 %s，共 %d 檔。",
                            day.strftime("%Y-%m-%d"), len(rows))

        # 上櫃 (TPEx OpenAPI，僅當日)
        for row in self._get_json(TPEX_INSTI):
            code = _first(row, "SecuritiesCompanyCode", "Code", "代號")
            if code:
                code = str(code).strip()
                self._insti_cache[code] = self._parse_insti_row(row, code, "上櫃")

        logger.info("三大法人快取完成 (含 %d 個交易日序列)，共 %d 檔。",
                    len(self._insti_days), len(self._insti_cache))

    def _ensure_insti(self) -> None:
        if self._insti_cache is None or self._insti_days is None:
            self._build_insti_cache()

    def get_institutional(self, code: str) -> Optional[dict]:
        """取得單一股票最近交易日三大法人買賣超 (單位：張)。"""
        self._ensure_insti()
        return self._insti_cache.get(str(code))

    def get_consecutive_sell_days(self, code: str) -> int:
        """三大法人 (上市) 從最近交易日往回連續『賣超』的天數。

        無資料或上櫃股票回傳 0。
        """
        self._ensure_insti()
        code = str(code)
        count = 0
        for net_map in self._insti_days or []:
            net = net_map.get(code)
            if net is None or net >= 0:
                break
            count += 1
        return count

    def _ensure_margin(self) -> None:
        if self._margin_cache is not None:
            return
        cache: Dict[str, dict] = {}
        for row in self._get_json(TWSE_MARGIN):
            code = _first(row, "股票代號", "Code")
            if not code:
                continue
            m_now = _to_int(row.get("融資今日餘額"))
            m_prev = _to_int(row.get("融資前日餘額"))
            s_now = _to_int(row.get("融券今日餘額"))
            s_prev = _to_int(row.get("融券前日餘額"))
            cache[str(code).strip()] = {
                "margin_balance": m_now,                                  # 融資餘額 (張)
                "margin_change": (m_now - m_prev) if (m_now is not None and m_prev is not None) else None,
                "short_balance": s_now,                                   # 融券餘額 (張)
                "short_change": (s_now - s_prev) if (s_now is not None and s_prev is not None) else None,
            }
        self._margin_cache = cache
        logger.info("融資融券快取完成，共 %d 檔。", len(cache))

    def get_margin(self, code: str) -> Optional[dict]:
        """取得融資 / 融券餘額與增減 (張)。"""
        self._ensure_margin()
        return self._margin_cache.get(str(code))

    def get_market_foreign_net(self) -> Optional[int]:
        """全市場 (上市) 外資買賣超合計 (張)；用於市場狀態判斷。"""
        self._ensure_insti()
        total, found = 0, False
        for v in (self._insti_cache or {}).values():
            f = v.get("foreign")
            if f is not None:
                total += f
                found = True
        return int(total) if found else None

    # ------------------------------------------------------------------
    #  整合：watchlist 一次取回
    # ------------------------------------------------------------------
    def get_watchlist_data(self, stocks: list) -> list:
        """輸入 watchlist 的 tw_stocks 清單，回傳整合後的分析資料。"""
        results = []
        for item in stocks:
            code = item["symbol"]
            daily = self.get_daily(code) or {}
            insti = self.get_institutional(code) or {}
            results.append({
                "symbol": code,
                "name": item.get("name") or daily.get("name") or code,
                "market": daily.get("market", "—"),
                "daily": daily,
                "institutional": insti,
            })
        return results
