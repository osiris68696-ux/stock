# 📈 AI Stock Research Assistant

台股 + 美股 **AI 投資分析助理**（價值投資 + 成長投資模式）。每日自動：

- **持股健檢**：價格 / 技術面 / 殖利率 + 基本面（P/E、EPS 年增、營收年增）+ 估值與成長判斷 + 風險
- **價值 + 成長推薦**：掃描市場，產出台股 3 檔 + 美股 3 檔推薦與**推薦理由**
- **基本面分析**：EPS 成長率、營收年增率、P/E 與 Forward P/E、分析師目標價與評等、財報/法說重點
- **AI 概念股追蹤** + **產業趨勢分析**
- 掃描**零股分批進場 / 定期定額觀察候選**，標示**不適合追價名單**
- 整合 VIX / 美元指數 / 美債殖利率與新聞，給出**明日觀察重點與風險提醒**
- 產生 Markdown 日報並可**推播到手機 Telegram**，支援互動指令查詢

> ⚠️ 本專案僅供研究與學習用途，所有輸出**不構成任何投資建議**。
> 「以上僅為資料整理與趨勢分析，不構成投資建議。」

---

## ✨ 功能總覽

| 模組 | 內容 | 資料來源 |
|---|---|---|
| 🧭 市場狀態 | 每日判斷 Risk-On / Neutral / Risk-Off，**動態切換**推薦權重模式 | VIX/DXY/10Y/NASDAQ/S&P500/TAIEX/外資 |
| 💼 持股健檢 | 0050 / 0056 / 00878 / 2887：技術面 + 基本面 + 估值/成長/健康判斷 + 風險 | TWSE + yfinance |
| ⭐ 價值+成長推薦 | 台股 3 檔 + 美股 3 檔，含 P/E、Forward P/E、EPS/營收成長、目標價、推薦理由 | TWSE + yfinance |
| 🧱 公司基本面 | EPS 成長率、營收年增率、P/E 與 Forward P/E、分析師目標價/評等、財報/法說重點 | TWSE OpenAPI + yfinance/Finnhub |
| 🤖 AI 概念股 | 台股 / 美股 AI 概念股估值與成長追蹤 | TWSE + yfinance |
| 📈 產業趨勢 | 各族群平均漲跌、營收/EPS 年增、站上均線比例、趨勢 | 彙整 |
| 🇹🇼/🇺🇸 市場掃描 | 權值/ETF/金融/AI 半導體 → 零股 / 定期定額候選 | TWSE + yfinance |
| 🚫 不適合追價 | 過熱 / 追高 / 爆量 / 法人連賣 / 本益比過高 | 規則篩選 |
| 🌐 市場指標 | VIX、DXY 美元指數、美國 10 年期公債殖利率 | yfinance |
| 📰 新聞 | 台股 / 美股財經新聞摘要 | 鉅亨網、Yahoo、MoneyDJ |
| 📨 Telegram | 每日推播 + 互動指令 (/report /holding /recommend /ai /tw /us /buy /help) | Telegram Bot API |

每日報告**最前面顯示今日市場狀態（Risk-On / Neutral / Risk-Off）與推薦原因**，接著 12 區塊：**今日市場總覽、持股健檢、台股推薦 3 檔、美股推薦 3 檔、AI 概念股追蹤、產業趨勢分析、台股零股候選、美股零股候選、不適合追價名單、明日觀察重點、風險提醒、投資警語**，輸出至 `reports/YYYY-MM-DD.md`。

---

## 📂 專案結構

