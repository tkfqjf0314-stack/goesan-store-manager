#!/usr/bin/env python3
"""KT 로고 아이콘의 빨간 알약 배지 글자를 다른 매장명으로 바꾼다.

  tools/icon-master-512.png       (레거시 아이콘 · 흰 바탕)
  tools/icon-foreground-512.png   (adaptive 전경 · 투명 바탕)

알약 테두리 픽셀은 그대로 두고, 안쪽만 매장 색으로 덮은 뒤 새 글자를 그린다.
사용: python3 tools/rebadge.py "괴산점"
"""
import sys

from PIL import Image, ImageDraw, ImageFont

FONT = "/usr/share/fonts/pickle-hwp/NotoSansCJKkr-Regular.otf"
RED = (237, 28, 36)
S = 6          # 슈퍼샘플 배율
INSET = 3      # 알약 테두리에서 안쪽으로 들어가는 픽셀 (원본 가장자리 보존)


def pill_bbox(im):
    """아래쪽 절반에서 빨간 알약(가로로 긴 빨강)의 경계 상자를 찾는다."""
    w, h = im.size
    px = im.load()
    xs, ys = [], []
    for y in range(int(h * 0.5), h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 200 and r > 180 and g < 90 and b < 90:
                xs.append(x)
                ys.append(y)
    return min(xs), min(ys), max(xs), max(ys)


def repaint(path, text):
    im = Image.open(path).convert("RGBA")
    x0, y0, x1, y1 = pill_bbox(im)
    w, h = x1 - x0 + 1, y1 - y0 + 1

    # ① 알약 안쪽만 매장 색으로 (원본 테두리 픽셀은 건드리지 않는다)
    inner = Image.new("L", (w, h), 0)
    ImageDraw.Draw(inner).rounded_rectangle(
        [INSET, INSET, w - 1 - INSET, h - 1 - INSET],
        radius=(h - 2 * INSET) // 2, fill=255)
    im.paste(Image.new("RGBA", (w, h), RED + (255,)), (x0, y0), inner)

    # ② 새 글자 — 슈퍼샘플로 그린 뒤 줄여서 붙인다
    patch = Image.new("RGBA", (w * S, h * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(patch)
    target_w, target_h = w * 0.68 * S, h * 0.52 * S
    size = int(target_h)
    while size > 4:
        font = ImageFont.truetype(FONT, size)
        stroke = max(1, int(size * 0.035))
        bb = d.textbbox((0, 0), text, font=font, stroke_width=stroke)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        if tw <= target_w and th <= target_h:
            break
        size -= 1
    cx, cy = w * S / 2, h * S / 2
    d.text((cx - (bb[0] + tw / 2), cy - (bb[1] + th / 2)), text, font=font,
           fill=(255, 255, 255, 255), stroke_width=stroke,
           stroke_fill=(255, 255, 255, 255))
    im.alpha_composite(patch.resize((w, h), Image.LANCZOS), (x0, y0))

    im.save(path)
    print("%s -> %s (알약 %dx%d @%d,%d · 글자 %dpx)" % (path, text, w, h, x0, y0, size))


if __name__ == "__main__":
    label = sys.argv[1] if len(sys.argv) > 1 else "괴산점"
    for p in ("tools/icon-master-512.png", "tools/icon-foreground-512.png"):
        repaint(p, label)
