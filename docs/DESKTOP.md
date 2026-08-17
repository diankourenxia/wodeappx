# WodeAppX桌面端（wodeappx）

> **Last updated:** 2026-07-27
> **状态：** OpenWork fork — 唯一产品入口
> **仓库：** `wodeappx/` → 对外 `github.com/diankourenxia/wodeappx`（当前 private）

---

## 1. Product Definition

WodeAppX = 本地优先的桌面 AI 工作台；`wodeappx` 是内部技术项目与兼容标识。产品继续建立在 **OpenWork 完整桌面**（`vendor/openwork`）之上，不再维护第二套 Agent 运行时。

| Item | Source of truth |
|------|-----------------|
| 产品窗口 | `vendor/openwork/apps/desktop`（OpenWork Electron = WodeAppX窗口） |
| 外壳 / 导航 / WodeApp 业务页 | `vendor/openwork/apps/app/src/react-app/`（fork 直改，见 `vendor/openwork/WODEAPPX_FORK.md`） |
| 聊天 / 会话 / 工具 / MCP | OpenWork 原生 `SessionSurface` → `onSendDraft` → OpenCode |
| WodeApp 能力 | MCP、可选 Cloud provider、`integrations/` patch |

对话、权限、Browser、Skills、插件配置等**全部走 OpenWork 原生**，不再维护 `agent-bridge` / `OpenWorkSessionEmbed` 第二套运行时。

---

## 2. 基础能力内置状态

完整能力矩阵、OpenWork 来源标注、测试场景和后续新增流程见 [`docs/CAPABILITIES.md`](CAPABILITIES.md)。  
模型媒体输入（图/视频/PDF 是否直送、是否旁路解析）见 [`docs/MODEL_MEDIA_INPUT.md`](MODEL_MEDIA_INPUT.md)。

不依赖用户手动配置 MCP 的基础能力：

- 本地文件、命令、搜索、编辑、补丁、LSP、子任务：OpenCode/OpenWork 原生工具。
- 内置浏览器：`openwork_browser_open_url` 直连桌面 Browser Panel，后续交给 `browser_*` 自动化工具。
- App UI 控制：`openwork_ui_snapshot` / `openwork_ui_list_actions` / `openwork_ui_execute_action` 直连桌面 UI bridge。
- 系统网络/媒体捕获：`openwork_capture_start` / `status` / `list` / `clear` / `stop` / `authorize_https` 已内置为 OpenCode plugin 工具，走桌面 UI bridge，不需要启动 `openwork-ui-mcp`。
- 本地文件 / Office / PDF / 媒体：`openwork_file_extract_text` / `preview` / `media_probe` / `search` / `plan_batch` / `apply_batch` 已内置为 OpenCode plugin 工具，可查找用户/工作区文件、读取纯文本/PDF/DOCX/XLSX/PPTX、生成 macOS Quick Look 预览、读取图片/音视频 metadata，并用“先预览、再确认”的方式整理文件，不需要文档类 MCP。
- 自动任务 / 长任务：`opencode-scheduler@1.3.0` 已加入 `.opencode/package.json` 和默认 plugin 列表，随内置 OpenCode plugin 加载；工具为 `schedule_job` / `list_jobs` / `get_job` / `update_job` / `delete_job` / `run_job` / `job_logs`，底层使用系统 scheduler（macOS launchd 等），不走 MCP。WodeAppX「自动任务」页提供全局任务列表、稳定任务 ID、工作区与时区展示、下次/上次运行时间、立即运行、暂停/恢复、编辑、结果和删除；任务列表不再受当前工作目录 scope 限制。每次运行使用当前账号的 OpenCode 数据域创建独立对话，运行中和完成后均可从任务中心进入完整 transcript；旧版默认格式日志没有会话 ID 时，会按当前账号数据库中的工作区与运行时间安全回查，候选不唯一则不猜测。最终结果摘要与原始日志继续作为快速浏览和诊断入口。
- Computer Use：`openwork_screen_snapshot` / `openwork_computer_snapshot` / `click` / `type_text` / `press_key` / `scroll` / `set_value` / `perform_action` / `list_apps` / `check_permissions` 已内置为 OpenCode plugin 工具。macOS 走 HandsFree `direct` JSON-lines；Windows/Linux 走 `open-computer-use` MCP（同一套 `openwork_computer_*` 工具面）。
- 剪贴板：`openwork_clipboard_read` / `write` / `paste` 是独立短入口，底层复用 Computer Use clipboard helper。
- 真实 Chrome 用户登录态：`openwork_chrome_tab_summary` / `list_tabs` / `active_tab` / `open_url` / `activate_tab` / `close_tab` / `snapshot` / `execute_javascript` 已内置为 OpenCode plugin 工具，走 macOS Apple Events/JXA，保留用户自己的 Chrome profile，不需要 BrowserAct MCP。其中 `tab_summary` 只返回窗口/标签数量与索引，不返回标题或 URL。
- 公开互联网读取：`agent_reach_status` / `web_read` / `rss_read` / `youtube_transcript` / `bilibili_search` / `v2ex` 已内置为 Agent Reach 风格只读工具，不需要 MCP；小红书、Reddit、Facebook、Instagram、LinkedIn、Twitter 搜索等登录态平台仍必须用户显式选择真实 Chrome / OpenCLI / Cookie 路线。
- 真实聊天 sidecar：`wodeappx-capabilities-bridge.ts` 会自动把上述 `openwork_*` 本地能力接到 live OpenCode sidecar；若 sidecar 不是 WodeAppX 托管模式，会从 WodeAppX dev-data / 环境变量反推 UI bridge 和内置插件路径。

