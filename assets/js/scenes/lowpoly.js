/* A moment at the beach, as a low-poly diorama.
 * Every surface is a mesh of flat facets, each lit from its own normal by the sun or the moon of
 * the hour, with a soft fill from the sky on the facets that face away. The sea is a triangulated
 * mesh whose vertices ride the waves; he is a faceted bust built in 3D (lean turns him a little).
 * The same meshes give the program's other views: normal, depth, seg, and wire (the mesh itself).
 * Canvas 2D only. window.BeachScene = { W, H, draw(ctx, state), hit(x, y), pick(x, y, state) }.
 * draw() is a pure function of the state: no clocks, no Math.random(). */
(() => {
  "use strict";

  const W = 480;
  const H = 400;
  const HORIZON = 178;
  const TAU = Math.PI * 2;
  const F = 520; // focal length, frame units
  const CAMH = 9.4; // camera height above the water, metres
  const KY = F * CAMH; // on the ground, (y - HORIZON) = KY / distance
  const SHORE = 286; // the waterline at the photo's tide
  const PHOTO_TIDE = 0.4;
  const CX = 209; // his centre line

  /* ---------- small helpers ---------- */

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = (lo, hi, v) => {
    const t = clamp((v - lo) / (hi - lo), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const frac = (v) => v - Math.floor(v);
  const hash = (n) => {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const noise = (x) => {
    const i = Math.floor(x);
    const f = x - i;
    return mix(hash(i), hash(i + 1), f * f * (3 - 2 * f)) * 2 - 1;
  };
  const norm3 = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };

  /* ---------- colour: shading happens in linear light ---------- */

  const LUT = new Uint8Array(4097);
  for (let i = 0; i <= 4096; i += 1) LUT[i] = Math.round(255 * Math.pow(i / 4096, 1 / 2.2));
  const enc = (v) => (v <= 0 ? 0 : v >= 1 ? 255 : LUT[(v * 4096 + 0.5) | 0]);
  const dec = (c) => Math.pow(c / 255, 2.2);
  const lin = (c) => [dec(c[0]), dec(c[1]), dec(c[2])];
  const tone = (v) => (v < 0.72 ? v : 0.72 + 0.28 * (1 - Math.exp((0.72 - v) / 0.28)));
  const STR = new Map();
  const hex = (R, G, B) => {
    const key = (R << 16) | (G << 8) | B;
    let s = STR.get(key);
    if (s === undefined) {
      s = "#" + (0x1000000 + key).toString(16).slice(1);
      STR.set(key, s);
    }
    return s;
  };
  const css = (r, g, b) => hex(enc(tone(r)), enc(tone(g)), enc(tone(b)));
  const cssS = (c) => hex(clamp(Math.round(c[0]), 0, 255), clamp(Math.round(c[1]), 0, 255), clamp(Math.round(c[2]), 0, 255));
  const rgba = (c, a) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${clamp(a, 0, 1).toFixed(3)})`;

  /* ---------- the light of the hour ---------- */

  const PAL = {
    night: { top: [9, 14, 32], mid: [16, 26, 54], hor: [34, 50, 86], key: [150, 175, 235], keyI: 0.55, amb: [70, 92, 160], ambI: 0.5, gnd: [30, 32, 44], deep: [8, 20, 42], near: [14, 34, 62], shal: [40, 64, 92], glow: [130, 150, 210], glowA: 0.2, stars: 1, sunC: [255, 250, 235] },
    dawn: { top: [76, 104, 166], mid: [194, 162, 182], hor: [255, 200, 162], key: [255, 196, 156], keyI: 0.95, amb: [176, 166, 206], ambI: 0.55, gnd: [130, 110, 104], deep: [44, 66, 114], near: [72, 98, 142], shal: [156, 164, 180], glow: [255, 196, 150], glowA: 0.5, stars: 0.12, sunC: [255, 230, 186] },
    day: { top: [78, 153, 194], mid: [141, 201, 216], hor: [235, 237, 218], key: [255, 247, 232], keyI: 1.18, amb: [156, 196, 242], ambI: 0.44, gnd: [214, 194, 164], deep: [27, 91, 121], near: [40, 141, 151], shal: [135, 195, 180], glow: [255, 252, 236], glowA: 0.32, stars: 0, sunC: [255, 252, 240] },
    golden: { top: [86, 128, 190], mid: [198, 188, 186], hor: [255, 216, 164], key: [255, 206, 142], keyI: 1.06, amb: [192, 180, 198], ambI: 0.46, gnd: [214, 170, 124], deep: [38, 78, 130], near: [66, 108, 150], shal: [170, 172, 166], glow: [255, 210, 146], glowA: 0.6, stars: 0, sunC: [255, 236, 178] },
    sunset: { top: [60, 74, 140], mid: [206, 130, 134], hor: [255, 170, 106], key: [255, 152, 94], keyI: 0.92, amb: [156, 128, 176], ambI: 0.47, gnd: [164, 114, 94], deep: [44, 50, 102], near: [88, 80, 122], shal: [192, 142, 134], glow: [255, 164, 104], glowA: 0.85, stars: 0.04, sunC: [255, 226, 176] },
    dusk: { top: [26, 33, 78], mid: [84, 72, 122], hor: [192, 120, 114], key: [210, 156, 176], keyI: 0.38, amb: [116, 106, 166], ambI: 0.47, gnd: [72, 62, 74], deep: [20, 28, 60], near: [38, 44, 82], shal: [92, 84, 108], glow: [222, 142, 132], glowA: 0.45, stars: 0.35, sunC: [255, 210, 170] },
  };
  const TIMELINE = [[0, "night"], [4.9, "night"], [6.3, "dawn"], [8.8, "day"], [15, "day"], [16.9, "golden"], [17.7, "sunset"], [18.5, "dusk"], [19.7, "night"], [24, "night"]];
  const PAL_KEYS = Object.keys(PAL.day);
  const LIN_KEYS = ["top", "mid", "hor", "key", "amb", "gnd", "deep", "near", "shal", "glow", "sunC"];
  /* High daylight, [hour, azimuth to the right of the camera, elevation]. */
  const HIGH_SUN = [[7.3, 26, 13], [9, 70, 35], [11, 140, 55], [13.2, 211, 59], [15, 268, 42], [16.2, 318, 20]];
  const track = (keys, h) => {
    if (h <= keys[0][0]) return [keys[0][1], keys[0][2]];
    for (let i = 0; i < keys.length - 1; i += 1) {
      const a = keys[i];
      const b = keys[i + 1];
      if (h <= b[0]) {
        const f = (h - a[0]) / (b[0] - a[0]);
        return [mix(a[1], b[1], f), mix(a[2], b[2], f)];
      }
    }
    const z = keys[keys.length - 1];
    return [z[1], z[2]];
  };
  const dirOf = (az, el) => {
    const a = (az * Math.PI) / 180;
    const e = (el * Math.PI) / 180;
    return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
  };
  const onSky = (d) => (d[2] < -0.05 ? [240 + (F * d[0]) / -d[2], HORIZON - (F * d[1]) / -d[2]] : null);
  // Unproject the common right-to-left sky track into this camera. Its
  // direction also lights the mesh and determines the reflection at sea.
  const skyRay = (phase, height) => norm3([
    (W * (0.96 - 0.86 * phase) - W / 2) / F,
    height * Math.sin(Math.PI * phase) / F,
    -1,
  ]);

  const LCACHE = new Map();
  const lighting = (hourIn) => {
    const hour = ((hourIn % 24) + 24) % 24;
    const ck = Math.round(hour * 400);
    if (LCACHE.has(ck)) return LCACHE.get(ck);
    let i = 0;
    while (i < TIMELINE.length - 2 && hour >= TIMELINE[i + 1][0]) i += 1;
    const A = PAL[TIMELINE[i][1]];
    const B = PAL[TIMELINE[i + 1][1]];
    const f = smooth(TIMELINE[i][0], TIMELINE[i + 1][0], hour);
    const L = { hour };
    for (const k of PAL_KEYS) L[k] = Array.isArray(A[k]) ? [mix(A[k][0], B[k][0], f), mix(A[k][1], B[k][1], f), mix(A[k][2], B[k][2], f)] : mix(A[k], B[k], f);
    for (const k of LIN_KEYS) L[k + "L"] = lin(L[k]);
    const dayPhase = (hour - 6) / 12;
    const nightPhase = (hour < 6 ? hour + 6 : hour - 18) / 12;
    const altitude = Math.sin(Math.PI * dayPhase);
    // Once the disc is above the frame, the high sun moves over the beach
    // and lights the front of the figure. Keep the transition continuous.
    const overhead = smooth(0.62, 0.93, altitude);
    const highSun = dirOf(...track(HIGH_SUN, hour));
    L.sunDir = norm3(mix3(skyRay(dayPhase, 330), highSun, overhead));
    L.moonDir = skyRay(nightPhase, 152); // high enough to pass above his head
    const sel = Math.asin(L.sunDir[1]) * 180 / Math.PI;
    const mel = Math.asin(L.moonDir[1]) * 180 / Math.PI;
    L.sunEl = sel;
    L.moonEl = mel;
    L.sunUp = smooth(-0.07, 0.03, altitude);
    L.moonUp = nightPhase > -0.05 && nightPhase < 1.05
      ? smooth(-0.05, 0.08, Math.sin(Math.PI * nightPhase)) * (1 - smooth(-0.1, 0.24, altitude))
      : 0;
    const wSun = smooth(-6, 0, sel);
    const kd = [mix(L.moonDir[0], L.sunDir[0], wSun), mix(L.moonDir[1], L.sunDir[1], wSun), mix(L.moonDir[2], L.sunDir[2], wSun)];
    kd[1] = Math.max(kd[1], 0.07);
    L.keyDir = norm3(kd);
    // he is lit by the same light, turned a little toward the camera so his face stays readable
    const k2 = L.keyDir;
    L.bustDir = norm3([k2[0] * 1.15, k2[1], (k2[2] >= 0.4 ? k2[2] : 0.4 + (k2[2] - 0.4) * 0.12) + 0.32]);
    L.sun = onSky(L.sunDir);
    L.moon = onSky(L.moonDir);
    // the glow in the sky around the light (it may stand outside the frame)
    const gd = sel > -8 ? L.sunDir : L.moonDir;
    const gp = onSky(gd);
    if (gp) {
      L.gx = gp[0];
      L.gy = gp[1];
      L.gr = mix(115, 240, smooth(0, 30, sel > -8 ? sel : mel));
    } else {
      L.gx = 240 + 420 * gd[0];
      L.gy = HORIZON - 520 * gd[1];
      L.gr = 330;
    }
    L.nightness = 1 - smooth(-8, 6, sel);
    LCACHE.set(ck, L);
    if (LCACHE.size > 64) LCACHE.delete(LCACHE.keys().next().value);
    return L;
  };

  /* shade one facet: albedo (linear), unit normal (y up, z toward the camera) -> SH (linear) */
  const SH = [0, 0, 0];
  const shade = (alb, nx, ny, nz, L, ld, keyK, specK, shin, ao, warm, bounce) => {
    const bo = bounce === undefined ? 0.4 : bounce;
    const up = 0.5 + 0.5 * ny;
    const fi = L.ambI * ao;
    const A = L.ambL;
    const G = L.gndL;
    let r = (A[0] * up + G[0] * (1 - up) * bo) * fi;
    let g = (A[1] * up + G[1] * (1 - up) * bo) * fi;
    let b = (A[2] * up + G[2] * (1 - up) * bo) * fi;
    if (warm) {
      // skin: light scattered under the surface warms the shadow side
      const m = (r + g + b) / 3;
      r = mix(r, m * 1.32, warm);
      g = mix(g, m * 0.98, warm);
      b = mix(b, m * 0.86, warm);
    }
    const dl = nx * ld[0] + ny * ld[1] + nz * ld[2];
    const K = L.keyL;
    if (dl > 0 && keyK > 0) {
      const k = dl * L.keyI * keyK;
      r += K[0] * k;
      g += K[1] * k;
      b += K[2] * k;
    }
    r *= alb[0];
    g *= alb[1];
    b *= alb[2];
    if (specK > 0 && keyK > 0) {
      const hx = ld[0];
      const hy = ld[1];
      const hz = ld[2] + 1;
      const nh = (nx * hx + ny * hy + nz * hz) / (Math.hypot(hx, hy, hz) || 1);
      if (nh > 0) {
        const sp = Math.pow(nh, shin) * specK * L.keyI * keyK;
        r += K[0] * sp;
        g += K[1] * sp;
        b += K[2] * sp;
      }
    }
    SH[0] = r;
    SH[1] = g;
    SH[2] = b;
  };

  /* ---------- drawing facets ----------
   * Overlap adjacent facets by a subpixel. Bevelled corners keep very acute
   * triangles from growing spikes along the silhouette. */

  let GROW = 0.3;
  let PCTX = null;
  let curStyle = null;
  let pending = 0;
  const facetPath = (ctx, ax, ay, bx, by, cx, cy) => {
    const la = Math.hypot(bx - cx, by - cy);
    const lb = Math.hypot(ax - cx, ay - cy);
    const lc = Math.hypot(ax - bx, ay - by);
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-7) return false;
    const pad = Math.sign(area) * GROW;
    const abX = (by - ay) * pad / lc, abY = (ax - bx) * pad / lc;
    const bcX = (cy - by) * pad / la, bcY = (bx - cx) * pad / la;
    const caX = (ay - cy) * pad / lb, caY = (cx - ax) * pad / lb;
    ctx.moveTo(ax + caX, ay + caY);
    ctx.lineTo(ax + abX, ay + abY);
    ctx.lineTo(bx + abX, by + abY);
    ctx.lineTo(bx + bcX, by + bcY);
    ctx.lineTo(cx + bcX, cy + bcY);
    ctx.lineTo(cx + caX, cy + caY);
    ctx.closePath();
    return true;
  };
  const flush = () => {
    if (pending) {
      PCTX.fillStyle = curStyle;
      PCTX.fill();
    }
    pending = 0;
    curStyle = null;
  };
  const put = (ax, ay, bx, by, cx, cy, style) => {
    if (style !== curStyle || pending === 0) {
      if (pending) {
        PCTX.fillStyle = curStyle;
        PCTX.fill();
        pending = 0;
      }
      PCTX.beginPath();
      curStyle = style;
    }
    if (facetPath(PCTX, ax, ay, bx, by, cx, cy)) pending += 1;
  };

  /* ---------- mesh construction tools ---------- */

  /* a strip of triangles between two rows of vertices, both running left to right */
  const zip = (X, Y, A, B, out) => {
    let i = 0;
    let k = 0;
    const d2 = (p, q) => (X[p] - X[q]) * (X[p] - X[q]) + (Y[p] - Y[q]) * (Y[p] - Y[q]);
    while (i < A.length - 1 || k < B.length - 1) {
      let down;
      if (i >= A.length - 1) down = true;
      else if (k >= B.length - 1) down = false;
      else down = d2(A[i], B[k + 1]) < d2(A[i + 1], B[k]);
      if (down) {
        out.push(A[i], B[k], B[k + 1]);
        k += 1;
      } else {
        out.push(A[i], B[k], A[i + 1]);
        i += 1;
      }
    }
  };
  /* Delaunay triangulation of hand-placed points (Bowyer-Watson) */
  const delaunay = (xs, ys) => {
    const n = xs.length;
    const X = xs.slice();
    const Y = ys.slice();
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < n; i += 1) {
      x0 = Math.min(x0, X[i]);
      y0 = Math.min(y0, Y[i]);
      x1 = Math.max(x1, X[i]);
      y1 = Math.max(y1, Y[i]);
    }
    const d = Math.max(x1 - x0, y1 - y0) * 30;
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    X.push(mx - d, mx + d, mx);
    Y.push(my - d, my - d, my + d);
    const mk = (a, b, c) => {
      const ax = X[a], ay = Y[a], bx = X[b], by = Y[b], cx = X[c], cy = Y[c];
      const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
      const A2 = ax * ax + ay * ay, B2 = bx * bx + by * by, C2 = cx * cx + cy * cy;
      const ux = (A2 * (by - cy) + B2 * (cy - ay) + C2 * (ay - by)) / D;
      const uy = (A2 * (cx - bx) + B2 * (ax - cx) + C2 * (bx - ax)) / D;
      return { a, b, c, ux, uy, r2: (ax - ux) * (ax - ux) + (ay - uy) * (ay - uy) };
    };
    let T = [mk(n, n + 1, n + 2)];
    for (let i = 0; i < n; i += 1) {
      const px = X[i];
      const py = Y[i];
      const edges = new Map();
      const keep = [];
      for (const t of T) {
        if ((px - t.ux) * (px - t.ux) + (py - t.uy) * (py - t.uy) < t.r2) {
          for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) {
            const key = u < v ? u * 8192 + v : v * 8192 + u;
            edges.set(key, edges.has(key) ? null : [u, v]);
          }
        } else keep.push(t);
      }
      T = keep;
      for (const e of edges.values()) if (e) T.push(mk(e[0], e[1], i));
    }
    const out = [];
    for (const t of T) if (t.a < n && t.b < n && t.c < n) out.push(t.a, t.b, t.c);
    return out;
  };
  const inPoly = (poly, x, y) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const inTri = (px, py, ax, ay, bx, by, cx, cy) => {
    const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
    const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
    const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  };

  /* ---------- the sky: a few large, soft facets ---------- */

  const SKY = (() => {
    const X = [];
    const Y = [];
    const rows = [];
    const ys = [-34, 22, 66, 104, 136, 160, 184];
    ys.forEach((y0, j) => {
      const n = 7;
      const sp = 620 / n;
      const off = j % 2 ? sp / 2 : 0;
      const edge = j === 0 || j === ys.length - 1;
      const row = [];
      for (let i = -1; i <= n + 1; i += 1) {
        const x = -70 + off + i * sp + (edge ? 0 : (hash(j * 13.7 + i * 3.1) - 0.5) * sp * 0.42);
        const y = y0 + (edge ? 0 : (hash(j * 5.3 + i * 9.7) - 0.5) * (y0 < 90 ? 20 : 10));
        row.push(X.length);
        X.push(x);
        Y.push(y);
      }
      rows.push(row);
    });
    const T = [];
    for (let j = 0; j < rows.length - 1; j += 1) zip(X, Y, rows[j], rows[j + 1], T);
    const V = [];
    for (let k = 0; k < T.length; k += 3) V.push(hash(k * 0.37 + 4.1) * 2 - 1);
    return { X, Y, T, V };
  })();

  const SKYC = [0, 0, 0];
  const skyAt = (L, x, y) => {
    const t = clamp(y / HORIZON, 0, 1);
    let a;
    let b;
    let f;
    if (t < 0.52) {
      a = L.topL;
      b = L.midL;
      f = t / 0.52;
    } else {
      a = L.midL;
      b = L.horL;
      f = Math.pow((t - 0.52) / 0.48, 1.35);
    }
    const dx = x - L.gx;
    const dy = y - L.gy;
    const g = L.glowA * Math.exp(-(dx * dx + dy * dy) / (L.gr * L.gr));
    SKYC[0] = mix(a[0], b[0], f) + L.glowL[0] * g;
    SKYC[1] = mix(a[1], b[1], f) + L.glowL[1] * g;
    SKYC[2] = mix(a[2], b[2], f) + L.glowL[2] * g;
    return SKYC;
  };

  const drawSky = (ctx, L, lean) => {
    const wash = ctx.createLinearGradient(0, 0, 0, HORIZON + 1);
    for (const stop of [0, 0.35, 0.66, 1]) {
      const c = skyAt(L, 240, stop * HORIZON);
      wash.addColorStop(stop, css(c[0], c[1], c[2]));
    }
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, W, HORIZON + 2);
    ctx.save();
    ctx.globalAlpha *= 0.23 - 0.09 * L.nightness;
    const sh = -lean * 1;
    const { X, Y, T, V } = SKY;
    for (let k = 0, q = 0; k < T.length; k += 3, q += 1) {
      const a = T[k], b = T[k + 1], c = T[k + 2];
      const cx = (X[a] + X[b] + X[c]) / 3;
      const cy = (Y[a] + Y[b] + Y[c]) / 3;
      const col = skyAt(L, cx, cy);
      const v = 1 + V[q] * 0.022;
      // The sky wash already covers this tessellation. No overdraw along
      // the transparent edges, which would darken into a mesh at dusk.
      ctx.beginPath();
      ctx.moveTo(X[a] + sh, Y[a]);
      ctx.lineTo(X[b] + sh, Y[b]);
      ctx.lineTo(X[c] + sh, Y[c]);
      ctx.closePath();
      ctx.fillStyle = css(col[0] * v, col[1] * v, col[2] * v);
      ctx.fill();
    }
    flush();
    ctx.restore();
  };

  /* ---------- sun, moon and stars ---------- */

  const discFacets = (cx, cy, r, n, rot, cb) => {
    for (let i = 0; i < n; i += 1) {
      const a0 = rot + (i / n) * TAU;
      const a1 = rot + ((i + 1) / n) * TAU;
      cb(i, cx, cy, cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, (a0 + a1) / 2);
    }
  };
  // A single sixteen-sided silhouette. Its glow is air, not a second
  // piece of geometry. The same perimeter is used in the construction view.
  const SUN_RIM = Array.from({ length: 16 }, (_, i) => {
    const angle = TAU * (i + .5) / 16;
    return [Math.cos(angle), Math.sin(angle)];
  });
  const sunGeom = (L, lean) => {
    if (!L.sun || L.sunUp <= .01) return null;
    const r = 12.2;
    return { x: L.sun[0] - lean * .6, y: L.sun[1], r, ry: r * (.91 + .09 * smooth(2, 16, L.sunEl)) };
  };
  /* The moon's own mesh on the unit disc: a hub, a ring at half its radius and a twelve-sided
     rim, 36 facets in all. cb(ax, ay, bx, by, cx, cy, index). */
  const MOON_SEAS = [[-0.3, -0.34, 0.34], [0.14, -0.06, 0.3], [-0.38, 0.36, 0.3], [0.12, 0.5, 0.24]];
  const MOON_MESH = (() => {
    const tris = [];
    const ring = (n, radius, turn) => Array.from({ length: n }, (_, i) => [Math.cos(turn + (i / n) * TAU) * radius, Math.sin(turn + (i / n) * TAU) * radius]);
    const inner = ring(6, 0.5, 0.3), outer = ring(12, 1, 0.3 - TAU / 24);
    for (let i = 0; i < 6; i += 1) {
      const a = inner[i], b = inner[(i + 1) % 6];
      tris.push([0, 0, a[0], a[1], b[0], b[1]]);
      const o0 = outer[(2 * i) % 12], o1 = outer[(2 * i + 1) % 12], o2 = outer[(2 * i + 2) % 12];
      tris.push([a[0], a[1], o0[0], o0[1], o1[0], o1[1]]);
      tris.push([a[0], a[1], o1[0], o1[1], b[0], b[1]]);
      tris.push([b[0], b[1], o1[0], o1[1], o2[0], o2[1]]);
    }
    return tris;
  })();
  const moonFacets = (cb) => MOON_MESH.forEach((f, i) => cb(f[0], f[1], f[2], f[3], f[4], f[5], i));
  const moonGeom = (L, lean) => {
    if (!L.moon || L.moonUp <= 0.01) return null;
    return { x: L.moon[0] - lean * 0.6, y: L.moon[1], r: 12.5 };
  };
  const drawLights = (ctx, L, t, lean) => {
    // stars
    if (L.stars > 0.02) {
      ctx.fillStyle = rgba([235, 240, 255], 1);
      for (let i = 0; i < 46; i += 1) {
        const x = hash(i * 3.7 + 1) * 500 - 10 - lean * 0.5;
        const y = Math.pow(hash(i * 5.1 + 2), 1.3) * 150 + 4;
        const tw = 0.6 + 0.4 * Math.sin(t * (1.3 + hash(i) * 2) + i * 2.3);
        const a = L.stars * (0.35 + 0.65 * hash(i * 9.3)) * tw * (1 - smooth(110, 165, y) * 0.6);
        if (a < 0.03) continue;
        const r = 0.55 + 1.05 * hash(i * 1.9 + 7);
        ctx.globalAlpha = clamp(a, 0, 1);
        ctx.beginPath();
        ctx.moveTo(x, y - r * 1.6);
        ctx.lineTo(x + r * 0.55, y);
        ctx.lineTo(x, y + r * 1.6);
        ctx.lineTo(x - r * 0.55, y);
        ctx.closePath();
        ctx.moveTo(x - r * 1.6, y);
        ctx.lineTo(x, y - r * 0.55);
        ctx.lineTo(x + r * 1.6, y);
        ctx.lineTo(x, y + r * 0.55);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    const sun = sunGeom(L, lean);
    if (sun && sun.y + sun.r * 3 > 0 && sun.y - sun.r * 3 < HORIZON) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, HORIZON);
      ctx.clip();
      const { x, y, r, ry } = sun;
      const gold = mix3(L.sunC, [255, 170, 102], .61);
      const halo = ctx.createRadialGradient(x, y, r * .72, x, y, r * 3.15);
      halo.addColorStop(0, rgba(gold, .62 * L.sunUp));
      halo.addColorStop(.32, rgba(gold, .34 * L.sunUp));
      halo.addColorStop(1, rgba(gold, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(x - r * 3.15, y - r * 3.15, r * 6.3, r * 6.3);
      ctx.beginPath();
      SUN_RIM.forEach(([u, v], i) => i ? ctx.lineTo(x + r * u, y + ry * v) : ctx.moveTo(x + r * u, y + ry * v));
      ctx.closePath();
      const photosphere = ctx.createLinearGradient(0, y - ry, 0, y + ry);
      const zenith = mix3(L.sunC, [255, 249, 220], .72);
      photosphere.addColorStop(0, rgba(zenith, L.sunUp));
      photosphere.addColorStop(.66, rgba(mix3(zenith, gold, .14), L.sunUp));
      photosphere.addColorStop(1, rgba(mix3(zenith, gold, .75), L.sunUp));
      ctx.fillStyle = photosphere;
      ctx.fill();
      ctx.restore();
    }
    const moon = moonGeom(L, lean);
    if (moon) {
      // A faceted moon, a little past full: lit from the upper left, three seas on its face,
      // its right limb in earthshine, and soft air around it.
      const u = L.moonUp;
      const { x, y, r } = moon;
      const C = lin([244, 240, 224]);
      const SEA_TONE = lin([150, 160, 190]);
      const glowC = [214, 227, 247];
      const halo = ctx.createRadialGradient(x, y, r * 0.7, x, y, r * 3.6);
      halo.addColorStop(0, rgba(glowC, u * 0.36));
      halo.addColorStop(0.3, rgba(glowC, u * 0.15));
      halo.addColorStop(1, rgba(glowC, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(x - r * 3.6, y - r * 3.6, r * 7.2, r * 7.2);
      moonFacets((ax, ay, bx, by, cx, cy, i) => {
        const mx = (ax + bx + cx) / 3, my = (ay + by + cy) / 3; // on the unit disc
        const sk = skyAt(L, x + mx * r, y + my * r);
        let v = 0.84 + 0.16 * clamp(-(mx * 0.7 + my * 0.7) * 1.3, -1, 1) - 0.05 * hash(i * 7.3);
        let sea = 0;
        for (const [sx, sy, sr] of MOON_SEAS) sea = Math.max(sea, 1 - Math.hypot(mx - sx, my - sy) / sr);
        const tone = mix3(C, SEA_TONE, clamp(sea * 1.6, 0, 0.78));
        const shadow = smooth(-0.1, 0.1, mx - 0.5 * Math.sqrt(Math.max(0, 1 - my * my))); // past the terminator
        v *= 1 - 0.72 * shadow;
        const c = mix3(tone, lin([120, 140, 190]), shadow * 0.45);
        put(x + ax * r, y + ay * r, x + bx * r, y + by * r, x + cx * r, y + cy * r,
          css(mix(sk[0], c[0] * v, u), mix(sk[1], c[1] * v, u), mix(sk[2], c[2] * v, u)));
      });
      flush();
    }
  };

  /* ---------- the ground: sand, wet sand and a rock ---------- */

  const shoreBase = (s) => SHORE + (clamp(s.tide, 0, 1) - PHOTO_TIDE) * 62;
  /* the waterline: a slow swash running up and down the sand */
  const waterline = (x, time, base) =>
    base + (x - 240) * 0.045 + 3.2 * Math.sin(x * 0.01 + 0.6) + 4.5 * Math.sin(time * 0.75) + 2.6 * Math.sin(x * 0.021 + time * 0.5) + 1.8 * noise(x * 0.045 + 3) + 1.1 * Math.sin(x * 0.083 + 1.7 - time * 0.3);
  /* parallax: how far a layer at screen depth y' (= y - HORIZON on the ground) slides with lean */
  const slide = (lean, yp) => -lean * (1 + yp * 0.038);

  const SAND = (() => {
    const ys = [226, 238, 249, 260, 271, 282, 293, 304, 316, 329, 344, 361, 380, 402, 426];
    const X = [];
    const Y = [];
    const WX = [];
    const WY = [];
    const WZ = [];
    const rows = [];
    ys.forEach((y0, j) => {
      const sp = 15 + 0.17 * (y0 - 178);
      const n = Math.ceil(640 / sp);
      const off = (j % 2) * sp * 0.5;
      const row = [];
      for (let i = 0; i <= n; i += 1) {
        const last = j === ys.length - 1;
        const x = -80 + off + i * sp + (hash(j * 7.1 + i * 1.37 + 50) - 0.5) * sp * 0.5;
        const y = y0 + (last ? 0 : (hash(j * 3.3 + i * 2.71 + 80) - 0.5) * (ys[j + 1] - y0) * 0.45);
        const D = KY / (y - HORIZON);
        const Xw = ((x - 240) * D) / F;
        const h = 0.16 * Math.sin(Xw * 0.21 + D * 0.4) + 0.1 * Math.sin(Xw * 0.53 - D * 0.9 + 1) + (hash(i * 9.1 + j * 4.3) - 0.5) * 0.14;
        row.push(X.length);
        X.push(x);
        Y.push(y - (F * h) / D);
        WX.push(Xw);
        WY.push(h);
        WZ.push(-D);
      }
      rows.push(row);
    });
    const T = [];
    for (let j = 0; j < rows.length - 1; j += 1) zip(X, Y, rows[j], rows[j + 1], T);
    const N = [];
    const C = [];
    for (let k = 0; k < T.length; k += 3) {
      const a = T[k], b = T[k + 1], c = T[k + 2];
      const ux = WX[b] - WX[a], uy = WY[b] - WY[a], uz = WZ[b] - WZ[a];
      const vx = WX[c] - WX[a], vy = WY[c] - WY[a], vz = WZ[c] - WZ[a];
      let n = norm3([uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]);
      if (n[1] < 0) n = [-n[0], -n[1], -n[2]];
      N.push(n[0], n[1], n[2]);
      C.push((X[a] + X[b] + X[c]) / 3, (Y[a] + Y[b] + Y[c]) / 3, hash(k * 0.71 + 9) * 2 - 1);
    }
    return { X, Y, T, N, C };
  })();
  const SAND_ALB = lin([228, 208, 172]);
  const WET_ALB = lin([150, 136, 120]);

  const drawSand = (ctx, s, L, t, lean, view) => {
    const { X, Y, T, N, C } = SAND;
    const base = shoreBase(s);
    const alb = [0, 0, 0];
    for (let k = 0, q = 0; k < T.length; k += 3, q += 1) {
      const a = T[k], b = T[k + 1], c = T[k + 2];
      const cx = C[q * 3], cy = C[q * 3 + 1], jit = C[q * 3 + 2];
      const wl = waterline(cx, t, base);
      if (cy < wl - 16) continue; // under the sea
      const sa = slide(lean, Y[a] - HORIZON), sb = slide(lean, Y[b] - HORIZON), sc = slide(lean, Y[c] - HORIZON);
      let style;
      if (view === "rgb") {
        const wet = 1 - smooth(wl - 1, wl + 30, cy);
        const damp = 1 - smooth(wl + 26, wl + 60, cy);
        for (let i = 0; i < 3; i += 1) alb[i] = mix(SAND_ALB[i], WET_ALB[i], wet * 0.85 + damp * 0.12) * (1 + jit * 0.035);
        shade(alb, N[q * 3], N[q * 3 + 1], N[q * 3 + 2], L, L.keyDir, 1, 0, 1, 1, 0);
        const refl = wet * 0.3;
        style = css(SH[0] + L.horL[0] * refl * L.ambI, SH[1] + L.horL[1] * refl * L.ambI, SH[2] + L.horL[2] * refl * L.ambI);
      } else style = flatStyle(view, "sand", cy, N[q * 3], N[q * 3 + 1], N[q * 3 + 2], jit);
      put(X[a] + sa, Y[a], X[b] + sb, Y[b], X[c] + sc, Y[c], style);
    }
    flush();
  };

  const ROCK = (() => {
    const pts = [
      [-14, 406, 0], [-12, 380, 4], [-4, 364, 10], [10, 355, 14], [26, 354, 14], [40, 362, 10], [50, 378, 6], [56, 406, 0],
      [6, 372, 26], [24, 368, 28], [38, 378, 22], [16, 390, 30], [-2, 392, 22], [32, 396, 24],
    ];
    const T = delaunay(pts.map((p) => p[0]), pts.map((p) => p[1]));
    return { P: pts, T };
  })();
  const ROCK_ALB = lin([148, 134, 124]);
  const drawRock = (ctx, s, L, lean, view, wireCb) => {
    const { P, T } = ROCK;
    const sh = -lean * 10;
    for (let k = 0; k < T.length; k += 3) {
      const A = P[T[k]], B = P[T[k + 1]], C = P[T[k + 2]];
      const u = [B[0] - A[0], -(B[1] - A[1]), B[2] - A[2]];
      const v = [C[0] - A[0], -(C[1] - A[1]), C[2] - A[2]];
      let n = norm3([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]);
      if (n[2] < 0) n = [-n[0], -n[1], -n[2]];
      const jit = hash(k * 1.7 + 3) * 2 - 1;
      let style;
      if (view === "rgb") {
        const alb = [ROCK_ALB[0] * (1 + jit * 0.06), ROCK_ALB[1] * (1 + jit * 0.06), ROCK_ALB[2] * (1 + jit * 0.06)];
        shade(alb, n[0], n[1], n[2], L, L.keyDir, 1, 0.05, 8, 1, 0);
        style = css(SH[0], SH[1], SH[2]);
      } else style = flatStyle(view, "rock", (A[1] + B[1] + C[1]) / 3, n[0], n[1], n[2], jit);
      put(A[0] + sh, A[1], B[0] + sh, B[1], C[0] + sh, C[1], style);
    }
    flush();
  };

  const PEBBLES = [[26, 338, 4.8], [36, 340, 3.0], [44, 337.7, 1.8], [431, 357, 4.6],
  [444, 361, 6.1], [454, 358.5, 2.5], [408, 329, 2.3], [413, 330, 1.4]];
  const beachStones = (L, lean, emit) => {
    for (const [base, y, size] of PEBBLES) {
      const x = base + slide(lean, y - HORIZON);
      const lift = size * (0.6 + hash(base) * 0.3);
      const dx = -L.keyDir[0] * size * (0.7 + 0.6 * (1 - L.keyDir[1]));
      const a = [x - size, y], b = [x + size, y], c = [x - size * 0.48, y - lift], d = [x + size * 0.32, y - lift * 0.74];
      const crest = [x - size * 0.13, y - lift * 0.38];
      emit(a, [x + dx, y + lift * 0.38], b, 'shadow');
      emit(a, c, crest, 'face'); emit(crest, c, d, 'top'); emit(crest, d, b, 'side'); emit(a, crest, b, 'foot');
    }
  };
  const drawBeachStones = (s, L, view) => {
    const tones = {
      shadow: mix3(L.gnd, L.deep, 0.28), face: mix3(L.gnd, L.mid, 0.45), top: mix3(L.gnd, L.hor, 0.33),
      side: mix3(L.gnd, L.deep, 0.44), foot: mix3(L.gnd, L.mid, 0.29)
    };
    beachStones(L, s.lean, (a, b, c, side) => {
      if (side === 'shadow' && view !== 'rgb') return;
      const color = view === 'rgb' ? cssS(tones[side].map(v => v * (0.88 - 0.46 * L.nightness))) :
        flatStyle(view, 'rock', a[1], side === 'side' ? 0.5 : -0.3, side === 'top' ? 0.9 : 0.5, 0.6, 0);
      put(a[0], a[1], b[0], b[1], c[0], c[1], color);
    });
    flush();
  };

  /* ---------- the sea: a mesh that rides the waves ---------- */

  const SEA_FR = [0.004, 0.02, 0.041, 0.067, 0.098, 0.135, 0.178, 0.226, 0.28, 0.339, 0.404, 0.474, 0.55, 0.632, 0.719, 0.811, 0.907, 1];
  const SEA = (() => {
    const XR = [];
    const FR = [];
    const SEED = [];
    const RW = [];
    const rows = [];
    SEA_FR.forEach((fr, j) => {
      const sp = 11 + 21 * Math.pow(fr, 0.8);
      const n = Math.ceil(640 / sp);
      const off = (j % 2) * sp * 0.5;
      const first = j === 0;
      const last = j === SEA_FR.length - 1;
      const row = [];
      for (let i = 0; i <= n; i += 1) {
        let f = fr;
        if (!first && !last) f += (hash(j * 4.7 + i * 6.1 + 3) - 0.5) * (SEA_FR[j + 1] - SEA_FR[j - 1]) * 0.28;
        row.push(XR.length);
        XR.push(-80 + off + i * sp + (hash(j * 11.3 + i * 1.9 + 7) - 0.5) * sp * 0.45);
        FR.push(f);
        SEED.push(hash(j * 31.1 + i * 17.3));
        RW.push(j);
      }
      rows.push(row);
    });
    const T = [];
    const Y0 = FR.map((f) => HORIZON + f * 108);
    for (let j = 0; j < rows.length - 1; j += 1) zip(XR, Y0, rows[j], rows[j + 1], T);
    const n = XR.length;
    return { XR, FR, SEED, RW, T, n, SX: new Float64Array(n), SY: new Float64Array(n), PX: new Float64Array(n), PY: new Float64Array(n), PZ: new Float64Array(n) };
  })();

  /* the breaking waves: four fronts roll from the open sea to the sand */
  const frontsOf = (s, t, shoreD) => {
    const wind = clamp(s.wind, 0, 1);
    const swell = clamp(s.swell, 0, 1);
    const speed = 0.045 + wind * 0.05;
    const out = [];
    for (let k = 0; k < 4; k += 1) {
      const p = frac(0.555 + k / 4 + t * speed);
      const D = shoreD + (300 - shoreD) * Math.pow(1 - p, 1.8);
      const grow = smooth(0.04, 0.44, p) * (1 - smooth(0.6, 1.0, p) * 0.8);
      const bulk = Math.exp(-Math.pow((p - 0.54) / 0.12, 2)) * (0.35 + 0.65 * swell);
      out.push({
        k,
        p,
        D,
        slant: 0.27 + 0.085 * Math.sin(k * 2.1),
        h: (0.3 + 1.1 * swell) * grow,
        w: 5 + 26 * (1 - p),
        foam: smooth(0.4, 0.5, p) * (1 - smooth(0.92, 1.0, p)) * (0.45 + 0.55 * Math.max(swell, 0.2)),
        bulk,
      });
    }
    return out;
  };
  const seaHeight = (X, D, t, s, fronts, seed) => {
    const wind = clamp(s.wind, 0, 1);
    const sw = 0.35 + 0.9 * clamp(s.swell, 0, 1);
    const sp = 1 + wind * 0.7;
    let h = 0.3 * sw * Math.sin(D * 0.2 + X * 0.03 + t * 1.25 * sp) + 0.17 * sw * Math.sin(D * 0.36 - X * 0.07 + t * 1.8 * sp + 1.3) + 0.1 * (0.5 + wind) * Math.sin(D * 0.7 + X * 0.19 + t * 2.6 + 2.1);
    h *= Math.exp(-D / 240);
    for (let i = 0; i < fronts.length; i += 1) {
      const f = fronts[i];
      if (f.h < 0.01) continue;
      const dd = D - f.D - X * f.slant;
      const w = dd > 0 ? f.w * 1.5 : f.w * 0.55;
      if (Math.abs(dd) > w * 3) continue;
      h += f.h * Math.exp(-(dd * dd) / (w * w)) * (1 + 0.25 * Math.sin(X * 0.08 + f.k * 2 + t * 0.2));
    }
    // a shimmer that keeps the far facets tilting
    h += D * 0.0045 * (0.4 + wind) * Math.sin(t * (1.1 + seed * 1.4) + seed * 40);
    return h;
  };
  const computeSea = (s, t, lean, fronts) => {
    const { XR, FR, SEED, SX, SY, PX, PY, PZ, n } = SEA;
    const base = shoreBase(s);
    for (let i = 0; i < n; i += 1) {
      const x = XR[i];
      const wl = waterline(x, t, base) - HORIZON;
      const yp = Math.max(0.3, wl * FR[i]);
      const D = KY / yp;
      const Xw = ((x - 240) * D) / F;
      const h = seaHeight(Xw, D, t, s, fronts, SEED[i]) * smooth(0, 0.09, FR[i]);
      SX[i] = x + slide(lean, yp);
      SY[i] = HORIZON + yp - (F * h) / D;
      PX[i] = Xw;
      PY[i] = h - CAMH;
      PZ[i] = -D;
    }
  };
  const SEA_N = [0, 0, 0];
  const seaNormal = (a, b, c) => {
    const { PX, PY, PZ } = SEA;
    const ux = PX[b] - PX[a], uy = PY[b] - PY[a], uz = PZ[b] - PZ[a];
    const vx = PX[c] - PX[a], vy = PY[c] - PY[a], vz = PZ[c] - PZ[a];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    SEA_N[0] = nx;
    SEA_N[1] = ny;
    SEA_N[2] = nz;
    return SEA_N;
  };
  const seaColor = (L, n, cx, cyp, frac01, wlp, jit, exposure) => {
    // view vector toward the camera for a facet at screen depth cyp
    const D = KY / Math.max(cyp, 0.3);
    const Xw = ((cx - 240) * D) / F;
    let vx = -Xw;
    let vy = CAMH;
    let vz = D;
    const vl = Math.hypot(vx, vy, vz);
    vx /= vl;
    vy /= vl;
    vz /= vl;
    const nv = Math.max(0.02, n[0] * vx + n[1] * vy + n[2] * vz);
    const fres = 0.03 + 0.24 * Math.pow(1 - nv, 4);
    const rx = 2 * nv * n[0] - vx;
    const ry = 2 * nv * n[1] - vy;
    const rz = 2 * nv * n[2] - vz;
    // the sky seen in the reflection
    const el = clamp(ry, 0, 1);
    const st = clamp(0.45 + el * 2.4, 0, 1);
    const sk0 = st < 0.5 ? mix(L.horL[0], L.midL[0], st * 2) : mix(L.midL[0], L.topL[0], st * 2 - 1);
    const sk1 = st < 0.5 ? mix(L.horL[1], L.midL[1], st * 2) : mix(L.midL[1], L.topL[1], st * 2 - 1);
    const sk2 = st < 0.5 ? mix(L.horL[2], L.midL[2], st * 2) : mix(L.midL[2], L.topL[2], st * 2 - 1);
    // the body of the water: deep blue far away, turquoise near, shallow at the sand
    const near = smooth(0.05, 0.76, frac01);
    // Turquoise shallows trace a sandy bar running obliquely through
    // the surf. Breaks in the bar reveal the deeper water behind it.
    const bar = Math.exp(-Math.pow((frac01 - 0.71 + (cx - 240) * 0.00055) / 0.09, 2));
    const shal = smooth(0.81, 1, frac01) + 0.21 * bar * (0.55 + 0.45 * Math.cos(cx * 0.016));
    let b0 = mix(L.deepL[0], L.nearL[0], near);
    let b1 = mix(L.deepL[1], L.nearL[1], near);
    let b2 = mix(L.deepL[2], L.nearL[2], near);
    b0 = mix(b0, L.shalL[0], shal);
    b1 = mix(b1, L.shalL[1], shal);
    b2 = mix(b2, L.shalL[2], shal);
    const ld = L.keyDir;
    const dl = Math.max(0, n[0] * ld[0] + n[1] * ld[1] + n[2] * ld[2]);
    const lit = (0.55 + 0.7 * dl) * (1 + jit * 0.04);
    let r = b0 * lit * (1 - fres) + sk0 * fres;
    let g = b1 * lit * (1 - fres) + sk1 * fres;
    let b = b2 * lit * (1 - fres) + sk2 * fres;
    // the sun (or moon) glinting in the facets that mirror it
    const sd = L.sunUp > 0.02 ? L.sunDir : L.moonDir;
    const moonlit = L.sunUp <= 0.02;
    const up = moonlit ? L.moonUp * 0.045 : L.sunUp * exposure * 0.24;
    if (up > 0.01) {
      const rl = rx * sd[0] + ry * sd[1] + rz * sd[2];
      const th = moonlit ? 0.982 : 0.955;
      if (rl > th) {
        const gl = Math.pow((rl - th) / (1 - th), 5) * up;
        r += L.sunCL[0] * gl;
        g += L.sunCL[1] * gl;
        b += L.sunCL[2] * gl;
      }
    }
    // The capes replace the sky in the far water's reflection.
    const reflectedCape = smooth(291, 412, cx) * (1 - smooth(0, 12 + 0.055 * (cx - 290), cyp));
    const broken = reflectedCape * (0.43 + 0.11 * Math.sin(cyp * 2.7 + n[0] * 5));
    r = mix(r, L.deepL[0] * 0.6, broken);
    g = mix(g, L.deepL[1] * 0.67, broken);
    b = mix(b, L.deepL[2] * 0.63, broken);
    SH[0] = r;
    SH[1] = g;
    SH[2] = b;
  };

  const drawSea = (ctx, s, L, t, lean, view, exposure) => {
    const { T, SX, SY, FR } = SEA;
    const base = shoreBase(s);
    const windy = smooth(0.35, 1, clamp(s.wind, 0, 1)) * 0.9;
    for (let k = 0; k < T.length; k += 3) {
      const a = T[k], b = T[k + 1], c = T[k + 2];
      const cx = (SX[a] + SX[b] + SX[c]) / 3;
      const cy = (SY[a] + SY[b] + SY[c]) / 3;
      const fr = (FR[a] + FR[b] + FR[c]) / 3;
      const jit = hash(k * 0.13 + 1.1) * 2 - 1;
      let style;
      const n = seaNormal(a, b, c);
      if (view === "rgb") {
        const wl = waterline(cx, t, base) - HORIZON;
        seaColor(L, n, cx, cy - HORIZON, fr, wl, jit, exposure);
        // whitecaps: with wind, a few facets of the open sea break white for a moment
        const sd = hash(k * 0.77 + 5.3);
        if (windy > 0 && sd < 0.3 && fr > 0.06 && fr < 0.9) {
          const wc = windy * smooth(0.55, 1, Math.sin(t * (0.7 + sd) + sd * 61)) * (0.6 + 0.4 * jit);
          if (wc > 0.01) {
            const r = SH[0], g = SH[1], b = SH[2];
            shade(FOAM_ALB, n[0], n[1], n[2] + 0.4, L, L.keyDir, 0.85, 0, 1, 1, 0);
            SH[0] = mix(r, SH[0], wc);
            SH[1] = mix(g, SH[1], wc);
            SH[2] = mix(b, SH[2], wc);
          }
        }
        style = css(SH[0], SH[1], SH[2]);
      } else style = flatStyle(view, "sea", cy, n[0], n[1], n[2], jit);
      put(SX[a], SY[a], SX[b], SY[b], SX[c], SY[c], style);
    }
    flush();
  };

  // Grazing reflections break into short horizontal flashes between wave
  // faces. Keep their footprint slender even when the sun is low.
  const GLINTS = Array.from({ length: 112 }, (_, i) => ({
    x: -18 + 516 * frac(i * 0.61803398875), depth: 0.035 + 0.92 * hash(i * 3.1 + 2) ** 1.38,
    phase: TAU * hash(i * 3.1 + 13), width: 0.45 + 0.55 * hash(i * 1.3 + 8),
  }));
  const drawWaterLight = (ctx, s, L, t, lean, exposure) => {
    const solar = L.sunUp > .1;
    const lamp = solar ? L.sun : L.moonUp > .05 ? L.moon : null;
    const alignedX = lamp ? lamp[0] - lean * .6 : 0;
    const strength = solar ? exposure * L.sunUp * (1 - smooth(5, 23, L.sunEl)) : L.moonUp * .65;
    const color = L.sunUp > 0.1 ? mix3(L.hor, L.sunC, 0.76) : [186, 207, 236];
    ctx.fillStyle = cssS(color);
    const base = shoreBase(s);
    for (const mark of GLINTS) {
      const { depth, phase } = mark;
      const x = mark.x + 2.8 * Math.sin(t * 0.35 + phase) + slide(lean, depth * 108);
      const y = HORIZON + depth * (waterline(x, t, base) - HORIZON) + 1.3 * Math.sin(x * 0.033 + t * 0.71 + phase);
      const distance = lamp ? (x - alignedX) / (4 + depth * 31) : 0;
      const path = lamp ? strength * Math.exp(-distance * distance) : 0;
      const flash = smooth(0.25, 0.98, Math.cos(t * (0.64 + s.wind * 0.64) + phase));
      const power = flash * (0.14 * L.sunUp + 0.74 * path);
      if (power < 0.033) continue;
      const length = (2 + depth * 9) * mark.width * (0.63 + path * 1.1);
      const height = 0.30 + depth * 0.65 + path * 0.25;
      ctx.globalAlpha = power;
      ctx.beginPath();
      ctx.moveTo(x - length, y + height * 0.5);
      ctx.lineTo(x + length * 0.2, y - height * 0.5);
      ctx.lineTo(x + length, y - height * 0.15);
      ctx.lineTo(x - length * 0.25, y + height * 0.65);
      ctx.closePath();
      ctx.fill();
    }
    if (lamp && strength > .035 && alignedX > -45 && alignedX < W + 45) {
      for (let i = 0; i < 26; i++) {
        const u = (i + 0.38) / 26, scatter = hash(i * 17.4 + 6) * 2 - 1;
        const phase = TAU * hash(i + 3) + t * (0.65 + s.wind);
        const x = alignedX + (2 + u * 17) * scatter + Math.sin(phase) * u * 3;
        const y = HORIZON + (waterline(x, t, base) - HORIZON) * u + 0.85 * Math.sin(phase * 0.66);
        const width = (2.2 + u * 10.5) * (.50 + .50 * hash(i * 31.3 + 2)), height = .57 + u * .98;
        ctx.globalAlpha = strength * (.57 + .34 * Math.sin(phase)) * (1 - .40 * Math.abs(scatter));
        ctx.beginPath();
        ctx.moveTo(x - width, y + height * 0.35);
        ctx.lineTo(x + width * 0.25, y - height * 0.6);
        ctx.lineTo(x + width, y + height * 0.10);
        ctx.lineTo(x - width * 0.2, y + height * 0.5);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  };
  // Reflective remnants of the previous swash pool just above the wet line.
  const drawBackwash = (ctx, s, L, t, lean) => {
    const base = shoreBase(s);
    const sky = mix3(L.hor, L.mid, 0.22);
    for (const [cx, length, gap, width] of [[33, 108, 13, 2.7], [412, 96, 12, 3.3], [463, 64, 21, 2], [14, 45, 23, 1.6]]) {
      const points = [];
      const offset = slide(lean, base - HORIZON + gap);
      for (let k = 0; k <= 10; k++) {
        const u = k / 10, x = cx + (u - 0.5) * length;
        const y = waterline(x, t * 0.45, base) + gap + Math.sin(u * 5.3 + cx) * 1.8;
        const radius = width * Math.sin(u * Math.PI) ** 1.2 * (0.78 + 0.22 * Math.sin(u * 13));
        points.push([x + offset, y - radius * 0.5, y + radius * 0.5]);
      }
      ctx.beginPath();
      points.forEach(([x, upper], k) => k ? ctx.lineTo(x, upper) : ctx.moveTo(x, upper));
      for (let i = points.length - 1; i >= 0; i--) ctx.lineTo(points[i][0], points[i][2]);
      ctx.closePath();
      ctx.fillStyle = rgba(sky, 0.25 + 0.14 * L.sunUp);
      ctx.fill();
    }
  };

  /* foam: white facets riding the crests, breaking into lace as the wave runs in */
  const FOAM_COLS = 72;
  const foamRibbon = (s, t, lean, f, emit) => {
    if (f.foam < 0.04) return;
    const fronts = [f];
    let previous = null;
    for (let i = 0; i <= FOAM_COLS; i++) {
      const x = -60 + i * 600 / FOAM_COLS;
      const phase = x * 0.016 + f.k * 7 + t * (0.16 + s.wind * 0.25);
      const distance = f.D * (1 + 0.032 * Math.sin(phase) + 0.012 * noise(phase * 1.4)) / (1 - f.slant * (x - 240) / F);
      const worldX = (x - 240) * distance / F;
      const surface = seaHeight(worldX, distance, t, s, fronts, f.k) + 0.04;
      const coverage = smooth(-0.56, 0.48, noise(phase * 1.8 + 7) + f.foam * 0.45);
      const width = (0.18 + coverage * (1.2 + f.bulk * 2.7)) * (0.6 + s.swell * 0.8);
      const n = KY / distance;
      const sx = x + slide(lean, n), y = HORIZON + n - F * surface / distance;
      const top = [sx, y, worldX, surface - CAMH, -distance];
      const low = [sx + width * 0.8, y + width, worldX, surface - CAMH - 0.015, -distance + width * distance / n];
      const faceWidth = (2.5 + f.bulk * 8.8) * coverage * s.swell;
      const toe = [low[0] + faceWidth * 0.7, low[1] + faceWidth, worldX, surface - CAMH - 0.52, -distance + (width + faceWidth) * distance / n];
      if (previous && coverage > 0.04) {
        if (faceWidth > 0.2) {
          emit([previous[1], low, toe], f, true);
          emit([previous[1], toe, previous[2]], f, true);
        }
        emit([previous[0], top, low], f);
        emit([previous[0], low, previous[1]], f);
      }
      previous = [top, low, toe];
    }
  };
  const FOAM_ALB = lin([209, 232, 230]);
  const triNormalW = (A, B, C) => {
    const ux = B[2] - A[2], uy = B[3] - A[3], uz = B[4] - A[4];
    const vx = C[2] - A[2], vy = C[3] - A[3], vz = C[4] - A[4];
    let n = norm3([uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]);
    if (n[1] < 0) n = [-n[0], -n[1], -n[2]];
    return n;
  };
  const drawFoam = (ctx, s, L, t, lean, view, fronts) => {
    const order = fronts.slice().sort((a, b) => b.D - a.D);
    for (const f of order) {
      foamRibbon(s, t, lean, f, (tr, front, face) => {
        const [A, B, C] = tr;
        const n = triNormalW(A, B, C);
        let style;
        if (view === "rgb" && face) {
          const water = mix3(L.nearL, L.shalL, 0.48 + 0.14 * n[1]);
          const sun = Math.max(0, n[0] * L.keyDir[0] + n[1] * L.keyDir[1] + n[2] * L.keyDir[2]);
          style = css(water[0] * (0.77 + 0.28 * sun), water[1] * (0.95 + 0.30 * sun), water[2] * (0.91 + 0.30 * sun));
        } else if (view === "rgb") {
          // foam faces the light more than the water around it: tilt the normal toward the camera a little
          const nn = norm3([n[0], n[1] * 0.8, n[2] + 0.45]);
          shade(FOAM_ALB, nn[0], nn[1], nn[2], L, L.keyDir, 0.85, 0, 1, 1, 0);
          const j = 1 + (hash(A[0] * 0.37 + B[1]) - 0.5) * 0.06;
          style = css(SH[0] * j, SH[1] * j, SH[2] * j);
        } else style = flatStyle(view, "sea", (A[1] + B[1] + C[1]) / 3, n[0], n[1], n[2], 0);
        put(A[0], A[1], B[0], B[1], C[0], C[1], style);
      });
    }
    flush();
  };
  /* the lace at the water's edge */
  const LACE_N = 70;
  const shoreLace = (s, t, lean, cb) => {
    const base = shoreBase(s);
    const swell = clamp(s.swell, 0, 1);
    const sp = 600 / LACE_N;
    const run = 0.5 + 0.5 * Math.cos(t * 0.75); // more lace while the water runs up
    let prev = null;
    for (let i = 0; i <= LACE_N; i += 1) {
      const x = -60 + i * sp + (hash(i * 4.1 + 2) - 0.5) * sp * 0.5;
      const wl = waterline(x, t, base);
      const yp = wl - HORIZON;
      const sx = x + slide(lean, yp);
      const hgt = (1.35 + noise(i * 0.24 + t * 0.12) * 1.15) * (0.6 + 0.6 * swell) * (0.7 + 0.5 * run);
      const cur = [sx, wl + 0.4, sx + (hash(i * 2.3) - 0.5) * 3, wl - hgt];
      if (prev) {
        const vis = noise(i * 0.51 + t * 0.15) < 0.28 + 0.35 * run;
        cb(prev, cur, vis, i);
      }
      prev = cur;
    }
  };
  const drawLace = (ctx, s, L, t, lean, view) => {
    shoreLace(s, t, lean, (p, q, vis, i) => {
      let style;
      if (view === "rgb") {
        const v = 0.88 + 0.12 * hash(i * 5.3);
        shade(FOAM_ALB, 0, 0.8, 0.6, L, L.keyDir, 0.85, 0, 1, 1, 0);
        style = css(SH[0] * v, SH[1] * v, SH[2] * v);
      } else style = flatStyle(view, "sea", p[1], 0, 1, 0, 0);
      put(p[0], p[1], q[0], q[1], (p[0] + q[0]) / 2 + (hash(i) - 0.5) * 4, Math.min(p[1], q[1]) + 0.2, style);
      if (vis) {
        put(p[0], p[1], p[2], p[3], q[0], q[1], style);
        put(q[0], q[1], p[2], p[3], q[2], q[3], style);
      }
    });
    flush();
  };

  // A small lateen-rigged dinghy drifts beyond the breakers. Hull, sail and
  // reflection belong to the sea in the controls and in the opening drawing.
  const SAIL = [
    [[-12, -1.2], [12, -1.6], [8, 1.2], 1], [[-12, -1.2], [8, 1.2], [-6, 1], 1],
    [[1, -2.4], [1.4, -18], [-7, -3], 0], [[1.4, -18], [-7, -3], [-9, -3.3], 3],
    [[2, -16], [2, -3.3], [9, -3.8], 2], [[-8, 2.8], [6, 3], [0, 3.8], 4],
  ];
  const hullFacets = (s, t, emit) => {
    const x = 76 + 18 * Math.sin(t * 0.024) - s.lean * 3.2;
    const y = 200 + 0.56 * Math.sin(t * (0.92 + s.wind * 0.52)) * s.swell;
    const roll = Math.sin(t * 0.72) * s.swell * 0.07;
    for (const [a, b, c, material] of SAIL) {
      emit(x + a[0] - a[1] * roll, y + a[1] + a[0] * roll, x + b[0] - b[1] * roll, y + b[1] + b[0] * roll,
        x + c[0] - c[1] * roll, y + c[1] + c[0] * roll, material);
    }
  };
  const drawDinghy = (s, t, L, view) => {
    const palette = [
      mix3(L.hor, L.sunC, 0.32), mix3(L.deep, L.gnd, 0.32),
      mix3(L.gnd, [205, 130, 87], 0.48), mix3(L.hor, L.mid, 0.54), mix3(L.deep, L.near, 0.54),
    ].map(c => cssS(c.map(n => n * (1 - L.nightness * 0.60))));
    hullFacets(s, t, (ax, ay, bx, by, cx, cy, material) => {
      const color = view === 'rgb' ? palette[material] : flatStyle(view, 'sea', cy, -0.34, 0.23, 0.91, 0);
      put(ax, ay, bx, by, cx, cy, color);
    });
    flush();
  };

  const TUFTS = [[477, 396, 1.02], [458, 394, 0.63], [494, 381, 0.96], [-4, 373, 0.58], [12, 369, 0.38], [439, 353, 0.40], [447, 354, 0.24]];
  const duneBlades = (s, t, emit) => {
    for (const [root, y, size] of TUFTS) {
      const x = root - s.lean * (y - HORIZON) * 0.043;
      for (let i = 0; i < 10; i++) {
        const k = root * 0.17 + i * 3.25;
        const dx = (hash(k) - 0.5) * 54 * size, h = (10 + 32 * hash(k + 0.5)) * size;
        const baseX = x + (hash(k + 3) - 0.5) * 15 * size;
        const gust = (Math.sin(t * (1 + s.wind) + k * 0.2) * s.wind * 2.6 + s.wind * 2) * size;
        const mx = baseX + dx * 0.50 + gust * 0.35, my = y - h * 0.67;
        const tip = baseX + dx + gust, ty = y - h, width = (1.4 + hash(k + 2)) * size;
        emit(baseX - width, y, mx, my, baseX + width, y, i, false);
        emit(baseX + width, y, mx, my, tip, ty, i, true);
        if (i % 5 === 0) emit(tip, ty, tip - 1.8 * size, ty - 7 * size, tip + 0.6 * size, ty - 8 * size, i, false);
      }
    }
  };
  const drawDunes = (s, t, L, view) => {
    const palette = view === 'rgb' ? [
      mix3(L.gnd, L.deep, 0.55), mix3(L.gnd, L.deep, 0.42), mix3(L.gnd, L.shal, 0.45),
    ].map(c => c.map(n => n * (1 - 0.53 * L.nightness))) : [];
    duneBlades(s, t, (ax, ay, bx, by, cx, cy, i, light) => {
      const color = view === 'rgb' ? cssS(palette[(i + (light ? 1 : 0)) % 3]) : flatStyle(view, 'sand', ay, -0.4, 0.5, 0.7, 0);
      put(ax, ay, bx, by, cx, cy, color);
    });
    flush();
  };

  /* ---------- walkers and gulls ---------- */

  /* The same five strollers in every style. Each keeps to one of the two stretches of shore that
   * show beside him (lo..hi, in frame units), walks to its end and turns back, so no walker is
   * ever hidden behind him and changing their number always shows. */
  const WALKERS = [
    { x: 30, lo: 12, hi: 62, speed: 1.5, top: [228, 92, 84], legs: [52, 60, 96], hair: [40, 34, 44], size: 1.36 },
    { x: 384, lo: 352, hi: 470, speed: 1.2, top: [246, 246, 250], legs: [48, 78, 140], hair: [70, 46, 40], size: 1.28 },
    { x: 440, lo: 352, hi: 470, speed: -1.1, top: [246, 200, 92], legs: [70, 74, 104], hair: [36, 32, 40], size: 1.22 },
    { x: 52, lo: 12, hi: 62, speed: -0.9, top: [90, 186, 168], legs: [60, 64, 90], hair: [90, 60, 44], size: 1.2 },
    { x: 412, lo: 352, hi: 470, speed: 1.8, top: [250, 168, 186], legs: [84, 90, 124], hair: [44, 36, 40], size: 1.4 },
  ];
  const strollAt = (w, t) => {
    const span = w.hi - w.lo;
    const u = (((w.x - w.lo + t * w.speed) / span) % 2 + 2) % 2; // 0..2: there and back
    return { x: w.lo + (u <= 1 ? u : 2 - u) * span, dir: (u <= 1 ? 1 : -1) * (w.speed > 0 ? 1 : -1) };
  };
  const walkerAt = (k, s, t, lean) => {
    const w = WALKERS[k];
    const { x: x0, dir } = strollAt(w, t);
    const feet = waterline(x0, t, shoreBase(s)) + 4;
    const x = x0 + slide(lean, feet - HORIZON);
    return { w, x, feet, z: w.size, dir, stride: Math.sin(t * 3.2 * Math.abs(w.speed) + k * 2) * 2 * w.size };
  };
  /* a walker as facets in screen space: [ax, ay, bx, by, cx, cy, part, side] */
  const walkerFacets = (x, feet, z, dir, stride) => {
    const out = [];
    const up = (v) => feet - v * z;
    const T = (ax, ay, bx, by, cx, cy, part, side) => out.push([ax, ay, bx, by, cx, cy, part, side]);
    const Q = (a, b, c, d, part, side) => {
      T(a[0], a[1], b[0], b[1], c[0], c[1], part, side);
      T(a[0], a[1], c[0], c[1], d[0], d[1], part, side);
    };
    // legs
    for (const sgn of [-1, 1]) {
      const hx = x + sgn * 0.75 * z;
      const fx = hx + sgn * stride;
      Q([hx - 0.75 * z, up(8.8)], [hx + 0.75 * z, up(8.8)], [fx + 0.55 * z, up(0)], [fx - 0.55 * z, up(0)], "legs", sgn);
    }
    // arms
    for (const sgn of [-1, 1]) {
      const sx = x + sgn * 2.1 * z;
      const hx = sx - sgn * stride * 0.8 + sgn * 0.3 * z;
      Q([sx - 0.5 * z, up(15.2)], [sx + 0.5 * z, up(15.2)], [hx + 0.45 * z, up(9.4)], [hx - 0.45 * z, up(9.4)], "top", sgn);
    }
    // torso: two halves, so one can catch the light
    T(x - 2.4 * z, up(15.6), x, up(16.2), x, up(8.2), "top", -1);
    T(x - 2.4 * z, up(15.6), x, up(8.2), x - 1.9 * z, up(8.2), "top", -1);
    T(x, up(16.2), x + 2.4 * z, up(15.6), x + 1.9 * z, up(8.2), "top", 1);
    T(x, up(16.2), x + 1.9 * z, up(8.2), x, up(8.2), "top", 1);
    // head: a small faceted gem with a cap of hair
    const hx = x + dir * 0.2 * z;
    const hy = up(19.1);
    const r = 2.1 * z;
    T(hx, hy - r, hx - r * 0.95, hy - r * 0.2, hx, hy + r, "skin", -1);
    T(hx, hy - r, hx, hy + r, hx + r * 0.95, hy - r * 0.2, "skin", 1);
    T(hx - r * 0.95, hy - r * 0.2, hx - r * 0.6, hy + r * 0.75, hx, hy + r, "skin", -1);
    T(hx + r * 0.95, hy - r * 0.2, hx, hy + r, hx + r * 0.6, hy + r * 0.75, "skin", 1);
    T(hx - r * 1.02, hy - r * 0.1, hx, hy - r * 1.12, hx + r * 1.02, hy - r * 0.1, "hair", 0);
    T(hx - r * 1.02, hy - r * 0.1, hx - dir * r * 0.2, hy - r * 0.45, hx - dir * r * 0.9, hy + r * 0.45, "hair", 0);
    return out;
  };
  const SKIN_W = lin([226, 180, 150]);
  const drawWalkers = (ctx, s, L, t, lean, view) => {
    const count = clamp(Math.round(s.walkers), 0, 5);
    const ld = L.keyDir;
    for (let k = 0; k < count; k += 1) {
      const { w, x, feet, z, dir, stride } = walkerAt(k, s, t, lean);
      const facets = walkerFacets(x, feet, z, dir, stride);
      const colorOf = (part, side) => {
        const alb = part === "skin" ? SKIN_W : lin(part === "hair" ? w.hair : part === "legs" ? w.legs : w.top);
        const nx = side * 0.7;
        const nz = 0.7;
        shade(alb, nx, 0.1, nz, L, ld, 1, 0, 1, 1, part === "skin" ? 0.4 : 0);
        return [SH[0], SH[1], SH[2]];
      };
      if (view === "rgb") {
        // the shadow on the wet sand and the reflection in it
        const sl = clamp(-ld[0] / Math.max(ld[1], 0.12), -3, 3) * 5 * z;
        ctx.fillStyle = rgba([40, 46, 70], 0.22 * Math.max(L.sunUp, L.moonUp * 0.5));
        ctx.beginPath();
        ctx.moveTo(x - 1.8 * z, feet + 0.3);
        ctx.lineTo(x + 1.8 * z, feet + 0.3);
        ctx.lineTo(x + sl + 0.6 * z, feet + 1.6 * z);
        ctx.lineTo(x + sl - 0.6 * z, feet + 1.6 * z);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 0.22;
        for (const f of facets) {
          const c = colorOf(f[6], f[7]);
          put(f[0], 2 * feet - f[1], f[2], 2 * feet - f[3], f[4], 2 * feet - f[5], css(c[0], c[1], c[2]));
        }
        flush();
        ctx.globalAlpha = 1;
        for (const f of facets) {
          const c = colorOf(f[6], f[7]);
          put(f[0], f[1], f[2], f[3], f[4], f[5], css(c[0], c[1], c[2]));
        }
        flush();
      } else {
        for (const f of facets) put(f[0], f[1], f[2], f[3], f[4], f[5], flatStyle(view, "walker", f[1], f[7] * 0.6, 0.1, 0.8, 0));
        flush();
      }
    }
  };

  const gullAt = (k, t) => {
    const span = W + 300;
    const x = ((t * (11 + k * 5) + k * 190) % span) - 40 - k * 190;
    if (x < -20 || x > W + 20) return null;
    const y = 52 + k * 30 + Math.sin(t * 0.6 + k * 2) * 9;
    const flap = Math.sin(t * 5.5 + k * 1.7);
    const sz = 1 - k * 0.22;
    return { x, y, flap, sz };
  };
  const gullFacets = (g) => {
    const { x, y, flap, sz } = g;
    const f = flap * 2.6 * sz;
    const out = [];
    const s = 7.5 * sz;
    // body
    out.push([x - 3 * sz, y + 0.2, x + 3.6 * sz, y - 0.2, x, y + 1.3 * sz, 0]);
    out.push([x - 3 * sz, y + 0.2, x, y - 0.9 * sz, x + 3.6 * sz, y - 0.2, 1]);
    for (const d of [-1, 1]) {
      const ex = x + d * s * 0.48;
      const ey = y - 2.2 * sz - f * 0.55;
      const tx = x + d * s;
      const ty = y - 0.6 * sz - f * 1.25;
      out.push([x - d * 0.8 * sz, y - 0.2, x + d * 1.4 * sz, y + 0.5 * sz, ex, ey, 2]);
      out.push([x + d * 1.4 * sz, y + 0.5 * sz, ex + d * 0.6, ey + 1.2 * sz, ex, ey, 3]);
      out.push([ex, ey, ex + d * 0.6, ey + 1.2 * sz, tx, ty, 2]);
    }
    return out;
  };
  const drawGulls = (ctx, s, L, t, view) => {
    for (let k = 0; k < 2; k += 1) {
      const g = gullAt(k, t);
      if (!g) continue;
      for (const f of gullFacets(g)) {
        let style;
        if (view === "rgb") {
          const ny = f[6] === 3 ? -0.3 : f[6] === 2 ? 0.2 + g.flap * 0.4 : 0.4;
          shade(lin([238, 240, 244]), 0, ny, 0.8, L, L.keyDir, 0.9, 0, 1, 1, 0);
          const sk = skyAt(L, g.x, g.y);
          style = css(mix(SH[0], sk[0], 0.18), mix(SH[1], sk[1], 0.18), mix(SH[2], sk[2], 0.18));
        } else style = flatStyle(view, "sky", g.y, 0, 0, 1, 0);
        put(f[0], f[1], f[2], f[3], f[4], f[5], style);
      }
      flush();
    }
  };

  /* ---------- him: a faceted bust, built in 3D ----------
   * Frame units: x right, y down, z toward the camera. Each vertex belongs to the body (0) or the
   * head (1); hair and strings carry a sway weight. Layers set the painting order; inside a layer,
   * facets are painted from back to front. */

  const PV = [];
  const PG = [];
  const PS = [];
  const PT = [];
  const PL = [];
  const PM = [];
  const LAYER = { torso: 0, hoodback: 1, neck: 2, strap: 3, hood: 4, string: 5, ear: 6, head: 7, hair: 8, lock: 9 };
  const MAT = { hoodie: 0, strap: 1, skin: 2, hair: 3, string: 4, ear: 5, inner: 6, tee: 7, metal: 8, binding: 9, lock: 10, hairSheen: 11, selvedge: 12, webEdge: 13, contact: 14, palm: 15 };
  const addV = (x, y, z, g, sw) => {
    PV.push(x, y, z);
    PG.push(g);
    PS.push(sw || 0);
    return PG.length - 1;
  };
  const addT = (a, b, c, layer, mat) => {
    PT.push(a, b, c);
    PL.push(layer);
    PM.push(mat);
  };
  const addMesh = (pts, tris, layer, mat, g, swFn) => {
    const base = PG.length;
    for (const p of pts) addV(p[0], p[1], p[2], g, swFn ? swFn(p) : 0);
    for (let k = 0; k < tris.length; k += 3) addT(base + tris[k], base + tris[k + 1], base + tris[k + 2], layer, mat);
    return base;
  };
  /* triangulate hand-placed points inside an outline */
  const meshIn = (pts, outline) => {
    const T = delaunay(pts.map((p) => p[0]), pts.map((p) => p[1]));
    const out = [];
    for (let k = 0; k < T.length; k += 3) {
      const a = pts[T[k]], b = pts[T[k + 1]], c = pts[T[k + 2]];
      const cx = (a[0] + b[0] + c[0]) / 3;
      const cy = (a[1] + b[1] + c[1]) / 3;
      if (inPoly(outline, cx, cy)) out.push(T[k], T[k + 1], T[k + 2]);
    }
    return out;
  };

  // Thin strata of sandstone, a grass headland, and the white daymark that
  // gives the bay its scale. Clouds and headlands share the construction mesh.
  const COAST = [];
  const panel = (layer, material, outline, ridges = []) => {
    const pts = outline.concat(ridges);
    const tris = meshIn(pts, outline);
    const xs = outline.map(p => p[0]), ys = outline.map(p => p[1]);
    COAST.push({      
layer, material, pts, tris, outline,
      bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]    
});
  };
  const distant = [
    [-35, 179], [-35, 154], [-3, 157], [16, 160], [28, 158], [49, 167], [63, 169], [95, 177], [111, 180],
  ];
  panel('hill', 'haze', distant, [[-4, 164], [16, 167], [41, 170]]);
  panel('hill', 'haze', [[278, 179], [302, 171], [323, 171], [346, 160], [357, 158], [372, 151], [385, 152], [390, 148], [409, 153], [433, 146], [456, 147], [489, 135], [500, 179]], [[337, 170], [372, 161], [391, 160], [428, 159], [461, 154]]);
  const cliff = [[321, 179], [335, 172], [348, 170], [355, 163], [366, 163], [380, 157], [390, 160], [401, 153], [416, 151], [435, 146], [450, 147], [464, 137], [496, 138], [500, 183], [320, 183]];
  panel('cape', 'cliff', cliff, [[351, 175], [374, 167], [400, 162], [426, 161], [454, 155], [477, 148], [465, 168], [399, 176]]);
  panel('cape', 'grass', [[324, 179], [338, 171], [348, 170], [355, 163], [366, 163], [380, 157], [390, 159], [401, 153], [416, 151], [435, 145], [450, 147], [464, 137], [496, 138], [496, 147], [466, 145], [449, 153], [435, 151], [416, 156], [400, 157], [391, 163], [380, 161], [362, 168], [348, 174]]);
  panel('cape', 'ledge', [[350, 174], [365, 168], [381, 165], [374, 169], [361, 171]]);
  panel('cape', 'ledge', [[390, 173], [406, 164], [421, 162], [414, 167], [400, 169]]);
  panel('cape', 'ledge', [[441, 164], [454, 157], [469, 154], [466, 158], [457, 158], [448, 164]]);
  panel('cape', 'ledge', [[375, 174], [385, 170], [397, 169], [387, 172]]);
  panel('cape', 'scree', [[419, 169], [427, 165], [440, 164], [434, 167], [425, 168]]);
  panel('cape', 'trail', [[393, 160.3], [403, 155.5], [417, 153.1], [424, 148], [426, 147.9],
  [418, 154.2], [406, 156.4], [397, 160.7]]);
  panel('cape', 'lightWall', [[424, 148], [426, 133], [429.5, 133], [432, 147]]);
  panel('cape', 'wallShade', [[428.5, 134], [429.5, 133], [432, 147], [430, 147]]);
  panel('cape', 'lantern', [[425, 134], [425, 133], [430.4, 133], [430.4, 134]]);
  panel('cape', 'lantern', [[425.8, 132.7], [425.8, 129], [429.7, 129], [429.7, 132.7]]);
  panel('cape', 'roof', [[424.4, 129], [427.7, 125.7], [431, 129]]);
  panel('cape', 'lightWall', [[418, 148], [418, 144], [423.8, 144], [423.8, 147]]);
  panel('cape', 'roof', [[417, 144.5], [418.9, 142], [423.7, 142], [425, 144.2]]);
  for (const [x, y, w] of [[467, 138, 3.2], [474, 139, 3.8], [479, 138, 2.6], [482, 138.6, 3.6], [488, 137.8, 3.1]]) {
    panel('cape', 'pine', [[x - w, y], [x - 0.9, y - 2.5 * w], [x + w, y]]);
  }

  // Each cloud has one long level base and a few wind-sheared sunlit planes.
  const cloud = (x, y, scale) => {
    const conv = pts => pts.map(([dx, dy]) => [x + dx * scale, y + dy * scale]);
    panel('cloud', 'cloud', conv([[-55, 6], [-43, 3], [-30, 2], [-22, -3], [-15, -2], [-9, -10], [-3, -12], [6, -10], [11, -4], [21, -6], [30, -3], [33, 0], [44, 1], [51, 4], [67, 6], [28, 8], [-22, 8]]), conv([[-12, 2], [1, -3], [11, 3], [29, 3]]));
    panel('cloud', 'vapour', conv([[-43, 6], [-23, 4], [-8, 5], [2, 3], [14, 4], [28, 3], [44, 5], [30, 8], [-17, 8]]));
    panel('cloud', 'wisp', conv([[45, 10], [63, 8], [79, 9], [62, 10.2]]));
  };
  cloud(29, 88, 1.12);
  cloud(368, 61, 0.95);
  panel('cloud', 'wisp', [[91, 54], [107, 51], [113, 48], [123, 47], [127, 49], [140, 48], [155, 51], [132, 52], [119, 51], [108, 54]]);
  panel('cloud', 'wisp', [[320, 86], [336, 83.5], [350, 84.5], [339, 86]]);

  const coastOffset = (layer, s, t) => layer === 'cloud'
    ? Math.sin(t * 0.016) * (6 + 7 * s.wind) - s.lean * 0.7
    : -s.lean * (layer === 'cape' ? 2.8 : 1.5);
  const solarScreened = (x, y, s, t) => {
    if (y >= HORIZON) return true;
    return COAST.some(({ layer, outline, bounds }) => {
      const u = x - coastOffset(layer, s, t);
      return u >= bounds[0] && u <= bounds[2] && y >= bounds[1] && y <= bounds[3] && inPoly(outline, u, y);
    });
  };
  const discExposure = (L, s, t, lean) => {
    const sun = sunGeom(L, lean);
    if (!sun) return 0;
    if (sun.y + sun.r < 0) return 1;
    if (sun.y - sun.ry >= HORIZON) return 0;
    let exposed = 0, count = 0;
    for (let j = -2; j <= 2; j++)for (let i = -2; i <= 2; i++) {
      if (i * i + j * j > 5) continue;
      count++;
      if (!solarScreened(sun.x + i * .4 * sun.r, sun.y + j * .4 * sun.ry, s, t)) exposed++;
    }
    return exposed / count;
  };
  const shorePalette = L => {
    const land = mix3(L.gnd, L.mid, 0.55);
    const grass = mix3(L.hor, [57, 108, 92], 0.66);
    const day = 1 - L.nightness * 0.80;
    const lit = rgb => rgb.map(n => n * day);
    return {
      haze: mix3(L.hor, L.mid, 0.52).map((n, i) => n * [0.83, 0.91, 0.95][i]),
      cliff: lit(mix3(land, [101, 112, 112], 0.37)), grass: lit(grass),
      scree: lit(mix3(land, L.gnd, 0.30)), trail: lit(mix3(grass, L.gnd, 0.52)),
      ledge: lit(mix3(land, L.hor, 0.16)), pine: lit(mix3(grass, L.deep, 0.5)),
      lightWall: lit(mix3(L.hor, [255, 244, 210], 0.60)), wallShade: lit(mix3(land, L.hor, 0.24)),
      roof: lit(mix3(L.gnd, [153, 84, 65], 0.7)), lantern: mix3(lit(mix3(L.deep, [46, 70, 70], 0.55)), [241, 190, 109], L.nightness * 0.80),
      cloud: mix3(L.mid, L.hor, 0.77), vapour: mix3(L.mid, L.hor, 0.52), wisp: mix3(L.mid, L.hor, 0.68)
    };
  };
  const coastFacets = (s, t, emit) => {
    for (const { layer, material, pts, tris } of COAST) {
      const dx = coastOffset(layer, s, t);
      for (let i = 0; i < tris.length; i += 3) {
        const a = pts[tris[i]], b = pts[tris[i + 1]], c = pts[tris[i + 2]];
        emit(a[0] + dx, a[1], b[0] + dx, b[1], c[0] + dx, c[1], layer, material, i);
      }
    }
  };
  const drawCoast = (s, t, L, view) => {
    const palette = view === 'rgb' ? shorePalette(L) : null;
    coastFacets(s, t, (ax, ay, bx, by, cx, cy, layer, material, i) => {
      const jitter = hash(i * 2.9 + ax * 0.25);
      let color;
      if (view === 'rgb') {
        const k = 1 + (jitter - 0.5) * (material === 'cliff' ? 0.21 : 0.063);
        color = cssS(palette[material].map(n => n * k));
      } else if (layer === 'cloud') color = flatStyle(view, 'sky', 0, 0, 0, 1, 0);
      else if (view === 'depth') color = layer === 'hill' ? '#181818' : '#222222';
      else color = flatStyle(view, 'rock', 170, (jitter - 0.5) * 0.66, material === 'grass' ? 0.9 : 0.23, 0.8, 0);
      put(ax, ay, bx, by, cx, cy, color);
    });
    flush();
  };

  /* the head: vertices at the landmarks of a face (right half and centre line, mirrored),
   * triangulated, so the facets follow the planes of brow, cheekbone, nose and jaw */
  const FACE_PTS = [
    [0, 98, 33], [0, 126, 40], [0, 149, 43], [0, 166, 44.5], [0, 180, 49], [0, 190, 51.5], [0, 197.5, 47.5], [0, 206.5, 47.5], [0, 214, 46.5], [0, 225, 44.5], [0, 235, 41.5], [0, 244.5, 31],
    [14, 100, 32], [31, 103, 27], [44, 108, 17], [50, 119, 8],
    [16, 127, 39], [35, 130, 32.5], [51.5, 134, 13],
    [11, 151, 42.5], [25, 149, 40.5], [40, 151, 34.5], [53.5, 151, 11],
    [9, 166, 41], [24.5, 167, 37], [40, 166, 34], [54, 167, 10],
    [8, 180, 44], [21, 180, 41], [37, 180, 37.5], [52.5, 183, 10],
    [6.5, 192, 45.5], [17, 195, 42.5], [33, 196, 36.5], [48.5, 198, 10],
    [12.5, 205, 44], [20.5, 210, 41], [31.5, 212, 32.5], [43, 212, 9],
    [10.5, 224, 43], [23, 225, 34], [35, 225, 11],
    [10, 236, 39], [20, 234, 26], [27, 231, 9],
    [7.5, 243.5, 29.5], [15, 240, 15],
  ];
  const FACE_EDGE = [[0, 98], [14, 100], [31, 103], [44, 108], [50, 119], [51.5, 134], [53.5, 151], [54, 167], [52.5, 183], [48.5, 198], [43, 212], [35, 225], [27, 231], [15, 240], [7.5, 243.5], [0, 244.5]];
  const FACE = (() => {
    const pts = [];
    for (const p of FACE_PTS) {
      pts.push([CX + p[0], p[1], p[2]]);
      if (p[0] > 0) pts.push([CX - p[0], p[1], p[2]]);
    }
    const outline = FACE_EDGE.map((p) => [CX + p[0] * 1.002, p[1] + (p[1] > 200 ? 0.01 : -0.01)]).concat(
      FACE_EDGE.slice(1, -1).reverse().map((p) => [CX - p[0] * 1.002, p[1] + (p[1] > 200 ? 0.01 : -0.01)])
    );
    const tris = meshIn(pts, outline);
    return { pts, tris };
  })();
  addMesh(FACE.pts, FACE.tris, LAYER.head, MAT.skin, 1);
  /* the surface of the face, for placing features on it */
  const faceCells = new Map();
  const cellKey = (x, y) => Math.floor(x / 12) + Math.floor(y / 12) * 64;
  for (let k = 0; k < FACE.tris.length; k += 3) {
    const tri = FACE.tris.slice(k, k + 3).map(id => FACE.pts[id]);
    const xx = tri.map(p => p[0]), yy = tri.map(p => p[1]);
    for (let y = Math.floor(Math.min(...yy) / 12); y <= Math.floor(Math.max(...yy) / 12); y++) {
      for (let x = Math.floor(Math.min(...xx) / 12); x <= Math.floor(Math.max(...xx) / 12); x++) {
        const key = x + y * 64;
        if (!faceCells.has(key)) faceCells.set(key, []);
        faceCells.get(key).push(k);
      }
    }
  }
  const faceZ = (x, y) => {
    const { pts, tris } = FACE;
    for (const k of faceCells.get(cellKey(x, y)) || []) {
      const A = pts[tris[k]], B = pts[tris[k + 1]], C = pts[tris[k + 2]];
      const d = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
      if (Math.abs(d) < 1e-9) continue;
      const u = ((B[1] - C[1]) * (x - C[0]) + (C[0] - B[0]) * (y - C[1])) / d;
      const v = ((C[1] - A[1]) * (x - C[0]) + (A[0] - C[0]) * (y - C[1])) / d;
      if (u >= -0.001 && v >= -0.001 && u + v <= 1.001) return u * A[2] + v * B[2] + (1 - u - v) * C[2];
    }
    return 40;
  };

  const EAR = [
    [-49, 166, 12], [-55.5, 165, 9], [-59, 169, 7], [-58, 182, 7],
    [-54, 192, 9], [-50, 193, 12], [-48, 180, 13], [-55, 173, 10], [-53, 182, 9],
  ];
  for (const side of [-1, 1]) {
    const pts = EAR.map(([x, y, z]) => [CX + side * x, y, z]);
    addMesh(pts, [0, 1, 7, 1, 2, 7, 2, 3, 7, 3, 8, 7, 3, 4, 8, 4, 5, 8, 5, 6, 8, 6, 0, 7, 6, 7, 8], LAYER.ear, MAT.ear, 1);
  }

  // A sculpted side part: the crown rolls away from the parting and the
  // left fringe fans into longer, pointed locks over the sunny forehead.
  const hairContour = [
    [153, 172], [149, 164], [145, 148], [142, 151], [144, 135], [139, 137],
    [144, 122], [137, 125], [143, 116], [150, 103], [141, 107], [147, 97], [159, 85],
    [151, 87], [164, 77], [180, 70], [174, 70], [190, 63], [206, 60], [201, 57],
    [215, 58], [225, 63], [238, 64], [251, 70], [259, 79], [266, 91], [273, 89],
    [270, 101], [274, 112], [274, 125], [270, 136], [271, 143], [265, 149],
    [262, 167], [258, 172], [256, 149], [251, 137], [244, 129], [236, 117],
    [229, 109], [224, 119], [214, 127], [207, 130], [213, 120], [201, 131],
    [187, 139], [177, 142], [184, 134], [171, 139], [164, 146], [158, 159], [157, 170],
  ];
  const domeZ = (x, y) => 7 + 47 * Math.sqrt(Math.max(0, 1 - ((x - CX) / 73) ** 2 - ((y - 115) / 67) ** 2));
  const hairMesh = (edge, inner, mat, layer) => {
    const pts = edge.concat(inner).map(([x, y]) => [x, y, domeZ(x, y)]);
    addMesh(pts, meshIn(pts, edge), layer, mat, 1, pt => clamp((215 - pt[0]) / 75, 0, 1) * 0.85);
  };
  hairMesh(hairContour, [[153, 116], [168, 96], [183, 83], [205, 75], [224, 75], [244, 83],
  [257, 102], [261, 121], [249, 118], [227, 98], [201, 100], [179, 116], [159, 133]], MAT.hair, LAYER.hair);
  // The highlight sits on the convex edge of a lock. Following its sweep
  // gives the dark hair volume even at small sizes.
  const strands = [
    {
      edge: [[140, 122], [149, 109], [160, 95], [176, 83], [190, 77], [203, 75], [191, 80], [176, 89], [164, 104], [152, 117]],
      light: [[147, 113], [160, 96], [176, 84], [189, 79], [177, 87], [165, 97]]
    },
    {
      edge: [[145, 135], [157, 124], [171, 113], [188, 101], [203, 87], [211, 77], [221, 73], [219, 80], [209, 95], [192, 112], [170, 125], [152, 133]],
      light: [[157, 123], [174, 111], [193, 95], [207, 82], [215, 77], [207, 88], [192, 102], [175, 114]]
    },
    {
      edge: [[162, 144], [174, 133], [189, 124], [206, 109], [219, 92], [227, 81], [229, 80], [226, 94], [217, 110], [204, 123], [185, 135]],
      light: [[177, 133], [199, 115], [213, 101], [222, 88], [219, 99], [209, 112], [193, 125]]
    },
    {
      edge: [[232, 77], [245, 79], [254, 85], [262, 94], [268, 106], [269, 115], [264, 108], [258, 99], [248, 90], [238, 84]],
      light: [[238, 81], [248, 84], [257, 91], [263, 99], [255, 93], [247, 88]]
    },
    {
      edge: [[237, 91], [247, 98], [255, 110], [261, 125], [261, 138], [258, 131], [254, 118], [245, 106]],
      light: [[246, 99], [255, 109], [259, 120], [254, 113]]
    },
  ];
  for (const { edge, light } of strands) {
    hairMesh(edge, [], MAT.lock, LAYER.lock);
    hairMesh(light, [], MAT.hairSheen, LAYER.lock + 0.1);
  }

  /* the neck */
  const NECK_ROWS = [
    [214, [0, 25], [12, 22.5], [22, 10]],
    [240, [0, 26], [12, 23.5], [23, 10]],
    [266, [0, 27], [13, 24], [24.5, 11]],
    [291, [0, 28], [10, 26], [19, 18]],
    [314, [0, 28], [2.5, 27.5], [5, 26]],
  ];
  (() => {
    const pts = [];
    const rows = NECK_ROWS.map((r) => {
      const half = r.slice(1);
      const ids = [];
      for (let i = half.length - 1; i >= 1; i -= 1) {
        ids.push(pts.length);
        pts.push([CX + 1 - half[i][0] * 1.14, r[0], half[i][1]]);
      }
      ids.push(pts.length);
      pts.push([CX + 1, r[0], half[0][1]]);
      for (let i = 1; i < half.length; i += 1) {
        ids.push(pts.length);
        pts.push([CX + 1 + half[i][0] * 1.14, r[0], half[i][1]]);
      }
      return ids;
    });
    const tris = [];
    for (let j = 0; j < rows.length - 1; j += 1) {
      const A = rows[j];
      const B = rows[j + 1];
      for (let i = 0; i < A.length - 1; i += 1) {
        if (i < 2) tris.push(A[i], A[i + 1], B[i], A[i + 1], B[i + 1], B[i]);
        else tris.push(A[i], A[i + 1], B[i + 1], A[i], B[i + 1], B[i]);
      }
    }
    addMesh(pts, tris, LAYER.neck, MAT.skin, 0);
  })();

  /* the hoodie: broad planes for chest and shoulders, and a few folds */
  const FOLDS = [
    [[112, 322], [176, 404], 7, 11],
    [[318, 318], [254, 404], 7, 11],
    [[58, 356], [84, 404], 4, 10],
    [[372, 348], [352, 404], 4, 10],
  ];
  const segDist = (x, y, a, b) => {
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const t = clamp(((x - a[0]) * vx + (y - a[1]) * vy) / (vx * vx + vy * vy), 0, 1);
    return Math.hypot(x - a[0] - vx * t, y - a[1] - vy * t);
  };
  const torsoZ = (x, y) => {
    const hw = 132 + (y - 260) * 0.42;
    const u = (x - 213) / hw;
    let z = 34 * Math.pow(Math.max(0, 1 - u * u), 0.55);
    for (const [a, b, amp, wd] of FOLDS) {
      const d = segDist(x, y, a, b);
      z += amp * Math.exp(-(d * d) / (wd * wd));
    }
    z -= 3 * Math.exp(-Math.pow((x - 214) / 6, 2)) * smooth(310, 330, y);
    return z;
  };
  // Both sleeve heads attach to the same fitted chest block at the armholes.
  // Use mirrored shoulder landmarks down to the side seams at the waist.
  const BODY_X = 213;
  const armhole = [[90, 265], [97, 282], [100, 308], [96, 345]];
  const chestEdge = [
    [0, 263], [26, 259], [52, 253], [67, 256], [81, 261], ...armhole,
    [103, 380], [111, 419], [54, 419], [0, 419],
  ];
  const edgeDepth = (x, y) => torsoZ(x, y) * (y > 405 ? 1 : 0.88);
  const chestPlane = [
    [17, 278], [38, 286], [59, 275], [81, 279], [100, 289], [111, 302],
    [21, 320], [41, 309], [74, 308], [95, 321], [103, 340], [83, 349], [57, 338],
    [31, 350], [12, 366], [48, 369], [70, 382], [94, 369], [105, 394], [30, 398], [54, 409],
  ];
  const chestSurface = (() => {
    const right = chestEdge.map(([x, y]) => [BODY_X + x, y]);
    const left = chestEdge.slice(1, -1).reverse().map(([x, y]) => [BODY_X - x, y]);
    const outline = right.concat(left);
    const middle = [281, 316, 347, 382, 411].map(y => [BODY_X, y]);
    const inside = middle.concat(chestPlane.flatMap(([x, y]) => [[BODY_X - x, y], [BODY_X + x, y]]))
      .filter(([x, y]) => inPoly(outline, x, y));
    const pts = outline.map(([x, y]) => [x, y, edgeDepth(x, y)]).concat(inside.map(([x, y]) => [x, y, torsoZ(x, y)]));
    const tris = meshIn(pts, outline);
    addMesh(pts, tris, LAYER.torso, MAT.hoodie, 0);
    return { pts, tris };
  })();

  // Sample the actual triangular garment, including its shoulder slope.
  // Webbing, contact shadows and hardware share these barycentric anchors.
  const jacketSurfaceZ = (x, y) => {
    const { pts, tris } = chestSurface;
    for (let k = 0; k < tris.length; k += 3) {
      const [a, b, c] = [pts[tris[k]], pts[tris[k + 1]], pts[tris[k + 2]]];
      const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(d) < 1e-8) continue;
      const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d;
      const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d;
      if (u >= -0.001 && v >= -0.001 && u + v <= 1.001) return u * a[2] + v * b[2] + (1 - u - v) * c[2];
    }
    return edgeDepth(x, y);
  };

  for (const side of [-1, 1]) {
    const folds = [
      [[75, 307, 0], [68, 318, 1.6], [49, 339, 0.2], [62, 319, 4.3], [51, 334, 1.6]],
      [[74, 347, 0], [63, 357, 1.5], [34, 390, 0.3], [55, 360, 4.8], [44, 377, 1.8]],
    ];
    for (const fold of folds) {
      const pts = fold.map(([distance, y, rise]) => {
        const x = BODY_X + distance * side;
        return [x, y, torsoZ(x, y) + rise + 1.3];
      });
      addMesh(pts, [0, 1, 3, 1, 4, 3, 1, 2, 4], 0.25, MAT.hoodie, 0);
    }
  }

  /* the hood, bunched around the neck: its back behind the neck, and two thick sides meeting in a V */
  (() => {
    const back = [[150, 256, 6], [162, 245, 8], [186, 240, 8], [213, 241, 6], [240, 240, 8], [264, 245, 8], [276, 256, 6], [240, 262, 3], [213, 264, 2], [186, 262, 3]];
    const outline = [[150, 256], [162, 245], [186, 240], [213, 241], [240, 240], [264, 245], [276, 256], [240, 262], [213, 264], [186, 262]];
    addMesh(back, meshIn(back, outline), LAYER.hoodback, MAT.inner, 0);
    const OUT = [
      [121, 280], [127, 263], [138, 251], [153, 243], [168, 239], [181, 242], [189, 251], [191, 264], [195, 279], [202, 296], [213, 312], [203, 319], [186, 314], [165, 305], [146, 297], [131, 290],
    ];
    const SPINE = [[134, 272], [150, 258], [167, 251], [181, 259], [187, 280], [197, 300], [157, 281], [176, 293]];
    const build = (mirror) => {
      const tr = (p) => (mirror ? [2 * 213 - p[0], p[1]] : p);
      const o = OUT.map(tr);
      const pts = o.map((p) => [p[0], p[1], torsoZ(p[0], p[1]) + 5]).concat(SPINE.map(tr).map((p, i) => [p[0], p[1], torsoZ(p[0], p[1]) + (i < 6 ? 15 : 10)]));
      addMesh(pts, meshIn(pts, o), LAYER.hood, MAT.hoodie, 0);
    };
    build(false);
    build(true);
  })();

  // The turned edge of the hood casts a slim shadow on both chest panels.
  // The raised topstitch and the fold underneath receive their own light.
  for (const side of [-1, 1]) {
    const fold = [[80, 278], [80, 285], [68, 293], [48, 302], [29, 311], [14, 316], [8, 316]];
    const edge = [], shadow = [], indices = [];
    fold.forEach(([distance, y], i) => {
      const x = BODY_X + distance * side, z = torsoZ(x, y) + 7;
      edge.push([x, y, z + 0.8], [x, y + 1.25, z + 1.3]);
      shadow.push([x, y + 1, z + 1], [x, y + 1.7 + 1.1 * Math.sin(i * Math.PI / (fold.length - 1)), z - 1]);
      if (i) indices.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
    });
    addMesh(shadow, indices, 4.2, MAT.binding, 0);
    addMesh(edge, indices, 4.3, MAT.selvedge, 0);
  }

  // The webbing emerges from the back slope, wraps about the clavicle
  // and returns toward the ribs. Width is projected along the local tangent.
  const webPath = [[77, 260, 4], [83, 264, 7], [88, 270, 10.5], [91, 281, 13],
  [91, 297, 15], [88, 319, 16], [84, 342, 15.2], [82, 359, 14.1], [83, 382, 13.2], [88, 419, 12.8]];
  for (const side of [-1, 1]) {
    const web = [], shadow = [], edges = [], faces = [], edgeFaces = [];
    webPath.forEach(([distance, y, width], i) => {
      const prev = webPath[Math.max(0, i - 1)], next = webPath[Math.min(i + 1, webPath.length - 1)];
      const dx = (next[0] - prev[0]) * side, dy = next[1] - prev[1], length = Math.hypot(dx, dy);
      const anchor = (fraction, extraWidth, height) => {
        const lateral = fraction * (width + extraWidth) * 0.5;
        const x = BODY_X + distance * side + dy / length * lateral;
        const yy = y - dx / length * lateral;
        return [x, yy, jacketSurfaceZ(x, yy) + height];
      };
      for (const across of [-1, -0.68, 0.52, 1]) {
        web.push(anchor(across, 0, 0.6 + 1.5 * (1 - across * across)));
        shadow.push(anchor(across, 2.7, 0.2));
      }
      const selvage = -side * 0.73;
      edges.push(anchor(selvage, 0, 1.9), anchor(selvage + 0.07, 0, 2));
      if (i) {
        for (let col = 0; col < 3; col++) {
          const a = 4 * i - 4 + col;
          faces.push(a, a + 1, a + 4, a + 1, a + 5, a + 4);
        }
        const a = i * 2 - 2;
        edgeFaces.push(a, a + 1, a + 3, a, a + 3, a + 2);
      }
    });
    addMesh(shadow, faces, 2.8, MAT.contact, 0);
    addMesh(web, faces, LAYER.strap, MAT.strap, 0);
    addMesh(edges, edgeFaces, 3.1, MAT.webEdge, 0);
    const place = (u, v, z) => {
      const pathSlope = -0.17 * side;
      const x = BODY_X + 84 * side + u + pathSlope * v, y = 342 + v - pathSlope * u;
      return [x, y, jacketSurfaceZ(x, y) + z];
    };
    const frame = [[-8.3, -3], [-6.8, -4.2], [6.8, -4.2], [8.3, -3], [8.1, 2.6], [6.7, 3.7], [-6.8, 3.7], [-8.1, 2.6]];
    const rim = frame.map(([u, v]) => place(u, v, 2.8)).concat(frame.map(([u, v]) => place(u * 0.78, v * 0.57, 3.6)));
    const tris = frame.flatMap((_, i) => [i, (i + 1) % 8, i + 8, (i + 1) % 8, (i + 1) % 8 + 8, i + 8]);
    addMesh(rim, tris, 3.5, MAT.metal, 0);
    addMesh([place(-6.1, -0.8, 3.6), place(6.1, -0.8, 3.6), place(6.1, 0.2, 4.0), place(-6.1, 0.2, 4.0)], [0, 1, 2, 0, 2, 3], 3.6, MAT.metal, 0);
  }
  const tee = [[184, 253, 30], [197, 259, 33], [211, 262, 35], [225, 259, 32], [239, 253, 29], [239, 290, 30], [214, 319, 35], [188, 291, 30]];
  addMesh(tee, [0, 1, 7, 1, 2, 7, 2, 6, 7, 2, 3, 6, 3, 5, 6, 3, 4, 5], 2.5, MAT.tee, 0);

  /* the zip and the hood's two drawstrings */
  (() => {
    const zx = (y) => 213 + (y - 313) * 0.015;
    const pts = [];
    const tris = [];
    const ys = [313, 350, 385, 414];
    ys.forEach((y, i) => {
      pts.push([zx(y) - 0.8, y, torsoZ(zx(y), y) + 0.6], [zx(y) + 0.8, y, torsoZ(zx(y), y) + 0.6]);
      if (i) tris.push(i * 2 - 2, i * 2 - 1, i * 2 + 1, i * 2 - 2, i * 2 + 1, i * 2);
    });
    addMesh(pts, tris, LAYER.string, MAT.inner, 0);
    const pull = [[211, 315, 38], [215, 315, 39], [215, 318.3, 38], [212, 319, 39],
    [212.4, 318.5, 40], [214.2, 318.4, 40], [213, 325.4, 39], [210.6, 326, 38]];
    addMesh(pull, [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7], 5.1, MAT.metal, 0);
    for (const [x0, y0, x1, y1] of [[204.5, 304, 200.5, 352], [221.5, 304, 225.5, 350]]) {
      const sp = [];
      const st = [];
      const n = 4;
      for (let i = 0; i <= n; i += 1) {
        const u = i / n;
        const x = mix(x0, x1, u) + Math.sin(u * Math.PI) * (x1 > x0 ? 1 : -1) * 1.2;
        const y = mix(y0, y1, u);
        const z = torsoZ(x, y) + 2.2;
        sp.push([x - 0.85, y, z], [x + 0.85, y, z + 0.4]);
        if (i) st.push(i * 2 - 2, i * 2 - 1, i * 2 + 1, i * 2 - 2, i * 2 + 1, i * 2);
      }
      const e = sp.length;
      const ex = x1;
      sp.push([ex, y1 - 1, torsoZ(ex, y1) + 3], [ex - 1.7, y1 + 3, torsoZ(ex, y1) + 3.4], [ex, y1 + 8, torsoZ(ex, y1) + 3], [ex + 1.7, y1 + 3, torsoZ(ex, y1) + 3.6]);
      st.push(e, e + 1, e + 3, e + 1, e + 2, e + 3);
      addMesh(sp, st, LAYER.string, MAT.string, 0, (q) => clamp((q[1] - y0) / (y1 - y0), 0, 1) * 1.6);
    }
  })();

  /* ---------- him in motion ---------- */

  const blinkOf = (t) => {
    const d = (((t - 4.6) % 5.3) + 5.3) % 5.3;
    return clamp(1.25 - Math.min(d, 5.3 - d) / 0.1, 0, 1);
  };
  // Ramp joint speed briefly at either end. The almost linear middle
  // avoids a second acceleration as the projected forearm turns upright.
  const liftAt = w => {
    const u = clamp(Math.min(w / 0.70, (2.60 - w) / 0.64), 0, 1);
    const ramp = 0.13;
    if (u < ramp) return u * u / (2 * ramp * (1 - ramp));
    if (u > 1 - ramp) return 1 - (1 - u) ** 2 / (2 * ramp * (1 - ramp));
    return (u - ramp / 2) / (1 - ramp);
  };
  const pose = (s, t) => {
    const lean = clamp(s.lean, -1, 1);
    const w = s.hello;
    const waving = w >= 0;
    const wind = clamp(s.wind, 0, 1);
    return {
      lean,
      // Align the model to the sprite's eye line. Turning the model already
      // moves the eyes about six of the twelve pixels of camera parallax.
      dx: -4 - lean * 6,
      yaw: 0.058 - lean * 0.13,
      breath: Math.sin(t * 1.5) * 0.5,
      roll: -0.005 + Math.sin(t * 0.7) * 0.004,
      rise: waving ? liftAt(w) : 0,
      swing: waving ? Math.sin(w * 9) * 0.24 * smooth(0.52, 0.78, w) * (1 - smooth(1.83, 2.10, w)) : 0,
      gust: (0.35 + wind) * (Math.sin(t * 2.1) * 1.3 + Math.sin(t * 3.7 + 1) * 0.7),
      blink: blinkOf(t),
      t,
    };
  };
  const PIVY = 240;
  const XF = [0, 0, 0];
  const xf = (P, g, x, y, z) => {
    let X = x;
    let Y = y;
    if (g === 1) {
      const c = Math.cos(P.roll);
      const s = Math.sin(P.roll);
      const dx = (X - CX) * (1.115 - 0.22 * smooth(190, 236, Y));
      const dy = (Y - PIVY) * 1.015 - 5 - 3.8 * smooth(199, 241, Y);
      X = CX + dx * c - dy * s;
      Y = PIVY + dx * s + dy * c;
    }
    if (g === 0 && P.rise > 0) {
      // A small clavicle elevation carries the upper chest, shoulder saddle
      // and everything attached to that patch through the same deformation.
      const influence = smooth(247, 305, X) * (1 - smooth(342, 378, X))
        * smooth(236, 264, Y) * (1 - smooth(287, 381, Y)) * P.rise;
      X += 2.4 * influence;
      Y -= 7.2 * influence;
      z += 2.6 * influence;
    }
    const yaw = g === 1 ? P.yaw * 1.15 : P.yaw;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const dx = X - CX;
    XF[0] = CX + dx * cy + z * sy + P.dx;
    XF[1] = Y + P.breath * (g === 1 ? 0.75 : 0.45);
    XF[2] = -dx * sy + z * cy;
    return XF;
  };
  const transformPerson = (P) => {
    for (let i = 0; i < NV; i += 1) {
      const sw = PS[i];
      const p = xf(P, PG[i], PV[i * 3] + sw * P.gust * 0.9, PV[i * 3 + 1] + sw * Math.abs(P.gust) * 0.15, PV[i * 3 + 2]);
      Q[i * 3] = p[0];
      Q[i * 3 + 1] = p[1];
      Q[i * 3 + 2] = p[2];
    }
  };

  // Shoulder, elbow and cuff are shared by the upper sleeve, folded forearm
  // and the hand. During the turn the forearm comes briefly toward the lens.
  const waveArm = (P, emit) => {
    const r = P.rise;
    const angle = mix(1.25, -1.39, r) + P.swing * 0.38;
    const shoulder = [318, 286], elbow = [345 + 27 * r * r, 429 - 48 * r - 14 * Math.sin(Math.PI * r)];
    const projectedReach = 76 - 51 * Math.sin(Math.PI * r);
    const wrist = [
      elbow[0] + Math.cos(angle) * projectedReach,
      elbow[1] + Math.sin(angle) * (110 + 18 * r),
    ];
    const ring = (pt, angle, radius, depth) => {
      const nx = -Math.sin(angle), ny = Math.cos(angle);
      return [-1, -0.42, 0.42, 1].map((side, i) => [
        pt[0] + nx * radius * side, pt[1] + ny * radius * side, depth + (i === 1 ? 10 : i === 2 ? 12 : 0)
      ]);
    };
    const mid = (a, b, u) => [mix(a[0], b[0], u), mix(a[1], b[1], u)];
    const join = (first, second, material, layer) => {
      const pts = first.concat(second);
      emit(pts, [0, 1, 4, 1, 5, 4, 1, 2, 5, 2, 6, 5, 2, 3, 6, 3, 7, 6], material, layer);
    };
    const upperAngle = Math.atan2(elbow[1] - shoulder[1], elbow[0] - shoulder[0]);
    // The starting rail is *the* anterior garment edge, from the top of
    // the shoulder to the armpit. Adjacent chest and sleeve triangles meet
    // at these four identical 3-D landmarks and share their pose weights.
    const socket = armhole.map(([offset, y]) => {
      const x = BODY_X + offset;
      return [x, y, edgeDepth(x, y)];
    });
    const upper = ring(mid(shoulder, elbow, 0.58), upperAngle + 0.025, 29, 18);
    const underarm = u => socket[3].map((v, k) => mix(v, upper[3][k], u));
    const shoulderRail = [
      [325 + 2 * r, 274 - 1.3 * r, 13], [329 + 2 * r, 287 - 2 * r, 24],
      [326 + 2 * r, 312 - 2 * r, 31], underarm(0.31),
    ];
    const bicep = [
      [343 + 5 * r, 293 - 4 * r, 10], [345 + 5 * r, 307 - 5 * r, 26],
      [334 + 5 * r, 326 - 5 * r, 34], underarm(0.64),
    ];
    const before = mid(shoulder, elbow, 0.79);
    const armEnd = ring(before, upperAngle, 25, 17);
    join(socket, shoulderRail, MAT.hoodie, 0.5);
    join(shoulderRail, bicep, MAT.hoodie, 0.5);
    join(bicep, upper, MAT.hoodie, 0.5);
    join(upper, armEnd, MAT.hoodie, 0.5);

    const after = mid(elbow, wrist, 0.23);
    const base = ring(after, angle, 25, 24);
    const bag = ring(mid(elbow, wrist, 0.45), angle + 0.045, 25, 25);
    const fold = ring(mid(elbow, wrist, 0.75), angle - 0.09, 20, 29);
    const hem = ring(mid(elbow, wrist, 0.875), angle, 19, 28);
    const cuff = ring(wrist, angle, 15.6, 31);
    let prev = armEnd;
    for (const u of [0.25, 0.5, 0.75, 1]) {
      const a = mid(before, elbow, u), b = mid(elbow, after, u);
      const pivot = mid(a, b, u);
      const next = u === 1 ? base : ring(pivot, Math.atan2(b[1] - a[1], b[0] - a[0]), 25, 17 + 7 * u);
      join(prev, next, MAT.hoodie, 20);
      prev = next;
    }
    join(base, bag, MAT.hoodie, 20);
    join(bag, fold, MAT.hoodie, 20);
    join(fold, hem, MAT.hoodie, 20);
    join(hem, cuff, MAT.binding, 20);

    // Narrow ribs on the knit cuff follow the fold and the rotating hand.
    const onBand = (band, u) => {
      const k = Math.min(2, Math.floor(u * 3)), fraction = u * 3 - k;
      return band[k].map((v, j) => mix(v, band[k + 1][j], fraction));
    };
    for (const u of [0.12, 0.28, 0.44, 0.60, 0.76, 0.92]) {
      const points = [onBand(hem, u), onBand(hem, u + 0.019), onBand(cuff, u + 0.019), onBand(cuff, u)];
      emit(points.map(([x, y, z]) => [x, y, z + 0.65]), [0, 1, 2, 0, 2, 3], MAT.hoodie, 20.1);
    }

    // Left hand. In a greeting with the palm facing the lens the radial
    // (thumb) side is on screen left. Pitch and pronation happen at the
    // carpus, before rotating the wrist into the forearm's frame.
    // The hand trails the forearm while it clears the lower crop. As the
    // cuff comes into view the wrist rolls open into the greeting.
    const turn = 0.93 * (1 - smooth(0.47, 0.94, r));
    const handAngle = angle + Math.PI / 2 + P.swing * 0.86 + turn * Math.sin(Math.PI * r);
    const pronation = -0.10 - 0.85 * (1 - r) + P.swing * 1.05;
    const pitch = 0.10 + 0.51 * Math.sin(Math.PI * r);
    const ch = Math.cos(handAngle), sh = Math.sin(handAngle);
    const cy = Math.cos(pronation), sy = Math.sin(pronation), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const handVertex = ([x, y, z]) => {
      const across = x * cy + z * sy, depth = z * cy - x * sy;
      const along = y * cp + depth * sp;
      return [wrist[0] + across * ch - along * sh, wrist[1] + across * sh + along * ch, 36 - y * sp + depth * cp];
    };
    const hand = (pts, faces, mat = MAT.skin) => emit(pts.map(handVertex), faces, mat, 19.5);

    // The heel sits inside the knit cuff. The thenar pad at left rolls
    // toward the thumb; the palm between it and the little-finger pad is
    // recessed. The top edge follows the arch of the four knuckles.
    const palmRows = [
      [[-10.4, 6, 0], [-5.5, 6, 2.4], [0, 6, 3.5], [6, 6, 2.8], [10.8, 6, 0]],
      [[-13, -5, 1], [-7, -5, 4.3], [0, -5, 3.3], [7, -5, 4.4], [12.2, -5, 0.8]],
      [[-16.2, -18, 2], [-9, -18, 7.1], [-1, -18, 3.4], [8.2, -18, 5.1], [15.7, -18, 1.2]],
      [[-16.7, -29, 1.5], [-9.9, -29.8, 5.1], [-1.7, -30.6, 4.1], [7.3, -29.6, 4.9], [16.2, -26, 0.8]],
      [[-15.3, -36, 1.2], [-8.3, -38.3, 3.9], [-1.7, -40, 4.4], [7.1, -37.5, 3.5], [15.1, -31.3, 0.8]],
    ];
    const palmFaces = [];
    for (let row = 0; row < palmRows.length - 1; row++)for (let j = 0; j < 4; j++) {
      const a = row * 5 + j;
      palmFaces.push(a, a + 5, a + 6, a, a + 6, a + 1);
    }
    hand(palmRows.flat(), palmFaces);

    // A finger is a chain of rounded, tapering phalanges. The paired
    // longitudinal planes turn around the shaft; the fingertip has a pad
    // and a short curved end rather than finishing at a single spike.
    const digit = (joints, radii, flex) => {
      const curl = (0.48 + 0.25 * (1 - r) - 0.7 * P.swing) * flex;
      const bent = joints.map(([x, y, z], i) => {
        const u = i / (joints.length - 1);
        return [x + curl * u * u * 0.35, y + curl * u * u * 0.6, z + curl * u * u * 1.55];
      });
      const pts = [], faces = [];
      for (let i = 0; i < bent.length; i++) {
        const [x, y, z] = bent[i], a = bent[Math.max(0, i - 1)], b = bent[Math.min(i + 1, bent.length - 1)];
        const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
        const nx = -dy / len, ny = dx / len;
        const radius = radii[i];
        for (const offset of [-1, -0.52, 0.36, 1]) {
          const h = (1 - offset * offset) * radius * 0.55;
          pts.push([x + nx * radius * offset, y + ny * radius * offset, z + h]);
        }
        if (i > 0) for (let j = 0; j < 3; j++) {
          const k = (i - 1) * 4 + j;
          faces.push(k, k + 1, k + 4, k + 1, k + 5, k + 4);
        }
      }
      hand(pts, faces);
    };
    // Thumb abducts from the base of the palm. Index, middle, ring and
    // little fingers diverge gently from their own metacarpals.
    digit([[-11.6, -14.5, 2], [-17.7, -20, 5.1], [-23.7, -27.6, 8.2], [-26.6, -32.4, 9.2], [-26.4, -34.2, 9.8]],
      [5.8, 5.0, 3.8, 2.7, 1.15], 1.3);
    digit([[-11.4, -33.2, 1.2], [-13.9, -46.1, 1.9], [-17, -57.8, 4.3], [-17.8, -64.2, 6.3], [-17.4, -66.4, 7.1]],
      [4.3, 4.0, 3.5, 2.7, 1.05], 1.15);
    digit([[-3.4, -36.5, 1.8], [-4.6, -51.6, 2.3], [-5.8, -66.2, 3.9], [-5.4, -72, 6.1], [-4.9, -74, 6.9]],
      [4.5, 4.1, 3.5, 2.7, 1.05], 0.82);
    digit([[4.5, -35.1, 1.8], [5.8, -49.7, 2.8], [7.8, -61.8, 5.7], [8.7, -66.3, 8.1], [9.1, -68, 9.1]],
      [4.25, 3.9, 3.25, 2.4, 1.0], 1.45);
    digit([[12.1, -29.9, 1.0], [15.8, -39.6, 2.8], [19.3, -48.6, 6.6], [20.3, -52.6, 9.6], [20.5, -54.2, 10.9]],
      [3.65, 3.25, 2.75, 2.0, 0.78], 2.0);

    // Low-relief palmar creases describe the thumb pad and the transverse
    // fold below the knuckles. Their warm tone is subdued in strong light.
    const crease = (points) => {
      const pts = [], faces = [];
      points.forEach(([x, y, z, width], i) => {
        pts.push([x, y, z], [x + 0.22, y + width, z + 0.05]);
        if (i) faces.push(i * 2 - 2, i * 2 - 1, i * 2, i * 2 - 1, i * 2 + 1, i * 2);
      });
      hand(pts, faces, MAT.palm);
    };
    crease([[-13.4, -25.8, 4.6, 0.10], [-8.4, -22.8, 7.4, 0.63], [-5, -17.4, 6.2, 0.7], [-4.4, -11.2, 4.8, 0.18]]);
    crease([[-6, -30.1, 4.9, 0.14], [0, -28.7, 5.0, 0.78], [7.6, -30.6, 5.2, 0.65], [12.1, -31.3, 4.1, 0.10]]);

  };

  // The resting arm is the same sleeve pattern and bind pose as the greeting
  // arm. Baking its mirror once gives the stationary side identical anatomy.
  waveArm({ rise: 0, swing: 0 }, (pts, tris, material, layer) => {
    if (pts.every(p => p[1] > H + 4)) return;
    addMesh(pts.map(([x, y, z]) => [2 * BODY_X - x, y, z]), tris, layer, material, 0);
  });
  const NV = PG.length;
  const NT = PL.length;
  const Q = new Float64Array(NV * 3);

  /* the hoodie colours, in this palette */
  const HOODIES = {
    charcoal: [56, 70, 79],
    navy: [40, 56, 100],
    forest: [46, 84, 66],
    rust: [158, 78, 48],
    sand: [204, 182, 144],
  };
  const ALB = {
    skin: lin([242, 189, 153]), palm: lin([231, 165, 137]),
    ear: lin([224, 168, 140]),
    hair: lin([43, 48, 66]), lock: lin([56, 62, 80]), hairSheen: lin([81, 86, 102]),
    strap: lin([46, 49, 48]), webEdge: lin([71, 76, 71]),
    lip: lin([209, 140, 119]),
    mouth: lin([152, 86, 78]),
    eye: lin([48, 39, 41]), brow: lin([84, 66, 64]), white: lin([251, 235, 213]),
    iris: lin([100, 81, 70]), gleam: lin([255, 245, 215]), tooth: lin([255, 230, 208]),
    tee: lin([223, 215, 186]), metal: lin([148, 129, 94]),
  };
  const matAlb = (m, hood) => (m === MAT.contact ? hood.map(c => c * 0.61) : m === MAT.palm ? ALB.palm : m === MAT.selvedge ? hood.map(c => c * 1.22 + 0.006) : m === MAT.webEdge ? ALB.webEdge : m === MAT.tee ? ALB.tee : m === MAT.metal ? ALB.metal : m === MAT.binding ? hood.map(c => c * 0.62) : m === MAT.skin ? ALB.skin : m === MAT.ear ? ALB.ear : m === MAT.hairSheen ? ALB.hairSheen : m === MAT.lock ? ALB.lock : m === MAT.hair ? ALB.hair : m === MAT.strap ? ALB.strap : m === MAT.inner ? [hood[0] * 0.62, hood[1] * 0.62, hood[2] * 0.62] : m === MAT.string ? [mix(hood[0], 0.7, 0.35), mix(hood[1], 0.7, 0.35), mix(hood[2], 0.7, 0.35)] : hood);
  const MAT_SPEC = [[0.03, 6], [0.024, 10], [0.05, 16], [0.09, 18], [0.05, 8], [0.04, 16], [0, 1], [0.018, 8], [0.15, 12], [0.018, 7], [0.028, 14], [0.035, 14], [0.036, 9], [0.075, 12], [0.012, 10], [0.024, 11]];

  /* all of his facets for this state, in painting order: [layer, z, ax, ay, bx, by, cx, cy, nx, ny, nz, mat, ao, jit] */
  const FACETS = [];
  const personFacets = (s, P) => {
    transformPerson(P);
    FACETS.length = 0;
    for (let k = 0; k < NT; k += 1) {
      const a = PT[k * 3] * 3;
      const b = PT[k * 3 + 1] * 3;
      const c = PT[k * 3 + 2] * 3;
      const ax = Q[a], ay = Q[a + 1], az = Q[a + 2];
      const bx = Q[b], by = Q[b + 1], bz = Q[b + 2];
      const cx = Q[c], cy = Q[c + 1], cz = Q[c + 2];
      const ux = bx - ax, uy = -(by - ay), uz = bz - az;
      const vx = cx - ax, vy = -(cy - ay), vz = cz - az;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      if (nz < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      FACETS.push([PL[k], (az + bz + cz) / 3, ax, ay, bx, by, cx, cy, nx, ny, nz, PM[k], 1, hash(k * 0.917 + 0.3) * 2 - 1]);
    }
    {
      const add = (pts, tris, mat, layer) => {
        const q = pts.map((p) => xf(P, 0, p[0], p[1], p[2]).slice());
        for (let k = 0; k < tris.length; k += 3) {
          const A = q[tris[k]], B = q[tris[k + 1]], C = q[tris[k + 2]];
          const ux = B[0] - A[0], uy = -(B[1] - A[1]), uz = B[2] - A[2];
          const vx = C[0] - A[0], vy = -(C[1] - A[1]), vz = C[2] - A[2];
          let n = norm3([uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]);
          if (n[2] < 0) n = [-n[0], -n[1], -n[2]];
          FACETS.push([layer, (A[2] + B[2] + C[2]) / 3, A[0], A[1], B[0], B[1], C[0], C[1], n[0], n[1], n[2], mat, 1, hash(k * 1.3 + layer) * 2 - 1]);
        }
      };
      waveArm(P, add);
    }
    FACETS.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    return FACETS;
  };

  const neckTint = (ctx, L, P) => {
    const shadow = ctx.createLinearGradient(200 + P.dx, 233 + P.breath, 218 + P.dx, 262 + P.breath);
    for (const [position, key] of [[0, 0.47], [0.38, 0.64], [1, 0.88]]) {
      shade(ALB.skin, -0.06, 0.0, 0.998, L, L.bustDir, key, 0.015, 10, 1, 0.6, 1.05);
      shadow.addColorStop(position, css(SH[0] + ALB.skin[0] * 0.055, SH[1] + ALB.skin[1] * 0.048, SH[2] + ALB.skin[2] * 0.044));
    }
    return shadow;
  };

  const featureStyle = (alb, L, key = .75) => {
    shade(alb, 0, 0.1, 1, L, L.bustDir, key, 0, 1, 1, 0.3);
    return css(SH[0], SH[1], SH[2]);
  };

  /* the face's few features, in the head's frame: eyes, a smile, glasses */
  const EYE_OFFSET = 24.5;
  const EYE_Y = 165.2;
  const eyePolys = (P, smile) => {
    const height = 6.4 * (1 - 0.15 * smile) * (1 - P.blink);
    return [-1, 1].map(side => {
      const cx = CX + side * EYE_OFFSET;
      // The flatter upper lid rests on the iris; the outer corner lifts
      // slightly. Both lids meet on the same seam at full blink.
      const upper = [[-12, 0], [-6.3, -.65], [-1.0, -.84], [5.8, -.82], [9.6, -.51], [12, 0]];
      const lower = [[7.0, .68], [1.0, .96], [-5.8, .76]];
      return upper.concat(lower).map(([x, aperture]) => [
        cx + side * x, EYE_Y + .026 * x + height * aperture,
      ]);
    });
  };

  const mouthPoly = (smile) => {
    const s = clamp(smile, 0, 1);
    const halfWidth = 11.9 + 5.0 * s;
    const lift = 1.1 + 4.3 * s;
    const open = smooth(.20, .98, s) * 4.4;
    const top = [], bot = [];
    for (const u of [-1, -.68, -.34, 0, .34, .68, 1]) {
      const x = CX + u * halfWidth;
      const y = 206.5 - lift * Math.abs(u) ** 2.4;
      top.push([x, y]);
      bot.push([x - .6 * u, y + .8 * s + (.65 + open) * (1 - u * u)]);
    }
    return { top, bot, open };
  };

  // The two soft-square rims and their shallow saddle share attachment
  // points with the temples, shadows and construction drawing.
  const GLASS = (() => {
    const halfSpacing = 24.6, cy = 166.3;
    const rim = [
      [-17.6, -7.9], [-15.6, -10.2], [-7.6, -10.9], [12.1, -11.0],
      [18.3, -10.1], [18.7, -6.2], [17.8, 3.4], [15.3, 9.6],
      [10.4, 12.6], [1.6, 14.0], [-7.3, 13.2], [-13.8, 10.0],
      [-16.6, 5.3], [-17.6, -.8],
    ];
    const lenses = [-1, 1].map(side => rim.map(([x, y]) => [CX + side * (halfSpacing+x), cy+y]));
    const bridge = [
      [lenses[0][0][0], lenses[0][0][1], 50], [CX-3.2, cy-9.0, 51.5],
      [CX+3.2, cy-9.0, 51.5], [lenses[1][0][0], lenses[1][0][1], 50],
    ];
    return { lenses, bridge };
  })();

  const drawPerson = (ctx, s, L, t, P, view, hoodieName) => {
    const hood = lin(HOODIES[hoodieName] || HOODIES.charcoal);
    const facets = personFacets(s, P);
    const ld = L.bustDir;
    const throat = view === "rgb" ? neckTint(ctx, L, P) : null;
    const head = (x, y, z) => xf(P, 1, x, y, z).slice();
    const drawFeatures = () => {
      if (view !== "rgb") return;
      const plane = (pts, color) => {
        ctx.beginPath();
        pts.forEach(([x, y], i) => {
          const q = head(x, y, faceZ(x, y) + 0.8);
          if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]);
        });
        ctx.closePath();
        if (color) { ctx.fillStyle = color; ctx.fill(); }
      };
      const shadeX = -L.bustDir[0] * (3.7 + L.sunUp * 1.8);
      const shadeY = 1.3 + L.bustDir[1] * 3.8;
      ctx.save();
      const boundary = FACE_EDGE.map(([x, y]) => [CX + x, y]).concat(
        FACE_EDGE.slice(1, -1).reverse().map(([x, y]) => [CX - x, y])
      );
      plane(boundary);
      ctx.clip();
      ctx.beginPath();
      hairContour.forEach(([x, y], i) => {
        const sway = clamp((215 - x) / 75, 0, 1) * 0.85 * P.gust;
        const q = head(x + sway * 0.9, y + Math.abs(sway) * 0.15, domeZ(x, y));
        if (i) ctx.lineTo(q[0] + shadeX, q[1] + shadeY); else ctx.moveTo(q[0] + shadeX, q[1] + shadeY);
      });
      ctx.closePath();
      const umber = mix3([117, 68, 56], [53, 57, 85], L.nightness);
      ctx.fillStyle = rgba(umber, 0.11 + 0.10 * L.keyI);
      ctx.fill();
      if (s.glasses) {
        ctx.strokeStyle = rgba(umber, 0.17 + 0.08 * L.keyI);
        ctx.lineWidth = 1.15;
        ctx.beginPath();
        for (const lens of GLASS.lenses) {
          lens.forEach(([x, y], i) => {
            const q = head(x, y, 50);
            if (i) ctx.lineTo(q[0] + shadeX * 0.38, q[1] + shadeY * 0.53); else ctx.moveTo(q[0] + shadeX * 0.38, q[1] + shadeY * 0.53);
          });
          ctx.closePath();
        }
        ctx.stroke();
      }
      ctx.restore();
      const ink = featureStyle(ALB.eye, L), brow = featureStyle(ALB.brow, L);
      const eyes = eyePolys(P, s.smile);
      for (const [i, side] of [-1, 1].entries()) {
        const cx = CX + side * EYE_OFFSET, cy = EYE_Y;
        const local = (arr) => arr.map(([x, y]) => [cx + x * side, cy + y]);
        plane(local([[-12.0, -14.7], [-9.4, -17.3], [-3.6, -18.3], [5.0, -18.1],
          [9.0, -17.3], [12.6, -14.8], [6.6, -16.0], [-2.8, -16.2], [-8.4, -14.7]]), brow);
        const outline = eyes[i];
        plane(outline, featureStyle(ALB.white, L, 1.06));
        ctx.save();
        ctx.clip();
        const iris = (r, h, offset, color) => plane(Array.from({ length: 10 }, (_, j) => {
          const a = j * TAU / 10; return [cx + offset + Math.cos(a) * r, cy - 0.6 + Math.sin(a) * h];
        }), color);
        iris(5.25, 5.7, -.40, featureStyle(ALB.iris, L));
        iris(3.15, 4.0, -.40, ink);
        plane([[cx - 2.2, cy - 2.5], [cx - 0.35, cy - 2.5], [cx - 1.2, cy - 1.15], [cx - 2.1, cy - 1.2]], featureStyle(ALB.gleam, L, 1.12));
        ctx.restore();
        const upper = outline.slice(0, 6);
        const lashWidth = [.28, 1.5, 1.95, 1.80, 1.2, .20];
        plane(upper.concat(upper.map(([x,y], j) => [x, y + lashWidth[j]]).reverse()), ink);
      }
      const m = mouthPoly(s.smile);
      plane(m.top.concat(m.bot.slice().reverse()), featureStyle(ALB.mouth, L));
      if (m.open > .12) {
        // A brief, warm tooth light, tucked between the lifted corners.
        const teeth = m.top.slice(1, -1);
        const thickness = [.32, .68, .78, .68, .32];
        const edge = teeth.map(([x,y], i) => [x, y + m.open * thickness[i]]);
        plane(teeth.concat(edge.reverse()), featureStyle(ALB.tooth, L, 1.04));
      }
      const lowerLip = m.bot.slice(1, -1);
      const roll = lowerLip.map(([x,y], j) => [x, y + [0,1.25,1.55,1.25,0][j]]);
      plane(lowerLip.concat(roll.reverse()), featureStyle(ALB.lip, L));
      // A short, warm underside connects the nose wings to the tip.
      plane([[-6.0,191.0],[-2.7,192.0],[2.0,192.2],[6.1,190.8],[3.5,194.2],[-1.2,194.7],[-4.1,193.9]]
        .map(([x,y]) => [CX+x,y]), rgba(umber, .19 + .08 * L.keyI));
      for (const side of [-1, 1]) {
        const nostril = [[2.7,193.3],[4.3,192.0],[6.6,191.6],[5.5,193.0],[3.6,193.8]];
        plane(nostril.map(([x,y]) => [CX+x*side,y]), rgba(umber, .52));
      }

    };
    const drawGlasses = (part) => {
      if (!s.glasses || view !== "rgb") return;
      shade(lin([119, 109, 109]), 0, 0.3, 0.95, L, ld, 1, 0, 1, 1, 0, 0.6);
      const fc = [enc(tone(SH[0])), enc(tone(SH[1])), enc(tone(SH[2]))];
      const z0 = 50;
      if (part === "temples") {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = rgba(fc, 0.94);
        ctx.lineWidth = 1.7;
        ctx.beginPath();
        for (const [i, side] of [-1, 1].entries()) {
          const [x, y] = GLASS.lenses[i][4];
          const a = head(x, y, z0);
          const b = head(CX + side * 55, y - 1.0, 18);
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
        }
        ctx.stroke();
        return;
      }
      // A faint wash of sky leaves the eye visible through each lens.
      for (const lensPts of GLASS.lenses) {
        const q = lensPts.map((p) => head(p[0], p[1], z0));
        ctx.fillStyle = rgba([210, 230, 250], 0.022 + 0.018 * L.ambI);
        ctx.beginPath();
        q.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.closePath();
        ctx.fill();
        // the frame: thin, its upper edges catching the light
        ctx.lineWidth = 1.0;
        ctx.lineCap = "round";
        for (let i = 0; i < q.length; i += 1) {
          const A = q[i];
          const B = q[(i + 1) % q.length];
          const topRail = i < 5;
          const lit = topRail ? .94 : 1.17;
          ctx.lineWidth = topRail ? 2.05 : 1.5;
          ctx.strokeStyle = rgba([fc[0] * lit, fc[1] * lit, fc[2] * lit], 0.95);
          ctx.beginPath();
          ctx.moveTo(A[0], A[1]);
          ctx.lineTo(B[0], B[1]);
          ctx.stroke();
        }
      }
      ctx.strokeStyle = rgba(fc, .97);
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      GLASS.bridge.forEach((pt, i) => {
        const [x, y] = head(...pt);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.stroke();
    };
    let layer = -1;
    for (const f of facets) {
      if (f[0] !== layer) {
        flush();
        if (layer < LAYER.hair && f[0] >= LAYER.hair) {
          drawFeatures();
          drawGlasses("temples");
        }
        layer = f[0];
      }
      const mat = f[11];
      let style;
      if (view === "rgb" && f[0] === LAYER.neck) style = throat;
      else if (view === "rgb") {
        const alb = matAlb(mat, hood);
        const j = 1 + f[13] * (mat === MAT.hair ? 0.06 : 0.035);
        const A = [alb[0] * j, alb[1] * j, alb[2] * j];
        let key = 1;
        if (f[0] === LAYER.hoodback) key = 0.35;
        const sp = MAT_SPEC[mat];
        const isHair = mat === MAT.hair || mat === MAT.lock || mat === MAT.hairSheen;
        if (isHair) key *= 0.84;
        let nx = f[8], ny = f[9], nz = f[10];
        if (f[0] === 0 || f[0] === 0.5) {
          // One broad deltoid plane spans the stitched armhole. Flat facets
          // return progressively over the biceps and nearer the sternum.
          const x = (f[2] + f[4] + f[6]) / 3 - P.dx - BODY_X, y = (f[3] + f[5] + f[7]) / 3;
          const d = Math.abs(x);
          const blend = 0.82 * smooth(64, 94, d) * (1 - smooth(100, 149, d)) * (1 - smooth(299, 356, y));
          const rounded = norm3([Math.sign(x) * 0.42, 0.45 - 0.004 * (y - 264), 0.90]);
          [nx, ny, nz] = norm3([mix(nx, rounded[0], blend), mix(ny, rounded[1], blend), mix(nz, rounded[2], blend)]);
        }
        if (mat === MAT.strap || mat === MAT.webEdge) {
          const x = (f[2] + f[4] + f[6]) / 3 - P.dx - BODY_X, y = (f[3] + f[5] + f[7]) / 3;
          // The textile follows the broad chest contour: suppress hard,
          // mirror-like highlights at the tessellated ribbon's row joins.
          const surface = norm3([x * 0.0046, 0.34 * (1 - smooth(267, 345, y)), 0.94]);
          [nx, ny, nz] = norm3([mix(nx, surface[0], 0.64), mix(ny, surface[1], 0.64), mix(nz, surface[2], 0.64)]);
        }
        if (f[0] === 19.5) {
          // Soft tissue catches light across each knuckle and phalanx.
          [nx, ny, nz] = norm3([0.64 * nx, 0.64 * ny + 0.05, 0.64 * nz + 0.42]);
        }
        if (f[0] === 0.25) {
          const x = (f[2] + f[4] + f[6]) / 3 - P.dx - BODY_X;
          [nx, ny, nz] = norm3([nx * 0.46 + x * 0.0018, ny * 0.46 + 0.07, nz * 0.46 + 0.53]);
        }
        if (isHair) {
          [nx, ny, nz] = norm3([nx * 0.38 - 0.05, ny * 0.39 + 0.22, nz * 0.42 + 0.58]);
        }
        if (f[0] === LAYER.head) {
          const x = (f[2] + f[4] + f[6]) / 3 - P.dx - CX, y = (f[3] + f[5] + f[7]) / 3;
          const round = norm3([x * 0.017, (174 - y) * 0.008, 0.85]);
          const soften = 0.58 + 0.27 * smooth(185, 228, y);
          [nx, ny, nz] = norm3([mix(nx, round[0], soften), mix(ny, round[1], soften), mix(nz, round[2], soften)]);
          const cheek = Math.exp(-((Math.abs(x) - 33) ** 2 / 180 + (y - 189) ** 2 / 120));
          A[0] *= 1 + 0.06 * cheek; A[1] *= 1 - 0.10 * cheek; A[2] *= 1 - 0.065 * cheek;
          // Sand bounce lights the front of the chin without flattening the side planes.
          const chinFill = .075 * (1 - L.nightness) * smooth(189, 216, y) * (1 - smooth(15, 42, Math.abs(x)));
          A[0] *= 1 + chinFill; A[1] *= 1 + chinFill; A[2] *= 1 + chinFill;
        }
        shade(A, nx, ny, nz, L, ld, key, sp[0], sp[1], f[0] === LAYER.hoodback ? 0.8 : 1, mat === MAT.skin || mat === MAT.ear ? 0.5 : 0, mat === MAT.skin || mat === MAT.ear ? 1.15 : 0.8);
        // Grazing light catches the nap of the cotton. The sand bounce on
        // the downward planes and the sky edge on the sleeves separate them.
        if (mat === MAT.hoodie || mat === MAT.selvedge || mat === MAT.strap) {
          const silhouette = (1 - Math.max(0, nz)) ** 1.7;
          const grazing = Math.max(0, nx * L.keyDir[0] + ny * L.keyDir[1]);
          const sheen = silhouette * (0.025 * L.ambI + 0.085 * L.keyI * grazing);
          for (let channel = 0; channel < 3; channel++) {
            SH[channel] += sheen * mix(L.ambL[channel], L.keyL[channel], grazing);
          }
        }
        if (isHair) {
          const band = smooth(0.25, 0.5, f[9]) * (1 - smooth(0.78, 0.97, f[9])) * (0.6 + 0.4 * f[10]);
          const sh = band * (0.03 * L.keyI + 0.02 * L.ambI) * (0.8 + 0.4 * f[13]);
          SH[0] += L.ambL[0] * sh;
          SH[1] += L.ambL[1] * sh;
          SH[2] += L.ambL[2] * sh;
        }
        if (f[0] === LAYER.head || mat === MAT.skin || mat === MAT.ear) {
          // Translucent skin picks up warm reflected light, including on the chin and cheeks.
          const bounce = (0.15 * L.ambI + 0.042 * L.keyI) * (1 - 0.24 * L.nightness);
          SH[0] += alb[0] * bounce; SH[1] += alb[1] * bounce * 0.78; SH[2] += alb[2] * bounce * 0.85;
        }
        style = css(SH[0], SH[1], SH[2]);
      } else style = flatStyle(view, "person", f[1], f[8], f[9], f[10], f[13]);
      put(f[2], f[3], f[4], f[5], f[6], f[7], style);
    }
    flush();
    if (view === "rgb") {
      // At low angles the sun (or moon) transmits light through the fine
      // hair at the silhouette. Only its light-facing edge picks up a rim.
      const strength = L.sunUp > 0.1 ? (1 - smooth(3, 27, L.sunEl)) * L.sunUp : 0.62 * L.moonUp;
      if (strength > 0.03) {
        const color = L.sunUp > 0.1 ? L.sunC : [161, 192, 234];
        const outside = hairContour.slice(0, 33).map(([x, y]) => {
          const sway = clamp((215 - x) / 75, 0, 1) * 0.85 * P.gust;
          return head(x + sway * 0.9, y + Math.abs(sway) * 0.15, domeZ(x, y));
        });
        for (let i = 1; i < outside.length; i++) {
          const a = outside[i - 1], b = outside[i], dx = b[0] - a[0], dy = b[1] - a[1];
          const length = Math.hypot(dx, dy);
          if (length < 0.1) continue;
          const facing = (dy * L.keyDir[0] + dx * L.keyDir[1]) / length;
          const light = smooth(0.24, 0.85, facing) * strength;
          if (light < 0.03) continue;
          const inset = (0.45 + light) * 1.3, ix = -dy / length * inset, iy = dx / length * inset;
          ctx.fillStyle = rgba(color, light * 0.57);
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
          ctx.lineTo(b[0] + ix, b[1] + iy); ctx.lineTo(a[0] + ix * 0.65, a[1] + iy * 0.65);
          ctx.closePath(); ctx.fill();
        }
      }
    }
    drawGlasses("front");
  };

  /* ---------- the diagnostic views, drawn as facets ---------- */

  const SEG = { sky: [124, 166, 232], sea: [52, 112, 204], sand: [232, 198, 122], person: [234, 86, 98], walker: [234, 86, 98], rock: [142, 128, 122] };
  const flatStyle = (view, cls, y, nx, ny, nz, jit) => {
    if (view === "seg") {
      const c = SEG[cls];
      const v = 1 + jit * 0.018;
      return cssS([c[0] * v, c[1] * v, c[2] * v]);
    }
    if (view === "depth") {
      let g;
      if (cls === "sky") g = 8;
      else if (cls === "sea") g = mix(34, 118, clamp((y - HORIZON) / (SHORE - HORIZON), 0, 1));
      else if (cls === "sand" || cls === "rock") g = mix(118, 214, clamp((y - SHORE) / (H - SHORE), 0, 1)) + (cls === "rock" ? 8 : 0);
      else if (cls === "walker") g = 128;
      else g = 226 + clamp(y, 0, 60) * 0.2;
      g += jit * 2;
      return cssS([g, g, g]);
    }
    // normal: camera space; the ground's normals lean toward the camera, as seen from above
    let x = nx;
    let yy = ny;
    let z = nz;
    if (cls === "sea" || cls === "sand") {
      const c = 0.955;
      const s2 = 0.3;
      yy = ny * c - nz * s2;
      z = ny * s2 + nz * c;
      const l = Math.hypot(x, yy, z) || 1;
      x /= l;
      yy /= l;
      z /= l;
    }
    if (cls === "sky") return cssS([22, 24, 34]);
    return cssS([128 + 127 * x, 128 + 127 * yy, 128 + 127 * z]);
  };

  const flatSky = (ctx, view, lean) => {
    const { X, Y, T, V } = SKY;
    const sh = -lean;
    for (let k = 0, q = 0; k < T.length; k += 3, q += 1) {
      const a = T[k], b = T[k + 1], c = T[k + 2];
      put(X[a] + sh, Y[a], X[b] + sh, Y[b], X[c] + sh, Y[c], flatStyle(view, "sky", 0, 0, 0, 1, V[q]));
    }
    flush();
  };

  /* ---------- the wire view: the meshes themselves ---------- */

  const WIRE = {
    bg0: [13, 17, 27],
    bg1: [20, 26, 38],
    grid: [64, 86, 124],
    sky: [104, 132, 196],
    sun: [255, 206, 120],
    sea: [84, 192, 236],
    foam: [214, 240, 255],
    sand: [222, 172, 112],
    rock: [204, 180, 152],
    walkers: [255, 128, 138],
    person: [255, 228, 196],
    glass: [150, 222, 255],
  };
  const OVER = { beach: [255, 222, 168], sea: [160, 236, 255], walkers: [255, 176, 176], person: [255, 238, 205] };
  let WS = { ctx: null, overlay: false, part: "", p: 1 };

  /* a part's mesh revealed by progress p: each facet has an order key in [0, 1] */
  const revealOf = (key, p) => (p >= 1 ? 1 : clamp((p * 1.25 - key * 0.97) / 0.28, 0, 1));
  const EDGE = [];
  const DOTS = [];
  const FLASH = [];
  const wireTri = (ax, ay, bx, by, cx, cy, key) => {
    const e = revealOf(key, WS.p);
    if (e <= 0) return;
    if (e >= 1) {
      EDGE.push(ax, ay, bx, by, bx, by, cx, cy, cx, cy, ax, ay);
    } else {
      EDGE.push(ax, ay, mix(ax, bx, e), mix(ay, by, e));
      EDGE.push(bx, by, mix(bx, cx, e), mix(by, cy, e));
      EDGE.push(cx, cy, mix(cx, ax, e), mix(cy, ay, e));
      FLASH.push(ax, ay, bx, by, cx, cy, 1 - e);
    }
    DOTS.push(ax, ay, bx, by, cx, cy);
  };
  const strokeWire = (color, width, dotA) => {
    const ctx = WS.ctx;
    if (FLASH.length) {
      for (let i = 0; i < FLASH.length; i += 7) {
        ctx.fillStyle = rgba(color, 0.3 * FLASH[i + 6]);
        ctx.beginPath();
        ctx.moveTo(FLASH[i], FLASH[i + 1]);
        ctx.lineTo(FLASH[i + 2], FLASH[i + 3]);
        ctx.lineTo(FLASH[i + 4], FLASH[i + 5]);
        ctx.closePath();
        ctx.fill();
      }
    }
    if (EDGE.length) {
      ctx.beginPath();
      for (let i = 0; i < EDGE.length; i += 4) {
        ctx.moveTo(EDGE[i], EDGE[i + 1]);
        ctx.lineTo(EDGE[i + 2], EDGE[i + 3]);
      }
      if (WS.overlay) {
        ctx.strokeStyle = "rgba(6,10,20,0.5)";
        ctx.lineWidth = width + 1.7;
        ctx.stroke();
        ctx.strokeStyle = rgba(OVER[WS.part] || color, 0.95);
        ctx.lineWidth = width * 0.95;
        ctx.stroke();
      } else {
        ctx.strokeStyle = rgba(color, 0.62);
        ctx.lineWidth = width;
        ctx.stroke();
      }
    }
    if (DOTS.length && dotA > 0) {
      ctx.fillStyle = rgba(WS.overlay ? OVER[WS.part] || color : color, WS.overlay ? 0.95 : dotA);
      ctx.beginPath();
      const r = WS.overlay ? 0.75 : 0.65;
      for (let i = 0; i < DOTS.length; i += 2) ctx.rect(DOTS[i] - r, DOTS[i + 1] - r, r * 2, r * 2);
      ctx.fill();
    }
    EDGE.length = 0;
    DOTS.length = 0;
    FLASH.length = 0;
  };

  const wireBackground = (ctx, s, L, lean) => {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgba(WIRE.bg0, 1));
    g.addColorStop(1, rgba(WIRE.bg1, 1));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // the ground plane's grid, as in a modelling tool
    ctx.beginPath();
    for (let i = -24; i <= 24; i += 1) {
      const Xw = i * 9;
      const far = 600;
      const nearD = 20;
      const x0 = 240 + (F * Xw) / far;
      const x1 = 240 + (F * Xw) / nearD;
      ctx.moveTo(x0 + slide(lean, KY / far), HORIZON + KY / far);
      ctx.lineTo(x1 + slide(lean, KY / nearD), HORIZON + KY / nearD);
    }
    for (let D = 18; D < 700; D *= 1.22) {
      const yp = KY / D;
      ctx.moveTo(-20, HORIZON + yp);
      ctx.lineTo(W + 20, HORIZON + yp);
    }
    ctx.strokeStyle = rgba(WIRE.grid, 0.22);
    ctx.lineWidth = 0.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, HORIZON);
    ctx.lineTo(W, HORIZON);
    ctx.strokeStyle = rgba(WIRE.grid, 0.5);
    ctx.lineWidth = 0.6;
    ctx.stroke();
  };

  const wireBeach = (ctx, s, L, t, lean, p) => {
    WS.part = "beach";
    WS.p = p;
    const { X, Y, T } = SKY;
    for (let k = 0; k < T.length; k += 3) {
      const a = T[k], b = T[k + 1], c = T[k + 2];
      const cx = (X[a] + X[b] + X[c]) / 3;
      wireTri(X[a] - lean, Y[a], X[b] - lean, Y[b], X[c] - lean, Y[c], clamp((cx + 40) / 560, 0, 1) * 0.45);
    }
    strokeWire(WIRE.sky, WS.overlay ? 0.45 : 0.6, 0.55);
    coastFacets(s, t, (ax, ay, bx, by, cx, cy, layer) => wireTri(ax, ay, bx, by, cx, cy, layer === 'cloud' ? 0.3 : 0.40));
    strokeWire(WIRE.sky, 0.48, 0.36);
    const sun = sunGeom(L, lean), moon = moonGeom(L, lean);
    if (sun) {
      SUN_RIM.forEach(([u, v], i) => {
        const next = SUN_RIM[(i + 1) % SUN_RIM.length];
        const x = sun.x + sun.r * u, y = sun.y + sun.ry * v;
        const dx = sun.r * (next[0] - u), dy = sun.ry * (next[1] - v);
        const reveal = revealOf(.40 + i * .009, p);
        for (let step = 0; step < 3; step++) {
          const a = step / 3, b = Math.min(reveal, (step + 1) / 3);
          if (b <= a || solarScreened(x + dx * (a + b) * .5, y + dy * (a + b) * .5, s, t)) continue;
          EDGE.push(x + dx * a, y + dy * a, x + dx * b, y + dy * b);
        }
      });
    }
    if (moon) moonFacets((ax, ay, bx, by, cx, cy, i) =>
      wireTri(moon.x + ax * moon.r, moon.y + ay * moon.r, moon.x + bx * moon.r, moon.y + by * moon.r, moon.x + cx * moon.r, moon.y + cy * moon.r, .40 + i * .004));
    strokeWire(WIRE.sun, 0.7, 0.8);
    for (let k = 0; k < 2; k += 1) {
      const g = gullAt(k, t);
      if (!g) continue;
      for (const f of gullFacets(g)) wireTri(f[0], f[1], f[2], f[3], f[4], f[5], 0.5);
    }
    strokeWire(WIRE.sky, 0.6, 0.6);
    const base = shoreBase(s);
    const { X: SXa, Y: SYa, T: ST, C } = SAND;
    for (let k = 0, q = 0; k < ST.length; k += 3, q += 1) {
      const a = ST[k], b = ST[k + 1], c = ST[k + 2];
      const cy = C[q * 3 + 1];
      if (cy < waterline(C[q * 3], t, base) - 4) continue;
      wireTri(SXa[a] + slide(lean, SYa[a] - HORIZON), SYa[a], SXa[b] + slide(lean, SYa[b] - HORIZON), SYa[b], SXa[c] + slide(lean, SYa[c] - HORIZON), SYa[c], 0.45 + clamp((cy - 260) / 150, 0, 1) * 0.45);
    }
    strokeWire(WIRE.sand, 0.6, 0.5);
    const { P, T: RT } = ROCK;
    for (let k = 0; k < RT.length; k += 3) {
      const A = P[RT[k]], B = P[RT[k + 1]], Cc = P[RT[k + 2]];
      wireTri(A[0] - lean * 10, A[1], B[0] - lean * 10, B[1], Cc[0] - lean * 10, Cc[1], 0.9);
    }
    strokeWire(WIRE.rock, 0.65, 0.7);
    beachStones(L, lean, (a, b, c, side) => {
      if (side !== 'shadow') wireTri(a[0], a[1], b[0], b[1], c[0], c[1], 0.92);
    });
    strokeWire(WIRE.rock, 0.44, 0.25);
    duneBlades(s, t, (ax, ay, bx, by, cx, cy) => wireTri(ax, ay, bx, by, cx, cy, 0.94));
    strokeWire(WIRE.sand, 0.42, 0.18);
  };

  const wireSea = (ctx, s, L, t, lean, p, fronts) => {
    WS.part = "sea";
    WS.p = p;
    const { T, SX, SY, FR } = SEA;
    for (let k = 0; k < T.length; k += 3) {
      const a = T[k], b = T[k + 1], c = T[k + 2];
      wireTri(SX[a], SY[a], SX[b], SY[b], SX[c], SY[c], ((FR[a] + FR[b] + FR[c]) / 3) * 0.8 + hash(k) * 0.08);
    }
    strokeWire(WIRE.sea, 0.55, 0.5);
    for (const f of fronts) foamRibbon(s, t, lean, f, (tr) => wireTri(tr[0][0], tr[0][1], tr[1][0], tr[1][1], tr[2][0], tr[2][1], clamp((tr[0][1] - HORIZON) / 110, 0, 1) * 0.8 + 0.1));
    shoreLace(s, t, lean, (pp, qq, vis) => {
      if (vis) wireTri(pp[0], pp[1], pp[2], pp[3], qq[0], qq[1], 0.92);
    });
    strokeWire(WIRE.foam, 0.6, 0.6);
    hullFacets(s, t, (ax, ay, bx, by, cx, cy) => wireTri(ax, ay, bx, by, cx, cy, 0.35));
    strokeWire(WIRE.foam, 0.55, 0.3);
  };

  const wireWalkers = (ctx, s, L, t, lean, p) => {
    WS.part = "walkers";
    const count = clamp(Math.round(s.walkers), 0, 5);
    for (let k = 0; k < count; k += 1) {
      WS.p = clamp(p * 1.4 - k * 0.2, 0, 1);
      const { x, feet, z, dir, stride } = walkerAt(k, s, t, lean);
      const fs = walkerFacets(x, feet, z, dir, stride);
      fs.forEach((f, i) => wireTri(f[0], f[1], f[2], f[3], f[4], f[5], i / fs.length));
    }
    strokeWire(WIRE.walkers, 0.5, 0.8);
  };

  /* him: hidden lines removed layer by layer, so the hair hides the forehead behind it */
  const WIRE_GROUPS = [[0, 0.25, 0.5, 0.7, 1], [2, 2.5], [2.8, 3, 3.1, 3.5, 3.6], [4, 4.2, 4.3, 5, 5.1], [6, 7], [8], [9, 9.1], [19.5, 20, 20.1]];
  const wirePerson = (ctx, s, L, t, P, p, eraseStyle) => {
    WS.part = "person";
    WS.p = p;
    const facets = personFacets(s, P);
    if (!WS.overlay) rememberPerson(facets);
    const key = (f) => clamp(1 - ((f[3] + f[5] + f[7]) / 3 - 70) / 345, 0, 1) * 0.85 + hash(f[13] * 7) * 0.08;
    let gi = 0;
    const groupOf = (layer) => WIRE_GROUPS.findIndex((g) => g.includes(layer));
    let start = 0;
    const emit = (from, to) => {
      // hide what lies behind this group
      if (WS.p > 0) {
        ctx.beginPath();
        let any = false;
        for (let i = from; i < to; i += 1) {
          const f = facets[i];
          if (revealOf(key(f), WS.p) < 0.7) continue;
          any = facetPath(ctx, f[2], f[3], f[4], f[5], f[6], f[7]) || any;
        }
        if (any) {
          if (eraseStyle === null) {
            ctx.globalCompositeOperation = "destination-out";
            ctx.fillStyle = "#000";
            ctx.fill();
            ctx.globalCompositeOperation = "source-over";
          } else {
            ctx.fillStyle = eraseStyle;
            ctx.fill();
          }
        }
      }
      for (let i = from; i < to; i += 1) {
        const f = facets[i];
        wireTri(f[2], f[3], f[4], f[5], f[6], f[7], key(f));
      }
      strokeWire(WIRE.person, 0.55, 0.7);
    };
    for (let i = 0; i <= facets.length; i += 1) {
      const g = i < facets.length ? groupOf(facets[i][0]) : -2;
      if (i === facets.length || g !== gi) {
        if (i > start) emit(start, i);
        start = i;
        gi = g;
      }
      if (i < facets.length && facets[i][0] >= LAYER.hair && i > 0 && facets[i - 1][0] < LAYER.hair) {
        // the features: eyes, smile and glasses as construction lines
      }
    }
    // the glasses and the features, drawn as part of his construction
    const pf = clamp((p - 0.7) / 0.3, 0, 1);
    if (pf > 0) {
      const head = (x, y, z) => xf(P, 1, x, y, z).slice();
      ctx.beginPath();
      if (s.glasses) {
        for (const lensPts of GLASS.lenses) {
          const q = lensPts.map((pt) => head(pt[0], pt[1], 50));
          const n = Math.max(1, Math.round(q.length * pf));
          ctx.moveTo(q[0][0], q[0][1]);
          for (let i = 1; i <= n; i += 1) ctx.lineTo(q[i % q.length][0], q[i % q.length][1]);
        }
        GLASS.bridge.forEach((pt, i) => {
          const [x,y] = head(...pt);
          if (i) ctx.lineTo(x,y); else ctx.moveTo(x,y);
        });
      }
      for (const poly of eyePolys(P, s.smile)) {
        const q = poly.map(([x,y]) => head(x, y, faceZ(x,y) + .8));
        ctx.moveTo(q[0][0], q[0][1]);
        for (let i = 1; i <= q.length; i += 1) ctx.lineTo(q[i % q.length][0], q[i % q.length][1]);
      }
      const m = mouthPoly(s.smile);
      const tq = m.top.map(([x,y]) => head(x, y, faceZ(x,y) + .8));
      const bq = m.bot.map(([x,y]) => head(x, y, faceZ(x,y) + .8));
      ctx.moveTo(tq[0][0], tq[0][1]);
      for (const pt of tq) ctx.lineTo(pt[0], pt[1]);
      for (let i = bq.length - 1; i >= 0; i -= 1) ctx.lineTo(bq[i][0], bq[i][1]);
      if (WS.overlay) {
        ctx.strokeStyle = "rgba(6,10,20,0.5)";
        ctx.lineWidth = 2.4;
        ctx.stroke();
      }
      ctx.strokeStyle = rgba(WS.overlay ? OVER.person : WIRE.glass, 0.95 * pf);
      ctx.lineWidth = 0.75;
      ctx.stroke();
    }
  };

  let LAYER_CANVAS = null;
  const overlayLayer = (ctx) => {
    const cw = ctx.canvas && ctx.canvas.width ? ctx.canvas.width : Math.round(W * 2);
    const ch = ctx.canvas && ctx.canvas.height ? ctx.canvas.height : Math.round(H * 2);
    if (!LAYER_CANVAS || LAYER_CANVAS.width !== cw || LAYER_CANVAS.height !== ch) {
      LAYER_CANVAS = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(cw, ch) : document.createElement("canvas");
      LAYER_CANVAS.width = cw;
      LAYER_CANVAS.height = ch;
    }
    const lc = LAYER_CANVAS.getContext("2d");
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.clearRect(0, 0, cw, ch);
    lc.setTransform(ctx.getTransform());
    return lc;
  };

  const drawWire = (ctx, s, L, t, lean, P, parts, overlay) => {
    const part = (k) => (parts[k] === undefined ? 1 : clamp(+parts[k], 0, 1));
    const pb = part("beach");
    const ps = part("sea");
    const pw = part("walkers");
    const pp = part("person");
    WS.overlay = overlay;
    WS.ctx = ctx;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (!overlay) wireBackground(ctx, s, L, lean);
    const fronts = frontsOf(s, t, KY / (shoreBase(s) - HORIZON));
    // over the picture, everything is drawn on a layer first, so that he can hide what is behind him
    const dc = overlay ? overlayLayer(ctx) : ctx;
    WS.ctx = dc;
    dc.lineCap = "round";
    dc.lineJoin = "round";
    if (pb > 0) wireBeach(dc, s, L, t, lean, pb);
    if (ps > 0) {
      computeSea(s, t, lean, fronts);
      wireSea(dc, s, L, t, lean, ps, fronts);
    }
    if (pw > 0) wireWalkers(dc, s, L, t, lean, pw);
    if (overlay && pb + ps + pw > 0) {
      const facets = personFacets(s, P);
      dc.beginPath();
      for (const f of facets) facetPath(dc, f[2], f[3], f[4], f[5], f[6], f[7]);
      dc.globalCompositeOperation = "destination-out";
      dc.fillStyle = "#000";
      dc.fill();
      dc.globalCompositeOperation = "source-over";
    }
    if (pp > 0) wirePerson(dc, s, L, t, P, pp, overlay ? null : rgba(mix3(WIRE.bg0, WIRE.bg1, 0.6), 1));
    if (overlay) {
      WS.ctx = ctx;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(LAYER_CANVAS, 0, 0);
      ctx.restore();
    }
  };
  const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

  /* ---------- one frame ---------- */

  const normalize = (state) => ({
    time: Math.max(0, +state.time || 0),
    hour: state.hour === undefined ? 13.2 : +state.hour,
    wind: state.wind === undefined ? 0.3 : +state.wind,
    tide: state.tide === undefined ? 0.4 : +state.tide,
    swell: state.swell === undefined ? 0.5 : +state.swell,
    walkers: state.walkers === undefined ? 2 : +state.walkers,
    hoodie: HOODIES[state.hoodie] ? state.hoodie : "charcoal",
    glasses: state.glasses !== false && state.glasses !== "false" && state.glasses !== "False",
    smile: state.smile === undefined ? 0.8 : clamp(+state.smile, 0, 1),
    lean: +state.lean || 0,
    hello: state.hello === undefined || state.hello === null ? -1 : +state.hello,
  });

  let lastPose = pose(normalize({}), 0);
  let lastTris = null;
  let lastCount = 0;
  const rememberPerson = (facets) => {
    if (!lastTris || lastTris.length < facets.length * 6) lastTris = new Float32Array(facets.length * 6 + 600);
    facets.forEach((f, i) => {
      for (let k = 0; k < 6; k += 1) lastTris[i * 6 + k] = f[2 + k];
    });
    lastCount = facets.length;
  };

  const draw = (ctx, stateIn) => {
    const state = stateIn || {};
    const s = normalize(state);
    const view = ["seg", "depth", "normal", "wire"].includes(state.view) ? state.view : "rgb";
    const t = s.time;
    const lean = clamp(s.lean, -1, 1);
    const L = lighting(s.hour);
    const P = pose(s, t);
    lastPose = P;
    const m = ctx.getTransform();
    const scale = Math.hypot(m.a, m.b) || 1;
    GROW = Math.max(0.22, 0.62 / scale);
    PCTX = ctx;
    curStyle = null;
    pending = 0;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    if (view === "wire") {
      drawWire(ctx, s, L, t, lean, P, state.parts || {}, state.overlay === true);
      ctx.restore();
      return;
    }
    const fronts = frontsOf(s, t, KY / (shoreBase(s) - HORIZON));
    computeSea(s, t, lean, fronts);
    if (view === "rgb") {
      drawSky(ctx, L, lean);
      drawLights(ctx, L, t, lean);
    } else flatSky(ctx, view, lean);
    drawCoast(s, t, L, view);
    drawSand(ctx, s, L, t, lean, view);
    if (view === "rgb") drawBackwash(ctx, s, L, t, lean);
    const exposure = view === "rgb" ? discExposure(L, s, t, lean) : 0;
    drawSea(ctx, s, L, t, lean, view, exposure);
    if (view === "rgb") drawWaterLight(ctx, s, L, t, lean, exposure);
    drawFoam(ctx, s, L, t, lean, view, fronts);
    drawLace(ctx, s, L, t, lean, view);
    drawDinghy(s, t, L, view);
    drawWalkers(ctx, s, L, t, lean, view);
    drawGulls(ctx, s, L, t, view);
    drawRock(ctx, s, L, lean, view);
    drawBeachStones(s, L, view);
    drawDunes(s, t, L, view);
    drawPerson(ctx, s, L, t, P, view, s.hoodie);
    rememberPerson(FACETS);
    ctx.restore();
  };

  const onPerson = (x, y) => {
    if (!lastTris) return false;
    const a = lastTris;
    for (let i = 0; i < lastCount * 6; i += 6) if (inTri(x, y, a[i], a[i + 1], a[i + 2], a[i + 3], a[i + 4], a[i + 5])) return true;
    return false;
  };
  const hit = (x, y) => {
    if (!lastTris) rememberPerson(personFacets(normalize({}), lastPose));
    return onPerson(x, y);
  };

  const pick = (x, y, state) => {
    if (!(x >= 0 && x <= W && y >= 0 && y <= H)) return null;
    const s = normalize(state || {});
    const t = s.time;
    const lean = clamp(s.lean, -1, 1);
    const facets = personFacets(s, pose(s, t));
    for (const f of facets) if (inTri(x, y, f[2], f[3], f[4], f[5], f[6], f[7])) return "person";
    const count = clamp(Math.round(s.walkers), 0, 5);
    for (let k = 0; k < count; k += 1) {
      const { x: wx, feet, z } = walkerAt(k, s, t, lean);
      if (Math.abs(x - wx) < 9 * z + 2 && y > feet - 28 * z && y < feet + 6) return "walkers";
    }
    if (y >= HORIZON) {
      const wl = waterline(x - slide(lean, 108), t, shoreBase(s));
      if (y <= wl) return "sea";
    }
    return "beach";
  };

  window.BeachScene = { style: "lowpoly", W, H, draw, hit, pick };
})();
