# WodeAppX live tool discovery

WodeAppX uses the live OpenCode registry and the MCP clients already resolved
inside the OpenCode agent loop as the source of truth. Together they include:

- WodeAppX local and typed direct tools;
- installed OpenCode plugins;
- every MCP server currently connected in OpenCode.

The patched OpenCode 1.17.11 sidecar gives every tool one runtime definition and
one exposure state:

- `Direct`: the small coding/web foundation visible on the first model step;
- `Deferred`: business, plugin, and MCP tools indexed locally but omitted from
  the initial model request;
- `Hidden`: compatibility placeholders or explicitly disabled tools.

`tool_search` runs BM25 over IDs, descriptions, property names, and schema
descriptions. It defaults to eight matches. Matches become callable on the next
model step. By default they are kept for the **rest of that session** via sticky
leases (in-memory + durable per `sessionID`).

**Load contract (not ranking preference):**

- `tool_search` is for **Deferred** integrations only. Direct tools
  (`write` / `bash` / `read` / `edit` / …) are always callable and are **not**
  in the deferred catalog.
- If the query is already covered by Direct tools and does not name a deferred
  integration (飞书 / Shopify / …), discovery returns `alreadyAvailable` and
  **loads nothing** (`loadBlockedReason=already_available_direct`). It must not
  sticky-load MCP substitutes (regression: `ses_0248febaa*` — `write file` →
  Feishu docx/import → HTML pasted into chat).
- Deferred loads are fail-closed: only matches with score ≥
  `TOOL_SEARCH_MIN_SCORE` (default `3`, override `OPENCODE_TOOL_SEARCH_MIN_SCORE`)
  are sticky-loaded. Token-overlap noise (`create`+`file` ≈2.4) must not load;
  real integration queries (e.g. `search Feishu documents`) stay well above.



- keyed by `sessionID` (user `parentID` is still the in-turn `turnID`);
- **session-lifetime retention** (Codex/Cursor-style): once loaded, a deferred
  tool stays callable until it leaves the live catalog, becomes Hidden, sticky
  is disabled, or the session lease file is cleared;
- **Session.fork inherits sticky leases** from the parent session (disk +
  in-memory) so already-discovered deferred tools remain callable;
- **Capability-pack sticky preload** (progressive disclosure): user-turn text
  that matches a pack (e.g. site / agent-app) sticky-loads that pack's deferred
  catalog tools — including MCP bare-name match — without promoting them to
  Direct. Unrelated deferred tools stay hidden until `tool_search`. Do **not**
  dump creative-core into Direct; that collapses progressive disclosure;
- **Synthetic continuation inherits real intent**: recovery / compaction user
  messages whose text parts are marked `synthetic:true` do not become a new
  capability intent. Preload scans backward to the latest real user text, so a
  continuation after page import still sees the deferred publish tool;
- **Successful write idempotency (host fallback)**: the latest real user
  message ID is the task epoch; synthetic continuation keeps that epoch.
  `wodeapp_page_import_from_file` deduplicates successful writes by
  `projectId + pageId + source SHA-256`. A following `publish_project` can be
  deduplicated by that tracked revision when no intervening project/page tool
  invalidated it. Failures are never recorded. Duplicate calls return a
  structured `executed:false, deduplicated:true, previousCallId` result and
  import points to `publish_project` in `nextActions`;
- The idempotency ledger is in-memory and separate from sticky leases. True
  cross-process/concurrent protection still belongs at the write API boundary
  with an `Idempotency-Key` plus a database uniqueness constraint;
- **sidecar restart safe**: loaded tool IDs are written under
  `$XDG_DATA_HOME/opencode/session-sticky-leases/` (or
  `~/.wodeappx/session-sticky-leases/`, override with `OPENCODE_STICKY_LEASE_DIR`)
  and rehydrated on the next cold start so history and callable surface stay aligned
  (`ses_03447*` / `ses_0357*` thrash after restart);
  **do not prune/persist against a cold-start catalog with `deferred=0`** (coding
  foundation only before MCP/plugins register) — that race wiped leases for
  `ses_025ec834` / fork `ses_025543f7` and left image tools uncallable;
- **no idle TTL** and **no max-count LRU eviction** — tool schemas are a small
  dedicated surface; token cost is bounded by what `tool_search` actually loads,
  not by silently dropping unused siblings;
- disable with `OPENCODE_STICKY_LOADED=0` to restore the older turn-scoped clear
  (also skips durable rehydrate).