仍需要底层辅助进程的能力：

- Computer Use：macOS 依赖 HandsFree Swift helper 与 Accessibility / Screen Recording；Windows/Linux 依赖登录态桌面会话，安装包内嵌 `resources/helpers/open-computer-use(.exe)`（构建时由 `scripts/prepare-open-computer-use-helper.mjs` 从 npm 拉取）。开发态可用 `pnpm helper:open-computer-use` 或回退 `npx open-computer-use`。可用 `WODEAPPX_OPEN_COMPUTER_USE_BINARY` / `WODEAPPX_COMPUTER_USE_HELPERS_DIR` 覆盖。对外仍是 `openwork_computer_*`；Win/Linux 上 `launch_app` / clipboard 等 HandsFree 专属能力会明确报「本平台暂不支持」。MCP 入口保留为兼容 fallback。
- 真实 Chrome 工具需要 macOS 允许 WodeAppX/OpenWork 自动控制 Google Chrome；`execute_javascript` 还需要 Chrome 菜单 `View > Developer > Allow JavaScript from Apple Events`，未开启时可退回 `openwork_chrome_snapshot` + `openwork_computer_*` 视觉操作。
- `openwork_chrome_list_tabs` 的原始工具结果包含 tab title / URL；只需要数量或隐私汇总时必须优先用 `openwork_chrome_tab_summary`，避免标题/URL 进入工具 transcript。
- 文件批处理只支持 copy / move / rename / mkdir，不支持删除；执行前必须先用 `openwork_file_plan_batch` 生成预览，确认后再调用 `openwork_file_apply_batch`。
- 文件工具依赖 macOS / Unix 内置命令（`unzip`、`mdls`、`qlmanage`、`sips`、`file`、`strings`）；PDF 正文优先走 Spotlight，取不到时会给 best-effort fallback。复杂版式重排、逐页高保真渲染仍应交给专门文档工作流。
- 自动任务首次生效需要 `.opencode` 依赖已安装并重载 OpenCode runtime；调度成功后的运行记录与日志位于 scheduler 运行时 HOME 下的 `.config/opencode/scheduler` 与 `.config/opencode/logs/scheduler`。开发版与安装版共用当前账号的 `openwork-runtime-data/<accountId>` 会话、分组、配置与状态目录；仅开发辅助 HOME / cache 保留在 `openwork-dev-data`，不能假设 scheduler HOME 总是当前 macOS 用户的 `~`。定时 `opencode run` 使用同账号下的 **`scheduler-xdg/{config,data,state}`**（与 UI 的 `xdg/` 隔离），禁止与交互 sidecar 共写 `xdg/data/opencode/opencode.db`。交互 `serve` 启动前会对 UI 库做 `quick_check`，畸形则拒绝拉起（`OPENCODE_DB_MALFORMED`）。已有 launchd 任务需在新版本里重新 align / 保存一次，才会写入隔离后的 XDG env。
- 周期任务使用 5 段 cron 和系统本地时区；当前不把一次性执行伪装成周期任务。任务创建时必须显式保存绝对 `workdir`。任务中心会把已登记工作区的任务绑定到对应WodeAppX运行配置，避免后台进程丢失托管模型、MCP 与插件配置。
- 自然语言任务内容必须写入 scheduler 的 `prompt`；`command` 只允许直接可执行程序，不允许把 `bash` / `sh` / `node` / `python` 当作自然语言任务入口。WodeAppX scheduler bridge 会拒绝这类误用，避免任务创建成功但运行时立即失败。
- 涉及代码提交、推送、删除文件或对外发送的任务，创建提示必须保留用户的明确授权边界：先检查 `git status`、保留无关改动、禁止 force push；未明确授权的副作用不得补推断。

