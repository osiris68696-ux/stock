"""新聞抓取與摘要。

來源：
  - Yahoo Finance (美股)：個股 RSS headline feed
  - Yahoo 股市 / Yahoo 財經 (台股)：台灣財經 RSS
  - MoneyDJ 理財網：新聞中心 RSS

以 RSS 為主 (比爬 HTML 穩定)。任何來源失敗都不影響其他來源。
"""
from __future__ import annotations

import logging
from typing import List

import feedparser

import security

logger = logging.getLogger(__name__)

HEADERS = {"User-Agent": "Mozilla/5.0 (AI-Stock-Research-Assistant)"}
TIMEOUT = 20

# 台灣財經新聞 RSS (僅使用白名單網域：news.cnyes.com / www.moneydj.com)
TW_FEEDS = [
    ("鉅亨網-台股", "https://news.cnyes.com/rss/v1/news/category/tw_stock"),
    ("鉅亨網-頭條", "https://news.cnyes.com/rss/v1/news/category/headline"),
    ("MoneyDJ", "https://www.moneydj.com/KMDJ/RssCenter.aspx?svc=NW&fno=1&arg=X0000000"),
    ("MoneyDJ國際", "https://www.moneydj.com/KMDJ/RssCenter.aspx?svc=NW&fno=1&arg=MB010000"),
]

# 美股個股 RSS (Yahoo Finance headline feed；feeds.finance.yahoo.com 屬白名單 finance.yahoo.com)
US_FEED_TMPL = "https://feeds.finance.yahoo.com/rss/2.0/headline?s={symbol}&region=US&lang=en-US"


def _fetch_feed(url: str, source: str, limit: int = 6) -> List[dict]:
    """抓單一 RSS 並轉成標準格式 (一律經過 security.safe_get：白名單 + 驗證憑證)。"""
    items: List[dict] = []
    try:
        resp = security.safe_get(url, headers=HEADERS, timeout=TIMEOUT)
        resp.raise_for_status()
        feed = feedparser.parse(resp.content)
        for entry in feed.entries[:limit]:
            items.append({
                "title": (entry.get("title") or "").strip(),
                "link": entry.get("link", ""),
                "source": source,
                "published": entry.get("published", entry.get("updated", "")),
                "summary": _clean(entry.get("summary", "")),
            })
    except Exception as exc:
        logger.warning("新聞來源 %s 抓取失敗：%s", source, exc)
    return items


def _clean(text: str, max_len: int = 160) -> str:
    """移除 HTML 標籤、壓縮空白、截斷。"""
    import re
    text = re.sub(r"<[^>]+>", "", text or "")
    text = re.sub(r"\s+", " ", text).strip()
    return text[:max_len] + ("…" if len(text) > max_len else "")


# ----------------------------------------------------------------------
#  公開介面
# ----------------------------------------------------------------------
def get_tw_news(limit_per_source: int = 4, total_limit: int = 10) -> List[dict]:
    """台股 / 台灣財經新聞。"""
    news: List[dict] = []
    seen = set()
    for source, url in TW_FEEDS:
        for item in _fetch_feed(url, source, limit_per_source):
            if item["title"] and item["title"] not in seen:
                seen.add(item["title"])
                news.append(item)
    return news[:total_limit]


def get_us_news(symbols: List[str], limit_per_symbol: int = 2, total_limit: int = 10) -> List[dict]:
    """美股個股新聞 (依 watchlist 代號)。"""
    news: List[dict] = []
    seen = set()
    for symbol in symbols:
        url = US_FEED_TMPL.format(symbol=symbol)
        for item in _fetch_feed(url, f"Yahoo Finance ({symbol})", limit_per_symbol):
            if item["title"] and item["title"] not in seen:
                seen.add(item["title"])
                news.append(item)
    return news[:total_limit]


_POS_KW = ["成長", "創高", "新高", "看好", "上修", "大賺", "利多", "報喜", "獲利", "強勁",
           "beat", "upgrade", "soar", "surge", "record", "raise", "rally", "jump"]
_NEG_KW = ["下修", "虧損", "重挫", "看壞", "利空", "裁員", "衰退", "示警", "下滑", "跌",
           "miss", "downgrade", "plunge", "cut", "warn", "fall", "drop", "slump"]


def headline_score(name: str, symbol: str, headlines: List[dict]) -> float:
    """以新聞標題對個股做輕量情緒評分 (0~10，預設中性 5)。

    僅作推薦的『新聞事件』因子 (權重 5%)；找不到相關新聞回傳中性 5。
    """
    if not headlines:
        return 5.0
    relevant = []
    for h in headlines:
        title = h.get("title") or ""
        src = h.get("source") or ""
        if (name and name in title) or (symbol and (symbol in src or symbol in title)):
            relevant.append(title + " " + (h.get("summary") or ""))
    if not relevant:
        return 5.0
    net = 0
    for text in relevant:
        low = text.lower()
        net += sum(1 for k in _POS_KW if k.lower() in low)
        net -= sum(1 for k in _NEG_KW if k.lower() in low)
    return max(0.0, min(10.0, 5.0 + net))


def summarize(news_items: List[dict], max_items: int = 8) -> str:
    """把新聞清單整理成 Markdown 條列摘要。

    這是輕量的「重點整理」(取標題 + 來源 + 連結)。
    若要接 LLM 自動摘要，可在此把 news_items 丟給模型，
    回填到每則 item['ai_summary'] 後再格式化。
    """
    if not news_items:
        return "_（暫無新聞資料）_"
    lines = []
    for item in news_items[:max_items]:
        title = item["title"]
        link = item["link"]
        source = item["source"]
        if link:
            lines.append(f"- [{title}]({link}) — _{source}_")
        else:
            lines.append(f"- {title} — _{source}_")
    return "\n".join(lines)
