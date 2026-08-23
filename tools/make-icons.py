"""Generate AVA's PNG icons with no image-library dependency.

Draws into a raw RGBA buffer and writes a minimal PNG (zlib is stdlib), so the
icons are reproducible from source rather than checked in as opaque binaries.
"""
import zlib, struct, math

NAVY = (5, 16, 27)
NAVY_HI = (18, 41, 62)
BRASS = (201, 162, 39)
BRASS_HI = (227, 189, 74)
TEAL = (77, 158, 154)


def blend(dst, src, a):
    return tuple(round(d + (s - d) * a) for d, s in zip(dst, src))


def make(size, maskable=False):
    px = [[NAVY for _ in range(size)] for _ in range(size)]
    cx = cy = (size - 1) / 2

    # Radial ground so the icon does not read as a flat block.
    for y in range(size):
        for x in range(size):
            d = math.hypot(x - cx, y - cy) / (size / 2)
            px[y][x] = blend(NAVY_HI, NAVY, min(1.0, d * 0.95))

    # Maskable icons need their art inside the safe circle (~80% of the canvas).
    scale = 0.62 if maskable else 0.78
    r_out = size * scale / 2
    r_in = r_out - max(2.0, size * 0.022)

    def ring(x, y):
        d = math.hypot(x - cx, y - cy)
        # Antialiased annulus.
        return max(0.0, min(1.0, (r_out - d) + 0.5)) * max(0.0, min(1.0, (d - r_in) + 0.5))

    for y in range(size):
        for x in range(size):
            a = ring(x, y)
            if a > 0:
                px[y][x] = blend(px[y][x], BRASS, a)

    # Compass rose: four brass points, four shorter teal points.
    arm = r_in * 0.86
    for i in range(8):
        ang = math.radians(i * 45)
        major = i % 2 == 0
        length = arm if major else arm * 0.52
        colour = BRASS_HI if major else TEAL
        half = (size * 0.055) if major else (size * 0.032)
        ux, uy = math.sin(ang), -math.cos(ang)
        steps = max(1, int(length * 3))
        for s in range(steps):
            t = s / steps
            # Taper each point to a tip.
            w = half * (1 - t)
            px_x, px_y = cx + ux * length * t, cy + uy * length * t
            rad = max(0.6, w)
            x0, x1 = int(px_x - rad - 1), int(px_x + rad + 2)
            y0, y1 = int(px_y - rad - 1), int(px_y + rad + 2)
            for yy in range(max(0, y0), min(size, y1)):
                for xx in range(max(0, x0), min(size, x1)):
                    d = math.hypot(xx - px_x, yy - px_y)
                    a = max(0.0, min(1.0, (rad - d) + 0.5))
                    if a > 0:
                        px[yy][xx] = blend(px[yy][xx], colour, a)

    # Hub.
    hub = size * 0.058
    for y in range(size):
        for x in range(size):
            d = math.hypot(x - cx, y - cy)
            a = max(0.0, min(1.0, (hub - d) + 0.5))
            if a > 0:
                px[y][x] = blend(px[y][x], NAVY, a)
            a2 = max(0.0, min(1.0, (hub * 0.55 - d) + 0.5))
            if a2 > 0:
                px[y][x] = blend(px[y][x], BRASS_HI, a2)
    return px


def write_png(path, px):
    size = len(px)
    raw = bytearray()
    for row in px:
        raw.append(0)                      # filter type 0
        for r, g, b in row:
            raw += bytes((r, g, b))

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)
    return len(png)


for name, size, maskable in [
    ('icons/icon-192.png', 192, False),
    ('icons/icon-512.png', 512, False),
    ('icons/icon-512-maskable.png', 512, True),
    ('icons/apple-touch-icon.png', 180, False),
]:
    n = write_png(name, make(size, maskable))
    print(f'{name}  {size}x{size}  {n:,} bytes')