---

## 3. Dev Entry

```bash
cd wodeappx
pnpm openwork:bootstrap    # 首次
pnpm openwork:install      # 首次 / 依赖变更后
pnpm dev                   # patch + patch-cloud + openwork:dev
```

- `pnpm dev` = 幂等跑集成 patch，再启动 `vendor/openwork` 完整桌面。

Sidecar 下载慢时：

```bash
pnpm openwork:sidecar:local
pnpm openwork:dev:local-sidecar
```

---

## 4. Patch vs Fork

| 方式 | 用途 |
|------|------|
| **Fork 直改** `apps/app` | 侧栏、新路由、主题、WodeApp 专属页（`domains/wodeapp/`） |
| **`pnpm openwork:patch`** | 品牌文案、MCP/extensions 注入、Electron discovery、Cloud 登录（`patch-cloud`） |

`pnpm dev` 每次会跑 patch。**不要**在 patch 脚本覆盖的文件里做大块 UI 手改；应迁到 `domains/wodeapp/` 或更新 apply 脚本。

---

## 5. WodeApp Runtime Access

正常用户聊天**不要**从桌面壳直连 `/runtime-server/api/agent/chat`。WodeApp 能力通过：

- Platform / Project MCP
- 可选 Cloud `ai/v1` provider（`pnpm openwork:patch-cloud`）
- Skills / Commands
- OpenWork Browser Panel

侧栏 **WodeApp 项目** 快捷入口：主点击 → 新建会话并填入 sample prompt；**查看** → 在内置浏览器打开已发布站点。

WodeAppX登录或刷新账号后，主进程会用已绑定 API Key 调用 `/mainserver/api/auth/desktop-session`，把短期、httpOnly、带 `desktop_agent` 来源标记的 Cookie 写入 `persist:openwork-browser` 隔离会话。退出账号时同步清除该会话的认证 Cookie；浏览器侧不会接触 API Key 或明文 Token。

### 5.1 托管文字模型目录（单一来源 + 用户覆盖）

OpenCode sidecar 的 `wodeapp` provider 由 `apps/desktop/electron/wodeapp-managed-models.mjs` 在引擎启动时写入托管配置目录，模型目录只有一条来源链：

```
shared-components/config/wodeBrandedModels.ts   ← 唯一手工编辑入口
  → node scripts/sync-wode-branded-models.mjs   ← 生成全部副本
  → wodeapp-model-catalog.json（electron 静态兜底）
```

运行时优先级（低 → 高）：

