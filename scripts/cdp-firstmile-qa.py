#!/usr/bin/env python3
"""Minimal CDP helper for isolated WodeAppX First Mile / chat QA."""
from __future__ import annotations

import argparse
import base64
import json
import os
import socket
import struct
import time
import urllib.request
from urllib.parse import urlparse


class StdlibWs:
    def __init__(self, url: str, timeout: float = 20):
        parsed = urlparse(url)
        host = parsed.hostname or "127.0.0.1"
        port = parsed.port or 80
        path = parsed.path or "/"
        if parsed.query:
            path += "?" + parsed.query
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            "\r\n"
        )
        self.sock = socket.create_connection((host, port), timeout=timeout)
        self.sock.settimeout(timeout)
        self.sock.sendall(req.encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise RuntimeError("websocket handshake closed")
            buf += chunk
        status = buf.split(b"\r\n", 1)[0]
        if b"101" not in status:
            raise RuntimeError(f"websocket handshake failed: {status!r}")

    def send(self, text: str):
        payload = text.encode()
        header = bytearray([0x81])
        n = len(payload)
        mask = os.urandom(4)
        if n < 126:
            header.append(0x80 | n)
        elif n < 65536:
            header.append(0x80 | 126)
            header.extend(struct.pack("!H", n))
        else:
            header.append(0x80 | 127)
            header.extend(struct.pack("!Q", n))
        header.extend(mask)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(header + masked)

    def _recv_exact(self, n: int) -> bytes:
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise RuntimeError("websocket closed")
            buf += chunk
        return buf

    def recv(self) -> str:
        while True:
            b1, b2 = self._recv_exact(2)
            opcode = b1 & 0x0F
            masked = b2 & 0x80
            n = b2 & 0x7F
            if n == 126:
                n = struct.unpack("!H", self._recv_exact(2))[0]
            elif n == 127:
                n = struct.unpack("!Q", self._recv_exact(8))[0]
            mask = self._recv_exact(4) if masked else b""
            payload = self._recv_exact(n)
            if mask:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            if opcode == 0x8:
                raise RuntimeError("websocket close")
            if opcode == 0x9:
                self.sock.sendall(b"\x8A\x80" + os.urandom(4))
                continue
            if opcode in (0x1, 0x2, 0x0):
                return payload.decode()

    def close(self):
        try:
            self.sock.close()
        except Exception:
            pass


def create_connection(url: str, timeout: float = 20):
    return StdlibWs(url, timeout=timeout)


INSPECT = r"""
(() => {
  const text = (el) => (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
  const allText = text(document.body).slice(0, 4000);
  const buttons = [...document.querySelectorAll("button, [role=button], a")]
    .map((el) => text(el)).filter(Boolean);
  const dialog = document.querySelector(".wx-first-mile-dialog, .wx-local-key-dialog");
  const dialogText = text(dialog);
  return {
    title: document.title,
    href: location.href,
    hasShell: Boolean(document.querySelector(".wapp-workspace-shell")),
    firstMileDialog: Boolean(document.querySelector(".wx-first-mile-dialog")),
    localKeyDialog: Boolean(document.querySelector(".wx-local-key-dialog")),
    startChip: buttons.some((label) => label.includes("开始使用")),
    desktopOtp: /验证码/.test(allText) && /手机号|邮箱/.test(allText),
    localKeyLabel: /本机 Key/.test(allText),
    configured: /本机 Key · 已配置/.test(allText) || /查看用量/.test(allText),
    canSkipLogin: /本机 Key · 可不登录/.test(allText),
    deepseekSetup: /DeepSeek/.test(dialogText || allText) && /去配置/.test(dialogText || allText),
    sendVisible: buttons.some((label) => label === "发送" || label === "Send"),
    composerFound: Boolean(document.querySelector('[contenteditable="true"], textarea, [role="textbox"]')),
    buttons: buttons.slice(0, 50),
    excerpt: allText.slice(0, 1200),
    bodyTail: allText.slice(-1500),
  };
})()
"""

CLICK = r"""
(() => {
  const needle = %s;
  const text = (el) => (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
  const nodes = [...document.querySelectorAll("button, [role=button], a, [data-testid]")];
  const exact = nodes.find((node) => text(node) === needle);
  const el = exact || nodes.find((node) => text(node).includes(needle));
  if (!el) return { ok: false, available: nodes.map(text).filter(Boolean).slice(0, 40) };
  el.click();
  return { ok: true, clicked: text(el).slice(0, 120) };
})()
"""

DISMISS = r"""
(() => {
  const text = (el) => (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
  const dialog = document.querySelector(".wx-first-mile-dialog, .wx-local-key-dialog");
  if (!dialog) return { ok: true, clicked: "", reason: "already-closed" };
  const labels = ["稍后", "Later", "忽略", "Skip", "关闭"];
  const nodes = [...dialog.querySelectorAll("button, [role=button], a")];
  for (const label of labels) {
    const el = nodes.find((node) => text(node) === label) || nodes.find((node) => text(node).includes(label));
    if (el) {
      el.click();
      return { ok: true, clicked: text(el).slice(0, 80) };
    }
  }
  const close = dialog.querySelector(".wx-login-dialog-close, [aria-label='关闭'], [aria-label='Close']");
  if (close) {
    close.click();
    return { ok: true, clicked: "close" };
  }
  return { ok: false, available: nodes.map(text).filter(Boolean).slice(0, 20) };
})()
"""


def list_pages(port: int):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=3) as res:
        return json.load(res)


