#!/usr/bin/env python3
"""Compose English first-mile + assets stills from scratch. Do not paint over ZH."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "docs/promo/video/assets"
CASES = ASSETS / "cases"
VID = CASES / "videos"
FONT = "/System/Library/Fonts/Hiragino Sans GB.ttc"

PAGE = (246, 245, 250)
SIDE = (236, 240, 236)
CARD = (255, 255, 255)
LINE = (226, 228, 232)
INK = (22, 22, 24)
MUTED = (110, 114, 120)
MAROON = (120, 36, 48)
PINK = (255, 228, 232)
TEAL = (16, 110, 102)
DEL = (180, 70, 70)


def fnt(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT, size, index=1 if bold else 0)


def txt(draw: ImageDraw.ImageDraw, xy, s, size, fill=INK, bold=False) -> None:
    draw.text(xy, s, font=fnt(size, bold), fill=fill)


def thumb(path: Path, size: tuple[int, int]) -> Image.Image:
    im = Image.open(path).convert("RGB")
    im.thumbnail(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, (236, 236, 238))
    canvas.paste(im, ((size[0] - im.size[0]) // 2, (size[1] - im.size[1]) // 2))
    return canvas


def rounded(im: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.size[0] - 1, im.size[1] - 1), radius, fill=255)
    out = im.convert("RGBA")
    out.putalpha(mask)
    return out


def draw_sidebar(im: Image.Image, active: str) -> None:
    draw = ImageDraw.Draw(im)
    draw.rectangle((0, 0, 268, im.size[1]), fill=SIDE)
    txt(draw, (28, 22), "Macaron", 16, (90, 40, 55), bold=True)
    draw.rounded_rectangle((20, 58, 248, 96), 10, fill=MAROON)
    txt(draw, (78, 68), "New chat", 15, (255, 255, 255), bold=True)
    items = [
        ("default", "Default agent", ""),
        ("image", "Image agent", "Shots · heroes · batch"),
        ("video", "Video agent", "Clips · i2v · queue"),
        ("drama", "Short drama", "Scripts · boards"),
        ("canvas", "Canvas", "Nodes · keep going"),
        ("multi", "Multi-model", "Run and compare"),
        ("assets", "Digital assets", ""),
        ("history", "History", "By type"),
        ("auto", "Automations", ""),
        ("caps", "Capabilities", ""),
    ]
    y = 116
    for key, title, sub in items:
        if key == active:
            draw.rounded_rectangle((16, y - 6, 252, y + (40 if sub else 28)), 8, fill=PINK)
        txt(draw, (28, y), title, 14, (70, 30, 40) if key == active else INK, bold=True)
        y += 22
        if sub:
            txt(draw, (28, y), sub, 11, MUTED)
            y += 22
        y += 10
    txt(draw, (28, 860), "PROJECTS", 11, MUTED)
    txt(draw, (28, 884), "wodeapp (self-evolve)", 13, INK)


def compose_first_mile() -> Path:
    w, h = 1920, 1080
    im = Image.new("RGB", (w, h), PAGE)
    draw = ImageDraw.Draw(im)
    draw_sidebar(im, "default")
    txt(draw, (292, 22), "wodeappx  /  Default agent", 15, MUTED)
    txt(draw, (1760, 22), "English", 15, MUTED)
    draw.rounded_rectangle((420, 720, 1500, 820), 16, fill=CARD, outline=LINE)
    txt(draw, (448, 748), "Type freely. / for commands, @ for skills…", 16, (160, 160, 166))
    txt(draw, (448, 786), "Default agent    DeepSeek V4    Full access", 13, MUTED)

    draw.rounded_rectangle((500, 80, 1420, 980), 20, fill=CARD, outline=LINE)
    txt(draw, (536, 108), "Get started", 28, bold=True)
    txt(draw, (536, 156), "Default workspace is wodeapp (self-evolve).", 16, MUTED)
    txt(draw, (536, 184), "Add a local key or sign in to chat. Chrome is optional.", 16, MUTED)
    txt(draw, (536, 230), "1  Local key", 16, INK, bold=True)
    txt(draw, (760, 230), "2  Chrome", 16, MUTED)
    txt(draw, (536, 278), "Step 1 / 2  ·  capabilities", 13, MUTED)
    txt(draw, (536, 308), "Local or cloud", 24, bold=True)
    txt(draw, (536, 348), "Local key, no login. Cloud sign-in unlocks everything.", 15, MUTED)

    draw.rounded_rectangle((536, 400, 920, 500), 12, fill=(252, 244, 244), outline=LINE)
    txt(draw, (560, 420), "Local", 18, bold=True)
    txt(draw, (560, 456), "Local key  ·  no login", 14, MUTED)
    draw.rounded_rectangle((944, 400, 1384, 500), 12, fill=(248, 248, 250), outline=LINE)
    txt(draw, (968, 420), "Cloud", 18, bold=True)
    txt(draw, (968, 456), "Sign in  ·  all capabilities ready", 14, MUTED)

    txt(draw, (536, 532), "Provider", 13, MUTED, bold=True)
    txt(draw, (820, 532), "Chat", 13, MUTED, bold=True)
    txt(draw, (1040, 532), "Image", 13, MUTED, bold=True)
    txt(draw, (1220, 532), "Setup", 13, MUTED, bold=True)
    rows = [
        ("Kimi / Moonshot", "Moonshot V1", "—", "Usage"),
        ("Volcano Ark", "Doubao Seed 2.1", "Seedream 5", "Usage"),
        ("DeepSeek", "DeepSeek V4", "—", "Ready"),
    ]
    y = 572
    for name, chat, image, setup in rows:
        txt(draw, (536, y), name, 16, bold=True)
        txt(draw, (820, y), chat, 15, MUTED)
        txt(draw, (1040, y), image, 15, MUTED)
        txt(draw, (1220, y), setup, 15, TEAL, bold=True)
        y += 48

    txt(draw, (536, 880), "Don't show again", 14, MUTED)
    draw.rounded_rectangle((1080, 868, 1188, 910), 8, fill=CARD, outline=LINE)
    txt(draw, (1108, 878), "Later", 15, MUTED)
    draw.rounded_rectangle((1204, 868, 1384, 910), 8, fill=INK)
    txt(draw, (1268, 878), "Next", 15, (255, 255, 255), bold=True)

    out = ASSETS / "ph-first-mile-en.png"
    im.save(out, optimize=True)
    return out


def compose_assets() -> Path:
    w, h = 1920, 1080
    im = Image.new("RGB", (w, h), PAGE)
    draw = ImageDraw.Draw(im)
    draw_sidebar(im, "assets")
    txt(draw, (292, 22), "wodeappx  /  Digital assets", 15, MUTED)
    txt(draw, (1760, 22), "English", 15, MUTED)
    txt(draw, (292, 64), "ASSET LIBRARY", 12, MUTED)
    txt(draw, (292, 88), "Digital assets", 32, bold=True)
    txt(draw, (292, 136), "Keep prompts, images, video, scripts, and brands ready for chat.", 16, MUTED)
    txt(draw, (1380, 96), "Upload     New product     New brand", 15, MUTED)
    txt(draw, (292, 184), "All 138    Products 16    Brands 3    Prompts 23    Images 74    Videos 16", 15, MUTED)
    txt(draw, (292, 216), "Images    Videos    Prompts    Brands", 15, INK)

    shots = [
        (VID / "wuyu-perfume.jpg", "Wuyu perfume"),
        (VID / "wuyu-lipstick.jpg", "Wuyu lipstick"),
        (VID / "wuyu-serum.jpg", "Wuyu serum"),
        (VID / "wuyu-cream.jpg", "Wuyu cream"),
        (VID / "chengsi-silk-dress.jpg", "Chengsi dress"),
        (VID / "chengsi-blouse.jpg", "Chengsi blouse"),
        (VID / "chengsi-scarf.jpg", "Chengsi scarf"),
        (VID / "wuyu-vanity.jpg", "Wuyu vanity"),
    ]
    for i, (path, title) in enumerate(shots):
        col, row = i % 4, i // 4
        x, y = 292 + col * 400, 268 + row * 390
        draw.rounded_rectangle((x, y, x + 376, y + 366), 16, fill=CARD, outline=LINE)
        if path.exists():
            shot = thumb(path, (344, 240))
            im.paste(rounded(shot, 12), (x + 16, y + 16), rounded(shot, 12))
        draw.rounded_rectangle((x + 24, y + 28, x + 92, y + 52), 8, fill=(255, 255, 255))
        txt(draw, (x + 32, y + 32), "Image", 12, MUTED)
        txt(draw, (x + 20, y + 272), title, 16, bold=True)
        txt(draw, (x + 20, y + 302), "1 file  ·  cloud", 13, MUTED)
        txt(draw, (x + 280, y + 328), "Delete", 13, DEL)

    out = ASSETS / "ph-assets-en.png"
    im.save(out, optimize=True)
    return out


def main() -> None:
    print(compose_first_mile())
    print(compose_assets())


if __name__ == "__main__":
    main()
