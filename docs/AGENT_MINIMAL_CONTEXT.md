# WodeAppX（wodeappx）Agent 最小信息包

> Agent 执行 WodeApp 能力时，**只需以下三层信息**。数据走 API/集合同步；页面是展示与**人工确认**载体，不是唯一数据通道。

## 执行模式分轨（重要）

| 类型 | Agent 能否自动执行 | 原因 |
|------|-------------------|------|
| **批量商品出图** | 可以 headless | 单张成本低、可预览、失败可重试 |
| **数据驱动商品视频** | 可以 headless | 商品库数据/商品图/文案由 HyperFrames 编排；是否使用由 Agent 根据任务判断 |
| **多分镜视频 / 成片** | **不可以** — 只注入数据 | 积分高、耗时长、批量误跑风险大 |
| **单条短视频** | 可以 `video_generate`（用户意图明确时） | 范围可控 |

**视频分镜正确流程：** WodeAppX桌面端（内部 codename wodeappx）直接调用一次 `openwork_ui_execute_action(actionId: "wodeapp.video_storyboard.open")`；该动作的参数定义已包含当前 `scenes[]` / `subjects[]` 契约，并负责 sync `pvs_video_shares` 与打开工作室。外部 MCP 客户端自行组装 payload 时，才先读取 `product_video_storyboard_capability`。两条路径最终都由**用户在工作台里手动点生成**。

**素材标签是精确引用，不是语义别名：** 复用数字资产时，先把资产原名原样写入 `subjects[].name`，不要自创简称；这个 `name` 是唯一引用键。`scene.prompt` 中的 `[标签]` 必须逐字等于它，型号、空格和标点都要保留。只有命中的 `subject.imageUrl` 才会进入该段视频参考图。

```json
{
  "subjects": [
    { "name": "阿尔法蛋 S1", "type": "prop", "imageUrl": "https://.../product.png" },
    { "name": "阿尔法蛋 S1 卡通讲解角色参考图", "type": "character", "imageUrl": "https://.../character.png" }
  ],
  "scenes": [
    {
      "prompt": "[阿尔法蛋 S1 卡通讲解角色参考图]站在[阿尔法蛋 S1]旁边，指向机身按键"
    }
  ]
}
```

错误写法是 `"[卡通角色]介绍[智能设备]"`：这两个标签都不等于 `subjects[].name`，因此对应参考图不会被绑定。

**禁止：** 用 `update_page` / `publish_project` 把分镜写进页面 JSON 后只给裸 `launchUrl`；交付链接必须带 `?shareDoc=<docId>`（`wodeapp.video_storyboard.open` 返回的 `taskUrl`）。

## 1. 鉴权（登录一次）

| 字段 | 来源 |
|------|------|
| `apiKey` | 官网登录后 `POST /mainserver/api/auth/desktop-bootstrap`，或 builder **/api-skills** |
| `origin` | `https://wodeapp.cn` / `https://wodeapp.ai` |
| `abilityProjects[]` | `POST /mainserver/api/auth/wodeappx-bootstrap` |

请求 runtime API 时带：`X-API-Key` + `x-subdomain-project`（slug 或 projectId）。

## 2. 能力契约（按需拉取）

| 能力 | MCP 发现 | 执行 |
|------|----------|------|
| 批量商品出图 | `product_visual_batch_image_capability` | **`product_visual_batch_image_run`** 或 `POST /v1/product-visual/run` |
| 数据驱动商品视频 | WodeAppX内置 `wodeapp_video_template_render` | **HyperFrames HTML → Chrome + FFmpeg**；支持 per-product 与 `outputMode:"single"`，由 Agent 按任务选择 |
| 多分镜视频 | 外部 MCP：`product_video_storyboard_capability`；WodeAppX：动作参数定义 | **仅注入** + `wodeapp.video_storyboard.open` |
| 单图 | `ai_generate_image` | MCP 直调 |
| 单视频 | `video_generate` | MCP 直调（单条） |
| 本地图片编辑 | OpenCode 内置 `image_inspect`/`image_crop`/`image_resize`/`image_rotate_flip`/`image_collage`/`image_composite` | 本地确定性处理，不消耗积分，不要用生图工具替代 |
| 本地语音输入 | macOS Swift helper（`local-speech`） | 系统语音识别直转文字，无需云端 ASR 配额 |
| UI 动作 | `openwork_ui_list_actions` / `openwork_ui_execute_action` | 内置动作队列串行执行，Agent 不必自行并发控制 |

- **会话图片绑定**：对话上传图统一出现在 `candidateImages`，用其中的 `img_XX` 作为 `selectedImageIds` 调用 `wodeapp.product.save` 或 `wodeapp.image_asset.save`；候选不超过 12 张且省略 ID 时可自动全选，超过 12 张必须只询问一次并让用户选择。`productImages`、`expectedImageCount`、`sourceProductImages` 仅保留旧调用兼容，不是新流程主路径。
- **分镜 videoRef 合并**：同一分镜重试/重生成时结果通过 `scene.videoRefs[]` 合并（由工作台完成，按 `id`/`taskId`/`url` 去重），不要新建 shareDoc 或 `pvs_*` 记录；切换激活版本用 `scene.activeVideoId`；scene `id` 以持久化记录为准，不要被归一化输入里的 `id: undefined` 覆盖。

## 3. 数据同步 vs 页面职责

| 动作 | 数据 | 页面 |
|------|------|------|
| 批量出图 | `POST /v1/product-visual/run` 直接返回 URL；sync `pv_visual_tasks` | 默认在第三栏打开任务链接（`showUi:false` 可仅对话交付） |
| 分镜视频 | sync `pvs_video_shares` → `?shareDoc=pvs_xxx`；**同一项目复用 shareDocId 原地 PUT 更新** | **必须打开**让用户确认并手动生成 |
| 短剧剧本 | 聊天交付或 sync 剧本集合 | `wodeapp.short_drama.open` 编辑 |

短链只用 `?shareDoc=<docId>`（`pvi_*` 出图任务、`pvs_*` 分镜视频）；禁止 URL 内联大 JSON。**同一视频项目只保留一个 shareDoc**；修配置/补 subjects/换资产时传 `shareDocId` 更新同一记录，单镜重试走 `videoRefs`（工作台改参），不要新建 vN 整包。

## 验收清单

- [ ] 商品出图可走 headless，对话直接展示 `![...](url)`
- [ ] 多分镜视频：Agent 只注入 + 打开工作室，**不**自动批量 `video_generate`
- [ ] 批量出图默认在第三栏打开任务链接；仅当 `showUi:false` 时可不开工作室
- [ ] 分镜视频打开工作室后，由用户手动触发生成
