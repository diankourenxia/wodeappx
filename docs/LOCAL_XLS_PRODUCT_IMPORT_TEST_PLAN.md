# WodeAppX 本地 `.xls` 商品入库回归测试方案

> 适用范围：本地 Office 附件、远程图片理解、能力路由、附件上下文持久化、历史压缩和商品库写入链路。
>
> 对应原始故障：用户同时上传 1 个本地 `.xls` 和 11 张 JPG，输入“解析并且总结商品信息，存到商品库”，图片可用，但本地表格读取工具没有挂载；远程附件指纹又被误当成本地 `contextRefId`，最终没有读取表格，也没有完成入库。

## 1. 测试目标

这套测试不以“助手说成功了”为通过依据，而以真实的路由、工具调用和业务返回为证据。它需要回答五个问题：

1. 附件本身能否让路由自动得到 `files + assets`，不依赖用户说出“读取文件”。
2. `.xls` 是否被真正读取，或者在暂不支持时返回明确、可恢复的失败。
3. `attachmentFingerprint` 与本地 `contextRefId` 是否彻底分离。
4. 历史压缩后能否重读正确内容，不会给 `.xls` 注入 PDF 指令。
5. 表格和 11 张图片都准备好后，是否只用本轮附件完成商品入库，并返回可核验的商品资产 ID。

## 2. 两阶段发布标准

### M1：P0 止损

M1 不要求 `.xls` 已经能解析，但必须做到：

- 自动挂载 `files + assets`。
- 模型实际调用 `openwork_file_extract_text`，不能先声称已经读过。
- `.xls` 返回结构化 `LEGACY_XLS_DEPENDENCY_MISSING`。
- 不调用任何 PDF 工具。
- 不把远程 `attachmentFingerprint` 传给 `openwork_attachment_context_read`。
- 表格未读取时不压缩掉本地附件正文，不调用 `wodeapp_product_save`。
- 最终向用户明确说明 `.xls` 未读取和可执行的转换方案，不能空 `stop`。

### M2：完整修复

M2 必须在 M1 全部通过的基础上做到：

- 打包后的桌面运行时可以读取 BIFF8 `.xls`，不能依赖开发机碰巧安装的 LibreOffice。
- 返回 3 个 sheet、单元格内容和可追溯的 sheet/row 证据。
- 表格成功后才允许调用 `wodeapp_product_save`。
- `expectedImageCount === 11`。
- `productImages` 与 `sourceProductImages` 都是本轮 11 张图片的完整持久 URL 集合；描述可以去重，但不能因此丢图片。
- 商品保存返回 `verified: true`、唯一 `assetId` 和 `productImageCount: 11`。
- 最终回答包含商品资产 ID、3 条产品线和待核验参数；不得把宣传语伪装成硬参数。

M2 是“问题已解决”的标准。只通过 M1 只能说明链路不再静默失败。

## 3. 固定测试数据

禁止把用户真实的袜子表格和图片提交到 Git。测试时生成一套确定性的脱敏附件：

### 3.1 Legacy Excel

运行时生成 `wodeappx-local-xls-product-import.xls`，明确使用 BIFF8，而不是把 `.xlsx` 改后缀。包含 3 个 sheet：

| Sheet | 唯一校验码 | 固定内容 |
|------|------------|----------|
| 精油短袜 | `SOCK-ANKLE-731` | 产品线名称、测试卖点 A |
| 精油商务中筒袜 | `SOCK-BUSINESS-842` | 产品线名称、测试卖点 B |
| 精油中筒袜 | `SOCK-MID-953` | 产品线名称、测试卖点 C |

每张表都包含相同的拍摄规格：

- 画幅：`9:16`
- 分辨率：`1080p`
- 帧率：`60`
- 字幕：`是`
- 格式：`MP4`

同时放入一条明确标记为“宣传语”的内容和一条明确标记为“硬参数”的内容，用于验证模型不会混淆字段性质。

建议用项目已经依赖的 `xlsx` 包在临时目录生成：

```js
XLSX.writeFile(workbook, filePath, { bookType: "biff8" });
```

生成后必须用文件头或解析器确认它是 CDF/BIFF8；不能只检查扩展名。

### 3.2 图片

生成 11 张 JPG，每张图内部绘制唯一校验码 `IMG-01` 至 `IMG-11`。其中可以有两张视觉内容相近，用于验证“卖点描述去重”和“源图片 URL 不丢失”是两件事。

### 3.3 用户原话

主黑盒提示固定为：

```text
解析并且总结商品信息，存到商品库，我后续要用来生成视频详情图等
```

