# 🌐 ARES 股票分析平台 — Web 公開版 部署文件

> 給一般網友 / 指定朋友使用的版本：使用者自行輸入股票代號、自訂持股（成本/股數）。
> **不讀取 `.env`、不碰 Telegram、不顯示任何私人持股 / 金鑰。** 僅供研究，不構成投資建議。

---

## ⚠️ 安全部署原則（務必遵守）

- ❌ **禁止**將本機 `web_app.py` 直接暴露到網際網路。
- ❌ **禁止**在路由器設定 Port Forwarding（連接埠轉發）。
- ❌ **禁止**公開你家裡的對外 IP。
- ✅ 本機**只允許 `127.0.0.1`（localhost）測試**。
- ✅ 若需提供他人使用，請**部署到雲端平台**，例如 **Cloudflare Pages、Render、Railway 或其他 Python Host**（見第 4 / 5 段）。
- ✅ **GitHub Repo 一律使用 Private。**

> 原因：本機直連對外等於把你的家用網路 / 主機暴露給陌生流量，且 `web_app.py` 是輕量
> 開發伺服器，無速率限制 / WAF / TLS。對外服務務必經由雲端平台（具備 HTTPS、隔離環境
> 與防護），不要用 Port Forwarding 或公開家裡 IP。

---

## 1. 本機啟動

需求：Python 3.10+（本專案用 3.14）。

```powershell
# 1) 建立虛擬環境並安裝套件
python -m venv .venv
.\.venv\Scripts\Activate.ps1            # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt

# 2) 啟動 Web（本機，只綁 127.0.0.1）
python web_app.py                       # → http://127.0.0.1:8000
# 0.0.0.0 僅供「雲端平台容器內」使用 (如 Render/Railway)，本機請勿用它對外，
# 且嚴禁搭配路由器 Port Forwarding：
#   python web_app.py 0.0.0.0 $PORT
```

開啟瀏覽器：**http://127.0.0.1:8000**（或 http://localhost:8000）。

> Web 版只需這些套件：`requests pandas numpy yfinance feedparser`
> （`schedule / psutil / finnhub-python / python-dotenv` 是 Telegram 私人版才用到，裝了也不影響）。

---

## 2. 本機測試

頁面輸入代號，或用 curl 測 API：

**台股**（market=TW）：`2330` `2887` `0050` `0056` `00878`
**美股**（market=US）：`NVDA` `AAPL` `MSFT` `GOOGL`

```bash
curl "http://127.0.0.1:8000/api/analyze?symbol=2330&market=TW"
curl "http://127.0.0.1:8000/api/analyze?symbol=NVDA&market=US"
# 持股損益（成本/股數，僅即時計算、不儲存）
curl "http://127.0.0.1:8000/api/analyze?symbol=2330&market=TW&cost=2000&qty=1000"
```

**成功判斷**：回應 JSON 含 `"ok": true` 與這些欄位：
`symbol, name, price, change_pct, stars, composite, factors, reasons, risks, catalysts,
fundamentals, industry_trend, industry_verdict, technical, chip, data_quality,
conclusion, decision`。
`decision` 含 `action（買進/分批布局/觀望/減碼/賣出）, confidence, risk_level, capital_pct,
risk_reward, target, stop, valuation（估值區間）, suitability, buy_reasons(≥5), not_buy_reasons(≥3)`。
帶 `cost`/`qty` 時另含 `holding`（report_pct / pnl / suggestion=續抱·加碼·減碼·停利·停損）。

代號錯誤（如 `99999`、`rm -rf`）會回 `"ok": false`（已擋下注入）。

### 平台分析能力（ARES v1.0）
- 基本面：營收 YoY、EPS YoY、Forward EPS、P/E、PEG、ROE、殖利率、淨利率
- 技術面：MA5/10/20/60/200、RSI、MACD、支撐、壓力、建議停損
- 籌碼面：台股（外資/投信/自營商、融資/融券）；美股（分析師評等、機構持股、Short Interest）
- 產業趨勢引擎：AI / 金融 / 其他 → 偏多 / 中性 / 偏空（不會出現「資料不足」）
- 決策引擎：五級建議 + 信心 + 風險等級 + 資金配置 + 風報比 + 估值區間
- 資料正確性：雙來源價格交叉驗證，差異 > 3% 標記異常並停止推薦

