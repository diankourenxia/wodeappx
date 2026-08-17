#!/usr/bin/env python3
"""Create a real session on a packaged WodeAppX sidecar and send 你好."""
from __future__ import annotations

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


def find_engine(root: Path) -> dict:
    for _ in range(90):
        hits = list(root.rglob("openwork-engine.json"))
        if hits:
            return json.loads(hits[0].read_text(encoding="utf-8"))
        time.sleep(1)
    raise SystemExit("openwork-engine.json not found")


def request(base: str, user: str, password: str, method: str, path: str, body=None):
    data = None if body is None else json.dumps(body).encode()
    token = base64.b64encode(f"{user}:{password}".encode()).decode()
    req = urllib.request.Request(
        base.rstrip("/") + path,
        data=data,
        method=method,
        headers={"Authorization": f"Basic {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as res:
            raw = res.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:400]
        raise SystemExit(f"HTTP {exc.code} {path}: {detail}") from exc


def pick_deepseek(config: dict) -> dict:
    prov = config.get("provider") or {}
    models = (prov.get("deepseek") or {}).get("models") or {}
    mid = "deepseek-chat"
    if isinstance(models, dict) and models:
        for cand in models:
            low = str(cand).lower()
            if "v4" in low or "flash" in low or cand == "deepseek-chat":
                mid = cand
                break
        else:
            mid = next(iter(models))
    return {"providerID": "deepseek", "modelID": mid}


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    userdata = Path(os.environ.get("OPENWORK_ELECTRON_USERDATA") or "").expanduser()
    if not userdata.is_dir():
        raise SystemExit("OPENWORK_ELECTRON_USERDATA missing")
    engine = find_engine(userdata)
    base = engine.get("baseUrl") or ""
    user = engine.get("username") or ""
    password = engine.get("password") or ""
    if not base or not user or not password:
        raise SystemExit("engine missing baseUrl/username/password")
    print("engine_base", base)
    config = request(base, user, password, "GET", "/config")
    providers = list((config.get("provider") or {}).keys()) if isinstance(config.get("provider"), dict) else []
    print("providers", providers[:12])
    if "deepseek" not in providers:
        raise SystemExit(f"deepseek not connected: {providers}")
    model = pick_deepseek(config)
    print("model", model)
    session = request(base, user, password, "POST", "/session", {"title": "gha-hello"})
    sid = session.get("id") or (session.get("info") or {}).get("id")
    if not sid:
        raise SystemExit("session create failed")
    print("session", sid)
    request(base, user, password, "POST", f"/session/{sid}/prompt_async", {
        "model": model,
        "parts": [{"type": "text", "text": "你好"}],
    })
    reply = ""
    for i in range(24):
        time.sleep(5)
        messages = request(base, user, password, "GET", f"/session/{sid}/message")
        texts = []
        for message in messages if isinstance(messages, list) else []:
            role = (message.get("info") or {}).get("role") or message.get("role")
            for part in message.get("parts") or []:
                if part.get("type") == "text" and part.get("text"):
                    texts.append((role, part["text"]))
        print("poll", i, [(role, text[:80]) for role, text in texts[-4:]])
        for role, text in texts:
            if role == "assistant" and text.strip():
                reply = text
                break
        if reply:
            break
    if not reply:
        raise SystemExit("no assistant reply")
    print("reply_prefix", reply[:120].replace("\n", " "))
    print("WINDOWS_FIRSTMILE_CHAT_PASS" if os.name == "nt" else "PACKAGED_HELLO_PASS")
    print("VERDICT PASS")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("VERDICT FAIL", file=sys.stderr)
        print(exc, file=sys.stderr)
        raise
