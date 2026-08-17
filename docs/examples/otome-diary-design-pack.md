# 设计包：乙女日记（`otome-diary`）

> **状态：** 已落地可切换（顶栏调色板 → 蔷薇日记）。色板 + 素材 + 陪伴规格见下文。  
> **气质示意：** [`skin-mocks/skin-mock-otome-diary.png`](skin-mocks/skin-mock-otome-diary.png)  
> **默认对象：** **帅哥立绘**；侧栏标题用「蔷薇工作台」，**勿**对用户写「乙女日记」。  
> **素材：** 趴框/桌宠须真 RGBA 透明底（禁棋盘格假透明）。

---

## 1. 色板

| Token | Light | 用途 |
|-------|-------|------|
| `sidebar` | `#FFF0F5` | 侧栏蔷薇奶油 |
| `pearl` | `#FFFCF9` | 主区象牙 |
| `panel` | `#FFF6F9` | 卡片 / composer |
| `ink` | `#3A2430` | 正文 |
| `secondary` | `#6A4A58` | 次要字 |
| `accentDeep` | `#B04568` | CTA / 新对话 / 发送（AA 加深） |
| `accent` | `#DB6B8A` | 浅强调 |
| `accentHover` | `#963A58` | CTA hover |
| `onAccent` | `#FFFFFF` | CTA 上白字 |
| `scroll` | `#E0B8C4` | 滚动条 |
| 选中行底（落地 CSS） | `#F8D4DE` | 浅粉洗，**深字**（勿硬套白字深底） |
| 细金描（装饰，可选） | `#C9A46A` | 品牌头像细环 / lace 线，非主对比色 |

Dark：侧栏 `#22181E`，强调 `#FF9BB4`，正文 `#FFE8F0`（见 `skin-theme-palettes.json` → `otome-diary`）。

生成器已登记：`scripts/generate-theme-example-skins.mjs`（`layout: "pet"`，复用圆角轨 + 居中对话列）。

---

## 2. 布局（对标水墨「舞台感」，刻意区别萌宠）

1. 外壳：蔷薇书桌外景 `skin-otome-desk-bg.jpg`（水墨书桌同构），主区透明露底  
2. 侧栏：纸卡圆角（约 12px），不是萌宠大胶囊轨  
3. 对话舞台：左右独立帅哥 **动画 WebP**（`skin-otome-stage-*.webp`，Seedance 2.0 素材转 8fps/360w，`<img>` 循环；禁双路 video + mix-blend）；静态 PNG 作 reduced-motion / 无素材兜底；中间高半透明保证字可读  
4. 中缝：session-surface 竖向淡折痕（装饰，非翻页）  
5. `prefers-reduced-motion: reduce` 时改用静帧 PNG，不播动画 WebP  
6. CTA「新对话」：蔷薇实心圆角方钮 + 白字  
7. 右侧工具轨：同侧栏奶油粉 token  
8. 用户可见文案禁止 emoji；Appearance 管深浅，皮肤只叠 token  
9. 侧栏标题「蔷薇工作台」（勿写「乙女」） 

---

## 3. 陪伴位规格（趴框 ≠ 桌宠）

与萌宠相同双轨：

| 角色 | 谁控制 | 素材 | 行为 |
|------|--------|------|------|
| **趴框对象** | 皮肤装饰（`otome-diary` 开启 perch） | `skin-otome-perch-sheet.png` | portal 到 composer 上沿；不可拖；无「进行中」面板 |
| **桌宠对象** | `wodeappx.companion.*` 用户偏好 | 默认可用 `skin-otome-sprite-sheet.png` 登记为 companion；或用户自选 | 右下可拖 float |

### 3.1 趴框精灵 `skin-otome-perch-sheet.png`

| 项 | 规格 |
|----|------|
| 布局 | 透明底 **1×4** 横条：`idle` / `sleep` / `watch` / `wave` |
| 角色 | 默认帅哥（褐发风衣）；半身探头，下半截藏在 **真实 composer 白卡片后**（素材内勿烤死白底栏） |
| 运行时尺寸 | 对标萌宠约 **156px** 高；`top` 使脸在框沿上方清晰可见 |
| 情绪 | 回复中 → `watch`；空闲偶发 peek/`sleep`；点击 → `wave` |
| 交互 | 根 `pointer-events:none`，仅 hit 可点 |

落地前目检：四帧角色一致、透明底、无格子线；若生图带了白栏需裁掉再合成。

### 3.2 桌宠精灵 `skin-otome-sprite-sheet.png`

