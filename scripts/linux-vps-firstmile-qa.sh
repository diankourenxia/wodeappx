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
  python3 - <<'PY'
import os, signal, time
needles = []
bin_path = os.environ.get("WODEAPPX_LINUX_BIN") or os.environ.get("_QA_BIN") or ""
qa = os.environ.get("WODEAPPX_QA_DIR") or ""
if bin_path:
    needles.append(bin_path)
if qa:
    needles.append(qa.rstrip("/") + "/extract/squashfs-root/WodeAppX")
    needles.append(qa.rstrip("/") + "/userdata")
port = os.environ.get("OPENWORK_ELECTRON_REMOTE_DEBUG_PORT") or ""
killed = []
for line in os.popen("ps -eo pid,args").read().splitlines():
    parts = line.strip().split(None, 1)
    if len(parts) < 2 or not parts[0].isdigit():
        continue
    pid, args = int(parts[0]), parts[1]
    if pid == os.getpid() or "bash" in args.split()[:1] or "python" in args:
        continue
    if any(n and n in args for n in needles) and "ssh" not in args and "scp" not in args:
        try:
            os.kill(pid, signal.SIGTERM)
            killed.append(pid)
        except OSError:
            pass
if port:
    os.system(f"fuser -k {port}/tcp >/dev/null 2>&1 || true")
time.sleep(2)
for pid in killed:
    try:
        os.kill(pid, signal.SIGKILL)
    except OSError:
        pass
print("[qa] cleanup killed", killed)
PY
  APP_PID=""
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
export WODEAPPX_LINUX_BIN="$BIN"
export WODEAPPX_QA_DIR="$QA"
export OPENWORK_ELECTRON_REMOTE_DEBUG_PORT="$PORT"
export _QA_BIN="$BIN"
echo "[qa] bin=$BIN"
file "$BIN" | tee "$REPORT/bin.txt"
CDP_SRC="${WODEAPPX_CDP_SCRIPT:-}"
if [[ -z "$CDP_SRC" && -f "$(dirname "$0")/cdp-firstmile-qa.py" ]]; then
  CDP_SRC="$(dirname "$0")/cdp-firstmile-qa.py"
fi
if [[ -n "$CDP_SRC" && "$CDP_SRC" != "$QA/cdp-firstmile-qa.py" ]]; then
  cp -f "$CDP_SRC" "$QA/cdp-firstmile-qa.py"
fi

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
  export ELECTRON_EXTRA_LAUNCH_ARGS="--disable-gpu --no-sandbox --disable-dev-shm-usage --disable-gpu-sandbox --in-process-gpu"
  export LIBGL_ALWAYS_SOFTWARE=1
  export WODEAPPX_DISABLE_SELF_EVOLVE_WORKSPACES=1
  unset WODEAPPX_LOCAL_SIDECAR WODEAPP_MONOREPO_ROOT
  xvfb-run -a -s "-screen 0 1400x900x24 +extension GLX" "$BIN" \
    --no-sandbox --disable-gpu --disable-dev-shm-usage --disable-gpu-sandbox --in-process-gpu \
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

wait_ready() {
  local label="${1:-ready}"
  local shot="$REPORT/wait-$label"
  for i in $(seq 1 40); do
    if ! kill -0 "$APP_PID" 2>/dev/null; then
      tail -n 40 "$REPORT/electron.log" || true
      echo "[qa] app died while waiting $label"
      return 1
    fi
    cdp --step inspect --shot "$shot-$i.png" | tee "$shot-$i.json" >/dev/null
    if python3 - <<PY
import json
from pathlib import Path
d = json.loads(Path("$shot-$i.json").read_text())
ins = d.get("inspect") or {}
text = (ins.get("excerpt") or "") + (ins.get("bodyTail") or "")
ok = bool(ins.get("sendVisible") or ins.get("composerFound")) and "Preparing workspace" not in text
print("ready" if ok else "wait", "send", ins.get("sendVisible"), "composer", ins.get("composerFound"))
raise SystemExit(0 if ok else 1)
PY
    then
      echo "[qa] $label after ${i}s"
      return 0
    fi
    sleep 2
  done
  echo "[qa] $label timeout"
  return 1
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
if [[ ! -f "$QA/deepseek.keys.json" ]]; then
  echo "[qa] missing $QA/deepseek.keys.json (seed DEEPSEEK only)" >&2
  exit 1
fi
python3 - <<PY
import json
from pathlib import Path
src = Path("$QA/deepseek.keys.json")
data = json.loads(src.read_text())
vars_ = data.get("variables") or []
ok = any(isinstance(x, dict) and x.get("key") == "DEEPSEEK_API_KEY" and str(x.get("value") or "").strip() for x in vars_)
print("[qa] seed keys=", src.stat().st_size, "bytes deepseek=", ok)
raise SystemExit(0 if ok else 1)
PY
cp "$QA/deepseek.keys.json" "$KEYS"
chmod 600 "$KEYS"
rm -rf "$USERDATA"
mkdir -p "$USERDATA"
launch
cdp --step inspect --shot "$REPORT/with-key.png" | tee "$REPORT/with-key.json"
cdp --step inspect --click "更新" --shot "$REPORT/refresh-keys.png" | tee "$REPORT/refresh-keys.json" || true
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 3
  cdp --step inspect --shot "$REPORT/ingest-$i.png" | tee "$REPORT/ingest-$i.json"
  if python3 - <<PY
import json
from pathlib import Path
d = json.loads(Path("$REPORT/ingest-$i.json").read_text())
ins = d.get("inspect") or {}
ok = bool(ins.get("configured"))
print("configured" if ok else "waiting_key")
raise SystemExit(0 if ok else 1)
PY
  then
    echo "[qa] local key ingested at poll $i"
    break
  fi
done
cdp --step dismiss --shot "$REPORT/dismiss.png" | tee "$REPORT/dismiss.json"
cdp --step dismiss --shot "$REPORT/dismiss-2.png" | tee "$REPORT/dismiss-2.json" || true
cdp --step new-session --click "新建对话" --shot "$REPORT/new-session.png" | tee "$REPORT/new-session.json" || true
wait_ready after-new-session || true
cdp --step live-send --text "你好" --shot "$REPORT/live-send.png" | tee "$REPORT/live-send.json"
python3 - <<PY
import json
from pathlib import Path
d = json.loads(Path("$REPORT/live-send.json").read_text())
extra = d.get("extra") or {}
send = extra.get("send") or {}
if not send.get("ok"):
    raise SystemExit("send blocked: " + json.dumps(send, ensure_ascii=False))
typed = str(extra.get("typed") or "")
if "你好" not in typed:
    print("[qa] warn typed missing 你好:", typed[:80])
print("[qa] send ok")
PY
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  sleep 5
  cdp --step poll --shot "$REPORT/poll-$i.png" | tee "$REPORT/poll-$i.json"
  if python3 - <<PY
import json
from pathlib import Path
p = Path("$REPORT/poll-$i.json")
d = json.loads(p.read_text())
ins = d.get("inspect") or {}
text = (ins.get("bodyTail") or "") + "\n" + (ins.get("excerpt") or "")
ok = "你好" in text and not ins.get("firstMileDialog") and (
    "WodeAppX" in text or "工作台" in text or "助手" in text or "帮助" in text
    or "你好" in (ins.get("bodyTail") or "")
)
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