---

## 3. GitHub 上傳流程（手動，由你執行；建議 Private Repo）

> 本系統**不會**自動 `git init / commit / push`。以下由你手動執行。

```bash
git status --porcelain | grep -E "\.env|/logs/|/reports/|task\.lock"   # 應無輸出
git init
git add .
git status                 # 確認沒有 .env、logs/、reports/、任何 *.log
git commit -m "ARES stock web (public)"
git branch -M main
git remote add origin https://github.com/<你的帳號>/<repo>.git
git push -u origin main
```

⚠️ 完整專案的 `config/watchlist.json` 含你的台股持股。**請設為 Private repo**，
或把 `config/watchlist.json` 加入 `.gitignore`。（本 ZIP 內的 watchlist 已清空持股。）

---

## 4. GitHub Pages 部署（僅前端）

GitHub Pages **只能放靜態檔**（`web/` 內的 HTML/CSS/JS），**無法執行 Python 後端 `/api/analyze`**。

1. Settings → Pages → Source 選 `main`、目錄 `/web`（或把 web/ 內容放到 `docs/`）。
2. 修改 `web/app.js` 的 `fetch("/api/analyze...")`，改成你後端的網址。
3. 後端部署見下方。

## 5. Cloudflare Pages 部署（僅前端）

1. Cloudflare Pages → 連結 GitHub repo → Build output 目錄設 `web`。
2. 前端 `app.js` 的 API 位址改成你的後端網域。

### 後端（`web_app.py`）部署
`web_app.py` 是 Python 後端，**Pages / Cloudflare Pages 不能跑**。可選：
- **Python 託管**：Render / Railway / Fly.io / 自己的 VPS，跑 `python web_app.py 0.0.0.0 $PORT`。
- 或日後將後端改寫為 Cloudflare Worker（需另外開發）。

> 最簡單：本機或小主機跑 `python web_app.py 0.0.0.0 8000`，前端直接連它即可。

---

## 6. 如何驗證沒有機密資料

```bash
# (a) Web 程式不引用任何機密
grep -nE "dotenv|TELEGRAM|BOT_TOKEN|CHAT_ID|get_env|FINNHUB" web_app.py src/web_service.py
#    → 應無輸出（註解中的「不讀取 .env」字樣除外）

# (b) API 回應不含 token / chat_id / 金鑰 / 私人持股
curl -s "http://127.0.0.1:8000/api/analyze?symbol=2330&market=TW" | grep -E "TELEGRAM|FINNHUB|TOKEN|CHAT_ID|0056|00878"
#    → 應無輸出（如需比對實際 token，請自行用 .env 內的值，切勿寫進任何會上傳的檔案）

# (c) 機密 / 目錄無法透過網址存取（全部應 404）
for p in /.env /config/watchlist.json /logs/app.log /reports/latest_report.json /src/web_service.py; do
  curl -s -o /dev/null -w "%{http_code} $p\n" "http://127.0.0.1:8000$p"; done
```

伺服器只服務固定靜態白名單（`index.html / app.js / style.css`）+ `/api/analyze`，
**無任意檔案讀取、無路徑穿越**（`/../.env` → 404）。

---

## 7. 如何驗證不會讀取私人持股

```bash
grep -nE "watchlist|holdings" web_app.py src/web_service.py
#    → 應無輸出（Web 完全不讀取我的持股清單）
```

Web 版的持股（含成本/股數）**只存在使用者瀏覽器的 localStorage**（鍵名 `ai_stock_holdings`），
不會送到伺服器、不寫入 logs / reports / DB，也不會被任何人看到。
伺服器端只接受「單一代號 (+選填成本/股數)」做即時計算，不儲存任何使用者資料。

---

## 安全摘要
- 不讀 `.env`、不 import Telegram、不使用我的私人持股。
- 代號嚴格正則驗證（台股 `^\d{4,6}$`、美股 `^[A-Za-z]{1,10}$`），靜態檔白名單擋路徑穿越。
- 預設綁 `127.0.0.1`；**對外服務一律走雲端平台，不得直接暴露本機 / 不得 Port Forwarding / 不公開家裡 IP**（見上方「安全部署原則」）。
- 無 `os.system / subprocess / eval / exec / shell / powershell / cmd`。
