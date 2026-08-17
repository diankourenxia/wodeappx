#!/usr/bin/env node
/**
 * Sticky / deferred tool visibility gate.
 *
 * Forbidden: fake chat models (`dynamic-test/fake`, forged chat.completions SSE)
 * pretending the desktop sidecar “already works”.
 *
 * Layers:
 * 1. Always: LIVE (or `--binary=`) sidecar binary embeds sticky markers + real
 *    `dynamic-tool-discovery` bun tests (sticky ON/OFF matrix). No LLM.
 * 2. `--require-live`: also run a **real OpenCode session** on the running
 *    sidecar with **real `prompt_async`** (may burn WodeApp credits). UI/CDP
 *    display is NOT required — session HTTP is enough.
 *
 * Usage:
 *   pnpm check:sticky-loaded
 *   pnpm check:sticky-loaded:live
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const wodeappxRoot = path.resolve(scriptDir, "..");
const discoveryTs = path.join(wodeappxRoot, "integrations/opencode/dynamic-tool-discovery.ts");
const discoveryTest = path.join(wodeappxRoot, "integrations/opencode/dynamic-tool-discovery.test.ts");
const stickyLeaseTs = path.join(wodeappxRoot, "integrations/opencode/session-sticky-leases.ts");
const bashDetachTs = path.join(wodeappxRoot, "integrations/opencode/bash-background-detach.ts");
const ENGINE_CANDIDATES = [
  process.env.OPENWORK_ENGINE_JSON?.trim(),
  path.join(homedir(), "Library/Application Support/com.differentai.openwork/openwork-engine.json"),
  path.join(homedir(), ".openwork/openwork-engine.json"),
].filter(Boolean);

function readArg(name) {
  const args = process.argv.slice(2);
  const direct = args.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function hasFlag(name) {
  return process.argv.slice(2).includes(name);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited ${result.status}\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout ?? "";
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function findLiveSidecarBinary() {
  const fromArg = readArg("--binary");
  if (fromArg) return path.resolve(fromArg);

  const ps = spawnSync("pgrep", ["-lf", "resources/sidecars/opencode"], { encoding: "utf8" });
  for (const line of (ps.stdout || "").split(/\r?\n/).filter(Boolean)) {
    const match = line.match(/(\/\S+\/sidecars\/opencode(?:-[^\s]+)?)\s+serve\b/);
    if (match?.[1]) return match[1];
  }

  return path.join(
    wodeappxRoot,
    "vendor/openwork/apps/desktop/resources/sidecars/opencode-aarch64-apple-darwin",
  );
}

function findLiveSidecarPort() {
  const ps = spawnSync("pgrep", ["-lf", "resources/sidecars/opencode"], { encoding: "utf8" });
  for (const line of (ps.stdout || "").split(/\r?\n/).filter(Boolean)) {
    const match = line.match(/--port\s+(\d+)/);
    if (match) return Number(match[1]);
  }
  return null;
}

function binaryHasSticky(binaryPath) {
  const out = spawnSync("strings", [binaryPath], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (out.status !== 0) throw new Error(`strings failed on ${binaryPath}: ${out.stderr}`);
  const text = out.stdout || "";
  return {
    emptyWriteThrash: (text.match(/EMPTY_WRITE_THRASH/g) || []).length,
    stickyEnv: (text.match(/OPENCODE_STICKY_LOADED/g) || []).length,
  };
}

async function loadEngineAuth() {
  for (const filePath of ENGINE_CANDIDATES) {
    if (!(await exists(filePath))) continue;
    const raw = JSON.parse(await readFile(filePath, "utf8"));
    const baseUrl = String(raw.baseUrl || "").replace(/\/$/, "");
    const username = String(raw.username || raw?.auth?.username || "");
    const password = String(raw.password || raw?.auth?.password || "");
    const directory = String(raw.directory || raw.projectDir || "").trim();
    if (baseUrl && username && password) {
      return { filePath, baseUrl, username, password, directory };
    }
  }
  return null;
}

function authHeaders(engine) {
  return {
    Authorization: `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString("base64")}`,
    "Content-Type": "application/json",
    ...(engine.directory ? { "x-opencode-directory": engine.directory } : {}),
  };
}

async function requestJson(baseUrl, headers, method, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${pathname} → ${response.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function waitForIdle(baseUrl, headers, sessionId, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const status = await requestJson(baseUrl, headers, "GET", "/session/status");
    const row = status && typeof status === "object" ? status[sessionId] ?? status : status;
    const type = row && typeof row === "object" ? row.type : row;
    last = type;
    if (type === "idle" || type == null || type === undefined) return type;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`${label} timed out waiting for idle (last=${last})`);
}

function pickModel(config) {
  const preferred = [
    readArg("--model"),
    "wode/kimi-code-k3-256k",
    "kimicode/k3-256k",
    "wode/kimi-code-k3",
  ].filter(Boolean);
  const configured = typeof config?.model === "string" ? config.model : "";
  const wodeModels = config?.provider?.wodeapp?.models || {};
  for (const cand of preferred) {
    const id = cand.includes("/") && !cand.startsWith("wodeapp/")
      ? cand.replace(/^wodeapp\//, "")
      : cand;
    const bare = id.includes("/") ? id.split("/").slice(1).join("/") : id;
    if (wodeModels[bare] || wodeModels[id] || wodeModels[`wode/${bare}`]) {
      return { providerID: "wodeapp", modelID: wodeModels[bare] ? bare : (wodeModels[id] ? id : `wode/${bare}`) };
    }
  }
  if (configured.includes("/")) {
    const [providerID, ...rest] = configured.split("/");
    return { providerID, modelID: rest.join("/") };
  }
  return { providerID: "wodeapp", modelID: configured || "wode/kimi-code-k3-256k" };
}

function messageBlob(messages) {
  return JSON.stringify(messages ?? [], null, 0);
}

/**
 * Real session + real prompt on the LIVE sidecar (credits OK).
 * Turn A: tool_search browser + status. Turn B: 「已登录」must still reach browser tools.
 */
