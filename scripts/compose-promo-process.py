#!/usr/bin/env python3
"""Build Current-tab process clips (images appear / videos finish) for both langs."""

from __future__ import annotations

import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "docs/promo/video/assets"
BATCH = ASSETS / "batch"
CASES = ASSETS / "cases"
VID = CASES / "videos"
FONT = "/System/Library/Fonts/Hiragino Sans GB.ttc"

PAGE = (246, 245, 250)
CARD = (255, 255, 255)
LINE = (226, 228, 232)
INK = (22, 22, 24)
MUTED = (110, 114, 120)
TEAL = (18, 92, 86)
BAR = (28, 42, 44)
SLOT = (232, 232, 236)


def fnt(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT, size, index=1 if bold else 0)


def text(draw: ImageDraw.ImageDraw, xy, s, size, fill=INK, bold=False) -> None:
    draw.text(xy, s, font=fnt(size, bold), fill=fill)


def thumb(path: Path, size: tuple[int, int]) -> Image.Image:
    im = Image.open(path).convert("RGB")
    im.thumbnail(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, SLOT)
    x = (size[0] - im.size[0]) // 2
    y = (size[1] - im.size[1]) // 2
    canvas.paste(im, (x, y))
    return canvas


def rounded(im: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.size[0] - 1, im.size[1] - 1), radius, fill=255)
    out = im.convert("RGBA")
    out.putalpha(mask)
    return out


COPY = {
    "en": {
        "studio": "Image workbench",
        "flow": "Product shot  ·  Look  ·  Generate",
        "current": "Current",
        "history": "History",
        "fav": "Favorites",
        "product": "Wuyu · Chengsi batch",
        "model": "Seedream 5",
        "gen": "Generating",
        "shots": "shots",
        "done": "Ready",
        "vstudio": "Video workbench",
        "vflow": "Storyboard  ·  Image-to-video  ·  Queue",
        "queued": "Queued",
        "rendering": "Rendering",
        "ready": "Ready",
        "open": "Open",
    },
    "zh": {
        "studio": "图片工作台",
        "flow": "商品底图  ·  创意类型  ·  批量出图",
        "current": "当前",
        "history": "历史",
        "fav": "收藏",
        "product": "雾屿 · 澄丝 批量出图",
        "model": "Seedream 5",
        "gen": "生成中",
        "shots": "张",
        "done": "已出图",
        "vstudio": "视频工作台",
        "vflow": "分镜  ·  图生视频  ·  批量队列",
        "queued": "排队中",
        "rendering": "生成中",
        "ready": "已出片",
        "open": "打开",
    },
}

IMAGE_SHOTS = [
    VID / "wuyu-serum.jpg",
    VID / "wuyu-lipstick.jpg",
    VID / "chengsi-silk-dress.jpg",
    VID / "wuyu-perfume.jpg",
    VID / "chengsi-blouse.jpg",
    VID / "chengsi-scarf.jpg",
]

VIDEO_ROWS = [
    ("en", "Wuyu gold serum bottle move", VID / "wuyu-serum.jpg"),
    ("en", "Wuyu nude rose lipstick clip", VID / "wuyu-lipstick.jpg"),
    ("en", "Chengsi cream silk blouse", VID / "chengsi-blouse.jpg"),
    ("en", "Wuyu morning-dew perfume still", VID / "wuyu-perfume.jpg"),
]
VIDEO_ROWS_ZH = [
    ("雾屿 金萃精华液瓶身运镜", VID / "wuyu-serum.jpg"),
    ("雾屿 裸玫瑰口红种草短片", VID / "wuyu-lipstick.jpg"),
    ("澄丝 奶油真丝衬衫平铺", VID / "chengsi-blouse.jpg"),
    ("雾屿 晨露香水静物短片", VID / "wuyu-perfume.jpg"),
]


def draw_tabs(draw, c, x, y, current_n: int, history_n: int, active="current") -> None:
    tabs = [
        (c["current"], current_n, active == "current"),
        (c["history"], history_n, active == "history"),
        (c["fav"], 2, False),
    ]
    for label, n, on in tabs:
        w = 168
        draw.rounded_rectangle((x, y, x + w, y + 40), 10, fill=BAR if on else (244, 244, 246), outline=None if on else LINE)
        text(draw, (x + 16, y + 10), f"{label} ({n})", 15, (244, 246, 242) if on else MUTED, bold=on)
        x += w + 10


