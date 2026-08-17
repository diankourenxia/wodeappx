# 发行版（Edition）与工作台壳（Shell）

> 日常只在 monorepo `wodeappx/` 开发；开源仓是导出镜像。  
> **Edition** 管发行品牌；**Skin / 行业壳** 管工作台外观与作业流。两层不要混成一个开关。

## 1. 两层模型

| 层 | 环境 / 配置 | 管什么 | 例子 |
|---|---|---|---|
| **Edition** | `WODEAPPX_EDITION` / `VITE_WODEAPPX_EDITION` | App 名、默认登录/BYOK 倾向、打包品牌文案 | `oss`（WodeAppX） |
| **Shell** | skin / industry pack / brand project | 皮肤、侧栏、资产分区、行业 playbook | `supor` · `beauty` · `classic-blue` |

苏泊尔是 **工作台壳**，不是第二个发行版：挂在 WodeAppX 上即可。

## 2. Edition 取值

| id | 产品名 | 默认倾向 |
|---|---|---|
| `oss` | WodeAppX | BYOK / 本地优先；**唯一发行品牌** |

别名：`open-source` / `wodeappx` → `oss`。旧的商业 env 名也会落到 `oss`，不再有第二套产品文案。

真相源：

- Node / Electron：`scripts/wodeapp-edition.mjs`（同步到 `fork/.../electron/wodeapp-edition.mjs`）
- Renderer：`integrations/openwork/wodeapp/wodeapp-edition.ts`

## 3. 怎么用

```bash
pnpm dev
# 或显式
pnpm dev:oss
pnpm build:oss
pnpm release:macos:oss
```

运行时也可只设环境变量（不必改代码）：

```bash
WODEAPPX_EDITION=oss VITE_WODEAPPX_EDITION=oss pnpm openwork:dev
```

`OPENWORK_ELECTRON_APP_NAME` 仍可覆盖窗口标题（测试实例 / 自进化 B 窗）。

## 4. 与旧脚本关系

- `apply-oss-product-brand.mjs`：打包后清掉 vendor 里残留的旧商业品牌字符串；会注入 `WODEAPPX_EDITION=oss`
- `export-standalone-repo.mjs`：独立开源仓导出，品牌固定 WodeAppX
- 皮肤默认仍可是 `supor`（演示壳），与 edition 无关；见 `wodeapp-skins.ts`