async function runLiveSessionPromptGate() {
  const engine = await loadEngineAuth();
  const port = findLiveSidecarPort();
  if (!engine && !port) {
    throw new Error("LIVE sidecar not found (need openwork-engine.json and/or opencode serve --port)");
  }
  const baseUrl = engine?.baseUrl || `http://127.0.0.1:${port}`;
  if (!engine?.username || !engine?.password) {
    throw new Error("LIVE OpenCode basic auth missing in openwork-engine.json");
  }
  const headers = authHeaders(engine);
  const config = await requestJson(baseUrl, headers, "GET", "/config");
  const model = pickModel(config);

  const session = await requestJson(baseUrl, headers, "POST", "/session", {
    title: `sticky-live-prompt ${new Date().toISOString()}`,
  });
  if (!session?.id) throw new Error("LIVE session create failed");

  await requestJson(baseUrl, headers, "POST", `/session/${session.id}/prompt_async`, {
    model,
    parts: [{
      type: "text",
      text: "只做工具调用：先 tool_search，query 用 \"wodeappx_browser\"，加载后调用一次 wodeappx_browser_status。不要 write /tmp，不要长文。",
    }],
  });
  await waitForIdle(baseUrl, headers, session.id, 180_000, "turnA");
  const afterA = await requestJson(baseUrl, headers, "GET", `/session/${session.id}/message`);
  const blobA = messageBlob(afterA);
  if (!blobA.includes("tool_search") && !blobA.includes("wodeappx_browser")) {
    throw new Error(`turnA did not exercise tool_search/browser tools\nsession=${session.id}`);
  }

  await requestJson(baseUrl, headers, "POST", `/session/${session.id}/prompt_async`, {
    model,
    parts: [{
      type: "text",
      text: "已登录。请直接再调用一次 wodeappx_browser_status（仅当工具不可见时才 tool_search）。禁止 write /tmp。",
    }],
  });
  await waitForIdle(baseUrl, headers, session.id, 180_000, "turnB");
  const afterB = await requestJson(baseUrl, headers, "GET", `/session/${session.id}/message`);

  let sawLogin = false;
  let browserAfterLogin = 0;
  let writeAfterLogin = 0;
  for (const message of Array.isArray(afterB) ? afterB : []) {
    const blob = JSON.stringify(message);
    const role = message?.info?.role || message?.role;
    if (role === "user" && blob.includes("已登录")) {
      sawLogin = true;
      continue;
    }
    if (!sawLogin) continue;
    if (blob.includes("wodeappx_browser")) browserAfterLogin += 1;
    if (/"tool"\s*:\s*"write"/.test(blob)) writeAfterLogin += 1;
  }

  if (!sawLogin) throw new Error(`turnB user「已登录」not found in session ${session.id}`);
  if (browserAfterLogin < 1) {
    throw new Error(
      `After「已登录」, no wodeappx_browser_* tool activity (sticky likely missing). session=${session.id}`,
    );
  }

  return {
    sessionId: session.id,
    baseUrl,
    model,
    prompted: true,
    credits: true,
    uiRequired: false,
    turnAHadBrowserOrSearch: true,
    turnBBrowserMentions: browserAfterLogin,
    turnBWriteMentions: writeAfterLogin,
  };
}

