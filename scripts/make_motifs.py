#!/usr/bin/env python3
"""Draw the small SVG motifs shown for papers that have no teaser image yet.

    python3 scripts/make_motifs.py        # rewrites _includes/motifs/*.svg

Each motif is a 400x180 (20:9) drawing. Strokes and fills that should follow the
light/dark theme use the `mo-*` classes defined in assets/css/main.css; the
normal-map and gray-ramp colors are fixed. Standard library only.
"""
import math
from pathlib import Path

W, H = 400, 180
OUT = Path(__file__).resolve().parent.parent / "_includes" / "motifs"


def svg(body: str) -> str:
    return (
        f'<svg class="motif" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid slice" '
        f'aria-hidden="true" focusable="false">{body}</svg>\n'
    )


def fmt(v: float) -> str:
    return f"{v:.1f}".rstrip("0").rstrip(".")


# --- modes: a few-step student collapses onto one mode of the teacher density -----------------

def mixture(x, comps):
    return sum(w * math.exp(-((x - mu) ** 2) / (2 * s * s)) for mu, s, w in comps)


def modes() -> str:
    base, scale, x0, x1 = 142, 96, 24, 376
    teacher = [(112, 30, 0.92), (214, 21, 0.56), (300, 25, 0.76)]
    student = [(112, 23, 1.10), (214, 19, 0.13), (300, 21, 0.20)]

    def curve(comps):
        xs = [x0 + i * 4 for i in range((x1 - x0) // 4 + 1)]
        return " ".join(f"{fmt(x)} {fmt(base - scale * mixture(x, comps))}" for x in xs)

    t, s = curve(teacher), curve(student)
    parts = [
        f'<path class="mo-fill" d="M{x0} {base} L{s} L{x1} {base}Z"/>',
        f'<path class="mo-stroke" d="M{s}"/>',
        f'<path class="mo-dash" d="M{t}"/>',
        f'<path class="mo-rule" d="M{x0} {base}H{x1}"/>',
    ]
    # arrows lifting the two under-represented modes back toward the teacher
    for mu, _, _ in teacher[1:]:
        top = base - scale * mixture(mu, teacher) + 9
        bottom = base - scale * mixture(mu, student) - 7
        parts.append(
            f'<path class="mo-stroke" d="M{mu} {fmt(bottom)}V{fmt(top)}'
            f'M{mu - 4.5} {fmt(top + 5.5)}L{mu} {fmt(top)}L{mu + 4.5} {fmt(top + 5.5)}"/>'
        )
    return svg("".join(parts))


# --- facets: spheres of increasing resolution, shaded by their surface normals ------------------

def icosphere(level: int):
    t = (1 + 5 ** 0.5) / 2
    verts = [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t),
             (0, -1, -t), (0, 1, -t), (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]
    faces = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4),
             (11, 10, 2), (10, 7, 6), (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8),
             (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]

    def unit(p):
        n = math.sqrt(sum(c * c for c in p))
        return tuple(c / n for c in p)

    verts = [unit(v) for v in verts]
    for _ in range(level):
        cache, out = {}, []

        def mid(a, b):
            key = (min(a, b), max(a, b))
            if key not in cache:
                verts.append(unit(tuple((verts[a][i] + verts[b][i]) / 2 for i in range(3))))
                cache[key] = len(verts) - 1
            return cache[key]

        for a, b, c in faces:
            ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
            out += [(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)]
        faces = out
    return verts, faces


def rotate(p, yaw, pitch):
    x, y, z = p
    x, z = x * math.cos(yaw) + z * math.sin(yaw), -x * math.sin(yaw) + z * math.cos(yaw)
    y, z = y * math.cos(pitch) - z * math.sin(pitch), y * math.sin(pitch) + z * math.cos(pitch)
    return x, y, z


def facets() -> str:
    parts = []
    radius = 56
    for level, cx, edge in ((0, 86, 0.9), (1, 200, 0.7), (2, 314, 0.4)):
        verts, faces = icosphere(level)
        verts = [rotate(v, 0.42, -0.34) for v in verts]
        group = []
        for face in faces:
            pts = [verts[i] for i in face]
            n = [sum(p[i] for p in pts) for i in range(3)]
            length = math.sqrt(sum(c * c for c in n))
            n = [c / length for c in n]
            if n[2] <= 0:  # back-facing
                continue
            color = "#" + "".join(f"{round((c * 0.5 + 0.5) * 255):02x}" for c in n)
            d = "L".join(f"{fmt(cx + radius * p[0])} {fmt(H / 2 - radius * p[1])}" for p in pts)
            group.append(f'<path d="M{d}Z" fill="{color}"/>')
        parts.append(f'<g class="mo-facets" stroke-width="{edge}">{"".join(group)}</g>')
    return svg("".join(parts))


# --- exposure: a sparse and a dense step wedge from dark to bright ------------------------------

def exposure() -> str:
    x0, x1, h = 44, 356, 34
    dark, bright = (0x17, 0x19, 0x20), (0xF3, 0xF4, 0xFA)
    parts = ['<defs>']
    rows = ((5, 46), (39, 100))
    for i, (_, y) in enumerate(rows):
        parts.append(f'<clipPath id="mo-wedge-{i}"><rect x="{x0}" y="{y}" width="{x1 - x0}" height="{h}" rx="5"/></clipPath>')
    parts.append('</defs>')
    for i, (steps, y) in enumerate(rows):
        w = (x1 - x0) / steps
        cells = []
        for k in range(steps):
            t = (k / (steps - 1)) ** 0.9
            color = "#" + "".join(f"{round(a + (b - a) * t):02x}" for a, b in zip(dark, bright))
            cells.append(f'<rect x="{fmt(x0 + k * w)}" y="{y}" width="{fmt(w + 0.6)}" height="{h}" fill="{color}"/>')
        parts.append(f'<g clip-path="url(#mo-wedge-{i})">{"".join(cells)}</g>')
        parts.append(f'<rect class="mo-frame" x="{x0}" y="{y}" width="{x1 - x0}" height="{h}" rx="5"/>')
    return svg("".join(parts))


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, draw in (("modes", modes), ("facets", facets), ("exposure", exposure)):
        path = OUT / f"{name}.svg"
        path.write_text(draw())
        print(f"{path.relative_to(OUT.parent.parent)}  {path.stat().st_size} bytes")