主验收不能在提示中透露工具名、调用顺序、sheet 数量或校验码。只有主黑盒失败后，才能用指定工具名的诊断提示定位问题；诊断通过不能覆盖黑盒失败。

## 4. 自动化测试矩阵

| ID | 层级 | 场景 | 关键断言 | 门禁 |
|----|------|------|----------|------|
| ROUTE-001 | 单测 | 原始提示 + `.xls` + 11 JPG | `capabilities` 同时包含 `files`、`assets` | M1 |
| ROUTE-002 | 单测 | 用户不说“文件/xls/读取” | `openwork_file_extract_text=true`、`wodeapp_product_save=true` | M1 |
| ROUTE-003 | 单测 | `.xls` 无 PDF | `openwork_pdf_*` 均不因附件被开启 | M1 |
| REF-001 | 单测 | 远程指纹传给本地上下文工具 | 返回 `INVALID_CONTEXT_REF`，不得查本地目录 | M1 |
| REF-002 | 单测 | 合法 `ctx_...` | 能按 offset 分段读取，`hasMore/nextOffset` 正确 | M1 |
| COMP-001 | 单测 | 本地 `.xls` 尚未读取 | 不生成历史 stub，不删除原始读取提示 | M1 |
| COMP-002 | 单测 | `.xls` 已读取且可恢复 | stub 只给 Office 重读指令，不出现 PDF 指令 | M1 |
| COMP-003 | 单测 | context pack 持久化失败 | 不写“已安全保存”，不输出伪 `contextRefId` | M1 |
| XLS-001 | 工具测试 | 有效 BIFF8 `.xls` | 返回 3 个 sheet 和 3 个校验码 | M2 |
| XLS-002 | 工具测试 | 转换器不存在 | M1 返回结构化失败；M2 必须由内置能力继续成功 | M1/M2 |
| XLS-003 | 工具测试 | 损坏、加密或伪装 `.xls` | 明确错误，不输出虚构表格内容 | M1 |
| XLS-004 | 工具测试 | 超长工作簿 | 输出有上限且可用 offset/continuation 完整恢复 | M2 |
| SAVE-001 | 集成测试 | 表格读取失败 | `wodeapp_product_save` 调用次数为 0 | M1 |
| SAVE-002 | 集成测试 | 表格和图片成功 | 先 extract、后 save；保存返回 `verified: true` | M2 |
| SAVE-003 | 集成测试 | 图片少 1 张或多 1 张 | 保存被拒绝，不静默截断或混入历史图片 | M2 |
| IMG-001 | 集成测试 | 同一 11 张图两次 materialize | 不重复生成不同 URL；两组身份集合一致 | M1 |
| E2E-001 | 桌面黑盒 | 新会话上传全部附件并发送原话 | 工具顺序、表格内容、图片数和资产 ID 全部可证 | M2 |
| E2E-002 | 桌面恢复 | 重载后追问“商务中筒袜的参数呢” | 从合法上下文或精确本地路径恢复，不要求重传 | M2 |

## 5. 各层如何落地

### L0：源码与生成物一致

OpenWork 集成以 `wodeappx/integrations/openwork/` 为源，`wodeappx/vendor/openwork/` 是物化结果。任何修改后先运行：

```bash
cd wodeappx
pnpm openwork:patch
git diff --check
```

重点检查：

- 本地文件工具源：`integrations/openwork/opencode-plugins/local-file-helpers.ts`
- 路由源：`integrations/openwork/wodeapp/wodeapp-capability-routing.ts`
- 附件契约源：`integrations/openwork/wodeapp/wodeapp-attachment-intelligence.ts`
- 会话接线源：`integrations/openwork/fork/apps/app/src/react-app/shell/session-route.tsx`
- App 测试源：`integrations/openwork/tests/`
- Server 插件测试源：`integrations/openwork/fork/apps/server/src/opencode-plugins/openwork-extensions-preview.test.ts`

不得只修改 vendor 后直接验收。

### L1：路由、上下文和压缩单测

把 `ROUTE-*`、`REF-*`、`COMP-*` 放进现有测试：

- `wodeapp-capability-routing.test.ts`
- `wodeapp-chat-attachments.test.ts`

路由测试直接运行集成源；附件测试物化到 vendor 后运行：

```bash
cd wodeappx
bun test integrations/openwork/tests/wodeapp-capability-routing.test.ts
cd vendor/openwork
bun test ./apps/app/tests/wodeapp-chat-attachments.test.ts
```

这层必须直接使用原始黑盒提示和附件元数据，不能只构造已经带 `files` 的内部输入，否则会绕过真正的路由问题。

