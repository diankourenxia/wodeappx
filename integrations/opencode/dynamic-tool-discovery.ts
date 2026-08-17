import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { isAbsolute } from "node:path"

import { asSchema, jsonSchema, tool as aiTool, type Tool } from "ai"

import { rewriteBashToolArgs } from "./bash-background-detach"
import {
  clearStickyLeaseToolIDs,
  readStickyLeaseToolIDs,
  writeStickyLeaseToolIDs,
} from "./session-sticky-leases"
import {
  bareNamesForPreloadPacks,
  detectCapabilityPreloadPacks,
  extractLatestUserTask,
  extractLatestUserText,
  resolvePreloadCatalogIDs,
} from "./wodeapp-capability-preload"

export { extractLatestUserTask, extractLatestUserText } from "./wodeapp-capability-preload"

export const TOOL_SEARCH_ID = "tool_search"
export const TOOL_SEARCH_DEFAULT_LIMIT = 8
/**
 * Fail-closed floor for deferred BM25 loads. `score > 0` previously sticky-loaded
 * Feishu docx/import for queries like `write file … 写文件` (token overlap on
 * create+file only). Exact-ID / strong description hits stay well above this.
 */
export const TOOL_SEARCH_MIN_SCORE = 3
export const WYNNE_RUNTIME_PROFILE_ID = "wynne-brand-agent"
export const TOOL_NAMESPACE_CONTEXT_MAX_BYTES = 4 * 1024
export const TOOL_NAMESPACE_DESCRIPTION_MAX_CHARS = 250
const MCP_SELECTED_INSTRUCTIONS_MAX_BYTES = 12 * 1024
const MAX_SESSION_STATES = 256
/** Same-turn repeated empty writes to the same path before hard reject. */
export const EMPTY_WRITE_THRASH_DEFAULT_LIMIT = 3

const TOOL_SEARCH_PROFILES: Readonly<Record<string, readonly string[]>> = {
  [WYNNE_RUNTIME_PROFILE_ID]: [
    "wodeappx_shopify",
    "shopify",
    "feishu",
    "lark",
    "knowledge_search",
    "knowledge",
  ],
}

export enum ToolExposure {
  Direct = "direct",
  Deferred = "deferred",
  Hidden = "hidden",
}

export type McpToolNamespace = {
  name: string
  instructions: string
  tools: string[]
}

type SearchDocument = {
  id: string
  description: string
  schema: unknown
  tokens: string[]
  termFrequency: Map<string, number>
  source: "mcp" | "local"
  namespace?: string
}

type LoadedLease = {
  toolID: string
  loadedAt: number
  lastUsedAt: number
}

type SuccessfulWriteRecord = {
  fingerprint: string
  toolID: string
  taskEpoch: string
  projectId: string
  pageId?: string
  revisionHint: string
  previousCallId?: string
}

type SessionToolState = {
  turnID: string
  /**
   * Deferred tools kept callable for the rest of this session (Codex/Cursor-style:
   * load once, keep until catalog drop / sticky off / new session). Leases are also
   * persisted per sessionID so a sidecar restart rehydrates the same surface.
   * No idle TTL and no max-count eviction — tool schemas are a small dedicated surface.
   */
  leases: Map<string, LoadedLease>
  /** Same-turn empty write thrash counters keyed by normalized file path. */
  emptyWriteHits: Map<string, number>
  /** Successful writes are deduplicated only inside the latest real user task. */
  writeLedgerEpoch: string
  successfulWrites: Map<string, SuccessfulWriteRecord>
  inFlightWrites: Map<string, Promise<unknown>>
  /** Conservative local revision hints; invalidated by intervening project/page tools. */
  projectRevisionHints: Map<string, string>
  visibleToolIDs?: Set<string>
  toolsetHash?: string
  touchedAt: number
}

type Catalog = {
  documents: SearchDocument[]
  averageLength: number
  documentFrequency: Map<string, number>
  schemaBytes: number
}

export type DynamicToolExposureResult = {
  tools: Record<string, Tool>
  visibleToolIDs: Set<string>
  stats: {
    total: number
    direct: number
    deferred: number
    hidden: number
    loaded: number
    visible_tools: number
    toolset_hash: string
    previous_toolset_hash?: string
    visible_schema_bytes: number
    toolset_changed: boolean
    toolset_added: number
    toolset_removed: number
  }
}

const DEFAULT_DIRECT_TOOL_IDS = new Set([
  "apply_patch",
  "bash",
  "edit",
  "glob",
  "grep",
  "list",
  "ls",
  "patch",
  "question",
  "read",
  "skill",
  "task",
  "todoread",
  "todowrite",
  "web_fetch",
  "web_search",
  "webfetch",
  "websearch",
  "write",
])

const PROFILE_DIRECT_TOOL_IDS: Readonly<Record<string, ReadonlySet<string>>> = {
  [WYNNE_RUNTIME_PROFILE_ID]: new Set(),
}

/**
 * Model-facing summaries for the resident OpenCode tools. Upstream descriptions
 * duplicate several kilobytes of general agent policy (git workflow, planning,
 * delegation, file-tool preference) on every request. The host still validates
 * the original schema and runs the original execute function; only the
 * selection hint sent to the model is shortened here.
 */
const COMPACT_DIRECT_TOOL_DESCRIPTIONS: Readonly<Record<string, string>> = {
  bash: "Run terminal commands in persistent Bash for git, builds, tests, packages, and processes. Use workdir instead of cd, quote paths with spaces, and prefer dedicated read/glob/grep/edit/write tools for file operations. Background launches (nohup / trailing & / disown) are detached so the tool returns without waiting out the full timeout; pure background prints BG_PID. Large output may be spilled to a returned path. Avoid destructive commands unless clearly requested.",
  edit: "Replace an exact string in an existing file. Read the file first. oldString must match exactly and uniquely; include more surrounding context when needed, or use replaceAll only when every occurrence should change.",
  glob: "Find workspace files in a known directory by glob pattern, for example **/*.ts or src/**/test*. Returns matching paths; use grep for file contents. This is not an OS-wide filename or Spotlight search; use tool_search to load a dedicated local-file search tool for that.",
  grep: "Search file contents with a regular expression and optional include pattern. Returns matching paths and line numbers; use glob when searching only by filename.",
  question: "Ask the user concise questions when a required preference, decision, or missing requirement blocks safe progress. Put the recommended choice first and allow a custom answer.",
  read: "Read a file or directory by absolute path. Use offset and limit for later or bounded sections, and grep first for targeted text in large files. Directory reads return entries.",
  skill: "Load a named specialized skill when the task matches one listed in the system prompt. The skill name must match an available skill.",
  task: "Launch a subagent for an independent complex, multistep task. Use read/glob/grep for simple lookup, give the subagent detailed scope and verification, and do not duplicate delegated work. Reuse task_id to continue the same subagent.",
  todowrite: "Create or update a structured task list for nontrivial work with three or more meaningful steps. Keep exactly one item in_progress, update statuses as work changes, and mark completed only after verification.",
  webfetch: "Fetch a fully formed public URL and return markdown, text, or HTML. This is read-only; prefer a more specialized web tool when one is available.",
  write: "Create or overwrite a file. Read an existing file first and prefer edit for scoped changes. Create new files only when required, and do not proactively create documentation unless requested.",
}

const DEFAULT_HIDDEN_TOOL_IDS = new Set([
  "_noop",
  "invalid",
  "wodeappx_search_tools",
])

const QUERY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  飞书: ["feishu", "lark"],
  文档: ["doc", "docs", "document"],
  表格: ["sheet", "spreadsheet", "table"],
  数据库: ["database", "db", "sql"],
  邮件: ["mail", "email", "gmail", "outlook"],
  日历: ["calendar", "schedule"],
  消息: ["message", "messages", "chat"],
  搜索: ["search", "find", "query"],
  查询: ["query", "search", "list"],
  创建: ["create", "add", "new"],
  修改: ["update", "edit", "change"],
  删除: ["delete", "remove"],
  文件: ["file", "files", "drive", "storage"],
}

