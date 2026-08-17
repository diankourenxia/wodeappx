# 模型媒体输入（附件是否直送 / 是否旁路解析）

> **真相源**：`integrations/openwork/wodeapp/wode-branded-catalog.json` 的 `capabilities` + 可选 `mediaInput`  
> **解析**：`wodeapp-model-media-input.ts`（只读 catalog，无平行硬编码表）  
> **消费方**：附件闸门 + `session-route.tsx`  
> **Last updated:** 2026-07-22

## 规则

| 模式 | 含义 | WodeApp 识图旁路 |
|------|------|------------------|
| `native` | 多模态 content / file part 直送 | 否 |
| `file_api` | 厂商 Files API | 否 |
| `extract` | 本地工具 / 附件理解先抽 | 是 |
| `unsupported` | 吃不了 | 是（或拒绝） |

**默认（不写 `mediaInput`）**

- `capabilities` 含 `vision` → 图/视频 `native`，PDF/Office `extract`，允许公网图 URL  
- 否则 → 图/视频 `unsupported`，PDF/Office `extract`

**仅在默认不对时** 在 catalog 该模型下加 `mediaInput` 覆盖（如 MiniMax PDF=`file_api`、Kimi `remoteImageUrl:false`、Kimi Code `k3-256k` 的 `video:unsupported`）。

**Kimi Code 视频升档**：本轮有视频且当前模型是 `wode/kimi-code-k3-256k` 时，发送前自动切到 `wode/kimi-code-k3`（官方表：256k 无 video_in；同窗口 `k3` 约 2× 配额）。实现：`adaptKimiCodeModelForVideoInput`。

## 会话图片与历史压缩

- 本轮聊天图片会注册为 `candidateImages`，每张使用稳定的 `img_XX`；保存到商品库或图片库时传 `selectedImageIds`，两类资产共用同一套 ID 和上传路径。
- 模型可见的 `type:file` 图片 URL 只允许 `https://` 或 `data:`。`file://` 只用于桌面 UI 展示；会话空闲压缩时必须改写为 HTTPS 或文本占位，不能把本机路径继续作为模型媒体输入。
- **视频 / 音频禁止写入会话 `data:` file part**（对齐 Cursor/Codex：本机路径 + 工具 / 附件理解）。catalog 里 `video: "native"` 不表示可以把整段视频 base64 进 transcript。
- **落盘目录统一为 `~/.wodeappx/session-media`**（`WODEAPPX_SESSION_MEDIA_ROOT`；旧名 `session-artifacts` / `WODEAPPX_SESSION_ARTIFACTS_ROOT` 仍作别名）。event/part 只留 `file://` + mime/filename；启动维护与 PERF-05 写入共用此根。
- **`prompt.resolvePart` 禁止把 A/V/PDF 再内联成 `data:`**（含 mime 错误但扩展名是 `.mp4` 的情况）。
- **非图片附件 chat file part ≤ 512KB**（`CHAT_NON_IMAGE_FILE_PART_MAX_BYTES`）。OpenCode 会把 `file://` PDF/Office 内联成 `data:application`；超过阈值走占位 + 本地 PDF/Office 工具，即使 catalog `pdf: "native"`。
- **发送侧 mime 必须 provider-safe**（对齐 OpenWork #3079）：`text/xml` / `application/json` / csv 等重映射为 `text/plain`；zip/二进制不发 model-facing file part（靠路径笔记 / 工具）。禁止把不安全 mime 写入可重放会话历史。
- 附件 attach 可接受任意类型，但 **保留客户端 size cap**（勿学上游取消上限）。
- 新一轮上传会重置“本轮候选”集合，但同一会话里已经持久化的图片 ID 仍可通过其 HTTPS、本地副本或像素缓存继续解析。

## 维护

1. 新模型只改 `wode-branded-catalog.json`（能力 + 必要时 `mediaInput`）。  
2. 不要在 TS 里再抄一张模型表。  
3. 改完跑 `wodeapp-model-media-input.test.ts`、`wodeapp-chat-attachments.test.ts`、`wodeapp-product-save-imageid.test.ts` 与 `wodeapp-vision-file-scheme-scrub.test.ts`。