### L2：本地工具与业务写入集成测试

在 Server 插件测试中通过临时目录生成 `.xls`，直接执行注册后的 `openwork_file_extract_text`，而不是只测内部函数。这样可以同时覆盖注册、参数校验、路径授权、结果包装和错误契约。

```bash
cd wodeappx/vendor/openwork
bun test ./apps/server/src/opencode-plugins/openwork-extensions-preview.test.ts
```

商品写入使用 mock action/store，记录有序调用：

```text
openwork_file_extract_text
附件/图片解析完成
wodeapp_product_save
```

断言 save 的输入至少包括：

- `name`
- 含 3 个校验码和公共拍摄规格的 `productInfo` 或 `productProfile`
- 11 个 `productImages`
- `expectedImageCount: 11`
- 与本轮图片同集合的 `sourceProductImages`

失败分支必须证明 save 没有发生，不能只检查最终文案。

### L3：类型、构建和能力清单

```bash
cd wodeappx
pnpm test:agent-capabilities
cd vendor/openwork
pnpm --filter @openwork/app typecheck
pnpm --filter openwork-server typecheck
```

工具审计应确认 `openwork_file_extract_text` 与 `openwork_attachment_context_read` 都已注册；但“注册存在”不能替代路由测试。

### L4：打包桌面端无积分 Smoke

桌面类故障不能以源码测试代替。构建、同步到打包 App、重载并检查真实加载脚本：

```bash
node /Users/macpassword0000/.codex/skills/wodeappx-operation-test/scripts/wodeappx_smoke_test.mjs \
  --repo /Users/macpassword0000/Desktop/wodeapp \
  --full \
  --app-dist /Users/macpassword0000/Desktop/wodeapp/wodeappx/vendor/openwork/apps/desktop/dist-electron/mac-arm64/WodeAppX.app/Contents/Resources/app-dist \
  --json
```

当前打包产物名是 `WodeAppX.app`。测试助手的旧默认值仍可能指向
`我的AppX.app`，因此门禁命令必须显式传 `--app-dist`，并在报告的
`href` 中确认实际加载路径来自 `WodeAppX.app/Contents/Resources/app-dist`。

需要记录：

- `OPENWORK_ELECTRON_BUILD=1` 构建是否成功。
- 实际加载的 `./assets/app-*.js`。
- App 与 Server typecheck 结果。
- 控制台是否出现附件、上下文或脚本加载错误。
- 临时附件加入 composer 后，文件名和 11 张图片占位是否都存在。

这一层不点击发送，不消耗模型积分，也不写商品库。

附件挂载的专用 dry-run：

```bash
node wodeappx/scripts/wodeappx-local-xls-product-import-blackbox.mjs \
  --port 9823 \
  --dry-run
```

判定必须读取 `window.__openwork.slice("composer").attachments`。React 的
`onChange` 处理完成后会主动清空 `<input>`，所以此时
`input.files.length === 0` 是正常现象，不能据此判定挂载失败。测试图片也必须是
浏览器可解码的真实 JPEG；仅有 JPEG 文件头但无法解码的伪图片会让整批图片预处理
提前失败。

### L5：真实桌面黑盒

在现有 `wodeapp-attachment-parsing-matrix.flow.mjs` 增加 Legacy `.xls` 用例，并新增一个“`.xls + 11 JPG + 商品入库”专用 flow。先只跑 `.xls` 读取用例，再跑带业务写入的专用 flow：

```bash
cd wodeappx/vendor/openwork
WODEAPP_ATTACHMENT_MATRIX_CASES=11 \
  pnpm evals --flow wodeapp-attachment-parsing-matrix \
  --cdp-url http://127.0.0.1:9823
```

商品入库 flow 必须由显式环境变量或参数解锁，例如：

```bash
WODEAPPX_ALLOW_LIVE_PRODUCT_WRITE=1 node \
  wodeappx/scripts/wodeappx-local-xls-product-import-blackbox.mjs \
  --port 9823 \
  --allow-write
```

没有显式解锁时，flow 只能准备 composer 和采集路由证据，必须在发送前停止。所有 UI flow 串行执行，不能共享同一个 composer 并发运行。

复核已经完成的会话而不再次发送或写库：

```bash
node wodeappx/scripts/wodeappx-local-xls-product-import-blackbox.mjs \
  --port 9823 \
  --observe-session <session-id>
