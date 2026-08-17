# 测试包：标准工作台 → 萌宠柔光（自进化）

> 用途：把下面「可粘贴提示词」丢进自进化会话，并附上材料，验证 Agent 能否从**默认/标准工作台**收敛到当前已落地的 `pet-soft` 气质。  
> 成品对照：顶栏调色板选「萌宠柔光」；示意图 [`skin-mocks/skin-mock-pet-soft.png`](skin-mocks/skin-mock-pet-soft.png)。  
> 自进化底线：先读 [`.agents/skills/wodeappx-self-evolution/SKILL.md`](../../../.agents/skills/wodeappx-self-evolution/SKILL.md)。

---

## 0. 怎么测

### A. 看成品（不改代码）

1. `pnpm openwork:dev`，进工作台  
2. 顶栏调色板 → **萌宠柔光**  
3. 对照 §3 验收清单 + 示意图  

### B. 自进化回放（推荐）

1. 先切回默认皮（非 `pet-soft`）  
2. 开自进化会话，粘贴 §1 全文  
3. 把 §2 材料当作附件/路径引用交给 Agent（至少示意图 + 精灵表）  
4. Agent 按 skill：复述 → 你确认 → snapshot → 改 → verify → 你确认生效  
5. 跑 §4 门禁；对照 §3  

> 仓里若已有完整 `pet-soft`，回放时可以说「允许对照现有实现，但请按提示词独立过一遍清单，缺什么补什么」。要从零压测，先临时改名/移开 `wodeapp-skin-pet-soft.css` 等成品再测（测完还原）。

---

## 1. 可粘贴提示词（整段复制）

```text
按 wodeappx 自进化流程，把当前标准工作台进化成「萌宠柔光」示例皮肤（id: pet-soft）。
先复述方案与将改文件，等我确认后再 snapshot 动手。改完跑 verify；皮肤相关再跑对比度门禁。自己 CDP/截图验收通过后再请我看。

【目标气质】
- 奶油杏侧栏 + 暖主区 + 珊瑚 CTA，不是换一套信息架构
- 对话区有真实萌宠墙纸；右下有陪伴萌宠（真动作精灵，不是单图上下浮动）
- 侧栏品牌/最近会话用真实狗头像，禁止 CSS 渐变圆冒充
- Appearance 管深浅；皮肤只叠 token；用户可见文案禁止 emoji
- 选中会话行要过 contrast-gate（浅色轨用深字 + 浅珊瑚底，不要硬套白字深底如果皮是浅色）

【色板（参考）】
- 侧栏 #FFF5EB；主区 #FFFCF8；CTA/强调 #B84A32；墨色 #3D2A22
- 选中/hover：浅珊瑚洗（如 #F5D0C2 / #F8E0D6），文字保持深色

【布局（相对标准工作台，只做 CSS/轻量 chrome）】
1. 侧栏：大圆角奶油轨；品牌区圆形真实狗头像 +「萌宠工作台」标题
2. 主区：圆角卡片感；对话列可 max-width≈920 居中；禁止给 .wapp-workspace-main-inner 设 max-width（侧栏浏览器打开后会白条）
3. 对话背景：真图 skin-pet-chat-bg.jpg（cover），**浅洗**（高半透明叠层），会话表面透明，保证字可读；墙纸只做氛围、不要抢戏
4. 对话框上沿趴宠（与桌宠分开，勿混）：
   - **趴宠**：`pet-soft` 皮肤装饰；`skin-pet-perch-sheet.png`（设计稿杏黄贵宾犬探头 1×4：idle/sleep/watch/wave）；portal 到 composer 列、白卡片后方半身藏框；不可拖；`showSessionPanel={false}`
   - **桌宠**：`wodeappx.companion.enabled`；用户偏好形象（狗/猫/Live2D…）；右下可拖 float + 进行中面板
   - 趴宠状态：回复中 → watch；空闲偶发 peek；点击 → wave 帧
   - 透明底 + 轻 drop-shadow；根节点 pointer-events:none，仅 hit 可点
5. 导航/最近：圆形宠物头像标记（可用 avatar / avatar-2 / avatar-3）
6. CTA「新对话」：珊瑚实心圆角胶囊 + 白字

【真素材规则】
设计里有头像/背景/精灵 → 用 public 真图；禁止渐变圆假头像。
只有设计本身是视频才上视频。趴宠用 `skin-pet-perch-sheet.png`；桌宠站姿表用 `skin-pet-sprite-sheet.png` / companion-*。

【代码落点（白名单）】
- 登记：integrations/openwork/wodeapp/wodeapp-skins.ts（id pet-soft / 标签「萌宠柔光」）
- 生成色板：scripts/generate-theme-example-skins.mjs → wodeapp-skin-pet-soft.css
- 对齐布局：wodeapp-skin-theme-align.css
- 结构 chrome：wodeapp-theme-chrome.tsx（float + perch 双 portal）
- shell import：wodeapp-workbench-shell.tsx
- 静态资源：fork+vendor 的 apps/app/public/skin-pet-* （改完同步 fork 与 vendor）
- 对比度登记：scripts/lib/skin-contrast.mjs（若新增皮）

【禁止】
- 用户可见 emoji
- backdrop-filter: blur；transition: all
- 假模型验收；只报完成不自测
- 把陪伴做成单图 translateY 浮动冒充精灵
- 用桌宠形象顶替趴宠，或反过来

【验收】
1. pnpm check:skin-contrast
2. node scripts/check-skin-contrast-live.mjs --port 9823 --skin pet-soft --require
3. CDP/截图：趴宠 bg=`skin-pet-perch-sheet.png`、~156px、脸在对话框上沿清晰；桌宠仍是偏好形象且可拖
4. 宠物交互：桌宠点击气泡+进行中面板；趴宠点击切 wave；对照 `skin-mocks/live-accept/pet-soft-perch-poodle.png`
5. 打开右侧浏览器侧栏时：主区无大白条

材料路径（仓库内）：
- 示意图：wodeappx/docs/examples/skin-mocks/skin-mock-pet-soft.png
- 头像：…/skin-pet-avatar.png、skin-pet-avatar-2.png、skin-pet-avatar-3.png
- 墙纸：…/skin-pet-chat-bg.jpg
- 桌宠精灵：…/skin-pet-sprite-sheet.png（透明底 1×4）
- 趴宠精灵：…/skin-pet-perch-sheet.png（透明底 1×4 探头）
- 总览：wodeappx/docs/examples/skin-theme-evolve-examples.md
```