1. 静态 catalog 兜底（离线 / 接口失败）；
2. 平台 live 模型列表缓存 `~/.wodeapp/models-live.json`（引擎启动后后台从 `/runtime-server/api/ai/models` 刷新，接口为主数据源）；
3. 用户覆盖 `~/.wodeapp/models.json`。

**新增内置模型**：改 `wodeBrandedModels.ts` → 跑 sync 脚本 → `pnpm openwork:patch`，不要在 runtime / server / UI 里手写模型表。

**用户自定义**有两条入口：

1. 桌面设置界面添加 / 授权 provider：会写入 OpenCode `auth.json`，服务端 runtime config 会在引擎重载时把这些已授权 provider 自动加入 `enabled_providers`；
2. 高级配置文件 `~/.wodeapp/models.json`：可扩展 WodeApp provider 下的模型，也可声明完整自定义 provider（重启引擎生效）。

工作台选模策略：

- **WodeApp 是供应商之一**：有平台 API Key 才启用 `wodeapp`；`~/.wodeapp/keys.json` 里的火山 / DeepSeek / OpenRouter / OpenAI / 通义同样写入引擎。默认 = 上次选中且仍已连接的模型，否则本机 Key，否则已登录的 WodeApp。登录不得把默认抢回 `wode/*`；
- 用户在设置里授权过的 **OpenAI 兼容 BYOK**（OpenRouter / DeepSeek / OpenAI 等内置目录，或 `models.json` 自定义 `@ai-sdk/openai-compatible`）与 WodeApp 出现在同一选择器，按厂商分组；
- 粘贴 API Key 时按 key 前缀 / Base URL 主机名做轻量识别（如 `sk-or-` → `openrouter`），映射到已有 OpenCode provider id，**不为每家单独写桌面 HTTP 适配器**；
- **本机配置导入（手动一键同步环境变量）**：设置「服务与模型」→「本机环境变量」；**默认不自动扫描**。用户点击后把 Claude / CC Switch / Codex 的 Key、Base URL 写入本机 OpenWork `env.json`（并挂本地引擎 auth）。**不上传云端**；OAuth/ChatGPT 无法同步；同步后可到「环境变量」应用/重启引擎；
- **生图 / 生视频 BYOK**：账号与模型页可按厂商引导填写凭证（可灵 = Access Key + Secret Key；火山方舟 ARK = 同一 Key 覆盖 Seedance 视频 + Seedream 生图；Runway / Replicate / OpenAI 图片等填对应字段）。写入 `~/.wodeapp/media-byok.json`；本机 Origin + `preferLocal` 时，runtime 把用户 Key **注入已有平台适配器**（不新建厂商客户端），并跳过平台积分；缺字段时设置页提示「还需填写：…」不允许半套保存；未配置则仍走平台 DB/env + 积分；凭证同样只存本机、不上传云端；
- **不登录执行**：已授权的本机文字 provider（OpenRouter / OpenAI / DeepSeek 等）发送时**不要求** WodeApp 登录；未登录侧栏为「本机模式」，引导「设置 → 服务与模型」。云端登录仅用于平台积分模型；
- **能力工作台（图片 / 视频 / 多模型）**：与对话同一条路——列表走 `GET /runtime-server/api/ai/models`（及 image-models / video providers），调用走 `/ai/stream`、`/ai/image/generate`、`/video/tasks`。未登录打开本机 `localhost:5176/?project=<agentId>`；已登录打开用户自己的能力项目（`https://{slug}.wodeapp.cn`），不要 yougi / ai.wodeapp.cn。对话仍本地优先。runtime 读 `~/.wodeapp/keys.json`（及旧 `media-byok.json`）在本机 sidecar 跳过积分。规范：[`LOCAL_KEY_INVOKE.md`](LOCAL_KEY_INVOKE.md)。云端 Origin 不读本机 Key；
- **First Mile 初始化引导**：无可用模型时自动弹出（可「不再自动弹出」）。步骤 = 本机模型 Key（选厂商 / 开控制台 / 粘贴）→ Chrome 扩展（可选）。能力项目在云端登录后自动创建，不进向导。默认工作区为「wodeapp（自进化）」，不再引导用户另选文件夹。账号菜单「初始化引导」；事件 `wodeapp:open-first-mile`（旧 `wodeapp:open-byok-guide` 仍打开同一向导）。逻辑：`wodeapp-first-mile.ts`；
- Runtime / 能力项目站内 AI 在本机 sidecar 上走同一套列表与调用；`keys.json` 由 sidecar 注入 env，请求时再读一次。云端 Origin 不读本机 `keys.json` / `media-byok.json`（除非请求带 byok 覆盖）。