```

判定必须读取 OpenWork session snapshot 的真实工具状态，不能只在本地化 UI 文案中
搜索内部工具名。

## 6. 桌面黑盒判定

### PASS

- 能力证据显示 `files + assets`。
- 第一个本地文档读取调用使用上传 `.xls` 的精确路径。
- 没有把 `attachmentFingerprint` 当作 `contextRefId`。
- `.xls` 没有触发 `openwork_pdf_info`、`openwork_pdf_extract_text` 或 `openwork_pdf_render_pages`。
- M2 下，读取结果包含 3 个 sheet 名和 3 个唯一校验码。
- `wodeapp_product_save` 只在读取成功后发生。
- 保存结果为 `verified: true`，包含唯一 `assetId`，`productImageCount === 11`。
- 商品记录中的 11 张图来自本轮附件，不混入旧会话或历史商品图。
- 最终回答包含资产 ID，不为空，不以“已完成”代替真实返回。
- 整轮工具调用不超过 20 次。

### FAIL

- 路由里 `files=false`。
- 用远程指纹调用本地上下文工具。
- 对 `.xls` 调用 PDF 工具。
- 工具没有返回表格内容，助手却声称识别出 3 条产品线。
- 表格读取失败仍然保存商品。
- 商品图少于或多于 11 张，或者保存工具因为两次 materialize 产生不同 URL 而拒绝。
- 最终空 `stop`、只显示思考中、或没有资产 ID。
- 打包 App 加载的仍是旧脚本。

### INCONCLUSIVE

- 模型、网络、登录或积分不可用。
- 测试开始前已有 busy/retry 会话。
- App 未开放可连接的 CDP 端口。
- 只有助手文字，没有工具调用和业务返回证据。

`INCONCLUSIVE` 不能算通过。M2 承诺“内置支持 `.xls`”后，打包环境缺少转换器属于 `FAIL`，不能再记为环境问题。

## 7. 故障注入

修复后至少手动或自动注入一次：

1. 删除/隐藏系统 `soffice`：验证打包运行时仍能按产品承诺工作。
2. 让 context pack 持久化返回空：验证不写“已安全保存”。
3. 把远程指纹传给上下文工具：验证立即返回 `INVALID_CONTEXT_REF`。
4. 上传损坏 `.xls`：验证不保存商品、不伪造内容。
5. 图片改成 10 张和 12 张：验证准确计数，不扫描历史资产补齐。
6. 首轮完成后重载 App：验证追问仍能从合法上下文或精确路径恢复。
7. 强制本地文件读取超时：验证助手明确报告阶段和恢复方式，不进入无关工具循环。

## 8. 证据包

每次候选版本保留以下脱敏证据到 gitignored 测试目录：

- 路由 JSON：`capabilities`、enabled/disabled tools。
- 附件清单：文件名、MIME、大小、SHA-256，不保存用户原文件。
- 有序工具时间线：工具名、开始/结束时间、状态、错误码。
- `.xls` 提取摘要：sheet 名、row/cell 证据、校验码。
- 商品保存请求摘要：图片数量、URL 来源集合哈希。
- 商品保存响应：`verified`、`assetId`、`productImageCount`。
- 打包 App 实际加载的脚本路径。
- 失败截图、最终回答和关键控制台错误。

API Key、Authorization、Cookie、图片 base64、用户真实商品资料不得进入证据包。

## 9. 修改后的最短回归顺序

每次修改按以下顺序执行，前一层失败就停止：

1. `cd wodeappx && pnpm openwork:patch`
2. 两个 App 附件/路由单测
3. Server 本地文件工具测试
4. `test:agent-capabilities` + App/Server typecheck
5. 打包桌面 `--full` smoke
6. Legacy `.xls` 单文件 live matrix
7. 获得明确授权后，运行一次 `.xls + 11 JPG + 商品入库` live flow
8. 重载后追问一次，验证 context/compaction 恢复

最终发布结论必须明确写：

```text
M1：PASS/FAIL
M2：PASS/FAIL/INCONCLUSIVE
打包脚本：./assets/app-xxxx.js
Legacy xls：实际读取/结构化失败
商品资产 ID：有/无
商品图片数：11/实际数量
```

## 10. PR2 / M2 实施状态（代码层）

更新日期：2026-07-20

| 项 | 状态 | 说明 |
|----|------|------|
| 内置 BIFF8 解析（SheetJS，不依赖 soffice） | 已完成（代码+Server 直调） | `local-file-helpers.ts` → `extractXlsText` / `source=xls:sheetjs-biff8` |
| sheet/row/cell 证据 + offset 分段 | 已完成 | 成功响应含 `evidence.sheets[].cells`；长表用 `nextOffset` 续读 |
| 证据体积上限 | 已完成 | 首段最多返回 240 个证据单元格、单值最多 256 字符；后续 offset 不重复返回 evidence |
| `openwork_runtime_status` | 已完成 | 返回 `fileExtract.xls.available/backend/sofficeRequired` |
| 损坏 / 伪装 ZIP / 超大失败 | 已完成 | `XLS_CORRUPT` / `XLS_NOT_BIFF8` / `XLS_TOO_LARGE`，`productSaveAllowed:false` |
| 加密失败 | 已完成（检测路径） | `XLS_ENCRYPTED`；依赖解析器抛错或 FilePass 标记 |
| Server 直调回归 | 已完成 | `openwork-extensions-preview.test.ts`：有效 BIFF8、证据上限、续读和损坏/伪装/超大失败 |
| 路由禁止失败后入库（提示层） | 已完成 | files capability pack + 附件引导禁止在失败码后调用 `wodeapp_product_save` |
| 失败后入库执行层门禁 | 已完成 | 同一 session/message 内出现失败 `.xls` 后，`wodeapp_product_save` 在 UI bridge 前抛 `XLS_PRODUCT_SAVE_BLOCKED`；真实 `.app` bundle 已验证保留 recoverable/validation/data |
| 冻结锁文件安装 | 已完成 | 权威 lockfile 含 `xlsx@0.20.3`；`pnpm install --frozen-lockfile --offline` 前后哈希一致 |
| 真实 `WodeAppX.app` 目录包 | 已完成（无签名烟测包） | 包内含 BIFF8 后端、runtime status 和 `XLS_PRODUCT_SAVE_BLOCKED`；隔离实例可启动并加载 `./assets/app-570cCZ8M.js` |
| 用户原始 `.xls` 的打包插件只读验证 | 已完成 | 真实包内插件读取 3 sheets / 390 非空单元格 / 8526 字符，识别三条产品线和公共视频规格 |
| 打包 UI 附件 composer smoke | 已完成 | 隔离 `WodeAppX.app` 加载 `./assets/app-570cCZ8M.js`；原生 CDP 路径挂载 1 个 BIFF8 `.xls` + 11 个可解码 JPG，composer store 为 12/12，随后清理为 0；未发送、未写库 |
| 打包桌面黑盒 E2E-001（extract→save→11 图 verified） | **已通过** | 安装版 `./assets/app-570cCZ8M.js`；会话 `ses_0831ccdc3ffeXiDy4wBB6Y1nL2`；3 个 sheet/校验码完整，16 次工具调用，无 PDF/context 误调用 |
| 商品库 live 写入 `verified/assetId/count=11` | **已通过** | 3 个 sheet 分别保存为 3 条 `【E2E测试】` 商品；全部 `verified:true`、各有唯一 `assetId`、`productImageCount:11`，且 source/product 图片数组一致 |

**M2 门禁结论（当前）**：**PASS**。代码、Server 工具层、真实 `.app` 内的
`.xls` 只读链路、12 个附件的打包 UI 挂载链路，以及真实
extract→save 返回均已通过。

本次 live 证据：

- `files + assets` 同时开启，`openwork_runtime_status` 可见。
- 第一次 `openwork_file_extract_text` 使用精确临时上传路径，返回
  `source=xls:sheetjs-biff8`、3 sheets、60 个非空单元格。
- `SOCK-ANKLE-731` / `SOCK-BUSINESS-842` / `SOCK-MID-953` 全部命中。
- 未调用 `openwork_attachment_context_read` 或任何 `openwork_pdf_*`。
- 3 次 `wodeapp_product_save` 均在成功读取后发生；每次输入、source 与期望图片数
  都是 11，返回均为 `verified:true`。
- 资产 ID：
  `local-product-1784506990775`、
  `local-product-1784507005422`、
  `local-product-1784507019916`。
- 最终会话 `idle` / `finish=stop`，总工具调用 16 次，未超过 20 次门禁。

非 P0 后续优化：首次提取其实已经成功，但模型因 tool-output 截断提示又进行了多次
冗余分段读取，其中包含参数越界、读取无扩展名 tool-output、Quick Look 超时等失败。
不影响本次数据正确性，但应继续收敛为“首段结构化证据足够时直接入库”。

最短验证命令：

```bash
cd wodeappx
pnpm openwork:patch
pnpm --dir vendor/openwork install --frozen-lockfile
bun test integrations/openwork/tests/wodeapp-capability-routing.test.ts
cd vendor/openwork
bun test ./apps/app/tests/wodeapp-chat-attachments.test.ts
bun test ./apps/server/src/opencode-plugins/openwork-extensions-preview.test.ts
bun test ./apps/server/src/opencode-plugins/wodeapp-direct-tools.test.ts
```
