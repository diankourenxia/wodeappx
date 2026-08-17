#!/usr/bin/env python3
"""Replace 苏泊尔 in the ZH evolve capture. Sidebar row only; do not paint the rest."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "docs/promo/video/assets/evolve-skin-type.mp4"
FONT = "/System/Library/Fonts/Hiragino Sans GB.ttc"
# Source is 1920x1188; project row sits above the account card.
BOX = (18, 1028, 308, 1068)
FILL = (245, 242, 240)
INK = (90, 42, 48)


def patch_frame(path: Path) -> None:
    im = Image.open(path).convert("RGB")
    draw = ImageDraw.Draw(im)
    draw.rectangle(BOX, fill=FILL)
    font = ImageFont.truetype(FONT, 15, index=0)
    draw.text((36, 1036), "wodeapp（自进化）", font=font, fill=INK)
    im.save(path, quality=95)


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"missing {SRC}")
    work = Path(tempfile.mkdtemp(prefix="promo-evolve-"))
    try:
        pattern = work / "f%04d.png"
        subprocess.check_call(
            ["ffmpeg", "-y", "-i", str(SRC), "-vsync", "0", str(pattern)],
        )
        frames = sorted(work.glob("f*.png"))
        if not frames:
            raise SystemExit("no frames extracted")
        for frame in frames:
            patch_frame(frame)
        tmp = SRC.with_suffix(".patched.mp4")
        subprocess.check_call(
            [
                "ffmpeg",
                "-y",
                "-framerate",
                "30",
                "-i",
                str(work / "f%04d.png"),
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-crf",
                "16",
                str(tmp),
            ]
        )
        shutil.move(tmp, SRC)
        print(f"patched {len(frames)} frames -> {SRC}")
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
