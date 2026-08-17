# 外观自进化示例（萌宠 / 可爱风 / 水墨）

> **定位：** 三套**已落地可切换**示例皮肤 + 可复制自进化提示词。不是主题引擎；市场互通以后再说。  
> **入口：** 工作台顶栏调色板 → 选择皮肤；或输入 `/自进化`（英文 `/evolve`）进入自进化流程；也可粘贴下方提示词继续改。  
> **门禁：** `pnpm check:skin-contrast`；活体 `check:skin-contrast:live --skin <id>`。  
> **生图气质参考：** [`skin-mocks/`](skin-mocks/)（设计示意，非运行时资源）。  
> **调色板源：** 改 `scripts/generate-theme-example-skins.mjs` 后重跑生成 CSS。  
> **萌宠完整测试包（提示词 + 材料 + 验收）：** [`pet-soft-self-evolve-test-pack.md`](pet-soft-self-evolve-test-pack.md)。  
> **乙女向设计包（侧栏标题用「蔷薇工作台」，选择器标签「蔷薇日记」）：** [`otome-diary-design-pack.md`](otome-diary-design-pack.md)。  
> **已下线：** `coser-stage` / `biz-slate`（示意依赖独立中栏或经营台假面板，CSS 皮撑不起风格化，已移除）。

| id | 标签 | 布局差异（不只换色） | 气质图 |
|----|------|----------------------|--------|
| `pet-soft` | 萌宠柔光 | 圆角轨 + 居中对话列 + 右下动作精灵 | [skin-mock-pet-soft.png](skin-mocks/skin-mock-pet-soft.png) |
| `ink-book` | 水墨书卷 | 宣纸侧栏 + **书案砚台外景** + 打开书本主区 + **对话进左右书页、满页翻下一开** | [skin-ink-desk-bg.jpg](skin-mocks/skin-ink-desk-bg.jpg) / [skin-ink-paper-bg.jpg](skin-mocks/skin-ink-paper-bg.jpg) |
| `cute-pastel` | 可爱马卡龙 | 宽软轨 + 顶丝带 + 胶囊按钮 | [skin-mock-cute-pastel.png](skin-mocks/skin-mock-cute-pastel.png) |
| `otome-diary` | 蔷薇日记 | 蔷薇书桌外景 + **左右双帅浅洗舞台** + 中缝日记折痕；侧栏纸卡（非萌宠大圆角）；对象可后续自定义 | [skin-otome-chat-duo.jpg](skin-mocks/skin-otome-chat-duo.jpg) |

---

## 0. 代码落点

| 目的 | 路径 |
|------|------|
| 登记 / 预览色 | `integrations/openwork/wodeapp/wodeapp-skins.ts` |
| 样式（生成） | `wodeapp-skin-<id>.css` |
| 生成器 | `scripts/generate-theme-example-skins.mjs` |
| shell import | `wodeapp-workbench-shell.tsx` |
| 对比度 | `scripts/lib/skin-contrast.mjs` |

Appearance 管深浅；皮肤叠 token。选中会话行必须 `contrast-gate:active-recent` + 白字。禁止用户可见 emoji。

---

## 1. 提示词（继续自进化时用）

**萌宠 `pet-soft`：** 用完整测试包（勿只用这一句）：[`pet-soft-self-evolve-test-pack.md`](pet-soft-self-evolve-test-pack.md)。摘要：奶油杏侧栏、珊瑚 CTA、真狗头像、对话墙纸（浅洗）、会话列内 1×4 动作精灵；保持 AA。

**水墨 `ink-book`：** 宣纸侧栏、朱砂 CTA、印章品牌图；对话按高度装进左右书页；翻页用纸页卷曲（开源 [StPageFlip](https://github.com/Nodlik/StPageFlip) 已评估，库在 `vendor/page-flip`；因 HTML 模式会拆 React 消息树暂用稳定 curl）；保持 AA。

**可爱 `cute-pastel`：** 薄荷绿侧栏、粉白主区、桃色 CTA；马卡龙圆角。

**乙女向 `otome-diary`（对外名蔷薇日记）：** 用完整设计包 [`otome-diary-design-pack.md`](otome-diary-design-pack.md)。摘要：蔷薇奶油侧栏、蔷薇 CTA、**默认帅哥**立绘；侧栏标题「蔷薇工作台」（勿对用户写「乙女」）；花纹墙纸浅洗。

也可说：「按自进化流程微调 pet-soft / cute-pastel / ink-book / otome-diary」。

---

## 2. 验收（已对齐后再请人看）

门禁：

```bash
cd wodeappx
pnpm check:skin-contrast                          # 静态 AA + CSS 结构
node scripts/check-skin-contrast-live.mjs --port 9823 --skin pet-soft --require
node scripts/check-skin-contrast-live.mjs --port 9823 --skin ink-book --require
node scripts/check-skin-contrast-live.mjs --port 9823 --skin cute-pastel --require
node scripts/check-skin-contrast-live.mjs --port 9823 --skin otome-diary --require
```

活体截图（对照 mock）：`docs/examples/skin-mocks/live-accept/`。

对齐说明（相对示意图）：

| 皮 | 已对齐 | 示意图多出来、本期未做 |
|----|--------|------------------------|
| 萌宠 | 奶油外框、真实狗头像、多宠会话圆标、对话萌宠背景（浅洗）、**对话框趴宠（设计稿贵宾犬探头表 `skin-pet-perch-sheet.png`，半身藏框后）**与**可拖桌宠（偏好选的狗/Live2D 等）**分开、暖色 CTA、浅珊瑚选中、**右侧工具轨同色** | 独立中栏历史；陪伴位短视频循环可选后续 |
| 水墨 | 宣纸侧栏、朱砂 CTA、印章品牌、书案外景、对话进左右书页 + 纸页卷曲翻页、**右侧工具轨宣纸色**；翻页仅「上一开/下一开」（滚轮不翻页，避免与页内超长条滚动打架） | 真毛笔笔触；把对话 DOM 完整交给 StPageFlip HTML 模式 |
| 可爱 | 薄荷绿圆角侧栏、真实马卡龙品牌图、桃色 CTA/选中、**右侧工具轨薄荷绿** | 三栏（nav\|history\|chat） |
| 乙女/蔷薇 | 蔷薇书桌外景、左右双帅对话舞台浅洗、中缝折痕、侧栏纸卡、默认帅哥品牌/趴框、右侧工具轨同色 | 真翻页书页（水墨专属）；多对象包 UI |

**真素材规则：** 设计里有、且对得上能力的，用真媒体落地——静物/头像/背景走生图资源（`public/skin-*.png`），不要用渐变圆冒充；只有设计本身是动效/视频时才走视频。

示意图是完整 SaaS 假界面；本机仍是 WodeAppX 工作台 DOM，结构差靠 CSS + classic 右栏逼近，不是换了一套产品信息架构。

---

## 3. 商店 / 市场（以后）

现在：官方示例皮肤 + 提示词。以后：用户可分享「皮肤包」（CSS + 登记片段 + 预览图），安装仍过对比度门禁——流通层，不是第二套换皮引擎。
