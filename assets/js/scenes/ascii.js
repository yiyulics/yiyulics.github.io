/* The beach, as truecolor ASCII art on a dark terminal: one grid of 160 x 100 monospace cells (3 x 4 frame units).
 * The shapes are drawn with contour characters, each material in its own 24-bit colour, with a little texture
 * where it brings life (rolling ~ in the sea, foam, a scatter of sand, strands of hair), and an illuminated ground that follows the hour.
 * Canvas 2D only; draw() is a pure function of the state (seeded hashes, no clocks, no Math.random).
 * window.BeachScene = { W, H, draw(ctx, state), hit(x, y), pick(x, y, state) }. */
(() => {
  "use strict";

  const W = 480;
  const H = 400;
  const HORIZON = 178;
  const SHORE = 286;
  const PHOTO_TIDE = 0.4;

  /* ---------- the grid ---------- */
  const CW = 3;
  const CH = 4;
  const COLS = W / CW;
  const ROWS = H / CH;
  const NC = COLS * ROWS;
  const HLINE = Math.round(HORIZON / CH) - 1; // the row that carries the horizon's ruled line
  const FONT = 'Menlo, Monaco, Consolas, "DejaVu Sans Mono", "Liberation Mono", "Courier New", monospace';

  const GLYPHS = [
    " ", ".", ",", ":", ";", "'", "`", "-", "_", "~", "=", "+", "*", "o", "\u00b0", "^", '"', "!", "|", "/", "\\",
    "(", ")", "[", "]", "{", "}", "<", ">", "#", "@", "M", "W", "%", "&", "8", "O", "0", "x", "v", "V", "c", "u",
    "n", "i", "l", "I", "Y", "T", "A", "H", "N", "$", "J", "L", "y", "e", "a", "s", "r", "z", "\u2588", "Q", "D",
    "w", "m", "?", "t", "f", "j", "7", "\u00b7", "X", "K", "B", "E", "R", "U", "Z", "q", "p", "d", "b", "g", "h", "k",
  ];
  const GI = {};
  GLYPHS.forEach((g, i) => (GI[g] = i));
  const gi = (ch) => (GI[ch] === undefined ? 0 : GI[ch]);

  /* ---------- small maths ---------- */
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const mix = (a, b, t) => a + (b - a) * t;
  const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const smooth = (lo, hi, v) => {
    const t = clamp((v - lo) / (hi - lo), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const frac = (v) => v - Math.floor(v);
  const hash = (n) => frac(Math.sin(n * 127.1 + 311.7) * 43758.5453);
  const hash2 = (a, b) => {
    let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const noise = (x) => {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    return mix(hash(i), hash(i + 1), u) * 2 - 1;
  };
  const scaleC = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  const addC = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

  /* ---------- the frame buffer: glyph, ink, glow, and what each cell is ---------- */
  const GW2 = COLS * 2;
  const GH2 = ROWS * 2;
  const gch = new Uint8Array(NC);
  const ink = new Uint8ClampedArray(NC * 4);
  const glo = new Uint8ClampedArray(GW2 * GH2 * 4); // a faint glow under the characters, at half-cell resolution
  const mat = new Uint8Array(NC); // material, for the buffer views
  const own = new Uint8Array(NC); // which part of the program: 1 beach, 2 sea, 3 walkers, 4 person
  const wir = new Uint8Array(NC); // the contour character of the cell, for the wire view (0 = none)
  const wirW = new Uint8Array(NC); // the world's contour under him, while he is not built yet
  const ownW = new Uint8Array(NC);
  const M = { NONE: 0, SKY: 1, SUN: 2, CLOUD: 3, SEA: 4, FOAM: 5, SAND: 6, WET: 7, ROCK: 8, WALKER: 9, GULL: 10, P_HOOD: 11, P_SKIN: 12, P_HAIR: 13, P_STRAP: 14, P_FEATURE: 16 };

  const putGlow = (i, c) => {
    const r = (i / COLS) | 0;
    const k0 = (r * 2 * GW2 + (i - r * COLS) * 2) * 4;
    const k1 = k0 + GW2 * 4;
    glo[k0] = glo[k0 + 4] = glo[k1] = glo[k1 + 4] = c[0];
    glo[k0 + 1] = glo[k0 + 5] = glo[k1 + 1] = glo[k1 + 5] = c[1];
    glo[k0 + 2] = glo[k0 + 6] = glo[k1 + 2] = glo[k1 + 6] = c[2];
    glo[k0 + 3] = glo[k0 + 7] = glo[k1 + 3] = glo[k1 + 7] = 255;
  };
  const putInk = (i, g, c) => {
    gch[i] = g;
    const k = i * 4;
    ink[k] = c[0];
    ink[k + 1] = c[1];
    ink[k + 2] = c[2];
    ink[k + 3] = 255;
  };
  const put = (i, g, c, glow) => {
    putInk(i, g, c);
    putGlow(i, glow);
  };

  /* ---------- light through the day ---------- */
  const PAL = {
    day: {
      term: [6, 13, 21], skyT: [79, 163, 194], skyH: [198, 230, 220], paper: 1,
      seaF: [48, 116, 143], seaM: [71, 159, 169], seaN: [134, 195, 177], crest: [198, 230, 213],
      foam: [223, 237, 216], foamS: [127, 183, 182], wet: [150, 158, 162], sheen: [200, 228, 244],
      sand: [232, 206, 160], sandD: [196, 164, 120], rock: [150, 138, 130],
      key: [1, 1, 1], add: [0, 0, 0], sun: [255, 246, 214], star: 0,
    },
    golden: {
      term: [10, 9, 14], skyT: [119, 153, 184], skyH: [254, 203, 139], paper: .90,
      seaF: [64, 92, 160], seaM: [86, 120, 178], seaN: [214, 176, 140], crest: [255, 222, 170],
      foam: [255, 242, 218], foamS: [190, 156, 150], wet: [160, 126, 108], sheen: [255, 212, 160],
      sand: [246, 202, 146], sandD: [196, 140, 100], rock: [160, 122, 106],
      key: [1.04, 0.92, 0.78], add: [6, 2, 0], sun: [255, 230, 170], star: 0,
    },
    sunset: {
      term: [11, 8, 16], skyT: [105, 96, 154], skyH: [247, 146, 104], paper: .73,
      seaF: [74, 64, 136], seaM: [118, 82, 140], seaN: [232, 138, 112], crest: [255, 190, 130],
      foam: [255, 218, 198], foamS: [160, 106, 134], wet: [130, 90, 100], sheen: [255, 168, 120],
      sand: [226, 162, 130], sandD: [160, 104, 100], rock: [140, 98, 100],
      key: [0.98, 0.78, 0.7], add: [8, 0, 6], sun: [255, 208, 140], star: 0.05,
    },
    dusk: {
      term: [8, 7, 16], skyT: [56, 59, 114], skyH: [213, 128, 126], paper: .33,
      seaF: [40, 44, 104], seaM: [62, 58, 120], seaN: [150, 98, 126], crest: [222, 150, 144],
      foam: [228, 198, 214], foamS: [100, 84, 132], wet: [76, 62, 96], sheen: [204, 132, 132],
      sand: [150, 118, 132], sandD: [100, 80, 104], rock: [92, 78, 96],
      key: [0.74, 0.66, 0.78], add: [4, 4, 12], sun: [255, 190, 150], star: 0.5,
    },
    night: {
      term: [3, 5, 12], skyT: [40, 56, 110], skyH: [74, 98, 160], paper: 0,
      seaF: [30, 52, 108], seaM: [40, 70, 130], seaN: [70, 108, 164], crest: [130, 164, 220],
      foam: [190, 210, 244], foamS: [70, 96, 156], wet: [56, 66, 104], sheen: [120, 150, 210],
      sand: [112, 120, 158], sandD: [70, 78, 116], rock: [76, 80, 108],
      key: [0.62, 0.68, 0.9], add: [8, 12, 28], sun: [232, 238, 255], star: 1,
    },
    dawn: {
      term: [9, 9, 18], skyT: [124, 157, 201], skyH: [253, 211, 185], paper: .80,
      seaF: [86, 102, 172], seaM: [112, 132, 194], seaN: [226, 184, 188], crest: [255, 222, 212],
      foam: [255, 242, 236], foamS: [160, 148, 186], wet: [150, 128, 142], sheen: [255, 206, 190],
      sand: [234, 202, 182], sandD: [178, 142, 140], rock: [150, 124, 130],
      key: [1, 0.9, 0.88], add: [4, 0, 4], sun: [255, 228, 204], star: 0,
    },
  };
  const TIMELINE = [[0, "night"], [4.9, "night"], [6.3, "dawn"], [8.8, "day"], [15, "day"], [16.9, "golden"], [17.7, "sunset"], [18.5, "dusk"], [19.7, "night"], [24, "night"]];
  const PAL_KEYS = Object.keys(PAL.day);
  const lighting = (hourIn) => {
    const hour = ((hourIn % 24) + 24) % 24;
    let i = 0;
    while (i < TIMELINE.length - 2 && hour >= TIMELINE[i + 1][0]) i += 1;
    const a = PAL[TIMELINE[i][1]];
    const b = PAL[TIMELINE[i + 1][1]];
    const f = smooth(TIMELINE[i][0], TIMELINE[i + 1][0], hour);
    const L = { hour };
    for (const k of PAL_KEYS) L[k] = Array.isArray(a[k]) ? mix3(a[k], b[k], f) : mix(a[k], b[k], f);
    L.t = (hour - 6) / 12;
    L.altitude = Math.sin(Math.PI * L.t);
    L.day = smooth(-0.1, 0.24, L.altitude);
    L.moonT = hour < 6 ? (hour + 6) / 12 : (hour - 18) / 12;
    L.sunX = W * (0.96 - 0.86 * L.t);
    L.sunY = HORIZON - L.altitude * 330;
    L.moonX = W * (0.96 - 0.86 * L.moonT);
    L.moonY = HORIZON - Math.sin(Math.PI * L.moonT) * 152; // high enough to pass above his head
    L.sunUp = L.t > -0.05 && L.t < 1.05 ? smooth(-0.07, 0.03, L.altitude) : 0;
    L.moonUp = L.moonT > -0.05 && L.moonT < 1.05 ? smooth(-0.05, 0.08, Math.sin(Math.PI * L.moonT)) * (1 - L.day) : 0;
    L.low = L.sunUp * (1 - smooth(0.1, 0.5, L.altitude));
    return L;
  };
  const tint = (c, L) => [c[0] * L.key[0] + L.add[0], c[1] * L.key[1] + L.add[1], c[2] * L.key[2] + L.add[2]];

  const litGround = (L, color, darkGain, sunlitGain = 1) => {
    const dark = 1 - L.paper;
    const gain = dark * darkGain + L.paper * sunlitGain;
    return [dark * L.term[0] + gain * color[0], dark * L.term[1] + gain * color[1], dark * L.term[2] + gain * color[2]];
  };

  /* ---------- the sea's geometry (shared with pick) ---------- */
  const shoreBase = (s) => SHORE + (clamp(s.tide, 0, 1) - PHOTO_TIDE) * 62;
  const waterline = (x, time, base) =>
    base + 4.5 * Math.sin(time * 0.75) + 2.6 * Math.sin(x * 0.021 + time * 0.5) + 1.8 * noise(x * 0.045 + 3) + 1.1 * Math.sin(x * 0.083 + 1.7 - time * 0.3);
  const waveOrder = (s, t) => {
    const speed = 0.04 + clamp(s.wind, 0, 1) * 0.06;
    return [0, 1, 2].map((k) => [frac(0.39 + k / 3 + t * speed), k]).sort((a, b) => a[0] - b[0]);
  };

  const shiftOf = (lean, depth) => Math.round((-lean * depth) / CW);

  /* ---------- the sky: the changing ground, haze and low cloud ---------- */
  const STAR_LIST = [];
  for (let k = 0; k < 56; k += 1) STAR_LIST.push([Math.floor(hash(k * 3.1 + 1) * COLS), Math.floor(Math.pow(hash(k * 7.7 + 2), 1.3) * (HLINE - 3)), hash(k * 5.3 + 3)]);

  const paintSky = (s, L, t, lean) => {
    const sh = shiftOf(lean, 1.5);
    const wind = clamp(s.wind, 0, 1);
    const sunX = L.sunX + sh * CW;
    const radius = 12, vertical = radius * (1 - .09 * L.low);
    const source = mix3(L.sun, [255, 249, 219], .72);
    const lower = mix3(source, [255, 176, 104], .28 + .38 * L.low);
    for (let r = 0; r < HLINE; r += 1) {
      const yc = r * CH + CH / 2;
      const f = clamp(yc / HORIZON, 0, 1);
      const base = mix3(L.skyT, L.skyH, Math.pow(f, 1.4));
      for (let c = 0; c < COLS; c += 1) {
        const i = r * COLS + c;
        const cc = c - sh;
        let col = base;
        let sunK = 0;
        if (L.sunUp > 0.01) {
          const dx = cc * CW + CW / 2 - L.sunX, dy = yc - L.sunY;
          sunK = Math.exp(-(dx * dx + dy * dy) / (2 * 16 * 16)) * L.sunUp;
          col = mix3(base, L.sun, .45 * sunK);
        }
        put(i, 0, col, litGround(L, col, .11 + .20 * f + sunK * .10));
        mat[i] = M.SKY;
        own[i] = 1;
        // a few quiet marks of haze in the last rows above the sea, drifting a little with the wind
        const haze = smooth(0.62, 0.98, f);
        const run = noise(cc * 0.11 - t * 0.04 * (0.3 + wind) + r * 5.7);
        // Broken rows of tinted stipple show the sky is printed too. Leave
        // open air between them and let the bands fade into the horizon.
        if (L.paper > .25 && r % 6 === 3 && run > .10 && (cc+2*r)%5 === 1) {
          const airy = mix3(col,L.skyH,.36);
          putInk(i,GI[f>.54 ? "-" : "."],mix3(col,airy,.73*L.paper));
        }
        if (haze > 0 && run > 0.57 && hash2(cc + 41, r * 3 + 7) < haze * 0.24) {
          putInk(i, run > 0.62 ? GI["-"] : GI["."], scaleC(col, .54));
        }
      }
    }
    // stars at night
    if (L.star > 0.02) {
      for (let k = 0; k < STAR_LIST.length; k += 1) {
        const [c0, r, f] = STAR_LIST[k];
        const c = c0 + sh;
        if (c < 0 || c >= COLS) continue;
        const tw = 0.55 + 0.45 * Math.sin(t * (1.1 + f * 1.7) + k * 2.3);
        const a = L.star * tw * (1 - smooth(HLINE - 5, HLINE - 1, r));
        if (a < 0.15) continue;
        const g = f < 0.1 ? GI["*"] : f < 0.24 ? GI["+"] : f < 0.6 ? GI["."] : GI["'"];
        putInk(r * COLS + c, g, mix3(L.skyT, [236, 240, 255], clamp(a, 0, 1)));
      }
    }
    // A luminous disc set in the terminal's character grid. Two-by-two
    // coverage samples soften its curved limb; the fine type stays sharp.
    if (L.sunUp > .01 && L.sunY + vertical > 0 && L.sunY - vertical < HORIZON) {
      const left = Math.max(0, Math.floor((sunX - radius) / CW) - 1);
      const right = Math.min(COLS - 1, Math.ceil((sunX + radius) / CW));
      const top = Math.max(0, Math.floor((L.sunY - vertical) / CH) - 1);
      const bottom = Math.min(HLINE - 1, Math.ceil((L.sunY + vertical) / CH));
      for (let r = top; r <= bottom; r++) for (let c = left; c <= right; c++) {
        const i = r * COLS + c, dx = ((c + .5) * CW - sunX) / radius, dy = ((r + .5) * CH - L.sunY) / vertical;
        const tone = mix3(source, lower, smooth(-.2, .95, dy));
        // The printer stores one ground value per vertical half-cell.
        for (let v = 0; v < 2; v++) {
          const y = dy + (v - .5) * CH / (2 * vertical);
          let coverage = 0;
          for (const u of [-.25, .25]) {
            const x = dx + u * CW / radius;
            coverage += clamp((1 - Math.hypot(x, y)) * radius + .5, 0, 1) * .5 * L.sunUp;
          }
          const k = ((2 * r + v) * GW2 + 2 * c) * 4;
          if (coverage > 0) for (let channel = 0; channel < 3; channel++) {
            glo[k + channel] = glo[k + 4 + channel] = mix(glo[k + channel], tone[channel], coverage);
          }
        }
        const d = Math.hypot(dx, dy);
        if (d > 1) continue;
        const edge = d > .70;
        const mark = edge ? (dy < -.62 ? "'" : dy > .62 ? "_" : dx < 0 ? "(" : ")") : (dy > .25 ? "-" : ".");
        putInk(i, gi(mark), mix3(tone, L.sun, edge ? .57 : .21));
        mat[i] = M.SUN;
        wir[i] = edge ? gi(mark) : 0;
      }
    }
    // The moon, a little past full, printed the way the sun is: a ground of light under the
    // type, with soft air around it. Its seas are darker marks and its right limb is a shade
    // dimmer; at this size the disc has to stay whole to read as round.
    if (L.moonUp > 0.05) {
      const moonX = L.moonX + sh * CW, moonY = L.moonY, R = 12;
      const lit = mix3([208, 216, 240], [250, 247, 232], L.moonUp);
      const seaTone = mix3(lit, [118, 134, 176], 0.5);
      const dim = mix3(lit, [120, 136, 184], 0.6);
      const SEAS = [[-0.3, -0.34, 0.36], [0.16, -0.06, 0.3], [-0.38, 0.36, 0.3], [0.12, 0.5, 0.24]];
      const face = (x, y) => {
        let sea = 0;
        for (const [sx, sy, sr] of SEAS) sea = Math.max(sea, 1 - Math.hypot(x - sx, y - sy) / sr);
        const shadow = smooth(-0.08, 0.1, x - 0.52 * Math.sqrt(Math.max(0, 1 - y * y))); // past the terminator
        const tone = mix3(mix3(lit, seaTone, clamp(sea * 1.7, 0, 0.85)), dim, shadow * 0.55);
        return { tone, sea, shadow };
      };
      const reach = R * 3;
      const left = Math.max(0, Math.floor((moonX - reach) / CW)), right = Math.min(COLS - 1, Math.ceil((moonX + reach) / CW));
      const top = Math.max(0, Math.floor((moonY - reach) / CH)), bottom = Math.min(HLINE - 1, Math.ceil((moonY + reach) / CH));
      for (let r = top; r <= bottom; r++) for (let c = left; c <= right; c++) {
        const i = r * COLS + c, dx = ((c + .5) * CW - moonX) / R, dy = ((r + .5) * CH - moonY) / R;
        // one ground value per quarter of a cell: the disc's coverage there, or the air around it
        for (let v = 0; v < 2; v++) for (let h = 0; h < 2; h++) {
          const x = dx + (h - .5) * CW / (2 * R), y = dy + (v - .5) * CH / (2 * R);
          const d = Math.hypot(x, y);
          const coverage = clamp((1 - d) * R + .5, 0, 1) * L.moonUp;
          const air = d > 1 ? .30 * Math.pow(clamp(1 - (d - 1) / 2, 0, 1), 2.2) * L.moonUp : 0;
          const k = ((2 * r + v) * GW2 + 2 * c + h) * 4;
          const tone = coverage > 0 ? face(x, y).tone : lit;
          const a = Math.max(coverage, air);
          if (a > 0) for (let channel = 0; channel < 3; channel++) glo[k + channel] = mix(glo[k + channel], tone[channel], a);
        }
        const d = Math.hypot(dx, dy);
        if (d > 1) continue;
        const { tone, sea, shadow } = face(dx, dy);
        const edge = d > .74;
        const mark = edge ? (dy < -.6 ? "'" : dy > .6 ? "_" : dx < 0 ? "(" : ")") : sea > .4 ? ":" : sea > .1 ? "." : " ";
        putInk(i, gi(mark), scaleC(tone, edge ? .78 : .74));
        mat[i] = M.SUN;
        wir[i] = edge ? gi(mark) : sea > .4 ? gi(":") : 0;
      }
    }
  };

  // Low banks of sea cloud. Each lobe leaves a lit rim and a hooked,
  // shaded underside in the letterpress. The wind moves the whole bank.
  function cloudPlate(w, h, lobes) {
    const cells = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let distance = 2, light = 0;
        for (const [cx, cy, rx, ry] of lobes) {
          const u = (x - cx) / rx, v = (y - cy) / ry;
          const d = u * u + v * v;
          if (d < distance) { distance = d; light = clamp(.60 - .28 * u - .35 * v, .12, 1); }
        }
        if (distance > 1) continue;
        let mark = " ";
        if (distance > .60) mark = light > .75 ? "'" : light > .54 ? "-" : "_";
        else if (light > .83 || (x + 2 * y) % 5 === 1) mark = light > .68 ? ":" : ".";
        cells.push([x, y, gi(mark), light, distance > .60]);
      }
    }
    return {w, cells};
  }
  const cloudBanks = [
    {x: -4, y: 15, speed: .24, plate: cloudPlate(43, 10, [[7,6,12,1.5],[13,5,8,2.5],[20,3.8,7,3.6],[28,5.3,8,2.1],[28,7,14,1.2]])},
    {x: 101, y: 9, speed: .18, plate: cloudPlate(47, 9, [[12,6,12,1.4],[17,4.7,6,2.5],[23,3.4,5.8,2.8],[28,4.3,6,2.7],[33,5.7,5,1.3],[34,7,12.5,.9]])},
    {x: 146, y: 26, speed: .12, plate: cloudPlate(26, 6, [[7,3.6,7,1.1],[13,2.4,5.5,1.6],[18,3.6,7,1]])},
  ];
  function paintClouds(s, L, t, lean) {
    const bright = mix3(L.skyH, L.sun, .35 * L.day);
    for (const {x, y, speed, plate} of cloudBanks) {
      const span = COLS + plate.w;
      const left = Math.floor((x + plate.w + t * speed * (.4 + s.wind)) % span) - plate.w + shiftOf(lean, 2);
      for (const [col, row, g, light, rim] of plate.cells) {
        const c = left + col;
        if (c < 0 || c >= COLS) continue;
        const i = (y + row) * COLS + c;
        const color = mix3(L.skyT, bright, light);
        const cloud = mix3(color, L.foam, .38 + .43 * light);
        const litInk = light > .76 ? mix3(L.foam,L.sun,.22) : mix3(L.skyT,L.skyH,light*.44);
        const mark = mix3(scaleC(color,.43+.37*light),litInk,L.paper);
        put(i,g,mark,litGround(L, mix3(color,cloud,L.paper), .16+.19*light));
        mat[i] = M.CLOUD;
        wir[i] = rim ? g : 0;
      }
    }
  }

  /* gulls: a v that flaps */
  const paintGulls = (s, L, t, lean) => {
    for (let k = 0; k < 2; k += 1) {
      const span = W + 300;
      const x = ((t * (9 + k * 4) + 310 + k * 44) % span) - 40 - lean;
      if (x < -10 || x > W + 10) continue;
      const y = 84 + k * 13 + Math.sin(t * 0.6 + k * 2) * 9;
      const c = Math.round(x / CW);
      const r = Math.round(y / CH);
      if (c < 1 || c >= COLS - 1 || r < 0 || r >= HLINE - 1) continue;
      const flap = Math.sin(t * 5.5 + k * 1.7);
      const col = mix3([200,210,236],scaleC(L.skyT,.40),L.paper);
      const i = r * COLS + c;
      const shape = flap > 0.3 ? ["\\", "/"] : flap > -0.3 ? ["~", "v"] : ["-", "v"];
      putInk(i - 1, gi(shape[0]), col);
      putInk(i, gi(shape[1]), col);
      wir[i - 1] = gi(shape[0]);
      wir[i] = gi(shape[1]);
      mat[i] = mat[i - 1] = M.GULL;
    }
  };

  // The two ridgelines overlap in sea haze. The headland's exposed
  // strata and the lighthouse are carved into that same strip of type.
  const FAR_RIDGE = [[93,44.5],[105,43.6],[117,40.2],[125,41],[134,37.2],[142,38.4],[151,35.1],[162,35.6]];
  const NEAR_RIDGE = [[110,44.6],[119,43.7],[125,42],[131,42.3],[140,39.2],[146,39.7],[151,38.6],[158,36.4],[162,36.9]];
  function ridgeAt(c, points) {
    for (let i = 1; i < points.length; i++) {
      const [left, a] = points[i - 1], [right, b] = points[i];
      if (c <= right) return mix(a, b, clamp((c - left) / (right - left), 0, 1));
    }
    return points[points.length - 1][1];
  }
  const tower = ["   ^", "  /_\\", "  [o]", "  =T=", "   |", "  :|   /\\", "  /|_ |__|"];
  function paintCape(L, lean) {
    const shift = shiftOf(lean, 3);
    const far = mix3(L.skyH, L.seaF, .36), near = mix3(L.rock, L.seaM, .52);
    for (let c = 0; c < COLS; c++) {
      const x = c - shift;
      if (x < 93) continue;
      const back = ridgeAt(x, FAR_RIDGE), front = ridgeAt(x, NEAR_RIDGE);
      for (let r = Math.ceil(back); r <= HLINE; r++) {
        const isNear = r >= front;
        const edge = r - (isNear ? front : back);
        const fold = (x + 3 * r) % 15;
        const ch = edge < 1 ? "-" : isNear && fold < 4 ? "/" : (x + 2 * r) % 7 < 2 ? ":" : " ";
        const color = isNear ? near : far;
        const i = r * COLS + c;
        put(i, gi(ch), scaleC(color, isNear ? .59 : .48), litGround(L,color,isNear ? .22 : .34,isNear ? .89 : .95));
        own[i] = 1; mat[i] = M.ROCK;
        wir[i] = edge < 1 ? GI["-"] : 0;
      }
    }
    const left = 137 + shift, top = Math.ceil(ridgeAt(140, NEAR_RIDGE)) - tower.length + 1;
    tower.forEach((line, y) => {
      for (let j = 0; j < line.length; j++) {
        const glyph = line[j];
        if (glyph === " ") continue;
        const i = (top + y) * COLS + left + j;
        const tone = glyph === "o" ? L.sun : mix3(L.skyH, L.sand, .55);
        put(i, gi(glyph), scaleC(tone, glyph === "o" ? 1 : .73 - .35*L.paper), litGround(L,tone,.22,glyph === "o" ? 1 : .82));
        mat[i] = M.ROCK; own[i] = 1; wir[i] = gi(glyph);
      }
    });
  }

  /* ---------- the sea: the horizon's ruled line, rolling ~ lines, lace of foam, the swash ---------- */
  const WL = new Float32Array(COLS); // the waterline under each column, this frame
  const paintSea = (s, L, t, lean) => {
    const shore = shoreBase(s);
    const wind = clamp(s.wind, 0, 1);
    const swell = clamp(s.swell, 0, 1);
    const shWL = shiftOf(lean, 7);
    for (let c = 0; c < COLS; c += 1) WL[c] = waterline((c - shWL) * CW + CW / 2, t, shore);
    const solar = L.sunUp > .1;
    const reflectedX = (solar ? L.sunX : L.moonX) + shiftOf(lean, 1.5) * CW;
    let exposure = 0;
    // Read the actual printed sky after clouds and the cape have covered
    // it. A hidden sun cannot leave a bright trail in front of the cape.
    if (solar && L.low > .01) {
      const col = Math.floor(reflectedX / CW), row = Math.floor(L.sunY / CH);
      for (let y = Math.max(0, row - 3); y <= Math.min(HLINE - 1, row + 3); y++)
        for (let x = Math.max(0, col - 4); x <= Math.min(COLS - 1, col + 4); x++)
          if (mat[y * COLS + x] === M.SUN) exposure++;
    }
    const reflectedLight = solar ? L.low * smooth(0, 32, exposure) : L.moonUp * .7;
    const reflectedColor = solar ? mix3(L.sun, [255, 237, 183], .48) : mix3(L.skyH, L.foam, .70);
    // Precompute the three breaking fronts by column; each row samples
    // the same curl, trough and return wash instead of inventing new foam.
    const fronts = waveOrder(s, t).map(([phase, k]) => {
      const bulk = Math.exp(-((phase - .43) ** 2) / .036);
      const width = 2.3 + swell * (4 + 8 * bulk);
      const strength = smooth(.02, .18, phase) * (1 - smooth(.85, 1, phase));
      const crests = new Float32Array(COLS);
      const breaks = new Float32Array(COLS);
      for (let c = 0; c < COLS; c++) {
        const x = (c - shWL) * CW;
        const along = Math.sin(x * .014 - .4 * t + k * 2.5);
        crests[c] = 189 + (WL[c] - 193) * phase ** 1.4
          + Math.sin(x * .006 + k * 2) * (2 + phase * 6)
          + along * (1 + phase) + noise(x * .035 + k * 7 + t * .12) * 1.4;
        breaks[c] = strength * (.51 + .28 * along + .21 * noise(x * .039 + k * 5 - t * .20));
      }
      return {crests, breaks, width};
    });
    for (let c = 0; c < COLS; c++) {
      const i = HLINE * COLS + c;
      if (mat[i] === M.ROCK) continue;
      const color = mix3(L.seaF, L.skyH, .38);
      put(i, GI["_"], scaleC(color, .72), litGround(L,color,.31,.91));
      mat[i] = M.SEA; own[i] = 2; wir[i] = GI["_"];
    }
    for (let r = HLINE + 1; r < ROWS; r += 1) {
      const yc = r * CH + CH / 2;
      for (let c = 0; c < COLS; c += 1) {
        const i = r * COLS + c;
        const wl = WL[c];
        if (yc > wl) continue;
        const f = clamp((yc - HORIZON) / (wl - HORIZON), 0, 1);
        const sh = shiftOf(lean, mix(2, 6, f));
        const x = (c - sh) * CW + CW / 2;
        const col = f < 0.5 ? mix3(L.seaF, L.seaM, f * 2) : mix3(L.seaM, L.seaN, (f - 0.5) * 2);
        // rolling lines: crests that travel towards the sand, broken into runs
        const ph = (yc - HORIZON) * (0.3 - f * 0.1) - t * (1.1 + wind * 1.6) + 1.2 * Math.sin(x * 0.016 + r * 0.9) + 0.7 * noise(x * 0.04 + r * 2.7);
        const v = Math.sin(ph) * 0.75 + 0.35 * noise(x * 0.09 - t * 0.5 + r * 5.1);
        let g = 0;
        let gcol = col;
        if (v > .72) g = GI["~"];
        else if (v > .57 && f > .12) g = GI["-"];
        if (g) {
          const nightInk = scaleC(mix3(col,L.crest,.25+.3*f),.64+.12*f);
          gcol = mix3(nightInk,mix3(col,L.crest,.54+.23*f),L.paper);
        } else if (L.paper > .25 && v < -.58 && hash2(c+37,r*2) < .45) {
          g = v < -.85 ? GI["~"] : GI["-"];
          gcol = mix3(col,L.seaF,.56+.26*L.paper);
        }
        let m = M.SEA;
        let ground = .22 + .13 * f;
        for (const front of fronts) {
          const offset = yc - front.crests[c], strength = front.breaks[c];
          if (strength < .10 || offset < -CH || offset > front.width + CH) continue;
          const lip = Math.abs(offset) < CH * .55;
          if (lip && strength > .27) {
            g = strength > .70 ? GI["~"] : GI["-"];
            gcol = mix3(L.foamS, L.foam, strength * .86);
            ground += strength * .25;
            m = M.FOAM;
            wir[i] = GI["~"];
          } else if (offset > 0 && offset < front.width) {
            const lace = Math.sin(x * .10 + offset * .76 + Math.sin(x * .028 + t * .25));
            if (lace > .34 && strength > .34) {
              g = lace > .87 && strength > .67 ? GI["°"] : GI[":"];
              gcol = mix3(L.seaN, L.foamS, strength);
              m = M.FOAM;
            }
            ground += .12 * strength * (1 - offset / front.width);
          } else if (offset < 0) ground -= .07 * strength;
        }
        // At a low sun or moon, only ripples facing the light reflect the disc.
        let waterLight = 0;
        if (reflectedLight > .04) {
          const screenX = (c + .5) * CW;
          const half = 3.5 + 23 * f;
          const axis = reflectedX + (1.3 + 3.5 * f) * Math.sin(r * 1.47 + t * .54);
          const side = (screenX - axis) / half;
          const ribbon = Math.max(0, 1 - side * side) * reflectedLight;
          const facet = .5 + .5 * Math.sin(r * 2.04 + t * .63 + screenX * .036);
          waterLight = ribbon * (.10 + .43 * facet ** 4);
          if (ribbon > .10 && facet > .58) {
            g = facet > .83 ? GI["_"] : GI["-"];
            gcol = mix3(gcol, reflectedColor, ribbon * (.46 + .52 * facet));
          }
        }
        // the swash at the edge of the water
        if (wl - yc < CH) {
          const seam = Math.sin(c * .19 - t * .4);
          g = seam > .84 ? GI["°"] : seam > .1 ? GI["~"] : GI["-"];
          gcol = mix3(L.foam, L.seaN, 0.3);
          m = M.FOAM;
          wir[i] = GI["_"];
        }
        const reflected = m === M.FOAM ? mix3(col,L.foam,.40) : col;
        put(i, g, gcol, mix3(litGround(L, mix3(col, reflected, L.paper), ground, .69 + ground), reflectedColor, waterLight));
        mat[i] = m;
        own[i] = 2;
      }
    }
  };

  // A gaff sail, a little jib and their broken reflection on the far water.
  // Reading the same letter plate in pick() keeps even the mast interactive.
  const SAIL = ["      ,", "     /|.", "    /:|:\\", "   /::|: \\", "  /:::|:  \\", " /____|:.__\\", "  \\======-'"];
  const sailAt = (s, t, lean) => ({
    col: Math.floor((22 + t * (.24 + s.wind * .42) + 13) % (COLS + 16)) - 13 + shiftOf(lean, 3),
    row: HLINE - 2 + Math.round(Math.sin(t * .9) * (.16 + .45 * s.swell)),
  });
  function paintSail(s, L, t, lean) {
    const {col, row} = sailAt(s, t, lean);
    const sailcloth = mix3(L.sand, L.foam, .6), jib = mix3(L.sandD, L.sun, .38);
    for (let y = 0; y < SAIL.length; y++) {
      const line = SAIL[y];
      for (let j = 0; j < line.length; j++) {
        const ch = line[j], x = col + j;
        if (ch === " " || x < 0 || x >= COLS) continue;
        const i = (row + y) * COLS + x;
        const hull = y === SAIL.length - 1;
        const color = hull ? mix3(L.rock, L.foamS, .32) : j > 6 ? jib : sailcloth;
        put(i, gi(ch), scaleC(color,hull ? .85-.27*L.paper : .90-.28*L.paper), litGround(L,color,hull ? .23 : ch === ":" ? .46 : .35,hull ? .70 : .98));
        own[i] = 2; mat[i] = M.SEA; wir[i] = ch === ":" ? 0 : gi(ch);
      }
    }
    for (let k = 0; k < 4; k++) {
      const r = row + SAIL.length + k, width = 8 - k * 2;
      const start = col + 6 - (width >> 1) + Math.round(Math.sin(t * 1.2 + k * 2));
      for (let j = 0; j < width; j++) {
        const x = start + j;
        if (x < 0 || x >= COLS || (j + k) % 4 === 2) continue;
        putInk(r * COLS + x, GI[k % 2 ? "." : "-"], scaleC(mix3(L.seaM, jib, .62), .71 - .09 * k));
      }
    }
  }

  /* ---------- the sand: a light scatter of . , and the wet edge, a rock in the corner ---------- */
  const paintSand = (s, L, t, lean) => {
    const sh = shiftOf(lean, 7);
    for (let r = HLINE + 1; r < ROWS; r += 1) {
      const yc = r * CH + CH / 2;
      for (let c = 0; c < COLS; c += 1) {
        const wl = WL[c];
        if (yc <= wl) continue;
        const i = r * COLS + c;
        const cc = c - sh;
        const below = yc - wl;
        const f = clamp((yc - 280) / (H - 280), 0, 1);
        let col = mix3(L.sandD, L.sand, 0.6 + 0.4 * f);
        const hv = hash2(cc + 500, r + 91);
        const ripple = noise(cc * 0.18 + r * 0.9) * 0.5 + noise(cc * 0.06 - r * 0.4 + 9) * 0.5;
        let g = 0;
        let m = M.SAND;
        if (below < 16) {
          col = mix3(col, L.wet, 0.6);
          if (hv < 0.22) g = hv < 0.1 ? GI["-"] : hv < 0.16 ? GI["_"] : GI["."];
          col = mix3(col, L.sheen, 0.35);
          m = M.WET;
        } else {
          const dens = 0.035 + 0.05 * f + 0.055 * ripple;
          if (hv < dens) g = hv < dens * 0.55 ? GI["."] : hv < dens * 0.85 ? GI[","] : GI["'"];
          col = mix3(col, [255, 250, 236], 0.1);
        }
        const ground = m === M.WET ? .24 + .09 * (1 - below / 16) : .10 + .045 * f + .025 * ripple;
        put(i, g, scaleC(col, m === M.WET ? .70 : .57), litGround(L,col,ground,.91+.05*f+.025*ripple));
        mat[i] = m;
        own[i] = 1;
      }
    }
    // the rock: an outline with a little texture
    const rs = shiftOf(lean, 11);
    for (let r = rowOfY(352); r < ROWS; r += 1) {
      for (let c = 0; c < Math.ceil(44 / CW); c += 1) {
        const cx = c - rs;
        const dx = (cx * CW + CW / 2 - 2) / 32;
        const dy = (r * CH + CH / 2 - 406) / 44;
        const d = Math.hypot(dx, dy);
        if (d > 1) continue;
        const i = r * COLS + c;
        const lit = clamp(0.8 - dx * 0.3 - dy * 0.5, 0.3, 1.1);
        const col = scaleC(L.rock, 0.7 + lit * 0.5);
        let g = 0;
        if (d > 0.78) g = dy < -0.72 ? GI["_"] : dx < 0.2 ? GI["/"] : dy < -0.4 ? GI["\\"] : GI[")"];
        else if (hash2(cx + 31, r) < 0.35) g = hash2(cx, r + 5) < 0.5 ? GI["%"] : GI["."];
        put(i, g, scaleC(col, .68), litGround(L,col,.19,.87));
        mat[i] = M.ROCK;
        own[i] = 1;
        if (d > 0.78) wir[i] = g;
      }
    }
  };
  const GRASS = [
    "         '      ,", "  '      |    .' ", "   \\    |  .'  '", " ', \\  /| /  .'",
    "   \\ \\/ / .'  ", "    \\/|//.'    ", "   _/;|/___    ",
  ];
  function paintGrass(s, L, t, lean) {
    const lit = mix3(L.sand, L.seaN, .19);
    for (const [x0, y0, n] of [[141,88,7],[132,92,4],[151,95,5]]) {
      for (let y = 0; y < n; y++) {
        const line = GRASS[GRASS.length - n + y];
        const bend = Math.round(Math.sin(.64 * t + x0) * s.wind * (n - y) * .24);
        for (let j = 0; j < line.length; j++) {
          const x = x0 + j + bend + shiftOf(lean, 11), r = y0 + y;
          const ch = line[j];
          if (x < 0 || x >= COLS || r >= ROWS || ch === " ") continue;
          const i = r * COLS + x;
          if (mat[i] !== M.SAND) continue;
          const tip = y < 2 && n === 7;
          put(i, gi(ch), scaleC(lit,tip ? .86-.33*L.paper : .54-.21*L.paper), litGround(L,lit,tip ? .15 : .11,tip ? .81 : .87));
          wir[i] = gi(ch);
        }
      }
    }
  }
  const rowOfY = (y) => Math.floor(y / CH);

  /* ---------- walkers: small figures in solid characters, strolling along the waterline ---------- */
  /* a four-frame walk to the right. h hair, s skin, t top, l legs */
  const WALK_FRAMES = [
    [".hhh.", ".hss.", "ttttt", ".ttt.", ".lll.", ".l.l.", "l...l"],
    [".hhh.", ".hss.", ".ttt.", ".ttt.", ".lll.", ".ll..", "..l.."],
    [".hhh.", ".hss.", "ttttt", ".ttt.", ".lll.", ".l.l.", "l...l"],
    [".hhh.", ".hss.", ".ttt.", ".ttt.", ".lll.", "..ll.", "..l.."],
  ];
  const WALK_W = 5;
  const WALK_H = 7;
  const WALK_GLYPH = { h: "@", s: "o", t: "#", l: "H" };
  /* The same five strollers in every style. Each keeps to one of the two stretches of shore that
   * show beside him (lo..hi, in frame units), walks to its end and turns back, so no walker is
   * ever hidden behind him and changing their number always shows. */
  const WALKERS = [
    { x: 30, lo: 12, hi: 62, speed: 1.5, top: [222, 72, 64], legs: [44, 52, 86], hair: [46, 36, 40] },
    { x: 384, lo: 352, hi: 470, speed: 1.2, top: [250, 246, 236], legs: [52, 84, 150], hair: [84, 56, 44] },
    { x: 440, lo: 352, hi: 470, speed: -1.1, top: [240, 176, 52], legs: [56, 60, 88], hair: [40, 34, 40] },
    { x: 52, lo: 12, hi: 62, speed: -0.9, top: [48, 150, 138], legs: [50, 54, 78], hair: [92, 62, 46] },
    { x: 412, lo: 352, hi: 470, speed: 1.8, top: [226, 112, 150], legs: [70, 76, 112], hair: [44, 36, 40] },
  ];
  const strollAt = (w, t) => {
    const span = w.hi - w.lo;
    const u = (((w.x - w.lo + t * w.speed) / span) % 2 + 2) % 2; // 0..2: there and back
    return { x: w.lo + (u <= 1 ? u : 2 - u) * span, dir: (u <= 1 ? 1 : -1) * (w.speed > 0 ? 1 : -1) };
  };
  const walkerAt = (k, s, t, lean) => {
    const w = WALKERS[k];
    const at = strollAt(w, t);
    const x = at.x - lean * 6;
    const feet = waterline(x + lean * 7, t, shoreBase(s)) + 4;
    return { w, x, feet, dir: at.dir, step: Math.floor(t * 2.2 * Math.abs(w.speed) + k * 2) };
  };
  const walkerBoxes = []; // [first column, last column, top row, bottom row] of each walker painted
  const paintWalkers = (s, L, t, lean) => {
    const count = clamp(Math.round(s.walkers), 0, 5);
    const skin = [226, 176, 146];
    walkerBoxes.length = 0;
    for (let k = 0; k < count; k += 1) {
      const { w, x, feet, dir, step } = walkerAt(k, s, t, lean);
      const c0 = Math.round(x / CW) - 2;
      const r1 = Math.floor((feet - 2) / CH);
      const r0 = r1 - (WALK_H - 1);
      const frame = WALK_FRAMES[step % 4];
      const colors = { h: tint(w.hair, L), s: tint(skin, L), t: tint(w.top, L), l: tint(w.legs, L) };
      for (let j = 0; j < WALK_H; j += 1)
        for (let n = 0; n < WALK_W; n += 1) {
          const role = frame[j][dir > 0 ? n : WALK_W - 1 - n];
          const c = c0 + n;
          const r = r0 + j;
          if (role === "." || c < 0 || c >= COLS || r < 0 || r >= ROWS) continue;
          const i = r * COLS + c;
          const g = gi(WALK_GLYPH[role]);
          // solid: the cell is filled with the colour and the character is printed a little darker
          put(i, g, scaleC(colors[role], 0.72), colors[role]);
          mat[i] = M.WALKER;
          own[i] = 3;
          wir[i] = g;
        }
      walkerBoxes.push([c0, c0 + WALK_W - 1, r0, r1]);
    }
  };

  /* Print the portrait in a second, warmer set of inks. Glyph weight follows
   * the lit planes; the coat uses twill marks and the hair directional strokes. */
  const portrait = window.BeachPortrait;
  const ids = portrait.id;
  const materials = [0, M.P_HAIR, M.P_SKIN, M.P_FEATURE, M.P_FEATURE, M.P_HOOD, M.P_HOOD, M.P_STRAP];
  const ramps = [
    "", "/|+ox", ":;iox@", ".:ixo", ":=x", ".:/xH", "ioxO", ":|xH"
  ];
  const characterLight = new Float32Array(portrait.palettes.charcoal.length);
  for (let k = 1; k < characterLight.length; k++) {
    const color = portrait.palettes.charcoal[k];
    characterLight[k] = (color[0] * .26 + color[1] * .56 + color[2] * .18) / 255;
  }
  // Hair follows the swept side part as short arcs. One lookup per cell
  // keeps the combed marks anchored to the head when the camera leans.
  const hairStroke = new Uint8Array(NC);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = c + .5, y = (r + .5) * CH / 3;
      const spread = x < 75 ? 75 - x : (x - 75) * 1.5;
      const slope = spread * .043 + Math.max(0, y - 35) * .075;
      const direction = slope < .37 ? "~" : slope > 1.62 ? "|" : x < 75 ? "/" : "\\";
      // Break each curved lock into strokes of ink, silver and bare paper.
      const curl = y - spread * (.13 + spread * .021);
      const gap = Math.cos(curl * 1.34 + .55 * Math.sin(spread / 5)) < -.22;
      hairStroke[r * COLS + c] = gi(gap ? "." : direction);
    }
  }
  const pose = s => ({dc: shiftOf(clamp(s.lean, -1, 1), 13), cells: portrait.frame(s)});
  const portraitRow = r => Math.floor((r + .5) * CH / 3) * portrait.width;
  const sample = (P, c, r) => {
    const x = c - P.dc;
    if (x < 0 || x >= portrait.width || r < 0 || r >= ROWS) return 0;
    return P.cells[portraitRow(r) + x];
  };

  // The portrait sheet captures an eyelid with just one row of pixels. It
  // can disappear between two rows of text. Set the aperture and iris on the
  // half-row phosphor grid, following the two eye centres on the sheet.
  const eyeX = [59.3, 77.8], eyeY = [52.95, 52.45];
  const eyeColors = {
    socket: [211,155,127], skin: [236,182,145], lid: [103,74,66],
    sclera: [239,219,191], iris: [105,79,65], irisLight: [137,101,76],
    pupil: [59,47,49], lower: [200,143,121], brow: [103,73,62],
  };
  const eyeNames = Object.keys(eyeColors);
  const eyeIndex = Object.fromEntries(eyeNames.map((name,i) => [name,i+1]));
  // Fit the raised inner and outer corners while retaining a relaxed lower lid.
  function eyeTone(x,y,closed) {
    for (let side=0;side<2;side++) {
      const dx=x-eyeX[side], u=dx/4.68;
      const browU = dx / 5.5;
      if (Math.abs(browU) < 1.05 && y > 44.7 && y < 48.8) {
        const inner = side ? -browU : browU;
        const arch = (side ? 46.25 : 46.55) + 0.98*browU*browU + 0.13*inner;
        const thickness = 0.38 + 0.82*(1-Math.abs(browU)) + 0.24*inner;
        return Math.abs(y-arch)<thickness/2 ? eyeIndex.brow : eyeIndex.skin;
      }
      if (Math.abs(u)>1.09) continue;
      const centre=eyeY[side] - (side ? u : -u)*0.18;
      const curve=Math.max(0,1-u*u);
      const top=centre-(closed ? -0.72 : 1.75)*curve;
      const bottom=closed ? top : centre+1.06*curve;
      if (y<centre-2.65 || y>centre+2.30) return 0;
      const thick=0.62+0.32*curve;
      if (Math.abs(u)<1.04 && Math.abs(y-top)<thick/2) return eyeIndex.lid;
      if (!closed && Math.abs(u)<1 && y>top && y<bottom) {
        const v=(y-centre+0.10)/1.66;
        if ((dx/1.0)**2+(v/.94)**2 < 1) return eyeIndex.pupil;
        if ((dx/1.87)**2+v*v < 1) return v>.32 ? eyeIndex.irisLight : eyeIndex.iris;
        return eyeIndex.sclera;
      }
      if (!closed && Math.abs(u)<0.83 && Math.abs(y-bottom)<0.35) return eyeIndex.lower;
      if (y<top-0.58 && Math.abs(u)<0.82) return eyeIndex.socket;
      return eyeIndex.skin;
    }
    return 0;
  }
  const eyePalette=[null,...Object.values(eyeColors)];
  const eyeSamples=new Map();
  // Eight sub-samples give one printed half-row an antialiased brow or lid
  // without introducing a separate drawing pass or changing the glyph grid.
  function paperSample(x,y,closed) {
    let red=0, green=0, blue=0, count=0;
    for(const dy of [-0.17,0.17]) for(const dx of [-0.36,-0.12,0.12,0.36]) {
      const tone=eyeTone(x+dx,y+dy,closed);
      if(!tone) continue;
      const rgb=eyePalette[tone];
      red+=rgb[0]; green+=rgb[1]; blue+=rgb[2]; count++;
    }
    if(!count) return 0;
    red=Math.round(red/count); green=Math.round(green/count); blue=Math.round(blue/count);
    const key=(red<<16)|(green<<8)|blue;
    if(!eyeSamples.has(key)) eyeSamples.set(key,eyePalette.push([red,green,blue])-1);
    return eyeSamples.get(key);
  }
  const eyePlates=[false,true].map(closed => {
    const ground=new Uint16Array(COLS*GH2), glyph=new Uint8Array(NC);
    for(let r=33;r<43;r++) for(let c=52;c<=84;c++) {
      glyph[r*COLS+c]=eyeTone(c+0.5,(r+0.5)*CH/3,closed);
      for(let half=0;half<2;half++) ground[(r*2+half)*COLS+c]=paperSample(c+0.5,(r+0.25+half*.5)*CH/3,closed);
    }
    return {ground,glyph};
  });
  let eyeHour, ocular;
  const faceGrain = new Uint8Array(NC);
  for(let r=20;r<67;r++) for(let c=42;c<94;c++) {
    faceGrain[r*COLS+c] = Math.floor(hash2(c,r)*8);
  }

  function paintPerson(s, L, P) {
    const palette = portrait.palettes[s.hoodie] || portrait.palettes.charcoal;
    const rimLight = Math.max(L.low * .70, L.moonUp * .55);
    const rimLeft = (L.sunUp > .1 ? L.sunX : L.moonX) < W / 2;
    const rimColor = L.sunUp > .1 ? L.sun : L.foam;
    // Read the actual eye on the sheet, so blinking stays synchronized with
    // Pixel even if its timing changes. The glint is a single fine ink mark.
    const closed=P.cells[53*portrait.width+59]!==ids.eye;
    const eyePlate=eyePlates[closed ? 1 : 0];
    if(eyeHour!==L.hour) {
      ocular=eyePalette.map(rgb=>rgb && tint(rgb,L));
      eyeHour=L.hour;
    }
    const glint=tint([250,227,188],L);
    const tones = palette.map((rgb, k) => {
      if (!k) return null;
      const kind = portrait.region[k];
      // Indigo silk-light in the hair, amber on the cheeks, sea-green in the cloth.
      const wash = kind === 1 ? [97,153,178] : kind === 5 ? [85,154,151] : kind === 7 ? [186,171,126] : [255,200,156];
      const strength = kind === 1 ? .32 : kind === 5 && s.hoodie === "charcoal" ? .22 : .045;
      const ink = tint(scaleC(mix3(rgb, wash, strength), 1.08), L);
      // The phosphor behind the ink follows the local tone. A pale cheek can
      // now hold a fine dark eyelid or spectacle rim between two text rows.
      const level = characterLight[k];
      const light = kind === 1 ? .06 + 1.3 * level
        : kind === 2 ? level ** 2 * 1.04 : kind === 3 || kind === 4 ? level ** 2 * .85 : .13 + level * .76;
      const glow=addC(L.term,ink,light);
      // The wire rims are thin metal in front of skin, distinct in value
      // from both the brown lash line and the nearly black pupil.
      if (k===ids.frame) return {ink:tint([116,104,96],L),rim:ink,glow:tint([142,125,110],L)};
      if (k===ids.lens) return {ink:tint([219,205,178],L),rim:ink,glow:tint([219,189,159],L)};
      return {ink,rim:mix3(ink,rimColor,rimLight),glow};
    });
    // Keep the face in warm half-tones. Treat its marks as ink on skin so
    // dark brows, rims and the corners of the smile keep distinct values.
    const faceGround=palette.map((rgb,k) => {
      if(!k) return null;
      if(k===ids.frame) return tint([121,106,99],L);
      if(k===ids.lens) return tint([226,195,164],L);
      if(k===ids.brow) return tint([105,76,66],L);
      if(k===ids.lip) return tint([147,83,79],L);
      if(k===ids.teeth) return tint([242,218,185],L);
      return mix3(tones[k].glow,tint(rgb,L),0.70);
    });
    const facePen=palette.map((rgb,k) => k ? tint(mix3(rgb,[255,226,188],0.32),L) : null);
    for (let r = 8; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const tone = sample(P, c, r);
        if (!tone) continue;
        const i = r * COLS + c, kind = portrait.region[tone];
        const left = sample(P, c - 1, r), right = sample(P, c + 1, r);
        const up = sample(P, c, r - 1), down = sample(P, c, r + 1);
        const u = c - P.dc;
        const level = characterLight[tone], ramp = ramps[kind];
        const grain = ((u + r * 2) % 5) / 5;
        let char = ramp[Math.min(ramp.length - 1, Math.floor((level * .86 + grain * .12) * ramp.length))];
        if (kind === 1) char = tone === ids.hairInk ? "." : GLYPHS[hairStroke[r * COLS + u]];
        const onFace = kind>=2 && kind<=4 && ((u>=43 && u<=92 && r<59) ||
          (u>=58 && u<=80 && r<66));
        const atlasCell=r*COLS+u;
        let characterInk=onFace && kind===2 ? facePen[tone] : tones[tone].ink;
        if (kind===2) {
          if(onFace) {
            const grain=faceGrain[atlasCell];
            const strokes=tone===ids.skinDeep ? ":i/;i+::" : tone===ids.skinShade ? ":;/i::;," :
              tone===ids.skinSun ? "·:'.+·i·" : ".':;o·,i";
            char=strokes[grain];
          } else {
            const surface=tone===ids.skinSun ? "oxO" : tone===ids.skinLight ? "xos" : tone===ids.skin ? "+is" : ":;i";
            char=surface[(u+Math.floor(r/3))%surface.length];
          }
        }
        if (kind === 5 && grain < .3) char = (u < 66) === (r % 8 < 4) ? "/" : "\\";
        if (kind === 7 && (tone === ids.web || tone === ids.webLight)) {
          char = (u + r) % 3 === 0 ? ":" : "/";
        }
        if (kind===4) {
          char=tone===ids.lens ? "'" : left===ids.frame || right===ids.frame ? "-" : "|";
        }
        if(tone===ids.brow) char="-";
        if(tone===ids.lip) char="~";
        if(tone===ids.lipLight || tone===ids.teeth) char="-";
        const localEye=onFace && kind!==4 ? eyePlate.glyph[atlasCell] : 0;
        if(localEye) {
          char=localEye===eyeIndex.lid || localEye===eyeIndex.brow ? "-" : localEye===eyeIndex.iris ? ":" : ".";
          characterInk=ocular[localEye];
          if(!closed && (u===59 && r===39 || u===77 && r===38)) {
            char="'";
            characterInk=glint;
          }
        }
        const contour = !left || !right ? "|" : !up || !down ? "-" : "";
        const boundary = portrait.region[left] !== kind || portrait.region[up] !== kind;
        const hairSeam = kind === 1 && (tone === ids.hairLight || tone === ids.hairRim) && up !== tone;
        const line = contour || (boundary ? (portrait.region[left] !== kind ? "/" : "-") : hairSeam ? char : "");
        const rim = rimLight > .05 && !(rimLeft ? left : right);
        putInk(i, gi(char), rim ? tones[tone].rim : characterInk);
        for (let half = 0; half < 2; half++) {
          const row = Math.floor((r + half * .5 + .25) * CH / 3);
          const subTone = P.cells[row * portrait.width + u] || tone;
          const offset = ((r * 2 + half) * GW2 + c * 2) * 4;
          const eye=onFace && subTone!==ids.frame && subTone!==ids.lens ? eyePlate.ground[(r*2+half)*COLS+u] : 0;
          const facePaper=onFace && portrait.region[subTone]>=2 && portrait.region[subTone]<=4;
          const color=eye ? ocular[eye] : facePaper ? faceGround[subTone] : tones[subTone].glow;
          glo[offset] = glo[offset + 4] = color[0];
          glo[offset + 1] = glo[offset + 5] = color[1];
          glo[offset + 2] = glo[offset + 6] = color[2];
          glo[offset + 3] = glo[offset + 7] = 255;
        }
        own[i] = 4;
        mat[i] = materials[kind];
        wir[i] = line ? gi(line) : 0;
      }
    }
  }

  /* ---------- rendering the grid ---------- */
  let RES = null; // canvases at the current device scale
  const resources = (scale) => {
    if (RES && RES.scale === scale) return RES;
    const cw = CW * scale;
    const ch = CH * scale;
    const pad = Math.ceil(3 * scale);
    const slotW = Math.ceil(cw) + pad * 2;
    const slotH = Math.ceil(ch) + pad * 2;
    const atlas = document.createElement("canvas");
    atlas.width = slotW * GLYPHS.length;
    atlas.height = slotH * 3;
    const a = atlas.getContext("2d");
    a.font = `100px ${FONT}`;
    const adv = a.measureText("M").width / 100 || 0.6;
    const fontU = (CW * 1.06) / adv;
    a.font = `${(fontU * scale).toFixed(2)}px ${FONT}`;
    a.textAlign = "center";
    a.textBaseline = "alphabetic";
    const cap = a.measureText("H").actualBoundingBoxAscent || fontU * scale * 0.73;
    const base = (ch + cap) / 2 - 0.1 * scale;
    const row = (k, fill, halo) => {
      a.save();
      a.fillStyle = fill;
      if (halo) {
        a.shadowColor = "rgba(0,4,10,0.95)";
        a.shadowBlur = 2.2 * scale;
      }
      GLYPHS.forEach((g, i) => {
        if (g === " ") return;
        const x = i * slotW + pad + cw / 2;
        const y = k * slotH + pad + base;
        a.fillText(g, x, y);
        if (halo) a.fillText(g, x, y);
      });
      a.restore();
      if (halo) {
        a.fillStyle = fill;
        GLYPHS.forEach((g, i) => {
          if (g !== " ") a.fillText(g, i * slotW + pad + cw / 2, k * slotH + pad + base);
        });
      }
    };
    row(0, "#fff", false);
    row(1, "rgb(92,190,150)", false);
    row(2, "rgb(214,255,236)", true);
    // Extract the uncoloured glyphs once. A hardware terminal prints a cell
    // by combining this coverage with its own ink and its local ground.
    const gw = Math.round(W * scale), gh = Math.round(H * scale);
    const X = Int32Array.from({length:COLS+1}, (_,c) => Math.round(c*cw));
    const Y = Int32Array.from({length:ROWS+1}, (_,r) => Math.round(r*ch));
    const tileW = Math.ceil(cw), tileH = Math.ceil(ch), tileSize = tileW*tileH;
    const source = a.getImageData(0,0,atlas.width,slotH).data;
    const coverage = new Uint8Array(tileSize*GLYPHS.length);
    const soft = new Uint8Array(coverage.length);
    for (let g=1; g<GLYPHS.length; g++) {
      const offset = g*tileSize;
      for (let y=0; y<tileH; y++) {
        const row = ((pad+y)*atlas.width + g*slotW + pad)*4 + 3;
        for (let x=0; x<tileW; x++) coverage[offset+y*tileW+x] = source[row+x*4];
      }
      // The low phosphor halo comes from this glyph, so bright strokes
      // remain legible over night water without blurring the entire frame.
      const reach = Math.max(1,Math.round(scale));
      for (let y=0; y<tileH; y++) {
        for (let x=0; x<tileW; x++) {
          let sum = 0;
          for (let v=-1; v<=1; v++) for (let u=-1; u<=1; u++) {
            const xx=x+u*reach, yy=y+v*reach;
            if (xx>=0 && xx<tileW && yy>=0 && yy<tileH) sum+=coverage[offset+yy*tileW+xx];
          }
          soft[offset+y*tileW+x]=Math.round(sum/9);
        }
      }
    }
    const print = document.createElement("canvas");
    print.width = gw;
    print.height = gh;
    const pc = print.getContext("2d");
    const pixels = pc.createImageData(gw,gh);
    const columns = new Uint16Array(gw), scanlines = new Uint16Array(gh);
    const across = new Int16Array(gw), groundRow = new Uint16Array(gh), vertical = new Float32Array(gh);
    for (let c=0;c<COLS;c++) for(let x=X[c];x<X[c+1];x++) {
      columns[x]=Math.floor((x-X[c]+.5)*tileW/(X[c+1]-X[c]));
      const u = (x+.5)*GW2/gw - .5 - 2*c;
      across[x] = Math.round(256*(u<0 ? u : Math.max(0,u-1)));
    }
    for (let r=0;r<ROWS;r++) for(let y=Y[r];y<Y[r+1];y++) {
      scanlines[y]=Math.floor((y-Y[r]+.5)*tileH/(Y[r+1]-Y[r]))*tileW;
      const v=clamp((y+.5)*GH2/gh-.5,0,GH2-1);
      groundRow[y]=Math.floor(v);
      vertical[y]=v-groundRow[y];
    }
    RES = {
      scale,cw,ch,pad,slotW,slotH,atlas,X,Y,gw,gh,print,pc,pixels,tileSize,columns,scanlines,coverage,soft,
      across,groundRow,vertical,dirty:new Uint8Array(NC),
      previousGlyph:new Uint8Array(NC),previousInk:new Uint32Array(NC),
      previousTop:new Uint32Array(NC),previousBottom:new Uint32Array(NC),previousBloom:-1,
    };
    return RES;
  };
  const deviceScale = (ctx) => {
    const m = ctx.getTransform ? ctx.getTransform() : null;
    const sc = m ? Math.hypot(m.a, m.b) : 1;
    return Math.round(clamp(sc, 0.5, 8) * 100) / 100;
  };

  // One retained print surface per active device scale. Only cells whose
  // glyph, ink or either half-cell of ground changed need to be typeset.
  const inkWords = new Uint32Array(ink.buffer);
  const glowWords = new Uint32Array(glo.buffer);
  const renderGrid = (ctx,R,bloom) => {
    const {pixels,gw,gh,X,Y,columns,scanlines,coverage,soft,tileSize} = R;
    const output = pixels.data;
    const all = R.previousBloom !== bloom;
    const dirty=R.dirty;
    dirty.fill(all ? 1 : 0);
    // A changed ground also affects the neighbouring cells through its
    // half-cell blend. Glyph ink does not bleed across cell boundaries.
    for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++) {
      const i=r*COLS+c, bg=r*2*GW2+c*2;
      const top=glowWords[bg], bottom=glowWords[bg+GW2], color=inkWords[i], glyph=gch[i];
      if(!all && (top!==R.previousTop[i] || bottom!==R.previousBottom[i])) {
        const x0=Math.max(0,c-1), x1=Math.min(COLS,c+2);
        for(let rr=Math.max(0,r-1);rr<Math.min(ROWS,r+2);rr++) dirty.fill(1,rr*COLS+x0,rr*COLS+x1);
      } else if(color!==R.previousInk[i] || glyph!==R.previousGlyph[i]) dirty[i]=1;
      R.previousTop[i]=top; R.previousBottom[i]=bottom; R.previousInk[i]=color; R.previousGlyph[i]=glyph;
    }
    let left=gw, top=gh, right=0, bottom=0;
    for(let r=0;r<ROWS;r++) {
      for(let c=0;c<COLS;c++) {
        const i=r*COLS+c;
        if(!dirty[i]) continue;
        const x0=X[c], x1=X[c+1], y0=Y[r], y1=Y[r+1], glyphStart=gch[i]*tileSize;
        left=Math.min(left,x0); right=Math.max(right,x1); top=Math.min(top,y0); bottom=Math.max(bottom,y1);
        const ir=ink[i*4], ig=ink[i*4+1], ib=ink[i*4+2];
        for(let y=y0;y<y1;y++) {
          const v=R.groundRow[y], next=Math.min(v+1,GH2-1), t=R.vertical[y];
          const a=(v*GW2+c*2)*4, b=(next*GW2+c*2)*4;
          const before=c>0 ? -8 : 0, after=c<COLS-1 ? 8 : 0;
          const red=glo[a]+(glo[b]-glo[a])*t, green=glo[a+1]+(glo[b+1]-glo[a+1])*t, blue=glo[a+2]+(glo[b+2]-glo[a+2])*t;
          const leftR=(glo[a+before]+(glo[b+before]-glo[a+before])*t-red)/256;
          const leftG=(glo[a+before+1]+(glo[b+before+1]-glo[a+before+1])*t-green)/256;
          const leftB=(glo[a+before+2]+(glo[b+before+2]-glo[a+before+2])*t-blue)/256;
          const rightR=(glo[a+after]+(glo[b+after]-glo[a+after])*t-red)/256;
          const rightG=(glo[a+after+1]+(glo[b+after+1]-glo[a+after+1])*t-green)/256;
          const rightB=(glo[a+after+2]+(glo[b+after+2]-glo[a+after+2])*t-blue)/256;
          const stripe=glyphStart+scanlines[y];
          let out=(y*gw+x0)*4;
          for(let x=x0;x<x1;x++,out+=4) {
            const k=R.across[x], at=stripe+columns[x];
            const alpha=coverage[at]/255, localLight=soft[at]*bloom/255;
            const br=red+(k<0 ? -k*leftR : k*rightR);
            const bg=green+(k<0 ? -k*leftG : k*rightG);
            const bb=blue+(k<0 ? -k*leftB : k*rightB);
            output[out]=br+(ir-br)*alpha+localLight*ir;
            output[out+1]=bg+(ig-bg)*alpha+localLight*ig;
            output[out+2]=bb+(ib-bb)*alpha+localLight*ib;
            output[out+3]=255;
          }
        }
      }
    }
    R.previousBloom=bloom;
    if(right>left) R.pc.putImageData(pixels,0,0,left,top,right-left,bottom-top);
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(R.print,0,0,gw,gh,0,0,W,H);
  };

  /* ---------- one frame ---------- */
  const normalize = (state) => ({
    time: Math.max(0, +state.time || 0),
    hour: state.hour === undefined ? 13.2 : +state.hour,
    wind: state.wind === undefined ? 0.3 : +state.wind,
    tide: state.tide === undefined ? 0.4 : +state.tide,
    swell: state.swell === undefined ? 0.5 : +state.swell,
    walkers: state.walkers === undefined ? 2 : +state.walkers,
    hoodie: state.hoodie || "charcoal",
    glasses: state.glasses !== false && state.glasses !== "false" && state.glasses !== "False",
    smile: state.smile === undefined ? 0.8 : +state.smile,
    lean: +state.lean || 0,
    yaw: +state.yaw || 0,
    pitch: +state.pitch || 0,
    hello: state.hello === undefined || state.hello === null ? -1 : +state.hello,
  });

  /* ---------- the 3D world behind him, typed on this grid ----------
     When the shared world (assets/js/beach-env.js) is there, it is rendered small and read
     back twice: its colours at half-cell resolution, which become the ground under the
     characters, and what each cell shows. From the two, every cell gets a character: a
     contour where one thing ends and another begins, a mark where the picture has detail
     (a crest, a grain of sand, a star), or nothing. */
  const worldOf = () => (window.BeachEnv && window.BeachEnv.ready() ? window.BeachEnv : null);
  //            -  sky    cloud    sun    gull    sea    foam    sand    wet    rock    walker    land    boat   grass   tower
  const E_MAT = [M.SKY, M.SKY, M.CLOUD, M.SUN, M.GULL, M.SEA, M.FOAM, M.SAND, M.WET, M.ROCK, M.WALKER, M.ROCK, M.SEA, M.ROCK, M.ROCK];
  const E_OWN = [1, 1, 1, 1, 1, 2, 2, 1, 1, 1, 3, 1, 2, 1, 1];
  const E_GROUP = [1, 1, 2, 3, 4, 5, 5, 7, 7, 9, 10, 11, 12, 13, 14]; // foam is sea and wet sand is sand, for the contours
  const eid = new Uint8Array(NC);
  const lum = new Float32Array(NC);
  const cellC = new Uint8Array(NC * 3);
  const BANDS = 16; // steps of brightness in the ground
  const cellHash = (c, r) => frac(Math.sin(c * 12.9898 + r * 78.233) * 43758.5453);
  const paintEnvironment3d = (env, state, L) => {
    const ids = env.pixels(Object.assign({}, state, { view: "ids" }), COLS, ROWS);
    if (!ids) return false;
    for (let i = 0; i < NC; i += 1) eid[i] = ids[i * 4] < 15 ? ids[i * 4] : 0;
    const px = env.pixels(Object.assign({}, state, { view: "rgb", look: { grain: 0, vignette: 0.12 } }), GW2, GH2);
    if (!px) return false;
    // the ground: the picture itself, dimmed to the terminal's dark screen as the daylight goes
    const dark = 1 - L.paper;
    const gain = dark * 0.36 + L.paper * 0.97;
    for (let k = 0; k < GW2 * GH2 * 4; k += 4) {
      // brightness in a few flat bands, as a terminal's blocks of colour; the hue is kept
      const luma = Math.sqrt((px[k] * 0.3 + px[k + 1] * 0.55 + px[k + 2] * 0.15) / 255);
      const band = Math.round(luma * BANDS) / BANDS;
      const q = luma > 0.02 ? (gain * band * band) / (luma * luma) : gain;
      glo[k] = dark * L.term[0] + Math.min(255, q * px[k]);
      glo[k + 1] = dark * L.term[1] + Math.min(255, q * px[k + 1]);
      glo[k + 2] = dark * L.term[2] + Math.min(255, q * px[k + 2]);
      glo[k + 3] = 255;
    }
    for (let r = 0, i = 0; r < ROWS; r += 1)
      for (let c = 0; c < COLS; c += 1, i += 1) {
        const a = (r * 2 * GW2 + c * 2) * 4, b = a + GW2 * 4;
        const R = (px[a] + px[a + 4] + px[b] + px[b + 4]) >> 2;
        const G = (px[a + 1] + px[a + 5] + px[b + 1] + px[b + 5]) >> 2;
        const B = (px[a + 2] + px[a + 6] + px[b + 2] + px[b + 6]) >> 2;
        cellC[i * 3] = R; cellC[i * 3 + 1] = G; cellC[i * 3 + 2] = B;
        lum[i] = (R * 0.3 + G * 0.55 + B * 0.15) / 255;
      }
    const col = [0, 0, 0];
    const lift = (k) => [col[0] + (255 - col[0]) * k, col[1] + (255 - col[1]) * k, col[2] + (255 - col[2]) * k];
    for (let r = 0, i = 0; r < ROWS; r += 1)
      for (let c = 0; c < COLS; c += 1, i += 1) {
        const e = eid[i], g = E_GROUP[e];
        const up = r > 0 ? i - COLS : i, dn = r < ROWS - 1 ? i + COLS : i, lf = c > 0 ? i - 1 : i, rt = c < COLS - 1 ? i + 1 : i;
        const gd = E_GROUP[eid[dn]], gl = E_GROUP[eid[lf]], gr = E_GROUP[eid[rt]], gu = E_GROUP[eid[up]];
        col[0] = cellC[i * 3]; col[1] = cellC[i * 3 + 1]; col[2] = cellC[i * 3 + 2];
        const hp = lum[i] - (lum[up] + lum[dn] + lum[lf] + lum[rt]) * 0.25; // brighter or darker than what is around it
        const h = cellHash(c, r);
        mat[i] = E_MAT[e];
        own[i] = E_OWN[e];
        let ch = "", edge = "", shade = 0.72;
        // contours: a rule under whatever ends here, a stroke down the side of whatever stands in front
        if (gd !== g) edge = gl !== g && gr === g && gl < g ? "/" : gr !== g && gl === g && gr < g ? "\\" : "_";
        else if (gl < g) edge = (r < ROWS - 1 && c > 0 && E_GROUP[eid[dn - 1]] === g) ? "/" : (r > 0 && c > 0 && E_GROUP[eid[up - 1]] === g) ? "\\" : "|";
        else if (gr < g) edge = (r < ROWS - 1 && c < COLS - 1 && E_GROUP[eid[dn + 1]] === g) ? "\\" : (r > 0 && c < COLS - 1 && E_GROUP[eid[up + 1]] === g) ? "/" : "|";
        if (e === 5) { // sea: crests and troughs
          if (lum[i] > 0.9 && hp > 0.03) { ch = "*"; shade = -0.7; }
          else if (hp > 0.045) { ch = "~"; shade = -0.5; }
          else if (hp > 0.016) { ch = "~"; shade = -0.22; }
          else if (hp < -0.035) ch = "_";
          else if (hp < -0.014) ch = "-";
        } else if (e === 6) { // foam
          ch = hp > 0.02 ? (h < 0.5 ? "*" : "\u00b0") : h < 0.34 ? "~" : h < 0.6 ? '"' : h < 0.8 ? "o" : "~";
          shade = hp > 0.02 ? -0.75 : 0.8;
        } else if (e === 7) { // dry sand
          if (hp > 0.022) { ch = "."; shade = -0.4; }
          else if (hp < -0.022) ch = h < 0.5 ? "," : ":";
          else if (h < 0.035) ch = ".";
        } else if (e === 8) { // wet sand
          if (hp > 0.03) { ch = "-"; shade = -0.35; }
          else if (hp < -0.03) ch = "_";
          else if (h < 0.03) ch = "-";
        } else if (e === 1) { // sky: only the stars, and a wisp of high cloud
          if (hp > 0.11) { ch = "*"; shade = -0.8; }
          else if (hp > 0.04 && dark > 0.3) { ch = h < 0.5 ? "." : "+"; shade = -0.7; }
          else if (hp > 0.035) { ch = "-"; shade = -0.35; }
        } else if (e === 2) { // cloud: the shaded side is stippled
          if (hp < -0.03) ch = ":";
          else if (hp < -0.012) ch = ".";
          else if (hp > 0.04) { ch = "'"; shade = -0.6; }
        } else if (e === 3) { ch = h < 0.5 ? "@" : "O"; shade = -0.5; }
        else if (e === 4) { ch = "v"; shade = 0.5; edge = ""; }
        else if (e === 9) ch = lum[i] < 0.42 ? (h < 0.5 ? "#" : "%") : h < 0.5 ? "&" : "8";
        else if (e === 10) { ch = gu !== g ? "@" : gd !== g ? "H" : "#"; shade = 0.62; edge = ""; }
        else if (e === 11) { if (hp > 0.02) { ch = "^"; shade = -0.25; } else if (hp < -0.02) ch = "/"; else if (h < 0.16) ch = ":"; }
        else if (e === 12) { ch = lum[i] > 0.72 ? (gl !== g ? "/" : gr !== g ? "\\" : "|") : "="; shade = lum[i] > 0.72 ? 0.7 : 0.6; edge = ""; }
        else if (e === 13) { ch = h < 0.4 ? "/" : h < 0.75 ? "\\" : "|"; shade = hp > 0 ? -0.3 : 0.66; edge = ""; }
        else if (e === 14) { ch = gu !== g ? "^" : h < 0.5 ? "|" : "#"; shade = 0.6; edge = ""; }
        const glyph = edge || ch;
        if (glyph) putInk(i, GI[glyph], edge ? scaleC(col, 0.6 + 0.9 * dark) : shade < 0 ? lift(-shade) : scaleC(col, shade + 0.75 * dark));
        // the wire view keeps the contours, and the few marks that say what a thing is
        wir[i] = edge ? GI[edge] : ((e === 6 && ch === "~") || e === 4 || e === 10 || e === 12 || e === 13 || e === 14 || e === 3 || (e === 9 && h < 0.1)) && ch ? GI[ch] : 0;
      }
    for (let i = 0; i < NC; i += 1) { // the same world without its walkers, for the opening
      const walker = own[i] === 3;
      wirW[i] = walker ? 0 : wir[i];
      ownW[i] = walker ? (lum[i] < 0 ? 2 : 1) : own[i];
    }
    return true;
  };

  // Save the environment, including its walkers. The two construction
  // buffers above retain the underlying beach before the walkers were drawn.
  // Pose, glasses, smile and hoodie never invalidate this plate.
  const environment = [gch,ink,glo,mat,own,wir].map(buffer=>({buffer,saved:buffer.slice()}));
  let environmentKey = "";
  let inWorld = false; // the backdrop on the grid is the 3D world
  const paintEnvironment = (s,L,t,lean,state) => {
    gch.fill(0);
    ink.fill(0);
    glo.fill(0);
    mat.fill(0);
    own.fill(0);
    wir.fill(0);
    const env = worldOf();
    inWorld = Boolean(env) && paintEnvironment3d(env, state, L);
    if (inWorld) return;
    paintSky(s, L, t, lean);
    paintClouds(s, L, t, lean);
    paintGulls(s, L, t, lean);
    paintCape(L, lean);
    paintSea(s, L, t, lean);
    paintSail(s, L, t, lean);
    paintSand(s, L, t, lean);
    paintGrass(s, L, t, lean);
    wirW.set(wir);
    ownW.set(own);
    paintWalkers(s, L, t, lean);
  };
  const paintWorld = (s,L,t,lean,P,state) => {
    const key=[t,s.hour,s.wind,s.tide,s.swell,s.walkers,lean,s.yaw,s.pitch,Boolean(worldOf())].join("|");
    if(key !== environmentKey) {
      paintEnvironment(s,L,t,lean,state);
      environment.forEach(({buffer,saved})=>saved.set(buffer));
      environmentKey=key;
    } else {
      environment.forEach(({buffer,saved})=>buffer.set(saved));
    }
    paintPerson(s, L, P);
    // a margin of dark screen around his head and shoulders, as an ASCII artist leaves it
    for (let r = 5; r < ROWS; r += 1) {
      for (let c = 0; c < COLS; c += 1) {
        const i = r * COLS + c;
        if (own[i] === 4 || own[i] === 3) continue;
        const nb = (c > 0 && own[i - 1] === 4) || (c < COLS - 1 && own[i + 1] === 4) || own[i - COLS] === 4 || (r < ROWS - 1 && own[i + COLS] === 4);
        if (nb) gch[i] = 0;
      }
    }
  };

  let lastState = normalize({});
  let fullColorState = "";
  const draw = (ctx, stateIn) => {
    const state = stateIn || {};
    const s = normalize(state);
    const view = ["seg", "depth", "normal", "wire"].includes(state.view) ? state.view : "rgb";
    const t = s.time;
    const lean = clamp(s.lean, -1, 1);
    const L = lighting(s.hour);
    const P = pose(s);
    lastState = s;
    const R = resources(deviceScale(ctx));
    // Opening frames and hover contours reuse the same printed world.
    // The diagnostic views recolour these buffers in place.
    const stateKey = Object.values(s).join("|");
    if (stateKey !== fullColorState) {
      paintWorld(s, L, t, lean, P, state);
      fullColorState = stateKey;
    }
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    if (view === "wire") {
      drawWire(ctx, R, state.parts || null, state.overlay === true);
      ctx.restore();
      return;
    }
    if (view !== "rgb") {
      const env = inWorld && view !== "seg" ? worldOf() : null;
      recolour(view, env && env.pixels(Object.assign({}, state, { view }), COLS, ROWS));
      fullColorState = "";
    }
    ctx.fillStyle = view === "rgb" ? `rgb(${L.term.map((v) => Math.round(v)).join(",")})` : "rgb(6,7,10)";
    ctx.fillRect(0, 0, W, H);
    renderGrid(ctx, R, view === "rgb" ? .25-.075*L.paper : .14);
    ctx.restore();
  };

  /* ---------- the buffer views: the same grid, every cell typed, in flat diagnostic colours ---------- */
  const recolour = (view, world) => {
    for (let i = 0; i < NC; i += 1) {
      const m = mat[i];
      const r = (i / COLS) | 0;
      const c = i - r * COLS;
      const y = r * CH + CH / 2;
      const sky = m === M.SKY || m === M.SUN || m === M.CLOUD || m === M.GULL;
      let col;
      if (world && own[i] !== 4) { // the 3D world's own buffer
        col = [world[i * 4], world[i * 4 + 1], world[i * 4 + 2]];
        if (view === "depth") col[0] = col[1] = col[2] = Math.max(8, col[0]);
      } else if (view === "seg") {
        col = sky ? [124, 166, 232] : m === M.SEA || m === M.FOAM ? [52, 112, 204] : m === M.ROCK ? [142, 128, 122] : m === M.SAND || m === M.WET ? [232, 198, 122] : [234, 86, 98];
      } else if (view === "depth") {
        let d;
        if (own[i] === 4) d = 238;
        else if (own[i] === 3) d = 128;
        else if (m === M.SEA || m === M.FOAM) d = mix(34, 118, clamp((y - HORIZON) / (SHORE - HORIZON), 0, 1));
        else if (m === M.ROCK && y < HORIZON) d = 28;
        else if (m === M.SAND || m === M.WET || m === M.ROCK) d = mix(118, 214, clamp((y - SHORE) / (H - SHORE), 0, 1));
        else d = 8;
        col = [d, d, d];
      } else if (own[i] === 4) {
        const head = y < 245 && c * CW < 290 + lastState.lean * -13;
        const u = clamp((c * CW + CW / 2 - (head ? 210 : 213)) / (head ? 62 : 180), -1, 1);
        const k = head ? Math.sign(u) * Math.pow(Math.abs(u), 1.4) : u * Math.abs(u);
        col = [128 + 70 * k, 140 - (head ? 12 * Math.abs(u) : 0), 226 + 29 * (1 - Math.abs(k))];
      } else if (own[i] === 3) col = [128, 140, 240];
      else col = sky ? [22, 24, 34] : [128, 246, 166];
      const k = i * 4;
      ink[k] = col[0];
      ink[k + 1] = col[1];
      ink[k + 2] = col[2];
      ink[k + 3] = 255;
      putGlow(i, scaleC(col, 0.25));
      if (!gch[i]) gch[i] = own[i] === 4 || own[i] === 3 ? GI[":"] : GI["."];
    }
  };

  /* ---------- the wire view: only the contour characters, typed in ---------- */
  const PART_IDS = { beach: 1, sea: 2, walkers: 3, person: 4 };
  // A selection is a second transparent pass over the existing print. Use
  // visible ownership, so marks stop at the silhouettes that cover the sea.
  const selectionInk = [null, "#ffe1a3", "#80ffec", "#ffd086", "#c4ffdb"];
  const shadowInk = "rgba(4,14,24,0.92)";

  function strokeSelection(ctx, path, color, core, halo) {
    ctx.strokeStyle = shadowInk;
    ctx.lineWidth = halo;
    ctx.stroke(path);
    ctx.strokeStyle = color;
    ctx.lineWidth = core;
    ctx.stroke(path);
  }

  function selectWalker(ctx, c0, c1, top, bottom) {
    const x0 = c0 * CW - 6, x1 = (c1 + 1) * CW + 6;
    const y0 = top * CH - 6, y1 = (bottom + 1) * CH + 6;
    const guard = new Path2D();
    // A marker may extend over sand or water, but never print over the portrait.
    for (let r = Math.max(0, top - 2); r <= Math.min(ROWS - 1, bottom + 2); r++) {
      let run = -1;
      const left = Math.max(0, c0 - 3), right = Math.min(COLS, c1 + 4);
      for (let c = left; c <= right; c++) {
        if (c < right && own[r * COLS + c] !== PART_IDS.person) {
          if (run < 0) run = c;
        } else if (run >= 0) {
          guard.rect(run * CW, r * CH, (c - run) * CW, CH);
          run = -1;
        }
      }
    }
    ctx.save();
    ctx.clip(guard);
    ctx.fillStyle = "rgba(14,26,37,0.28)";
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    const corners = new Path2D();
    for (const [cx, sx] of [[x0,1], [x1,-1]]) {
      for (const [cy, sy] of [[y0,1], [y1,-1]]) {
        corners.moveTo(cx + sx*6, cy);
        corners.lineTo(cx, cy);
        corners.lineTo(cx, cy + sy*6);
      }
    }
    strokeSelection(ctx, corners, selectionInk[3], 1.9, 4.4);
    ctx.restore();
  }
  /* The outline of one part, traced along the edges of the cells it owns on screen, so it stops
     at whatever covers it. The beach is mostly open sky and sand, so it also gets a sparse
     lattice of marks to read as an area. */
  function selectPart(ctx, R, p) {
    const mine = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS && (own[r * COLS + c] || 1) === p;
    const edges = new Path2D();
    for (let r = 1; r < ROWS; r++) {
      let run = -1;
      for (let c = 0; c <= COLS; c++) {
        if (c < COLS && mine(c, r) !== mine(c, r - 1)) {
          if (run < 0) run = c;
        } else if (run >= 0) {
          edges.moveTo(run * CW, r * CH);
          edges.lineTo(c * CW, r * CH);
          run = -1;
        }
      }
    }
    for (let c = 1; c < COLS; c++) {
      let run = -1;
      for (let r = 0; r <= ROWS; r++) {
        if (r < ROWS && mine(c, r) !== mine(c - 1, r)) {
          if (run < 0) run = r;
        } else if (run >= 0) {
          edges.moveTo(c * CW, run * CH);
          edges.lineTo(c * CW, r * CH);
          run = -1;
        }
      }
    }
    strokeSelection(ctx, edges, selectionInk[p], p === 4 ? 1.3 : 1.1, p === 4 ? 3.6 : 3.1);
    if (p !== 1) return;
    const marks = new Path2D();
    for (let r = 3; r < ROWS; r += 6)
      for (let c = 4 + ((r / 6) & 1) * 4; c < COLS; c += 8) {
        if (!mine(c, r) || !mine(c - 1, r) || !mine(c + 1, r) || !mine(c, r - 1) || !mine(c, r + 1)) continue;
        const x = (c + 0.5) * CW, y = (r + 0.5) * CH;
        marks.moveTo(x, y - 1.5);
        marks.lineTo(x + 1.5, y);
        marks.lineTo(x, y + 1.5);
        marks.lineTo(x - 1.5, y);
        marks.closePath();
      }
    strokeSelection(ctx, marks, selectionInk[p], 0.7, 2);
  }
  function drawSelection(ctx,R,weights) {
    ctx.save();
    ctx.lineJoin="round";
    ctx.lineCap="square";
    for(const p of [1,2,4]) if(weights[p]>0) selectPart(ctx,R,p);
    if(weights[3]>0) {
      for (const [c0, c1, top, bottom] of walkerBoxes) selectWalker(ctx, c0, c1, top, bottom);
    }
    ctx.restore();
  }

  const drawWire = (ctx, R, partsIn, overlay) => {
    const pv = [0, 1, 1, 1, 1];
    if (partsIn) for (const k of Object.keys(PART_IDS)) pv[PART_IDS[k]] = partsIn[k] === undefined ? 0 : clamp(+partsIn[k] || 0, 0, 1);
    if (overlay) {
      drawSelection(ctx,R,pv);
      return;
    }
    ctx.fillStyle = "rgb(5,8,9)";
    ctx.fillRect(0, 0, W, H);
    const { slotW, slotH, pad, atlas, X, Y, scale } = R;
    // count each part's contour cells, so that each is typed in reading order
    const totals = [0, 0, 0, 0, 0];
    for (let i = 0; i < NC; i += 1) if (wir[i]) totals[own[i] || 1] += 1;
    const seen = [0, 0, 0, 0, 0];
    const inv = 1 / scale;
    const cursor = [-1, -1, -1, -1, -1];
    const typed = (p) => {
      const v = pv[p];
      if (v <= 0) return false;
      seen[p] += 1;
      return !(v < 1 && seen[p] > v * totals[p]);
    };
    for (let i = 0; i < NC; i += 1) {
      let g = wir[i];
      let p = own[i] || 1;
      if (g && !typed(p)) {
        if (pv[p] > 0 && cursor[p] < 0) cursor[p] = i;
        g = 0;
      }
      if (!g && (p === 4 || p === 3) && pv[p] < 1 && seen[p] >= Math.floor(pv[p] * totals[p])) {
        // he (or a walker) is not here yet: the world behind shows through
        const gw = wirW[i];
        const pw = ownW[i] || 1;
        if (gw && pv[pw] >= 1) {
          g = gw;
          p = pw;
        }
      }
      if (!g) continue;
      const r = (i / COLS) | 0;
      const c = i - r * COLS;
      ctx.drawImage(atlas, g * slotW, slotH, slotW, slotH, (X[c] - pad) * inv, (Y[r] - pad) * inv, slotW * inv, slotH * inv);
    }
    for (let p = 1; p <= 4; p += 1) {
      if (cursor[p] < 0) continue;
      const i = cursor[p];
      const r = (i / COLS) | 0;
      const c = i - r * COLS;
      ctx.drawImage(atlas, GI["\u2588"] * slotW, slotH, slotW, slotH, (X[c] - pad) * inv, (Y[r] - pad) * inv, slotW * inv, slotH * inv);
    }
  };

  /* ---------- hit and pick ---------- */
  const personAt = (P, x, y) => Boolean(sample(P, Math.floor(x / CW), Math.floor(y / CH)));
  const hit = (x, y) => personAt(pose(lastState), x, y);
  const pick = (x, y, state) => {
    if (!(x >= 0 && x <= W && y >= 0 && y <= H)) return null;
    const s = normalize(state || {});
    const t = s.time;
    const lean = clamp(s.lean, -1, 1);
    if (personAt(pose(s), x, y)) return "person";
    const env = worldOf();
    if (env) return env.pick(x, y, state || {}) || "beach";
    const count = clamp(Math.round(s.walkers), 0, 5);
    for (let k = 0; k < count; k += 1) {
      const { x: wx, feet } = walkerAt(k, s, t, lean);
      if (Math.abs(x - wx) < 14 && y > feet - 36 && y < feet + 8) return "walkers";
    }
    const sail = sailAt(s, t, lean);
    const mark = SAIL[Math.floor(y / CH) - sail.row]?.[Math.floor(x / CW) - sail.col];
    if (mark && mark !== " ") return "sea";
    if (y >= HORIZON && y <= waterline(x + lean * 7, t, shoreBase(s))) return "sea";
    return "beach";
  };

  window.BeachScene = { style: "ascii", W, H, draw, hit, pick };
})();
