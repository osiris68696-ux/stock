"""Web 公開版 (給一般網友)。

使用者自行輸入股票代號 (台股 / 美股) 取得分析；自訂持股只存在瀏覽器 localStorage，
不送到也不存在伺服器。本服務**不讀取 .env、不碰 Telegram、不顯示任何私人持股 / 金鑰**。

啟動：
    python web_app.py                # 預設 127.0.0.1:8000 (本機)
    python web_app.py 0.0.0.0 8000   # 對外 (請自行評估安全/部署環境)

僅服務固定靜態檔 + /api/analyze，無任意檔案讀取，杜絕路徑穿越。
"""
from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

_ROOT = os.path.dirname(os.path.abspath(__file__))
_SRC = os.path.join(_ROOT, "src")
_WEB = os.path.join(_ROOT, "web")
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

import web_service  # noqa: E402

# 只允許服務這幾個靜態檔 (杜絕任意檔案 / 路徑穿越 / 不外洩 .env)
_STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "application/javascript; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
}


class Handler(BaseHTTPRequestHandler):
    server_version = "AIStockWeb/1.0"

    def _send(self, code, body: bytes, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8"),
                   "application/json; charset=utf-8")

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/analyze":
            qs = parse_qs(parsed.query)
            symbol = (qs.get("symbol", [""])[0])[:12]
            market = (qs.get("market", ["TW"])[0])[:4]
            cost = (qs.get("cost", [""])[0])[:16]
            qty = (qs.get("qty", [""])[0])[:16]
            if cost or qty:   # 帶持股成本/股數 → 加做損益分析 (不儲存)
                self._json(web_service.analyze_holding(symbol, market, cost, qty))
            else:
                self._json(web_service.analyze_stock(symbol, market))
            return

        static = _STATIC.get(path)
        if static:
            fname, ctype = static
            fpath = os.path.join(_WEB, fname)
            try:
                with open(fpath, "rb") as f:
                    self._send(200, f.read(), ctype)
            except Exception:
                self._send(404, b"Not Found", "text/plain; charset=utf-8")
            return

        self._send(404, b"Not Found", "text/plain; charset=utf-8")

    def log_message(self, fmt, *args):  # 安靜一點
        sys.stderr.write("[web] " + (fmt % args) + "\n")


def main():
    host = sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1"
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 8000
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"AI Stock Web 已啟動：http://{host}:{port}  (Ctrl+C 結束)")
    print("提示：持股只存在瀏覽器 localStorage，不會送到伺服器。")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
        httpd.server_close()


if __name__ == "__main__":
    main()