---

## 2. 对应材料

| 角色 | 文件 | 说明 |
|------|------|------|
| 设计示意（对照） | [`skin-mocks/skin-mock-pet-soft.png`](skin-mocks/skin-mock-pet-soft.png) | 成品气质目标；假 SaaS 整页，不必 1:1 复刻信息架构 |
| 品牌头像 | [`skin-mocks/skin-pet-avatar.png`](skin-mocks/skin-pet-avatar.png) | 侧栏品牌圆图；运行时拷到 `public/` |
| 会话圆标 | [`skin-pet-avatar-2.png`](skin-mocks/skin-pet-avatar-2.png) / [`skin-pet-avatar-3.png`](skin-mocks/skin-pet-avatar-3.png) | 最近/导航多宠标记 |
| 对话墙纸 | [`skin-mocks/skin-pet-chat-bg.jpg`](skin-mocks/skin-pet-chat-bg.jpg) | 对话区 cover 背景 |
| 动作精灵 | [`skin-mocks/skin-pet-sprite-sheet.png`](skin-mocks/skin-pet-sprite-sheet.png) | 透明底 1×4：idle / blink / wave / tilt |
| 旧单帧（勿当精灵） | `skin-pet-sprite.png` | 仅历史单图；陪伴必须用 sheet |
| 色板 JSON | [`skin-theme-palettes.json`](skin-theme-palettes.json) → `pet-soft` | 生成器输入 |
| 活体参考截图 | [`skin-mocks/live-accept/`](skin-mocks/live-accept/) | 近期自测裁剪（可选对照） |

运行时放置（改皮时同步两边）：

```text
wodeappx/integrations/openwork/fork/apps/app/public/skin-pet-*.{png,jpg}
wodeappx/vendor/openwork/apps/app/public/skin-pet-*.{png,jpg}
```

源码真相源优先改：

```text
wodeappx/integrations/openwork/wodeapp/
```

再 sync → fork + vendor（活体读的是 vendor）。

---

## 3. 人工一眼验收

| # | 看什么 | 通过标准 |
|---|--------|----------|
| 1 | 调色板 | 有「萌宠柔光」，点选立即变皮 |
| 2 | 侧栏 | 奶油底；品牌是真狗头，不是纯色圆 |
| 3 | CTA | 珊瑚按钮、白字，对比够 |
| 4 | 对话区 | 能看见萌宠墙纸，字仍可读 |
| 5 | 陪伴位 | 在对话列右下；透明底；会眨眼/招手/歪头 |
| 6 | 不割头 | 头顶完整；右侧不被白边/浏览器栏切掉 |
| 7 | 浏览器侧栏 | 打开后主区最右无大块白条 |
| 8 | 文案 | 无用户可见 emoji |

---

## 4. 命令门禁

```bash
cd wodeappx
pnpm check:skin-contrast
node scripts/check-skin-contrast-live.mjs --port 9823 --skin pet-soft --require --screenshot \
  --out docs/examples/skin-mocks/live-accept/pet-soft-evolve-test.png
```

可选：CDP 看精灵是否真切帧（`background-position` 至少 2 个值，`transform: none`）。

---

## 5. 与「已落地成品」的关系

当前仓库**已经**具备可切换的 `pet-soft`。本测试包是：

- 给自进化 Agent 的**标准意图说明书**（提示词 + 材料）  
- 给你回归/回放的检查表  

不是第二套换皮引擎。四套示例总览仍见 [`skin-theme-evolve-examples.md`](skin-theme-evolve-examples.md)。
