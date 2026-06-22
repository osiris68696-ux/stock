"""產業趨勢引擎。

對每個族群輸出『偏多 / 中性 / 偏空』+ 主題敘述。**保證不輸出「產業趨勢資料不足」**：
即使缺即時資料，也會用結構性產業論點給出判斷。

  - AI / 半導體 / 伺服器：AI Server、HBM、CoWoS、先進封裝、AI 資本支出。
  - 金融：利率、殖利率、銀行獲利、保險獲利。
  - 其他：以族群動能 + 產業敘述。
"""
from __future__ import annotations

_AI_CATS = {"semiconductor", "ai_server"}
_AI_SYMBOLS = {"NVDA", "AMD", "2330", "AVGO", "META", "MSFT", "GOOGL", "TSM",
               "2454", "2382", "3231", "6669", "3017", "2376", "3711"}


def _momentum(trend):
    """由即時族群資料給 -1/0/+1 動能。"""
    if not trend:
        return None
    above = trend.get("above_ma20_pct")
    chg = trend.get("avg_change")
    if above is not None:
        if above >= 70:
            return 1
        if above <= 30:
            return -1
    if chg is not None:
        return 1 if chg > 0.5 else (-1 if chg < -0.5 else 0)
    return 0


def _verdict(score):
    return "偏多" if score >= 1 else ("偏空" if score <= -1 else "中性")


def _mom_text(mom):
    return {1: "族群動能轉強（多數站上均線）", -1: "族群動能轉弱（多數跌破均線）",
            0: "族群動能中性"}.get(mom, "族群動能資料有限")


def _ai_trend(name, trend, ctx):
    mom = _momentum(trend)
    base = 1  # AI 結構性偏多
    score = base + (mom if mom is not None else 0)
    verdict = _verdict(score)
    points = ["AI 伺服器出貨動能強、雲端業者 AI 資本支出持續上行",
              "HBM 高頻寬記憶體供不應求、報價走升",
              "CoWoS 先進封裝產能持續擴張，台積電主導",
              "GPU / ASIC 推升先進製程與封測需求"]
    extra = _mom_text(mom) if mom is not None else "結構性需求為主，短期動能資料有限"
    note = (f"{name}：AI 產業鏈結構性偏多——{points[0]}；{points[1]}；{points[2]}。{extra}。"
            "風險：AI 資本支出循環與高估值。")
    return {"verdict": verdict, "narrative": note, "theme_points": points, "momentum": mom}


def _fin_trend(name, trend, ctx):
    mom = _momentum(trend)
    tnx = (ctx or {}).get("tnx")
    score = (mom if mom is not None else 0)
    rate_note = ""
    if tnx is not None:
        if tnx >= 4.0:
            rate_note = f"美10年期殖利率 {tnx:.2f}% 偏高，銀行淨利差受惠、保險再投資收益提升"
            score += 0  # 利率高對金控整體中性偏正 (利差+) 但保險評價壓力
        elif tnx <= 3.0:
            rate_note = f"殖利率 {tnx:.2f}% 偏低，利差收斂、但有利股債評價"
        else:
            rate_note = f"殖利率 {tnx:.2f}% 中性"
    verdict = _verdict(score)
    points = ["利率環境影響銀行淨利差與保險再投資收益",
              "資本市場交投熱絡挹注證券 / 財富管理手續費",
              "需留意壽險股債評價與避險成本波動"]
    note = (f"{name}：{rate_note or '利率環境中性'}；銀行獲利受利差與授信品質驅動，"
            f"保險受評價與利率影響。{_mom_text(mom) if mom is not None else '動能資料有限'}。")
    return {"verdict": verdict, "narrative": note, "theme_points": points, "momentum": mom}


def _generic_trend(name, trend, mom):
    verdict = _verdict(mom if mom is not None else 0)
    if trend:
        chg = trend.get("avg_change")
        note = (f"{name}族群：站上 20MA {trend.get('above_ma20_pct')}%、"
                f"平均漲跌 {('%+.1f%%' % chg) if chg is not None else '—'}、{_mom_text(mom)}。")
    else:
        note = f"{name}族群：以基本面與長期趨勢評估，{_mom_text(mom)}（即時資料有限，採結構性判斷）。"
    return {"verdict": verdict, "narrative": note, "theme_points": [], "momentum": mom}


def industry_trend(category: str, category_name: str, symbol: str = None,
                   trend: dict = None, ctx: dict = None) -> dict:
    """主入口。回傳 {verdict, narrative, theme_points, momentum}；保證有內容。"""
    generic = (not category_name) or category_name in ("custom", "該產業", "其他", "自訂")
    if category in _AI_CATS or (symbol and symbol in _AI_SYMBOLS):
        return _ai_trend("AI / 半導體產業" if generic else category_name, trend, ctx)
    if category == "financial" or (symbol and symbol in {"2880", "2881", "2882", "2883",
                                                          "2884", "2885", "2886", "2887",
                                                          "2890", "2891", "2892"}):
        return _fin_trend("金融產業" if generic else category_name, trend, ctx)
    return _generic_trend(category_name or "該", trend, _momentum(trend))
