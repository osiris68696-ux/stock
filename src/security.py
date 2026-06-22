"""集中式安全控制模組。

本模組是整個專案唯一對外連線、讀寫檔案、讀取環境變數的「閘門」：

  1. 網域白名單     ALLOWED_DOMAINS — 只允許連線到清單內的官方資料來源
  2. 安全 HTTP      safe_get() / safe_post() — 強制 HTTPS + 白名單 + 驗證憑證
  3. 阻擋指令執行   forbid_command_execution() — 任何 shell / 系統指令一律拒絕
  4. 路徑驗證       validate_read_path() / validate_write_path() — 僅限專案內，寫入限定資料夾
  5. 環境變數白名單 get_env() — 只允許讀取 4 個指定變數

設計原則：寧可「拒絕並降級」也不放行未授權的連線 / 檔案 / 指令。
"""
from __future__ import annotations

import logging
import os
import random
import time
from datetime import datetime
from urllib.parse import urlparse

import requests

logger = logging.getLogger(__name__)


class SecurityError(Exception):
    """違反安全政策時拋出。呼叫端應捕捉並安全降級 (略過該來源)。"""


class CircuitOpenError(Exception):
    """網域已被熔斷器標記 DOWN，本次任務直接 Fail Fast。呼叫端應安全降級。"""


# ======================================================================
#  1. 外部連線網域白名單
# ======================================================================
# 只允許連線到下列官方 / 受信任資料來源。子網域 (例如 feeds.finance.yahoo.com)
# 會自動視為其母網域 (finance.yahoo.com) 的一部分而放行。
ALLOWED_DOMAINS = frozenset({
    # 台灣證券交易所 / 公開資訊
    "openapi.twse.com.tw",
    "mis.twse.com.tw",
    "mops.twse.com.tw",
    "www.twse.com.tw",            # ※ 白名單外的必要追加：三大法人 RWD 端點 (官方 TWSE 網域)
    # Yahoo Finance (yfinance 與新聞 RSS)
    "query1.finance.yahoo.com",
    "query2.finance.yahoo.com",
    "finance.yahoo.com",
    # 基本面 / 報價
    "finnhub.io",
    # 通知
    "api.telegram.org",
    # 財經新聞
    "www.moneydj.com",
    "news.cnyes.com",
    # 台股量化交叉驗證 (輔助，不取代本系統)
    "taiwan-equity-quant-tool.taiquant.workers.dev",
})

DEFAULT_TIMEOUT = 25


