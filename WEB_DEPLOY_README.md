# 🌐 ARES 股票分析平台 — Web 版（朋友下載後在自己電腦本機執行）

> **定位**：這是給特定朋友**下載後、在他自己的電腦上本機執行**的版本。
> 不是架在我電腦上的服務，朋友**不會連到我的電腦**。
> 使用者自行輸入股票代號、自訂持股（成本/股數）。
> **不含 `.env`、不含 Telegram、不含任何私人持股 / 金鑰。** 僅供研究，不構成投資建議。

---

## ⚠️ 安全部署原則（務必遵守）

- ✅ 每位使用者在**自己的電腦本機執行**，開 `http://127.0.0.1:8000`（只有本機看得到）。
- ❌ **禁止**把 `web_app.py` 直接暴露到網際網路。
- ❌ **禁止**路由器 Port Forwarding（連接埠轉發）。
- ❌ **禁止**公開任何人的家用對外 IP；**不需要**讓外部連到任何人的電腦。
- ✅ 本機只綁 `127.0.0.1`（localhost）。
- ✅ GitHub Repo 一律 **Private**。

> 本專案**完全不需要**對外開放網路、不需要 Port Forwarding、不需要公開家用 IP。
> 「給朋友用」= 朋友各自下載、各自在自己電腦本機跑，彼此獨立。

---

## 一、Telegram 私人版（僅供我本人，不在此流程內）

- **僅供我本人使用**（我的持股、每日自動報告、Telegram 推播）。
- **不包含在 GitHub / 給朋友的流程中**——朋友拿到的 ZIP / repo 內**沒有** `.env`、
  沒有 Telegram Token、沒有 Chat ID、沒有我的私人持股。
- **不要修改**：排程、Guard 系統、現有推薦邏輯、`.env` 一律維持原狀。

## 二、GitHub Web 版（給特定朋友下載、在自己電腦本機執行）

朋友拿到 `hades-stock-web.zip`（或 clone 你的 Private repo）後，在**他自己的電腦**：

```bash
# 0) 先安裝 Python 3.10+（朋友需自行安裝；本專案以 3.14 開發）

# 1) 進到解壓後的資料夾，建立虛擬環境並安裝套件
python -m venv .venv
# Windows：
.\.venv\Scripts\Activate.ps1
# macOS / Linux：
# source .venv/bin/activate
pip install -r requirements.txt

# 2) 啟動（只綁 127.0.0.1 本機）
python web_app.py
```

接著在**他自己的電腦**開瀏覽器：**http://127.0.0.1:8000**

> 只需這些套件：`requests pandas numpy yfinance feedparser`。
> 這個網址只有他自己的電腦看得到，不會對外、也不會連到我的電腦。

## 三、GitHub Pages（只能當靜態介紹頁）

- GitHub Pages **只能顯示靜態說明頁**（HTML/CSS/JS），**不能執行 Python**。
- 因此 GitHub Pages **不能提供 `/api/analyze`**、**不是完整分析系統**。
- 完整分析系統一定要由使用者**下載後在本機執行**（見上面「二」）。
- 若要放 GitHub Pages，只放一頁「介紹 + 下載連結 + 使用說明」即可，不要當成可分析的網站。

## 四、安全聲明

- 本專案**不需要公開任何家用 IP**。
- **不需要 Port Forwarding**。
- **不需要讓外部連線到我的電腦**。
- **不上傳** `.env`、**不上傳** Telegram Token、**不上傳** Chat ID、**不上傳**私人持股。
- 交付給朋友的 ZIP 內 `config/watchlist.json` 持股**已清空**。

---

## 本機測試（朋友自己驗證）

頁面輸入代號，或用 curl 測：

**台股**：`2330` `2887` `0050` `0056` `00878`　**美股**：`NVDA` `AAPL` `MSFT` `GOOGL`

```bash
curl "http://127.0.0.1:8000/api/analyze?symbol=2330&market=TW"
# 持股損益（成本/股數，只在本機即時計算、不儲存）
curl "http://127.0.0.1:8000/api/analyze?symbol=2330&market=TW&cost=2000&qty=1000"
```

**成功判斷**：回應 `"ok": true`，含 `decision`（action 五級買賣 / confidence / risk_level /
capital_pct / risk_reward / target / stop / valuation 估值區間 / suitability /
buy_reasons≥5 / not_buy_reasons≥3）、`fundamentals` / `technical` / `chip` /
`industry_trend` / `industry_verdict` / `data_quality` / `conclusion`。
帶 `cost`/`qty` 另含 `holding`（return_pct / pnl / suggestion=續抱·加碼·減碼·停利·停損）。

### 平台分析能力
- 基本面：營收 YoY、EPS YoY、Forward EPS、P/E、PEG、ROE、殖利率、淨利率
- 技術面：MA5/10/20/60/200、RSI、MACD、支撐、壓力、建議停損
- 籌碼面：台股（外資/投信/自營商、融資/融券）；美股（分析師評等、機構持股、Short Interest）
- 產業趨勢引擎：AI / 金融 / 其他 → 偏多 / 中性 / 偏空（不會出現「資料不足」）
- 決策引擎：五級建議 + 信心 + 風險等級 + 資金配置 + 風報比 + 估值區間
- 資料正確性：雙來源價格交叉驗證，差異 > 3% 標記異常並停止推薦

---

## 持股資料只在本機（不上傳）

Web 版的持股（含成本/股數）**只存在使用者瀏覽器的 localStorage**（鍵名 `ai_stock_holdings`），
不會送到任何伺服器、不寫入 logs / reports / DB。伺服器（= 使用者自己本機跑的 `web_app.py`）
只接受「單一代號 (+選填成本/股數)」做即時計算，不儲存任何資料。

## 安全機制摘要
- 不讀 `.env`、不 import Telegram、不使用任何私人持股。
- 代號嚴格正則驗證（台股 `^\d{4,6}$`、美股 `^[A-Za-z]{1,10}$`），靜態檔白名單擋路徑穿越（`/../.env` → 404）。
- 只綁 `127.0.0.1`；無 `os.system / subprocess / eval / exec / shell / powershell / cmd`。
- 對外服務不在本專案範圍內；如真要對外，請另行評估合規的雲端託管，**切勿**用本機直連 / Port Forwarding。

## GitHub 上傳（手動，由我執行；Private Repo）

```bash
git status --porcelain | grep -E "\.env|/logs/|/reports/|task\.lock"   # 應無輸出
git init && git add . && git status        # 確認沒有 .env、logs/、reports/、*.log
git commit -m "ARES stock web (friends, run locally)"
git branch -M main
git remote add origin https://github.com/<我的帳號>/<repo>.git   # Private
git push -u origin main
```
> ⚠️ 完整專案的 `config/watchlist.json` 含我的持股 → repo **務必 Private**，或把它加入 `.gitignore`。
