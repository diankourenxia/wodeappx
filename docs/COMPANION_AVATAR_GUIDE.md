# 桌面陪伴「自定义新形象」制作指南

> 形象墙虚线卡片会把用户的想法预填进对话框，AI 按本指南执行。
> 用户在弹窗里只需要输入想要什么样的形象，不需要关心本文件。

## 0. 先确认方向

先给用户 2-3 个形象方向（新角色或新风格），等用户选定一个再开始生成。
如果用户的想法已经很明确（比如"一只柴犬"），可以直接确认配色风格后进入生成。

## 1. 精灵图形象（默认路径，16 帧）

### 1.1 生成姿势网格

用 gpt-image-2 普通档生成两张 1536x1024 的 2 行 × 4 列姿势网格图。
第二张必须拿第一张的 URL 做参考图（referenceImages），保证角色一致。

【网格 A（帧 1-8）提示词模板】

> 可爱卡通{角色}桌面宠物，扁平矢量贴纸风格，柔和粗描边，{主色调}，圆润造型，全身。画面是整齐的 2 行 × 4 列网格，共 8 个等大格子，每格是同一只{角色}的一个动作帧，按从左到右、从上到下顺序：1 自然待机睁眼微笑；2 待机、身体轻轻倾向另一边；3 半闭眼；4 完全闭眼；5 待机、{特征部位}向左晃；6 {特征部位}向右晃；7 一只{肢体}抬到胸前准备挥手；8 {肢体}举高挥手。8 个角色大小一致、各自居中于格子内、两两之间不越界。纯透明背景（PNG alpha），无格子线、无地台阴影、无文字、无水印。

【网格 B（帧 9-16）提示词模板】

> 参考图中的{角色}角色（保持完全相同的造型、配色、描边和风格），生成新的 2 行 × 4 列网格，共 8 个等大格子，每格是这只{角色}的一个动作帧，按从左到右、从上到下顺序：1 {肢体}收回身侧站好；2 双{肢体}举起欢呼；3 双{肢体}举起、双脚离地跳起欢呼；4 歪头卖萌；5 歪头、脸颊泛红害羞；6 趴下、前半身着地；7 蜷缩成一团睡觉；8 伸懒腰起身。8 个角色大小一致、各自居中于格子内、两两之间不越界。纯透明背景（PNG alpha），无格子线、无地台阴影、无文字、无水印。

### 1.2 合成 16 帧精灵表

帧顺序固定为：待机 / 倾身 / 半闭眼 / 闭眼 / 左晃 / 右晃 / 抬手 / 挥手 / 收手 / 欢呼 / 跳起欢呼 / 歪头 / 害羞 / 趴下 / 睡觉 / 伸展。
该顺序与 `wapp-pet-sprite-act-16` 动画编排一一对应，不要改顺序。

```bash
node wodeappx/scripts/build-companion-sprite-sheet.mjs \
  apps/app/public/companion-{id}-sprite-sheet.png 网格A.png 网格B.png \
  --columns 4 --rows 2 --frames 16 --frame 512
```

### 1.3 登记注册表

在 `integrations/openwork/wodeapp/wodeapp-companion-avatars.ts` 的
`WODEAPP_FLOAT_COMPANION_AVATARS` 里追加一条：

```ts
{ id: "{id}", kind: "sprite", label: "{中文名}", spriteSheet: "companion-{id}-sprite-sheet.png", frames: 16 },
```

同步三份镜像（`src/react-app/domains/wodeapp/`、`fork/apps/app/src/react-app/domains/wodeapp/`、
`vendor/openwork/apps/app/src/react-app/domains/wodeapp/`），把精灵表复制到
`vendor/openwork/apps/app/public/`，然后 `node scripts/apply-openwork-integration.mjs`。

## 1b. 对话框趴宠形象（探头 1×4，与桌宠分开）

趴宠挂在输入框上沿，交互/构图与可拖桌宠不同，**禁止复用站立全身桌宠表**。

### 规格

- 1×4 横条，帧序：idle 探头睁眼 → 闭眼小憩 → 探出更多看你 → 挥手
- 角色下半身在框沿以下被挡住；爪子搭在沿上
- 透明底；合成后登记到 `WODEAPP_PERCH_COMPANION_AVATARS`

```bash
node wodeappx/scripts/build-companion-sprite-sheet.mjs \
  apps/app/public/companion-perch-{id}-sheet.png 探头条.png \
  --columns 4 --rows 1 --frames 4 --frame 512
```

```ts
{ id: "perch-{id}", kind: "sprite", label: "{中文名}", spriteSheet: "companion-perch-{id}-sheet.png", frames: 4 },
```

现成示例：探头犬 / 探头猫 / 探头兔（`skin-pet-perch-sheet.png`、`companion-perch-cat-sheet.png`、`companion-perch-rabbit-sheet.png`）。

## 2. Live2D 形象（仅悬浮桌宠）


- 运行时只支持 cubism2 模型（moc，不是 moc3）。
- `WodeAppCompanionLive2D` 已支持 `modelUrl` 参数，新模型登记到注册表即可。
- 加载逻辑参考 `integrations/openwork/wodeapp/wodeapp-companion-live2d.tsx`。

## 3. 收尾（两条路径都要做）

1. 逐帧目检合成结果，有穿帮帧就重生成对应网格。
2. 走自进化门禁：快照 → 落地 → `node wodeappx/scripts/self-evolve-guard.mjs verify`；
   外观变化顺带跑 `pnpm check:skin-contrast`。
3. 保持拖动、点击展开进行中对话等现有交互不变。
4. 用户确认生效后 `version commit`。

## 4. 参考素材

- 形象注册表：`integrations/openwork/wodeapp/wodeapp-companion-avatars.ts`
- 原始生成图存档：`wodeappx/docs/examples/companion-assets/`
- 合成脚本：`wodeappx/scripts/build-companion-sprite-sheet.mjs`
- 动画 CSS：`integrations/openwork/wodeapp/wodeapp-skin-theme-align.css`（`is-frames-16` / `wapp-pet-sprite-act-16`）
