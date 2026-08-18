<p align="center">
  <img src="branding/wodeappx-logo-180.png" alt="WodeAppX" width="128" />
</p>

<h1 align="center">WodeAppX</h1>

<p align="center">
  <strong>Agent 能自定义，模型随便搭。</strong><br />
  开源桌面 AI 工作台。技能、工具、皮肤按你定。写文案、出图、做视频可以各用各的模型。<br />
  图片、视频等工作台开箱即用。本地优先，数据可不出本机。本机 Key，不必先登录。
</p>

<p align="center">
  <a href="README.md">中文</a> · <a href="README.en.md">English</a> · <a href="README.ja.md">日本語</a> · <a href="README.vi.md">Tiếng Việt</a> · <a href="README.pt-BR.md">Português</a> · <a href="README.th.md">ไทย</a> · <a href="README.fr.md">Français</a> · <a href="README.ca.md">Català</a> · <a href="README.es.md">Español</a> · <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <a href="https://github.com/diankourenxia/wodeappx/releases/tag/v1.0.3"><img src="https://img.shields.io/github/v/release/diankourenxia/wodeappx?color=111111&label=release" alt="release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-111111" alt="Apache-2.0" /></a>
  <a href="https://github.com/diankourenxia/wodeappx/stargazers"><img src="https://img.shields.io/github/stars/diankourenxia/wodeappx?style=flat&color=111111" alt="stars" /></a>
</p>

<p align="center">
  <a href="https://x.wodeapp.cn/">官网</a>
  ·
  <a href="https://wodeapp.cn/chat">浏览器里试</a>
  ·
  <a href="https://github.com/diankourenxia/wodeappx/releases/tag/v1.0.3">下载 v1.0.3</a>
  ·
  <a href="https://youtu.be/__H5DZ6MjHE">推广片</a>
  ·
  <a href="AGENTS.md">给 Agent</a>
  ·
  <a href="https://x.com/wodeappai">X</a>
</p>

<p align="center">
  <a href="https://youtu.be/__H5DZ6MjHE">
    <img src="https://img.youtube.com/vi/__H5DZ6MjHE/hqdefault.jpg" alt="Watch the WodeAppX trailer" width="720" />
  </a>
</p>

<p align="center">
  <img src="https://x.wodeapp.ai/product-hunt/01-hero-workbench.png" alt="WodeAppX 工作台" width="920" />
</p>

---

## 目录

