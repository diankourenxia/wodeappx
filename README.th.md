<p align="center">
  <img src="branding/wodeappx-logo-180.png" alt="WodeAppX" width="128" />
</p>

<h1 align="center">WodeAppX</h1>

<p align="center">
  <strong>ปรับแต่งเอเจนต์เอง จับคู่โมเดลได้ตามใจ</strong><br />
  เดสก์ท็อป AI โอเพนซอร์ส สกิล เครื่องมือ และสกินคุณกำหนดเอง เขียน ออกภาพ ทำวิดีโอ คนละโมเดลได้<br />
  โต๊ะภาพและวิดีโอพร้อมใช้ เน้นเครื่องคุณ กุญแจของคุณ ไม่มีกำแพงล็อกอิน
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
  <a href="https://x.wodeapp.ai/">เว็บไซต์</a>
  ·
  <a href="https://wodeapp.ai/chat">ลองในเบราว์เซอร์</a>
  ·
  <a href="https://github.com/diankourenxia/wodeappx/releases/tag/v1.0.3">ดาวน์โหลด v1.0.3</a>
  ·
  <a href="https://youtu.be/gULs1_u1JYE">ตัวอย่าง</a>
  ·
  <a href="AGENTS.md">สำหรับเอเจนต์</a>
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

## สารบัญ

