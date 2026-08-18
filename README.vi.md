<p align="center">
  <img src="branding/wodeappx-logo-180.png" alt="WodeAppX" width="128" />
</p>

<h1 align="center">WodeAppX</h1>

<p align="center">
  <strong>Tùy biến agent. Ghép mô hình tùy ý.</strong><br />
  Desktop AI mã nguồn mở. Skill, công cụ, giao diện do bạn định. Viết, ra ảnh, làm video mỗi việc một mô hình.<br />
  Bàn làm việc ảnh và video dùng được ngay. Ưu tiên máy bạn. Key của bạn. Không tường đăng nhập.
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
  <a href="https://x.wodeapp.ai/">Trang chủ</a>
  ·
  <a href="https://wodeapp.ai/chat">Thử trên trình duyệt</a>
  ·
  <a href="https://github.com/diankourenxia/wodeappx/releases/tag/v1.0.3">Tải v1.0.3</a>
  ·
  <a href="https://youtu.be/gULs1_u1JYE">Trailer</a>
  ·
  <a href="AGENTS.md">Cho agent</a>
  ·
  <a href="https://x.com/wodeappai">X</a>
</p>

<p align="center">
  <a href="https://youtu.be/gULs1_u1JYE">
    <img src="https://img.youtube.com/vi/gULs1_u1JYE/hqdefault.jpg" alt="Watch the WodeAppX trailer" width="720" />
  </a>
</p>

<p align="center">
  <img src="https://x.wodeapp.ai/product-hunt/en/01-workbench-en.jpg" alt="WodeAppX workbench" width="920" />
</p>

---

## Mục lục

