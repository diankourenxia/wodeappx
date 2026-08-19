# WodeAppX — Product Hunt Launch Kit

> PH 主文案用英文。素材在 `docs/promo/product-hunt/`。  
> 仓：https://github.com/diankourenxia/wodeappx（**已 public**；正式包 `v1.0.3`）  
> 站点：https://x.wodeapp.ai/  
> 品牌：开源对外 **WodeAppX**。主句与官网一致：**Customize the agent. Mix and match models.**

---

## 0. 上线闸门（仓已 public；PH 未 Publish）

| 闸门 | 2026-08-17 晚实证 | 还差 |
|---|---|---|
| macOS `.app` 公证 | arm64 + Intel x64 均 Notarized Developer ID，挂在 `v1.0.3` | DMG 文件本身未签名（打开后跑里面的 app 即可） |
| `pnpm open-source:check` | PASS（1 warning：OpenWork 版本号与包版本不一致） | — |
| First Mile / 能力表 | 单测过；公证 arm64 包活测「你好」过 | Intel / Windows 真机 First Mile 未跑 |
| i18n 门禁 | `check-i18n-readiness` PASS | — |
| 独立仓 | public | 日常仍改 monorepo 再 export |
| 正式 `v*` Release | https://github.com/diankourenxia/wodeappx/releases/tag/v1.0.3 | 官网直链 `wodeapp.cn/downloads/wodeappx/`；不要下旧预发布 CI Mac 包 |
| Product Hunt Publish | 物料齐 | 未点 Publish |

---

## 1. Listing essentials（直接贴 PH 表单）

| Field | Copy | Limit |
|---|---|---|
| **Name** | WodeAppX | name only |
| **Tagline** | Customize the agent. Mix and match models. | 44 / 60 |
| **Alt tagline** | Local-first AI desktop. Image and video ready. | 46 / 60 |
| **Topics** | Artificial Intelligence, Open Source, Productivity | up to 3 |
| **Pricing** | Free (open source). Cloud credits optional. | — |
| **Website** | https://x.wodeapp.ai/ | — |
| **GitHub** | https://github.com/diankourenxia/wodeappx | 已 public |
| **Thumbnail** | `docs/promo/product-hunt/thumbnail-240.png` | 240×240 |
| **OG / social** | `og-1200x630.png` · `social-1600x900.png` | — |

**Do not use:** “best models”, “pick the best”, ecommerce / 电商工作台 as the lead, 苏泊尔 / 摩飞 shots, emoji in the product name.

---

## 2. Description（gallery 下 / 约 260 字）

WodeAppX is a local-first AI desktop. Customize the agent — skills, tools, skins. Mix and match models for writing, images, and video. Image and video workbenches ship ready. Your keys, no login wall. Open source, Apache-2.0.

（约 230 字符。不要写 OpenCode / OpenWork 底座。）

---

## 3. First comment（上线后第一分钟贴）

Hey Product Hunt —

I'm the maker of **WodeAppX**, an open-source AI desktop for people who want an agent they can shape, and models they can mix.

**What you can do**
- Customize the agent: skills, tools, skins
- Mix and match models: writing, image, and video on their own
- Image and video workbenches are ready — multiple models already wired
- Built-in digital assets: save once, reuse in chat
- Self-evolve: the agent can improve this product (snapshot → verify → roll back)
- Local-first: files, terminal, browser; data can stay on your machine
- Your keys. No login wall. Cloud is optional.

**Day one**
1. Download the desktop build, or `pnpm run setup && pnpm dev`
2. Local key or cloud login — both work
3. Point at a folder and ask for real work

**Links**
- Site: https://x.wodeapp.ai/
- GitHub: https://github.com/diankourenxia/wodeappx
- License: Apache-2.0

Happy to answer questions in the comments.

---

## 4. Gallery（1270×760，已导出）

| # | File | Caption |
|---|---|---|
| 1 | `01-hero-workbench.png` | Your local AI workbench. Say what you want to do. |
| 2 | `02-local-or-cloud.png` | Local key or cloud login. Ticks = what the vendor supports. |
| 3 | `03-digital-assets.png` | Digital assets — save once, reuse in chat. |
| 4 | `04-image-workbench.png` | Image workbench. Batch ready, models already wired. |
| 5 | `05-customize-skin.png` | Customize the agent — including the skin. |
| 6 | `06-video-workbench.png` | Video workbench. Storyboards and queues in one place. |

不要用带苏泊尔 / 摩飞侧栏或成图的旧会话截图。`06-agent-session.png` 已删。

---

## 5. FAQ（评论区预写）

**Is this free?**  
Yes. Apache-2.0. Optional cloud credits are separate and not required.

**Do I need a WodeApp account?**  
No. Paste a vendor key and chat. Sign-in is optional.

**How is this different from Cursor / ChatGPT desktop?**  
Those edit your project or chat in the cloud. WodeAppX is a desktop agent workbench: customize the agent, mix models, run image/video benches, keep data local. Complementary, not an IDE replacement.

**Windows / Linux?**  
CI builds exist. Windows is unsigned for now. macOS Apple Silicon is the first-class installer (notarized app inside the DMG).

**What does self-evolving mean?**  
The agent can change this product's source with snapshot → verify → rollback. It does not retrain model weights.

---

## 6. Promo video（50s，v4，中英分条）

脚本与流程：`.cursor/skills/wodeappx-promo-video/`（`SCRIPT.md` + `STORYBOARD.md`）。  
组成：`docs/promo/video/index.html`（变量 `lang=en|zh`）。  
成片：`docs/promo/wodeappx-promo-en.mp4`（PH）+ `docs/promo/wodeappx-promo-zh.mp4`。

YouTube 公开或 unlisted。PH 只吃 YouTube URL，用英文条。迭代时先改 skill 再 `npm run render:all`。

---

## 7. Launch ops

- 日：Tue–Thu，约 12:01am PT；当天要能回 12 小时评论
- 上线后立刻贴 First comment
- 同步：X / 官网 / GitHub README 链到 PH
- 不要买票；熟人只请写**用过之后**的实质评论
- Coming Soon 可提前 1–2 周收邮箱，文案：We're launching WodeAppX on Product Hunt

---

## 8. 中文备忘（国内渠道，不上 PH 表单）

- 对外名固定 WodeAppX；主句：**Agent 能自定义，模型随便搭**
- 不要电商当主定位；图、视频、建站、本地自动化
- 截图禁苏泊尔 / 摩飞
- 顺序：公证 app 已过 → 修 i18n + L4 活窗 → export → 改 public → 挂 v* → 再 Publish PH

---

## 9. Go-live checklist

- [x] Tagline 对齐官网（不用 “best models”）
- [x] Thumbnail 240 + gallery 6 张 1270×760
- [x] First comment / FAQ / 视频分镜稿
- [x] macOS app 公证实证
- [x] i18n 门禁（用户选择 → 系统语言 → English）
- [ ] L4 活桌面（渲染进程恢复后）
- [ ] export 推独立仓
- [ ] 仓改 public
- [ ] `v*` Release（公证 DMG + Win/Linux 注明 unsigned）
- [x] 50s promo v4 中英分条（`docs/promo/wodeappx-promo-en.mp4` / `wodeappx-promo-zh.mp4`；YouTube 待上传）
- [ ] 当天有人值守 12h
