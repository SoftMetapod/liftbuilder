"""Generate LiftBuilder app icons at all required sizes."""
import struct, zlib, math, os

ICONSET = os.path.join(os.path.dirname(__file__), 'icon.iconset')
os.makedirs(ICONSET, exist_ok=True)

GOLD   = (245, 130, 31)    # #F5821F
BLACK  = (14,  14,  14)    # #0E0E0E

# ── Minimal PNG writer ────────────────────────────────────────────────────────

def _chunk(tag, data):
    c = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', c)

def write_png(path, pixels, size):
    """pixels: list of (r,g,b,a) tuples, row-major."""
    raw = b''
    for y in range(size):
        raw += b'\x00'
        for x in range(size):
            r, g, b, a = pixels[y * size + x]
            raw += bytes([r, g, b, a])
    compressed = zlib.compress(raw, 9)
    png  = b'\x89PNG\r\n\x1a\n'
    png += _chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)[:13])
    # IHDR is width(4) height(4) bitdepth(1) colortype(2=RGB,6=RGBA) ...
    ihdr = struct.pack('>II', size, size) + bytes([8, 6, 0, 0, 0])
    png  = b'\x89PNG\r\n\x1a\n'
    png += _chunk(b'IHDR', ihdr)
    png += _chunk(b'IDAT', compressed)
    png += _chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)

# ── Pixel renderer ────────────────────────────────────────────────────────────

def render(size):
    px = [(0, 0, 0, 0)] * (size * size)

    radius = size * 0.18           # corner radius
    pad    = size * 0.10           # padding around "LB"

    def in_rounded_rect(x, y):
        x0, y0, x1, y1 = 0, 0, size - 1, size - 1
        if x < x0 or x > x1 or y < y0 or y > y1:
            return False
        cx = max(x0 + radius, min(x1 - radius, x))
        cy = max(y0 + radius, min(y1 - radius, y))
        return math.hypot(x - cx, y - cy) <= radius

    # Stroke-free bitmap font for "LB" — drawn as bezier-free rasterization
    # We'll render each glyph into a sub-grid and sample it.
    def glyph_L(gx, gy, gw, gh):
        """Return True if pixel (gx,gy) is inside 'L' glyph of size gw×gh."""
        sw = max(1, round(gw * 0.22))  # stroke width
        if gx < sw:                    # vertical stem
            return True
        if gy >= gh - sw:              # horizontal bar
            return True
        return False

    def glyph_B(gx, gy, gw, gh):
        """Return True if pixel (gx,gy) is inside 'B' glyph of size gw×gh."""
        sw = max(1, round(gw * 0.22))
        if gx < sw:                    # vertical stem
            return True
        # Top bump: covers upper half, right side rounded
        half = gh // 2
        bump_r = (gw - sw) * 0.72     # how far right the bumps extend
        if gy < half:
            cx = sw + bump_r * 0.5
            cy = half * 0.5
            rx = bump_r * 0.55
            ry = half * 0.55
            in_bump = ((gx - cx) / rx) ** 2 + ((gy - cy) / ry) ** 2 <= 1
            on_h_bar = (gy >= half - sw) and (gx < sw + bump_r)
            on_top   = (gy < sw) and (gx < sw + bump_r)
            if in_bump or on_h_bar or on_top:
                return True
        else:
            cx = sw + bump_r * 0.5
            cy = half + (gh - half) * 0.5
            rx = bump_r * 0.6
            ry = (gh - half) * 0.55
            in_bump = ((gx - cx) / rx) ** 2 + ((gy - cy) / ry) ** 2 <= 1
            on_h_bar = (gy >= half - sw) and (gy < half + sw) and (gx < sw + bump_r)
            on_bot   = (gy >= gh - sw) and (gx < sw + bump_r)
            if in_bump or on_h_bar or on_bot:
                return True
        return False

    # Place glyphs inside the icon with a small gap between them
    inner  = size - 2 * pad
    gap    = inner * 0.08
    gw     = (inner - gap) / 2
    gh     = inner * 0.72
    top_y  = pad + (inner - gh) / 2
    lx     = pad
    bx     = pad + gw + gap

    for y in range(size):
        for x in range(size):
            if not in_rounded_rect(x, y):
                px[y * size + x] = (0, 0, 0, 0)
                continue
            # Gold background
            r, g, b = GOLD
            # Check if inside L
            gx_l = x - lx
            gy_g = y - top_y
            if 0 <= gx_l < gw and 0 <= gy_g < gh:
                if glyph_L(int(gx_l), int(gy_g), int(gw), int(gh)):
                    r, g, b = BLACK
            # Check if inside B
            gx_b = x - bx
            if 0 <= gx_b < gw and 0 <= gy_g < gh:
                if glyph_B(int(gx_b), int(gy_g), int(gw), int(gh)):
                    r, g, b = BLACK
            px[y * size + x] = (r, g, b, 255)

    return px

# ── macOS iconset sizes ───────────────────────────────────────────────────────

SIZES = [16, 32, 64, 128, 256, 512, 1024]
NAME_MAP = {
    16:   ['icon_16x16.png'],
    32:   ['icon_16x16@2x.png', 'icon_32x32.png'],
    64:   ['icon_32x32@2x.png'],
    128:  ['icon_128x128.png'],
    256:  ['icon_128x128@2x.png', 'icon_256x256.png'],
    512:  ['icon_256x256@2x.png', 'icon_512x512.png'],
    1024: ['icon_512x512@2x.png'],
}

for size in SIZES:
    pixels = render(size)
    for name in NAME_MAP[size]:
        path = os.path.join(ICONSET, name)
        write_png(path, pixels, size)
        print(f'  wrote {name}')

# Also write a standalone 1024px PNG for the .ico builder
write_png(os.path.join(os.path.dirname(__file__), 'icon_1024.png'), render(1024), 1024)
print('Done.')
