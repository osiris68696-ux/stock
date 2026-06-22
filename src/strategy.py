"""候選評分引擎 (依 config/strategy.json)。

對單一標的依「零股 / 定期定額觀察」邏輯給出：
  - 評分 score 與觀察理由 reasons
  - 是否為候選 candidate
  - 是否列入「不適合追價」 avoid 與原因
  - 風險提醒 risks

重要：本引擎只做『觀察分級』，不產生任何買進 / 賣出指令。
"""
from __future__ import annotations

import json
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

_DEFAULT = {
    "candidate_filters": {
        "rsi_max": 70, "max_distance_from_ma20_pct": 5.0,
        "max_distance_from_ma50_pct": 8.0, "max_volume_spike_ratio": 2.5,
    },
    "scoring": {
        "near_ma20_bonus": 2, "near_ma50_bonus": 1, "rsi_healthy_bonus": 1,
        "rsi_oversold_bonus": 2, "volume_stable_bonus": 1, "etf_priority_bonus": 2,
        "institution_buying_bonus": 1, "dividend_yield_bonus": 1, "dividend_yield_threshold": 3.0,
    },
    "penalties": {
        "vix_threshold": 25, "vix_penalty": 2, "dxy_surge_pct": 0.5, "dxy_penalty": 1,
        "institution_sell_days": 3, "institution_sell_penalty": 2, "rsi_overheated": 70, "pe_high": 40,
    },
    "rules": {"etf_priority": True, "advice_mode": "observation_only", "min_candidate_score": 3},
    "fundamental": {
        "value": {"pe_cheap": 15, "pe_fair": 25, "pb_cheap": 2.0,
                  "dividend_yield_good": 4.0, "peg_good": 1.5},
        "growth": {"eps_growth_good": 15, "eps_growth_strong": 30,
                   "revenue_yoy_good": 10, "revenue_yoy_strong": 20, "target_upside_good": 15},
    },
    "scoring_mode": "balanced_mode",
    "scoring_weights": {"growth": 1.2, "value": 1.0, "technical": 0.5, "risk": 1.0, "dividend": 0.8},
    "modes": {
        "value_mode": {"growth": 0.8, "value": 1.5, "technical": 0.4, "risk": 1.0, "dividend": 1.0},
        "growth_mode": {"growth": 1.5, "value": 0.8, "technical": 0.5, "risk": 1.0, "dividend": 0.5},
        "balanced_mode": {"growth": 1.2, "value": 1.0, "technical": 0.5, "risk": 1.0, "dividend": 0.8},
        "defensive_mode": {"growth": 0.6, "value": 1.3, "technical": 0.4, "risk": 1.3, "dividend": 1.5},
    },
    "regime_mode_map": {"Risk-On": "growth_mode", "Neutral": "balanced_mode", "Risk-Off": "defensive_mode"},
    "recommendation_weights": {"market": 0.40, "industry": 0.25, "fundamental": 0.20,
                               "technical": 0.10, "news": 0.05},
}


