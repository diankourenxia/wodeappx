# 本机 Key 调用规范（能力工作台 = 对话同一条路）

> **Last updated:** 2026-08-19
> 图片智能体 / 视频智能体 / 多模型智能体 **不得**另开一套模型表或直连厂商 HTTP。
> 列表和调用已经规范化；本文件只补「未登录时用本机 Key」这一条泳道。
> 对话引擎里 **WodeApp 只是供应商之一**：有平台 Key 才启用 `wodeapp`，本机 `keys.json` 里的火山 / DeepSeek / OpenRouter 等同样写入 OpenCode。
> 选择器按**模型族**展示；发送前匹配探测到的真实线路（原厂直连优先，其次 OpenRouter，再次 WodeApp）。没出现在该 Key 的 `/models` 里就不猜。
> 
> **2026-08-19 更新**：桌面模型列表收成**一条 OpenAI 兼容行**。BYOK keys 和本机/兼容端点共用同一条 UI 行，不再有两套并列选择器（厂商目录 vs 自定义 OpenAI 兼容）。
> 探测 GET {baseURL}/models（超时 3s，缓存 60s）。探测失败不出现在选择器里。仅成功通过。
> apiKey **不写**入 models.json providers，pack JSON，或任何提交文件。secrets 只存 keys.json。

## 1. 一条路

| 步骤 | 接口 | 谁消费 |
|------|------|--------|
| 列表 | 随包 `wode-branded-catalog.json`（最新几款文字族） | 对话选择器（默认，不拉远端） |
| | 同目录的 image/video 族 | 图片/视频工作台下拉（Seedream / 千问 Image / GPT Image 2 / Seedance / Kling / MiniMax H3 等） |
| | `GET /mainserver/api/ai/model-families`（模型族 + 供应商 + 匹配规则） | 后续：用户有自己的 Key 后再自行更新 |
| | `POST /mainserver/api/ai/model-families/match`（族 → 探测到的真实线路） | 后续：远端匹配；发送前本地仍用同规则 |
| | `GET /runtime-server/api/ai/models`（文；`?scene=copywriting` 多模型） | CopywritingSection、对话选模 |
| | `GET /runtime-server/api/image-models`（族标题；兼容 `.../api/ai/image-models`） | 图片工作台 `useRemoteModels` |
| | `GET /runtime-server/api/video/tasks/providers` | 视频工作台 |
| 调用 | `POST /runtime-server/api/ai/stream` | 多模型并行 |
| | `POST /runtime-server/api/ai/image/generate` | 图片工作台 / 对话出图工具 |
| | `POST /runtime-server/api/video/tasks` | 视频工作台 / 对话出视频工具 |

工作台只选接口返回的模型 ID，再 POST 到上表。不要在 Section 里读 `keys.json`，也不要为未登录再写一套 OpenAI SDK。

## 2. 两条泳道（runtime 判定，UI 不管登录）

```
选中的 model / provider
        │
        ├─ 本机有对应 Key（~/.wodeapp/keys.json ∪ media-byok.json）
        │     且当前 runtime 是本机 sidecar（DESKTOP_LOCAL_PROFILE / OPEN_SOURCE_MODE / loopback）
        │     → local-key：注入已有适配器，跳过平台积分
        │
        ├─ 已登录 WodeApp（cookie / API Key）
        │     → cloud：平台通道 + 积分
        │
        └─ 否则 → 401，提示去「设置 → 服务与模型」配置本机 Key（不要只写请先登录）
```

云端 Origin **不**读用户电脑上的 Key 文件，也不接受工作台把 Key 塞进请求体。

## 3. Key 从哪来

| 文件 | 用途 |
|------|------|
| `~/.wodeapp/keys.json` | 通用本机 Key（对话 / 生图 / 生视频同一份） |
| `~/.wodeapp/media-byok.json` | 旧媒体字段；读入后折成同一套 env（可灵 AK/SK、ARK、Runway…） |

`credentials.v1.json` 只放登录态，不混进调用。

本机 sidecar 启动时把 `keys.json` 写入子进程 env；runtime 请求时再读一次（贴 Key 后不必为了工作台重启 sidecar）。

## 4. 工作台 URL

未登录 / `preferLocal` / `local-only`：打开 `http://localhost:5176/?project=<agentId>`。

已登录：打开**用户自己的能力项目** `https://{slug}.wodeapp.cn`（或 `.ai`），登录后 bootstrap 创建。对话仍本地优先（本机 Key → 否则已登录 WodeApp）；runtime 项目登录后走线上。

**不要**回退 `yougi.wodeapp.cn` / `ai.wodeapp.cn/video` / `zhousiying.wodeapp.cn`，无论登不登录。

没有本机 sidecar 时工作台页会打不开——那是 [DESKTOP_LOCAL_RUNTIME](DESKTOP_LOCAL_RUNTIME.md) 态 A；对话本机 Key 仍可用。工作台需要态 B。

## 5. 不要做的事

- 三个智能体各写各的模型数组或厂商客户端
- 未登录就打开官方云工作台（必然 401，且读不到本机 Key）
- 已登录打开 yougi / ai.wodeapp.cn 官方站（应打开用户自己的能力项目）
- 把本机 Key POST 到 wodeapp.cn / wodeapp.ai
- 用登录与否切换另一套 API 路径

## 6. 换供应商自测

只开一把本机 Key，探测 `/models`、按族匹配、可选打最小真实请求：

```bash
bun wodeappx/scripts/isolate-vendor.ts --list
bun wodeappx/scripts/isolate-vendor.ts volcano
bun wodeappx/scripts/isolate-vendor.ts openrouter --invoke chat
bun wodeappx/scripts/isolate-vendor.ts replicate --invoke image
bun wodeappx/scripts/isolate-vendor.ts --all
```

默认 `--invoke none`（只探测+匹配，不烧调用）。方法：`runIsolatedVendor(vendorId)`。不打印 Key。