- [Bắt đầu](#bắt-đầu)
- [Làm được gì](#làm-được-gì)
- [Vì sao WodeAppX](#vì-sao-wodeappx)
- [Tải về](#tải-về)
- [Sau khi mở](#sau-khi-mở)
- [Chạy từ mã nguồn](#chạy-từ-mã-nguồn)
- [Cho agent / người đóng góp](#cho-agent--người-đóng-góp)
- [Câu hỏi](#câu-hỏi)
- [Tài liệu](#tài-liệu)
- [License](#license)

## Bắt đầu

| Đường | Phù hợp | Việc làm |
|---|---|---|
| [Tải desktop](#tải-về) | Dùng hàng ngày | Cài → gắn Key máy (hoặc đăng nhập mây) → nói |
| [Thử trên trình duyệt](https://wodeapp.ai/chat) | Xem nhanh | Chat chính thức ở thanh bên. Trung Quốc: [wodeapp.cn/chat](https://wodeapp.cn/chat) |
| [Chạy từ mã nguồn](#chạy-từ-mã-nguồn) | Sửa sản phẩm / đóng góp | `pnpm run setup && pnpm dev` |

Trang: [x.wodeapp.ai](https://x.wodeapp.ai/) · Trung Quốc [x.wodeapp.cn](https://x.wodeapp.cn/). So sánh: [vs Cursor](https://x.wodeapp.ai/vs-cursor/) · [vs Claude Code](https://x.wodeapp.ai/vs-claude-code/) · [vs Codex](https://x.wodeapp.ai/vs-codex/).

## Làm được gì

- **Tùy biến agent** — skill, công cụ, MCP, connector, giao diện
- **Ghép mô hình** — chữ, ảnh, video mỗi loại một mô hình; không bị khóa nhà
- **Ảnh và video dùng ngay** — hàng loạt, phân cảnh, ảnh-sang-video đã nối; agent ảnh / video / short / canvas / đa mô hình
- **Tài sản số** — lưu ảnh, video một chạm; dùng lại trong chat
- **Tự động hóa trình duyệt** — tiện ích Chrome bấm, đọc, chụp trang thật
- **Chạy skill theo lô** — cùng một luồng cho một tập; quyền, chi phí, thử lại nhìn thấy
- **Tự tiến hóa** — workspace trỏ vào mã nguồn sản phẩm này; agent có thể sửa chính app (snapshot → kiểm → rollback)
- **Làm việc thật trên máy** — thư mục, tệp, terminal, trình duyệt — không chỉ chat
- **Site và media có thể ở lại máy** — xuất bản và sản xuất trên máy hoặc tự host; mây là tùy chọn

Skill định nghĩa việc gì chạy được; agent chạy nó. Nói bạn muốn làm gì.

## Vì sao WodeAppX

Cursor / Claude Code / Codex sửa repo của bạn. WodeAppX là bàn làm việc agent trên desktop: tùy biến agent, ghép mô hình, ảnh/video sẵn, còn sửa được chính sản phẩm. Phần mềm miễn phí (Apache-2.0). Bạn chỉ trả mô hình mình mang theo. Không tường thuê bao.

- **Bạn tạo hình trợ lý** — skill, công cụ, giao diện là công dân hạng nhất
- **Đúng mô hình cho từng việc** — chữ, ảnh, video không phải chung một nhà
- **Dây chuyền, không vỏ rỗng** — bàn ảnh và video đã sẵn
- **Dữ liệu có thể không lộ** — phiên, tệp, terminal, trình duyệt trên máy bạn; OSS bắt đầu không cần đăng nhập
- **Key trong tay bạn** — Key máy / tự host trước; mây chính thức là thêm, không phải cổng
- **Có thể sửa chính app này** — tự tiến hóa có snapshot và rollback
- **Mở và kiểm được** — Apache-2.0; xem, fork, phân phối lại

<table>
  <tr>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/05-customize-en.jpg" alt="Tùy biến agent" />
      <p><strong>Tùy biến agent</strong><br />Lắp skill, công cụ, giao diện. Agent còn sửa được chính sản phẩm (snapshot → kiểm → rollback).</p>
    </td>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/03-assets-en.png" alt="Tài sản số" />
      <p><strong>Tài sản số</strong><br />Lưu ảnh và video một chạm. Dùng lại trong chat.</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/04-image-workbench-en.jpg" alt="Bàn ảnh" />
      <p><strong>Bàn ảnh</strong><br />Sẵn cho hàng loạt. Nhiều mô hình đã nối.</p>
    </td>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/06-video-workbench-en.jpg" alt="Bàn video" />
      <p><strong>Bàn video</strong><br />Phân cảnh, ảnh-sang-video và hàng đợi một chỗ.</p>
    </td>
  </tr>
</table>

## Tải về

Bản chính thức: [v1.0.3](https://github.com/diankourenxia/wodeappx/releases/tag/v1.0.3) (macOS đã công chứng). Trang: [x.wodeapp.ai](https://x.wodeapp.ai/) · Trung Quốc: [x.wodeapp.cn](https://x.wodeapp.cn/)

| Nền tảng | Bộ cài |
|---|---|
| macOS Apple Silicon | [DMG](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-mac-arm64-1.0.3.dmg) |
| macOS Intel | [DMG](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-mac-x64-1.0.3.dmg) |
| Windows x64 | [EXE](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-win-x64-1.0.3.exe) |
| Linux x64 | [AppImage](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-linux-x86_64-1.0.3.AppImage) |

Lần mở đầu: Key máy hoặc đăng nhập mây. Không cần tài khoản để bắt đầu.

## Sau khi mở

1. **Key máy (mặc định)**  
   Thanh bên **Local** hoặc **Cấu hình Key máy**. DeepSeek, Volcano Ark, Kimi / Moonshot, DashScope, OpenRouter (một Key cho GPT / Claude / Grok) và OpenAI đã nối đều dùng được.  
   Có thể thêm **nhà cung cấp tùy chỉnh**: tên + Base URL + Key; chúng tôi dò `/models` tương thích OpenAI.  
   Key nằm ở `~/.wodeapp/keys.json` trên máy. Không tải lên WodeApp.

2. **Chrome (tuỳ chọn)**  
   Cài tiện ích từ Trung tâm năng lực để agent bấm, đọc, chụp trang thật. Có thể bỏ qua rồi cài sau.

3. **Mây (tuỳ chọn)**  
   Thanh **Cloud**, chọn site: International [wodeapp.ai](https://wodeapp.ai/) (Stripe) hoặc Trung Quốc [wodeapp.cn](https://wodeapp.cn/) (Alipay / WeChat). Đăng nhập mở trình duyệt hệ thống. WodeApp chỉ là một nhà cung cấp. Đăng nhập không cướp mô hình mặc định về mây.

4. **Nói**  
   Nói nhu cầu trong chat trống, hoặc mở Ảnh / Video / Tài sản / Năng lực. Bộ chọn chỉ hiện các họ mô hình hiện tại và khớp với Key bạn đã nối.

Chat, ảnh và video cùng một bộ Key và đường đi. Thiếu Key thì bảo cấu hình — không chỉ bảo đăng nhập.

## Chạy từ mã nguồn

Node.js 22, pnpm 9.15, Bun 1.3.9+, Go 1.23. Đừng dùng Node 26. Lệnh là `pnpm run setup`, không phải `pnpm setup`.

```bash
git clone https://github.com/diankourenxia/wodeappx.git
cd wodeappx
pnpm run setup
pnpm dev
```

`pnpm run setup` kéo shell desktop, vá và cài phụ thuộc. `vendor/` là thư mục sinh ra — đừng coi là mã nguồn. Sau đó tạo workspace máy và gắn Key.

Xem [CONTRIBUTING.md](CONTRIBUTING.md).

## Cho agent / người đóng góp

Sau khi clone, đọc **[AGENTS.md](AGENTS.md)** (bản đồ kho, sửa chỗ nào, ranh giới), rồi [docs/README.md](docs/README.md).

| Việc sửa | Chỗ |
|---|---|
| Tính năng riêng, Key máy, tiện ích trình duyệt | `integrations/`, `capture-engine/`, `scripts/` |
| Lớp UI desktop | `integrations/openwork/fork/`, đăng ký trong script apply |
| Pin shell upstream | `openwork.lock.json` (đừng nâng tùy tiện) |

Tự tiến hóa trong app có cổng (snapshot → kiểm → rollback). Sửa clone này trong editor là thay đổi mã nguồn bình thường.

## Câu hỏi

**Đây có phải bản thay Cursor / Codex?**  
Có — và hơn thế. Dùng WodeAppX cho repo, agent tùy biến, ảnh và video, và site. Làm bàn của bạn: skill, công cụ, giao diện, mô hình. Mang Key của bạn.

**Bắt buộc đăng nhập mây?**  
Không. OSS chạy với Key bạn mang. Mây là tuỳ chọn.

**Tự tiến hóa có phải huấn luyện mô hình?**  
Không. Là sửa mã nguồn sản phẩm này có cổng (sao lưu → kiểm → rollback), không phải huấn luyện trọng số.

**Dữ liệu có rời máy này?**  
OSS ưu tiên máy. Phiên và tệp có thể ở lại máy. Chỉ API mô hình bạn cấu hình mới ra mạng. Đăng nhập mây không phải cổng.

**Chỉnh skill bằng hình đã xong chưa?**  
Skill / MCP / công cụ đã chạy. Chỉnh đồ thị luồng nằm trên lộ trình.

**Windows báo bộ cài chưa ký?**  
Windows chưa Authenticode. macOS đã công chứng. Có thể chạy từ mã nguồn hoặc đọc Releases.

## Tài liệu

| Đối tượng | Tài liệu |
|---|---|
| File đầu sau clone | Trang này (đổi ngôn ngữ ở đầu) · [Trang chủ](https://x.wodeapp.ai/) |
| Agent / người đóng góp | [AGENTS.md](AGENTS.md) · [CONTRIBUTING.md](CONTRIBUTING.md) |
| Năng lực và Key máy | [docs/CAPABILITIES.md](docs/CAPABILITIES.md) · [docs/LOCAL_KEY_INVOKE.md](docs/LOCAL_KEY_INVOKE.md) |
| Mục lục desktop | [docs/README.md](docs/README.md) |
| Kế hoạch mã mở | [docs/OPEN_SOURCE_PLAN.md](docs/OPEN_SOURCE_PLAN.md) |
| Bảo mật / riêng tư / thương hiệu | [SECURITY.md](SECURITY.md) · [PRIVACY.md](PRIVACY.md) · [TRADEMARK.md](TRADEMARK.md) |

## License

Mã gốc theo [Apache License 2.0](LICENSE). Thông báo bên thứ ba: [NOTICE](NOTICE) và [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES/).
