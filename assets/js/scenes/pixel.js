/* A moment at the beach, in pixel art.
 *
 * One grid for the whole frame: 160 x 134 cells of 3 frame units. Every frame the world is laid
 * down cell by cell as palette indices (sky, sea, sand, walkers, a gull, him), the indices are
 * looked up in the palette of the hour, and the little picture is scaled up with smoothing off.
 * draw() is a pure function of the state: no clocks, no Math.random(); hashes are seeded. */
(() => {
  "use strict";

  const W = 480;
  const H = 400;
  const C = 3; // frame units per cell
  const GW = 160;
  const GH = 134;
  const N = GW * GH;
  const HZ = 59; // the first row of sea (y = 177)
  const SHORE = 286; // the waterline at the photo's tide, in frame units
  const PHOTO_TIDE = 0.4;

  /* ---------- helpers ---------- */

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = (lo, hi, v) => {
    const t = clamp((v - lo) / (hi - lo), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const frac = (v) => v - Math.floor(v);
  /* integer hash to [0, 1) */
  const ih = (x, y, z) => {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1103515245);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  /* smooth 1-D value noise in [-1, 1] */
  const noise = (x) => {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    return mix(ih(i, 7, 3), ih(i + 1, 7, 3), u) * 2 - 1;
  };
  /* smooth 2-D value noise in [0, 1] */
  const noise2 = (x, y, z) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    return mix(mix(ih(i, j, z), ih(i + 1, j, z), u), mix(ih(i, j + 1, z), ih(i + 1, j + 1, z), u), v);
  };

  /* ---------- the palette ---------- */

  // scenery
  const SK = 0; // sky, 0..5 from the zenith to the horizon
  const CL0 = 6;
  const CL1 = 7;
  const CL2 = 8;
  const SUN = 9;
  const GLOW = 10;
  const STAR = 11;
  const SE = 12; // sea, 12..17: horizon line, deep, mid, surf, shallow, film
  const FOAM = 18;
  const FOAMS = 19;
  const SPARK = 20;
  const WET0 = 21;
  const WET1 = 22;
  const SHEEN = 23;
  const SD0 = 24;
  const SD1 = 25;
  const SD2 = 26;
  const SD3 = 27;
  const RK0 = 28;
  const RK1 = 29;
  const RK2 = 30;
  // Walkers, shells and coastal details occupy the rest of the scenery palette.
  const K0 = 31, K1 = 32, K2 = 33, H1 = 34, H2 = 35;
  const WK1 = 36, WK2 = 37, WK3 = 38, WKD = H1;
  const RIM = 39, BLUSH = 40, GULL = 41, GULLS = 42;
  const FIRST_TONE = 43;
  const portrait = window.BeachPortrait;
  const SUN_FOOT = FIRST_TONE + portrait.palettes.charcoal.length;
  const SUN_WATER = SUN_FOOT + 1;
  // Subtle light over each of the six sky bands, in two intensities.
  const AUREOLE = SUN_WATER + 1;
  const BACKLIT_CLOUD = AUREOLE + 12;
  const NP = BACKLIT_CLOUD + 3;

  const hex = (s) => s.split(" ").map((h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]);

  /* the scenery's 31 colours at six moments of the day */
  const SCENE = {
    day: hex("5e9fbb 72b5ca 8ec7d4 a6d6dc bce3e3 d7ede6 fff8e2 e3edeb b8d1d1 fffbe8 fff0c8 ffffff 527fa2 508aa4 539cae 63adba 82c2c0 a2d8d2 fbfae7 c2dfd9 ffffff 9a8e84 b4a798 cfdae2 ceb89d e4cfae f2dfbd b89d85 4a4046 736563 9c8c84"),
    golden: hex("4a6eb8 6688c4 92a2c8 cdb8ae f2cb9c ffe2b0 fff4dc fbd2ae c4a4b0 fffbe0 ffdc96 ffffff 3a4a86 4a5e9a 64789e 8e9aa6 c8b6a0 f2d6aa fff6e2 e6c8b4 fffae0 8e7068 b08e7c f4cc98 cea07c e6bc90 f6d6a8 a87e68 4c3640 7a5654 a87c6c"),
    sunset: hex("2c2e6e 4a3c86 7c4c94 b45a8c e47c7c ffb27a ffcc96 ee8a7e 7a4c82 fff0b4 ffaa5c ffffff 2a2462 3c3074 5c3e86 8c5486 cc7480 f8aa86 ffdcc4 c48296 fff0b4 5e4660 7e5a72 f6a07c 9a6c84 b8848c d6a29a 7a5470 2e2238 4e3650 745064"),
    dusk: hex("10143a 1c2050 302c64 4e3a72 7a4c7c a8647e c07e8a 7a5280 3a2e62 ffd2a0 e88a76 f4f0ff 0e1034 161a46 22245a 34306a 54407a 845486 c6a2b6 6e5c8a ffd8c0 34304e 443c5e 9a6e8a 4e4466 625478 7a6888 3e3658 1a1628 2c2640 443a5a"),
    night: hex("060a1c 0a1028 0e1834 142244 1c3054 2a4068 5c6c98 3a4876 222c56 f4f2e2 7c8cbc eef2ff 060c26 0a1430 0e1c3e 14284e 1e3660 324a74 a6bce4 50648e e2ecff 1c2240 262c4e 52668e 2c3254 3a4064 4a5276 22284a 0c0e1c 1a1c30 2c3048"),
    dawn: hex("4a5ea8 6a72b6 9886be ca9cbc eeb4b2 ffd2ba fff0ea f4c6cc a296c0 fff6e2 ffd0b4 ffffff 3c4c8e 4c5ea2 6874b0 9090be cca4bc f6c8c2 fff4f0 d6bcd2 fff6ea 7e6c80 9e8696 eebcbc c4a4a8 dcbcb8 eed4c8 a28c98 3e3448 64566a 8c7888"),
  };
  const FIG = hex("fcd6b0 eeb892 cf8e6c 1e2032 3a4262 d24a40 3b5ca2 faf4ec ffffff eca88c");
  /* how the hour lights the figures: key multiplies, add lifts the shadows; rim is the low sun's edge light */
  const LIGHT = {
    day: { key: [1, 1, 1], add: [0, 0, 0], rim: [255, 250, 236], rimA: 0 },
    golden: { key: [1.05, 0.93, 0.8], add: [6, 0, 0], rim: [255, 218, 140], rimA: 0.9 },
    sunset: { key: [0.92, 0.7, 0.68], add: [10, 2, 16], rim: [255, 178, 104], rimA: 1 },
    dusk: { key: [0.64, 0.54, 0.7], add: [8, 6, 18], rim: [246, 150, 132], rimA: 0.55 },
    night: { key: [0.46, 0.52, 0.76], add: [8, 10, 26], rim: [168, 196, 255], rimA: 0.75 },
    dawn: { key: [1, 0.88, 0.88], add: [6, 2, 8], rim: [255, 214, 190], rimA: 0.7 },
  };
  const TIMELINE = [[0, "night"], [4.9, "night"], [6.3, "dawn"], [8.8, "day"], [15, "day"], [16.9, "golden"], [17.7, "sunset"], [18.5, "dusk"], [19.7, "night"], [24, "night"]];

  const PAL = new Uint32Array(NP);
  const pack = (r, g, b) => (255 << 24) | (clamp(Math.round(b), 0, 255) << 16) | (clamp(Math.round(g), 0, 255) << 8) | clamp(Math.round(r), 0, 255);

  const lighting = (hourIn, hoodie) => {
    const hour = ((hourIn % 24) + 24) % 24;
    let i = 0;
    while (i < TIMELINE.length - 2 && hour >= TIMELINE[i + 1][0]) i += 1;
    const ka = TIMELINE[i][1];
    const kb = TIMELINE[i + 1][1];
    const f = smooth(TIMELINE[i][0], TIMELINE[i + 1][0], hour);
    const A = SCENE[ka];
    const B = SCENE[kb];
    const set = (k, r, g, b) => {
      PAL[k] = pack(r, g, b);
    };
    for (let k = 0; k < 31; k += 1) set(k, mix(A[k][0], B[k][0], f), mix(A[k][1], B[k][1], f), mix(A[k][2], B[k][2], f));
    const la = LIGHT[ka];
    const lb = LIGHT[kb];
    const key = [0, 1, 2].map((c) => mix(la.key[c], lb.key[c], f));
    const add = [0, 1, 2].map((c) => mix(la.add[c], lb.add[c], f));
    const lit = (k, c) => set(k, c[0] * key[0] + add[0], c[1] * key[1] + add[1], c[2] * key[2] + add[2]);
    FIG.forEach((color, i) => lit(K0 + i, color));
    const character = portrait.palettes[hoodie] || portrait.palettes.charcoal;
    for (let k = 1; k < character.length; k++) lit(FIRST_TONE + k, character[k]);
    const rimA = mix(la.rimA, lb.rimA, f);
    const rim = [0, 1, 2].map((c) => mix(la.rim[c], lb.rim[c], f));
    set(RIM, rim[0], rim[1], rim[2]);
    for (const [k, from] of [[SPARK, FOAM], [STAR, FOAM], [CL0, FOAM], [GULL, FOAM],
      [GULLS, CL2], [CL1, SK + 5], [SHEEN, SK + 5], [SE + 5, FOAMS], [SD3, WET0], [RK2, WET0]]) {
      PAL[k] = PAL[from];
    }
    const core = A[SUN].map((v, i) => mix(v, B[SUN][i], f));
    const amber = A[GLOW].map((v, i) => mix(v, B[GLOW][i], f));
    const warm = (index, a, b, weight) => set(index, ...a.map((v, i) => mix(v, b[i], weight)));
    warm(SUN_FOOT, core, amber, .30);
    const water = A[SE + 2].map((v, i) => mix(v, B[SE + 2][i], f));
    warm(SUN_WATER, water, amber, .54);
    for (let band = 0; band < 6; band++) {
      const sky = A[band].map((v, i) => mix(v, B[band][i], f));
      warm(AUREOLE + band, sky, amber, .16);
      warm(AUREOLE + 6 + band, sky, amber, .35);
    }
    [CL0, CL1, CL2].forEach((tone, i) => {
      const cloud = A[tone].map((v, k) => mix(v, B[tone][k], f));
      warm(BACKLIT_CLOUD + i, cloud, core, [.84, .73, .59][i]);
    });
    const L = { hour, rimA };
    L.t = (hour - 6) / 12; // 0 at sunrise, 1 at sunset
    L.altitude = Math.sin(Math.PI * L.t);
    L.day = smooth(-0.1, 0.24, L.altitude);
    L.moonT = hour < 6 ? (hour + 6) / 12 : (hour - 18) / 12;
    L.sunX = W * (0.96 - 0.86 * L.t);
    L.sunY = HZ * C + 1 - L.altitude * 330;
    L.moonX = W * (0.96 - 0.86 * L.moonT);
    L.moonY = HZ * C + 1 - Math.sin(Math.PI * L.moonT) * 152; // high enough to pass above his head
    L.sunUp = L.t > -0.05 && L.t < 1.05 ? smooth(-0.07, 0.03, L.altitude) : 0;
    L.moonUp = L.moonT > -0.05 && L.moonT < 1.05 ? smooth(-0.05, 0.08, Math.sin(Math.PI * L.moonT)) * (1 - L.day) : 0;
    L.low = L.sunUp * (1 - smooth(0.1, 0.5, L.altitude)); // how low and warm the sun is
    L.stars = 1 - smooth(0.0, 0.5, L.day + L.sunUp * 0.5);
    // which side the low light comes from: the sun sets on the left, the moon rides on the right
    L.rimSide = L.sunUp > 0.05 ? (L.sunX < 240 ? -1 : 1) : L.moonX < 240 ? -1 : 1;
    return L;
  };

  /* ---------- the buffers ---------- */

  const IDX = new Uint8Array(N); // palette index of each cell
  const CLS = new Uint8Array(N); // what each cell shows: 0 sky, 1 sea, 2 sand, 3 rock, 4 walker, 5 him
  const MAT = new Uint8Array(N); // finer material ids, for the construction lines
  const Z_SKY = 0;
  const Z_SEA = 1;
  const Z_SAND = 2;
  const Z_ROCK = 3;
  const Z_WALK = 4;
  const Z_ME = 5;
  // materials: in front = larger
  const M_SKY = 1;
  const M_CLOUD = 2;
  const M_SUN = 3;
  const M_GULL = 4;
  const M_SEA = 5;
  const M_FOAM = 6;
  const M_SAND = 7;
  const M_WET = 8;
  const M_ROCK = 9;
  const M_WALK = 10;
  const BG_IDX = new Uint8Array(N); // the world without him and the walkers, for the opening
  const BG_CLS = new Uint8Array(N);
  const BG_MAT = new Uint8Array(N);
  let bgReady = false;
  let canvas = null;
  let cctx = null;
  let img = null;
  let PX = null;
  const ensureCanvas = () => {
    if (canvas) return;
    canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(GW, GH) : document.createElement("canvas");
    canvas.width = GW;
    canvas.height = GH;
    cctx = canvas.getContext("2d");
    img = cctx.createImageData(GW, GH);
    PX = new Uint32Array(img.data.buffer);
  };
  const put = (i, v, z, m) => {
    IDX[i] = v;
    CLS[i] = z;
    MAT[i] = m;
  };

  /* ---------- static scenery ---------- */

  // sky: six bands, narrower toward the horizon, each ending in two rows of checker dither
  const SKY_B = new Uint8Array(HZ);
  const SKY_D = new Uint8Array(HZ); // 0 solid, 1..3: a quarter, half or three quarters of the next band
  for (let y = 0; y < HZ; y += 1) {
    const v = Math.min(5.999, 6 * Math.pow((y + 0.5) / HZ, 1.3));
    SKY_B[y] = Math.floor(v);
    const f = frac(v);
    SKY_D[y] = v >= 5 ? 0 : f > 0.9 ? 3 : f > 0.8 ? 2 : f > 0.7 ? 1 : 0;
  }
  // A broad bank of humid air bends the bands by a couple of cells. The
  // square dither remains locked to screen coordinates, so it never crawls.
  const SKY_SHIFT = Int8Array.from({length: GW}, (_,x) =>
    Math.round(1.45*Math.sin(x*0.034) + 0.83*Math.sin(x*0.067+1.1)));
  // ordered dither: which cells of a 2 x 2 block take the next band at each level
  const DITHER = [
    [0, 0, 0, 0],
    [1, 0, 0, 0],
    [1, 0, 0, 1],
    [1, 1, 0, 1],
  ];

  // Each cloud is a cluster of connected colour runs: warm sunlit shoulders,
  // cool bellies, and a few detached wisps peeling away with the wind.
  const tileSprite = (rows, tones, x0 = 0, y0 = 0) => {
    const w = Math.max(...rows.map(row => row.length));
    const px = new Uint8Array(w * rows.length);
    rows.forEach((row, y) => {
      for (let x=0; x<row.length; x++) {
        if (row[x] !== ".") px[y*w+x] = tones[row[x]] + 1;
      }
    });
    return {w, h: rows.length, x0, y0, px};
  };
  const cloudTones = {h: CL0, m: CL1, s: CL2};
  const CLOUDS = [
    {x: 101, y: 31, speed: 0.22, s: tileSprite([
      ".................hhhh",
      "...............hhhmmmh",
      "........hh....hhmmmmmmh",
      ".......hmmhhhhhmmmsmmmmhh....hh",
      "......hh...hhmmmsssmmmmmmhhhhmhh",
      ".....hmmhhhhmmmsssssmmmmhmmmmmmmh",
      "....hmmssmmmhmmssmmmmhhmmmmmssmmmhh",
      "..hhmmsssssmmmhhhmmmmmmmmsmsssmmmmmhhh",
      "hmmmmsssssmmmhhhhmmsssssssmmmmmsssmmmmmmh",
      "..ssssmmmmmsssssssssmmmssssssssssssmmm...mm",
      "........sssssss..ssssssssss...sssss",
      "..................ssss",
    ],cloudTones)},
    {x: 1, y: 47, speed: 0.14, s: tileSprite([
      "..........hh",
      "......hhhhhmmhh....h",
      "....hhmmmmmsmmhhhhmmhh",
      "..hmmmmsmmmsssmmmssmmmhhh",
      "hmmssssssmmmsssssmmsssssmm..mm",
      "..sssss..sssss.......sss",
    ],cloudTones)},
    {x: 18, y: 17, speed: 0.30, s: tileSprite([
      "..........hhh",
      ".......hhhmmmh",
      "....hhmmmmsmmmhh",
      "..hmmmmmsssssmmmhh",
      "mmmssssssssmmmss...mm",
      "....sssss",
    ],cloudTones)},
    {x: 142, y: 52, speed: 0.12, s: tileSprite([
      "........hh",
      "...hhhhhhmhh",
      ".hmmmmmssmmmh..mm",
      "sssss..sssmmm",
    ],cloudTones)},
    {x: 135, y: 12, speed: 0.20, s: tileSprite([
      "........mmmmm",
      "...mmmmsmm...mm",
      ".sssss",
    ],cloudTones)},
  ];
  const CLOUD_SPAN = GW + 60;

  const FAN_SHELL = tileSprite(["...hh.", ".hphph", "hprprp", ".rrpr.", "..sss."],
    {h: SD2,p: BLUSH,r: K2,s: SD0});
  /* the rock in the corner: a hand-drawn sprite. o outline, a lit top, b body, c shade */
  const ROCK_ROWS = [
    "......ooooo.........",
    "....ooaaaaaoo.......",
    "...oaaaaaaaaaoo.....",
    "..oaaaaaabaaaaao....",
    "..oabaaaaaaaabbbo...",
    ".obbbbbbbbbbbbbcco..",
    ".obbbbbcbbbbbbbcco..",
    "obbbcbbbbbbbbbbccco.",
    "obbbbbbbbbbcbbbccco.",
    "obbbbbbbbbbbbbccccco",
    "obbbbbcbbbbbbbccccco",
    "obbbbbbbbbbbbbccccco",
    "obbbbbbbbbbbbcccccco",
    "obbbbbbbbbbbbcccccco",
  ];
  const ROCK = (() => {
    const w = ROCK_ROWS[0].length;
    const h = ROCK_ROWS.length;
    const map = { o: RK0, a: RK2, b: RK1, c: RK0 };
    const px = new Uint8Array(w * h);
    ROCK_ROWS.forEach((row, j) => {
      for (let i = 0; i < w; i += 1) if (row[i] !== ".") px[j * w + i] = map[row[i]] + 1;
    });
    return { w, h, px };
  })();

  /* the moon: w highlight, c lit ground, g a sea, s the limb in shadow */
  const MOON = [
    "..ccccc..",
    ".cwwcccc.",
    "cwwcggccs",
    "cwccgggcs",
    "ccccgccss",
    "cgcccccss",
    "cggccgcss",
    ".cgcccss.",
    "..cccss..",
  ];
  /* walkers: small sprites, a four-frame walk to the right. h hair, s skin, t top, l legs */
  const WALK_FRAMES = [
    [".hhh.", ".hss.", ".ttt.", "ttttt", ".ttt.", ".lll.", ".l.l.", "l...l", "l...l"],
    [".hhh.", ".hss.", ".ttt.", ".ttt.", ".ttt.", ".lll.", ".ll..", "..l..", ".ll.."],
    [".hhh.", ".hss.", ".ttt.", "ttttt", ".ttt.", ".lll.", ".l.l.", "l...l", "l...l"],
    [".hhh.", ".hss.", ".ttt.", ".ttt.", ".ttt.", ".lll.", "..ll.", "..l..", "..ll."],
  ];
  const WALK_W = 5;
  const WALK_H = 9;
  /* The same five strollers in every style. Each keeps to one of the two stretches of shore that
   * show beside him (lo..hi, in frame units), walks to its end and turns back, so no walker is
   * ever hidden behind him and changing their number always shows. */
  const WALKERS = [
    { x: 30, lo: 12, hi: 62, speed: 1.5, top: WK1, legs: WKD, hair: H1 },
    { x: 384, lo: 352, hi: 470, speed: 1.2, top: WK3, legs: WK2, hair: H2 },
    { x: 440, lo: 352, hi: 470, speed: -1.1, top: WK2, legs: WKD, hair: H1 },
    { x: 52, lo: 12, hi: 62, speed: -0.9, top: WK3, legs: WK2, hair: H2 },
    { x: 412, lo: 352, hi: 470, speed: 1.8, top: WK1, legs: WKD, hair: H1 },
  ];
  const strollAt = (w, t) => {
    const span = w.hi - w.lo;
    const u = (((w.x - w.lo + t * w.speed) / span) % 2 + 2) % 2; // 0..2: there and back
    return { x: w.lo + (u <= 1 ? u : 2 - u) * span, dir: (u <= 1 ? 1 : -1) * (w.speed > 0 ? 1 : -1) };
  };
  /* the gull: wings up, level, down, level */
  const GULL_FRAMES = [
    ["g.....g", ".g...g.", "..gwg..", "...w..."],
    [".......", "gg...gg", "..gwg..", "...w..."],
    [".......", "..www..", ".gwwwg.", "g.....g"],
    [".......", "gg...gg", "..gwg..", "...w..."],
  ];

  /* ---------- the sea and the shore ---------- */

  const shoreBase = (s) => SHORE + (clamp(s.tide, 0, 1) - PHOTO_TIDE) * 62;
  /* the waterline in frame units: a slow swash running up and down the sand */
  const waterlineU = (xu, t, base) =>
    base + 4.2 * Math.sin(t * 0.75) + 2.6 * Math.sin(xu * 0.021 + t * 0.5) + 1.8 * noise(xu * 0.045 + 3) + 1.1 * Math.sin(xu * 0.083 + 1.7 - t * 0.3);
  const waterRow = (col, t, base) => Math.round(waterlineU((col + 0.5) * C, t, base) / C);
  const WROW = new Int16Array(GW);
  const WET_END = new Int16Array(GW);

  const waves = (s, t) => {
    const speed = 0.04 + clamp(s.wind, 0, 1) * 0.06;
    return [0, 1, 2].map((k) => [frac(0.39 + k / 3 + t * speed), k]);
  };

  const R_HAIR = 21, R_FACE = 22, R_FEAT = 23, R_GLASS = 24;
  const REGIONS = [0, R_HAIR, R_FACE, R_FEAT, R_GLASS, 25, 26, 27];
  const MENX = new Int8Array(N), MENY = new Int8Array(N);
  const pose = s => ({
    dx: Math.round(-clamp(s.lean, -1, 1) * 4.3),
    cells: portrait.frame(s),
  });

  const FAR_CAPE = [[90,59],[103,57],[110,55],[119,54],[127,51],[134,51],[142,48],[149,49],[156,47],[164,48]];
  const NEAR_CAPE = [[90,60],[111,60],[119,58],[126,56],[134,55],[141,53],[148,54],[154,51],[164,52]];
  const M_LAND = 11, M_BOAT = 12;
  // On this scale the mast, two patched sails and the curved hull each need
  // only a few cells. The same transparent mask also defines the hit area.
  const BOAT = tileSprite([
    "......m.....",
    ".....pm.....",
    "....ppm..m..",
    "...sppm..hs.",
    "..ssrpm..hhs",
    ".ssrrpm..hhhs",
    "......m..m...",
    "bwwwdddddwwdb",
    ".ddddbbbdddb.",
    "...bbbbbb...",
  ], {m: RK1, p: K0, s: BLUSH, r: K2, h: CL0, w: SD2, d: RK1, b: H1});
  const boatAt = (s, t) => {
    const wind = clamp(s.wind, 0, 1);
    const x = 22 + Math.round(Math.sin(t * 0.028) * 9 - clamp(s.lean,-1,1) * 1.25);
    const y = HZ + 5 - BOAT.h + Math.round(0.86 * Math.sin(t * (0.75 + 0.64*wind)) + 0.65*(s.tide-PHOTO_TIDE));
    return {x, y};
  };
  const paintBoat = (s,t) => {
    const pos=boatAt(s,t), water=pos.y+BOAT.h;
    for (let y=0; y<BOAT.h; y++) {
      for (let x=0; x<BOAT.w; x++) {
        const v=BOAT.px[y*BOAT.w+x];
        if (v) put((pos.y+y)*GW+pos.x+x,v-1,Z_SEA,M_BOAT);
      }
    }
    // Broken reflections emerge in wider runs under the hull and fragment
    // at the sail tips. Changing the waves shifts each row as a cluster.
    for (let r=0; r<6; r++) {
      const dx=Math.round(Math.sin(t*1.36+r*1.72)*(0.6+r*0.16));
      const row=water+r;
      for(let x=0;x<BOAT.w;x++) {
        const col=pos.x+x+dx;
        if (row>=WROW[col] || MAT[row*GW+col]===M_FOAM) continue;
        const v=BOAT.px[(BOAT.h-1-Math.floor(r*1.48))*BOAT.w+x];
        if (!v || (x+3*r)%8<r*0.76) continue;
        if (r===0 || r===2) IDX[row*GW+col] = SE+1;
        else if (r===3 || r===5) IDX[row*GW+col] = v-1===CL0 ? FOAMS : SE+4;
      }
    }
  };
  const compose = (s, L, t, noWalkers) => {
    const lean = clamp(s.lean, -1, 1);
    const wind = clamp(s.wind, 0, 1);
    const swell = clamp(s.swell, 0, 1);
    const shCloud = Math.round(-lean * 1);
    const shSea = Math.round(-lean * 1.5);
    const shNear = Math.round(-lean * 2.4);
    const shWalk = Math.round(-lean * 2.2);
    const shRock = Math.round(-lean * 3.4);
    const base = shoreBase(s);
    const baseRow = base / C;

    // 1. the sky, in dithered bands
    for (let y = 0; y < HZ; y++) {
      const row=y*GW, parity=(y&1)*2;
      for (let x=0; x<GW; x++) {
        const sy=clamp(y+SKY_SHIFT[x],0,HZ-1);
        const b=SKY_B[sy], level=DITHER[SKY_D[sy]];
        put(row+x,b+level[parity+(x&1)],Z_SKY,M_SKY);
      }
    }
    // stars
    if (L.stars > 0.05) {
      for (let y = 0; y < HZ - 6; y += 1)
        for (let x = 0; x < GW; x += 1) {
          const h = ih(x, y, 11);
          if (h < 0.006 * L.stars) {
            const tw = ih(x, y, Math.floor(t * 2 + h * 900));
            IDX[y * GW + x] = tw < 0.2 ? SK + Math.min(5, SKY_B[y] + 1) : STAR;
          }
        }
    }
    // Warm light is mixed into the local sky ramp. The disc itself is
    // made of solid connected pixel clusters with a honey-coloured base.
    const sunX = (L.sunX - lean * .6) / C, sunY = L.sunY / C;
    const radius = 4.05;
    // A stable eight-column cluster holds its shape as the centre moves
    // across the grid. At low altitude the bottom row takes the amber ramp.
    const solarRows = [2, 3, 4, 4, 4, 4, 3, 2];
    const centerCol = Math.round(sunX), centerRow = Math.round(sunY);
    if (L.sunUp > .01 && sunY > -13 && sunY < HZ + 13) {
      for (let y = Math.max(0, Math.floor(sunY - 13)); y < Math.min(HZ, Math.ceil(sunY + 13)); y++)
        for (let x = Math.max(0, Math.floor(sunX - 13)); x < Math.min(GW, Math.ceil(sunX + 13)); x++) {
          const dx = x + .5 - sunX, dy = y + .5 - sunY, i = y * GW + x;
          const row = y - centerRow + 4;
          if (row >= 0 && row < solarRows.length && x >= centerCol - solarRows[row] && x < centerCol + solarRows[row]) {
            put(i, row >= 5 ? SUN_FOOT : SUN, Z_SKY, M_SUN);
          } else {
            const warmth = Math.exp(-(dx * dx + dy * dy) / 43) * L.sunUp;
            const band = Math.min(5, IDX[i]);
            const transition = (x * 3 + y * 5) % 8 / 8;
            if (warmth > .46 + .10 * transition) IDX[i] = AUREOLE + 6 + band;
            else if (warmth > .10 + .12 * transition) IDX[i] = AUREOLE + band;
          }
        }
    }
    // The moon, a little past full: a nine-cell disc with its seas, a bright upper left and
    // its right limb in shadow, inside a ring of sky one step lighter than the night around it.
    if (L.moonUp > 0.02) {
      const col = Math.round((L.moonX - lean * 0.6) / C), row = Math.round(L.moonY / C);
      const tone = { w: STAR, c: SUN, g: GLOW, s: CL0 };
      for (let y = Math.max(0, row - 11); y <= Math.min(HZ - 1, row + 11); y += 1)
        for (let x = Math.max(0, col - 11); x <= Math.min(GW - 1, col + 11); x += 1) {
          const i = y * GW + x;
          const ch = (MOON[y - row + 4] || "")[x - col + 4] || ".";
          if (ch !== ".") {
            put(i, tone[ch], Z_SKY, M_SUN);
            continue;
          }
          if (IDX[i] > SK + 5) continue; // only the bare sky takes the halo, not the stars
          const d = Math.hypot(x - col, y - row);
          const transition = ((x * 3 + y * 5) % 8) / 8;
          const lift = d < 6.2 + transition ? 2 : d < 8.6 + 1.6 * transition ? 1 : 0;
          if (lift && L.moonUp > 0.5) IDX[i] = SK + Math.min(5, SKY_B[y] + lift);
        }
    }
    // clouds
    for (const cl of CLOUDS) {
      const sh = cl.s;
      const drift = Math.floor(t * cl.speed * (0.4 + wind * 1.4));
      let x0 = cl.x + sh.x0 + drift + shCloud;
      x0 = ((((x0 + 30) % CLOUD_SPAN) + CLOUD_SPAN) % CLOUD_SPAN) - 30;
      const y0 = cl.y + sh.y0;
      for (let j = 0; j < sh.h; j += 1) {
        const y = y0 + j;
        if (y < 0 || y >= HZ) continue;
        for (let i = 0; i < sh.w; i += 1) {
          const v = sh.px[j * sh.w + i];
          const x = x0 + i;
          if (v && x >= 0 && x < GW) {
            const index = y * GW + x, original = v - 1;
            const tone = MAT[index] === M_SUN && L.sunUp > .1 ? BACKLIT_CLOUD + (original - CL0) : original;
            put(index, tone, Z_SKY, M_CLOUD);
          }
        }
      }
    }
    // the gull
    {
      const period = 30;
      const ph = (t + 21) % period;
      const gx = Math.round(-10 + ph * 6.2);
      const gy = 30 + Math.round(Math.sin(t * 0.7) * 1.6) - Math.round(ph * 0.25);
      if (gx > -8 && gx < GW + 1) {
        const fr = GULL_FRAMES[Math.floor(t * 5) % 4];
        fr.forEach((row, j) => {
          for (let i = 0; i < row.length; i += 1) {
            const ch = row[i];
            if (ch === ".") continue;
            const x = gx + i - 3;
            const y = gy + j - 2;
            if (x >= 0 && x < GW && y >= 0 && y < HZ) put(y * GW + x, ch === "w" ? GULL : GULLS, Z_SKY, M_GULL);
          }
        });
      }
    }

    // Layered headland in sea haze. The signal tower gives the horizon a scale.
    const headland = (x, ridge) => {
      for (let j = 1; j < ridge.length; j++) {
        if (x < ridge[j][0]) {
          const [a, h] = ridge[j - 1], [b, k] = ridge[j];
          return Math.floor(mix(h, k, (x - a) / (b - a)));
        }
      }
      return ridge[ridge.length - 1][1];
    };
    for (let x = 0; x < GW; x++) {
      const u = x - shCloud;
      if (u < 91) continue;
      const back = headland(u, FAR_CAPE), near = headland(u, NEAR_CAPE);
      for (let y = back; y < HZ; y++) {
        let tone = y < near ? CL2 : SE + 2;
        if (y === near && u > 119) tone = SE + 4;
        if (y >= near + 2 && (u + y * 2) % 19 < 3) tone = SE + 3;
        put(y * GW + x, tone, Z_SKY, M_LAND);
      }
    }
    const towerX = 139 + shCloud;
    for (let y = 45; y <= 54; y++) {
      const half = y < 48 ? 1 : y < 52 ? 0 : 1;
      for (let x = towerX - half; x <= towerX + half; x++) {
        const tone = y === 45 || y === 47 ? RK1 : y === 50 ? BLUSH : y === 46 ? GLOW : CL0;
        put(y * GW + x, tone, Z_SKY, M_LAND);
      }
    }

    // Lantern roof, sunlit cottage and its ochre roof beneath the tower.
    for (const [dx, y, tone] of [[0,44,RK1],[-1,45,RK1],[1,45,RK1],[0,46,SUN],
      [2,52,RK1],[3,51,RK1],[4,51,RK1],[5,52,RK1],[3,52,CL0],[4,52,CL0],[3,53,CL0],[4,53,CL1]]) {
      put(y * GW + towerX + dx, tone, Z_SKY, M_LAND);
    }

    // 2. the sea
    for (let x = 0; x < GW; x += 1) {
      const wr = Math.max(HZ + 6, waterRow(x - shNear, t, base));
      WROW[x] = wr;
      WET_END[x] = Math.round(baseRow + 4.7 + 2.4 * noise((x - shNear) * 0.073 + 4));
    }
    const span = baseRow - HZ;
    for (let x = 0; x < GW; x += 1) {
      const xs = x - shSea;
      const wr = WROW[x];
      for (let y = HZ; y < wr && y < GH; y += 1) {
        const d = (y - HZ) / span;
        let v;
        if (y === HZ) v = SE;
        else if (d < 0.2) v = SE + 1;
        else if (d < 0.27) v = (x + y) & 1 ? SE + 2 : SE + 1;
        else if (d < 0.44) v = SE + 2;
        else if (d < 0.5) v = (x + y) & 1 ? SE + 3 : SE + 2;
        else v = SE + 3;
        const toShore = wr - y;
        if (toShore <= 1) v = SE + 5;
        else if (toShore <= 3) v = SE + 4;
        else if (toShore === 4 && (x + y) & 1) v = SE + 4;
        // far swell: short lines drifting along the rows
        if (d < 0.4 && y > HZ) {
          const r = y - HZ;
          const len = 2 + Math.floor(r * 0.5);
          const dir = r & 1 ? 1 : -1;
          const xx = xs + Math.floor(t * (0.6 + r * 0.08) * (0.5 + wind) * dir) + r * 37;
          const seg = Math.floor(xx / (len + 3));
          const inSeg = xx - seg * (len + 3) < len;
          if (inSeg) {
            const h = ih(seg, r, 5);
            const on = ih(seg, r, 6 + Math.floor(t * 0.8 + h * 5)) < 0.55;
            if (on && h < 0.22) v = SE + 2;
            else if (on && h > 0.86 && d < 0.3) v = SE;
          }
        }
        put(y * GW + x, v, Z_SEA, M_SEA);
      }
    }
    // sparkles: four-frame glints that come and go
    {
      const fr = Math.floor(t * 8);
      for (let by = 0; by < 12; by += 1)
        for (let bx = 0; bx < 28; bx += 1) {
          const hsel = ih(bx, by, 21);
          if (hsel > 0.42) continue;
          const o = Math.floor(ih(bx, by, 22) * 37);
          const f = (fr + o) % 37;
          if (f > 3) continue;
          const cyc = Math.floor((fr + o) / 37);
          const x = bx * 6 + Math.floor(ih(bx, cyc, 23) * 6) + shSea;
          const y = HZ + 2 + by * 3 + Math.floor(ih(by, cyc, 24) * 3);
          if (x < 1 || x >= GW - 1 || y >= WROW[x] - 2) continue;
          const i = y * GW + x;
          if (CLS[i] !== Z_SEA || IDX[i] === FOAM) continue;
          IDX[i] = f === 1 || f === 2 ? SPARK : SE + 5;
          if (f === 2) {
            IDX[i - 1] = SE + 5;
            IDX[i + 1] = SE + 5;
          }
        }
    }
    // Individual horizontal facets catch the light. Further out the
    // narrow flashes cluster under the sky source; nearby crests spread
    // them sideways. Skip a sun hidden by the cape, clouds or horizon.
    let exposed = 0;
    if (L.low > .01) {
      for (let y = Math.max(0, Math.floor(sunY - radius)); y < Math.min(HZ, Math.ceil(sunY + radius)); y++)
        for (let x = Math.max(0, Math.floor(sunX - radius)); x < Math.min(GW, Math.ceil(sunX + radius)); x++)
          if (MAT[y * GW + x] === M_SUN) exposed++;
          else if (IDX[y * GW + x] >= BACKLIT_CLOUD) exposed += .42;
    }
    const pathOn = (cx, strength, hot, warm) => {
      if (strength < .04) return;
      for (let y = HZ; y < GH; y++) {
        const depth = (y - HZ) / Math.max(1, baseRow - HZ), hw = 1.35 + 6.8 * depth;
        const ripple = .5 + .5 * Math.sin((y - HZ) * 2.22 + t * .88);
        if (ripple < .13) continue;
        const center = cx + Math.sin(y * .72 + t * .43) * (.45 + depth * 1.55);
        const length = hw * (.33 + .67 * ripple);
        for (let x = Math.max(0, Math.floor(center - length)); x < Math.min(GW, Math.ceil(center + length)); x++) {
          if (y >= WROW[x] - 1 || CLS[y * GW + x] !== Z_SEA) continue;
          const across = Math.abs(x + .5 - center) / length;
          const light = strength * (1 - across ** 2) * (.34 + .66 * ripple);
          if (light > .62) IDX[y * GW + x] = hot;
          else if (light > .16) IDX[y * GW + x] = warm;
        }
      }
    };
    pathOn(sunX, L.low * smooth(0, 40, exposed), SUN_FOOT, SUN_WATER);
    pathOn(L.moonX / C, L.moonUp * .65, SPARK, SE + 4);

    // the breaking waves
    for (const [p, k] of waves(s, t)) {
      const shW = Math.round(-lean * (1.5 + p));
      const yk = HZ + 7 + (baseRow - (HZ + 7) - 1.5) * Math.pow(p, 1.25);
      const bulk = Math.exp(-Math.pow((p - 0.4) / 0.15, 2));
      const th = Math.round(1 + swell * 2.7 * bulk + 1.2 * smooth(0.5, 0.85, p) * (0.4 + swell));
      for (let x = 0; x < GW; x += 1) {
        const xs = x - shW;
        const wob = noise(xs * 0.08 + k * 13.7 + t * 0.12) * (0.7 + swell * 1.1) + noise(xs * 0.23 + k * 3.1) * 0.6;
        const yc = Math.round(yk + wob);
        const wr = WROW[x];
        if (p < 0.2) {
          // a swell line building up
          const on = noise(xs * 0.13 + k * 7 + t * 0.05) > 0.25 - p * 3;
          if (!on || yc >= wr - 2) continue;
          IDX[yc * GW + x] = SE;
          if (p > 0.1 && noise(xs * 0.31 + k * 5) > 0.55 - (p - 0.1) * 4) put((yc - 1) * GW + x, FOAMS, Z_SEA, M_FOAM);
          else IDX[(yc - 1) * GW + x] = SE + 3;
        } else if (p < 0.62) {
          // breaking: a band of white water over a dark trough
          const top = yc - Math.floor(th * 0.45) - (noise(xs * 0.4 + k * 11 + t * 0.3) > 0.3 ? 1 : 0);
          const bot = yc + Math.ceil(th * 0.55);
          for (let y = top; y <= bot; y += 1) {
            if (y < HZ + 1 || y >= wr) continue;
            const crest = noise(xs * .067 + k * 3 + t * .19);
            const hole = y > top && y < bot && noise(xs*0.28 + k*2.4 + t*0.4) > 0.49;
            const v = hole ? SE+4 : crest < -.22 ? (y === top ? SE + 4 : SE + 3)
              : y === bot || crest < .18 ? FOAMS : FOAM;
            put(y * GW + x, v, Z_SEA, M_FOAM);
          }
          if (p < 0.5 && bot + 1 < wr - 1 && noise(xs * .06 + k * 3 + t * .19) > .06) IDX[(bot + 1) * GW + x] = SE + 1;
          // spray at the crest
          if (noise2(xs * 0.5 + k * 9, t * 3, 41) > 0.72 && top - 1 > HZ) put((top - 1) * GW + x, FOAMS, Z_SEA, M_FOAM);
        } else {
          // spent: the foam spreads into lace and runs up the sand
          const age = (p - 0.62) / 0.38;
          const thr = 0.4 + age * 0.3;
          const h0 = Math.round(Math.max(1, th * (1 - age * 0.6)));
          for (let dy = -h0; dy <= h0; dy += 1) {
            const y = yc + dy;
            if (y < HZ + 1 || y >= wr) continue;
            const n = noise2(xs * 0.19 + dy * 0.45 + k * 17 + t * 0.2, dy * 0.6 + k * 3, 43) * 0.75 + noise2(xs * 0.5 + k * 5, dy * 1.1 + t * 0.6, 44) * 0.25;
            const edge = Math.abs(dy) / (h0 + 0.5);
            if (n > thr + edge * 0.35) put(y * GW + x, n > thr + 0.2 + edge * 0.35 ? FOAM : FOAMS, Z_SEA, M_FOAM);
          }
        }
      }
    }

    paintBoat(s,t);

    // 3. the sand
    for (let x = 0; x < GW; x += 1) {
      const xs = x - shNear;
      const wr = WROW[x];
      const we = Math.max(WET_END[x], wr + 2);
      // the water's lacy edge
      if (wr < GH) {
        const n = noise((xs + t * 2) * 0.35 + 9);
        put(wr * GW + x, n > -0.35 ? FOAM : FOAMS, Z_SEA, M_FOAM);
      }
      for (let y = wr + 1; y < GH; y += 1) {
        const i = y * GW + x;
        let v;
        let m = M_SAND;
        if (y <= we) {
          m = M_WET;
          v = WET1;
          const run = noise(xs*0.081 + y*0.74 + t*0.18);
          if (y === wr + 1) v = run>0.18 ? FOAMS : SHEEN;
          else if (y < we-1 && run > 0.32) v = SHEEN;
          else if (y === we) v = noise(xs * 0.3 + 2) > -0.2 ? WET0 : WET1;
          else if (ih(Math.floor((xs + 400) / 5), y, 51) < 0.32 && (xs + 400) % 5 < 4) v = SHEEN;
        } else {
          v = SD1;
          const r = y - we;
          if (r === 1) v = x & 1 ? SD0 : SD1;
          // soft drifts of lighter sand, warmer toward the near corner
          const n = noise2((xs + 600) * 0.055, y * 0.22, 57) + (y - 110) / 90;
          if (n > 0.78) v = SD2;
          else if (n > 0.72 && (x + y) & 1) v = SD2;
          // ripples: short dark dashes with a lit lip above
          const rx = Math.floor((xs + 600) / 6);
          const ry = Math.floor(y / 3);
          const hr = ih(rx, ry, 53);
          const lx = (xs + 600) % 6;
          if (r > 2 && hr < 0.16 && y % 3 === 1 && lx > 0 && lx < 5) v = SD0;
          else if (r > 3 && hr < 0.16 && y % 3 === 0 && lx > 1 && lx < 4) v = SD2;
          // grains
          const hg = ih(xs + 600, y, 55);
          if (hg < 0.01 && r > 1) v = SD3;
        }
        put(i, v, Z_SAND, m);
      }
    }

    // footprints from the near corner toward the water, a shell, pebbles
    {
      const dot = (x, y, v) => {
        const xx = x + shNear;
        if (xx >= 0 && xx < GW && y >= 0 && y < GH && CLS[y * GW + xx] === Z_SAND && MAT[y * GW + xx] === M_SAND) IDX[y * GW + xx] = v;
      };
      for (let k = 0; k < 11; k += 1) {
        const y = GH - 2 - k * 3;
        const x = Math.round(152 - k * 1.6 + (k & 1 ? 2 : -1));
        dot(x, y, SD0);
        dot(x + 1, y, SD0);
        dot(x, y - 1, SD2);
      }
      for (let dy=0; dy<FAN_SHELL.h; dy++) {
        for (let dx=0; dx<FAN_SHELL.w; dx++) {
          const v=FAN_SHELL.px[dy*FAN_SHELL.w+dx];
          if (v) dot(137+dx,116+dy,v-1);
        }
      }
      [[150, 106, RK1], [151, 106, RK2], [150, 107, SD0], [151, 107, SD0], [24, 112, RK1], [25, 112, RK1], [24, 113, SD0], [25, 113, SD0], [96, 128, RK2], [97, 128, RK1]].forEach(([x, y, v]) => dot(x, y, v));
    }

    // 4. walkers, with their reflections in the wet sand
    const count = noWalkers ? 0 : clamp(Math.round(s.walkers), 0, 5);
    for (let k = 0; k < count; k += 1) {
      const wk = walkerAt(k, s, t);
      const fr = WALK_FRAMES[Math.floor(t * 4 * Math.min(1.4, Math.abs(WALKERS[k].speed) / 1.4) + k * 2) % 4];
      const wd = WALKERS[k];
      const map = { h: wd.hair, s: K1, t: wd.top, l: wd.legs };
      const x0 = wk.col + shWalk - 2;
      const y0 = wk.feet - (WALK_H - 1);
      for (let j = 0; j < WALK_H; j += 1)
        for (let i = 0; i < WALK_W; i += 1) {
          const ch = fr[j][wk.dir > 0 ? i : WALK_W - 1 - i];
          if (ch === ".") continue;
          const x = x0 + i;
          const y = y0 + j;
          if (x < 0 || x >= GW || y < 0 || y >= GH) continue;
          put(y * GW + x, map[ch], Z_WALK, M_WALK);
          // reflection, every other row
          const ry = wk.feet + (wk.feet - y) + 1;
          if ((ry - wk.feet) % 2 === 1 && ry < GH && MAT[ry * GW + x] === M_WET) IDX[ry * GW + x] = ch === "t" && wd.top === WK3 ? SHEEN : WET0;
        }
    }

    // 5. the rock
    {
      const x0 = -4 + shRock;
      const y0 = GH - ROCK.h;
      for (let j = 0; j < ROCK.h; j += 1)
        for (let i = 0; i < ROCK.w; i += 1) {
          const v = ROCK.px[j * ROCK.w + i];
          const x = x0 + i;
          if (v && x >= 0 && x < GW) put((y0 + j) * GW + x, v - 1, Z_ROCK, M_ROCK);
        }
    }
  };

  /* walkers: where each one is at time t (cells) */
  const walkerAt = (k, s, t) => {
    const { x: xu, dir } = strollAt(WALKERS[k], t);
    const col = Math.round(xu / C);
    const feet = waterRow(col, t, shoreBase(s)) + 1;
    return { col, feet, dir };
  };

  // Lay down exactly the cells used by hit-testing and the construction views.
  function placeMe(L, P) {
    let left = GW, right = 0, top = GH;
    for (let y = 0; y < GH; y++) {
      const row = y * GW;
      for (let x = 0; x < GW; x++) {
        const v = P.cells[row + x], col = x + P.dx;
        if (!v || col < 0 || col >= GW) continue;
        const i = row + col;
        left = Math.min(left, col);
        right = Math.max(right, col);
        top = Math.min(top, y);
        const head = y < 78 && x < 92;
        const nx = clamp((x - (head ? 68 : 65)) / (head ? 23 : 55), -1, 1);
        MENX[i] = Math.round(nx * (head ? 90 : 62));
        MENY[i] = head ? Math.round(clamp((y - 48) / 28, -1, 1) * 50) : -12;
        const litEdge = L.rimA > .25 && !P.cells[row + x + L.rimSide] && y < 110;
        put(i, litEdge ? RIM : FIRST_TONE + v, Z_ME, REGIONS[portrait.region[v]]);
      }
    }
    P.box = [left, top, right + 1, GH];
  }

  /* ---------- the 3D world behind him, redrawn on this grid ----------
     When the shared world (assets/js/beach-env.js) is there, it is rendered at one sample per
     cell and read back twice: what each cell shows, which feeds the same class and material
     grids as the flat backdrop does, and its colours, which are cut down to a small palette
     with an ordered dither. He is then laid over it from the sprite, as before. */
  const worldOf = () => (window.BeachEnv && window.BeachEnv.ready() ? window.BeachEnv : null);
  //             -  sky    cloud    sun    gull    sea    foam    sand    wet    rock    walker  land    boat    grass   tower
  const ENV_Z = [0, Z_SKY, Z_SKY, Z_SKY, Z_SKY, Z_SEA, Z_SEA, Z_SAND, Z_SAND, Z_ROCK, Z_WALK, Z_SKY, Z_SEA, Z_ROCK, Z_SKY];
  const ENV_M = [M_SKY, M_SKY, M_CLOUD, M_SUN, M_GULL, M_SEA, M_FOAM, M_SAND, M_WET, M_ROCK, M_WALK, M_LAND, M_BOAT, M_ROCK, M_LAND];
  const WORLD = new Uint32Array(N); // the world's colour in each cell
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const LEVELS = 15; // bands of brightness in the world's palette
  const SEAM = 0.2; // how much of a band is dithered into the next
  const layWorld = (env, state) => {
    const ids = env.pixels(Object.assign({}, state, { view: "ids" }), GW, GH);
    if (!ids) return false;
    for (let i = 0; i < N; i += 1) {
      const m = ids[i * 4] < 15 ? ids[i * 4] : 0;
      IDX[i] = 0;
      CLS[i] = ENV_Z[m];
      MAT[i] = ENV_M[m];
    }
    return true;
  };
  const paintWorld = (env, state, view) => {
    const px = env.pixels(Object.assign({}, state, { view, look: { grain: 0, vignette: 0.1, bloom: 0.7 } }), GW, GH);
    if (!px) return;
    for (let y = 0, i = 0; y < GH; y += 1)
      for (let x = 0; x < GW; x += 1, i += 1) {
        const o = i * 4;
        if (view === "depth") {
          // quantise into steps of 6, with a checker between: depth in pixel bands
          const q = Math.max(8, px[o]) / 6;
          const lo = Math.floor(q);
          const g = (q - lo > 0.5 && (x + y) & 1 ? lo + 1 : lo) * 6;
          WORLD[i] = pack(g, g, g);
        } else if (view === "normal") {
          WORLD[i] = pack(px[o] & 0xf8, px[o + 1] & 0xf8, px[o + 2] & 0xf8);
        } else {
          // Brightness falls into a few bands, with a little ordered dither where two bands meet; the hue is kept.
          const r = px[o], g = px[o + 1], b = px[o + 2];
          const luma = Math.sqrt((r * 0.3 + g * 0.55 + b * 0.15) / 255);
          const f = luma * (LEVELS - 1);
          const lo = Math.floor(f);
          const d = (BAYER[(x & 3) + (y & 3) * 4] + 0.5) / 16;
          // (bright things, the clouds and the foam, keep hard steps: a checker there reads as noise)
          const edge = (f - lo - 0.5) / (luma > 0.86 ? 0.02 : SEAM) + 0.5; // 0..1 across the dithered seam between two bands
          const band = (edge > d ? lo + 1 : lo) / (LEVELS - 1);
          const k = luma > 0.02 ? (band * band) / (luma * luma) : 1;
          WORLD[i] = pack(Math.min(255, r * k) & 0xf8, Math.min(255, g * k) & 0xf8, Math.min(255, b * k) & 0xf8);
        }
      }
  };
  /* The sprites of the 3D world, found again on the grid: one box around each run of columns that holds a walker. */
  const worldWalkers = () => {
    const boxes = [];
    let box = null;
    for (let x = 0; x < GW; x += 1) {
      let top = -1, bottom = -1;
      for (let y = HZ; y < GH; y += 1) if (CLS[y * GW + x] === Z_WALK) { if (top < 0) top = y; bottom = y; }
      if (top < 0) { if (box) { boxes.push(box); box = null; } continue; }
      if (!box) box = [x - 1, top - 1, x + 2, bottom + 2];
      else { box[1] = Math.min(box[1], top - 1); box[2] = x + 2; box[3] = Math.max(box[3], bottom + 2); }
    }
    if (box) boxes.push(box);
    return boxes;
  };
  let inWorld = false; // this frame's backdrop is the 3D world

  /* ---------- the views ---------- */

  const blit = (ctx) => {
    cctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, 0, 0, GW * C, GH * C);
  };

  const drawRgb = (ctx) => {
    if (inWorld) for (let i = 0; i < N; i += 1) PX[i] = CLS[i] === Z_ME ? PAL[IDX[i]] : WORLD[i];
    else for (let i = 0; i < N; i += 1) PX[i] = PAL[IDX[i]];
    blit(ctx);
  };

  const SEG = [pack(124, 166, 232), pack(52, 112, 204), pack(232, 198, 122), pack(142, 128, 122), pack(234, 86, 98), pack(234, 86, 98)];
  const drawSeg = (ctx) => {
    for (let i = 0; i < N; i += 1) PX[i] = SEG[CLS[i]];
    blit(ctx);
  };
  const drawDepth = (ctx, s) => {
    const shore = shoreBase(s) / C;
    for (let y = 0; y < GH; y += 1)
      for (let x = 0; x < GW; x += 1) {
        const i = y * GW + x;
        const z = CLS[i];
        if (inWorld && z !== Z_ME) { PX[i] = WORLD[i]; continue; }
        let g = 8;
        if (MAT[i] === M_BOAT) g = 46;
        else if (z === Z_SKY && MAT[i] === M_LAND) g=27;
        else if (z === Z_SEA) g = mix(34, 118, clamp((y - HZ) / (WROW[x] - HZ), 0, 1));
        else if (z === Z_SAND) g = mix(118, 214, clamp((y - shore) / (GH - shore), 0, 1));
        else if (z === Z_ROCK) g = 206;
        else if (z === Z_WALK) g = 128;
        else if (z === Z_ME) g = 238 - Math.abs(MENX[i] || 0) * 0.1;
        // quantise into steps of 6, with a checker between: depth in pixel bands
        const q = g / 6;
        const lo = Math.floor(q);
        g = (frac(q) > 0.5 && (x + y) & 1 ? lo + 1 : lo) * 6;
        PX[i] = pack(g, g, g);
      }
    blit(ctx);
  };
  const drawNormal = (ctx) => {
    const sky = pack(22, 24, 34);
    const ground = pack(128, 246, 166);
    for (let y = 0; y < GH; y += 1)
      for (let x = 0; x < GW; x += 1) {
        const i = y * GW + x;
        const z = CLS[i];
        if (inWorld && z !== Z_ME) PX[i] = WORLD[i];
        else if (MAT[i] === M_BOAT) PX[i] = IDX[i]===CL0 ? pack(146,154,241) : pack(109,149,243);
        else if (MAT[i] === M_LAND) PX[i] = pack(120,181,212);
        else if (z === Z_SKY) PX[i] = sky;
        else if (z === Z_SEA || z === Z_SAND) PX[i] = ground;
        else if (z === Z_ROCK) PX[i] = pack(150, 200, 200);
        else if (z === Z_WALK) PX[i] = pack(128, 140, 240);
        else {
          const nx = MENX[i] / 100;
          const ny = MENY[i] / 100;
          const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
          PX[i] = pack(128 + nx * 72, 128 - ny * 118 + Math.abs(nx) * 12, 128 + nz * 127 - Math.abs(nx) * 6);
        }
      }
    blit(ctx);
  };

  /* ---------- the wire view: the level editor ---------- */

  const PART_OF = (z) => (z === Z_SKY || z === Z_SAND || z === Z_ROCK ? "beach" : z === Z_SEA ? "sea" : z === Z_WALK ? "walkers" : "person");
  const TILE = 8;
  const TX = GW / TILE;
  const TY = Math.ceil(GH / TILE);
  /* the order in which a part's tiles are laid, 0..1 */
  const tileOrder = (part, tx, ty) => {
    const h = ih(tx, ty, 61);
    if (part === "beach") return clamp(((tx + ty * 1.4) / (TX + TY * 1.4)) * 0.82 + h * 0.16, 0, 1);
    if (part === "sea") return clamp((tx / TX) * 0.84 + h * 0.14, 0, 1);
    if (part === "walkers") return clamp((tx / TX) * 0.7 + h * 0.2, 0, 1);
    return clamp(((ty - 3) / (TY - 3)) * 0.8 + h * 0.18, 0, 1);
  };
  const WIRE_COL = {
    beach: [150, 186, 255],
    sea: [96, 226, 255],
    walkers: [255, 196, 92],
    person: [255, 232, 214],
  };
  const WIRE_BG0 = pack(8, 11, 22); // an empty cell, no tile laid yet
  const WIRE_BG = pack(13, 18, 33); // laid tiles, in a faint checker
  const WIRE_BG2 = pack(17, 23, 41);

  const isEdge = (i, x, y) => {
    const m = MAT[i];
    return (x > 0 && MAT[i - 1] < m) || (x < GW - 1 && MAT[i + 1] < m) || (y > 0 && MAT[i - GW] < m) || (y < GH - 1 && MAT[i + GW] < m);
  };

  const drawWire = (ctx, s, L, t, partsIn, overlay, P) => {
    const parts = {
      beach: partsIn.beach === undefined ? 1 : clamp(+partsIn.beach || 0, 0, 1),
      sea: partsIn.sea === undefined ? 1 : clamp(+partsIn.sea || 0, 0, 1),
      walkers: partsIn.walkers === undefined ? 1 : clamp(+partsIn.walkers || 0, 0, 1),
      person: partsIn.person === undefined ? 1 : clamp(+partsIn.person || 0, 0, 1),
    };
    const sc = Math.abs(ctx.getTransform().a) || 1;
    const px1 = 1 / sc;
    if (overlay) {
      drawSelection(ctx, s, t, parts, px1, P);
      return;
    }
    // cells: line art of each placed part on the dark editor ground
    const cols = {};
    for (const k of Object.keys(WIRE_COL)) {
      const c = WIRE_COL[k];
      cols[k] = [pack(c[0], c[1], c[2]), pack(c[0] * 0.3 + 12 * 0.7, c[1] * 0.3 + 16 * 0.7, c[2] * 0.3 + 30 * 0.7), pack(c[0] * 0.17 + 12 * 0.83, c[1] * 0.17 + 16 * 0.83, c[2] * 0.17 + 30 * 0.83)];
    }
    const placed = new Uint8Array(TX * TY * 4);
    const PARTS = ["beach", "sea", "walkers", "person"];
    for (let ty = 0; ty < TY; ty += 1)
      for (let tx = 0; tx < TX; tx += 1)
        PARTS.forEach((p, pi) => {
          const v = parts[p];
          placed[(ty * TX + tx) * 4 + pi] = v >= 1 || (v > 0 && tileOrder(p, tx, ty) < v) ? 1 : 0;
        });
    if (bgReady)
      for (let i = 0; i < N; i += 1) {
        const z = CLS[i];
        if (z !== Z_ME && z !== Z_WALK) continue;
        const x = i % GW;
        const y = (i - x) / GW;
        const pi = z === Z_ME ? 3 : 2;
        if (placed[((y >> 3) * TX + (x >> 3)) * 4 + pi]) continue;
        IDX[i] = BG_IDX[i];
        CLS[i] = BG_CLS[i];
        MAT[i] = BG_MAT[i];
      }
    for (let y = 0; y < GH; y += 1)
      for (let x = 0; x < GW; x += 1) {
        const i = y * GW + x;
        const z = CLS[i];
        const p = PART_OF(z);
        const pi = PARTS.indexOf(p);
        const bg = ((x >> 3) + (y >> 3)) & 1 ? WIRE_BG2 : WIRE_BG;
        if (!placed[((y >> 3) * TX + (x >> 3)) * 4 + pi]) {
          PX[i] = WIRE_BG0;
          continue;
        }
        const m = MAT[i];
        const v = IDX[i];
        if (isEdge(i, x, y)) PX[i] = cols[p][0];
        else if (m === M_SKY && y > 0 && SKY_B[clamp(y+SKY_SHIFT[x],0,HZ-1)] !== SKY_B[clamp(y-1+SKY_SHIFT[x],0,HZ-1)] && !(x & 1)) PX[i] = cols[p][2];
        else if (m === M_SAND && (v === SD0 || v === SD3 || v === RK1 || v === RK2 || v === BLUSH)) PX[i] = cols[p][1];
        else if (m === M_WET && v === SHEEN && (x + y) & 1) PX[i] = cols[p][2];
        else if (z === Z_ME && m === R_HAIR && v === FIRST_TONE + portrait.id.hairInk) PX[i] = cols[p][1];
        else if (z === Z_ME && m === R_HAIR && v === FIRST_TONE + portrait.id.hairLight) PX[i] = cols[p][1];
        else if (z === Z_ME) PX[i] = m === R_FEAT || m === R_GLASS ? cols[p][1] : cols[p][2];
        else if (z === Z_WALK || m === M_SUN || m === M_FOAM || m === M_GULL) PX[i] = m === M_FOAM ? cols[p][2] : cols[p][1];
        else if (m === M_BOAT) PX[i] = IDX[i]===CL0 ? cols[p][1] : cols[p][2];
        else if (m === M_CLOUD || m === M_ROCK || m === M_LAND) PX[i] = cols[p][2];
        else PX[i] = bg;
      }
    blit(ctx);
    // the grid: every cell faintly, every tile more
    ctx.save();
    const snap = (u) => (Math.round(u * sc) + 0.5) / sc;
    ctx.lineWidth = px1;
    ctx.strokeStyle = "rgba(120,150,230,0.10)";
    ctx.beginPath();
    for (let x = 1; x < GW; x += 1) {
      if (x % TILE === 0) continue;
      ctx.moveTo(snap(x * C), 0);
      ctx.lineTo(snap(x * C), H);
    }
    for (let y = 1; y < GH; y += 1) {
      if (y % TILE === 0) continue;
      ctx.moveTo(0, snap(y * C));
      ctx.lineTo(W, snap(y * C));
    }
    ctx.stroke();
    ctx.strokeStyle = "rgba(140,170,255,0.26)";
    ctx.beginPath();
    for (let x = TILE; x < GW; x += TILE) {
      ctx.moveTo(snap(x * C), 0);
      ctx.lineTo(snap(x * C), H);
    }
    for (let y = TILE; y < GH; y += TILE) {
      ctx.moveTo(0, snap(y * C));
      ctx.lineTo(W, snap(y * C));
    }
    ctx.stroke();
    // tiles just laid: a bright frame
    ctx.lineWidth = Math.max(px1, 0.75);
    PARTS.forEach((p) => {
      const v = parts[p];
      if (v <= 0 || v >= 1) return;
      const c = WIRE_COL[p];
      for (let ty = 0; ty < TY; ty += 1)
        for (let tx = 0; tx < TX; tx += 1) {
          const o = tileOrder(p, tx, ty);
          const age = (v - o) / 0.12;
          if (age < 0 || age > 1) continue;
          let any = false;
          for (let y = ty * TILE; y < Math.min(GH, ty * TILE + TILE) && !any; y += 1)
            for (let x = tx * TILE; x < tx * TILE + TILE; x += 1)
              if (PART_OF(CLS[y * GW + x]) === p) {
                any = true;
                break;
              }
          if (!any) continue;
          ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${(1 - age).toFixed(3)})`;
          ctx.strokeRect(tx * TILE * C + px1, ty * TILE * C + px1, TILE * C - 2 * px1, TILE * C - 2 * px1);
        }
    });
    // sprite boxes and names
    labels(ctx, s, t, parts, px1, P, false);
    ctx.restore();
  };

  /* bounding boxes of the sprites, in cells */
  const meBox = (P) => P.box;
  const walkerBox = (k, s, t) => {
    const wk = walkerAt(k, s, t);
    const shWalk = Math.round(-clamp(s.lean, -1, 1) * 2.2);
    return [wk.col + shWalk - 2, wk.feet - (WALK_H - 1), wk.col + shWalk - 2 + WALK_W, wk.feet + 1];
  };
  const labels = (ctx, s, t, parts, px1, P, halo) => {
    const font = '6px Menlo, Consolas, "DejaVu Sans Mono", monospace';
    ctx.font = font;
    ctx.textBaseline = "bottom";
    const box = (b, c, name, a) => {
      const x0 = b[0] * C;
      const y0 = b[1] * C;
      const x1 = b[2] * C;
      const y1 = Math.min(H, b[3] * C);
      ctx.setLineDash([2, 2]);
      ctx.lineDashOffset = -t * 4;
      if (halo) {
        ctx.strokeStyle = "rgba(6,8,18,0.55)";
        ctx.lineWidth = px1 * 3;
        ctx.setLineDash([]);
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        ctx.setLineDash([2, 2]);
      }
      ctx.lineWidth = Math.max(px1, 0.6);
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${a})`;
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.setLineDash([]);
      // corner handles
      ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${a})`;
      [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].forEach(([x, y]) => ctx.fillRect(x - 1.2, y - 1.2, 2.4, 2.4));
      if (name) {
        const tw = ctx.measureText(name).width;
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${a})`;
        ctx.fillRect(x0, y0 - 7.5, tw + 4, 7.5);
        ctx.fillStyle = "rgb(12,16,30)";
        ctx.fillText(name, x0 + 2, y0 - 1);
      }
    };
    if (parts.person > 0) box(meBox(P), WIRE_COL.person, "me = Person", parts.person >= 1 ? 0.9 : 0.5 * parts.person);
    if (parts.walkers > 0 && inWorld) {
      worldWalkers().forEach((b, k) => {
        if (parts.walkers < 1 && tileOrder("walkers", Math.floor((b[0] + b[2]) / 2 / TILE), 0) > parts.walkers) return;
        box(b, WIRE_COL.walkers, k === 0 ? "Walker" : "", 0.9);
      });
    } else if (parts.walkers > 0) {
      const count = clamp(Math.round(s.walkers), 0, 5);
      for (let k = 0; k < count; k += 1) {
        const o = tileOrder("walkers", Math.floor(walkerAt(k, s, t).col / TILE), 0);
        if (parts.walkers < 1 && o > parts.walkers) continue;
        box(walkerBox(k, s, t), WIRE_COL.walkers, k === 0 ? "Walker" : "", 0.9);
      }
    }
  };

  /* the overlay: a selection marquee along the cell edges of the part, bright over a dark halo */
  const drawSelection = (ctx, s, t, parts, px1, P) => {
    const want = (z) => parts[PART_OF(z)] > 0;
    const path = new Path2D();
    const boatSeam = (a,b) => parts.sea>0 && CLS[a]===Z_SEA && CLS[b]===Z_SEA &&
      ((MAT[a]===M_BOAT)!==(MAT[b]===M_BOAT));
    // horizontal edges, merged into runs
    for (let y = 0; y <= GH; y += 1) {
      let run = -1;
      for (let x = 0; x <= GW; x += 1) {
        let edge = false;
        if (x < GW) {
          const a = y < GH && want(CLS[y * GW + x]);
          const b = y > 0 && want(CLS[(y - 1) * GW + x]);
          edge = y>0 && y<GH && (a!==b || boatSeam(y*GW+x,(y-1)*GW+x));
        }
        if (edge && run < 0) run = x;
        if (!edge && run >= 0) {
          path.moveTo(run * C, y * C);
          path.lineTo(x * C, y * C);
          run = -1;
        }
      }
    }
    for (let x = 1; x < GW; x += 1) {
      let run = -1;
      for (let y = 0; y <= GH; y += 1) {
        let edge = false;
        if (y < GH) edge = want(CLS[y*GW+x]) !== want(CLS[y*GW+x-1]) || boatSeam(y*GW+x,y*GW+x-1);
        if (edge && run < 0) run = y;
        if (!edge && run >= 0) {
          path.moveTo(x * C, run * C);
          path.lineTo(x * C, Math.min(H, y * C));
          run = -1;
        }
      }
    }
    ctx.save();
    ctx.lineJoin = "miter";
    ctx.strokeStyle = "rgba(4,6,18,0.32)";
    ctx.lineWidth = Math.max(px1 * 7, 3.2);
    ctx.stroke(path);
    ctx.strokeStyle = "rgba(4,6,18,0.62)";
    ctx.lineWidth = Math.max(px1 * 4, 1.8);
    ctx.stroke(path);
    ctx.lineWidth = Math.max(px1 * 2, 1);
    ctx.strokeStyle = "rgba(255,255,255,1)";
    ctx.stroke(path);
    ctx.setLineDash([3, 3]);
    ctx.lineDashOffset = -t * 6;
    ctx.strokeStyle = "rgba(255,196,64,1)";
    ctx.stroke(path);
    ctx.setLineDash([]);
    labels(ctx, s, t, parts, px1, P, true);
    ctx.restore();
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
    hello: state.hello === undefined || state.hello === null ? -1 : +state.hello,
  });

  let lastState = normalize({});

  const draw = (ctx, stateIn) => {
    ensureCanvas();
    const state = stateIn || {};
    const s = normalize(state);
    const view = ["seg", "depth", "normal", "wire"].includes(state.view) ? state.view : "rgb";
    const t = s.time;
    const L = lighting(s.hour, s.hoodie);
    const P = pose(s);
    lastState = s;
    const parts = state.parts || {};
    bgReady = false;
    const env = worldOf();
    const building = view === "wire" && state.overlay !== true && ((parts.person !== undefined && +parts.person < 1) || (parts.walkers !== undefined && +parts.walkers < 1));
    inWorld = false;
    if (env) {
      if (building && layWorld(env, Object.assign({}, state, { walkers: 0 }))) {
        BG_IDX.set(IDX);
        BG_CLS.set(CLS);
        BG_MAT.set(MAT);
        bgReady = true;
      }
      inWorld = layWorld(env, state);
      if (inWorld && view !== "wire" && view !== "seg") paintWorld(env, state, view);
    }
    if (!inWorld) {
      bgReady = false;
      if (building) {
        compose(s, L, t, true);
        BG_IDX.set(IDX);
        BG_CLS.set(CLS);
        BG_MAT.set(MAT);
        bgReady = true;
      }
      compose(s, L, t);
    }
    placeMe(L, P);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    if (view === "wire") drawWire(ctx, s, L, t, state.parts || {}, state.overlay === true, P);
    else if (view === "seg") drawSeg(ctx);
    else if (view === "depth") drawDepth(ctx, s);
    else if (view === "normal") drawNormal(ctx);
    else drawRgb(ctx);
    ctx.restore();
  };

  /* is cell (x, y) on him, in pose P? */
  const onMe = (P, x, y) => {
    const cx = Math.floor(x / C) - P.dx, cy = Math.floor(y / C);
    return cx >= 0 && cx < GW && cy >= 0 && cy < GH && P.cells[cy * GW + cx] !== 0;
  };
  const hit = (x, y) => onMe(pose(lastState), x, y);
  const pick = (x, y, state) => {
    if (!(x >= 0 && x <= W && y >= 0 && y <= H)) return null;
    const s = normalize(state || {});
    const t = s.time;
    if (onMe(pose(s), x, y)) return "person";
    const env = worldOf();
    if (env) return env.pick(x, y, state || {}) || "beach";
    const count = clamp(Math.round(s.walkers), 0, 5);
    for (let k = 0; k < count; k += 1) {
      const b = walkerBox(k, s, t);
      if (x > (b[0] - 3) * C && x < (b[2] + 3) * C && y > (b[1] - 3) * C && y < (b[3] + 2) * C) return "walkers";
    }
    const boat = boatAt(s,t);
    const bx = Math.floor(x/C)-boat.x, by = Math.floor(y/C)-boat.y;
    if (bx>=0 && by>=0 && bx<BOAT.w && by<BOAT.h && BOAT.px[by*BOAT.w+bx]) return "sea";
    const shNear = Math.round(-clamp(s.lean, -1, 1) * 2.4);
    const col = clamp(Math.floor(x / C), 0, GW - 1);
    if (y >= HZ * C && y < (waterRow(col - shNear, t, shoreBase(s)) + 1) * C) return "sea";
    return "beach";
  };

  window.BeachScene = { style: "pixel", W, H, draw, hit, pick };
})();
