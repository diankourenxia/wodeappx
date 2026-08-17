#!/usr/bin/env node
/**
 * Prepare an isolated "newbie" profile for config + ops demo recording.
 *
 * Creates empty WODEAPP_CONFIG_DIR + OPENWORK_ELECTRON_USERDATA so the desktop
 * starts without prior Origin / API Key / sessions — closer to a first-time user.
 *
 * Usage:
 *   node wodeappx/scripts/ops-demo-prepare-newbie.mjs
 *   node wodeappx/scripts/ops-demo-prepare-newbie.mjs --outdir ~/Desktop/wodeappx-demo-recordings
 *
 * Then launch (example):
 *   WODEAPP_CONFIG_DIR=... OPENWORK_ELECTRON_USERDATA=... pnpm openwork:dev
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function parseArgs(argv) {
  const out = {
    outdir: join(homedir(), "Desktop/wodeappx-demo-recordings"),
    id: stamp(),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--outdir" && next) {
      out.outdir = resolve(next);
      i++;
    } else if (a === "--id" && next) {
      out.id = next;
      i++;
    }
  }
  return out;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = join(opts.outdir, `newbie-${opts.id}`);
  const configDir = join(root, ".wodeapp");
  const userDataDir = join(root, "electron-user-data");
  mkdirSync(configDir, { recursive: true });
  mkdirSync(userDataDir, { recursive: true });

  // Intentionally NO config.json — first launch should look unconfigured.
  const readme = join(root, "README.txt");
  const launchSh = join(root, "launch-openwork-dev.sh");
  const launchBody = `#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
export WODEAPP_CONFIG_DIR="$ROOT/.wodeapp"
export OPENWORK_ELECTRON_USERDATA="$ROOT/electron-user-data"
export OPENWORK_ELECTRON_REMOTE_DEBUG_PORT="\${OPENWORK_ELECTRON_REMOTE_DEBUG_PORT:-9833}"
# Resolve monorepo wodeappx (this profile lives under Desktop/wodeappx-demo-recordings/...)
WODEAPPX_DIR="\${WODEAPPX_DIR:-}"
if [ -z "\$WODEAPPX_DIR" ]; then
  for cand in \\
    "\$HOME/Desktop/wodeapp/wodeappx" \\
    "\$ROOT/../../wodeapp/wodeappx" \\
    "\$ROOT/../../../wodeapp/wodeappx"
  do
    if [ -f "\$cand/package.json" ]; then WODEAPPX_DIR="\$cand"; break; fi
  done
fi
if [ -z "\$WODEAPPX_DIR" ]; then
  echo "Set WODEAPPX_DIR to your monorepo wodeappx path" >&2
  exit 1
fi
cd "\$WODEAPPX_DIR"
echo "WODEAPP_CONFIG_DIR=$WODEAPP_CONFIG_DIR"
echo "OPENWORK_ELECTRON_USERDATA=$OPENWORK_ELECTRON_USERDATA"
echo "OPENWORK_ELECTRON_REMOTE_DEBUG_PORT=$OPENWORK_ELECTRON_REMOTE_DEBUG_PORT"
echo "cwd=$WODEAPPX_DIR"
exec pnpm openwork:dev
`;

  writeFileSync(
    readme,
    [
      "WodeAppX newbie profile (isolated)",
      "",
      `id: ${opts.id}`,
      `config: ${configDir}`,
      `userData: ${userDataDir}`,
      "",
      "This profile has NO config.json — open Settings → 服务与模型 and configure 本地 + API Key from scratch.",
      "Keep your normal ~/.wodeapp untouched.",
      "",
      "Launch:",
      `  bash ${launchSh}`,
      "",
      "Then record (CDP port must match the running newbie app):",
      "  cd wodeappx && pnpm ops:demo-record -- --port 9833 --scenarios settings,image,cu",
      "",
      "Prerequisite: local mainserver on http://127.0.0.1:3000 for 本地 mode.",
      "Requires desktop build that honors WODEAPP_CONFIG_DIR + OPENWORK_ELECTRON_USERDATA (restart after openwork:patch if needed).",
      "",
    ].join("\n"),
  );
  writeFileSync(launchSh, launchBody, { mode: 0o755 });

  const meta = {
    id: opts.id,
    root,
    configDir,
    userDataDir,
    cdpPortHint: 9833,
    hasConfigJson: existsSync(join(configDir, "config.json")),
  };
  writeFileSync(join(root, "profile.json"), JSON.stringify(meta, null, 2));
  console.log(JSON.stringify({ ok: true, ...meta, launch: launchSh, readme }, null, 2));
}

main();