- [先这样开始](#先这样开始)
- [能做什么](#能做什么)
- [为什么是 WodeAppX](#为什么是-wodeappx)
- [下载](#下载)
- [打开后怎么用](#打开后怎么用)
- [从源码跑](#从源码跑)
- [给 Agent / 贡献者](#给-agent--贡献者)
- [常见问题](#常见问题)
- [文档](#文档)
- [License](#license)

## 先这样开始

| 路径 | 适合 | 做什么 |
|---|---|---|
| [下载桌面端](#下载) | 日常使用 | 装包 → 配本机 Key（或云端登录）→ 说话 |
| [浏览器里试](https://wodeapp.cn/chat) | 先看一眼 | 官网侧栏对话；国际站 [wodeapp.ai/chat](https://wodeapp.ai/chat) |
| [从源码跑](#从源码跑) | 改产品 / 贡献 | `pnpm run setup && pnpm dev` |

国内落地页 [x.wodeapp.cn](https://x.wodeapp.cn/) · 国际 [x.wodeapp.ai](https://x.wodeapp.ai/)。对照：[vs Cursor](https://x.wodeapp.cn/vs-cursor/) · [vs Claude Code](https://x.wodeapp.cn/vs-claude-code/) · [vs Codex](https://x.wodeapp.cn/vs-codex/)。

## 能做什么

- **自定义 Agent**：技能、工具、MCP、连接器、皮肤按你的方式组装，不被固定模板绑死
- **模型随便搭**：文字、图片、视频各用各的模型，想换就换，不锁一家
- **图片、视频开箱即用**：批量出图、分镜、图生视频已经接好；侧栏有图片 / 视频 / 短剧 / 画布 / 多模型智能体
- **数字资产随手存**：生成的图、视频一键入库，对话里直接引用
- **浏览器自动化**：Chrome 扩展在真实网页上点、读、截图，跟着提示就能用
- **技能能批量跑**：同一套流程一次跑一批；权限、成本、重试看得见
- **智能体可自进化**：工作区指向本产品源码时，Agent 能改产品本身（备份 → 验证 → 失败回滚）
- **在电脑上真正干活**：打开本地文件夹，读写文件、跑终端、控浏览器，不只是聊天
- **建站与内容可本地完成**：站点发布、素材生产走本机或自托管；云端是可选项

技能定义「能做什么」；智能体负责「怎么把它跑完」。想做什么，直接说。

## 为什么是 WodeAppX

Cursor / Claude Code / Codex 改你的仓库。WodeAppX 是桌面 Agent 工作台：自定义 Agent、模型随便搭、图/视频开箱即用，还能改产品本身。软件免费（Apache-2.0），模型费你自己控，不必先订它们的云。

- **你塑造助手，不是被助手框住** — 技能、工具、皮肤都是一等公民
- **各模态用对的模型** — 写字、出图、做视频不必挤在同一家
- **开箱就是生产线** — 图片、视频工作台已经接好，不是空壳加 Prompt
- **数据可以不外露** — 会话、文件、终端、浏览器在你的机器上；开源版无需登录即可开始
- **Key 在你手里** — 本机 Key / 自托管优先，官方云是加分项不是门槛
- **能改这个软件本身** — 自进化有快照和回滚，不是口号
- **开源可审计** — Apache-2.0，可查、可改、可二次分发

<table>
  <tr>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/05-customize-skin.png" alt="自定义皮肤" />
      <p><strong>Agent 能自定义</strong><br />技能、工具、皮肤自己组装。智能体还能改这个产品本身（备份 → 验证 → 回滚）。</p>
    </td>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/03-digital-assets.png" alt="数字资产" />
      <p><strong>数字资产</strong><br />生成的图、视频一键入库，对话里直接引用。</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/04-image-workbench.png" alt="图片工作台" />
      <p><strong>图片工作台</strong><br />批量出图已经接好，多模型换一家就能用。</p>
    </td>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/06-video-workbench.png" alt="视频工作台" />
      <p><strong>视频工作台</strong><br />分镜、图生视频、批量队列一套就能跑。</p>
    </td>
  </tr>
</table>

## 下载

正式包：[v1.0.3](https://github.com/diankourenxia/wodeappx/releases/tag/v1.0.3)（Mac 已公证）。国内镜像：[x.wodeapp.cn](https://x.wodeapp.cn/) · 国际：[x.wodeapp.ai](https://x.wodeapp.ai/)

| 平台 | 安装包 |
|---|---|
| macOS Apple Silicon | [DMG](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-mac-arm64-1.0.3.dmg) |
| macOS Intel | [DMG](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-mac-x64-1.0.3.dmg) |
| Windows x64 | [EXE](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-win-x64-1.0.3.exe) |
| Linux x64 | [AppImage](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-linux-x86_64-1.0.3.AppImage) |

打开后：本机 Key，或云端登录。不必先注册才能聊。

## 打开后怎么用

1. **本机 Key（默认）**  
   侧栏「本地」或「配置本机 Key」。DeepSeek、火山方舟、Kimi / Moonshot、通义、OpenRouter（一把 Key 出 GPT / Claude / Grok）、已接通的 OpenAI 都行。  
   也可以加一行**自定义云厂商**：名称 + Base URL + Key，按 OpenAI 兼容 `/models` 探测。  
   Key 存在本机 `~/.wodeapp/keys.json`，不会被上传到 WodeApp。

2. **Chrome（可选）**  
   能力中心装浏览器扩展，Agent 才能在真实页面上点、读、截图。可以先忽略，稍后装。

3. **云端（可选）**  
   侧栏「云端」选站点：中国大陆 [wodeapp.cn](https://wodeapp.cn/)（支付宝 / 微信），International [wodeapp.ai](https://wodeapp.ai/)（Stripe）。用系统浏览器登录。WodeApp 只是供应商之一，有平台 Key 才启用，登录不会把默认模型抢回云端。

4. **说话**  
   空会话直接说需求，或进图片 / 视频 / 数字资产 / 能力中心。选模型只显示当前这批模型族，按你已接通的 Key 匹配真实线路。

对话、生图、生视频走同一套 Key 和路由。没有对应 Key 时提示去配置，不要只写「请先登录」。

## 从源码跑

需要 Node.js 22、pnpm 9.15、Bun 1.3.9+、Go 1.23。不要用 Node 26。命令是 `pnpm run setup`，不是 `pnpm setup`。

```bash
git clone https://github.com/diankourenxia/wodeappx.git
cd wodeappx
pnpm run setup
pnpm dev
```

`pnpm run setup` 会拉桌面壳、打补丁、装依赖。生成目录 `vendor/` 不要当源码改，下次 setup 会覆盖。第一次打开：建本地工作区，配本机 Key。

贡献与门禁见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 给 Agent / 贡献者

克隆后先读 **[AGENTS.md](AGENTS.md)**（仓地图、改哪里、产品红线），再读 [docs/README.md](docs/README.md)。

| 要改什么 | 去哪 |
|---|---|
| 自有能力、本机 Key、浏览器扩展 | `integrations/`、`capture-engine/`、`scripts/` |
| 桌面界面覆盖 | `integrations/openwork/fork/`，并在 apply 脚本里登记 |
| 上游桌面壳版本 | `openwork.lock.json`（不要随手改） |

自进化是应用内、带快照的改本产品；在本仓库用编辑器改源码则直接改、热更新即可。

## 常见问题

**是 Cursor / Codex 的平替吗？**  
是，而且不止。改仓库、自定义 Agent、出图出视频、建站，都在 WodeAppX 里做。还能拿它打造自己的工作台：技能、工具、皮肤、模型自己定。自己带 Key。

**一定要登录云端吗？**  
不用。开源版自己带 Key、模型随便搭即可开始；云端是可选项。

**自进化是训练模型吗？**  
不是。指 Agent 在门禁下改本产品源码（备份 → 验证 → 回滚），不是训练权重。

**数据会离开这台电脑吗？**  
开源版本地优先：会话和文件可留在你的电脑。只有你自己接的模型 API 才会出网。云端登录不是门槛。

**技能可视化都做好了吗？**  
Skill / MCP / 工具现已可跑；完整运行图编辑与节点级编排是产品主线，持续推进。

**Windows 提示未签名？**  
当前 Windows 安装包尚未 Authenticode。Mac 已公证。可以从源码跑，或看 Releases 说明。

## 文档

| 给谁 | 文档 |
|---|---|
| 用户 / 克隆后第一份 | 本页（顶栏换语言） · [官网](https://x.wodeapp.cn/) |
| Agent / 贡献者 | [AGENTS.md](AGENTS.md) · [CONTRIBUTING.md](CONTRIBUTING.md) |
| 能力与本机 Key | [docs/CAPABILITIES.md](docs/CAPABILITIES.md) · [docs/LOCAL_KEY_INVOKE.md](docs/LOCAL_KEY_INVOKE.md) |
| 全部桌面文档 | [docs/README.md](docs/README.md) |
| 开源计划 | [docs/OPEN_SOURCE_PLAN.md](docs/OPEN_SOURCE_PLAN.md) |
| 安全 / 隐私 / 商标 | [SECURITY.md](SECURITY.md) · [PRIVACY.md](PRIVACY.md) · [TRADEMARK.md](TRADEMARK.md) |

## License

自有代码 [Apache License 2.0](LICENSE)。第三方见 [NOTICE](NOTICE) 与 [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES/)。
