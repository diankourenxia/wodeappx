import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const wodeappxRoot = resolve(scriptDir, "..");
const runtimeCheck = process.argv.includes("--runtime");
const vendorRoot = join(wodeappxRoot, "vendor", "openwork");

const CORE_TOOL_IDS = [
  "wodeappx_list_capabilities",
  "agent_reach_web_search",
  "agent_reach_weather",
  "agent_reach_web_read",
  "openwork_docs_search",
  "openwork_docs_read",
  "openwork_file_search",
];
const RUNTIME_REQUIRED_TOOL_IDS = [...CORE_TOOL_IDS, "wodeappx_shopify_status"];

function fail(message) {
  process.stderr.write(`Agent capability gate failed: ${message}\n`);
  process.exit(1);
}

function run(command, args, cwd = wodeappxRoot) {
  // Windows cannot spawn .cmd/.bat via CreateProcess without a shell (EINVAL).
  const useShell = process.platform === "win32" && (
    /\.(cmd|bat)$/i.test(command) || command === "pnpm" || command === "npm" || command === "npx"
  );
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
    shell: useShell,
  });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} exited with ${result.status ?? "unknown"}`);
}

function resolveTypescriptBin(packageDir) {
  try {
    const require = createRequire(join(packageDir, "package.json"));
    return require.resolve("typescript/bin/tsc");
  } catch {
    const candidates = [
      join(packageDir, "node_modules", "typescript", "bin", "tsc"),
      join(vendorRoot, "node_modules", "typescript", "bin", "tsc"),
      join(vendorRoot, "apps", "app", "node_modules", "typescript", "bin", "tsc"),
      join(vendorRoot, "apps", "server", "node_modules", "typescript", "bin", "tsc"),
    ];
    return candidates.find((candidate) => existsSync(candidate)) || null;
  }
}

function runPackageTypecheck(packageDir) {
  const tsc = resolveTypescriptBin(packageDir);
  if (tsc) {
    // Prefer direct node+tsc so Windows CI never has to spawn pnpm.cmd.
    run(process.execPath, [tsc, "-p", "tsconfig.json", "--noEmit"], packageDir);
    return;
  }
  const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  run(pnpmCommand, ["typecheck"], packageDir);
}


function assertMaterializedRouteParity() {
  const sourcePath = join(wodeappxRoot, "integrations", "openwork", "wodeapp", "wodeapp-capability-routing.ts");
  const vendorPath = join(wodeappxRoot, "vendor", "openwork", "apps", "app", "src", "react-app", "domains", "wodeapp", "wodeapp-capability-routing.ts");
  const source = readFileSync(sourcePath, "utf8");
  const vendor = readFileSync(vendorPath, "utf8");
  if (source !== vendor) fail("capability routing source and vendor materialization differ; run pnpm openwork:patch");
  // Keep markers aligned with Flat Visibility: foundation ids + empty-route general fallback.
  for (const requiredText of [
    "ALWAYS_AVAILABLE_FOUNDATION_TOOL_IDS",
    'add("general")',
    "selected.size === 0",
  ]) {
    if (!source.includes(requiredText)) fail(`capability routing contract is missing ${requiredText}`);
  }
}

function assertInternetToolMaterialization() {
  const sourcePath = join(wodeappxRoot, "integrations", "agent-reach", "openwork-plugin-tools.ts");
  const vendorPath = join(wodeappxRoot, "vendor", "openwork", "apps", "server", "src", "opencode-plugins", "openwork-extensions-preview.ts");
  const source = readFileSync(sourcePath, "utf8");
  const vendor = readFileSync(vendorPath, "utf8");
  for (const toolId of ["agent_reach_web_search", "agent_reach_weather", "agent_reach_web_read"]) {
    if (!source.includes(`${toolId}:`)) fail(`integration source is missing ${toolId}`);
    if (!vendor.includes(`${toolId}:`)) fail(`vendor plugin is missing ${toolId}; run pnpm openwork:patch`);
  }
}

function assertShopifyToolMaterialization() {
  const sourcePath = join(wodeappxRoot, "integrations", "shopify", "opencode-plugin", "wodeappx-shopify.ts");
  const vendorPath = join(wodeappxRoot, "vendor", "openwork", "apps", "server", "src", "opencode-plugins", "wodeappx-shopify.ts");
  const previewPath = join(wodeappxRoot, "vendor", "openwork", "apps", "server", "src", "opencode-plugins", "openwork-extensions-preview.ts");
  const source = readFileSync(sourcePath, "utf8");
  const vendor = readFileSync(vendorPath, "utf8");
  const preview = readFileSync(previewPath, "utf8");
  if (!source.includes("wodeappx_shopify_status:")) fail("Shopify integration source is missing wodeappx_shopify_status");
  if (!vendor.includes("wodeappx_shopify_status:")) fail("server runtime plugin is missing wodeappx_shopify_status; run pnpm openwork:patch");
  if (vendor.includes("@opencode-ai/plugin")) fail("server Shopify plugin was not converted to the bundled runtime plugin format");
  if (!preview.includes('import WodeAppXShopify from "./wodeappx-shopify.js"')) fail("core runtime plugin does not import Shopify tools");
  if (!preview.includes("...(await WodeAppXShopify()).tool")) fail("core runtime plugin does not expose Shopify tools");
}

function discoveryCandidates() {
  if (process.env.OPENWORK_ENGINE_DISCOVERY) return [process.env.OPENWORK_ENGINE_DISCOVERY];
  if (platform() === "darwin") {
    return [
      join(homedir(), "Library", "Application Support", "com.differentai.openwork.dev", "openwork-engine.json"),
      join(homedir(), "Library", "Application Support", "com.differentai.openwork", "openwork-engine.json"),
    ];
  }
  if (platform() === "win32") {
    const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    return [
      join(appData, "com.differentai.openwork.dev", "openwork-engine.json"),
      join(appData, "com.differentai.openwork", "openwork-engine.json"),
    ];
  }
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return [
    join(configHome, "com.differentai.openwork.dev", "openwork-engine.json"),
    join(configHome, "com.differentai.openwork", "openwork-engine.json"),
  ];
}

async function assertRuntimeInventory() {
  const discoveryPath = discoveryCandidates().find((candidate) => candidate && existsSync(candidate));
  if (!discoveryPath) fail("--runtime requested but no WodeAppX engine discovery file was found");
  const discovery = JSON.parse(readFileSync(discoveryPath, "utf8"));
  if (!discovery.baseUrl) fail("engine discovery has no baseUrl");
  const headers = {};
  if (discovery.auth?.type === "basic") {
    const encoded = Buffer.from(`${discovery.auth.username}:${discovery.auth.password}`).toString("base64");
    headers.Authorization = `Basic ${encoded}`;
  } else {
    const token = discovery.auth?.token || discovery.token || discovery.accessToken;
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const url = new URL("/experimental/tool/ids", discovery.baseUrl);
  if (discovery.directory || discovery.projectDir) {
    url.searchParams.set("directory", discovery.directory || discovery.projectDir);
  }
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  const text = await response.text();
  if (!response.ok) fail(`runtime tool inventory returned HTTP ${response.status}: ${text.slice(0, 160)}`);
  const parsed = JSON.parse(text);
  const toolIds = Array.isArray(parsed) ? parsed : parsed.data || parsed.tools || [];
  const missing = RUNTIME_REQUIRED_TOOL_IDS.filter((toolId) => !toolIds.includes(toolId));
  if (missing.length) fail(`runtime is missing core tools: ${missing.join(", ")}`);
  process.stdout.write(`Runtime inventory passed: ${toolIds.length} tools, ${RUNTIME_REQUIRED_TOOL_IDS.length} required tools present.\n`);
}

assertMaterializedRouteParity();
assertInternetToolMaterialization();
assertShopifyToolMaterialization();
run("bun", ["test", "integrations/openwork/tests/wodeapp-capability-routing.test.ts"]);
run("bun", ["test", "integrations/openwork/tests/live-event-payload-slim.test.ts"]);
runPackageTypecheck(join(vendorRoot, "apps", "app"));
runPackageTypecheck(join(vendorRoot, "apps", "server"));
if (runtimeCheck) await assertRuntimeInventory();
process.stdout.write(`Agent capability gate passed${runtimeCheck ? " with runtime inventory" : ""}.\n`);
