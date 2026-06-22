"""交易日判斷 (台股 / 美股)。

週六日 + 設定檔內的休市日 → 非交易日。休市日來源：
  - config/tw_market_holidays.json (含 holidays 與 typhoon_closures 颱風臨時休市)
  - config/us_market_holidays.json

對外函式：
  - is_tw_trading_day(date)
  - is_us_trading_day(date)
  - get_market_status(date) -> {tw_open, us_open, tw_reason, us_reason}
  - should_run_report(date) -> 是否要產生報告 (以台股是否開盤為準)
"""
from __future__ import annotations

import json
import logging
import os
from datetime import date as _date

import security

logger = logging.getLogger(__name__)

_TW_PATH = os.path.join(security.PROJECT_ROOT, "config", "tw_market_holidays.json")
_US_PATH = os.path.join(security.PROJECT_ROOT, "config", "us_market_holidays.json")

_tw_cache = None
_us_cache = None


def _load(path):
    """回傳 {YYYY-MM-DD: 名稱} 的休市日對照表。"""
    holidays = {}
    try:
        security.validate_read_path(path)
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        for item in (data.get("holidays") or []) + (data.get("typhoon_closures") or []):
            if item.get("date"):
                holidays[item["date"]] = item.get("name", "休市")
    except Exception as exc:
        logger.warning("讀取休市日設定失敗 %s：%s", os.path.basename(path), exc)
    return holidays


def _tw_holidays():
    global _tw_cache
    if _tw_cache is None:
        _tw_cache = _load(_TW_PATH)
    return _tw_cache


def _us_holidays():
    global _us_cache
    if _us_cache is None:
        _us_cache = _load(_US_PATH)
    return _us_cache


def _as_date(d):
    return d or _date.today()


def _weekend_reason(d):
    # weekday(): 5=六, 6=日
    return "週六" if d.weekday() == 5 else ("週日" if d.weekday() == 6 else None)


# ----------------------------------------------------------------------
def is_tw_trading_day(d: _date = None) -> bool:
    d = _as_date(d)
    if d.weekday() >= 5:
        return False
    return d.isoformat() not in _tw_holidays()


def is_us_trading_day(d: _date = None) -> bool:
    d = _as_date(d)
    if d.weekday() >= 5:
        return False
    return d.isoformat() not in _us_holidays()


def get_market_status(d: _date = None) -> dict:
    """回傳台股 / 美股當日開休市狀態與原因。"""
    d = _as_date(d)
    key = d.isoformat()

    tw_open = is_tw_trading_day(d)
    us_open = is_us_trading_day(d)
    tw_reason = "" if tw_open else (_weekend_reason(d) or _tw_holidays().get(key, "休市"))
    us_reason = "" if us_open else (_weekend_reason(d) or _us_holidays().get(key, "Holiday"))
    return {
        "date": key,
        "tw_open": tw_open, "us_open": us_open,
        "tw_reason": tw_reason, "us_reason": us_reason,
    }


def should_run_report(d: _date = None) -> bool:
    """是否要產生報告：以台股是否開盤為準 (台股休市 → 不產生一般報告)。"""
    return is_tw_trading_day(d)