| 项 | 规格 |
|----|------|
| 布局 | 透明底 **1×4**：`idle` / `blink` / `wave` / `tilt`（可后续扩到 companion 16 帧流程） |
| 角色 | 与趴框同一默认帅哥全身上半身贴纸风 |
| 登记 | 落地时进 `wodeapp-companion-avatars.ts`（如 `otome-default`） |

### 3.3 头像 / 会话圆标

| 文件 | 角色 | 用途 |
|------|------|------|
| `skin-otome-avatar.png` | 褐发风衣（默认对象） | 侧栏品牌 + AI 气泡头像 |
| `skin-otome-avatar-2.png` | 黑发冷系 | 最近会话 / 导航圆标轮换 |
| `skin-otome-avatar-3.png` | 银灰温柔 | 同上 |
| `skin-otome-stage-left.webp` | 冷系黑发帅 · Seedance→动画 WebP（~297KB, 8fps） | 对话列左侧轻量氛围 |
| `skin-otome-stage-right.webp` | 温柔风衣帅 · Seedance→动画 WebP（~329KB, 8fps） | 对话列右侧轻量氛围 |
| `skin-otome-stage-left.png` | 左帅静帧 | reduced-motion / 无动画兜底 |
| `skin-otome-stage-right.png` | 右帅静帧 | reduced-motion / 无动画兜底 |
| `skin-otome-chat-duo.jpg` | 左右双帅合成稿 | 设计参考；运行时改用左右独立图 |
| `skin-otome-desk-bg.jpg` | 蔷薇书桌外景 | 外壳背景 |
| `skin-otome-chat-bg.jpg` | 淡牡丹水彩（旧） | 可选氛围兜底 |

全部须 **真图**，禁止 CSS 渐变圆冒充。

---

## 4. 材料清单

| 角色 | 路径 |
|------|------|
| 整页示意 | `skin-mocks/skin-mock-otome-diary.png` |
| 品牌头像 | `skin-mocks/skin-otome-avatar.png` |
| 会话圆标 | `skin-otome-avatar-2.png` / `skin-otome-avatar-3.png` |
| 墙纸 | `skin-otome-chat-bg.jpg` |
| 趴框 1×4 | `skin-otome-perch-sheet.png` |
| 桌宠 1×4 | `skin-otome-sprite-sheet.png` |
| 色板 | `skin-theme-palettes.json` → `otome-diary` |

运行时落地同步：

```text
fork/apps/app/public/skin-otome-*
vendor/openwork/apps/app/public/skin-otome-*
```

---

## 5. 自定义对象（后续）

本期默认一套帅哥；自定义对齐现有陪伴体系，不新开引擎：

1. **换官方对象包**：多套 `avatar + perch-sheet + sprite-sheet`（冷系 / 温柔 / 银发…），皮肤选择器或陪伴墙点选  
2. **用户自建**：走 [`COMPANION_AVATAR_GUIDE.md`](../COMPANION_AVATAR_GUIDE.md)（网格生图 → `build-companion-sprite-sheet` → 登记）  
3. **趴框跟随**：用户换 companion 后，`otome-diary` perch 优先用当前对象的 perch 表；无则回退默认褐发  

皮肤壳（色板 / 蕾丝线 / 墙纸）与对象包解耦。

---

## 6. 落地白名单（确认后再动）

- 登记：`wodeapp-skins.ts`（`otome-diary` / 「乙女日记」）  
- CSS：`generate-theme-example-skins.mjs` → `wodeapp-skin-otome-diary.css` + `wodeapp-skin-theme-align.css`  
- perch：`wodeapp-theme-chrome` / prefs 对 `otome-diary` 开趴框（对标 `pet-soft`）  
- 对比度：`scripts/lib/skin-contrast.mjs`  
- `pnpm check:skin-contrast` + live `--skin otome-diary --require`  

---

## 7. 可粘贴自进化提示词（落地时用）

```text
按 wodeappx 自进化流程，把工作台进化成「乙女日记」示例皮肤（id: otome-diary）。
先复述方案与将改文件，等我确认后再 snapshot。对照 docs/examples/otome-diary-design-pack.md。

【目标】蔷薇奶油侧栏 + 象牙主区 + 蔷薇 CTA；默认帅哥立绘（品牌/会话圆标/趴框/桌宠）；对话花纹墙纸浅洗；Appearance 管深浅；禁 emoji；选中行浅粉底深字。
【结构】复用 pet layout（圆角轨 + composer 趴框）；趴框≠桌宠；真素材 skin-otome-*，禁止渐变圆。
【验收】check:skin-contrast + live --skin otome-diary；CDP 看 perch sheet 与脸在框沿。
```