- [เริ่มที่นี่](#เริ่มที่นี่)
- [ทำอะไรได้](#ทำอะไรได้)
- [ทำไมเป็น WodeAppX](#ทำไมเป็น-wodeappx)
- [ดาวน์โหลด](#ดาวน์โหลด)
- [หลังเปิด](#หลังเปิด)
- [รันจากซอร์ส](#รันจากซอร์ส)
- [สำหรับเอเจนต์ / ผู้ร่วมพัฒนา](#สำหรับเอเจนต์--ผู้ร่วมพัฒนา)
- [คำถาม](#คำถาม)
- [เอกสาร](#เอกสาร)
- [License](#license)

## เริ่มที่นี่

| ทาง | เหมาะกับ | จะเกิดอะไร |
|---|---|---|
| [ดาวน์โหลดเดสก์ท็อป](#ดาวน์โหลด) | ใช้ทุกวัน | ติดตั้ง → กุญแจในเครื่อง (หรือล็อกอินคลาวด์) → พูด |
| [ลองในเบราว์เซอร์](https://wodeapp.ai/chat) | ดูเร็ว ๆ | แชททางการที่แถบข้าง จีน: [wodeapp.cn/chat](https://wodeapp.cn/chat) |
| [รันจากซอร์ส](#รันจากซอร์ส) | แก้ผลิตภัณฑ์ / ร่วมพัฒนา | `pnpm run setup && pnpm dev` |

ไซต์: [x.wodeapp.ai](https://x.wodeapp.ai/) · จีน [x.wodeapp.cn](https://x.wodeapp.cn/) เทียบ: [vs Cursor](https://x.wodeapp.ai/vs-cursor/) · [vs Claude Code](https://x.wodeapp.ai/vs-claude-code/) · [vs Codex](https://x.wodeapp.ai/vs-codex/)

## ทำอะไรได้

- **ปรับแต่งเอเจนต์** — สกิล เครื่องมือ MCP คอนเนกเตอร์ สกิน
- **จับคู่โมเดล** — ข้อความ ภาพ วิดีโอ คนละโมเดล ไม่ล็อกผู้ขาย
- **ภาพและวิดีโอพร้อมใช้** — ชุดงาน สตอรี่บอร์ด ภาพเป็นวิดีโอต่อแล้ว; เอเจนต์ภาพ / วิดีโอ / สั้น / แคนวาส / หลายโมเดล
- **สินทรัพย์ดิจิทัล** — บันทึกภาพและวิดีโอแตะเดียว ใช้ซ้ำในแชท
- **ออโตเมชันเบราว์เซอร์** — ส่วนขยาย Chrome คลิก อ่าน และแคปเจอร์หน้าจริง
- **รันสกิลเป็นชุด** — โฟลว์เดียวกันกับชุดงาน เห็นสิทธิ์ ต้นทุน และการลองใหม่
- **วิวัฒนาการเอง** — ชี้เวิร์กสเปซไปที่ซอร์สของผลิตภัณฑ์นี้ เอเจนต์แก้แอปได้ (สแนปช็อต → ตรวจ → ย้อน)
- **ทำงานจริงบนเครื่อง** — โฟลเดอร์ ไฟล์ เทอร์มินัล เบราว์เซอร์ ไม่ใช่แค่แชท
- **ไซต์และสื่ออยู่เครื่องได้** — เผยแพร่และผลิตบนเครื่องหรือโฮสต์เอง คลาวด์เป็นทางเลือก

สกิลบอกว่าอะไรรันได้ เอเจนต์เป็นคนรัน พูดสิ่งที่อยากทำ

## ทำไมเป็น WodeAppX

Cursor / Claude Code / Codex แก้รีโปของคุณ WodeAppX คือโต๊ะเอเจนต์บนเดสก์ท็อป: ปรับเอเจนต์ จับคู่โมเดล มีโต๊ะภาพ/วิดีโอ และแก้ผลิตภัณฑ์เองได้ ซอฟต์ฟรี (Apache-2.0) จ่ายเฉพาะโมเดลที่คุณพามา ไม่มีกำแพงสมัครสมาชิก

- **คุณปั้นผู้ช่วย** — สกิล เครื่องมือ สกินเป็นพลเมืองชั้นหนึ่ง
- **โมเดลที่ถูกงาน** — ข้อความ ภาพ วิดีโอไม่ต้องใช้ผู้ขายเดียวกัน
- **สายผลิต ไม่ใช่เปล่า** — โต๊ะภาพและวิดีโอมาพร้อม
- **ข้อมูลไม่ต้องออก** — เซสชัน ไฟล์ เทอร์มินัล เบราว์เซอร์อยู่เครื่องคุณ OSS เริ่มได้โดยไม่ล็อกอิน
- **กุญแจของคุณ** — กุญแจในเครื่อง / โฮสต์เองก่อน คลาวด์ทางการเป็นของเสริม ไม่ใช่ประตู
- **แก้แอปนี้ได้** — วิวัฒนาการเองมีสแนปช็อตและย้อนกลับ
- **เปิดและตรวจได้** — Apache-2.0 ดู ฟอร์ก แจกต่อได้

<table>
  <tr>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/05-customize-en.jpg" alt="ปรับแต่งเอเจนต์" />
      <p><strong>ปรับแต่งเอเจนต์</strong><br />ประกอบสกิล เครื่องมือ และสกิน เอเจนต์แก้ผลิตภัณฑ์นี้ได้ด้วย (สแนปช็อต → ตรวจ → ย้อน)</p>
    </td>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/03-assets-en.png" alt="สินทรัพย์ดิจิทัล" />
      <p><strong>สินทรัพย์ดิจิทัล</strong><br />บันทึกภาพและวิดีโอแตะเดียว ใช้ซ้ำในแชท</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/04-image-workbench-en.jpg" alt="โต๊ะภาพ" />
      <p><strong>โต๊ะภาพ</strong><br />พร้อมงานชุด หลายโมเดลต่อแล้ว</p>
    </td>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/06-video-workbench-en.jpg" alt="โต๊ะวิดีโอ" />
      <p><strong>โต๊ะวิดีโอ</strong><br />สตอรี่บอร์ด ภาพเป็นวิดีโอ และคิวในที่เดียว</p>
    </td>
  </tr>
</table>

## ดาวน์โหลด

บิลด์ทางการ: [v1.0.3](https://github.com/diankourenxia/wodeappx/releases/tag/v1.0.3) (macOS ผ่านการรับรอง) ไซต์: [x.wodeapp.ai](https://x.wodeapp.ai/) · จีน: [x.wodeapp.cn](https://x.wodeapp.cn/)

| แพลตฟอร์ม | ตัวติดตั้ง |
|---|---|
| macOS Apple Silicon | [DMG](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-mac-arm64-1.0.3.dmg) |
| macOS Intel | [DMG](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-mac-x64-1.0.3.dmg) |
| Windows x64 | [EXE](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-win-x64-1.0.3.exe) |
| Linux x64 | [AppImage](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-linux-x86_64-1.0.3.AppImage) |

เปิดครั้งแรก: กุญแจในเครื่อง หรือล็อกอินคลาวด์ ไม่ต้องมีบัญชีก็เริ่มได้

## หลังเปิด

1. **กุญแจในเครื่อง (ค่าเริ่ม)**  
   แถบข้าง **Local** หรือ **ตั้งค่ากุญแจในเครื่อง** DeepSeek, Volcano Ark, Kimi / Moonshot, DashScope, OpenRouter (กุญแจเดียวสำหรับ GPT / Claude / Grok) และ OpenAI ที่ต่อแล้วใช้ได้  
   เพิ่ม **ผู้ขายกำหนดเอง** ได้: ชื่อ + Base URL + กุญแจ เราตรวจ `/models` ที่เข้ากันกับ OpenAI  
   กุญแจอยู่ที่ `~/.wodeapp/keys.json` บนเครื่อง ไม่ถูกอัปไป WodeApp

2. **Chrome (ไม่บังคับ)**  
   ติดตั้งส่วนขยายจากความสามารถ เพื่อให้เอเจนต์คลิก อ่าน และแคปเจอร์หน้าจริง ข้ามแล้วค่อยติดตั้งได้

3. **คลาวด์ (ไม่บังคับ)**  
   แถบ **Cloud** แล้วเลือกไซต์: International [wodeapp.ai](https://wodeapp.ai/) (Stripe) หรือจีน [wodeapp.cn](https://wodeapp.cn/) (Alipay / WeChat) ล็อกอินเปิดเบราว์เซอร์ระบบ WodeApp เป็นผู้ขายหนึ่งราย ล็อกอินไม่แย่งโมเดลเริ่มต้นกลับไปคลาวด์

4. **พูด**  
   บอกความต้องการในแชทว่าง หรือเปิด ภาพ / วิดีโอ / สินทรัพย์ / ความสามารถ ตัวเลือกโมเดลแสดงเฉพาะตระกูลปัจจุบันและจับคู่กับกุญแจที่ต่อจริง

แชท ภาพ และวิดีโอใช้กุญแจและเส้นทางเดียวกัน ถ้าขาดกุญแจ UI ให้ไปตั้งค่า ไม่ใช่แค่ให้ล็อกอิน

## รันจากซอร์ส

Node.js 22, pnpm 9.15, Bun 1.3.9+, Go 1.23 ห้ามใช้ Node 26 คำสั่งคือ `pnpm run setup` ไม่ใช่ `pnpm setup`

```bash
git clone https://github.com/diankourenxia/wodeappx.git
cd wodeappx
pnpm run setup
pnpm dev
```

`pnpm run setup` ดึงเชลล์เดสก์ท็อป ปะและติดตั้ง dependencies `vendor/` ถูกสร้างขึ้น อย่าถือเป็นซอร์ส จากนั้นสร้างเวิร์กสเปซในเครื่องแล้วใส่กุญแจ

ดู [CONTRIBUTING.md](CONTRIBUTING.md)

## สำหรับเอเจนต์ / ผู้ร่วมพัฒนา

หลังโคลน อ่าน **[AGENTS.md](AGENTS.md)** (แผนที่รีโป ที่ต้องแก้ เส้นแดง) แล้ว [docs/README.md](docs/README.md)

| จะแก้ | ที่ไหน |
|---|---|
| ฟีเจอร์ของเรา กุญแจในเครื่อง ส่วนขยายเบราว์เซอร์ | `integrations/`, `capture-engine/`, `scripts/` |
| ทับ UI เดสก์ท็อป | `integrations/openwork/fork/` ลงทะเบียนในสคริปต์ apply |
| ปักเชลล์อัปสตรีม | `openwork.lock.json` (อย่ายกง่าย ๆ) |

วิวัฒนาการเองในแอปมีประตู (สแนปช็อต → ตรวจ → ย้อน) การแก้โคลนนี้ในเอดิเตอร์เป็นการเปลี่ยนซอร์สปกติ

## คำถาม

**แทน Cursor / Codex ได้ไหม?**  
ได้ และมากกว่า ใช้ WodeAppX กับรีโป เอเจนต์ ภาพและวิดีโอ และไซต์ สร้างโต๊ะของคุณ: สกิล เครื่องมือ สกิน โมเดล พากุญแจมาเอง

**ต้องล็อกอินคลาวด์ไหม?**  
ไม่ต้อง OSS ทำงานกับกุญแจที่คุณพามา คลาวด์เป็นทางเลือก

**วิวัฒนาการเองคือฝึกโมเดลไหม?**  
ไม่ใช่ คือการแก้ซอร์สผลิตภัณฑ์นี้แบบมีประตู (สำรอง → ตรวจ → ย้อน) ไม่ใช่ฝึกน้ำหนัก

**ข้อมูลออกจากเครื่องนี้ไหม?**  
OSS เน้นเครื่องก่อน เซสชันและไฟล์อยู่เครื่องได้ มีแต่ API โมเดลที่คุณตั้งที่ออกเน็ต ล็อกอินคลาวด์ไม่ใช่ประตู

**แก้สกิลแบบภาพเสร็จหรือยัง?**  
สกิล / MCP / เครื่องมือรันได้แล้ว ตัวแก้กราฟโฟลว์อยู่ในโรดแมป

**วินโดวส์บอกตัวติดตั้งไม่เซ็น?**  
วินโดวส์ยังไม่มี Authenticode macOS ผ่านการรับรอง รันจากซอร์สหรืออ่าน Releases ได้

## เอกสาร

| ใคร | เอกสาร |
|---|---|
| ไฟล์แรกหลังโคลน | หน้านี้ (สลับภาษาที่หัว) · [เว็บไซต์](https://x.wodeapp.ai/) |
| เอเจนต์ / ผู้ร่วมพัฒนา | [AGENTS.md](AGENTS.md) · [CONTRIBUTING.md](CONTRIBUTING.md) |
| ความสามารถและกุญแจในเครื่อง | [docs/CAPABILITIES.md](docs/CAPABILITIES.md) · [docs/LOCAL_KEY_INVOKE.md](docs/LOCAL_KEY_INVOKE.md) |
| ดัชนีเดสก์ท็อป | [docs/README.md](docs/README.md) |
| แผนโอเพนซอร์ส | [docs/OPEN_SOURCE_PLAN.md](docs/OPEN_SOURCE_PLAN.md) |
| ความปลอดภัย / ความเป็นส่วนตัว / เครื่องหมาย | [SECURITY.md](SECURITY.md) · [PRIVACY.md](PRIVACY.md) · [TRADEMARK.md](TRADEMARK.md) |

## License

โค้ดต้นฉบับอยู่ภายใต้ [Apache License 2.0](LICENSE) ประกาศบุคคลที่สาม: [NOTICE](NOTICE) และ [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES/)