def pick_page(pages):
    pages = [t for t in pages if t.get("type") == "page"]
    for t in pages:
        blob = f"{t.get('title','')} {t.get('url','')}"
        if "devtools://" in (t.get("url") or ""):
            continue
        if any(x in blob.lower() for x in ("wodeapp", "openwork", "5174", "5175")):
            return t
    return next((t for t in pages if "chrome://" not in (t.get("url") or "")), None)


class Cdp:
    def __init__(self, ws_url: str):
        self.ws = create_connection(ws_url, timeout=20)
        self.n = 0

    def send(self, method: str, params=None, timeout=20):
        self.n += 1
        self.ws.send(json.dumps({"id": self.n, "method": method, "params": params or {}}))
        deadline = time.time() + timeout
        while time.time() < deadline:
            raw = self.ws.recv()
            msg = json.loads(raw)
            if msg.get("id") == self.n:
                if msg.get("error"):
                    raise RuntimeError(json.dumps(msg["error"]))
                return msg.get("result") or {}
        raise TimeoutError(method)

    def evaluate(self, expression: str):
        result = self.send("Runtime.evaluate", {"expression": expression, "returnByValue": True})
        return (result.get("result") or {}).get("value")

    def screenshot(self, path: str):
        data = self.send("Page.captureScreenshot", {"format": "png"}).get("data")
        if not data:
            raise RuntimeError("empty screenshot")
        import base64
        from pathlib import Path
        Path(path).write_bytes(base64.b64decode(data))
        return path

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


def connect(port: int, tries: int = 40) -> Cdp:
    last = "no page"
    for _ in range(tries):
        try:
            page = pick_page(list_pages(port))
            if page and page.get("webSocketDebuggerUrl"):
                cdp = Cdp(page["webSocketDebuggerUrl"])
                cdp.send("Page.enable")
                cdp.send("Runtime.enable")
                return cdp
            last = f"targets={[t.get('title') for t in list_pages(port)]}"
        except Exception as exc:
            last = str(exc)
        time.sleep(1)
    raise RuntimeError(f"no CDP page on {port}: {last}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9833)
    ap.add_argument("--step", default="inspect")
    ap.add_argument("--click", default="")
    ap.add_argument("--text", default="")
    ap.add_argument("--shot", default="")
    ap.add_argument("--eval", dest="eval_expr", default="")
    args = ap.parse_args()

    cdp = connect(args.port)
    extra = {}
    try:
        if args.eval_expr:
            extra["eval"] = cdp.evaluate(args.eval_expr)
            time.sleep(0.4)
        if args.step in ("dismiss", "dismiss-first-mile"):
            extra["dismiss"] = cdp.evaluate(DISMISS)
            time.sleep(0.8)
        if args.click:
            extra["click"] = cdp.evaluate(CLICK % json.dumps(args.click))
            time.sleep(0.8)
        if args.step in ("type", "live-send"):
            blocked = cdp.evaluate(
                """(() => ({
                  firstMileDialog: Boolean(document.querySelector(".wx-first-mile-dialog")),
                  localKeyDialog: Boolean(document.querySelector(".wx-local-key-dialog")),
                }))()"""
            ) or {}
            extra["blocked"] = blocked
            if blocked.get("firstMileDialog") or blocked.get("localKeyDialog"):
                extra["send"] = {"ok": False, "reason": "dialog-open"}
            else:
                extra["focus"] = cdp.evaluate(
                    """(() => {
                      const editor = document.querySelector('[contenteditable="true"], textarea, [role="textbox"]');
                      editor?.focus(); editor?.click?.();
                      return { found: Boolean(editor), tag: editor?.tagName || "" };
                    })()"""
                )
                cdp.send("Input.insertText", {"text": args.text})
                time.sleep(0.4)
                extra["typed"] = cdp.evaluate(
                    """(() => {
                      const editor = document.querySelector('[contenteditable="true"], textarea, [role="textbox"]');
                      return editor?.innerText || editor?.value || "";
                    })()"""
                )
        if args.step in ("send", "live-send") and not (extra.get("send") or {}).get("reason"):
            extra["send"] = cdp.evaluate(CLICK % json.dumps("发送"))
            if not extra["send"].get("ok"):
                extra["send"] = cdp.evaluate(CLICK % json.dumps("Send"))
            time.sleep(1.0)
        inspect = cdp.evaluate(INSPECT) or {}
        if args.shot:
            try:
                inspect["screenshot"] = cdp.screenshot(args.shot)
            except Exception as exc:
                inspect["screenshotError"] = str(exc)
        print(json.dumps({"step": args.step, "extra": extra, "inspect": inspect}, ensure_ascii=False, indent=2))
    finally:
        cdp.close()


if __name__ == "__main__":
    main()
