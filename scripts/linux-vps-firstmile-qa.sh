#!/usr/bin/env bash
# Isolated Linux AppImage First Mile + chat QA on a VPS.
# Does not touch /var/www/wodeapp or production containers.
set -euo pipefail

QA="${WODEAPPX_QA_DIR:-/opt/wodeappx-oss-verify/install-qa-v100}"
PORT="${OPENWORK_ELECTRON_REMOTE_DEBUG_PORT:-9833}"
APPIMAGE="${WODEAPPX_APPIMAGE:-/var/www/wodeappx-releases/wodeappx-linux-x86_64-1.0.0.AppImage}"
HOME_DIR="$QA/home"
USERDATA="$QA/userdata"
EXTRACT="$QA/extract"
REPORT="$QA/report"
KEYS="$HOME_DIR/.wodeapp/keys.json"
BIN="${WODEAPPX_LINUX_BIN:-}"

mkdir -p "$HOME_DIR/.wodeapp" "$USERDATA" "$EXTRACT" "$REPORT"

cleanup() {
  if [[ -n "${APP_PID:-}" ]] && kill -0 "$APP_PID" 2>/dev/null; then
    kill "$APP_PID" 2>/dev/null || true
    sleep 2
    kill -9 "$APP_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [[ -z "$BIN" ]]; then
  if [[ ! -f "$EXTRACT/squashfs-root/WodeAppX" && ! -f "$EXTRACT/squashfs-root/@openworkdesktop" ]]; then
    echo "[qa] extract $APPIMAGE"
    cp -f "$APPIMAGE" "$QA/wodeappx-linux-x86_64-1.0.0.AppImage"
    chmod +x "$QA/wodeappx-linux-x86_64-1.0.0.AppImage"
    (cd "$EXTRACT" && "$QA/wodeappx-linux-x86_64-1.0.0.AppImage" --appimage-extract >/dev/null)
  fi
  BIN="$(find "$EXTRACT/squashfs-root" -maxdepth 3 -type f \( -name WodeAppX -o -name wodeappx -o -name '@openworkdesktop' \) -perm -u+x | head -1)"
fi
test -n "$BIN"
echo "[qa] bin=$BIN"
file "$BIN" | tee "$REPORT/bin.txt"

if ! python3 -c "import websocket" 2>/dev/null; then
  python3 -m pip install --user --quiet websocket-client
fi

launch() {
  cleanup
  mkdir -p "$HOME_DIR/.wodeapp" "$USERDATA"
  export HOME="$HOME_DIR"
  export XDG_CONFIG_HOME="$HOME_DIR/.config"
  export WODEAPP_CONFIG_DIR="$HOME_DIR/.wodeapp"
  export OPENWORK_ENV_STORE="$KEYS"
  export OPENWORK_ELECTRON_USERDATA="$USERDATA"
  export OPENWORK_ELECTRON_REMOTE_DEBUG_PORT="$PORT"
  export ELECTRON_EXTRA_LAUNCH_ARGS="--disable-gpu --no-sandbox --disable-dev-shm-usage"
  export WODEAPPX_DISABLE_SELF_EVOLVE_WORKSPACES=1
  unset WODEAPPX_LOCAL_SIDECAR WODEAPP_MONOREPO_ROOT
  xvfb-run -a -s "-screen 0 1400x900x24" "$BIN" --no-sandbox --disable-gpu --disable-dev-shm-usage \
    >"$REPORT/electron.log" 2>&1 &
  APP_PID=$!
  echo "$APP_PID" > "$REPORT/pid"
  for i in $(seq 1 120); do
    if ! kill -0 "$APP_PID" 2>/dev/null; then
      tail -n 80 "$REPORT/electron.log"
      echo "[qa] app exited before CDP"
      return 1
    fi
    if curl -sf "http://127.0.0.1:$PORT/json/version" >/dev/null; then
      echo "[qa] CDP up after ${i}s"
      return 0
    fi
    sleep 1
  done
  tail -n 80 "$REPORT/electron.log"
  echo "[qa] CDP timeout"
  return 1
}

cdp() {
  python3 "$QA/cdp-firstmile-qa.py" --port "$PORT" "$@"
}

echo "[qa] phase empty-store"
printf '%s\n' '{"schemaVersion":1,"variables":[]}' > "$KEYS"
rm -rf "$USERDATA"
mkdir -p "$USERDATA"
launch
cdp --step inspect --shot "$REPORT/empty.png" | tee "$REPORT/empty.json"
cdp --step inspect --click "本机 Key" --shot "$REPORT/click-local.png" | tee "$REPORT/click-local.json" || true
if ! grep -q '"localKeyDialog": true\|"firstMileDialog": true' "$REPORT/click-local.json" "$REPORT/empty.json" 2>/dev/null; then
  cdp --eval 'window.dispatchEvent(new CustomEvent("wodeapp:open-first-mile"))' --shot "$REPORT/open-event.png" | tee "$REPORT/open-event.json" || true
fi

echo "[qa] phase with-key"
cleanup
python3 - <<'PY'
import json, os
from pathlib import Path
qa = Path(os.environ["WODEAPPX_QA_DIR"] if False else "")
PY
if [[ ! -f "$QA/deepseek.keys.json" ]]; then
  echo "[qa] missing $QA/deepseek.keys.json (seed DEEPSEEK only)" >&2
  exit 1
fi
cp "$QA/deepseek.keys.json" "$KEYS"
chmod 600 "$KEYS"
rm -rf "$USERDATA"
mkdir -p "$USERDATA"
launch
cdp --step inspect --shot "$REPORT/with-key.png" | tee "$REPORT/with-key.json"
cdp --step new-session --click "新建对话" --shot "$REPORT/new-session.png" | tee "$REPORT/new-session.json" || true
cdp --step live-send --text "你好" --shot "$REPORT/live-send.png" | tee "$REPORT/live-send.json"
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  sleep 5
  cdp --step poll --shot "$REPORT/poll-$i.png" | tee "$REPORT/poll-$i.json"
  if python3 - <<PY
import json
from pathlib import Path
p = Path("$REPORT/poll-$i.json")
d = json.loads(p.read_text())
text = (d.get("inspect") or {}).get("bodyTail") or (d.get("inspect") or {}).get("excerpt") or ""
ok = "你好" in text and ("WodeAppX" in text or "工作台" in text or "助手" in text or "帮助" in text)
print("reply_hit" if ok else "wait")
raise SystemExit(0 if ok else 1)
PY
  then
    echo "[qa] chat reply seen at poll $i"
    echo LINUX_FIRSTMILE_CHAT_PASS
    exit 0
  fi
done
echo "[qa] chat reply not seen"
exit 1
