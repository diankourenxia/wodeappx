import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { platform } from "node:os";
import { fileURLToPath } from "node:url";

export type ComputerUseBackendId = "handsfree" | "open-computer-use";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type DirectState = {
  child: ChildProcessWithoutNullStreams;
  buffer: string;
  pending: Map<string, Pending>;
  nextId: number;
  stderr: string[];
  kind: "handsfree-direct" | "ocu-mcp";
  initialized?: boolean;
  lastApp?: string;
};

let directState: DirectState | null = null;

const OCU_UNSUPPORTED = new Set([
  "launch_app",
  "activate_app",
  "open_url",
  "clipboard_read",
  "clipboard_write",
  "set_strict_mode",
  "wait",
  "display_info",
  "cua_screenshot",
  "cua_click",
  "cua_double_click",
  "cua_move",
  "cua_type",
  "cua_keypress",
  "cua_scroll",
  "cua_drag",
  "cua_wait",
]);

function openworkRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function getStringProperty(value: unknown, key: string): string | null {
  const record = asRecord(value);
  const raw = record[key];
  return typeof raw === "string" && raw.trim() ? raw : null;
}

export function resolveComputerUseBackend(): ComputerUseBackendId {
  const forced = process.env.WODEAPPX_COMPUTER_USE_BACKEND?.trim().toLowerCase();
  if (forced === "handsfree" || forced === "open-computer-use") return forced;
  if (platform() === "darwin") return "handsfree";
  return "open-computer-use";
}

export function computerUseBackendLabel(backend: ComputerUseBackendId = resolveComputerUseBackend()): string {
  return backend === "handsfree" ? "OpenWork HandsFree (macOS)" : "open-computer-use (Win/Linux)";
}

function handsfreeDirectCommand(): { command: string; args: string[] } {
  const explicitBinary = process.env.OPENWORK_COMPUTER_USE_BINARY?.trim();
  if (explicitBinary && existsSync(explicitBinary)) return { command: explicitBinary, args: ["direct"] };

  const swiftPackagePath = join(openworkRepoRoot(), "packages", "handsfree", "native", "HandsFree");
  const localBinary = [
    join(swiftPackagePath, ".build", "debug", "HandsFreeComputerUse"),
    join(swiftPackagePath, ".build", "arm64-apple-macosx", "debug", "HandsFreeComputerUse"),
    join(swiftPackagePath, ".build", "release", "HandsFreeComputerUse"),
    join(swiftPackagePath, ".build", "arm64-apple-macosx", "release", "HandsFreeComputerUse"),
  ].find((candidate) => existsSync(candidate));
  if (localBinary) return { command: localBinary, args: ["direct"] };

  const localWrapper = join(openworkRepoRoot(), "packages", "handsfree", "bin", "openwork-handsfree-computer-use.mjs");
  if (existsSync(localWrapper)) return { command: "node", args: [localWrapper, "direct"] };

  return { command: "npx", args: ["-y", "@openwork/handsfree", "direct"] };
}

function ocuCommand(): { command: string; args: string[] } {
  const explicitBinary = process.env.WODEAPPX_OPEN_COMPUTER_USE_BINARY?.trim()
    || process.env.OPENWORK_COMPUTER_USE_BINARY?.trim();
  if (explicitBinary && existsSync(explicitBinary)) {
    return { command: explicitBinary, args: ["mcp"] };
  }

  const resourcesHelpers = process.env.WODEAPPX_COMPUTER_USE_HELPERS_DIR?.trim();
  if (resourcesHelpers) {
    const win = join(resourcesHelpers, "open-computer-use.exe");
    const unix = join(resourcesHelpers, "open-computer-use");
    if (platform() === "win32" && existsSync(win)) return { command: win, args: ["mcp"] };
    if (existsSync(unix)) return { command: unix, args: ["mcp"] };
  }

  return { command: "npx", args: ["-y", "open-computer-use", "mcp"] };
}

function rejectPending(state: DirectState, error: Error): void {
  for (const pending of state.pending.values()) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  state.pending.clear();
}