This matches OpenAI Tool Search client semantics (loaded tools remain callable
on future turns unless removed). WodeAppX historically used turn-scoped clear,
then briefly used a 30-minute execute-renewed TTL / max-24 LRU that caused
wrong-tool thrash (`ses_0356*`); session-lifetime sticky is the current HEAD
default.

A same-turn empty-write thrash breaker (default 3 empty `write`s to the **same
path**) is a separate guard: it rejects further empty writes to that path and
returns a recovery hint (often including `tool_search`). It does **not** force
the model to call `tool_search`, and writing a different path does not reset
the counter for the original path—only a non-empty write to that path, or a new
user turn, clears it.

`OPENCODE_DYNAMIC_TOOL_DISCOVERY=0` returns the host toolset unchanged: no
deferral, no sticky leases, and no empty-write thrash wrapper.

No router model and no copied schema registry are involved.

Runtime profiles may pass a known `profile` id to `tool_search`. The profile is
a soft multiplier applied only after normal query relevance is positive; it
cannot make an unrelated tool match, expose a hidden tool, grant permission, or
bypass approval. The Wynne profile boosts relevant live Shopify, Feishu/Lark,
and knowledge-search tools.

When search returns zero matches, the tool result includes Codex-style recovery
hints (`nextActions` / `doNot`): broaden the query once, use direct
`web_search` / `webfetch` for public docs, retry with a connected MCP namespace
name or ask the user to open Extensions / connect MCP, and tell the user what
connector is missing. Do not invent a formal tool schema and do not
glob/grep/read the workspace hoping to discover a fake integration.

Initial MCP context contains only bounded namespace summaries (4 KiB total,
250 characters per namespace). Full instructions are included only for a
namespace with a loaded tool and remain bounded. Search results include the
matched IDs and concise argument summaries; the next request carries the live
full schemas through the normal OpenCode tool pipeline.

Capability routing remains an additive relevance hint used in WodeAppX system
guidance. It no longer sends a persistent per-message `tools` allow/deny map,
because false entries become session permissions and would block a tool loaded
later by `tool_search`. Visibility is not authorization: write/destructive
approval remains enforced by the owning tool, MCP server, OpenCode permission,
or direct-action contract.

The legacy `wodeappx_search_tools` plugin tool remains installed for unpatched
or externally managed OpenCode engines, but the patched sidecar marks it hidden
to avoid two competing discovery paths.

Every model step emits paired context/cache telemetry. `dynamic tool exposure`
includes `turn.id`, `assistant.id`, `toolset_hash`, `visible_schema_bytes`,
`visible_tools`, and per-step add/remove/change counts. The matching
`llm step usage` event uses the same IDs and includes input/output/reasoning,
`cache.read`, `cache.write`, prompt-total tokens, provider/model, and flags that
distinguish provider-reported cache values from synthesized zeroes.
`visible_schema_bytes` is a stable WodeAppX serialization proxy for comparing
toolsets; provider-specific billing remains authoritative. Use these paired
events, stratified by context length, before changing within-turn accumulate vs
latest-batch lease policy, or sticky cross-turn retention. The controlled A/B
below is one provider/model snapshot, not a universal claim across all
providers.

### Verification (no fake model)

Sticky / deferred visibility / “desktop sidecar already has sticky” acceptance
must be empirical. **Fake chat models are forbidden.** A real OpenCode session
**may `prompt` and may burn WodeApp credits.** UI / CDP display is optional.

| Gate | What it proves | Credits |
|------|----------------|---------|
| `pnpm check:sticky-loaded` | LIVE (or `--binary=`) sidecar **binary sticky marker** + real `dynamic-tool-discovery` bun tests + sticky ON/OFF matrix | No |
| `pnpm check:sticky-loaded:live` | Above **plus** running sidecar: create **real session**, **real `prompt_async`** turnA=`tool_search` browser → turnB=`已登录` still hits `wodeappx_browser_*` | **Yes (allowed)** |
| `opencode:test-dynamic` | Permission-migration / telemetry only (local fake provider) | No — **not** sticky acceptance |

Do not treat “only created a session without prompt” or fake-provider SSE as sticky
desktop-生效验收.

Contract cross-links: `docs/AGENT_CAPABILITY_TESTING.md` **A17**; `.agents/memories/USER.md`.

### Controlled toolset/cache A/B

Run the isolated production-provider benchmark with:

