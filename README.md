<p align="center">
  <img src="branding/wodeappx-logo-180.png" alt="WodeAppX" width="128" />
</p>

<h1 align="center">WodeAppX</h1>

<p align="center">
  <strong>Agent 能自定义，模型随便搭。</strong><br />
  开源桌面 AI 工作台。图片、视频等工作台开箱即用。<br />
  本地优先，本机 Key，不必先登录。
</p>

<p align="center">
  <a href="README.md">中文</a> · <a href="README.en.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/diankourenxia/wodeappx/releases/tag/v1.0.3"><img src="https://img.shields.io/github/v/release/diankourenxia/wodeappx?color=111111&label=release" alt="release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-111111" alt="Apache-2.0" /></a>
  <a href="https://github.com/diankourenxia/wodeappx/stargazers"><img src="https://img.shields.io/github/stars/diankourenxia/wodeappx?style=flat&color=111111" alt="stars" /></a>
</p>

<p align="center">
  <a href="https://x.wodeapp.cn/">官网</a>
  ·
  <a href="https://github.com/diankourenxia/wodeappx/releases/tag/v1.0.3">下载 v1.0.3</a>
  ·
  <a href="https://youtu.be/__H5DZ6MjHE">推广片</a>
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

## 能做什么

技能、工具、皮肤按你定。文字、图片、视频的模型可以各用各的。想做什么，直接说。

<table>
  <tr>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/05-customize-skin.png" alt="自定义皮肤" />
      <p><strong>Agent 能自定义</strong><br />技能、工具、皮肤自己组装，不被模板绑死。智能体还能改这个产品本身（备份 → 验证 → 回滚）。</p>
    </td>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/03-digital-assets.png" alt="数字资产" />
      <p><strong>数字资产</strong><br />生成的图、视频一键入库，对话里直接引用，不用到处找文件。</p>
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

技能定义「能做什么」；智能体负责「怎么跑完」。本机读写文件、跑终端、控浏览器，数据可不出本机。云端是可选项，不是门槛。

## 下载

正式包：[v1.0.3](https://github.com/diankourenxia/wodeappx/releases/tag/v1.0.3)（Mac 已公证）。国内镜像：[x.wodeapp.cn](https://x.wodeapp.cn/) · 国际：[x.wodeapp.ai](https://x.wodeapp.ai/)

| 平台 | 安装包 |
|---|---|
| macOS Apple Silicon | [DMG](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-mac-arm64-1.0.3.dmg) |
| macOS Intel | [DMG](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-mac-x64-1.0.3.dmg) |
| Windows x64 | [EXE](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-win-x64-1.0.3.exe) |
| Linux x64 | [AppImage](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-linux-x86_64-1.0.3.AppImage) |

打开后：本机 Key，或云端登录。不必先注册才能聊。

## 从源码跑

需要 Node.js 22、pnpm 9.15、Bun 1.3.9+、Go 1.23。不要用 Node 26。

```bash
git clone https://github.com/diankourenxia/wodeappx.git
cd wodeappx
pnpm run setup
pnpm dev
```

`pnpm run setup` 会拉桌面壳、打 WodeAppX 补丁、装依赖。第一次打开：建本地工作区，到 **设置 → 服务与模型** 配 Key。

## 文档

- [文档索引](docs/README.md)
- [开源计划](docs/OPEN_SOURCE_PLAN.md)
- [桌面能力](docs/CAPABILITIES.md)
- [贡献](CONTRIBUTING.md)
- [安全](SECURITY.md)
- [名称与 Logo](TRADEMARK.md)

## License

自有代码 [Apache License 2.0](LICENSE)。第三方见 [NOTICE](NOTICE) 与 [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES/)。