function handleLine(state: DirectState, line: string): void {
  if (!line.trim()) return;
  let payload: unknown;
  try {
    payload = JSON.parse(line);
  } catch {
    state.stderr.push(`Invalid JSON from Computer Use helper: ${line.slice(0, 400)}`);
    state.stderr = state.stderr.slice(-20);
    return;
  }

  if (state.kind === "ocu-mcp") {
    const id = asRecord(payload).id;
    if (id === undefined || id === null) return;
    const pending = state.pending.get(String(id));
    if (!pending) return;
    state.pending.delete(String(id));
    clearTimeout(pending.timer);
    const error = asRecord(asRecord(payload).error);
    if (Object.keys(error).length > 0) {
      pending.reject(new Error(getStringProperty(error, "message") || `MCP error for request ${id}`));
      return;
    }
    pending.resolve(asRecord(payload).result);
    return;
  }

  const id = getStringProperty(payload, "id");
  if (!id) return;
  const pending = state.pending.get(id);
  if (!pending) return;
  state.pending.delete(id);
  clearTimeout(pending.timer);
  pending.resolve(payload);
}

function spawnHelper(kind: DirectState["kind"], command: string, args: string[]): DirectState {
  const child = spawn(command, args, {
    stdio: "pipe",
    env: {
      ...process.env,
      OPENWORK_COMPUTER_USE_CURSOR_OVERLAY: process.env.OPENWORK_COMPUTER_USE_CURSOR_OVERLAY ?? "1",
    },
    shell: platform() === "win32" && command === "npx",
  });
  const state: DirectState = {
    child,
    buffer: "",
    pending: new Map(),
    nextId: 1,
    stderr: [],
    kind,
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    state.buffer += chunk;
    for (;;) {
      const index = state.buffer.indexOf("\n");
      if (index < 0) break;
      const line = state.buffer.slice(0, index).trim();
      state.buffer = state.buffer.slice(index + 1);
      handleLine(state, line);
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    for (const line of chunk.split(/\r?\n/)) {
      if (line.trim()) state.stderr.push(line.trim());
    }
    state.stderr = state.stderr.slice(-20);
  });

  child.on("error", (error) => {
    rejectPending(state, error instanceof Error ? error : new Error(String(error)));
    if (directState === state) directState = null;
  });
  child.on("exit", (code, signal) => {
    const details = state.stderr.length ? `\n${state.stderr.join("\n")}` : "";
    rejectPending(state, new Error(`Computer Use helper exited (${signal ?? code ?? "unknown"}).${details}`));
    if (directState === state) directState = null;
  });

  return state;
}

function ensureHandsfreeState(): DirectState {
  if (directState && !directState.child.killed && directState.kind === "handsfree-direct") {
    return directState;
  }
  if (platform() !== "darwin") {
    throw new Error("HandsFree Computer Use is only available on macOS.");
  }
  const { command, args } = handsfreeDirectCommand();
  directState = spawnHelper("handsfree-direct", command, args);
  return directState;
}

async function mcpRequest(state: DirectState, method: string, params?: Record<string, unknown>, options: { timeoutMs?: number } = {}): Promise<unknown> {
  const id = state.nextId++;
  const timeoutMs = options.timeoutMs ?? 90_000;
  const request = JSON.stringify({
    jsonrpc: "2.0",
    id,
    method,
    ...(params ? { params } : {}),
  }) + "\n";

  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      state.pending.delete(String(id));
      rejectPromise(new Error(`Computer Use MCP timed out calling ${method}.`));
    }, timeoutMs);
    state.pending.set(String(id), { resolve: resolvePromise, reject: rejectPromise, timer });
    state.child.stdin.write(request, (error) => {
      if (!error) return;
      state.pending.delete(String(id));
      clearTimeout(timer);
      rejectPromise(error);
    });
  });
}

async function ensureOcuState(): Promise<DirectState> {
  if (directState && !directState.child.killed && directState.kind === "ocu-mcp" && directState.initialized) {
    return directState;
  }
  if (directState && !directState.child.killed) {
    try {
      directState.child.kill();
    } catch {
      // ignore
    }
    directState = null;
  }

  const { command, args } = ocuCommand();
  const state = spawnHelper("ocu-mcp", command, args);
  directState = state;

  await mcpRequest(state, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "wodeappx-computer-use", version: "0.1.0" },
  }, { timeoutMs: 30_000 });

  state.child.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  }) + "\n");
  state.initialized = true;
  return state;
}

