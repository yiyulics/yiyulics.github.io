/* An indexed character sheet for the two grid-based renderers. Paths are
 * sampled once at pixel centres. The terminal prints the same planes in ink.
 * All dimensions, including the joints, are in the 160-column sprite grid. */
(() => {
  "use strict";

  const width = 160, height = 134;
  const colors = {
    hairInk: "#202838", hairDark: "#303644", hair: "#42444f", hairLight: "#616273", hairRim: "#8b8290",
    skinDeep: "#ad655e", skinShade: "#d28a71", skin: "#edac87", skinLight: "#f7c59e", skinSun: "#ffdab1",
    cheek: "#e89e80", brow: "#4b3a3e", eye: "#342f38", iris: "#796258", white: "#f9e9cd",
    lip: "#935759", lipLight: "#e89a83", teeth: "#ffe8ce", frame: "#797275", lens: "#cfbfb1",
    hem: "#202c38", clothDark: "#334352", cloth: "#485c6b", clothLight: "#607685", seam: "#83938e",
    teeDark: "#b8bba8", tee: "#ede3c7", webDark: "#35464a", web: "#586560", webLight: "#79817a",
    brass: "#a58b66", brassLight: "#d0b794", fold: "#404f5e", bounce: "#566b79",
  };
  const names = Object.keys(colors);
  const id = Object.fromEntries(names.map((n, i) => [n, i + 1]));
  const rgb = [null, ...Object.values(colors).map(hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)))];
  const region = Uint8Array.from([0, ...names.map((_, i) =>
    i < 5 ? 1 : i < 11 ? 2 : i < 18 ? 3 : i < 20 ? 4 : i < 25 ? 5 : i < 27 ? 6 : i < 32 ? 7 : 5)]);
  const clothRamps = {
    navy: ["#1b2940", "#2e405d", "#445b78", "#637994", "#8a9ba9"],
    forest: ["#253630", "#374a42", "#506757", "#718775", "#9ba78a"],
    rust: ["#4c3637", "#784a43", "#a36751", "#be8267", "#d7ad86"],
    sand: ["#64594e", "#9c8973", "#b9a88a", "#d2c4a5", "#e4d5b2"],
  };
  const palettes = {charcoal: rgb};
  for (const [name, ramp] of Object.entries(clothRamps)) {
    const p = rgb.slice();
    ramp.forEach((hex, i) => { p[id.hem + i] = [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16)); });
    p[id.fold] = p[id.cloth].map((channel, i) => Math.round(.55*channel + .45*p[id.clothDark][i]));
    p[id.bounce] = p[id.cloth].map((channel, i) => Math.round(.52*channel + .48*p[id.clothLight][i]));
    palettes[name] = p;
  }

  const cv = document.createElement("canvas");
  const pen = cv.getContext("2d");
  // These paths use absolute M, L, Q and C commands. Their control points bound the curve.
  function sheet(shapes) {
    const data = new Uint8Array(width * height);
    for (const [tone, d] of shapes) {
      const points = d.match(/-?[\d.]+/g).map(Number);
      const xs = points.filter((_, i) => i % 2 === 0);
      const ys = points.filter((_, i) => i % 2 === 1);
      const path = new Path2D(d);
      const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(width, Math.ceil(Math.max(...xs)));
      const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(height, Math.ceil(Math.max(...ys)));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (pen.isPointInPath(path, x + .5, y + .5)) data[y * width + x] = id[tone];
        }
      }
    }
    return data;
  }

  const neckline = sheet([
    ["skinShade", "M59 66 L79 64 Q78 76 84 82 L78 96 L64 99 L53 84 Q61 80 59 66 Z"],
    ["skinLight", "M59 68 L77 69 L76 76 Q69 82 61 80 Q62 75 59 68 Z"],
    ["skin", "M62 79 Q71 79 78 74 L82 82 L72 91 L64 88 Z"],
    ["teeDark", "M52 82 Q68 91 83 79 L87 87 L69 107 L53 94 Z"],
    ["tee", "M54 85 Q69 95 83 82 L81 88 L68 103 L60 96 Z"],
    // Hood opening turns back on itself, framing the neck.
    ["hem", "M62 78 Q54 76 47 83 L42 90 Q42 95 51 100 L67 107 L70 105 Q59 91 62 78 Z M78 77 Q91 76 96 88 L99 93 Q88 95 69 108 L65 107 Q77 89 78 77 Z"],
    ["clothDark", "M60 79 Q50 79 45 88 L44 91 Q52 94 65 102 Q57 88 60 79 Z M80 78 Q90 80 94 89 Q83 93 71 102 Q79 89 80 78 Z"],
    ["clothLight", "M58 80 Q49 82 46 88 Q52 83 56 83 L54 86 Z M83 79 Q91 81 94 88 L89 85 Z"],
    ["seam", "M44 91 Q49 95 59 98 L65 103 Q51 97 44 93 Z M75 100 Q84 94 95 90 L92 92 Z"],
    ["hem", "M67 106 L69 106 L66 137 L64.5 137 Z M53 92 L54.7 92 Q55 101 52 111 L51 111 Z M83 91 L84.4 90 Q83 99 81 105 L80 105 Z"],
    ["seam", "M68.7 106 L69.4 105.4 L67 134 L66.2 135 Z M52 111 L53 111 L52.7 113.4 L51.4 113.4 Z M80 105 L81.5 105 L80.9 107.4 L79.8 107.4 Z"],
    ["clothLight", "M52.7 94 L53.4 94 Q53.6 102 51.5 109 L51 109 Z M83.3 93 L83.9 92.5 L81.6 103 L80.8 103 Z"],
    ["brass", "M66 106 L69 105 L69 109 L67.7 111 L66 110 Z"],
  ]);
  const head = sheet([
    // Ears, jaw, cheek planes. The centre of the nose, lip bow and chin share an axis.
    ["skinDeep", "M49 50 Q44 46 44.5 54.5 Q46 62 51.5 62.5 L53 58 Z M86 49 Q94 46 91.3 56 Q90 61 85 62 Z"],
    ["skin", "M49 51 Q45 48.5 46 54 Q47 59 50 60 Z M86 52 Q91 48 90 53 Q89 57 86 59 Z"],
    ["skinDeep", "M48 54 Q47 50.8 46.5 52 Q48.5 51 50 55 L49 58 Z M87 54 Q88 50.5 90 52 L88 53 L87.4 57 Z"],
    ["skinShade", "M48 39 Q48 30 64 29 Q83 29 87.6 41 L86.6 54.5 Q86 63 81 69.3 L74 76 Q70 78.6 65 76.6 L58 72.6 Q52.6 69.5 50.5 63 L48 57 Z"],
    ["skinLight", "M49 40 Q51 30 64 31 Q82 30 85.5 42 Q83 52 84.7 57 Q84 65 78 70.8 L72.5 75 Q67.5 77.6 62.5 73.4 L55.6 68.6 Q51 64 50.6 58.5 Z"],
    ["skin", "M47.5 40 L61 35 L81 36 L86 41 L84 48 L81 49.4 L78.5 47 L76 47.5 Q75 43 70 43 Q64 46 56 46 L51.5 53.6 L50 58 Z M53.5 58 Q56.5 54 62.8 55.1 L60.5 57.2 L56.2 58.5 Z M77 54 Q81.6 53.4 84.6 51.8 L84 57.8 Q81.3 56 77 56 Z"],
    ["cheek", "M80 58 Q83 57 85 57 L83 61 Q82 59 80 60 Z M53 59 Q55 57.7 59 59 L56 60.2 Z"],
    ["skin", "M82 50 Q85 51 85 58 Q83 65 78 70 L72 74 L68 75.7 Q76 74 80.8 67.5 L78.5 68 Q82.8 64.3 83.2 59 L80.5 57.5 Z M55 63 Q56.5 67 60 69 L59.4 70.4 Q55.7 68 54 64 Z"],
    ["skinSun", "M53 57.1 Q56.4 55.6 61 56.8 L59.5 58 L54.4 58.9 Z M74 56.9 L79 55.6 L81.8 56.8 L77 57.8 Z"],
    ["skinSun", "M52 48 L59 45 L64 45 L61 46.2 L55 48 Z M70 53 L71.6 57.5 L71 60.5 L69.6 60.5 Z M63 71.5 Q68 73.3 73.6 71 L71.4 73.3 Q66.5 74.3 63 72.6 Z"],
    // A side part with separate windswept locks and reflected light at the temple.
    ["hairInk", "M47 55 Q44 50 44 44 L41.8 46 Q43 41 45 38 Q40.4 39.8 38.8 39.5 Q44 36 46 29 L42.5 31 Q45 25 52 22 Q48 22 46 23 Q51 19 59 19 Q64 14.5 73 18 Q85 17 89 27 L92 26 Q90.2 31 90 32 Q94 36 89.2 46 L90 48 Q87.2 48 86.4 54 L84.7 57 L83.4 47 Q82 43 80 40.8 Q77 38 75.7 34.5 Q73 39 67 40.4 L68.8 37.4 Q62.1 43 54.3 44.7 L57 42.1 Q51.2 43 50.4 49 L49.4 55 Z"],
    ["hairDark", "M43 38 Q48 31 50 26 Q58 18 67.2 19 Q74 16.5 80 21.5 Q86 21 89 28 L86.5 29 Q91 34.5 89 40 L86.4 46 Q84.5 40.6 80.2 37.4 L76.5 29.6 Q72 36.8 64 39 Q61 41 54 42 Q58 39.2 59.7 35.9 Q54 40.5 48 41.5 L47.4 48 Z"],
    ["hair", "M45 35 Q50 25 61.5 21 Q66 19.5 70.2 20.8 Q59.6 22 56.5 27 Q51.8 32.7 45 35 Z M52.2 38 Q65 31.3 68 25.1 L73 21.5 Q73.2 29.7 63.2 35.3 Q57 38.7 52.2 38 Z M76 23 Q86.2 22 89.5 33.7 Q85 27 78 26.3 Z"],
    ["hairLight", "M47.7 31.5 Q56.5 21.3 65.2 21 Q56.8 23.7 52.4 28.5 Z M59 32 Q65.5 27.7 67.2 24.6 L71.4 22 Q70.1 26.8 59 32 Z M78 23.4 Q84.3 23.6 87.2 27.8 Q83.2 24.8 78 24.3 Z"],
    ["hairRim", "M51 26.8 Q55.2 22.5 61 21.6 L56.2 23.7 Z"],
    // Small tapered brows define a relaxed, open expression.
    ["brow", "M53.6 48.2 Q56 45.1 61.2 45.6 L64.8 47.1 L63.5 48 Q58.2 46.3 53.6 48.2 Z M73.2 47.4 Q77.5 44.8 82.2 46.5 L83 48.1 Q78.1 46.4 74 48.4 Z"],
    ["skinShade", "M68.7 53 Q68 57 67.4 59.7 L68.1 60.4 Q69.2 57.8 69.2 54 Z M66.6 61.4 Q68.4 62.5 70.4 62 L72.4 60.7 L72.2 62.6 Q69.3 64.6 66.6 62.6 Z"],
    ["skinDeep", "M66.4 61.4 L68.1 61.6 L68.7 62.5 L67.1 62.4 Z M70.6 62 L72.4 61.4 L72.7 62.3 L71 63 Z"],
  ]);

  const eyeSheet = closed => sheet(closed ? [
    ["brow", "M54.5 53 Q59 55 63.8 52 L63 53.8 Q59 56.4 54.5 54 Z M73.5 52.8 Q77.7 54.8 82.2 52.2 L81.5 54 Q77 55.8 73.5 53.8 Z"],
  ] : [
    ["white", "M54.6 53 Q58.4 49.8 63.8 52.8 Q60 56.9 54.6 53.6 Z M73.3 52.8 Q77.6 49.4 82.2 52.3 Q78.8 56.3 73.3 53.2 Z"],
    ["iris", "M57.7 51.8 Q60.1 50.6 61.3 52 L61 54 Q58.3 55.4 57.5 53.6 Z M76 51.3 Q78.3 50.2 79.8 51.6 L79.5 53.7 Q76.7 54.8 76 53.1 Z"],
    ["eye", "M58.7 51.5 L60.8 51.5 L60.6 53.9 L58.6 54 Z M77.1 51.2 L79 51.1 L79 53.6 L77.1 53.7 Z"],
    ["brow", "M54 53.2 Q58.5 48.9 64 52.2 L64.4 53.5 Q58.6 50.9 54 53.9 Z M73 52.7 Q77.3 48.5 82.5 51.8 L82.7 52.8 Q77.8 50.9 73 53.6 Z"],
  ]);
  const eyes = [eyeSheet(false), eyeSheet(true)];
  const glasses = sheet([
    ["frame", "M48.4 49 L53 50 L54 51.4 L48.8 50.2 Z M51.7 49.7 Q57 48.8 64 49.5 L65.9 50.5 L65.6 54.2 Q64.8 58.5 59.6 58.6 Q53.1 58.7 52.3 54.3 Z M53.4 50.6 L53.7 53.9 Q54.3 57.5 59.5 57.6 Q63.8 57.4 64.6 53.8 L64.8 50.9 Q58.5 50 53.4 50.6 Z M65.3 51.5 Q68.3 49.8 71.3 51.1 L71.4 52.2 Q68.4 51.1 65.4 52.6 Z M70.7 50.3 Q76 48.4 84.2 49.2 L84.2 53 Q83.8 57.4 78.5 58 Q72.5 58.7 71.2 54.2 Z M72.1 51.2 L72.4 54 Q73.4 57.5 78.2 57 Q82.8 56.5 83.1 53 L83.2 50.3 Q77.8 49.8 72.1 51.2 Z M84 49.6 L87.5 48.2 L87.5 49.2 L84 51 Z"],
    ["lens", "M53.1 53.3 L53.9 54.2 L55.6 56.8 L54 56 Z M79.5 56.6 L82 55.3 L82.8 54.2 L82.2 56.4 Z"],
  ]);
  // A smile is only a few pixels high. Paired corners and a continuous
  // tooth line keep it readable in both pixels and character cells.
  const smileRows = [
    ["...........", "..s.....s..", "...smmms..."],
    ["...........", ".s.......s.", "..smmmmms.."],
    ["...........", ".m.......m.", "..mtttttm..", "...smmms..."],
    ["...........", "m.........m", ".mtttttttm.", "..smLLLms..", "....sss...."],
  ];
  const mouths = smileRows.map(rows => {
    const data = new Uint8Array(width * height);
    const tones = {m: id.lip, t: id.teeth, L: id.lipLight, s: id.skinShade};
    rows.forEach((row, y) => [...row].forEach((char, x) => {
      if (tones[char]) data[(64 + y) * width + 63 + x] = tones[char];
    }));
    return data;
  });

  const clamp01 = x => Math.max(0, Math.min(1, x));
  const smooth = x => { const t = clamp01(x); return t * t * (3 - 2 * t); };
  const mix = (a, b, t) => a + (b - a) * t;
  const buffer = new Uint8Array(width * height);
  const jacket = new Uint8Array(width * height);
  const handInk = new Uint8Array(width * height);

  // Fill a curved silhouette directly on the indexed grid. The vertices are
  // shared by the colour, glyph, selection and construction renders.
  const scanRows = Array.from({length: height}, () => []);
  let clipToCloth = false;
  function fill(target, tone, start, ...segments) {
    let x = start[0], y = start[1], top = height, bottom = -1;
    const edge = (ex, ey) => {
      const first = Math.max(0, Math.ceil(Math.min(y, ey) - .5));
      const last = Math.min(height - 1, Math.ceil(Math.max(y, ey) - .5) - 1);
      for (let row = first; row <= last; row++) {
        scanRows[row].push([x + (ex - x) * (row + .5 - y) / (ey - y), ey > y ? 1 : -1]);
      }
      if (first <= last) { top = Math.min(top, first); bottom = Math.max(bottom, last); }
      x = ex; y = ey;
    };
    for (const points of segments) {
      if (points.length === 2) { edge(points[0], points[1]); continue; }
      const ax = x, ay = y, cubic = points.length === 6;
      for (let j = 1; j <= 8; j++) {
        const t = j / 8, v = 1 - t;
        if (cubic) {
          edge(v*v*v*ax + 3*v*v*t*points[0] + 3*v*t*t*points[2] + t*t*t*points[4],
               v*v*v*ay + 3*v*v*t*points[1] + 3*v*t*t*points[3] + t*t*t*points[5]);
        } else {
          edge(v*v*ax + 2*v*t*points[0] + t*t*points[2], v*v*ay + 2*v*t*points[1] + t*t*points[3]);
        }
      }
    }
    edge(start[0], start[1]);
    for (let row = top; row <= bottom; row++) {
      // Nonzero winding keeps the folded sleeve solid where it overlaps
      // the ribcage. Even/odd pairing would cut a slit through the jacket.
      const cuts = scanRows[row].sort((a, b) => a[0] - b[0]);
      let winding = 0, left = 0;
      for (const [at, direction] of cuts) {
        const col = Math.ceil(at - .5);
        if (winding === 0) left = Math.max(0,col);
        winding += direction;
        if (winding !== 0) continue;
        const right = Math.min(width,col);
        if (right <= left) continue;
        const end = row * width + right;
        if (clipToCloth) {
          for (let i = row * width + left; i < end; i++) if (target[i]) target[i] = id[tone];
        } else target.fill(id[tone], row * width + left, end);
      }
      cuts.length = 0;
    }
  }

  // Coordinates along a bone, with a signed offset across its centreline.
  function section(a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const length = Math.hypot(dx, dy) || 1;
    return (t, offset) => [a[0] + t * dx + offset * dy / length, a[1] + t * dy - offset * dx / length];
  }
  const q = (control, end) => [...control, ...end];
  const c = (first, second, end) => [...first, ...second, ...end];

  // Draw one side of the coat from the nape, across the acromion, around
  // the elbow and back through the axilla to the hem. There is no cut line
  // at the deltoid. Change of value follows the tension along the sleeve.
  function coatSide(side, lift, upper) {
    const at = (x, y) => [69 + side * (x - 69), y];
    const arm = (t, inset) => at(...upper(t, inset));
    const shape = (tone, start, ...segments) => fill(jacket, tone, start, ...segments);
    shape("cloth", at(68, 80), at(80, 79),
      c(at(83, 80.3 - lift), at(88.5, 83.7 - 1.7*lift), at(97.5, 86.1 - 2.4*lift)),
      c(at(104.6, 87.7 - 2.6*lift), arm(.10, 10.1), arm(.29, 10.7)),
      q(arm(.67, 10.6), arm(.99, 8.9)), q(arm(1.13, .5), arm(1.015, -7.9)),
      q(arm(.70, -8.9), arm(.44, -9.3)),
      q(at(105.8 - 1.2*lift, 106.5 - 1.6*lift), at(107.2 - 1.4*lift, 113.7 - lift)),
      q(at(106.8, 128.5), at(105.5, 144)), at(68, 144));
    clipToCloth = true;
    // A lit roll of fabric continues into the top of the arm. The opposite
    // edge stays in half-tone, so neither shoulder looks like an epaulette.
    shape(side < 0 ? "clothLight" : "bounce", at(83, 81.7 - lift),
      q(at(90, 85 - 2*lift), at(99, 87.4 - 2.4*lift)),
      q(arm(.09, 9.3), arm(.39, 9.2)), q(arm(.28, 5.1), arm(.16, 4.6)),
      q(at(101, 91.2 - 2*lift), at(96.8, 89.6 - 2*lift)),
      q(at(89.3, 86.4 - 1.5*lift), at(83, 81.7 - lift)));
    shape("clothDark", at(98.5, 112 - lift), q(arm(.43, -6.8), arm(.69, -6.5)),
      q(arm(.91, -5), arm(1.02, -6.5)), arm(1.02, -8), arm(.44, -9.3),
      q(at(101.4, 108 - lift), at(101.6, 115)), at(103.9, 140), at(99.4, 140),
      q(at(103.3, 125), at(98.5, 112 - lift)));
    // Compression on the inside of the arm radiates out of the underarm.
    shape("clothDark", at(100, 105 - 2*lift), q(at(95.5, 107), at(87.7, 112.2 + lift)),
      q(at(94, 109.6), at(96, 109.5)), at(89.8, 115), q(at(98.3, 110), at(100, 105 - 2*lift)));
    shape("fold", at(101, 97 - lift), q(arm(.30, .5), arm(.43, -.7)),
      q(arm(.56,-.4), arm(.69,1.6)), q(arm(.56,.8),arm(.42,1.4)),
      q(arm(.26,1.6),at(101,97 - lift)));
    if (lift > .12) {
      shape("bounce", arm(.19, 7), q(arm(.38, 4.1), arm(.57, 4.6)),
        q(arm(.43, 4.8), arm(.31, 6.3)));
    }
    clipToCloth = false;
  }

  // The top of each strap emerges from behind the hood. Its width turns
  // from almost edge-on over the shoulder to full width on the ribcage.
  function packStrap(side, lift) {
    const left = [], right = [], contact = [], bevel = [];
    for (let i = 0; i <= 18; i++) {
      const t = i / 18, u = 1 - t;
      const x = u*u*u * 88 + 3*u*u*t * 104.7 + 3*u*t*t * 99.4 + t*t*t * 95.6 + .8*lift*u*u;
      const y = u*u*u * 82 + 3*u*u*t * 84.8 + 3*u*t*t * 111.2 + t*t*t * 139 - 2.8*lift*u*u;
      const dx = 3*u*u*16.7 - 6*u*t*5.3 - 3*t*t*3.8 - 1.6*lift*u;
      const dy = 3*u*u*2.8 + 6*u*t*26.4 + 3*t*t*27.8 + 5.6*lift*u;
      const length = Math.hypot(dx, dy);
      const halfWidth = 1.3 + 1.9 * smooth(t * 3) - .4 * t;
      const p = offset => [69 + side * (x - 69 + dy / length * offset), y - dx / length * offset];
      left.push(p(-halfWidth));
      right.push(p(halfWidth));
      bevel.push(p(-halfWidth + .65));
      contact.push(p(halfWidth + .70 * Math.sin(t * Math.PI)));
    }
    const ribbon = (tone, a, b) => fill(jacket, tone, a[0], ...a.slice(1), ...b.slice().reverse());
    ribbon("clothDark", right, contact);
    ribbon("web", left, right);
    ribbon(side < 0 ? "webLight" : "webDark", left, bevel);
    // The low-profile keeper lies in the strap's plane, below the chest.
    const a = 12, b = 13;
    fill(jacket, "webDark", left[a], right[a], right[b], left[b]);
    const inner = (p, v) => [mix(p[a][0], p[b][0], v), mix(p[a][1], p[b][1], v)];
    fill(jacket, "brass", inner(left,.17), inner(right,.17), inner(right,.34), inner(left,.34));
    fill(jacket, "web", inner(left,.5), inner(right,.5), inner(right,.83), inner(left,.83));
  }

  function lowerSleeve(fore, lift) {
    const f = (tone, start, ...segments) => fill(jacket, tone, start, ...segments);
    f("cloth", fore(-.04,-8.6), c(fore(-.17,-7.8), fore(-.17,6.4), fore(-.02,8.5)),
      q(fore(.31,9.1), fore(.72,6.6)), fore(.99,5.1), fore(1,-5.4),
      q(fore(.58,-7), fore(.35,-8.3)), q(fore(.12,-9.6), fore(-.04,-8.6)));
    f("clothDark", fore(-.07,-6.4), q(fore(.20,-7.6), fore(.41,-5.3)),
      fore(.66,-5.2), fore(.93,-4.4), fore(.93,-5.5), fore(.46,-7.6),
      q(fore(.1,-9.9), fore(-.07,-6.4)));
    f("clothLight", fore(.17,6.9), q(fore(.35,4.5), fore(.49,5.4)),
      fore(.83,3.9), q(fore(.64,6.1), fore(.48,6.5)), fore(.33,7.1));
    f("bounce", fore(.24,3.9), q(fore(.44,1.4), fore(.61,2.6)), fore(.72,2.0),
      q(fore(.54,1.0),fore(.46,.5)), q(fore(.35,1.3),fore(.24,3.9)));
    // A soft, broken fold sits inside the bent elbow, away from the shoulder.
    if (lift > .15) f("clothDark", fore(.06,-6.9), q(fore(.15,-3.4), fore(.19,2.2)),
      q(fore(.18,-1.3), fore(.21,-2.6)), fore(.32,-1.2), fore(.21,-4.1));
  }

  function cuff(fore) {
    fill(buffer, "clothDark", fore(.87,-6), q(fore(.9,0),fore(.87,6.1)),
      fore(1.02,5.3), q(fore(1.055,.4),fore(1.02,-5.1)));
    fill(buffer, "clothLight", fore(.87,1.9), fore(.87,5.7), fore(1.01,4.9), fore(.99,3.6));
    for (const d of [-3.4,-.8,1.9]) {
      fill(buffer,"hem",fore(.90,d),fore(.90,d+.65),fore(.995,d+.45),fore(.995,d));
    }
  }

  // Hand coordinates: across the left palm toward the little finger, from
  // wrist to knuckles, and out through the pads. The thumb is on the radial
  // (negative x) edge. The forearm turns the entire frame toward the camera.
  const digits = [
    // root x, knuckle height, depth, phalange lengths, radius, abduction, natural flexion
    [-4.8,14.4, .25, [6.4,4.2,3.8], 1.67,-.125,.18],
    [-1.6,15.1, .45, [7.1,4.9,4.0], 1.74,-.035,.15],
    [ 1.7,14.6, .18, [6.6,4.4,3.7], 1.62, .060,.32],
    [ 4.7,12.6,-.70, [4.9,3.55,3.0],1.43, .22,.49],
  ];

  function leftHand(wrist, lift, rock, pitch, foreX) {
    handInk.fill(0);
    const open = smooth((lift - .19) / .73);
    const twist = 1.42 * (1 - open) + .20 * open + .13 * rock * open;
    const a = pitch + .39 * Math.sin(lift * Math.PI);
    const span = Math.sqrt(1 - foreX * foreX);
    const cp = Math.cos(a), sp = Math.sin(a), ct = Math.cos(twist), st = Math.sin(twist);
    const roll = -.02 + open * (.11 + .17 * rock);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    function project(u, v, z = 0) {
      const breadth = ct*u - st*z, normal = st*u + ct*z;
      const across = span*breadth + foreX*v;
      const along = cp*(span*v - foreX*breadth) + sp*normal;
      const depth = sp*(span*v - foreX*breadth) - cp*normal;
      const scale = 1.065 / (1 - depth * .0024);
      return [wrist[0] + (cr*across - sr*along)*scale, wrist[1] + (sr*across + cr*along)*scale];
    }
    function finger(joints, radius, thumb = false) {
      // Round the changes of direction at PIP and DIP, retaining the
      // straight proximal and middle phalanges between the knuckles.
      const pts = [project(...joints[0])];
      for (let j = 1; j < joints.length - 1; j++) {
        const joint = joints[j], before = joints[j-1], after = joints[j+1];
        pts.push(project(...joint.map((v,k) => mix(v,before[k],.20))),
          project(...joint), project(...joint.map((v,k) => mix(v,after[k],.20))));
      }
      pts.push(project(...joints[joints.length-1]));
      const last = pts.length - 1, left = [], right = [], shade = [];
      for (let k = 0; k <= last; k++) {
        const before = pts[Math.max(0,k-1)], after = pts[Math.min(last,k+1)];
        const dx = after[0]-before[0], dy = after[1]-before[1], len = Math.hypot(dx,dy) || 1;
        const t = k / last, knuckle = k % 3 === 2 ? .035 : 0;
        const r = radius * (1 - .26*t + knuckle) * 1.065;
        const nx = -dy / len, ny = dx / len;
        const offset = d => [pts[k][0] + nx*d, pts[k][1] + ny*d];
        left.push(offset(-r)); right.push(offset(r)); shade.push(offset(r*.54));
      }
      const tip = pts[last], prev = pts[last-1], len = Math.hypot(tip[0]-prev[0],tip[1]-prev[1]) || 1;
      const cap = [tip[0]+(tip[0]-prev[0])/len*radius*1.25, tip[1]+(tip[1]-prev[1])/len*radius*1.25];
      fill(handInk, "skin", left[0], ...left.slice(1), q(cap,right[last]), ...right.slice(0,-1).reverse());
      fill(handInk, "skinShade", shade[1], ...shade.slice(2), right[last], ...right.slice(1,-1).reverse());
      if (open > .35) {
        fill(handInk, "skinLight", left[last-2], left[last], q(cap,pts[last]),
          q(pts[last-1],left[last-2]));
        const crease = thumb ? 2 : 5;
        fill(handInk,"cheek",left[crease],shade[crease],pts[Math.min(crease+1,last)]);
      }
    }
    // Flexion accumulates through the two interphalangeal joints. Adjacent
    // fingers keep their own knuckle height, length and resting curl.
    for (let i = digits.length - 1; i >= 0; i--) {
      const [x,y,z,lengths,r,spread,relaxed] = digits[i];
      const joints = [[x,y,z]];
      const flex = (1-open) * (.64 + .12*i) + relaxed + .055*rock*(i-1.5);
      for (let k = 0; k < lengths.length; k++) {
        const bend = flex * [.42,1.15,1.76][k];
        const fan = spread*(.60 + .40*open) - .025*k*(i-1);
        const projected = lengths[k]*Math.cos(bend), prev = joints[k];
        joints.push([prev[0]+Math.sin(fan)*projected, prev[1]+Math.cos(fan)*projected, prev[2]+Math.sin(bend)*lengths[k]]);
      }
      finger(joints,r);
    }
    const P = project;
    // Arched metacarpals, the hypothenar edge and the narrower wrist.
    fill(handInk, "skin", P(-4,-1),
      q(P(-3.9,3.3,1),P(-5.7,5.1,1.2)),
      q(P(-7.4,7.5,1.5),P(-6.5,11.5,.7)),
      q(P(-6.3,13.8,.5),P(-5.6,14.6,.3)),
      q(P(-2,15.9,.6),P(.3,15.3,.45)),
      q(P(2.6,15.3,.25),P(5.45,13.0,-.5)),
      q(P(7.5,9.1,-.95),P(5.5,5.8,-.05)),
      q(P(3.8,2.5,.4),P(3.8,-1)),P(-4,-1));
    fill(handInk, "skinLight", P(-5.2,14.3,.3),q(P(-.8,16.1,.6),P(4.5,13.4,-.3)),
      q(P(3.0,11.8,.6),P(1.3,12.0,.8)),q(P(-1,13.5,.9),P(-3.2,12.7,1.0)),P(-5.2,14.3,.3));
    fill(handInk, "cheek", P(3.2,11.5,.7),q(P(5.9,12.7,-.1),P(6.25,10.0,-.3)),
      q(P(6.3,6.5,.4),P(3.2,4.8,1)),q(P(2.7,7.3,1.4),P(3.2,11.5,.7)));
    fill(handInk, "skinShade", P(5.9,12,-.6), q(P(6.0,8,.4),P(3.2,4.2,.8)),
      q(P(2.2,2,.8),P(3.5,-.75)),P(4,-1),q(P(4.1,3.2),P(6.25,6.4)),q(P(7.1,9.3),P(5.9,12,-.6)));
    const splay = mix(.47,.87,open), bend = 1 - open;
    const thumb = [[-3.6,4.3,1.0],[-5.8-1.6*splay,7.5,2.6],
      [-6.5-3.8*splay,10.3,3.5+1.5*bend],[-6.8-5.9*splay,13.4,3.5+3.4*bend]];
    finger(thumb,1.95,true);
    // A little light across the thumb mound and the heel describes depth
    // without a ring around the thumb or a row of knuckle outlines.
    fill(handInk, "skinLight", P(-5.8,9.6,1.4),q(P(-6.7,7.5,2),P(-4.1,4.6,1.4)),
      q(P(-2.9,2.9,1.2),P(-1.1,3.1,1)),q(P(-1.8,6.9,1),P(-5.8,9.6,1.4)));
    fill(handInk, "skinShade", P(-5,10.5,1.5),q(P(-1.0,9.1,1.1),P(-.6,5.2,.7)),
      q(P(-1.5,8.7,.9),P(-4.9,9.7,1.4)));
    fill(handInk, "skinShade", P(-2.8,12.3,.8),q(P(.5,11.3,.5),P(4.5,12.3,.2)),
      q(P(1,10.6,.7),P(-2.8,12.3,.8)));
  }

  const stillUpper = section([103,94],[114,151]);
  const relaxed = new Uint8Array(width * height);
  // The ribcage continues behind both front straps to the lower crop.
  // The axillary opening is outside this panel, between chest and sleeve.
  fill(jacket,"cloth",[46,96],q([37,99],[34.4,111]),q([33.2,126],[34,144]),
    [104,144],q([104.8,126],[103.6,111]),q([101,99],[92,96]));
  coatSide(-1,0,stillUpper);
  relaxed.set(jacket);

  let jacketPose = NaN;
  function clothFrame(lift, upper, fore) {
    // Wrist oscillation changes the lower sleeve as well. A completely
    // relaxed portrait reuses its jacket texture between blinks.
    if (lift === 0 && jacketPose === 0) return;
    jacketPose = lift;
    jacket.set(relaxed);
    coatSide(1,lift,upper);
    clipToCloth = true;
    // Broad half-tones connect the front, side of the ribcage and lower
    // shoulder. The narrow edge of the strap stays taut across these folds.
    fill(jacket,"fold",[95,91-2*lift],q([94,101],[94,108]), q([90,118+lift],[86,132]),[87,140],[102,141],
      q([101,122],[100,117-lift]),q([104,105-lift],[106,100-1.3*lift]),q([104,94-2*lift],[95,91-2*lift]));
    fill(jacket,"bounce",[41,91],q([48,95],[54,104]),q([47,100],[44,99]),
      q([43,111],[46,117]),q([39,113],[37,105]),q([36.5,96],[41,91]));
    // Quiet planes stretch from the armpit into the ribcage.
    fill(jacket,"clothDark",[31,113],q([37,120],[49,125]),q([41,122],[38,122.7]),[42,129],q([35.4,122],[31,122]));
    fill(jacket,"clothDark",[99,108-2*lift],q([95,111-lift],[84,118+lift]),q([92.4,115.4],[97.4,112]));
    fill(jacket,"clothLight",[46,129],q([53,126.9],[61.2,129]),[55.4,130],[49,130.2]);
    // A bound welt follows the angle of the raised side of the jacket.
    fill(jacket,"clothDark",[77,119],[93,114-lift],[93.5,115.8-lift],[77.6,121.2]);
    fill(jacket,"clothLight",[77,118.7],[92.8,113.6-lift],[93.3,114.4-lift],[77.4,120]);
    packStrap(-1,0); packStrap(1,lift);
    clipToCloth = false;
    lowerSleeve(fore,lift);
    // Ink only the exterior of the sewn garment. The arm root has no interior silhouette.
    for (let y = 75; y < height; y++) {
      for (let x = 1; x < width-1; x++) {
        const i = y*width+x, value = jacket[i];
        if (!value || region[value] !== 5) continue;
        if (!jacket[i+1] || (y+1 < height && !jacket[i+width])) jacket[i] = id.clothDark;
        else if (!jacket[i-width] && x < 69) jacket[i] = id.clothLight;
      }
    }
  }

  let cachedKey = "";
  function frame(s) {
    const t = +s.time || 0, w = s.hello == null ? -1 : s.hello;
    const phase = Math.min(clamp01(w / .68), clamp01((2.6-w) / .63));
    const lift = smooth(phase);
    const rock = Math.sin((w-.62)*7.3)*smooth((w-.51)/.28)*smooth((2.12-w)/.27);
    const shut = ((t+.8) % 5.35) > 5.19 ? 1 : 0;
    const mouth = Math.max(0,Math.min(3,Math.round((s.smile ?? .8)*3.4)));
    const specs = s.glasses !== false && s.glasses !== "false" && s.glasses !== "False";
    const key = [lift,rock,shut,mouth,specs].join(",");
    if (key === cachedKey) return buffer;
    cachedKey = key;

    // Elbow flexion brings the hand up towards the camera before the upper
    // arm opens to the side. Small clavicular movement carries the cloth,
    // neckline and pack together. Length lost in projection goes into depth.
    const raise = lift;
    const shoulder = [103+.8*raise,94-2.7*raise];
    const elbow = [114+16.7*raise,151-34.4*raise];
    const elbowFlex = phase + .095*Math.sin(Math.PI*phase);
    const foreX = .09*(1-lift) - .32*Math.sin(Math.PI*phase) - .065*lift + .095*rock;
    const foreY = Math.cos(Math.PI*elbowFlex) * (.98 - .05*lift);
    const foreZ = Math.sqrt(Math.max(0, 1 - foreX*foreX - foreY*foreY));
    const wrist = [elbow[0]+50*foreX,elbow[1]+50*foreY];
    const upper = section(shoulder,elbow), fore = section(elbow,wrist);
    clothFrame(raise,upper,fore);
    buffer.set(jacket);
    const gaze = eyes[shut], lips = mouths[mouth];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y*width+x;
        const face = (specs && glasses[i]) || lips[i] || gaze[i] || head[i];
        if (face) { buffer[i] = face; continue; }
        const pull = raise * clamp01((x-67)/28) * clamp01((135-y)/49);
        const ny = Math.round(y + 2.5*pull), nx = Math.round(x - .8*pull);
        if (ny < height && neckline[ny*width+nx]) buffer[i] = neckline[ny*width+nx];
      }
    }
    if (wrist[1] - 37 < height) {
      leftHand(wrist,lift,rock,Math.atan2(foreZ,foreY),foreX);
      for (let i = 0; i < buffer.length; i++) if (handInk[i]) buffer[i] = handInk[i];
      cuff(fore);
    }
    return buffer;
  }

  window.BeachPortrait = {width, height, frame, id, region, palettes};
})();