```
tw-stock-bot/
├── config/
│   ├── watchlist.json        # 持股 + 掃描清單 + AI 概念股 (holdings/scan_universe/ai_concept)
│   ├── strategy.json         # 篩選/評分規則 + 由上而下推薦權重 + 市場狀態模式對應
│   ├── insights.json         # 投資論點知識庫 (各股/各產業 推薦論點/風險/催化劑)
│   ├── taiquant.json         # TaiQuant 交叉驗證設定 (端點/欄位對照)
│   ├── tw_market_holidays.json  # 台股休市日 (每年更新)
│   └── us_market_holidays.json  # 美股休市日 (每年更新)
├── web_app.py                # Web 公開版伺服器 (stdlib http.server)
├── web/                      # Web 前端 (index.html / app.js / style.css)
├── src/
│   ├── main.py               # 主程式：組裝報告 (市場狀態 + 12 區塊) + 輸出 + 推播
│   ├── decision_engine.py    # AI 決策引擎 (五級買賣/信心/風險等級/資金配置/風報比/估值區間/停損)
│   ├── industry_trend_engine.py # 產業趨勢引擎 (AI/金融主題；保證不輸出「資料不足」)
│   ├── taiquant.py           # TaiQuant 台股量化交叉驗證 (輔助，可降級)
│   ├── web_service.py        # Web 單檔分析服務 (不碰 .env/Telegram/私人持股)
│   ├── market_regime.py      # 市場狀態判斷 (Risk-On/Neutral/Risk-Off) → 動態模式
│   ├── twse_client.py        # 台股行情 + 三大法人 + 融資融券 (含連賣天數/外資買賣超)
│   ├── us_stock_client.py    # yfinance 行情/配息/基本面/info/法說日期 + Finnhub
│   ├── fundamentals.py       # 公司基本面 (P/E、EPS、營收年增、目標價、法說重點)
│   ├── recommend.py          # 價值 + 成長 推薦引擎 (台股/美股各 3 檔)
│   ├── trading_calendar.py   # 交易日判斷 (台股/美股休市 → 跳過分析)
│   ├── industry.py           # 產業趨勢 + AI 概念股 + AI 產業鏈
│   ├── insights.py           # 投資論點知識庫 + 敘述式個股分析 (理由/風險/催化劑/結論)
│   ├── analysis.py           # 技術指標、市場指標、指標快照
│   ├── strategy.py           # 評分引擎 (讀 strategy.json)
│   ├── scanner.py            # 台股 / 美股市場掃描 (技術 + 基本面)
│   ├── holdings.py           # 持股健檢
│   ├── news.py               # 新聞抓取與摘要
│   ├── security.py           # 安全閘門 (白名單 / safe_get / 路徑 / env)
│   ├── telegram_bot.py       # Telegram 推播 + 指令機器人
│   └── scheduler.py          # 每日排程
├── reports/                  # 每日報告 (YYYY-MM-DD.md) + latest_report.json
├── logs/                     # 執行日誌 (app.log)
├── SECURITY_AUDIT.md / requirements.txt / .env.example / README.md
```

---

## 🚀 安裝

```powershell
cd D:\tw-stock-bot

# 1. 建立虛擬環境
python -m venv .venv
.\.venv\Scripts\Activate.ps1          # Windows
# source .venv/bin/activate           # macOS / Linux

# 2. 安裝套件
pip install -r requirements.txt

# 3. 設定環境變數
copy .env.example .env                # Windows (cp .env.example .env)
# 編輯 .env 填入 Telegram / Finnhub 金鑰
```

> 沒有金鑰也能跑:沒有 `FINNHUB_API_KEY` → 美股改用 yfinance 基本面;沒有 Telegram 設定 → 只產生本機報告、略過推播。

---

## 📱 在手機 Telegram 收到報告(完整教學)

### 步驟 1：建立 Telegram Bot，取得 `TELEGRAM_BOT_TOKEN`
1. 手機開 Telegram，搜尋並開啟 **@BotFather**。
2. 輸入 `/newbot`，依指示設定 Bot 名稱與帳號(帳號需以 `bot` 結尾)。
3. 建立成功後，BotFather 會給你一段 **Token**，格式像:
   `123456789:AAH...xyz` → 這就是 `TELEGRAM_BOT_TOKEN`。

### 步驟 2：取得你的 `TELEGRAM_CHAT_ID`
1. 在 Telegram 搜尋你剛建立的 Bot，按 **Start** 並隨便傳一則訊息(例如 `hi`)。
2. 取得 chat id(兩種方法擇一):
   - **方法 A(最簡單)**:搜尋 **@userinfobot** → `/start`，它會回傳你的數字 id。
   - **方法 B**:瀏覽器開啟(把 `<TOKEN>` 換成你的 Token):
     `https://api.telegram.org/bot<TOKEN>/getUpdates`
     在回傳的 JSON 找 `"chat":{"id":123456789}`，那串數字就是 chat id。

