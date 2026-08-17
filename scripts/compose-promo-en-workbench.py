#!/usr/bin/env python3
"""Compose clean English chrome for promo image/video workbench stills + short loops."""

from __future__ import annotations

import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "docs/promo/video/assets"
BATCH = ASSETS / "batch"
CASES = ASSETS / "cases"
VID_POSTERS = CASES / "videos"
FONT = "/System/Library/Fonts/Hiragino Sans GB.ttc"

PAGE = (246, 245, 250)
CARD = (255, 255, 255)
LINE = (226, 228, 232)
INK = (22, 22, 24)
MUTED = (110, 114, 120)
TEAL = (18, 92, 86)
TAB = (28, 42, 44)
DEL = (180, 70, 70)


def fnt(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT, size, index=1 if bold else 0)


def rounded_thumb(path: Path, size: int) -> Image.Image:
    im = Image.open(path).convert("RGB")
    im.thumbnail((size, size), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (size, size), (236, 236, 238))
    x = (size - im.size[0]) // 2
    y = (size - im.size[1]) // 2
    canvas.paste(im, (x, y))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), 10, fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(canvas, (0, 0))
    out.putalpha(mask)
    return out


def text(draw: ImageDraw.ImageDraw, xy, s, size, fill=INK, bold=False) -> None:
    draw.text(xy, s, font=fnt(size, bold), fill=fill)


def compose_images() -> Path:
    w, h = 1634, 1680
    im = Image.new("RGB", (w, h), PAGE)
    draw = ImageDraw.Draw(im)

    draw.rectangle((0, 0, 72, h), fill=(238, 237, 242))
    text(draw, (16, 720), "Gen", 12, MUTED)

    text(draw, (96, 28), "AI product visual studio", 22, bold=True)
    text(draw, (96, 62), "Upload a product shot  ·  Pick a look  ·  Batch generate", 15, MUTED)

    def tab(x0, x1, label, active=False):
        fill = TAB if active else (244, 244, 246)
        draw.rounded_rectangle((x0, 104, x1, 146), 10, fill=fill, outline=None if active else LINE)
        text(draw, (x0 + 16, 114), label, 15, (244, 246, 242) if active else MUTED, bold=active)

    tab(96, 230, "Current (0)")
    tab(242, 400, "History (14)", True)
    tab(412, 560, "Favorites (2)")
    tab(572, 668, "Import")

    rows = [
        ("Chengsi champagne silk dress", "3 shots", "Today 10:22  ·  hero, lookbook, texture",
         ["lumora-silk-dress.jpg", "lumora-silk-look.jpg", "lumora-scarf.jpg"]),
        ("Wuyu nude rose lipstick", "3 shots", "Today 10:22  ·  still life, makeup, scene",
         ["lumora-lipstick.jpg", "lumora-makeup.jpg", "lumora-vanity.jpg"]),
        ("Wuyu gold serum", "3 shots", "Today 10:21  ·  bottle, cream, scent",
         ["lumora-serum.jpg", "lumora-cream.jpg", "lumora-perfume.jpg"]),
        ("Chengsi cream silk blouse", "3 shots", "Today 10:20  ·  flat lay, series, accessory",
         ["lumora-blouse.jpg", "lumora-silk-look.jpg", "lumora-scarf.jpg"]),
        ("Wuyu morning-dew perfume", "3 shots", "Yesterday 22:18  ·  still life, bottle, vanity",
         ["lumora-perfume.jpg", "lumora-vanity.jpg", "lumora-cream.jpg"]),
        ("Chengsi mist-pink silk scarf", "3 shots", "Yesterday 21:05  ·  texture, lookbook, hero",
         ["lumora-scarf.jpg", "lumora-silk-dress.jpg", "lumora-blouse.jpg"]),
        ("Wuyu frost cream", "3 shots", "Aug 14 17:58  ·  jar, still life, texture",
         ["lumora-cream.jpg", "lumora-serum.jpg", "lumora-vanity.jpg"]),
    ]

    y = 172
    card_h = 208
    gap = 14
    thumb = 86
    for title, count, meta, files in rows:
        draw.rounded_rectangle((88, y, w - 28, y + card_h), 16, fill=CARD, outline=LINE)
        text(draw, (112, y + 28), title, 22, bold=True)
        text(draw, (112, y + 68), f"{count}    {meta}", 15, MUTED)
        tx = w - 430
        for name in files:
            p = CASES / name
            if p.exists():
                im.paste(rounded_thumb(p, thumb), (tx, y + 58), rounded_thumb(p, thumb))
            tx += thumb + 10
        bx, by = w - 136, y + 86
        draw.rounded_rectangle((bx, by, bx + 88, by + 36), 8, fill=TEAL)
        text(draw, (bx + 22, by + 8), "Apply", 15, (255, 255, 255), bold=True)
        y += card_h + gap

    out = BATCH / "agent-batch-images-en.mp4.preview.jpg"
    im.save(out, quality=90, optimize=True)
    make_hold_loop(im, BATCH / "agent-batch-images-en.mp4")
    return out