def domain_of(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower()
    except Exception:
        return ""


def is_domain_allowed(url: str) -> bool:
    """主機是否在白名單內 (含子網域)。"""
    host = domain_of(url)
    if not host:
        return False
    return any(host == d or host.endswith("." + d) for d in ALLOWED_DOMAINS)


def _check_url(url: str, method: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise SecurityError(f"只允許 HTTPS，已阻擋 {method} {url}")
    if not is_domain_allowed(url):
        raise SecurityError(f"網域不在白名單，已阻擋 {method} {parsed.hostname or url}")


# ----------------------------------------------------------------------
#  熔斷器 (Circuit Breaker) + 抖動重試 (Jitter Retry)
# ----------------------------------------------------------------------
MAX_RETRY = 3                 # 最多重試次數
BREAKER_THRESHOLD = 2         # 同網域連續失敗達此數 → 標記 DOWN，本次任務 Fail Fast
_JITTER = {1: (1.0, 0.5), 2: (2.0, 0.5), 3: (4.0, 1.0)}  # attempt -> (base, spread)


class _Retryable(Exception):
    """可重試的 HTTP 狀態 (429 / 5xx)。"""


class CircuitBreaker:
    """以網域為單位記錄連續失敗；達門檻即標記 DOWN。任務開始時 reset。"""

    def __init__(self, threshold: int = BREAKER_THRESHOLD):
        self.threshold = threshold
        self._fail = {}
        self._down = set()

    def is_down(self, domain: str) -> bool:
        return domain in self._down

    def record_failure(self, domain: str) -> int:
        n = self._fail.get(domain, 0) + 1
        self._fail[domain] = n
        if n >= self.threshold:
            self._down.add(domain)
        return n

    def record_success(self, domain: str) -> None:
        self._fail.pop(domain, None)
        self._down.discard(domain)

    def reset(self) -> None:
        self._fail.clear()
        self._down.clear()

    def status(self) -> dict:
        return {"down": sorted(self._down), "failures": dict(self._fail)}


_breaker = CircuitBreaker()


def reset_circuit() -> None:
    """每次任務開始時呼叫，清空熔斷狀態。"""
    _breaker.reset()


def _jitter(attempt: int) -> float:
    base, spread = _JITTER.get(attempt, (4.0, 1.0))
    return max(0.0, base + random.uniform(-spread, spread))


def _request_with_guard(method: str, url: str, http, kwargs) -> requests.Response:
    domain = domain_of(url)
    if api_over_limit():
        raise SecurityError(f"已達每日 API 上限 ({DAILY_API_LIMIT})，略過 {method} {domain}")
    note_api_call()
    if _breaker.is_down(domain):
        raise CircuitOpenError(f"{domain} 已熔斷(DOWN)，本次任務跳過")

    last = None
    for attempt in range(1, MAX_RETRY + 1):
        try:
            resp = http.request(method, url, verify=True, **kwargs)
            if resp.status_code == 429 or 500 <= resp.status_code < 600:
                raise _Retryable(f"HTTP {resp.status_code}")
            _breaker.record_success(domain)
            return resp
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError, _Retryable) as exc:
            last = exc
            n = _breaker.record_failure(domain)
            if n >= BREAKER_THRESHOLD:
                security_log(f"Circuit DOWN: {domain} 連續失敗 {n} 次 ({exc})，本次任務 Fail Fast")
                raise CircuitOpenError(f"{domain} 連續失敗 {n} 次，已熔斷") from exc
            if attempt < MAX_RETRY:
                time.sleep(_jitter(attempt))
            else:
                raise
    raise last if last else RuntimeError("unreachable")


def safe_get(url: str, *, params=None, headers=None, timeout: int = DEFAULT_TIMEOUT,
             session: requests.Session = None, stream: bool = False) -> requests.Response:
    """白名單 + HTTPS + 驗證憑證 的 GET，含熔斷器與抖動重試。"""
    _check_url(url, "GET")
    http = session or requests.Session()
    return _request_with_guard(
        "GET", url, http,
        {"params": params, "headers": headers, "timeout": timeout, "stream": stream})


def safe_post(url: str, *, data=None, json=None, params=None, headers=None,
              timeout: int = DEFAULT_TIMEOUT) -> requests.Response:
    """白名單 + HTTPS + 驗證憑證 的 POST，含熔斷器與抖動重試。

    刻意不支援 files 參數 — 本專案禁止透過此通道上傳任何檔案 (Telegram 只發文字)。
    """
    _check_url(url, "POST")
    return _request_with_guard(
        "POST", url, requests.Session(),
        {"data": data, "json": json, "params": params, "headers": headers, "timeout": timeout})


# ----------------------------------------------------------------------
#  稽核日誌 (security.log / scheduler.log)
# ----------------------------------------------------------------------
def _append_log(filename: str, msg: str) -> None:
    try:
        path = validate_write_path(os.path.join(PROJECT_ROOT, "logs", filename))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a", encoding="utf-8") as f:
            f.write(f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}\n")
    except Exception as exc:  # 日誌失敗不可影響主流程
        logger.debug("寫入 %s 失敗：%s", filename, exc)


def security_log(msg: str) -> None:
    _append_log("security.log", msg)


def scheduler_log(msg: str) -> None:
    _append_log("scheduler.log", msg)


# ======================================================================
#  2. 阻擋指令執行 (no os.system / subprocess / eval / exec / shell)
# ======================================================================
def forbid_command_execution(*_args, **_kwargs):
    """任何嘗試執行系統指令 / shell / eval / exec 都會被拒絕。

    本專案不需要、也一律不允許執行外部命令；保留此函式作為明確的拒絕點，
    並可在需要時作為「絕不執行」的佔位符 (例如被注入的設定值)。
    """
    raise SecurityError("已停用：本程式禁止執行任何系統指令 / shell / eval / exec。")


# 友善別名 — 任何呼叫都會被擋下
run_command = system = popen = shell = run = forbid_command_execution


# ======================================================================
#  3. 路徑驗證 (僅限專案資料夾；寫入限定 reports/ logs/ config/)
# ======================================================================
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALLOWED_WRITE_DIRS = ("reports", "logs", "config")


def _real(path: str) -> str:
    """正規化並解析符號連結，避免 ../ 或 symlink 逃逸。"""
    return os.path.normcase(os.path.realpath(os.path.abspath(path)))


def is_within_project(path: str) -> bool:
    root = _real(PROJECT_ROOT)
    p = _real(path)
    return p == root or p.startswith(root + os.sep)


def validate_read_path(path: str) -> str:
    """只允許讀取專案資料夾內的檔案 (擋掉 Desktop / Documents / AppData / SSH 等)。"""
    if not is_within_project(path):
        raise SecurityError(f"禁止讀取專案外路徑：{path}")
    return path


def validate_write_path(path: str) -> str:
    """只允許寫入專案內的 reports/ logs/ config/。"""
    if not is_within_project(path):
        raise SecurityError(f"禁止寫入專案外路徑：{path}")
    rel = os.path.relpath(_real(path), _real(PROJECT_ROOT))
    top = rel.split(os.sep)[0]
    if top not in ALLOWED_WRITE_DIRS:
        raise SecurityError(f"只允許寫入 {ALLOWED_WRITE_DIRS}，已阻擋：{path}")
    return path


def ensure_write_dir(path: str) -> str:
    """驗證後建立資料夾並回傳路徑。"""
    validate_write_path(path)
    os.makedirs(path, exist_ok=True)
    return path


# ======================================================================
#  4. 環境變數白名單 (只允許讀取這 4 個)
# ======================================================================
ALLOWED_ENV_VARS = frozenset({
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
    "FINNHUB_API_KEY",
    "TIMEZONE",
})


def get_env(name: str, default=None):
    """只允許讀取白名單內的環境變數；其餘一律拒絕。"""
    if name not in ALLOWED_ENV_VARS:
        raise SecurityError(f"環境變數 {name} 不在白名單，禁止讀取。")
    return os.getenv(name, default)


# ======================================================================
#  6. 每日 API 呼叫上限 (防失控)
# ======================================================================
DAILY_API_LIMIT = 2000
_API_COUNT_PATH = os.path.join(PROJECT_ROOT, "logs", "api_count.json")
_api_state = None   # {"date": "YYYY-MM-DD", "count": int}
_api_limit_logged = False


def _today_str():
    return datetime.now().strftime("%Y-%m-%d")


def _load_api_state():
    global _api_state
    if _api_state is not None and _api_state.get("date") == _today_str():
        return _api_state
    state = {"date": _today_str(), "count": 0}
    try:
        with open(_API_COUNT_PATH, "r", encoding="utf-8") as f:
            data = __import__("json").load(f)
        if data.get("date") == _today_str():
            state["count"] = int(data.get("count", 0))
    except Exception:
        pass
    _api_state = state
    return state


def note_api_call(n: int = 1) -> int:
    """記一筆外部 API 呼叫；回傳今日累計。超過上限時寫入 security.log (僅一次)。"""
    global _api_limit_logged
    state = _load_api_state()
    state["count"] += n
    try:
        os.makedirs(os.path.dirname(_API_COUNT_PATH), exist_ok=True)
        with open(_API_COUNT_PATH, "w", encoding="utf-8") as f:
            __import__("json").dump(state, f)
    except Exception:
        pass
    if state["count"] > DAILY_API_LIMIT and not _api_limit_logged:
        _api_limit_logged = True
        security_log(f"每日 API 上限：今日已達 {state['count']} 次 (> {DAILY_API_LIMIT})，後續呼叫將被略過。")
    return state["count"]


def api_over_limit() -> bool:
    return _load_api_state()["count"] > DAILY_API_LIMIT


def api_calls_today() -> int:
    return _load_api_state()["count"]
