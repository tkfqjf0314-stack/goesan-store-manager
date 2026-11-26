#!/usr/bin/env python3
"""KT 괴산점 개통장부 — 런처 아이콘 생성기

흰 바탕 + KT 공식 `kt` 마크(블랙·레드) + 붉은 `괴산점` + `개통장부` 아이콘을
밀도별 PNG로 만든다. 원본(마스터) 두 장만 있으면 되고, 그림은 여기서 다시 그리지 않는다.

  icon-master-512.png       레거시 아이콘(모서리 둥근 흰 카드) — 이 파일에서 48~192px
  icon-foreground-512.png   adaptive 전경(투명 배경, 안전 영역 안에 내용) — 108~432px

사용: python3 make_icons.py <res 디렉터리 경로>
"""
import pathlib
import sys

from PIL import Image, ImageDraw

HERE = pathlib.Path(__file__).resolve().parent
MASTER = HERE / "icon-master-512.png"
FOREGROUND = HERE / "icon-foreground-512.png"

LEGACY = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
ADAPTIVE = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
SS = 4  # 원형 마스크 슈퍼샘플링


def rounded(img, size, circular=False):
    s = size * SS
    mask = Image.new("L", (s, s), 0)
    md = ImageDraw.Draw(mask)
    if circular:
        md.ellipse([0, 0, s - 1, s - 1], fill=255)
    else:
        md.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=255)
    base = img.resize((s, s), Image.LANCZOS)
    out = Image.new("RGBA", (s, s), (255, 255, 255, 255))
    out.paste(base, (0, 0), mask)
    return out.resize((size, size), Image.LANCZOS)


def main(res):
    res = pathlib.Path(res)
    legacy = Image.open(MASTER).convert("RGB")
    fg = Image.open(FOREGROUND).convert("RGBA")

    for d, sz in LEGACY.items():
        out = res / ("mipmap-%s" % d)
        out.mkdir(parents=True, exist_ok=True)
        rounded(legacy, sz).convert("RGB").save(out / "ic_launcher.png")
        rounded(legacy, sz, circular=True).convert("RGB").save(out / "ic_launcher_round.png")
        print("mipmap-%s/ic_launcher.png  %dpx" % (d, sz))

    for d, sz in ADAPTIVE.items():
        out = res / ("mipmap-%s" % d)
        out.mkdir(parents=True, exist_ok=True)
        fg.resize((sz, sz), Image.LANCZOS).save(out / "ic_launcher_foreground.png")
        print("mipmap-%s/ic_launcher_foreground.png  %dpx" % (d, sz))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1])
