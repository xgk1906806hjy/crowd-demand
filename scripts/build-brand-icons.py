"""从品牌源图生成站点图标（favicon / App / PWA）。

用法（项目根目录）：python scripts/build-brand-icons.py
输入：public/brand/icon-source.png（透明底 1:1 源图，仅作参照，可替换后重跑）
输出：
  src/app/icon.png            512   Next.js App Router 自动注入 <link rel="icon">
  src/app/apple-icon.png      180   iOS 添加到主屏
  src/app/favicon.ico         16/32/48 多尺寸，兼容旧浏览器与 /favicon.ico
  public/brand/icon-1024.png        品牌素材（设计稿/运营使用）
  public/brand/icon-512.png         PWA / Android 自适应
  public/brand/icon-192.png         PWA
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "brand" / "icon-source.png"

# 内容四周留白比例：图标贴边会在小尺寸下显得拥挤
PADDING_RATIO = 0.06


def load_padded(size: int) -> Image.Image:
    im = Image.open(SOURCE).convert("RGBA")
    bbox = im.split()[3].getbbox()
    if bbox:
        im = im.crop(bbox)
    side = max(im.width, im.height)
    pad = int(side * PADDING_RATIO)
    canvas = Image.new("RGBA", (side + pad * 2, side + pad * 2), (0, 0, 0, 0))
    canvas.paste(im, ((canvas.width - im.width) // 2, (canvas.height - im.height) // 2), im)
    return canvas.resize((size, size), Image.LANCZOS)


def main() -> None:
    targets = [
        (ROOT / "src" / "app" / "icon.png", 512),
        (ROOT / "src" / "app" / "apple-icon.png", 180),
        (ROOT / "public" / "brand" / "icon-1024.png", 1024),
        (ROOT / "public" / "brand" / "icon-512.png", 512),
        (ROOT / "public" / "brand" / "icon-192.png", 192),
    ]
    for path, size in targets:
        load_padded(size).save(path, "PNG", optimize=True)
        print(f"写入 {path.relative_to(ROOT)} ({size}x{size})")

    ico_base = load_padded(256)
    ico_path = ROOT / "src" / "app" / "favicon.ico"
    ico_base.save(ico_path, "ICO", sizes=[(16, 16), (32, 32), (48, 48)])
    print(f"写入 {ico_path.relative_to(ROOT)} (16/32/48)")


if __name__ == "__main__":
    main()