### 步驟 3：填入 `.env`
```ini
TELEGRAM_BOT_TOKEN=123456789:AAH...xyz
TELEGRAM_CHAT_ID=123456789
FINNHUB_API_KEY=可留空或填 Finnhub 金鑰
TIMEZONE=Asia/Taipei
```
> 🔒 基於安全限制，程式**只會讀取上述 4 個環境變數**(見 `src/security.py`)。
> 報告時間 (`report_time`)、是否推播 (`send_telegram`) 請在 `config/watchlist.json` 的 `"settings"` 區塊設定。

### 步驟 4：推播今日報告到手機
```powershell
python -m src.main
```
你的手機 Telegram 就會收到「今日市場總覽 + 分批觀察清單 + 完整報告 .md 檔」。

---

## 💬 手機指令查詢

另外開一個常駐程序當「指令機器人」:
```powershell
python -m src.main --bot
```
之後在手機 Telegram 對你的 Bot 輸入以下指令即可即時查詢:

| 指令 | 功能 |
|---|---|
| `/test` | 發送測試訊息 |
| `/report` | 今日完整報告摘要 |
| `/holding` | 我的持股健檢 |
| `/recommend` | 今日台股 / 美股推薦觀察名單 |
| `/ai` | AI 概念股分析 |
| `/strategy` | 顯示目前推薦分數權重 |
| `/value` | 偏價值模式分析 |
| `/growth` | 偏成長模式分析 |
| `/balanced` | 平衡模式分析 |
| `/fundamental` | 公司基本面摘要 |
| `/help` | 顯示可用指令 |

> 機器人**只能查詢與分析**：僅讀取已產生的報告或重新執行安全分析函式，不會執行任何系統指令 / shell，也不會控制電腦。只回應你本人的 `TELEGRAM_CHAT_ID`。

> 機器人只回應你本人的 `TELEGRAM_CHAT_ID`。若當天還沒產生報告，`/report` 會即時產生一份。

---

## ▶️ 手動執行

```powershell
python -m src.main --telegram      # 產生今日報告 + 推播 Telegram 摘要 (主要用法)
python -m src.main                 # 同上 (是否推播依 config settings.send_telegram)
python -m src.main --no-telegram   # 只產生本機報告，不推播
python -m src.main --test          # 只發送測試訊息「Hades 股票助理測試成功」
python -m src.main --check-health  # 檢查所有穩定性防護是否啟用
python -m src.main --bot           # 啟動手機指令機器人 (常駐)
```
報告輸出:`reports/YYYY-MM-DD.md`；每次執行同時產生報告檔並把摘要推送到 Telegram。

---

## 📅 每日排程

### 方式 A：內建排程器(常駐)
```powershell
python -m src.main --schedule              # 依 config settings 的 report_time 自動產報 + 推播
python -m src.main --schedule --run-now    # 啟動時先立刻跑一次
```

### 方式 B：Windows 工作排程器（已設定，推薦）
本機已建立每日 08:30 自動任務 `AI_Stock_Daily_Report`（直接執行 python.exe，非透過 .bat —
經實測 .bat/cmd 包裝會被排程器中途終止）。設定/管理：
```powershell
# (已建立) 直接執行 python.exe，工作目錄 D:\tw-stock-bot，每日 08:30
$a = New-ScheduledTaskAction -Execute "D:\tw-stock-bot\.venv\Scripts\python.exe" `
     -Argument "D:\tw-stock-bot\src\main.py --telegram" -WorkingDirectory "D:\tw-stock-bot"
$t = New-ScheduledTaskTrigger -Daily -At "08:30"
$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "AI_Stock_Daily_Report" -Action $a -Trigger $t -Settings $s -Force