function normalizeElementIndex(args: Record<string, unknown>): string | undefined {
  const explicit = args.element_index ?? args.elementIndex;
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  if (typeof explicit === "number" && Number.isFinite(explicit)) return String(explicit);

  if (typeof args.index === "number" && Number.isFinite(args.index)) return String(args.index);
  if (typeof args.ref === "string" && args.ref.trim()) {
    const ref = args.ref.trim();
    const braced = ref.match(/^\{e(\d+)\}$/i);
    if (braced) return braced[1];
    const plain = ref.match(/^e(\d+)$/i);
    if (plain) return plain[1];
    return ref;
  }
  return undefined;
}

function mapPressKey(args: Record<string, unknown>): string {
  const raw = String(args.key ?? args.combo ?? "").trim();
  return raw
    .replace(/\bcommand\b/gi, "super")
    .replace(/\bcmd\b/gi, "super")
    .replace(/\boption\b/gi, "alt")
    .replace(/\breturn\b/gi, "Return")
    .replace(/\benter\b/gi, "Return")
    .replace(/\bescape\b/gi, "Escape")
    .replace(/\besc\b/gi, "Escape");
}

function mapHandsfreeToOcu(
  tool: string,
  args: Record<string, unknown>,
  lastApp?: string,
): { tool: string; args: Record<string, unknown> } {
  if (tool === "check_permissions") {
    return { tool: "list_apps", args: {} };
  }

  if (tool === "snapshot" || tool === "get_app_state") {
    const app = String(args.app ?? lastApp ?? "").trim();
    if (!app) {
      throw new Error("open-computer-use requires args.app for snapshot/get_app_state. Call openwork_computer_list_apps first, then pass the target app name.");
    }
    const mapped: Record<string, unknown> = { app };
    if (args.text_limit !== undefined) mapped.text_limit = args.text_limit;
    if (args.max_tree_nodes !== undefined) mapped.max_tree_nodes = args.max_tree_nodes;
    if (args.max_tree_depth !== undefined) mapped.max_tree_depth = args.max_tree_depth;
    return { tool: "get_app_state", args: mapped };
  }

  if (OCU_UNSUPPORTED.has(tool)) {
    throw new Error(`${tool} is not available on the open-computer-use Win/Linux backend yet. Use snapshot/click/type_text/press_key/scroll/set_value/list_apps, or run on macOS HandsFree.`);
  }

  const app = String(args.app ?? lastApp ?? "").trim();
  if (!app && tool !== "list_apps") {
    throw new Error(`open-computer-use ${tool} requires args.app (or a prior snapshot that recorded the target app).`);
  }

  if (tool === "perform_action") {
    const elementIndex = normalizeElementIndex(args);
    if (!elementIndex) throw new Error("perform_action requires ref, index, or element_index.");
    return {
      tool: "perform_secondary_action",
      args: {
        app,
        element_index: elementIndex,
        action: String(args.action ?? "AXPress"),
      },
    };
  }

  if (tool === "press_key") {
    return {
      tool: "press_key",
      args: { app, key: mapPressKey(args) },
    };
  }

  if (tool === "type_text") {
    return {
      tool: "type_text",
      args: { app, text: String(args.text ?? "") },
    };
  }

  if (tool === "set_value") {
    const elementIndex = normalizeElementIndex(args);
    if (!elementIndex) throw new Error("set_value requires ref, index, or element_index.");
    return {
      tool: "set_value",
      args: {
        app,
        element_index: elementIndex,
        value: String(args.value ?? ""),
      },
    };
  }

  if (tool === "click") {
    const mapped: Record<string, unknown> = { app };
    const elementIndex = normalizeElementIndex(args);
    if (elementIndex) mapped.element_index = elementIndex;
    if (typeof args.x === "number") mapped.x = args.x;
    if (typeof args.y === "number") mapped.y = args.y;
    if (typeof args.click_count === "number") mapped.click_count = args.click_count;
    return { tool: "click", args: mapped };
  }

  if (tool === "scroll") {
    const mapped: Record<string, unknown> = { app };
    const elementIndex = normalizeElementIndex(args);
    if (elementIndex) mapped.element_index = elementIndex;
    if (typeof args.direction === "string") mapped.direction = args.direction;
    else if (typeof args.delta_y === "number") mapped.direction = args.delta_y < 0 ? "up" : "down";
    else mapped.direction = "down";
    if (typeof args.pages === "number") mapped.pages = args.pages;
    else mapped.pages = 1;
    return { tool: "scroll", args: mapped };
  }

  if (tool === "drag") {
    return { tool: "drag", args: { app, ...args } };
  }

  if (tool === "list_apps") {
    return { tool: "list_apps", args: {} };
  }

  return { tool, args: app ? { ...args, app } : args };
}