class Strategy:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.f = cfg.get("candidate_filters", _DEFAULT["candidate_filters"])
        self.sc = cfg.get("scoring", _DEFAULT["scoring"])
        self.pen = cfg.get("penalties", _DEFAULT["penalties"])
        self.rules = cfg.get("rules", _DEFAULT["rules"])
        self.fund = cfg.get("fundamental", _DEFAULT["fundamental"])
        # 推薦分數權重 (可切換模式)
        self.modes = cfg.get("modes", _DEFAULT["modes"])
        self.scoring_mode = cfg.get("scoring_mode", _DEFAULT["scoring_mode"])
        self.scoring_weights = cfg.get("scoring_weights",
                                       self.modes.get(self.scoring_mode, _DEFAULT["scoring_weights"]))
        self.regime_mode_map = cfg.get("regime_mode_map", _DEFAULT["regime_mode_map"])
        # 由上而下推薦因子權重：大盤 / 產業 / 基本面 / 技術 / 新聞
        self.rec_weights = cfg.get("recommendation_weights", _DEFAULT["recommendation_weights"])

    def weights(self, mode: Optional[str] = None) -> dict:
        """取得某模式的權重；mode 省略時用目前 scoring_mode。"""
        if mode is None:
            return self.scoring_weights
        return self.modes.get(mode, self.scoring_weights)

    def mode_for_regime(self, regime: str) -> str:
        """依市場狀態回傳對應的權重模式 (動態調整)。"""
        return self.regime_mode_map.get(regime, self.scoring_mode)

    @classmethod
    def load(cls, path: str) -> "Strategy":
        try:
            with open(path, "r", encoding="utf-8") as fp:
                cfg = json.load(fp)
            logger.info("已載入策略設定：%s", os.path.basename(path))
        except Exception as exc:
            logger.warning("讀取 strategy.json 失敗，改用預設值：%s", exc)
            cfg = _DEFAULT
        return cls(cfg)

    # ------------------------------------------------------------------
    def evaluate(self, d: dict, ctx: dict) -> dict:
        """評估單一標的。

        d   : 標的資料 (見 scanner.build_*_data)
        ctx : 市場環境 {vix, dxy_change_pct, ...}
        """
        f, sc, pen, rules = self.f, self.sc, self.pen, self.rules

        rsi = d.get("rsi")
        dist20 = d.get("dist_ma20_pct")
        dist50 = d.get("dist_ma50_pct")
        vol_ratio = d.get("volume_ratio")
        pe = d.get("pe")
        dy = d.get("dividend_yield")
        is_etf = bool(d.get("is_etf"))
        market = d.get("market", "TW")
        change_pct = d.get("change_pct") or 0
        sell_days = d.get("inst_sell_days") or 0
        inst_total = d.get("inst_total")

        score = 0
        reasons: list = []
        risks: list = []
        avoid_reasons: list = []

        # ---------- 不適合追價 (硬性) ----------
        overheated = rsi is not None and rsi >= pen["rsi_overheated"]
        if overheated:
            avoid_reasons.append(f"RSI {rsi} 過熱(≥{pen['rsi_overheated']})")

        extended = dist20 is not None and dist20 > f["max_distance_from_ma20_pct"]
        if extended:
            avoid_reasons.append(f"股價高於20MA {dist20:+.1f}%、已偏離(追高風險)")

        vol_spike = (vol_ratio is not None and vol_ratio >= f["max_volume_spike_ratio"]
                     and change_pct > 0)
        if vol_spike:
            avoid_reasons.append(f"爆量上漲(量能 {vol_ratio:.1f}x)、疑似追高")

        pe_high = pe is not None and pe >= pen["pe_high"] and not is_etf
        if pe_high:
            avoid_reasons.append(f"本益比 {pe:.1f} 偏高(≥{pen['pe_high']})")

        streak_sell = sell_days >= pen["institution_sell_days"]
        if streak_sell:
            avoid_reasons.append(f"三大法人連賣 {sell_days} 天")

        avoid = overheated or extended or vol_spike or pe_high or streak_sell

        # ---------- 候選評分 ----------
        near20 = dist20 is not None and abs(dist20) <= f["max_distance_from_ma20_pct"]
        near50 = dist50 is not None and abs(dist50) <= f["max_distance_from_ma50_pct"]
        if near20:
            score += sc["near_ma20_bonus"]
            reasons.append("貼近月線(MA20)")
        if near50:
            score += sc["near_ma50_bonus"]
            reasons.append("貼近季線(MA50)")

        if rsi is not None:
            if rsi <= 35:
                score += sc["rsi_oversold_bonus"]
                reasons.append(f"RSI {rsi} 偏低、具回補空間")
            elif rsi < f["rsi_max"]:
                score += sc["rsi_healthy_bonus"]
                reasons.append(f"RSI {rsi} 健康未過熱")

        if vol_ratio is not None and vol_ratio <= f["max_volume_spike_ratio"]:
            score += sc["volume_stable_bonus"]
            reasons.append("量能溫和、無爆量追高")

        if is_etf:
            score += sc["etf_priority_bonus"]
            reasons.append("ETF(分散、適合零股/定期定額)")

        if dy is not None and dy >= sc.get("dividend_yield_threshold", 3.0):
            score += sc["dividend_yield_bonus"]
            reasons.append(f"殖利率約 {dy:.1f}%")

        if market == "TW" and inst_total is not None and inst_total >= 0 and not streak_sell:
            score += sc["institution_buying_bonus"]
            reasons.append("法人無連續調節")

        # ---------- 市場環境扣分 ----------
        vix = ctx.get("vix")
        if vix is not None and vix >= pen["vix_threshold"]:
            score -= pen["vix_penalty"]
            risks.append(f"VIX {vix:.1f} 偏高，降低進場評分")

        if market == "US":
            dxy_chg = ctx.get("dxy_change_pct")
            if dxy_chg is not None and dxy_chg >= pen["dxy_surge_pct"]:
                score -= pen["dxy_penalty"]
                risks.append(f"美元急升 {dxy_chg:+.2f}%，壓抑美股評分")

        if streak_sell:
            score -= pen["institution_sell_penalty"]
            risks.append(f"法人連賣 {sell_days} 天")

        # ---------- 是否列為候選 ----------
        candidate = (
            not avoid
            and (rsi is None or rsi < f["rsi_max"])
            and (near20 or near50)
            and score >= rules.get("min_candidate_score", 3)
        )

        return {
            "symbol": d.get("symbol"),
            "name": d.get("name"),
            "is_etf": is_etf,
            "market": market,
            "category": d.get("category"),
            "score": score,
            "reasons": reasons,
            "risks": risks,
            "candidate": candidate,
            "avoid": avoid,
            "avoid_reasons": avoid_reasons,
            "data": d,
        }
