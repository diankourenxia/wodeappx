# UI 对比度门槛与验收

> **Last updated:** 2026-08-03  
> **标准：** WCAG 2.2 AA

## 硬门槛

| 类型 | 最小对比度 |
|------|------------|
| 正文 / 侧栏主文案（含选中/hover） | **4.5:1** |
| 大标题（≥18pt 或 ≥14pt bold） | 3:1 |
| 图标 / 边框 / 控件轮廓 | 3:1 |

## 为什么要分层

静态色对不够：CSS 写了 `color:#FFF`，仍可能被上游更具体选择器盖掉（实测：选中会话行酒红底 + 暗字）。  
所以验收分三层，缺一层都不能宣称皮肤「稳定」。

## 三层门禁

| 层 | 命令 | 查什么 |
|----|------|--------|
| **A 静态色对** | `pnpm check:skin-contrast` | 登记 FG/BG（含 interactive）是否 AA |
| **A CSS 结构** | 同上 | 选中态必须带 `contrast-gate:active-recent`，并对 `.wapp-recent-item *` 强制浅色 |
| **B 活体 CDP** | `pnpm check:skin-contrast:live` | 计算样式真实对比度；可加 `--screenshot` |
| **C 单测** | `bun test tests/wodeapp-skin-contrast.test.ts` | 合约 + 反例（暗底暗字必须 FAIL） |

```bash
cd wodeappx
pnpm check:skin-contrast
pnpm check:skin-contrast:live -- --screenshot --require   # 桌面端需开着（CDP 9823/9223）
pnpm check:skin-contrast:all                              # A + B(--require --screenshot)
```

自进化 `verify`：始终跑 A；若本机 CDP 可达则再跑 B（不过则 FAIL）。

## 实现约束

1. 用户可见文字用**实色 hex**，禁止 `rgba` 当主文案色。
2. 装饰层 `opacity ≤ 0.35`，不得压过文字。
3. 新皮肤先登记 `scripts/lib/skin-contrast.mjs` 色对 + structure rules，再写 CSS。
4. 选中/hover 会话行必须强制后代浅色（marker：`contrast-gate:active-recent`），尤其覆盖 `.wapp-recent-title`。
5. 活体门禁必须采样 `.wapp-recent-row.is-active .wapp-recent-title`，不能只采样外层 `.wapp-recent-item`（外层可能已是白字、标题仍是暗色）。
6. 改皮肤后 A+B 都过，才可请用户「生效」。
7. **Appearance × 品牌皮**：Appearance（`html[data-theme=light|dark]`）管深浅；品牌皮只管语义 token（accent / CTA / 侧栏气质）。品牌皮不得写死浅色底覆盖深色。苏泊尔试点：light + dark 色对都登记；dark 块 marker `contrast-gate:supor-dark`。

## 自定义工作台 / 品牌皮改动规则（后续自改必遵）

> 适用：新增/改品牌皮肤、行业整机皮、自进化改壳层外观。  
> 模型：**Appearance 管深浅，皮肤叠品牌**——不是「皮肤替代深浅色」。

### 契约

| # | 规则 | 反例（禁止） |
|---|------|--------------|
| 1 | 表面色、正文色、边线进 CSS 变量（如 `--*-pearl / --*-ink / --*-panel`） | 组件里散落 `#fff` / `bg-white` 当主区底 |
| 2 | 深色只覆写 token：`html[data-theme="dark"] .wapp-skin-<id> { … }` | 另写一整套不共享变量的暗色 CSS |
| 3 | CTA / 选中条：实色 fill + 白字，深浅同对比度门槛 | 深色用半透明橙底 + 暗字 |
| 4 | 工作台壳层禁止硬写浅色底：`session-page` 用 `bg-transparent`，由皮肤/token 上色 | `wodeappWorkbench ? "bg-white"` |
| 5 | 必须盖住常见浅色泄漏点：`.wx-runtime-card`、`.shrink-0.px-0.pb-2.pt-2`（composer 条）、composer 卡片 | 只改侧栏，主区/输入条仍白 |
| 6 | 登记 light + dark 色对到 `scripts/lib/skin-contrast.mjs`；dark 块加 `contrast-gate:<id>-dark` | 只验浅色就宣称完成 |
| 7 | 活体必须截图验收：`--skin <id> --theme dark --screenshot --require`，并人工/Agent 看图 | 只跑静态 PASS |
| 8 | 开发版改 `integrations/openwork/wodeapp/*.css` 后同步到 **vendor** 才热更新 | 只改 fork/源副本，界面仍旧 |
| 9 | 若品牌强制浅色展览：皮肤声明 `preferredColorScheme: "light"` 并进壳时锁定，勿 silently 坏深色 | 深色下半套浅色皮 |
| 10 | **Ambient 皮**（透明 `main` + 视频/实景）：PASS 须含会话**助手正文 / 工具摘要 / 链接**活体对比或截图像素 ≥4.5；`check:skin-contrast:live` SKIPPED ≠ 过；窄探针（倍速/折叠）不得冒充「能用」 | 只测侧栏 token 或 `playbackRate` 就报 PASS |

### 最短验收清单

```bash
cd wodeappx
# A 静态（含 dark 色对）
pnpm check:skin-contrast
# B 深色活体 + 截图（桌面 CDP，常见 9823）
node scripts/check-skin-contrast-live.mjs \
  --port 9823 --skin <id> --theme dark --screenshot --require
# 看图：侧栏 / 主区 / 输入条 / 账户卡 不得整块发白
# Ambient：另采 assistant prose / tool muted / link，或跑 scripts/accept-ambient-chat-readable.mjs
# 可选：CDP 扫视口下半 lum>0.55 的大面应为空（或仅允许已知 CTA 橙）
```

### 当前覆盖

- 皮肤：`beauty`（浅色）、`supor`（浅色 + Appearance 深色）；ambient 批：`aurora-night` / `forest-mist` / `coffee-loft` / `noir-jazz`（会话可读见 `wodeapp-skin-ambient-chat-readable.css`）
- 活体采样含：CTA、侧栏 title/meta、breadcrumb、账户卡、composer-strip、选中 recent **item + title**
- 深色活体示例：`node scripts/check-skin-contrast-live.mjs --skin supor --theme dark --screenshot --require --port 9823`