Start-ScheduledTask  -TaskName "AI_Stock_Daily_Report"   # 立即測試
Get-ScheduledTaskInfo -TaskName "AI_Stock_Daily_Report"  # 查看上次結果 (LastTaskResult 0 = 成功)
schtasks /Change -TN "AI_Stock_Daily_Report" -ST 07:30   # 改時間
Unregister-ScheduledTask -TaskName "AI_Stock_Daily_Report" -Confirm:$false  # 移除
```
> ⚠️ 任務為「僅在登入時執行」(Interactive)：電腦需開機且已登入才會跑；08:30 抓的是上一交易日資料。日誌見 `logs\app.log`。

### 方式 C：Linux / macOS cron
```bash
30 8 * * 1-5 cd /path/to/tw-stock-bot && ./.venv/bin/python -m src.main >> cron.log 2>&1
```

> 想同時要「每日推播」又「隨時手機查詢」:用排程跑每日報告 + 另外常駐一個 `--bot`。

---

## ⚙️ 自訂清單與策略

### `config/watchlist.json`
```json
{
  "holdings": { "taiwan": ["0050", "0056", "2887", "00878"], "us": [] },
  "scan_universe": {
    "taiwan": { "etf": ["0050", "..."], "financial": ["2880", "..."],
                "semiconductor": ["2330", "..."], "ai_server": ["2382", "..."] },
    "us": { "etf": ["SPY", "..."], "mega_cap": ["NVDA", "..."], "growth": ["AMD", "..."] }
  }
}
```
- 台股用純數字代號(`2330`)，美股用美股代號(`NVDA`)。
- `holdings` 是你的實際持股;`scan_universe` 是每日要掃描的候選池。

### `config/strategy.json`(篩選 / 評分規則)
| 規則 | 預設 |
|---|---|
| RSI 低於 | 70 才可列入候選 |
| 距 20MA | 不超過 5% |
| 距 50MA | 不超過 8% |
| 量能 | < 2.5 倍均量才算溫和(否則視為爆量追高) |
| VIX | > 25 降低進場評分 |
| DXY | 單日急升 ≥ 0.5% 降低美股評分 |
| 法人 | 連賣 3 天降低評分並列入觀察 |
| 本益比 | ≥ 40 的個股列入不適合追價 |
| 優先順序 | ETF 優先於個股 |
| 模式 | 只給觀察，不給買賣建議 |

直接編輯數字即可調整鬆緊，無需改程式。

---

## 🧩 分析方法說明

**技術面**
- MA20(月線) / MA50 / MA60(季線)、RSI(14)、MACD、量能比(今量 / 20 日均量)。
- 零股候選：接近均線、RSI 未過熱、量能溫和、(台股)法人未連賣、ETF 加權 → 評分達門檻才列入。
- 不適合追價：RSI ≥ 70、股價過度偏離 20MA、爆量上漲、法人連賣 3 天、本益比過高。

**基本面（價值 + 成長）**
- **價值**：本益比 P/E、股價淨值比 P/B、PEG、Forward P/E < 現值(獲利看增)。
- **成長**：EPS 年增率、營收年增率、分析師目標價上檔空間、分析師評等。
- **股息**：殖利率。**風險**：RSI 過熱 / 偏離均線 / 法人連賣 / 本益比過高扣分(分數越高越安全)。

**市場狀態 (Market Regime) → 動態權重**
- 每天先綜合 **VIX、DXY、美國 10 年公債殖利率、NASDAQ、S&P500、台股加權、外資買賣超** 7 個訊號各投 +1/0/−1 票。
- 總分 ≥ +2 → **Risk-On**、≤ −2 → **Risk-Off**、其餘 **Neutral**。
- **依狀態動態切換推薦權重模式（不固定單一模式）**：
  - `Risk-On` → `growth_mode`（提高成長股權重）
  - `Neutral` → `balanced_mode`
  - `Risk-Off` → `defensive_mode`（提高 ETF / 高股息 / 金融 / 風險控管權重）
- 對應表在 `config/strategy.json` 的 `regime_mode_map`，可自行調整。
- 報告**最前面**顯示今日市場狀態、推薦原因與所有訊號票數。

**由上而下推薦評分（config/strategy.json `recommendation_weights`）**
- 優先看總體環境，綜合分 (0~10) 由 5 因子加權：
  **大盤趨勢 40% + 產業趨勢 25% + 基本面 20% + 技術面 10% + 新聞事件 5%**。
  - 大盤趨勢：市場狀態票數正規化（同日對所有個股相同）。
  - 產業趨勢：該股所屬族群的站上均線比例與動能。
  - 基本面：價值 + 成長 + 股息（傾向由市場狀態動態決定，見下）。
  - 技術面：**僅 10%**，刻意壓低，避免單一熱門股短線上漲就被拉高分數。
  - 新聞事件：標題輕量情緒（5%）。
- **過熱 / 追高 / 爆量 / 法人連賣的個股直接排除**，聚焦低估值、成長性佳、可零股長期布局的標的。
- **每檔推薦是敘述式分析，不是排行榜**：推薦等級(★)、推薦原因、風險因素、產業趨勢、外資動向(台股)/最近財報+法說重點(美股)、未來催化劑、結論。質化論點來自 `config/insights.json` 知識庫，與即時數據(外資、營收/EPS YoY、財報日、新聞)合成；分析內容少於 100 字者不列入推薦。
- 報告另含：**市場總體分析、產業趨勢分析、AI 產業鏈分析、本週重大事件**。
- **基本面內部的價值 vs 成長傾向**由市場狀態(regime)動態選擇模式：`value_mode` / `growth_mode` / `balanced_mode` / `defensive_mode`（5 面向權重 growth/value/technical/risk/dividend）。
- 報告與 Telegram 顯示因子權重、市場狀態與所用傾向；`/value` `/growth` `/balanced` 可即時比較不同基本面傾向下的推薦；ETF 不列入個股推薦。

**EPS 單位對齊（美股）**
- 明確區分 **quarterly EPS / TTM EPS / Forward EPS**；**Trailing P/E 對應 TTM EPS、Forward P/E 對應 Forward EPS**，不把季 EPS 當年 EPS。
- yfinance 缺值時標示「資料不足」，不硬推估；報告標示資料來源與 P/E 估算方式。
- **資料來源**：台股 P/E / P/B / 殖利率來自 TWSE BWIBBU、營收年增率來自官方月營收、季 EPS 來自財報；Forward P/E、目標價、成長與評等來自 yfinance。美股以 yfinance(+Finnhub) 為主。
- **財報 / 法說重點**：彙整 EPS(季/TTM/Forward)、成長率、評等、目標價、下次財報日的客觀數據，非逐字稿。

> ⚠️ 數據可能含併購 / 基期等扭曲(例如金控合併會使年增率異常放大)，請搭配原始財報判讀。

---

## 🔒 安全性

本專案通過安全稽核 (完整報告見 [SECURITY_AUDIT.md](SECURITY_AUDIT.md))，由 [`src/security.py`](src/security.py) 統一控管：

- **網域白名單**:外部連線只允許官方資料來源 (TWSE / Yahoo Finance / Finnhub / Telegram / MoneyDJ / 鉅亨網)，強制 HTTPS + 驗證憑證。
- **零指令執行**:全專案無 `os.system` / `subprocess` / `eval` / `exec`，亦無檔案刪除或系統修改。
- **Telegram 只發文字**:不上傳檔案；指令機器人僅讀取已產生報告或重跑分析，不會執行任何系統命令。
- **環境變數白名單**:只讀取 `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` / `FINNHUB_API_KEY` / `TIMEZONE`。
- **路徑限制**:只讀取專案內檔案 (擋掉 Desktop / Documents / AppData / SSH 等)，只寫入 `reports/` `logs/` `config/`。

---

## 📅 交易日判斷 (Trading Calendar)

排程仍每天 08:30 觸發，但程式內部**先判斷交易日**，非交易日不抓任何資料（實測週末執行 < 1 秒）。

- **台股**：週六日 + `config/tw_market_holidays.json`(國定假日/補假/連假) + `typhoon_closures`(颱風臨時休市) → 休市。台股休市時**不產生報告**，只推 Telegram 短訊「今日台股休市，未產生台股分析報告。」
- **美股**：週六日 + `config/us_market_holidays.json` → 休市。美股休市時**跳過美股分析**（台股照常），報告美股段顯示「今日美股休市，未進行美股分析」。
- 模組 `src/trading_calendar.py`：`is_tw_trading_day()` / `is_us_trading_day()` / `get_market_status()` / `should_run_report()`。

> ⚠️ **休市日需每年更新！** `config/tw_market_holidays.json`、`config/us_market_holidays.json` 目前為 **2026 年** 清單。每年 11~12 月官方公告隔年行事曆後，請依下列來源更新：
> - 台股：https://www.twse.com.tw/zh/trading/holiday.html
> - 美股：https://www.nyse.com/markets/hours-calendars
> 颱風停班停課等臨時休市，請當天手動加到 `tw_market_holidays.json` 的 `typhoon_closures`。

`python -m src.main --check-health` 會顯示今日台股 / 美股開休市狀態。

---

## 🤖 投資決策引擎 + TaiQuant 交叉驗證

**Decision Engine** (`src/decision_engine.py`)：把每檔分析轉成可執行決策 —
**五級行動建議（買進 / 分批布局 / 觀望 / 減碼 / 賣出）**、信心分數(0~100)、**風險等級（低 / 中 / 高）**、
**建議資金配置（10 / 20 / 30 / 50%）**、**風險報酬比（例 3.5 : 1）**、目標價、停損價、
**估值區間 `valuation_zone()`（超跌 / 合理 / 偏高 / 高估 / 泡沫，含合理區間與位置%）**、
對 **保守型 / 穩健型 / 成長型** 的適配度，以及**為什麼可以買 ≥5、為什麼不建議買 ≥3**。

**資料正確性（交叉驗證）**：台股以 TWSE 官方收盤對比 Yahoo 近期收盤、美股以 Yahoo 對比 Finnhub；
價格差異 **> 3% 即標記資料異常、停止推薦並顯示警告**（容忍 EOD 公布時間差，仍能抓出真實錯誤）。

**產業趨勢引擎** (`src/industry_trend_engine.py`)：AI（AI Server / HBM / CoWoS / 先進封裝 / AI 資本支出）、
金融（利率 / 殖利率 / 銀行 / 保險）與其他族群，輸出 **偏多 / 中性 / 偏空**，**保證不輸出「產業趨勢資料不足」**。

**TaiQuant 交叉驗證** (`src/taiquant.py`，僅台股、僅輔助、**不取代本系統**)：與 TaiQuant 量化工具做一致性比對，顯示一致性%與雙方觀點；衝突時列出差異原因。TaiQuant 失敗一律安全降級、不中止主流程。
> ⚠️ TaiQuant 官方 API 端點未公開，預設 `config/taiquant.json` `enabled:false`。找到實際端點後填入 `endpoint_template` / `field_map` 並設 `enabled:true` 即可啟用真實交叉驗證。

---

## 🌐 Web 版（給特定朋友下載後、在自己電腦本機執行）

**定位**：這是給特定朋友**下載後在他自己的電腦本機執行**的版本，**不是架在我電腦上的服務**，
朋友**不會連到我的電腦**。與 Telegram 私人版**完全分流**：Web 版**不含 `.env`、不碰 Telegram、
不含我的私人持股 / 金鑰**。部署細節見 [WEB_DEPLOY_README.md](WEB_DEPLOY_README.md)。

**朋友在他自己的電腦**（需自行安裝 Python 3.10+）：
```bash
python -m venv .venv
.\.venv\Scripts\Activate.ps1      # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python web_app.py                 # 只綁 127.0.0.1
# 然後在他自己的電腦開瀏覽器：http://127.0.0.1:8000
```
- 支援**台股 + 美股**，輸入代號即時分析（推薦等級 / 決策 / 估值區間 / 基本面 / 技術 / 籌碼 / 風險 / 催化劑 / 結論）。
- **持股損益分析**：填入持股成本 / 股數 → 報酬率、損益、**續抱 / 加碼 / 減碼 / 停利 / 停損**建議。
- **自訂持股（含成本/股數）只存在瀏覽器 localStorage**，不送也不存伺服器、不寫 logs / reports / DB。
- 只服務固定靜態檔 + `/api/analyze`，無任意檔案讀取（杜絕路徑穿越），代號經嚴格格式驗證。
- 檔案：`web_app.py`（伺服器）、`src/web_service.py`（單檔分析）、`web/`（前端）。

> **GitHub Pages 只能當靜態介紹頁**：Pages 不能執行 Python、不能提供 `/api/analyze`、**不是完整分析系統**。
> 完整分析一定要由使用者**下載後在本機執行** `python web_app.py`。

> 🔒 **安全**：本專案**不需要**公開任何家用 IP、**不需要** Port Forwarding、**不需要**讓外部連到我的電腦。
> 每位朋友各自在自己電腦本機跑，彼此獨立。

---

## 🧩 兩個版本定位

| 版本 | 用途 | 在哪裡跑 | 持股 | 推送 |
|---|---|---|---|---|
| **Telegram 私人版** | 僅供我本人、每日自動 | 我的電腦 / 排程 | 我的持股 (0050/0056/00878/2887) | Telegram |
| **GitHub Web 版** | 給特定朋友、自行查詢 | **朋友自己的電腦本機** (`127.0.0.1`) | 使用者自訂 (localStorage) | 無 (本機網頁顯示) |

- **Telegram 私人版不在 GitHub 朋友流程內**，且**不會被修改**（排程 / Guard / 推薦邏輯 / `.env` 維持原狀）。
- GitHub 僅作原始碼管理 / 備份，**Repo 一律 Private**，**所有 git 操作由我手動執行**（本系統不會自動 push / 建 repo / 改 GitHub）。
- 交付朋友的 `hades-stock-web.zip` 內**不含** `.env` / Telegram Token / Chat ID / 私人持股（watchlist 已清空）。

---

## 🛡️ 穩定性 (Final Stability Patch)

防卡死 / 防重複 / 防資源失控；完整政策見 [docs/security_policy.md](docs/security_policy.md)。一鍵檢查：`python -m src.main --check-health`。

| 機制 | 說明 | 程式 |
|---|---|---|
| **Task Lock + TTL** | `logs/task.lock` {pid, start_time, expire_time(+11min)}；未過期→跳過、過期→自動清除、結束/例外→`finally` 刪除 | `stability.TaskLock` |
| **Task Timeout** | `MAX_RUNTIME=600s`，超時→寫 scheduler.log/security.log + Telegram 告警 + 立即中止 | `stability.ResourceGuard` |
| **Circuit Breaker + Jitter** | 重試 3 次 (退避 1/2/4s ±抖動)；同網域連續失敗 2 次→標記 DOWN、本次 Fail Fast | `security.safe_get/post` |
| **Resource Guard** | CPU ≥80%/60s 警告、≥90%/60s 中止；RAM >500MB 警告、>1GB 中止；分析後 `gc.collect()` | `stability.ResourceGuard` |
| **每日 API 上限** | 每日 2000 次 (含 safe_get/post + yfinance)；超過→該次略過並寫 security.log | `security.note_api_call` |
| **Heartbeat Status** | 單一 `logs/task_status.json` {status, progress, current_step, last_update}，不洗版 | `stability.Heartbeat` |
| **Report Validation** | 發 Telegram 前驗證 (市場狀態/持股/台股推薦/美股推薦/風險/Quality Gate)；未過→不發送+寫 security.log | `validation.validate_report` |
| **Analysis Quality Gate** | 每檔推薦需 理由≥3、風險≥2、產業趨勢、基本面、技術面、結論；未達標移出核心推薦 | `validation.quality_gate` |
| **報告保留政策** | 每次產報後清理 `reports/` 內超過 `report_retention_days`(預設 14) 天的舊 `YYYY-MM-DD.md`(僅此格式，設 0 = 永久保留) | `stability.cleanup_old_reports` |

> 日誌:`logs/scheduler.log`(排程/跳過/完成/中止/清理)、`logs/security.log`(熔斷/驗證失敗/資源中止)、`logs/app.log`(一般執行)、`logs/task_status.json`(即時狀態)。
> 報告保留天數:改 `config/watchlist.json` → `settings.report_retention_days`(設 `0` 永久保留)。

---

## ❓ 常見問題

| 問題 | 說明 |
|---|---|
| 台股資料是上一交易日 | TWSE 盤後才更新;假日 / 盤前抓到的是最近交易日資料(正常)。 |
| 美股 P/E 沒有值 | 建議設定 `FINNHUB_API_KEY`;未設定時改用 yfinance 後備(較慢、偶有缺值)。 |
| 上櫃股票抓不到 | 部分環境對 TPEx 憑證較嚴格，程式會自動退一步重試;仍失敗時該檔略過不影響其他標的。 |
| Telegram 沒收到 | 確認 Token / chat id 正確，且已先對 Bot 按過 Start / 傳過訊息。 |
| `/report` 沒反應 | 確認 `--bot` 常駐程序有在跑，且你用的是同一個 chat id。 |

---

## 🛠 技術棧
`requests` · `yfinance` · `finnhub-python` · `pandas` / `numpy` · `beautifulsoup4` / `feedparser` · `python-dotenv` · `schedule`

---

## 📜 免責聲明
本專案為教育 / 研究用途，市場資料版權屬各來源所有。投資有風險，本工具輸出僅供參考。

**以上僅為資料整理與趨勢分析，不構成投資建議。**