async function resolveOpenCodeTestRoot() {
  const cacheBase = process.env.WODEAPPX_OPENCODE_BUILD_CACHE?.trim()
    || path.join(process.env.XDG_CACHE_HOME?.trim() || path.join(homedir(), ".cache"), "wodeappx", "opencode");
  const entries = spawnSync("ls", ["-1t", cacheBase], { encoding: "utf8" });
  if (entries.status !== 0) {
    throw new Error(`No OpenCode build cache under ${cacheBase}; run opencode:build-patched once.`);
  }
  for (const name of entries.stdout.split(/\r?\n/).filter(Boolean)) {
    const pkg = path.join(cacheBase, name, "source/packages/opencode");
    if (await exists(path.join(pkg, "package.json"))) return pkg;
  }
  throw new Error(`No packages/opencode under ${cacheBase}`);
}

async function syncDiscoveryInto(pkgRoot) {
  const destTs = path.join(pkgRoot, "src/session/dynamic-tool-discovery.ts");
  const destTest = path.join(pkgRoot, "src/session/dynamic-tool-discovery.test.ts");
  const destSticky = path.join(pkgRoot, "src/session/session-sticky-leases.ts");
  const destBash = path.join(pkgRoot, "src/session/bash-background-detach.ts");
  const destPreload = path.join(pkgRoot, "src/session/wodeapp-capability-preload.ts");
  const preloadTs = path.join(wodeappxRoot, "integrations/opencode/wodeapp-capability-preload.ts");
  await mkdir(path.dirname(destTs), { recursive: true });
  await copyFile(discoveryTs, destTs);
  await copyFile(discoveryTest, destTest);
  await copyFile(stickyLeaseTs, destSticky);
  await copyFile(bashDetachTs, destBash);
  await copyFile(preloadTs, destPreload);
  return { destTs, destTest };
}