```bash
node scripts/benchmark-toolset-cache-ab.mjs \
  --pairs 20 \
  --model wode/kimi-code-k3-256k
```

The benchmark uses the real WodeApp proxy and provider-reported usage, but only
synthetic messages and schemas. It compares the current same-turn cumulative
loaded set, a latest-batch lease, and a stable 200-tool full baseline. It never
starts MCP processes, writes credentials to the report, or modifies a user
session. The command does issue `3 × pairs` billable model requests. Detailed
output is written to a mode-`0600` file under the operating-system temporary
directory.

The 2026-07-29 run (`20` paired groups, `60/60` successful requests, Kimi Code
K3 256K, no fallback) measured:

| Strategy | Avg tools | Prompt tokens | Cache read | Uncached input | Avg latency |
|---|---:|---:|---:|---:|---:|
| Cumulative (current) | 32 | 166,160 | 151,552 | 14,608 | 4,269 ms |
| Latest-batch lease | 20 | 116,240 | 100,096 | 16,144 | 4,147 ms |
| Full 200 tools | 200 | 865,040 | 821,248 | 43,792 | 7,101 ms |

Interpretation:

- Dynamic discovery was materially cheaper than the full baseline in this
  controlled run: cumulative reduced total prompt tokens by `80.79%`, uncached
  input by `66.64%`, and mean latency by `39.88%`.
- Lease reduced serialized schema and total prompt tokens, but increased
  uncached input by `10.51%` relative to cumulative. On the three toolset-change
  groups, cumulative used `5,557` uncached tokens versus lease's `10,677`.
- Keep cumulative loading as the default. A smaller visible schema is not
  sufficient reason to accept repeated prefix invalidation.
- The provider reported cache reads but not cache writes. These figures are an
  engineering A/B, not a universal billing discount; repeat after provider,
  model, tool schema, or cache-policy changes.

### Controlled soft-wall A/B

The long-session harness lives under `scripts/context-bench/`. A deterministic
20-turn task grows only conversation context, forbids tools and file writes,
and checks exact early/middle facts at turns 8, 12, and 20. Each arm uses an
isolated XDG directory and working directory, the real WodeApp proxy, Kimi Code
K3 256K, a scaled 64k declared input/context limit, and the same 8k recent-token
preservation policy. The 64k limit makes all three thresholds observable in 20
turns without changing their percentages.

The 2026-07-29 run measured:

| Soft wall | Compact after turn | Compacts | Uncached input | Cache read | Total prompt | Wall time | Fact checks |
|---|---:|---:|---:|---:|---:|---:|---:|
| 65% (current) | 15 | 1 | 355,807 | 218,368 | 574,175 | 296.0 s | 3/3 |
| 75% | 18 | 1 | 417,675 | 220,928 | 638,603 | 278.2 s | 3/3 |
| 80% | 19 | 1 | 463,724 | 217,856 | 681,580 | 255.2 s | 3/3 |

Interpretation:

- Historical A/B (above) preferred keeping the managed default at 65% usable
  for fact-check workloads. **2026-08-12 update:** long coding explore turns
  (e.g. `ses_00c083e71ffe*`) peaked ~97k without pruning because upstream
  OpenCode `prune` skipped the newest 2 user turns; managed soft wall is now
  ~50% usable (256k → ~128k reserved) and the sidecar patch prunes **within
  the current turn**. Re-run this A/B after that pair ships before reverting.
- Relative to 65%, moving to 75% increased
  total prompt tokens by `11.22%` and uncached input by `17.39%`; 80% increased
  them by `18.70%` and `30.33%`.
- All arms compacted exactly once and preserved every tested fact, so this
  sample found no quality advantage from delaying the wall.
- Raw wall time favored the later walls, but the 65% and 75% arms each contained
  a separate 60–70 second non-compaction provider outlier. After excluding the
  compaction turn and each arm's largest non-compaction outlier, mean normal
  turn latency was 8.67 s / 9.54 s / 9.65 s. Treat latency as inconclusive from
  one run rather than as evidence to move the threshold.
- The benchmark model declaration must include both `limit.context` and
  `limit.input`; OpenCode's compatibility path applies `compaction.reserved`
  against the input limit. The runner also pins `PWD` to its isolated work
  directory so repository instructions do not inflate the baseline.
- Provider cache writes were not reported in this run. Re-run the same fixed
  task after model, prompt, compaction, or cache-policy changes.

### Controlled resident-description A/B