def frame_images(lang: str, t: float, duration: float) -> Image.Image:
    c = COPY[lang]
    w, h = 1920, 1080
    im = Image.new("RGB", (w, h), PAGE)
    draw = ImageDraw.Draw(im)
    text(draw, (48, 28), c["studio"], 28, bold=True)
    text(draw, (48, 68), c["flow"], 16, MUTED)

    done = min(6, int(t / duration * 6 + 0.001) + (1 if t > 0.15 else 0))
    done = min(6, done)
    pct = min(1.0, t / (duration * 0.85))
    draw_tabs(draw, c, 48, 108, done, 14)

    draw.rounded_rectangle((48, 168, 420, 1032), 18, fill=CARD, outline=LINE)
    ref = thumb(VID / "wuyu-serum.jpg", (324, 324))
    im.paste(rounded(ref, 14), (72, 196), rounded(ref, 14))
    text(draw, (72, 540), c["product"], 22, bold=True)
    text(draw, (72, 578), c["model"], 16, MUTED)
    status = c["done"] if done >= 6 else c["gen"]
    text(draw, (72, 620), f"{status}  {done}/6 {c['shots']}", 18, TEAL if done >= 6 else INK, bold=True)
    draw.rounded_rectangle((72, 668, 396, 686), 6, fill=SLOT)
    draw.rounded_rectangle((72, 668, 72 + int(324 * pct), 686), 6, fill=TEAL)

    grid = [(468 + col * 460, 168 + row * 432) for row in range(2) for col in range(3)]
    for i, (gx, gy) in enumerate(grid):
        draw.rounded_rectangle((gx, gy, gx + 440, gy + 412), 18, fill=CARD, outline=LINE)
        if i < done and IMAGE_SHOTS[i].exists():
            shot = thumb(IMAGE_SHOTS[i], (408, 320))
            im.paste(rounded(shot, 12), (gx + 16, gy + 16), rounded(shot, 12))
            text(draw, (gx + 20, gy + 352), f"{i + 1}/6", 16, MUTED)
            text(draw, (gx + 20, gy + 376), c["done"], 16, TEAL, bold=True)
        else:
            draw.rounded_rectangle((gx + 16, gy + 16, gx + 424, gy + 336), 12, fill=SLOT)
            label = f"{c['gen']}…" if t > 0.05 else " "
            text(draw, (gx + 160, gy + 168), label, 18, MUTED)
    return im


def frame_videos(lang: str, t: float, duration: float) -> Image.Image:
    c = COPY[lang]
    w, h = 1920, 1080
    im = Image.new("RGB", (w, h), PAGE)
    draw = ImageDraw.Draw(im)
    text(draw, (48, 28), c["vstudio"], 28, bold=True)
    text(draw, (48, 68), c["vflow"], 16, MUTED)

    rows = VIDEO_ROWS_ZH if lang == "zh" else [(title, path) for _, title, path in VIDEO_ROWS]
    ready_n = min(4, int(t / duration * 4 + 0.2))
    draw_tabs(draw, c, 48, 108, 4, 71)

    y = 172
    for i, (title, path) in enumerate(rows):
        draw.rounded_rectangle((48, y, 1872, y + 200), 18, fill=CARD, outline=LINE)
        if path.exists():
            im.paste(rounded(thumb(path, (168, 168)), 12), (72, y + 16), rounded(thumb(path, (168, 168)), 12))
        text(draw, (268, y + 28), title, 24, bold=True)
        if i < ready_n:
            text(draw, (268, y + 78), f"5s    {c['ready']}", 18, TEAL, bold=True)
            draw.rounded_rectangle((268, y + 126, 268 + 420, y + 142), 6, fill=TEAL)
            draw.rounded_rectangle((1600, y + 78, 1728, y + 118), 10, fill=TEAL)
            text(draw, (1624, y + 88), c["open"], 16, (255, 255, 255), bold=True)
        else:
            local = min(1.0, max(0.0, (t - i * (duration / 4)) / (duration / 4)))
            text(draw, (268, y + 78), f"{c['rendering']}  {int(local * 100)}%", 18, INK, bold=True)
            draw.rounded_rectangle((268, y + 126, 688, y + 142), 6, fill=SLOT)
            draw.rounded_rectangle((268, y + 126, 268 + int(420 * local), y + 142), 6, fill=TEAL)
        y += 216
    return im


def encode(frames: list[Image.Image], out: Path, fps: int = 30) -> None:
    tmp = Path("/tmp/promo-process-frames")
    tmp.mkdir(exist_ok=True)
    for p in tmp.glob("*.jpg"):
        p.unlink()
    for i, frame in enumerate(frames):
        frame.filter(ImageFilter.SMOOTH).save(tmp / f"f-{i:04d}.jpg", quality=88)
    subprocess.check_call(
        [
            "ffmpeg", "-y", "-framerate", str(fps), "-i", str(tmp / "f-%04d.jpg"),
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart",
            str(out),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    frames[-1].save(Path(str(out) + ".preview.jpg"), quality=90)


def render_clip(kind: str, lang: str, seconds: float, fps: int = 30) -> Path:
    n = int(seconds * fps)
    frames = []
    for i in range(n):
        t = i / fps
        if kind == "images":
            frames.append(frame_images(lang, t, seconds))
        else:
            frames.append(frame_videos(lang, t, seconds))
    suffix = "" if lang == "zh" else "-en"
    out = BATCH / f"agent-batch-{kind}{suffix}.mp4"
    encode(frames, out, fps)
    return out


def main() -> None:
    for lang in ("zh", "en"):
        print(render_clip("images", lang, 3.2))
        print(render_clip("videos", lang, 3.6))


if __name__ == "__main__":
    main()