async function handsfreeRequest(tool: string, args: Record<string, unknown>, options: { timeoutMs?: number } = {}): Promise<unknown> {
  const state = ensureHandsfreeState();
  const id = String(state.nextId++);
  const timeoutMs = options.timeoutMs ?? 90_000;
  const request = JSON.stringify({ id, tool, args }) + "\n";
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      state.pending.delete(id);
      rejectPromise(new Error(`Computer Use direct helper timed out calling ${tool}.`));
    }, timeoutMs);
    state.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer });
    state.child.stdin.write(request, (error) => {
      if (!error) return;
      state.pending.delete(id);
      clearTimeout(timer);
      rejectPromise(error);
    });
  });
}

async function ocuRequest(tool: string, args: Record<string, unknown>, options: { timeoutMs?: number } = {}): Promise<unknown> {
  const state = await ensureOcuState();
  if (tool === "check_permissions") {
    try {
      await mcpRequest(state, "tools/call", { name: "list_apps", arguments: {} }, { timeoutMs: options.timeoutMs ?? 15_000 });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            ok: true,
            accessibility: true,
            screenRecording: true,
            backend: "open-computer-use",
            note: "Win/Linux Computer Use uses the logged-in desktop session (UI Automation / AT-SPI). Run `open-computer-use doctor` if actions fail.",
          }),
        }],
        tool: "check_permissions",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            ok: false,
            accessibility: false,
            screenRecording: false,
            backend: "open-computer-use",
            error: message,
          }),
        }],
        tool: "check_permissions",
        isError: true,
      };
    }
  }

  const mapped = mapHandsfreeToOcu(tool, args, state.lastApp);
  if (typeof mapped.args.app === "string" && mapped.args.app.trim()) {
    state.lastApp = mapped.args.app.trim();
  }

  const result = await mcpRequest(state, "tools/call", {
    name: mapped.tool,
    arguments: mapped.args,
  }, { timeoutMs: options.timeoutMs });

  return {
    ...(asRecord(result)),
    tool: mapped.tool,
  };
}

export async function computerUseBackendRequest(
  tool: string,
  args: Record<string, unknown> = {},
  options: { timeoutMs?: number } = {},
): Promise<unknown> {
  const backend = resolveComputerUseBackend();
  if (backend === "handsfree") {
    return handsfreeRequest(tool, args, options);
  }
  return ocuRequest(tool, args, options);
}

export function computerUseBackendFailureHint(): string {
  const backend = resolveComputerUseBackend();
  if (backend === "handsfree") {
    return "Computer Use direct mode needs the macOS HandsFree helper. Check permissions with openwork_computer_check_permissions, or fall back to the Computer Use extension if needed.";
  }
  return "Computer Use needs the open-computer-use helper on Windows/Linux. Install `open-computer-use`, ensure a logged-in desktop session, set WODEAPPX_OPEN_COMPUTER_USE_BINARY if bundled, then retry openwork_computer_check_permissions.";
}

/** @internal test helpers */
export const __testing = {
  mapHandsfreeToOcu,
  normalizeElementIndex,
  mapPressKey,
  OCU_UNSUPPORTED,
};