The patched sidecar replaces only the model-facing descriptions of the eleven
resident OpenCode tools with concise selection and safety summaries. Their
input schemas, validation, execution functions, permissions, and deferred-tool
behavior are unchanged. Set
`OPENCODE_COMPACT_DIRECT_TOOL_DESCRIPTIONS=0` to restore the upstream
descriptions for rollback or comparison.

The 2026-07-29 production-provider check used the same Kimi Code K3 256K model
and isolated runtime for both arms. T1 was a two-turn file task, T2 a two-turn
file plus deferred-business-tool task, and T4 a four-turn cross-domain task.
Every required file and tool behavior passed in both arms.

| Workload | First-step prompt | Total prompt before | Total prompt after | Change | Behavior |
|---|---:|---:|---:|---:|---|
| T1 | 9,197 → 5,966 | 58,346 | 32,523 | -44.26% | pass |
| T2 | 9,243 → 6,006 | 129,227 | 91,566 | -29.14% | pass |
| T4 | 9,193 → 5,955 | 193,644 | 123,020 | -36.47% | pass |

The initially visible tool serialization fell from `22,899` to `8,849` bytes
(`-61.36%`), and the first model-step prompt fell by about `35%` in all three
workloads. Wall time changed by `+36.68%`, `+0.62%`, and `+1.71%`; the T1 arm
had different cache warmth and provider latency, so this run supports a token
reduction but not a latency claim. OpenCode's uncached `input` and provider
reported `cache.read` are separate fields; do not subtract cache reads from
input when interpreting this table.

The multi-step totals above are scenario outcomes, not a pure causal estimate
for description compaction: later model searches loaded different irrelevant
candidate sets in some arms. The clean fixed-tax comparison is the identical
12-tool initial request, where tool IDs and schemas are unchanged and prompt
tokens fell by about `35%`.

### Full live-catalog reachability audit

The stricter 2026-07-29 audit reconstructed the active desktop catalog from the
live OpenCode registry and all three connected MCP namespaces. It contained
`200` unique tools:

| Source | Tools |
|---|---:|
| OpenCode and installed plugins | 144 |
| WodeApp platform MCP | 25 |
| Shopify Admin MCP | 5 |
| Feishu MCP | 26 |

The resulting exposure split was `11` direct, `187` deferred, and `2` hidden.
For every deferred tool, an exact-ID `tool_search` ranked it first; loading it
made it visible on the next step with the same description, input schema, and
execute function. There were zero structural failures.

A separate 20-scenario real-model selection check compared the upstream and
compact direct descriptions without executing tool side effects. After adding
an explicit boundary that `glob` is not an OS-wide/Spotlight search, the
upstream arm selected the expected tool in `16/20` scenarios and the compact
arm in `17/20`. Both arms still exposed long-tail behavior gaps: English search
queries can miss Chinese-only metadata, a loaded tool is not always called,
and closely related status tools can be confused. This is non-inferiority
evidence for the compact descriptions, not a claim that all natural-language
queries have perfect recall. Keep the rollback flag until those shared search
quality gaps have their own bilingual-query and repeated-sample suite.

Capability-routing system guidance remains unchanged. Its measured static text
was roughly `1.4–3.9` KiB depending on the selected pack, materially smaller
than the original resident descriptions and more tightly coupled to business
routing and safety. Revisit it only with an independent behavior suite and a
separate A/B.

Brand knowledge follows the same deferred pattern. `knowledge_search` reads
only the directory allowed by the selected runtime profile and returns top
chunks with source paths, content versions, and modification times. Knowledge
documents are never copied into the default system prompt. A missing scope
fails closed with `knowledge_scope_not_configured`; there is no demo-data
fallback.

Large/recoverable context follows one readback contract across web spill files,
knowledge sources, and compacted session history: search with `grep`/`rg`
first, then read only a bounded window (at most 120 lines or 8,000 characters),
and never `cat`/read the complete artifact into model context. Immediately
before compaction, the full reconstructable session transcript is written as
redacted JSONL under the operating-system temporary directory, outside the
workspace. Directories use mode `0700`, files use `0600`, inline `data:` media
is replaced with stubs, and common secret fields are redacted. The compaction
prompt is instructed to preserve the exact artifact path under
`Recoverable history`.

WodeApp-managed MCPs use the declarative connector registry in
`integrations/wodeapp-cloud/electron/wodeapp-provider.mjs`. Arbitrary user or
organization MCPs continue to use OpenCode's MCP configuration and extension
marketplace, and become discoverable automatically after connection.
