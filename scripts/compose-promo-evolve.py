#!/usr/bin/env python3
"""Promo evolve beat: type a skin prompt, then wipe default → ink-book.

Do not Ken Burns a slash card. Do not paint English over a Chinese screenshot.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "docs/promo/video/assets"
FONT = "/System/Library/Fonts/Hiragino Sans GB.ttc"

PAGE = (246, 245, 250)
SIDE = (236, 240, 236)
CARD = (255, 255, 255)
LINE = (226, 228, 232)
INK = (22, 22, 24)
MUTED = (110, 114, 120)
MAROON = (120, 36, 48)
PINK = (255, 228, 232)
WARM = (184, 132, 72)

PROMPT_EN = "/evolve Make an ink-book skin: thread-bound pages, rice paper, seal accents."
PROMPT_ZH = "/自进化 给工作台做一套水墨书卷皮肤：线装书开页、宣纸底、印章点缀。"


def fnt(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT, size, index=1 if bold else 0)


def txt(draw: ImageDraw.ImageDraw, xy, s, size, fill=INK, bold=False) -> None:
    draw.text(xy, s, font=fnt(size, bold), fill=fill)


def fit(path: Path, size: tuple[int, int] = (1920, 1080)) -> Image.Image:
    im = Image.open(path).convert("RGB")
    im.thumbnail(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, PAGE)
    canvas.paste(im, ((size[0] - im.size[0]) // 2, (size[1] - im.size[1]) // 2))
    return canvas


def encode(frames: list[Image.Image], out: Path, fps: int = 30) -> None:
    tmp = Path("/tmp/promo-evolve-frames")
    tmp.mkdir(exist_ok=True)
    for old in tmp.glob("*.jpg"):
        old.unlink()
    for i, frame in enumerate(frames):
        frame.filter(ImageFilter.SMOOTH).save(tmp / f"f-{i:04d}.jpg", quality=88)
    subprocess.check_call(
        [
            "ffmpeg",
            "-y",
            "-framerate",
            str(fps),
            "-i",
            str(tmp / "f-%04d.jpg"),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-crf",
            "18",
            "-movflags",
            "+faststart",
            str(out),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    frames[-1].save(Path(str(out) + ".preview.jpg"), quality=90)


def draw_en_sidebar(im: Image.Image) -> None:
    draw = ImageDraw.Draw(im)
    draw.rectangle((0, 0, 268, im.size[1]), fill=SIDE)
    txt(draw, (28, 22), "Macaron", 16, (90, 40, 55), bold=True)
    draw.rounded_rectangle((20, 58, 248, 96), 10, fill=MAROON)
    txt(draw, (78, 68), "New chat", 15, (255, 255, 255), bold=True)
    items = [
        ("Default agent", "", True),
        ("Image agent", "Shots · heroes · batch", False),
        ("Video agent", "Clips · i2v · queue", False),
        ("Short drama", "Scripts · boards", False),
        ("Canvas", "Nodes · keep going", False),
        ("Multi-model", "Run and compare", False),
        ("Digital assets", "", False),
        ("History", "By type", False),
        ("Automations", "", False),
        ("Capabilities", "", False),
    ]
    y = 116
    for title, sub, active in items:
        if active:
            draw.rounded_rectangle((16, y - 6, 252, y + 28), 8, fill=PINK)
        txt(draw, (28, y), title, 14, (70, 30, 40) if active else INK, bold=True)
        y += 22
        if sub:
            txt(draw, (28, y), sub, 11, MUTED)
            y += 22
        y += 10
    txt(draw, (28, 860), "PROJECTS", 11, MUTED)
    txt(draw, (28, 884), "wodeapp (self-evolve)", 13, INK)


def draw_en_chrome(typed: str, *, caret: bool, show_menu: bool) -> Image.Image:
    im = Image.new("RGB", (1920, 1080), PAGE)
    draw = ImageDraw.Draw(im)
    draw_en_sidebar(im)
    txt(draw, (292, 22), "wodeappx  /  Default agent", 15, MUTED)
    txt(draw, (1640, 22), "Docs    Feedback    English", 14, MUTED)
    txt(draw, (780, 220), "Your AI workbench", 14, MUTED)
    txt(draw, (620, 258), "Just say what you need", 36, bold=True)
    txt(draw, (560, 318), "Manage assets, generate images and video, or call a custom agent.", 16, MUTED)
    chips = [(620, "Digital assets"), (860, "Generate image"), (1100, "Generate video")]
    for x, label in chips:
        draw.rounded_rectangle((x, 368, x + 200, 408), 16, fill=CARD, outline=LINE)
        txt(draw, (x + 28, 378), label, 14, INK)

    box = (420, 720, 1680, 900)
    draw.rounded_rectangle(box, 18, fill=CARD, outline=LINE)
    shown = typed + ("|" if caret else "")
    # wrap long prompt inside the composer
    font = fnt(18)
    words = shown.split(" ")
    lines: list[str] = [""]
    for word in words:
        trial = (lines[-1] + " " + word).strip()
        if font.getlength(trial) < 1180 or not lines[-1]:
            lines[-1] = trial
        else:
            lines.append(word)
    y = 744
    for line in lines[:3]:
        txt(draw, (448, y), line or ("|" if caret and not typed else ""), 18)
        y += 32
    txt(draw, (448, 852), "Default agent    Kimi Code K3 256K    Full access", 13, MUTED)
    draw.rounded_rectangle((1548, 840, 1652, 880), 8, fill=INK)
    txt(draw, (1574, 850), "Send", 15, (255, 255, 255), bold=True)

    if show_menu:
        draw.rounded_rectangle((448, 430, 980, 700), 16, fill=CARD, outline=LINE)
        rows = [
            ("/evolve", "Change this app — skin, copy, features.", True),
            ("/init", "Guided AGENTS.md setup", False),
            ("/review", "Review the latest changes", False),
            ("/customize", "Tune tools and defaults", False),
        ]
        y = 452
        for cmd, desc, on in rows:
            if on:
                draw.rounded_rectangle((464, y - 8, 964, y + 48), 10, fill=(32, 32, 34))
            txt(draw, (480, y), cmd, 16, (255, 255, 255) if on else INK, bold=True)
            txt(draw, (480, y + 22), desc, 13, (200, 200, 204) if on else MUTED)
            y += 58
    return im


def typed_at(prompt: str, t: float, duration: float) -> tuple[str, bool]:
    # empty 0.25s, then type through the rest
    start = 0.25
    if t < start:
        return "", True
    progress = min(1.0, (t - start) / max(0.05, duration - start - 0.15))
    n = max(1, int(round(len(prompt) * progress)))
    return prompt[:n], int(t * 8) % 2 == 0


def compose_en_type(seconds: float = 3.6, fps: int = 30) -> Path:
    frames = []
    for i in range(int(seconds * fps)):
        t = i / fps
        typed, caret = typed_at(PROMPT_EN, t, seconds)
        show_menu = typed.startswith("/") and " " not in typed
        frames.append(draw_en_chrome(typed, caret=caret, show_menu=show_menu))
    out = ASSETS / "evolve-skin-type-en.mp4"
    encode(frames, out, fps)
    return out


def extract_zh_before() -> Image.Image:
    tmp = Path("/tmp/promo-evolve-zh-before.jpg")
    src = ASSETS / "evolve-skin-type.mp4"
    subprocess.check_call(
        ["ffmpeg", "-y", "-ss", "0.2", "-i", str(src), "-frames:v", "1", str(tmp)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return fit(tmp)


def wipe_frame(before: Image.Image, after: Image.Image, p: float, badge: str) -> Image.Image:
    w, h = before.size
    x = max(0, min(w, int(w * p)))
    out = before.copy()
    if x > 0:
        out.paste(after.crop((0, 0, x, h)), (0, 0))
        draw = ImageDraw.Draw(out)
        draw.rectangle((max(0, x - 10), 0, min(w - 1, x + 6), h), fill=WARM)
    if 0.04 < p < 0.98:
        draw = ImageDraw.Draw(out)
        draw.rounded_rectangle((720, 40, 1200, 96), 14, fill=(20, 18, 16))
        txt(draw, (760, 56), badge, 18, (248, 244, 236), bold=True)
    return out


def compose_apply(lang: str, seconds: float = 3.8, fps: int = 30) -> Path:
    if lang == "en":
        before = draw_en_chrome("", caret=False, show_menu=False)
        after = fit(ASSETS / "ink-book-workbench-en.jpg")
        badge = "Applying ink-book skin"
        out = ASSETS / "ink-book-apply-en.mp4"
    else:
        before = extract_zh_before()
        after = fit(ASSETS / "ink-book-workbench.jpg")
        badge = "正在换上水墨书卷"
        out = ASSETS / "ink-book-apply.mp4"
    n = int(seconds * fps)
    frames = []
    for i in range(n):
        t = i / fps
        if t < 0.35:
            p = 0.0
        elif t < 2.15:
            raw = (t - 0.35) / 1.8
            p = raw * raw * (3 - 2 * raw)
        else:
            p = 1.0
        frames.append(wipe_frame(before, after, p, badge))
    encode(frames, out, fps)
    return out


def trim_zh_type(seconds: float = 3.6) -> Path:
    """Keep the live ZH typing take; start where characters are appearing."""
    src = ASSETS / "evolve-skin-type.mp4"
    out = ASSETS / "evolve-skin-type-cut.mp4"
    subprocess.check_call(
        [
            "ffmpeg",
            "-y",
            "-ss",
            "2.2",
            "-i",
            str(src),
            "-t",
            str(seconds),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-crf",
            "18",
            "-movflags",
            "+faststart",
            str(out),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return out


def main() -> None:
    print(compose_en_type())
    print(trim_zh_type())
    print(compose_apply("en"))
    print(compose_apply("zh"))


if __name__ == "__main__":
    main()