def compose_videos() -> Path:
    w, h = 1078, 1366
    im = Image.new("RGB", (w, h), PAGE)
    draw = ImageDraw.Draw(im)
    text(draw, (24, 22), "Video studio", 20, bold=True)
    draw.rounded_rectangle((24, 62, 132, 100), 10, fill=(244, 244, 246), outline=LINE)
    text(draw, (44, 72), "Current", 14, MUTED)
    draw.rounded_rectangle((144, 62, 300, 100), 10, fill=TEAL)
    text(draw, (162, 72), "History (71)", 14, (244, 246, 242), bold=True)
    text(draw, (316, 74), "Open any row to keep going", 13, MUTED)

    rows = [
        ("Chengsi champagne silk lookbook", "Today 10:42", "5s Ready", "chengsi-silk-dress.jpg"),
        ("Wuyu nude rose lipstick clip", "Today 10:42", "5s Ready", "wuyu-lipstick.jpg"),
        ("Wuyu gold serum bottle move", "Today 10:42", "5s Ready", "wuyu-serum.jpg"),
        ("Wuyu morning-dew perfume still", "Today 10:40", "5s Ready", "wuyu-perfume.jpg"),
        ("Chengsi cream silk blouse", "Today 10:42", "5s Ready", "chengsi-blouse.jpg"),
        ("Wuyu vanity makeup set", "Today 10:43", "5s Ready", "wuyu-vanity.jpg"),
        ("Chengsi mist-pink silk scarf", "Today 10:41", "5s Ready", "chengsi-scarf.jpg"),
        ("Wuyu frost cream still", "Today 10:41", "5s Ready", "wuyu-cream.jpg"),
    ]
    y = 124
    card_h = 146
    gap = 10
    thumb = 96
    for title, when, status, poster in rows:
        draw.rounded_rectangle((20, y, w - 20, y + card_h), 16, fill=CARD, outline=LINE)
        p = VID_POSTERS / poster
        if p.exists():
            im.paste(rounded_thumb(p, thumb), (36, y + 25), rounded_thumb(p, thumb))
        text(draw, (152, y + 28), title, 18, bold=True)
        text(draw, (152, y + 64), f"{when}    {status}", 14, MUTED)
        ox, dx, by = w - 232, w - 126, y + 54
        draw.rounded_rectangle((ox, by, ox + 88, by + 34), 8, fill=TEAL)
        text(draw, (ox + 24, by + 7), "Open", 14, (255, 255, 255), bold=True)
        draw.rounded_rectangle((dx, by, dx + 88, by + 34), 8, fill=(248, 244, 244), outline=(220, 200, 200))
        text(draw, (dx + 20, by + 7), "Delete", 14, DEL)
        y += card_h + gap

    out = BATCH / "agent-batch-videos-en.mp4.preview.jpg"
    im.save(out, quality=90, optimize=True)
    make_hold_loop(im, BATCH / "agent-batch-videos-en.mp4")
    return out


def make_hold_loop(im: Image.Image, out_mp4: Path) -> None:
    frame_dir = Path("/tmp/promo-en-hold")
    frame_dir.mkdir(exist_ok=True)
    for p in frame_dir.glob("*.jpg"):
        p.unlink()
    w, h = im.size
    for i in range(36):
        scale = 1 + 0.012 * (i / 35)
        nw, nh = int(w * scale), int(h * scale)
        zoomed = im.resize((nw, nh), Image.Resampling.LANCZOS)
        x = (nw - w) // 2
        y = int((nh - h) * 0.28)
        frame = zoomed.crop((x, y, x + w, y + h)).resize((w, h), Image.Resampling.LANCZOS)
        frame.filter(ImageFilter.SMOOTH).save(frame_dir / f"f-{i:04d}.jpg", quality=88)
    subprocess.check_call(
        [
            "ffmpeg", "-y", "-framerate", "12", "-i", str(frame_dir / "f-%04d.jpg"),
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out_mp4),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def main() -> None:
    img = compose_images()
    vid = compose_videos()
    print(img, img.stat().st_size)
    print(vid, vid.stat().st_size)
    print((BATCH / "agent-batch-images-en.mp4").stat().st_size)
    print((BATCH / "agent-batch-videos-en.mp4").stat().st_size)


if __name__ == "__main__":
    main()