/**
 * Query hints that mean "the Direct tool already covers this" — used only to
 * detect mis-invocations of tool_search (not to rank MCP substitutes).
 *
 * Contract (ses_0248febaa*): if the query is already satisfied by Direct tools,
 * tool_search MUST NOT sticky-load deferred MCP substitutes. Loading Feishu
 * docx/import for `write file` was not a ranking miss — it violated discovery
 * scope (Direct vs Deferred).
 */
const DIRECT_TOOL_QUERY_HINTS: Readonly<Record<string, readonly string[]>> = {
  write: ["write", "写文件", "写入文件", "新建文件", "保存文件", "create file", "save file", "html file", "写个文件", "生成html", "创建html"],
  bash: ["bash", "terminal", "shell", "命令行", "终端"],
  edit: ["edit", "strreplace", "改文件", "修改文件", "编辑文件"],
  read: ["read file", "读取文件", "读文件", "cat "],
  glob: ["glob", "找文件", "按文件名"],
  grep: ["grep", "搜代码", "rg "],
}

const sessionStates = new Map<string, SessionToolState>()

export function dynamicToolDiscoveryEnabled() {
  const value = process.env.OPENCODE_DYNAMIC_TOOL_DISCOVERY?.trim().toLowerCase()
  return value !== "0" && value !== "false" && value !== "off"
}

/** Sticky leases across user turns; durable per sessionID across sidecar restarts. */
export function stickyLoadedEnabled() {
  const value = process.env.OPENCODE_STICKY_LOADED?.trim().toLowerCase()
  return value !== "0" && value !== "false" && value !== "off"
}

function emptyWriteThrashLimit() {
  const raw = Number(process.env.OPENCODE_EMPTY_WRITE_THRASH_LIMIT?.trim() || EMPTY_WRITE_THRASH_DEFAULT_LIMIT)
  if (!Number.isFinite(raw) || raw < 1) return EMPTY_WRITE_THRASH_DEFAULT_LIMIT
  return Math.floor(raw)
}