async function writeBrowserMatrixTest(pkgRoot) {
  const dest = path.join(pkgRoot, "src/session/.tmp-sticky-browser-matrix.test.ts");
  await writeFile(dest, `import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { jsonSchema, tool as aiTool } from "ai"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { __testing, exposeDynamicTools } from "./dynamic-tool-discovery.ts"

function def(description: string) {
  return aiTool({
    description,
    inputSchema: jsonSchema({ type: "object", properties: {}, additionalProperties: false }),
    execute: async () => ({ output: "ok", title: "ok", metadata: {} }),
  })
}

const tools = {
  write: def("Write a file."),
  bash: def("Run bash."),
  read: def("Read a file."),
  tool_search: def("placeholder"),
  wodeappx_browser_status: def("Browser status."),
  wodeappx_browser_open_url: def("Open URL."),
  wodeappx_browser_read_page: def("Read page."),
}

const namespaces = [{
  name: "wodeappx-browser-control",
  instructions: "browser",
  tools: Object.keys(tools).filter((id) => id.startsWith("wodeappx_browser_")),
}]

let stickyLeaseDir = ""

beforeEach(() => {
  stickyLeaseDir = mkdtempSync(join(tmpdir(), "sticky-matrix-"))
  process.env.OPENCODE_STICKY_LEASE_DIR = stickyLeaseDir
})

afterEach(() => {
  __testing.reset()
  delete process.env.OPENCODE_STICKY_LOADED
  delete process.env.OPENCODE_STICKY_LEASE_DIR
  if (stickyLeaseDir) {
    try { rmSync(stickyLeaseDir, { recursive: true, force: true }) } catch {}
    stickyLeaseDir = ""
  }
})

describe("sticky browser matrix (module, no LLM)", () => {
  test("ON keeps browser after 已登录 turn; OFF clears", () => {
    for (const stickyOn of [true, false]) {
      __testing.reset()
      delete process.env.OPENCODE_STICKY_LOADED
      if (!stickyOn) process.env.OPENCODE_STICKY_LOADED = "0"

      const sessionID = "ses_sticky_module_gate"
      const turnA = "msg_turn_a"
      const turnB = "msg_turn_b_已登录"
      __testing.load(sessionID, turnA, [
        "wodeappx_browser_status",
        "wodeappx_browser_open_url",
        "wodeappx_browser_read_page",
      ])
      expect(exposeDynamicTools({ sessionID, turnID: turnA, tools, namespaces }).tools.wodeappx_browser_read_page).toBeTruthy()
      const afterLogin = exposeDynamicTools({ sessionID, turnID: turnB, tools, namespaces })
      expect(afterLogin.tools.write).toBeTruthy()
      if (stickyOn) {
        expect(afterLogin.tools.wodeappx_browser_read_page).toBeTruthy()
      } else {
        expect(afterLogin.tools.wodeappx_browser_read_page).toBeUndefined()
        expect(afterLogin.stats.loaded).toBe(0)
      }
    }
  })
})
`, "utf8");
  return dest;
}

async function main() {
  const requireLive = hasFlag("--require-live") || hasFlag("--require");
  const binary = findLiveSidecarBinary();
  if (!(await exists(binary))) throw new Error(`Sidecar binary missing: ${binary}`);

  const livePs = spawnSync("pgrep", ["-lf", "resources/sidecars/opencode"], { encoding: "utf8" });
  const liveRunning = Boolean((livePs.stdout || "").includes("sidecars/opencode"));
  if (requireLive && !liveRunning) {
    throw new Error("--require-live set but no desktop sidecar process matched resources/sidecars/opencode");
  }

  const markers = binaryHasSticky(binary);
  if (markers.emptyWriteThrash < 1) {
    throw new Error(`LIVE binary lacks sticky marker EMPTY_WRITE_THRASH: ${binary}`);
  }

  const sourceSha = createHash("sha256").update(await readFile(discoveryTs)).digest("hex").slice(0, 16);
  const pkgRoot = await resolveOpenCodeTestRoot();
  const synced = await syncDiscoveryInto(pkgRoot);
  const matrixTest = await writeBrowserMatrixTest(pkgRoot);

  console.log(JSON.stringify({
    phase: "module-preflight",
    binary,
    liveRunning,
    markers,
    discoverySourceSha16: sourceSha,
  }, null, 2));

  run("bun", ["test", "src/session/dynamic-tool-discovery.test.ts", path.relative(pkgRoot, matrixTest)], {
    cwd: pkgRoot,
    inherit: true,
  });
  spawnSync("rm", ["-f", matrixTest]);

  let livePrompt = null;
  if (requireLive) {
    console.log(JSON.stringify({ phase: "live-session-prompt", note: "real model; may burn credits; UI not required" }, null, 2));
    livePrompt = await runLiveSessionPromptGate();
  }

  console.log(JSON.stringify({
    ok: true,
    binary,
    liveRunning,
    markers,
    discoverySourceSha16: sourceSha,
    synced: synced.destTs,
    livePrompt,
    note: requireLive
      ? "Module matrix + LIVE real session prompt (credits OK, no fake model, UI optional)."
      : "Module matrix only. Use --require-live for real session prompt acceptance.",
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