`~/.wodeapp/models.json` 示例：

```json
{
  "default": "wode/deepseek-v4-flash",
  "models": {
    "wode/my-model": { "name": "我的模型", "vision": true }
  },
  "remove": ["wode/glm-5.2"],
  "providers": {
    "my-proxy": {
      "name": "我的代理",
      "options": { "baseURL": "https://example.com/v1", "apiKey": "sk-…" },
      "models": { "gpt-x": { "name": "GPT-X" } }
    }
  }
}
```

默认 `enabled_providers` 只放行：**已配置 Key 的本机厂商**、已登录时的 `wodeapp`、`~/.wodeapp/models.json` 里声明的 provider，以及用户在桌面设置里已经授权过的 provider。没有平台 Key 时不启用 `wodeapp`。OpenCode 内置目录不会整体暴露；用户明确添加 / 授权 / 写入 keys.json 后才显示。

### 5.2 附件上下文与长会话收敛

WodeAppX首轮仍把受控体积的图片像素或完整附件解析交给模型；会话进入空闲后，再把历史收敛为可恢复的短引用：

- 图片发送时同时落成本机路径，并优先上传为可持久的 HTTPS 商品图地址；离线时才回退到 `wodeappx-asset://`；
- 聊天历史保留图片 part 供缩略图展示，恢复扫描不再删除图片像素；裸文件名、`wodeapp://attachment/` 和未落盘的 `data:` URL 不得写入商品库；
- 长附件理解正文只有在存在可重读本地路径或 `contextRefId` 时才改写为短 stub；
- 后续需要原文、更多页或原始图片时，Agent 按精确本地路径调用文件/PDF 工具，或用 `openwork_attachment_context_read` 按 `nextOffset` 分段重读，不要求用户重复上传；
- 普通长文档使用 `openwork_file_extract_text` 的 `nextOffset` 续读；PDF 使用 `openwork_pdf_info` + `openwork_pdf_extract_text` 的 `nextStartPage` / `nextStartChar` 续读；
- 本地上下文包默认保存在 `~/.wodeappx/attachment-context-packs`，单包和总容量均受限；删除会话时同步删除该会话的上下文包，设置页可查看容量并显式清空。

素材 HTTPS 上传（`asset_save` / `product_save` → `/upload/file`）默认在入库前规范化：桌面端用 canvas（长边 ≤2048、重绘清 EXIF），服务端 sharp 作兜底；`preserveOriginal=true` 可跳过。不向 Electron 打包 sharp。

