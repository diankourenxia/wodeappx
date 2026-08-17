#!/usr/bin/env python3
"""Paint English chrome onto the existing high-quality promo stills."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "docs/promo/video/assets"
FONT = "/System/Library/Fonts/Hiragino Sans GB.ttc"


def fnt(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT, size, index=1 if bold else 0)


def box(draw: ImageDraw.ImageDraw, xy, fill) -> None:
    draw.rectangle(xy, fill=fill)


def txt(draw: ImageDraw.ImageDraw, xy, s, size, fill, bold=False) -> None:
    draw.text(xy, s, font=fnt(size, bold), fill=fill)


def paint_sidebar(im: Image.Image, *, skin: str = "pastel") -> None:
    draw = ImageDraw.Draw(im)
    side_bg = im.getpixel((36, 80))
    # text column, keep icons
    box(draw, (44, 8, 228, 748), side_bg)
    title = "Macaron" if skin == "pastel" else "Ink book"
    title_c = (90, 40, 55) if skin == "pastel" else (90, 28, 28)
    txt(draw, (58, 58), title, 13, title_c, bold=True)
    btn = (120, 36, 48) if skin == "pastel" else (110, 28, 32)
    draw.rounded_rectangle((52, 84, 216, 118), 10, fill=btn)
    txt(draw, (78, 93), "New chat", 13, (255, 255, 255), bold=True)
    draw.rounded_rectangle((52, 126, 216, 154), 8, fill=(255, 228, 232) if skin == "pastel" else (255, 236, 232))
    txt(draw, (64, 133), "Default agent", 12, (70, 30, 40), bold=True)

    items = [
        (168, "Image agent", "Shots · heroes · batch"),
        (208, "Video agent", "Clips · i2v · queue"),
        (248, "Short drama", "Scripts · boards"),
        (288, "Canvas", "Nodes · keep going"),
        (328, "Multi-model", "Run and compare"),
        (380, "Digital assets", ""),
        (416, "History", "By type"),
        (452, "Automations", ""),
        (488, "Capabilities", ""),
    ]
    ink = (40, 28, 32)
    muted = (120, 100, 108)
    for y, a, b in items:
        txt(draw, (64, y), a, 12, ink, bold=True)
        if b:
            txt(draw, (64, y + 16), b, 10, muted)
    box(draw, (48, 520, 228, 720), side_bg)
    txt(draw, (58, 530), "PROJECTS", 10, muted)
    txt(draw, (64, 548), "wodeapp (self-evolve)", 11, ink)


def paint_first_mile() -> Path:
    raise RuntimeError("Do not paint first-mile. Run compose-promo-en-chrome.py")


def _unused_paint_first_mile() -> Path:
    im = Image.open(ASSETS / "ph-first-mile.png").convert("RGB")
    draw = ImageDraw.Draw(im)
    paint_sidebar(im, skin="pastel")

    # topbar crumbs + language
    top_bg = im.getpixel((280, 18))
    box(draw, (248, 4, 820, 42), top_bg)
    txt(draw, (260, 14), "wodeappx  /  Default agent", 12, (90, 90, 96))
    box(draw, (900, 4, 1266, 48), im.getpixel((1200, 18)))
    txt(draw, (1148, 16), "English", 12, (70, 70, 76))
    # hide leftover hero Chinese behind the modal
    box(draw, (250, 200, 330, 420), im.getpixel((260, 300)))
    box(draw, (1000, 200, 1260, 520), im.getpixel((1100, 300)))

    # one clean modal — cover the whole card so labels cannot stack
    white = (255, 255, 255)
    draw.rounded_rectangle((318, 48, 1012, 712), 16, fill=white)
    box(draw, (330, 58, 1000, 150), white)
    txt(draw, (352, 68), "Get started", 22, (22, 22, 24), bold=True)
    txt(draw, (352, 102), "Default workspace is wodeapp (self-evolve).", 13, (90, 90, 96))
    txt(draw, (352, 122), "Add a local key or sign in to chat. Chrome is optional.", 13, (90, 90, 96))

    box(draw, (330, 150, 1000, 210), white)
    txt(draw, (370, 168), "1  Local key", 13, (22, 22, 24), bold=True)
    txt(draw, (520, 168), "2  Chrome", 13, (140, 140, 146))

    box(draw, (330, 210, 1000, 320), white)
    txt(draw, (352, 218), "Step 1 / 2  ·  capabilities", 11, (140, 140, 146))
    txt(draw, (352, 240), "Local or cloud", 20, (22, 22, 24), bold=True)
    txt(draw, (352, 272), "Local key, no login. Cloud sign-in unlocks everything.", 13, (90, 90, 96))
    txt(draw, (352, 292), "Checks show what a provider can do, not what is already set.", 13, (90, 90, 96))

    # path cards
    box(draw, (352, 328, 640, 400), (252, 248, 248))
    txt(draw, (372, 342), "Local", 16, (22, 22, 24), bold=True)
    txt(draw, (372, 368), "Local key  ·  no login", 12, (110, 90, 96))
    box(draw, (656, 328, 980, 400), (252, 248, 248))
    txt(draw, (676, 342), "Cloud", 16, (22, 22, 24), bold=True)
    txt(draw, (676, 368), "Sign in  ·  all capabilities ready", 12, (110, 90, 96))

    box(draw, (330, 408, 1000, 458), white)
    txt(draw, (352, 418), "Provider", 11, (120, 120, 126), bold=True)
    txt(draw, (520, 418), "Chat", 11, (120, 120, 126), bold=True)
    txt(draw, (620, 418), "Image", 11, (120, 120, 126), bold=True)
    txt(draw, (720, 418), "Video", 11, (120, 120, 126), bold=True)
    txt(draw, (860, 418), "Setup", 11, (120, 120, 126), bold=True)
    # keep table body (vendor names are already Latin)

    box(draw, (330, 430, 1000, 640), white)
    txt(draw, (352, 448), "Kimi / Moonshot", 13, (22, 22, 24), bold=True)
    txt(draw, (860, 448), "Usage", 12, (16, 110, 102), bold=True)
    txt(draw, (352, 488), "Volcano Ark", 13, (22, 22, 24), bold=True)
    txt(draw, (520, 488), "Doubao Seed 2.1", 12, (70, 70, 76))
    txt(draw, (860, 488), "Usage", 12, (16, 110, 102), bold=True)
    txt(draw, (352, 528), "DeepSeek", 13, (22, 22, 24), bold=True)
    txt(draw, (860, 528), "Ready", 12, (16, 110, 102), bold=True)

    box(draw, (330, 640, 1000, 704), white)
    txt(draw, (352, 662), "Don't show again", 12, (90, 90, 96))
    draw.rounded_rectangle((780, 652, 860, 686), 8, outline=(210, 210, 214), fill=(255, 255, 255))
    txt(draw, (800, 660), "Later", 13, (70, 70, 76))
    draw.rounded_rectangle((872, 652, 980, 686), 8, fill=(20, 20, 22))
    txt(draw, (900, 660), "Next", 13, (255, 255, 255), bold=True)

    out = ASSETS / "ph-first-mile-en.png"
    im.save(out, optimize=True)
    return out


def paint_ink_book() -> Path:
    src = Image.open(ASSETS / "ink-book-workbench.jpg").convert("RGB")
    src.thumbnail((1920, 1168), Image.Resampling.LANCZOS)
    im = src
    w, h = im.size
    wood = im.getpixel((1860, 1040))
    still = im.crop((1480, 820, 1900, 1140)).resize((w - 268, h), Image.Resampling.LANCZOS)
    still = Image.blend(Image.new("RGB", still.size, wood), still, 0.55)
    im.paste(still, (268, 0))
    draw = ImageDraw.Draw(im)
    side_bg = im.getpixel((28, 90))
    box(draw, (0, 0, 268, h), side_bg)
    txt(draw, (56, 54), "Ink book", 15, (90, 28, 28), bold=True)
    draw.rounded_rectangle((48, 86, 250, 122), 10, fill=(110, 28, 32))
    txt(draw, (88, 96), "New chat", 14, (255, 255, 255), bold=True)
    draw.rounded_rectangle((48, 134, 250, 164), 8, fill=(255, 236, 232))
    txt(draw, (62, 142), "Default agent", 12, (80, 24, 28), bold=True)
    items = [
        (180, "Image agent", "Shots · heroes · batch"),
        (226, "Video agent", "Clips · i2v · queue"),
        (272, "Short drama", "Scripts · boards"),
        (318, "Canvas", "Nodes · keep going"),
        (364, "Multi-model", "Run and compare"),
        (418, "Digital assets", ""),
        (454, "History", ""),
        (490, "Automations", ""),
        (526, "Capabilities", ""),
    ]
    for y, a, b in items:
        txt(draw, (62, y), a, 12, (40, 24, 24), bold=True)
        if b:
            txt(draw, (62, y + 16), b, 10, (130, 110, 110))
    box(draw, (44, 570, 260, h - 12), side_bg)
    txt(draw, (56, 582), "PROJECTS", 10, (130, 110, 110))
    txt(draw, (62, 602), "wodeapp (self-evolve)", 11, (40, 24, 24))

    # title lines only — do not flood the desk with a brown plate
    cx = w // 2 + 40
    title_bg = (248, 240, 228)
    draw.rounded_rectangle((cx - 310, 250, cx + 310, 430), 16, fill=title_bg)
    txt(draw, (cx - 90, 268), "Your AI workbench", 13, (120, 90, 80))
    txt(draw, (cx - 220, 300), "Just say what you need", 28, (32, 24, 20), bold=True)
    txt(draw, (cx - 250, 350), "Manage assets, generate images and video,", 14, (90, 70, 60))
    txt(draw, (cx - 150, 374), "or call a custom agent.", 14, (90, 70, 60))

    chips = [(cx - 250, "Digital assets"), (cx - 70, "Generate image"), (cx + 110, "Generate video")]
    for x, label in chips:
        draw.rounded_rectangle((x, 448, x + 160, 482), 16, fill=(255, 252, 248), outline=(220, 200, 190))
        txt(draw, (x + 18, 456), label, 12, (70, 40, 36))

    # one English composer, covering the original Chinese dock + 发送
    desk = im.getpixel((cx, h - 30))
    box(draw, (cx - 430, 620, cx + 470, h - 4), desk)
    draw.rounded_rectangle((cx - 340, 700, cx + 340, 820), 16, fill=(255, 255, 255))
    txt(draw, (cx - 320, 716), "Type freely. / for commands, @ for skills…", 14, (150, 140, 136))
    txt(draw, (cx - 320, 760), "Default agent    Kimi Code K3 256K    Full access", 12, (110, 100, 96))
    draw.rounded_rectangle((cx + 240, 756, cx + 320, 790), 8, fill=(20, 20, 22))
    txt(draw, (cx + 258, 764), "Send", 13, (255, 255, 255), bold=True)

    box(draw, (280, 6, 720, 40), im.getpixel((400, 16)))
    txt(draw, (300, 14), "wodeappx  /  Default agent", 13, (90, 80, 76))
    box(draw, (w - 300, 6, w - 16, 40), im.getpixel((w - 80, 16)))
    txt(draw, (w - 270, 14), "Docs    Feedback    English", 12, (90, 80, 76))

    out = ASSETS / "ink-book-workbench-en.jpg"
    im.save(out, quality=90, optimize=True)
    return out


def paint_assets() -> Path:
    raise RuntimeError("Do not paint assets. Run compose-promo-en-chrome.py")


def _unused_paint_assets() -> Path:
    im = Image.open(ASSETS / "ph-assets.png").convert("RGB")
    draw = ImageDraw.Draw(im)
    paint_sidebar(im, skin="pastel")
    # highlight digital assets row
    draw.rounded_rectangle((48, 372, 220, 404), 8, fill=(255, 220, 226))
    txt(draw, (64, 380), "Digital assets", 12, (90, 30, 40), bold=True)

    box(draw, (248, 8, 700, 36), im.getpixel((300, 16)))
    txt(draw, (260, 14), "wodeappx  /  Digital assets", 12, (90, 90, 96))
    box(draw, (1080, 8, 1260, 36), im.getpixel((1200, 18)))
    txt(draw, (1148, 14), "English", 12, (70, 70, 76))

    box(draw, (248, 48, 900, 150), im.getpixel((400, 70)))
    txt(draw, (260, 56), "ASSET LIBRARY", 11, (140, 140, 146))
    txt(draw, (260, 76), "Digital assets", 26, (22, 22, 24), bold=True)
    txt(draw, (260, 114), "Keep prompts, images, video, scripts, and brands ready for chat.", 13, (90, 90, 96))

    box(draw, (900, 48, 1260, 120), im.getpixel((1100, 70)))
    txt(draw, (920, 70), "Upload     New product     New brand", 12, (70, 70, 76))

    box(draw, (248, 148, 1260, 230), im.getpixel((400, 170)))
    txt(draw, (260, 168), "All 138    Products 16    Brands 3    Prompts 23    Images 74    Videos 16", 12, (70, 70, 76))
    txt(draw, (260, 196), "Images    Videos    Prompts    Brands", 12, (90, 90, 96))
    box(draw, (900, 148, 1260, 230), im.getpixel((1100, 180)))
    txt(draw, (1000, 176), "Upload", 12, (70, 70, 76))

    for y in (220, 430, 640):
        for x in (260, 492, 724, 956):
            if x + 40 > 1260 or y + 20 > 750:
                continue
            box(draw, (x + 8, y + 8, x + 62, y + 28), (255, 255, 255))
            txt(draw, (x + 14, y + 10), "Image", 10, (90, 90, 96))
            box(draw, (x + 8, y + 150, x + 220, y + 188), (255, 255, 255))
            if y < 600:
                txt(draw, (x + 14, y + 156), "Chengsi / Wuyu", 11, (40, 40, 44), bold=True)
                txt(draw, (x + 160, y + 158), "Delete", 10, (180, 70, 70))

    out = ASSETS / "ph-assets-en.png"
    im.save(out, optimize=True)
    return out


def paint_evolve_hold() -> Path:
    w, h = 1600, 900
    im = Image.new("RGB", (w, h), (244, 244, 246))
    draw = ImageDraw.Draw(im)
    draw.rounded_rectangle((360, 180, 1240, 720), 18, fill=(255, 255, 255), outline=(226, 228, 232))
    rows = [
        ("/evolve", "Change this app — skin, copy, features.", True),
        ("/init", "Guided AGENTS.md setup", False),
        ("/review", "Review the latest changes", False),
        ("/customize", "Tune tools and defaults", False),
    ]
    y = 220
    for name, desc, active in rows:
        if active:
            draw.rounded_rectangle((392, y - 12, 1208, y + 72), 12, fill=(28, 42, 44))
            name_c = desc_c = (244, 246, 242)
        else:
            name_c, desc_c = (22, 22, 24), (110, 114, 120)
        txt(draw, (420, y), name, 22, name_c, bold=True)
        txt(draw, (420, y + 32), desc, 15, desc_c)
        y += 96
    txt(draw, (420, 640), "Default agent    Kimi Code K3 256K    Full access", 14, (110, 114, 120))
    still = ASSETS / "evolve-skin-type-en.jpg"
    im.save(still, quality=90)
    frame_dir = Path("/tmp/promo-en-evolve")
    frame_dir.mkdir(exist_ok=True)
    for p in frame_dir.glob("*.jpg"):
        p.unlink()
    w, h = im.size
    for i in range(36):
        scale = 1 + 0.02 * (i / 35)
        nw, nh = int(w * scale), int(h * scale)
        zoomed = im.resize((nw, nh), Image.Resampling.LANCZOS)
        x = (nw - w) // 2
        y = int((nh - h) * 0.65)
        zoomed.crop((x, y, x + w, y + h)).resize((w, h), Image.Resampling.LANCZOS).save(
            frame_dir / f"f-{i:04d}.jpg", quality=88
        )
    import subprocess

    subprocess.check_call(
        [
            "ffmpeg", "-y", "-framerate", "12", "-i", str(frame_dir / "f-%04d.jpg"),
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
            str(ASSETS / "evolve-skin-type-en.mp4"),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return still


def main() -> None:
    print(paint_ink_book())
    print(paint_evolve_hold())


if __name__ == "__main__":
    main()
