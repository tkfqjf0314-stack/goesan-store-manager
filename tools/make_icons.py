#!/usr/bin/env python3
"""
KT 괴산점 개통장부 — 앱 아이콘 생성기
------------------------------------
`icons/icon-192.png`, `icons/icon-512.png`, `icons/apple-touch-icon.png`(180) 를 만듭니다.

디자인: 밝은 블루 그라데이션 바탕 + 흰 장부 카드 + KT 워드마크 띠 + 장부 줄.
- 모든 요소를 가운데 80% 안전 영역 안에 두어 `purpose: "any maskable"` 로도 잘리지 않습니다.
- 4배 슈퍼샘플링 후 축소해 곡선 테두리를 매끄럽게 유지합니다.

사용법:  python3 tools/make_icons.py
"""
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "icons"
SS = 4  # supersample factor

FONT_BOLD = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(size, top_left, bottom_right):
    """대각선 그라데이션. 작게 그린 뒤 확대해 빠르게 만든다."""
    small = 64
    img = Image.new("RGB", (small, small))
    px = img.load()
    for y in range(small):
        for x in range(small):
            t = (x / (small - 1)) * 0.35 + (y / (small - 1)) * 0.65
            px[x, y] = lerp(top_left, bottom_right, min(max(t, 0.0), 1.0))
    return img.resize((size, size), Image.BICUBIC)


def draw_icon(size: int) -> Image.Image:
    S = size * SS

    # ---- 바탕: 하늘색 → KT 블루 계열 ----
    img = gradient(S, (56, 189, 248), (3, 105, 161)).convert("RGBA")

    # 위쪽 은은한 하이라이트 (부드러운 빛 번짐)
    glow = Image.new("L", (S, S), 0)
    ImageDraw.Draw(glow).ellipse(
        [-S * 0.30, -S * 0.62, S * 0.90, S * 0.34], fill=110
    )
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.10))
    img = Image.composite(Image.new("RGB", (S, S), (125, 211, 252)), img.convert("RGB"), glow).convert("RGBA")

    # ---- 흰 장부 카드 ----
    card_w, card_h = S * 0.472, S * 0.545
    x0, y0 = (S - card_w) / 2, (S - card_h) / 2
    x1, y1 = x0 + card_w, y0 + card_h
    r = S * 0.075
    band_h = S * 0.115

    card_box = [x0, y0, x1, y1]

    # 그림자
    shadow_mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(shadow_mask).rounded_rectangle(
        [x0 + S * 0.006, y0 + S * 0.030, x1 + S * 0.006, y1 + S * 0.030], radius=r, fill=95
    )
    shadow_mask = shadow_mask.filter(ImageFilter.GaussianBlur(S * 0.030))
    shadow = Image.new("RGBA", (S, S), (2, 40, 80, 255))
    img = Image.composite(shadow, img, shadow_mask)

    # 카드 본체
    card_mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(card_mask).rounded_rectangle(card_box, radius=r, fill=255)
    img = Image.composite(Image.new("RGBA", (S, S), (255, 255, 255, 255)), img, card_mask)

    # 카드 상단 KT 블루 띠 (카드 모양으로 잘라냄)
    band_rect = Image.new("L", (S, S), 0)
    ImageDraw.Draw(band_rect).rectangle([x0, y0, x1, y0 + band_h], fill=255)
    band_mask = ImageChops.multiply(card_mask, band_rect)
    img = Image.composite(Image.new("RGBA", (S, S), (2, 132, 199, 255)), img, band_mask)

    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    # KT 워드마크 (띠 안)
    if Path(FONT_BOLD).exists():
        font = ImageFont.truetype(FONT_BOLD, int(band_h * 0.66))
        bb = d.textbbox((0, 0), "KT", font=font)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        d.text(
            (x0 + (card_w - tw) / 2 - bb[0], y0 + (band_h - th) / 2 - bb[1]),
            "KT", font=font, fill=(255, 255, 255, 255),
        )

    # 장부 줄 3개
    pad = card_w * 0.145
    lx0, lx1 = x0 + pad, x1 - pad
    rows_y = y0 + band_h + S * 0.070
    gap = S * 0.096
    dot_r = S * 0.020
    colors = [(2, 132, 199, 255), (148, 163, 184, 255), (203, 213, 225, 255)]
    widths = [0.62, 0.88, 0.52]
    for i in range(3):
        cy = rows_y + gap * i
        d.ellipse([lx0, cy - dot_r, lx0 + dot_r * 2, cy + dot_r], fill=colors[i])
        sx = lx0 + dot_r * 2 + S * 0.026
        ex = sx + (lx1 - sx) * widths[i]
        h = S * 0.017
        d.rounded_rectangle([sx, cy - h / 2, ex, cy + h / 2], radius=h / 2, fill=colors[i])

    img = Image.alpha_composite(img, layer)
    return img.convert("RGB").resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for size, name in ((512, "icon-512.png"), (192, "icon-192.png"), (180, "apple-touch-icon.png")):
        draw_icon(size).save(OUT / name, "PNG", optimize=True)
        print("wrote", OUT / name)


if __name__ == "__main__":
    main()