OpenCode 托管配置同时启用原生自动 compaction/prune，并限制工具输出进入历史的行数与字节数。托管模型会声明 `limit.context`（否则 OpenCode 在 context=0 时永不自动压缩）。`compaction.reserved` 约占总窗口 50%（256k → soft wall ~128k），并保留最近 4 轮与至少 8k token，避免商品 ID、shareDocId、素材标签和风格选择过早丢失。单次工具输出默认上限约 80 行 / 8KB（`Truncate.output`）。注意：上游用 `metadata.truncated !== undefined` 跳过该闸门，但 read/glob/grep 把 `truncated` 当分页标记会误逃逸；WodeAppX 改为仅当 `truncateHandled: true`（shell 自 Truncate 后设置）才跳过。WodeAppX 对 OpenCode prune 打了补丁：允许**当前回合内**清理旧工具输出（上游会跳过最近 2 个用户回合，长探索链清不掉）；`PRUNE_PROTECT/MINIMUM` 从上游 40k/20k 降到 **8k/4k**（`ses_00c083*` 离线对照：上游阈值在该会话工具量下根本不开火）；清理时写入 **结论 stub**（工具名、路径/命令等关键入参、输出头摘录 + 可重跑提示），不是空白 cleared。完整 LLM compact 仍按 Goal/Progress/Relevant Files 模板摘要。网页搜索结果默认更瘦（短 snippet、去掉 searchUrl）；`web_read` 默认 6k 内联，超限落盘到 `~/.wodeappx/web-read-packs` 供按需重读；回合 idle 后会压缩更早的 web 工具大结果（保留最近 4 次），没有 spillPath 的搜索结果仍保留标题、链接与短摘要。侧栏「压缩上下文」仍可手动触发同一套 OpenCode compact。两层机制（引擎 compact + 附件/视觉/web idle stub）都只收敛会话上下文，不删除用户原始文件。

### 5.3 飞书授权深链

已安装的WodeAppX注册 `wodeappx` 协议。外部页面可使用以下链接唤起桌面端，并在当前会话输入框上方展示飞书授权卡：

```html
<a href="wodeappx://feishu/authorize?source=download-page">在WodeAppX 中绑定飞书</a>
```

- 深链只展示待授权卡，不会立即启动 OAuth；用户点击「打开飞书授权」后才继续。
- App ID / App Secret 已配置时，桌面端复用现有 lark-mcp 授权流程，在系统浏览器打开飞书 OAuth。
- 凭证缺失时，授权卡原位切换为「配置飞书应用」；用户确认后才进入飞书 MCP 设置详情。
- 深链不得携带 App Secret、访问令牌或刷新令牌；解析器会拒绝这类链接。
- 完全免填 App Secret 的公众绑定需要 WodeApp 服务端签发短期、单次使用的安装票据，并在服务端完成 OAuth code 交换；桌面端只接收票据或绑定完成状态，不能把共享应用密钥写进网页、深链或安装包。

### 5.4 录屏验收（ops-demo-record）

桌面「真控 UI + 录屏 + 成败总结」用：

```bash
# 推荐：先准备小白隔离环境（空 config，不动 ~/.wodeapp）
cd wodeappx
pnpm ops:demo-prepare-newbie
# 按生成的 README / launch-openwork-dev.sh 启动桌面（CDP 默认 9833）

# 再录（桌面已开且 remote-debugging-port 对齐）
pnpm ops:demo-record -- --port 9833 --scenarios settings,image,cu
```

流水线硬规则：`settings` 必须演示切到**本地** `http://127.0.0.1:3000`、粘贴 API Key、探活、保存（不要停在云端 wodeapp.cn）。每个能力再「新建对话」→ CDP `Input.insertText` → **单能力单回合** → 成功/失败门禁通过再下一步 → 停录并写 `VERDICT-*.md`。生图 PASS 必须看到 URL/`image-proxy`。可选场景：`settings` / `image` / `cu` / `browser` / `plugins`。本地模式需本机 mainserver(:3000) / runtime 已起。

隔离环境变量：`WODEAPP_CONFIG_DIR`（空 `.wodeapp`）、`OPENWORK_ELECTRON_USERDATA`（空 Electron 用户目录）。

---

## 6. Related

- Busy / empty-shell hang tracing：[`docs/HANG_TRACE.md`](HANG_TRACE.md)
- Agent 执行契约（出图 headless / 视频注入+手动）：[`docs/AGENT_MINIMAL_CONTEXT.md`](AGENT_MINIMAL_CONTEXT.md)
- 能力矩阵 / 迭代手册：`docs/CAPABILITIES.md`
- Fork 边界：`vendor/openwork/WODEAPPX_FORK.md`
- 发版契约：`docs/RELEASE.md`
- Cloud 登录：`integrations/wodeapp-cloud/README.md`
- OpenCode BYOK：`integrations/opencode/README.md`