function configuredIDs(name: string) {
  return new Set(
    (process.env[name] ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  )
}

export function isLeanRuntimeProfile(profile: string | undefined) {
  return profile === WYNNE_RUNTIME_PROFILE_ID
}

/** Keep in sync with wodeapp-capability-routing `isSmallTalkOnly`. */
const SMALL_TALK_ONLY =
  /^(?:你好|您好|嗨|哈喽|在吗|早上好|下午好|晚上好|早安|晚安|谢谢|感谢|再见|好的|好|收到|行|可以|你是谁|介绍一下自己|hello|hi|hey|thanks|thank you|bye|ok|okay)[!！?？。,.，\s]*$/i

export function isSmallTalkUserText(text: string | undefined) {
  const trimmed = text?.trim() ?? ""
  return trimmed.length > 0 && SMALL_TALK_ONLY.test(trimmed)
}

type UserTurnLike = {
  info?: { role?: string }
  parts?: readonly { type?: string; text?: string; synthetic?: boolean }[]
}

/** True when every real user turn is small talk. Follow-up coding keeps AGENTS.md. */
export function isSmallTalkSession(messages: readonly UserTurnLike[] | undefined) {
  if (!messages?.length) return false
  const texts: string[] = []
  for (const message of messages) {
    if (message?.info?.role !== "user") continue
    const chunks = (message.parts ?? [])
      .filter((part) => part?.type === "text" && part.synthetic !== true && typeof part.text === "string")
      .map((part) => part.text!.trim())
      .filter(Boolean)
    if (chunks.length) texts.push(chunks.join("\n"))
  }
  return texts.length > 0 && texts.every((text) => isSmallTalkUserText(text))
}

const SELF_EVOLVE_WORKSPACE_NAME_MARKERS = ["自进化", "self-evolve", "self evolve"] as const

/** Keep in sync with wodeapp-self-evolve-awareness.ts */
export const WORKSPACE_IDENTITY_SELF_EVOLVE =
  "Identity override (this workspace): You are WodeAppX. In user-visible answers use WodeAppX (codename wodeappx). Self-evolution (本工作区): You CAN change this desktop app's own source (skins, copy, features, scripts) after the user confirms. Prefer slash `/自进化` (English `/evolve`) or skill `wodeappx-self-evolution`. Required flow: restate the plan → wait for explicit consent → `node wodeappx/scripts/self-evolve-guard.mjs snapshot --label \"…\"` → minimal edit → `verify` → on failure `rollback <snapshotId>` → after user accepts, `version commit`. Never claim you cannot self-evolve in this workspace. Do not confuse product self-evolve with unsupervised model-weight mutation or silent privilege escalation; consequential external actions still need confirmation."

export const WORKSPACE_IDENTITY_SELF_EVOLVE_OFF =
  "Self-evolution: Product self-evolve means editing this desktop app under confirmation (skill `wodeappx-self-evolution`, slash `/自进化` / `/evolve`, guard snapshot→verify→rollback). Switch to sidebar project `wodeapp（自进化）` or run `/自进化` there. Do not refuse as if the product cannot self-evolve."

function normalizeWorkspaceKey(value: string | null | undefined) {
  return String(value ?? "").trim().replace(/\\/g, "/").toLowerCase()
}

export function isSelfEvolveWorkspaceDirectory(directory: string | null | undefined) {
  const key = normalizeWorkspaceKey(directory)
  if (!key) return false
  if (key.includes("self-evolve-source")) return true
  if (/(^|\/)wodeapp\/?$/.test(key)) return true
  if (key.endsWith("/wodeappx") || key.includes("/wodeapp/wodeappx")) return true
  return false
}

export function isSelfEvolveWorkspaceName(name: string | null | undefined) {
  const key = normalizeWorkspaceKey(name)
  if (!key) return false
  return SELF_EVOLVE_WORKSPACE_NAME_MARKERS.some((marker) => key.includes(marker))
}

export function resolveWorkspaceIdentitySystem(input: {
  directory?: string | null
  workspaceName?: string | null
  userText?: string | null
}) {
  if (isSelfEvolveWorkspaceName(input.workspaceName) || isSelfEvolveWorkspaceDirectory(input.directory)) {
    return WORKSPACE_IDENTITY_SELF_EVOLVE
  }
  const text = String(input.userText ?? "").trim()
  if (/自进化|self[-\s]?evolv|\/evolve|\/自进化|改你自己|改本应用|改桌面端源码/i.test(text)) {
    return WORKSPACE_IDENTITY_SELF_EVOLVE_OFF
  }
  return undefined
}

function exposureFor(toolID: string, profile?: string) {
  const hidden = configuredIDs("OPENCODE_DYNAMIC_TOOL_HIDDEN")
  if (DEFAULT_HIDDEN_TOOL_IDS.has(toolID) || hidden.has(toolID)) return ToolExposure.Hidden

  const direct = configuredIDs("OPENCODE_DYNAMIC_TOOL_DIRECT")
  const resident = profile && PROFILE_DIRECT_TOOL_IDS[profile]
    ? PROFILE_DIRECT_TOOL_IDS[profile]
    : DEFAULT_DIRECT_TOOL_IDS
  if (resident.has(toolID) || direct.has(toolID)) return ToolExposure.Direct
  return ToolExposure.Deferred
}

function compactDirectToolDescriptionsEnabled() {
  const value = process.env.OPENCODE_COMPACT_DIRECT_TOOL_DESCRIPTIONS?.trim().toLowerCase()
  return value !== "0" && value !== "false" && value !== "off"
}

function directToolDefinition(toolID: string, definition: Tool): Tool {
  if (!compactDirectToolDescriptionsEnabled()) return definition
  const description = COMPACT_DIRECT_TOOL_DESCRIPTIONS[toolID]
  return description ? { ...definition, description } : definition
}

function createSessionState(turnID: string): SessionToolState {
  return {
    turnID,
    leases: new Map(),
    emptyWriteHits: new Map(),
    writeLedgerEpoch: "",
    successfulWrites: new Map(),
    inFlightWrites: new Map(),
    projectRevisionHints: new Map(),
    touchedAt: Date.now(),
  }
}

function persistLeases(
  sessionID: string,
  state: SessionToolState,
  options?: { allowClearEmpty?: boolean },
) {
  if (!stickyLoadedEnabled()) return
  // Empty memory without an intentional clear must not clobber durable leases
  // (cold-start race / restore-from-disk before rehydrate).
  if (state.leases.size === 0) {
    if (options?.allowClearEmpty) clearStickyLeaseToolIDs(sessionID)
    return
  }
  writeStickyLeaseToolIDs(sessionID, state.leases.keys())
}

function rehydrateLeases(sessionID: string, state: SessionToolState) {
  if (!stickyLoadedEnabled()) return
  const toolIDs = readStickyLeaseToolIDs(sessionID)
  if (!toolIDs.length) return
  const now = Date.now()
  for (const toolID of toolIDs) {
    if (state.leases.has(toolID)) continue
    state.leases.set(toolID, {
      toolID,
      loadedAt: now,
      lastUsedAt: now,
    })
  }
}

function stateFor(sessionID: string, turnID: string) {
  const current = sessionStates.get(sessionID)
  if (current?.turnID === turnID) {
    current.touchedAt = Date.now()
    return current
  }

  if (current && stickyLoadedEnabled()) {
    // Same in-memory session, new user turn: keep leases, reset thrash counters.
    current.turnID = turnID
    current.touchedAt = Date.now()
    current.emptyWriteHits = new Map()
    // Empty in-memory leases still rehydrate from disk (e.g. operator restored
    // the lease file, or an earlier cold-start race cleared memory but not disk).
    if (current.leases.size === 0) {
      rehydrateLeases(sessionID, current)
    }
    return current
  }

  if (sessionStates.size >= MAX_SESSION_STATES) {
    const oldest = [...sessionStates.entries()].sort((left, right) => left[1].touchedAt - right[1].touchedAt)[0]
    if (oldest) sessionStates.delete(oldest[0])
  }

  const next = createSessionState(turnID)
  rehydrateLeases(sessionID, next)
  sessionStates.set(sessionID, next)
  return next
}

function pruneLeases(
  state: SessionToolState,
  availableToolIDs: ReadonlySet<string> | null,
) {
  if (!availableToolIDs) return
  for (const toolID of [...state.leases.keys()]) {
    if (!availableToolIDs.has(toolID)) {
      state.leases.delete(toolID)
    }
  }
}

/**
 * Sidecar cold start often exposes a coding-only toolset (direct tools only,
 * deferred=0) before MCP / plugins finish registering. Pruning sticky leases
 * against that incomplete snapshot permanently wipes the durable lease file
 * (observed: ses_025ec834 restart → total=12 deferred=0 → loaded=0 forever).
 * Skip durable prune/persist until at least one deferred tool is present.
 */
function catalogReadyForStickyPrune(
  tools: Record<string, Tool>,
  profile?: string,
): boolean {
  for (const toolID of Object.keys(tools)) {
    if (exposureFor(toolID, profile) === ToolExposure.Deferred) return true
  }
  return false
}

function addLoadedLeases(
  sessionID: string,
  state: SessionToolState,
  toolIDs: string[],
  now = Date.now(),
) {
  for (const toolID of toolIDs) {
    const existing = state.leases.get(toolID)
    state.leases.set(toolID, {
      toolID,
      loadedAt: existing?.loadedAt ?? now,
      lastUsedAt: now,
    })
  }
  persistLeases(sessionID, state)
}

/**
 * Session.fork copies messages but not sticky leases. Inherit parent durable +
 * in-memory leases so deferred tools already loaded stay callable after fork.
 */
export function inheritStickyLeasesOnFork(parentSessionID: string, childSessionID: string): string[] {
  if (!stickyLoadedEnabled()) return []
  const parent = parentSessionID.trim()
  const child = childSessionID.trim()
  if (!parent || !child || parent === child) return []

  const fromMemory = sessionStates.get(parent)
    ? [...sessionStates.get(parent)!.leases.keys()]
    : []
  const fromDisk = readStickyLeaseToolIDs(parent)
  const toolIDs = [...new Set([...fromMemory, ...fromDisk].map((id) => id.trim()).filter(Boolean))]
  if (!toolIDs.length) return []

  writeStickyLeaseToolIDs(child, toolIDs)

  const childState = sessionStates.get(child)
  if (childState) {
    addLoadedLeases(child, childState, toolIDs)
  }
  return toolIDs
}

function renewLease(state: SessionToolState, toolID: string, now = Date.now()) {
  const lease = state.leases.get(toolID)
  if (!lease) return
  lease.lastUsedAt = now
}

function isLeaseActive(state: SessionToolState, toolID: string) {
  return state.leases.has(toolID)
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return Object.fromEntries(Object.entries(value))
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  const item = record(value)
  if (!item) return value
  return Object.fromEntries(
    Object.keys(item)
      .sort()
      .map((key) => [key, stableValue(item[key])]),
  )
}

function measurableSchema(definition: Tool) {
  const inputSchema = record(definition.inputSchema)
  return inputSchema?.jsonSchema ?? definition.inputSchema
}

function measureVisibleToolset(state: SessionToolState, tools: Record<string, Tool>) {
  const visibleToolIDs = new Set(Object.keys(tools))
  const serialized = JSON.stringify(
    Object.keys(tools)
      .sort()
      .map((id) => ({
        id,
        description: tools[id]?.description ?? "",
        inputSchema: stableValue(measurableSchema(tools[id])),
      })),
  )
  const toolsetHash = createHash("sha256").update(serialized).digest("hex").slice(0, 16)
  const previousVisibleToolIDs = state.visibleToolIDs
  const previousToolsetHash = state.toolsetHash
  const toolsetAdded = previousVisibleToolIDs
    ? [...visibleToolIDs].filter((id) => !previousVisibleToolIDs.has(id)).length
    : 0
  const toolsetRemoved = previousVisibleToolIDs
    ? [...previousVisibleToolIDs].filter((id) => !visibleToolIDs.has(id)).length
    : 0

  state.visibleToolIDs = visibleToolIDs
  state.toolsetHash = toolsetHash

  return {
    visibleToolIDs,
    visible_tools: visibleToolIDs.size,
    toolset_hash: toolsetHash,
    ...(previousToolsetHash ? { previous_toolset_hash: previousToolsetHash } : {}),
    visible_schema_bytes: Buffer.byteLength(serialized),
    toolset_changed: previousToolsetHash !== undefined && previousToolsetHash !== toolsetHash,
    toolset_added: toolsetAdded,
    toolset_removed: toolsetRemoved,
  }
}

function schemaText(value: unknown, depth = 0): string[] {
  if (depth > 8) return []
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap((item) => schemaText(item, depth + 1))
  const item = record(value)
  if (!item) return []

  return Object.entries(item).flatMap(([key, nested]) => {
    if (key === "description" || key === "title") {
      return typeof nested === "string" ? [nested] : []
    }
    if (key === "properties") {
      const properties = record(nested)
      if (!properties) return []
      return Object.entries(properties).flatMap(([property, definition]) => [
        property,
        property.replaceAll("_", " "),
        ...schemaText(definition, depth + 1),
      ])
    }
    if (key === "items" || key === "anyOf" || key === "oneOf" || key === "allOf") {
      return schemaText(nested, depth + 1)
    }
    return []
  })
}

function cjkTokens(value: string) {
  const groups = value.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu) ?? []
  return groups.flatMap((group) => {
    const chars = [...group]
    const bigrams = chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`)
    return [group, ...chars, ...bigrams]
  })
}

function tokens(value: string) {
  const normalized = value.toLowerCase()
  const base = normalized
    .replaceAll("_", " ")
    .split(/[^\p{Letter}\p{Number}]+/u)
    .map((item) => item.trim())
    .filter(Boolean)
  const aliases = Object.entries(QUERY_ALIASES).flatMap(([term, values]) =>
    normalized.includes(term) ? [term, ...values] : [],
  )
  return [...base, ...cjkTokens(normalized), ...aliases]
}

function namespaceByTool(namespaces: McpToolNamespace[]) {
  const result = new Map<string, string>()
  for (const namespace of namespaces) {
    for (const toolID of namespace.tools) result.set(toolID, namespace.name)
  }
  return result
}

async function buildCatalog(
  tools: Record<string, Tool>,
  namespaces: McpToolNamespace[],
  profile?: string,
): Promise<Catalog> {
  const toolNamespace = namespaceByTool(namespaces)
  let schemaBytes = 0
  const documents = await Promise.all(
    Object.entries(tools)
      .filter(([id]) => exposureFor(id, profile) === ToolExposure.Deferred)
      .map(async ([id, definition]) => {
        const schema = await Promise.resolve(asSchema(definition.inputSchema).jsonSchema)
        const serialized = JSON.stringify(schema)
        schemaBytes += Buffer.byteLength(serialized)
        const description = definition.description ?? ""
        const searchable = [
          id,
          id.replaceAll("_", " "),
          description,
          ...schemaText(schema),
        ].join("\n")
        const documentTokens = tokens(searchable)
        const termFrequency = new Map<string, number>()
        for (const token of documentTokens) {
          termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1)
        }
        const namespace = toolNamespace.get(id)
        return {
          id,
          description,
          schema,
          tokens: documentTokens,
          termFrequency,
          source: namespace ? "mcp" as const : "local" as const,
          ...(namespace ? { namespace } : {}),
        }
      }),
  )

  const documentFrequency = new Map<string, number>()
  for (const document of documents) {
    for (const token of new Set(document.tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1)
    }
  }

  return {
    documents,
    averageLength: documents.length
      ? documents.reduce((total, document) => total + document.tokens.length, 0) / documents.length
      : 0,
    documentFrequency,
    schemaBytes,
  }
}

function bm25Score(document: SearchDocument, queryTokens: string[], catalog: Catalog) {
  const k1 = 1.2
  const b = 0.75
  const totalDocuments = catalog.documents.length
  let score = 0

  for (const term of new Set(queryTokens)) {
    const frequency = document.termFrequency.get(term) ?? 0
    if (!frequency) continue
    const documentFrequency = catalog.documentFrequency.get(term) ?? 0
    const inverseDocumentFrequency = Math.log(
      1 + (totalDocuments - documentFrequency + 0.5) / (documentFrequency + 0.5),
    )
    const lengthNormalization = catalog.averageLength
      ? 1 - b + b * (document.tokens.length / catalog.averageLength)
      : 1
    score += inverseDocumentFrequency * ((frequency * (k1 + 1)) / (frequency + k1 * lengthNormalization))
  }

  return score
}

function inputSummary(schema: unknown) {
  const item = record(schema)
  const properties = record(item?.properties)
  const required = Array.isArray(item?.required)
    ? item.required.filter((value): value is string => typeof value === "string")
    : []
  return {
    inputKeys: properties ? Object.keys(properties).slice(0, 20) : [],
    required: required.slice(0, 20),
  }
}

function exactBoost(document: SearchDocument, query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  const id = document.id.toLowerCase()
  const description = document.description.toLowerCase()
  if (id === normalizedQuery) return 500
  if (id.includes(normalizedQuery)) return 100
  if (description.includes(normalizedQuery)) return 60
  return 0
}

function runtimeProfileMultiplier(document: SearchDocument, profile: string | undefined) {
  if (!profile) return 1
  const preferred = TOOL_SEARCH_PROFILES[profile]
  if (!preferred) return 1
  const searchable = [
    document.id,
    document.description,
    document.namespace ?? "",
  ].join("\n").toLowerCase()
  const hits = preferred.filter((term) => searchable.includes(term)).length
  return 1 + Math.min(hits * 0.35, 1.4)
}

/** Explicit deferred-integration intent — only then may tool_search load MCP. */
export function queryRequestsDeferredDiscovery(query: string) {
  return /飞书|lark|notion|google\s*docs?|docx|多维表|bitable|drive\.google|石墨|语雀|shopify|mcp|日历|邮件|gmail|outlook|chrome扩展|browser.?control|computer.?use|pdf\s*extract|skill\s*loader/i.test(
    query,
  )
}

/**
 * Detect Direct tools that already cover the query. Those IDs are intentionally
 * absent from the deferred BM25 catalog — searching for them is a mis-invocation.
 */
export function findAlreadyAvailableDirectTools(
  query: string,
  tools: Record<string, Tool>,
  profile?: string,
): string[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return []
  const found: string[] = []

  for (const toolID of Object.keys(tools)) {
    if (exposureFor(toolID, profile) !== ToolExposure.Direct) continue
    const id = toolID.toLowerCase()
    // Whole-id token match: "write file" hits write, not overwrite-only noise.
    const idPattern = new RegExp(`(^|[^a-z0-9_])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9_]|$)`, "i")
    if (idPattern.test(normalized)) {
      found.push(toolID)
      continue
    }
    const hints = DIRECT_TOOL_QUERY_HINTS[id]
    if (!hints) continue
    if (hints.some((hint) => normalized.includes(hint.toLowerCase()))) {
      found.push(toolID)
    }
  }

  return [...new Set(found)].sort((left, right) => left.localeCompare(right))
}

function toolSearchMinScore() {
  const raw = Number(process.env.OPENCODE_TOOL_SEARCH_MIN_SCORE?.trim() || TOOL_SEARCH_MIN_SCORE)
  if (!Number.isFinite(raw) || raw < 0) return TOOL_SEARCH_MIN_SCORE
  return raw
}

/**
 * Discovery load contract:
 * 1) Direct already covers the query and the user did not name a deferred
 *    integration → load nothing (do not sticky-load substitutes).
 * 2) Otherwise only keep matches at/above TOOL_SEARCH_MIN_SCORE (fail-closed).
 */
export function resolveToolSearchLoads<T extends { score: number }>(input: {
  query: string
  alreadyAvailable: readonly string[]
  catalogMatches: readonly T[]
}): { matches: T[]; loadBlockedReason?: string } {
  if (
    input.alreadyAvailable.length > 0
    && !queryRequestsDeferredDiscovery(input.query)
  ) {
    return {
      matches: [],
      loadBlockedReason: "already_available_direct",
    }
  }
  const minScore = toolSearchMinScore()
  return {
    matches: input.catalogMatches.filter((match) => match.score >= minScore),
  }
}

async function searchCatalog(input: {
  tools: Record<string, Tool>
  namespaces: McpToolNamespace[]
  query: string
  limit: number
  profile?: string
}) {
  const catalog = await buildCatalog(input.tools, input.namespaces, input.profile)
  const queryTokens = tokens(input.query)
  // Rank all positive scores; load contract (Direct short-circuit + min score)
  // is applied by resolveToolSearchLoads before sticky leases.
  const ranked = catalog.documents
    .map((document) => {
      const relevance = exactBoost(document, input.query) + bm25Score(document, queryTokens, catalog)
      return {
        document,
        score: relevance > 0
          ? relevance * runtimeProfileMultiplier(document, input.profile)
          : 0,
      }
    })
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score || left.document.id.localeCompare(right.document.id))
  return {
    catalog,
    // Unfiltered positive hits for diagnostics; callers must resolveToolSearchLoads.
    ranked,
    matches: ranked.slice(0, input.limit),
  }
}

function parseSearchArgs(value: unknown) {
  const item = record(value)
  const query = typeof item?.query === "string" ? item.query.trim() : ""
  if (!query) throw new Error("query is required")
  const rawLimit = typeof item?.limit === "number" ? Math.floor(item.limit) : TOOL_SEARCH_DEFAULT_LIMIT
  const limit = Math.max(1, Math.min(rawLimit, 20))
  const profile = typeof item?.profile === "string" ? item.profile.trim() : ""
  if (profile && !TOOL_SEARCH_PROFILES[profile]) {
    throw new Error(`Unknown tool-search profile: ${profile}`)
  }
  return { query, limit, profile: profile || undefined }
}

/** Codex-style recovery when the live catalog has no match — never invent tools. */
export function buildToolSearchRecovery(input: {
  matchCount: number
  namespaces: McpToolNamespace[]
  totalDeferred: number
  alreadyAvailable?: readonly string[]
}) {
  const connectedNamespaces = input.namespaces
    .map((namespace) => namespace.name)
    .filter(Boolean)
    .slice(0, 24)
  const alreadyAvailable = [...(input.alreadyAvailable ?? [])].filter(Boolean)

  if (alreadyAvailable.length > 0) {
    const listed = alreadyAvailable.join(", ")
    return {
      nextAction:
        `tool_search does not apply: ${listed} already cover this query (Direct). `
        + "Call those tools now. Deferred MCP tools were not loaded as substitutes.",
      nextActions: [
        "call_already_available_direct_tool",
        "do_not_use_tool_search_for_direct_capabilities",
      ] as string[],
      connectedNamespaces,
      alreadyAvailable,
      doNot: [
        "sticky_load_deferred_substitutes_for_direct_capabilities",
        "paste_large_html_or_file_bodies_into_chat",
      ] as string[],
    }
  }

  if (input.matchCount > 0) {
    return {
      nextAction: "Call one of the loaded tools on the next model step.",
      nextActions: ["call_the_best_matching_loaded_tool"] as string[],
      connectedNamespaces,
      doNot: [] as string[],
    }
  }

  const nextActions = [
    "broaden_query_and_retry_tool_search",
    "web_search_or_webfetch_for_public_docs_or_api_guidance",
    ...(connectedNamespaces.length
      ? ["retry_tool_search_with_a_connected_mcp_namespace_name"]
      : ["open_extensions_or_connect_mcp_for_the_missing_integration"]),
    "tell_user_which_connector_skill_or_plugin_is_missing",
  ]

  return {
    nextAction:
      "No deferred tool matched. Broaden the query once, then use web_search/webfetch for public guidance, or ask the user to connect the missing MCP/extension. Do not invent a tool name, and do not glob/grep the workspace looking for a fake tool implementation.",
    nextActions,
    connectedNamespaces,
    totalDeferred: input.totalDeferred,
    doNot: [
      "invent_or_guess_a_tool_name",
      "dynamically_create_a_formal_tool_schema",
      "glob_grep_read_the_repo_hoping_to_find_a_missing_integration",
    ],
  }
}

function searchTool(input: {
  sessionID: string
  turnID: string
  allTools: Record<string, Tool>
  namespaces: McpToolNamespace[]
  profile?: string
}) {
  return aiTool({
    description:
      "Search deferred integrations only (plugins/MCP). Never use for write/bash/read/edit/glob/grep — those are Direct and always callable. "
      + "If the query is already covered by Direct tools, the result returns alreadyAvailable and loads nothing. "
      + "Weak BM25 hits are discarded (fail-closed). On zero deferred matches: broaden once, then web_search/webfetch or ask to connect MCP — never invent tools.",
    inputSchema: jsonSchema({
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Deferred capability or integration name, such as 'search Feishu documents'. Do not use for local write/bash.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 20,
          description: `Maximum tools to load. Defaults to ${TOOL_SEARCH_DEFAULT_LIMIT}.`,
        },
        profile: {
          type: "string",
          enum: Object.keys(TOOL_SEARCH_PROFILES),
          description: "Optional runtime profile id. It only soft-boosts relevant tools and never grants permissions.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    }),
    execute: async (rawArgs: unknown) => {
      const args = parseSearchArgs(rawArgs)
      const profile = args.profile ?? input.profile
      const alreadyAvailable = findAlreadyAvailableDirectTools(
        args.query,
        input.allTools,
        profile,
      )
      const { catalog, matches: catalogMatches } = await searchCatalog({
        tools: input.allTools,
        namespaces: input.namespaces,
        query: args.query,
        // Fetch a wider ranked window, then apply load contract + limit.
        limit: Math.max(args.limit, 20),
        profile,
      })
      const resolved = resolveToolSearchLoads({
        query: args.query,
        alreadyAvailable,
        catalogMatches,
      })
      const matches = resolved.matches.slice(0, args.limit)

      const state = stateFor(input.sessionID, input.turnID)
      const loadedToolIds = matches.map((match) => match.document.id)
      addLoadedLeases(input.sessionID, state, loadedToolIds)

      const recovery = buildToolSearchRecovery({
        matchCount: matches.length,
        namespaces: input.namespaces,
        totalDeferred: catalog.documents.length,
        alreadyAvailable,
      })

      const output = {
        ok: true,
        query: args.query,
        ...(profile ? { profile } : {}),
        ...(alreadyAvailable.length ? { alreadyAvailable } : {}),
        ...(resolved.loadBlockedReason ? { loadBlockedReason: resolved.loadBlockedReason } : {}),
        loadedToolIds,
        matches: matches.map((match) => ({
          id: match.document.id,
          source: match.document.source,
          ...(match.document.namespace ? { namespace: match.document.namespace } : {}),
          description: match.document.description.slice(0, 320),
          ...inputSummary(match.document.schema),
        })),
        totalDeferred: catalog.documents.length,
        connectedNamespaces: recovery.connectedNamespaces,
        nextAction: recovery.nextAction,
        nextActions: recovery.nextActions,
        ...(recovery.doNot.length ? { doNot: recovery.doNot } : {}),
      }
      return {
        title: `Tool search: ${args.query}`,
        output: JSON.stringify(output, null, 2),
        metadata: {
          query: args.query,
          ...(profile ? { profile } : {}),
          matches: matches.length,
          loadedToolIds: output.loadedToolIds,
          ...(alreadyAvailable.length ? { alreadyAvailable } : {}),
          ...(resolved.loadBlockedReason ? { loadBlockedReason: resolved.loadBlockedReason } : {}),
          totalDeferred: catalog.documents.length,
          deferredSchemaBytes: catalog.schemaBytes,
          empty: matches.length === 0 && alreadyAvailable.length === 0,
        },
      }
    },
  })
}

function withExecuteHook(
  tool: Tool,
  hook: (args: unknown, options: unknown, run: () => Promise<unknown>) => Promise<unknown>,
): Tool {
  const original = tool as Tool & { execute?: (args: unknown, options?: unknown) => Promise<unknown> }
  if (typeof original.execute !== "function") return tool
  const runOriginal = original.execute.bind(original)
  return {
    ...tool,
    execute: async (args: unknown, options?: unknown) =>
      hook(args, options, () => runOriginal(args, options)),
  } as Tool
}

type IdempotentWriteKind = "page-import" | "project-publish"

type WriteFingerprint = {
  fingerprint: string
  kind: IdempotentWriteKind
  projectId: string
  pageId?: string
  revisionHint: string
}

/** Explicit execution policy: visibility remains separate from write effects. */
const IDEMPOTENT_WRITE_POLICIES = new Map<string, IdempotentWriteKind>([
  ["wodeapp_page_import_from_file", "page-import"],
  ["publish_project", "project-publish"],
])

function bareToolName(toolID: string): string {
  if (IDEMPOTENT_WRITE_POLICIES.has(toolID)) return toolID
  const namespaced = toolID.match(/^([a-z0-9]+(?:-[a-z0-9]+)+)_(.+)$/i)
  if (namespaced?.[2] && IDEMPOTENT_WRITE_POLICIES.has(namespaced[2])) return namespaced[2]
  return toolID
}

function idempotentWriteKind(toolID: string): IdempotentWriteKind | undefined {
  return IDEMPOTENT_WRITE_POLICIES.get(bareToolName(toolID))
}

function stringArg(rawArgs: unknown, name: string): string {
  const value = (record(rawArgs) ?? {})[name]
  return typeof value === "string" ? value.trim() : ""
}

function prepareWriteLedgerEpoch(state: SessionToolState, taskEpoch: string) {
  if (state.writeLedgerEpoch === taskEpoch) return
  state.writeLedgerEpoch = taskEpoch
  state.successfulWrites.clear()
  state.inFlightWrites.clear()
  state.projectRevisionHints.clear()
}

function toolCallID(options: unknown): string | undefined {
  const value = (record(options) ?? {}).toolCallId
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function parsedJsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string") return record(value)
  try {
    return record(JSON.parse(value))
  } catch {
    return
  }
}

/** Record only completed writes without an explicit failure result. */
function successfulToolResult(result: unknown): boolean {
  const container = record(result)
  if (container?.isError === true) return false
  const payload = parsedJsonRecord(container?.output ?? result)
  if (!payload) return true
  return payload.ok !== false && payload.success !== false && payload.isError !== true
}

function hashFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex")
}

async function writeFingerprint(input: {
  toolID: string
  taskEpoch: string
  args: unknown
  state: SessionToolState
}): Promise<WriteFingerprint | undefined> {
  const kind = idempotentWriteKind(input.toolID)
  if (!kind) return
  const projectId = stringArg(input.args, "projectId")
  if (!projectId) return

  if (kind === "page-import") {
    const pageId = stringArg(input.args, "pageId")
    const sourcePath = stringArg(input.args, "sourcePath")
    // Creating a new page has no stable resource ID yet. Relative paths depend
    // on execution context, so both cases deliberately fail open.
    if (!pageId || !sourcePath || !isAbsolute(sourcePath)) return
    let sourceHash = ""
    try {
      sourceHash = createHash("sha256").update(await readFile(sourcePath)).digest("hex")
    } catch {
      return
    }
    const revisionHint = `page-import:${sourceHash}`
    return {
      fingerprint: hashFingerprint({
        taskEpoch: input.taskEpoch,
        tool: "wodeapp_page_import_from_file",
        projectId,
        pageId,
        sourceHash,
      }),
      kind,
      projectId,
      pageId,
      revisionHint,
    }
  }

  // publish_project currently exposes only projectId + release description.
  // Deduplicate only when this task has a successful, tracked draft mutation;
  // any intervening project/page tool invalidates the hint and fails open.
  const revisionHint = input.state.projectRevisionHints.get(projectId)
  if (!revisionHint) return
  return {
    fingerprint: hashFingerprint({
      taskEpoch: input.taskEpoch,
      tool: "publish_project",
      projectId,
      revisionHint,
      description: stringArg(input.args, "description"),
    }),
    kind,
    projectId,
    revisionHint,
  }
}

function invalidateProjectWriteLedger(state: SessionToolState, rawArgs: unknown) {
  const projectId = stringArg(rawArgs, "projectId")
  const pageId = stringArg(rawArgs, "pageId")
  if (!projectId && !pageId) return
  const invalidatedProjects = new Set(projectId ? [projectId] : [])
  for (const [fingerprint, write] of state.successfulWrites) {
    if (
      (projectId && write.projectId === projectId)
      || (pageId && write.pageId === pageId)
    ) {
      invalidatedProjects.add(write.projectId)
      state.successfulWrites.delete(fingerprint)
    }
  }
  for (const id of invalidatedProjects) state.projectRevisionHints.delete(id)
}

function deduplicatedWriteResult(toolID: string, write: SuccessfulWriteRecord) {
  const publishNext = bareToolName(toolID) === "wodeapp_page_import_from_file"
    ? ["publish_project"]
    : []
  const payload = {
    ok: true,
    executed: false,
    deduplicated: true,
    tool: bareToolName(toolID),
    ...(write.previousCallId ? { previousCallId: write.previousCallId } : {}),
    projectId: write.projectId,
    ...(write.pageId ? { pageId: write.pageId } : {}),
    nextActions: publishNext,
  }
  return {
    title: `Duplicate write skipped: ${bareToolName(toolID)}`,
    output: JSON.stringify(payload, null, 2),
    metadata: {
      deduplicated: true,
      tool: bareToolName(toolID),
      ...(write.previousCallId ? { previousCallId: write.previousCallId } : {}),
    },
  }
}

function rememberSuccessfulWrite(
  state: SessionToolState,
  taskEpoch: string,
  toolID: string,
  fingerprint: WriteFingerprint,
  options: unknown,
) {
  if (state.writeLedgerEpoch !== taskEpoch) return
  if (fingerprint.kind === "page-import") {
    invalidateProjectWriteLedger(state, {
      projectId: fingerprint.projectId,
      pageId: fingerprint.pageId,
    })
    state.projectRevisionHints.set(fingerprint.projectId, fingerprint.revisionHint)
  }
  state.successfulWrites.set(fingerprint.fingerprint, {
    fingerprint: fingerprint.fingerprint,
    toolID,
    taskEpoch,
    projectId: fingerprint.projectId,
    ...(fingerprint.pageId ? { pageId: fingerprint.pageId } : {}),
    revisionHint: fingerprint.revisionHint,
    ...(toolCallID(options) ? { previousCallId: toolCallID(options) } : {}),
  })
}

function wrapSuccessfulWriteIdempotency(input: {
  sessionID: string
  turnID: string
  taskEpoch: string
  toolID: string
  tool: Tool
}): Tool {
  return withExecuteHook(input.tool, async (args, options, run) => {
    const state = stateFor(input.sessionID, input.turnID)
    prepareWriteLedgerEpoch(state, input.taskEpoch)
    const fingerprint = await writeFingerprint({
      toolID: input.toolID,
      taskEpoch: input.taskEpoch,
      args,
      state,
    })
    if (!fingerprint) return run()

    const previous = state.successfulWrites.get(fingerprint.fingerprint)
    if (previous) return deduplicatedWriteResult(input.toolID, previous)

    const pending = state.inFlightWrites.get(fingerprint.fingerprint)
    if (pending) {
      try {
        await pending
      } catch {
        // A failed first attempt is not idempotent; this caller may retry.
      }
      const completed = state.successfulWrites.get(fingerprint.fingerprint)
      if (completed) return deduplicatedWriteResult(input.toolID, completed)
    }

    const execution = Promise.resolve().then(run)
    state.inFlightWrites.set(fingerprint.fingerprint, execution)
    try {
      const result = await execution
      if (successfulToolResult(result)) {
        rememberSuccessfulWrite(state, input.taskEpoch, input.toolID, fingerprint, options)
      }
      return result
    } finally {
      if (state.inFlightWrites.get(fingerprint.fingerprint) === execution) {
        state.inFlightWrites.delete(fingerprint.fingerprint)
      }
    }
  })
}

function wrapProjectWriteLedgerInvalidation(input: {
  sessionID: string
  turnID: string
  taskEpoch: string
  tool: Tool
}): Tool {
  return withExecuteHook(input.tool, async (args, _options, run) => {
    const state = stateFor(input.sessionID, input.turnID)
    prepareWriteLedgerEpoch(state, input.taskEpoch)
    invalidateProjectWriteLedger(state, args)
    return run()
  })
}

function wrapWritePolicies(input: {
  sessionID: string
  turnID: string
  taskEpoch: string
  toolID: string
  tool: Tool
}): Tool {
  if (idempotentWriteKind(input.toolID)) return wrapSuccessfulWriteIdempotency(input)
  return wrapProjectWriteLedgerInvalidation(input)
}

function writeFilePath(rawArgs: unknown): string {
  const args = record(rawArgs) ?? {}
  const path =
    (typeof args.filePath === "string" && args.filePath)
    || (typeof args.path === "string" && args.path)
    || (typeof args.filepath === "string" && args.filepath)
    || ""
  return path.trim()
}

function writeContent(rawArgs: unknown): string {
  const args = record(rawArgs) ?? {}
  if (typeof args.content === "string") return args.content
  if (typeof args.contents === "string") return args.contents
  if (typeof args.text === "string") return args.text
  return ""
}

function isEffectivelyEmptyWriteContent(content: string) {
  return content.trim().length === 0
}

function wrapWriteAgainstEmptyThrash(sessionID: string, turnID: string, tool: Tool): Tool {
  return withExecuteHook(tool, async (args, _options, run) => {
    const path = writeFilePath(args)
    const content = writeContent(args)
    if (!path || !isEffectivelyEmptyWriteContent(content)) {
      if (path) {
        const state = stateFor(sessionID, turnID)
        state.emptyWriteHits.delete(path)
      }
      return run()
    }

    const state = stateFor(sessionID, turnID)
    const next = (state.emptyWriteHits.get(path) ?? 0) + 1
    state.emptyWriteHits.set(path, next)
    const limit = emptyWriteThrashLimit()
    if (next < limit) return run()

    return {
      title: `Blocked empty write thrash: ${path}`,
      output: JSON.stringify(
        {
          ok: false,
          error: "EMPTY_WRITE_THRASH",
          message:
            `Rejected repeated empty write to ${path} (${next} times this turn). `
            + "Stop writing empty temp files. If you need a deferred capability "
            + "(browser, MCP, plugins), call tool_search first and use the loaded tool.",
          path,
          count: next,
          limit,
        },
        null,
        2,
      ),
      metadata: {
        emptyWriteThrash: true,
        path,
        count: next,
        limit,
      },
    }
  })
}

/**
 * ses_03523d86: rewrite nohup/& background so OpenCode shell does not wait/kill the
 * process group for the full timeout. Must pass rewritten args into execute (unlike
 * withExecuteHook which closes over the original args).
 */
function wrapBashBackgroundDetach(tool: Tool): Tool {
  const original = tool as Tool & { execute?: (args: unknown, options?: unknown) => Promise<unknown> }
  if (typeof original.execute !== "function") return tool
  const runOriginal = original.execute.bind(original)
  return {
    ...tool,
    execute: async (args: unknown, options?: unknown) => {
      const { args: nextArgs } = rewriteBashToolArgs(args)
      return runOriginal(nextArgs, options)
    },
  } as Tool
}

function wrapDeferredWithLeaseRenew(sessionID: string, turnID: string, toolID: string, tool: Tool): Tool {
  return withExecuteHook(tool, async (_args, _options, run) => {
    const state = stateFor(sessionID, turnID)
    renewLease(state, toolID)
    return run()
  })
}

export function exposeDynamicTools(input: {
  sessionID: string
  turnID: string
  tools: Record<string, Tool>
  namespaces: McpToolNamespace[]
  profile?: string
  /** Progressive disclosure: sticky-load deferred catalog matches for these bare names. */
  preloadBareNames?: readonly string[]
  /** Optional user text used to detect capability packs when preloadBareNames omitted. */
  userText?: string
  /** Last real user message ID. Synthetic continuation turns keep this epoch. */
  taskEpoch?: string
}): DynamicToolExposureResult {
  if (!dynamicToolDiscoveryEnabled()) {
    const state = stateFor(input.sessionID, input.turnID)
    const measurement = measureVisibleToolset(state, input.tools)
    const { visibleToolIDs, ...toolsetStats } = measurement
    return {
      tools: input.tools,
      visibleToolIDs,
      stats: {
        total: Object.keys(input.tools).length,
        direct: Object.keys(input.tools).length,
        deferred: 0,
        hidden: 0,
        loaded: 0,
        ...toolsetStats,
      },
    }
  }

  const state = stateFor(input.sessionID, input.turnID)
  const taskEpoch = input.taskEpoch?.trim() || input.turnID
  prepareWriteLedgerEpoch(state, taskEpoch)
  const availableToolIDs = new Set(Object.keys(input.tools))
  const catalogReady = catalogReadyForStickyPrune(input.tools, input.profile)

  const preloadBare = input.preloadBareNames?.length
    ? [...input.preloadBareNames]
    : input.userText
      ? bareNamesForPreloadPacks(detectCapabilityPreloadPacks(input.userText))
      : []
  if (preloadBare.length && stickyLoadedEnabled()) {
    const matched = resolvePreloadCatalogIDs(preloadBare, Object.keys(input.tools)).filter(
      (toolID) => exposureFor(toolID, input.profile) === ToolExposure.Deferred,
    )
    if (matched.length) addLoadedLeases(input.sessionID, state, matched)
  }

  if (catalogReady) {
    pruneLeases(state, availableToolIDs)
    // Hidden / env-hidden tools stay in the host catalog but must not retain sticky slots.
    for (const toolID of [...state.leases.keys()]) {
      if (exposureFor(toolID, input.profile) === ToolExposure.Hidden) {
        state.leases.delete(toolID)
      }
    }
    persistLeases(input.sessionID, state, { allowClearEmpty: true })
  }

  const visible: Record<string, Tool> = {}
  let direct = 0
  let deferred = 0
  let hidden = 0
  let loaded = 0

  for (const [toolID, definition] of Object.entries(input.tools)) {
    const exposure = exposureFor(toolID, input.profile)
    if (exposure === ToolExposure.Hidden) {
      hidden++
      continue
    }
    if (exposure === ToolExposure.Direct) {
      direct++
      let next = directToolDefinition(toolID, definition)
      next = wrapWritePolicies({
        sessionID: input.sessionID,
        turnID: input.turnID,
        taskEpoch,
        toolID,
        tool: next,
      })
      if (toolID === "write") {
        next = wrapWriteAgainstEmptyThrash(input.sessionID, input.turnID, next)
      }
      if (toolID === "bash") {
        next = wrapBashBackgroundDetach(next)
      }
      visible[toolID] = next
      continue
    }
    deferred++
    if (isLeaseActive(state, toolID)) {
      loaded++
      let next = wrapDeferredWithLeaseRenew(input.sessionID, input.turnID, toolID, definition)
      next = wrapWritePolicies({
        sessionID: input.sessionID,
        turnID: input.turnID,
        taskEpoch,
        toolID,
        tool: next,
      })
      if (toolID === "write") {
        next = wrapWriteAgainstEmptyThrash(input.sessionID, input.turnID, next)
      }
      if (toolID === "bash") {
        next = wrapBashBackgroundDetach(next)
      }
      visible[toolID] = next
    }
  }

  visible[TOOL_SEARCH_ID] = searchTool({
    sessionID: input.sessionID,
    turnID: input.turnID,
    allTools: input.tools,
    namespaces: input.namespaces,
    profile: input.profile,
  })
  const measurement = measureVisibleToolset(state, visible)
  const { visibleToolIDs, ...toolsetStats } = measurement

  return {
    tools: visible,
    visibleToolIDs,
    stats: {
      total: Object.keys(input.tools).length,
      direct,
      deferred,
      hidden,
      loaded,
      ...toolsetStats,
    },
  }
}

function xml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function firstDescription(instructions: string) {
  return instructions
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, TOOL_NAMESPACE_DESCRIPTION_MAX_CHARS) ?? "Connected MCP tool namespace."
}

function boundedLines(lines: string[], maxBytes: number) {
  const result: string[] = []
  let bytes = 0
  for (const line of lines) {
    const next = Buffer.byteLength(`${line}\n`)
    if (bytes + next > maxBytes) break
    result.push(line)
    bytes += next
  }
  return result
}

function boundedBlocks(opening: string, blocks: string[][], closing: string, maxBytes: number) {
  const result = [opening]
  let bytes = Buffer.byteLength(`${opening}\n${closing}\n`)
  for (const block of blocks) {
    const next = Buffer.byteLength(`${block.join("\n")}\n`)
    if (bytes + next > maxBytes) break
    result.push(...block)
    bytes += next
  }
  result.push(closing)
  return result
}

export function renderDynamicMcpContext(input: {
  namespaces: McpToolNamespace[]
  visibleToolIDs: ReadonlySet<string>
}) {
  if (!dynamicToolDiscoveryEnabled()) return

  const selected = input.namespaces.filter((namespace) =>
    namespace.tools.some((toolID) => input.visibleToolIDs.has(toolID)),
  )
  const deferred = input.namespaces.filter((namespace) =>
    !namespace.tools.some((toolID) => input.visibleToolIDs.has(toolID)),
  )

  const namespaceBlocks = deferred.map((namespace) => [
    `  <namespace name="${xml(namespace.name)}" tools="${namespace.tools.length}">`,
    `    ${xml(firstDescription(namespace.instructions))}`,
    "  </namespace>",
  ])
  const boundedNamespaces = boundedBlocks(
    "<tool_namespaces>",
    namespaceBlocks,
    "</tool_namespaces>",
    TOOL_NAMESPACE_CONTEXT_MAX_BYTES,
  )

  const selectedBlocks = selected.map((namespace) => [
      `  <server name="${xml(namespace.name)}">`,
      ...boundedLines(
        namespace.instructions.split(/\r?\n/).map((line) => `    ${line}`),
        4 * 1024,
      ),
      "  </server>",
    ])
  const boundedSelected = boundedBlocks(
    "<mcp_instructions>",
    selectedBlocks,
    "</mcp_instructions>",
    MCP_SELECTED_INSTRUCTIONS_MAX_BYTES,
  )

  return [
    ...(deferred.length ? boundedNamespaces : []),
    ...(selected.length ? boundedSelected : []),
  ].join("\n")
}

export const __testing = {
  exposureFor,
  stickyLoadedEnabled,
  emptyWriteThrashLimit,
  catalogReadyForStickyPrune,
  compactDirectToolDescriptionsEnabled,
  inheritStickyLeasesOnFork,
  detectCapabilityPreloadPacks,
  bareNamesForPreloadPacks,
  resolvePreloadCatalogIDs,
  extractLatestUserTask,
  extractLatestUserText,
  isSmallTalkUserText,
  isSmallTalkSession,
  resolveWorkspaceIdentitySystem,
  directToolDescription(toolID: string) {
    return COMPACT_DIRECT_TOOL_DESCRIPTIONS[toolID]
  },
  buildToolSearchRecovery,
  findAlreadyAvailableDirectTools,
  queryRequestsDeferredDiscovery,
  resolveToolSearchLoads,
  toolSearchMinScore,
  async search(input: {
    tools: Record<string, Tool>
    namespaces: McpToolNamespace[]
    query: string
    limit?: number
    profile?: string
  }) {
    const alreadyAvailable = findAlreadyAvailableDirectTools(
      input.query,
      input.tools,
      input.profile,
    )
    const limit = input.limit ?? TOOL_SEARCH_DEFAULT_LIMIT
    const result = await searchCatalog({
      ...input,
      limit: Math.max(limit, 20),
    })
    const { matches } = resolveToolSearchLoads({
      query: input.query,
      alreadyAvailable,
      catalogMatches: result.matches,
    })
    return matches.slice(0, limit).map((match) => ({
      id: match.document.id,
      source: match.document.source,
      namespace: match.document.namespace,
    }))
  },
  async searchDetailed(input: {
    tools: Record<string, Tool>
    namespaces: McpToolNamespace[]
    query: string
    limit?: number
    profile?: string
  }) {
    const alreadyAvailable = findAlreadyAvailableDirectTools(
      input.query,
      input.tools,
      input.profile,
    )
    const limit = input.limit ?? TOOL_SEARCH_DEFAULT_LIMIT
    const result = await searchCatalog({
      ...input,
      limit: Math.max(limit, 20),
    })
    const resolved = resolveToolSearchLoads({
      query: input.query,
      alreadyAvailable,
      catalogMatches: result.matches,
    })
    const matches = resolved.matches.slice(0, limit)
    const recovery = buildToolSearchRecovery({
      matchCount: matches.length,
      namespaces: input.namespaces,
      totalDeferred: result.catalog.documents.length,
      alreadyAvailable,
    })
    return {
      alreadyAvailable,
      loadBlockedReason: resolved.loadBlockedReason,
      loadedToolIds: matches.map((match) => match.document.id),
      scores: result.ranked.map((match) => ({ id: match.document.id, score: match.score })),
      nextAction: recovery.nextAction,
      nextActions: recovery.nextActions,
      doNot: recovery.doNot,
    }
  },
  load(sessionID: string, turnID: string, toolIDs: string[]) {
    const state = stateFor(sessionID, turnID)
    addLoadedLeases(sessionID, state, toolIDs)
  },
  leaseSnapshot(sessionID: string, toolID: string) {
    const lease = sessionStates.get(sessionID)?.leases.get(toolID)
    if (!lease) return null
    return {
      toolID: lease.toolID,
      loadedAt: lease.loadedAt,
      lastUsedAt: lease.lastUsedAt,
    }
  },
  leaseCount(sessionID: string) {
    return sessionStates.get(sessionID)?.leases.size ?? 0
  },
  setLeaseTimes(sessionID: string, toolID: string, times: { lastUsedAt?: number }) {
    const lease = sessionStates.get(sessionID)?.leases.get(toolID)
    if (!lease) return false
    if (typeof times.lastUsedAt === "number") lease.lastUsedAt = times.lastUsedAt
    return true
  },
  dropLease(sessionID: string, toolID: string) {
    const state = sessionStates.get(sessionID)
    if (!state?.leases.has(toolID)) return false
    state.leases.delete(toolID)
    persistLeases(sessionID, state, { allowClearEmpty: true })
    return true
  },
  async invokeWrite(sessionID: string, turnID: string, tools: Record<string, Tool>, args: unknown) {
    const exposed = exposeDynamicTools({
      sessionID,
      turnID,
      tools,
      namespaces: [],
    })
    const write = exposed.tools.write as Tool & { execute?: (args: unknown) => Promise<unknown> }
    if (!write?.execute) throw new Error("write tool missing")
    return write.execute(args)
  },
  async invokeBash(sessionID: string, turnID: string, tools: Record<string, Tool>, args: unknown) {
    return __testing.invokeTool(sessionID, turnID, tools, "bash", args)
  },
  async invokeTool(
    sessionID: string,
    turnID: string,
    tools: Record<string, Tool>,
    toolID: string,
    args: unknown = {},
    profile?: string,
  ) {
    const exposed = exposeDynamicTools({
      sessionID,
      turnID,
      tools,
      namespaces: [],
      profile,
    })
    const tool = exposed.tools[toolID] as Tool & { execute?: (args: unknown) => Promise<unknown> }
    if (!tool?.execute) throw new Error(`${toolID} tool missing from exposure`)
    return tool.execute(args)
  },
  /** Clear in-memory session state. Pass keepPersisted to simulate sidecar restart. */
  reset(options?: { keepPersisted?: boolean }) {
    if (!options?.keepPersisted) {
      for (const sessionID of sessionStates.keys()) {
        clearStickyLeaseToolIDs(sessionID)
      }
    }
    sessionStates.clear()
  },
}
