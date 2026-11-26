/* The beach as a real 3D world, drawn with WebGL 2 and no library.
 *
 * The three renderers of the hero figure (ASCII, pixel, low-poly) each draw the person in
 * their own medium. The world behind him is this one scene: a terrain and a sea, a headland
 * with a lighthouse, a boat, people on the shore, clouds, the sun, the moon and the stars.
 * It is lit by the hour, toon shaded, mirrored in the water and the wet sand, and finished
 * with bloom and a colour grade. Because it is geometry, the camera can turn: the stage
 * passes yaw and pitch with the rest of the state.
 *
 * A renderer asks for the world in one of two ways:
 *   BeachEnv.canvas(state, pw, ph)   the picture, as a canvas to copy (low-poly)
 *   BeachEnv.pixels(state, gw, gh)   a small copy as RGBA bytes, rows top-down, to redraw
 *                                    cell by cell (pixel art, ASCII)
 * state.view selects the picture ("rgb"), a buffer ("normal", "depth", "seg"), the
 * construction lines ("wire") or, for the grid renderers, what each cell shows ("ids":
 * red = material, green = part). BeachEnv.pick(x, y, state) names the part at a point.
 * Without WebGL 2 this file registers nothing and each renderer paints its own flat backdrop. */
(() => {
  "use strict";

  const W = 480;
  const H = 400;
  const HORIZON = 178; // frame row of the horizon
  const F = 520; // focal length, frame units
  const CAMH = 9.4; // camera height above mean sea level, metres
  const SHORE0 = 45.26; // distance of the waterline at the photo's tide
  const PHOTO_TIDE = 0.4;
  const DUNE = 4.2; // nearer than this the dune is level
  const PIVOT = 1.9; // the camera turns about a point this far in front of it, where he stands
  const YAW_MAX = 1.05, PITCH_MIN = -0.1, PITCH_MAX = 0.3; // how far it may turn and tilt, radians
  const TAU = Math.PI * 2;

  /* ---------- small helpers ---------- */

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
  const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  const lin = (c) => c.map((v) => Math.pow(v, 2.2)); // display colour -> linear light
  const rand = (seed) => { // small seeded generator, the same world every time
    let s = seed >>> 0;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  };
  /* Catmull-Rom through a list of [x, y] keys, sampled at x. */
  const curve = (keys) => (x) => {
    const n = keys.length;
    if (x <= keys[0][0]) return keys[0][1];
    if (x >= keys[n - 1][0]) return keys[n - 1][1];
    let i = 0;
    while (i < n - 2 && x > keys[i + 1][0]) i += 1;
    const p0 = keys[Math.max(0, i - 1)], p1 = keys[i], p2 = keys[i + 1], p3 = keys[Math.min(n - 1, i + 2)];
    const t = (x - p1[0]) / (p2[0] - p1[0]);
    const m1 = ((p2[1] - p0[1]) / (p2[0] - p0[0])) * (p2[0] - p1[0]);
    const m2 = ((p3[1] - p1[1]) / (p3[0] - p1[0])) * (p2[0] - p1[0]);
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
  };
  /* A point on a Catmull-Rom spline through 3D points, u in 0..1. */
  const spline3 = (pts, u) => {
    const n = pts.length - 1;
    const f = clamp(u, 0, 1) * n;
    const i = Math.min(n - 1, Math.floor(f));
    const t = f - i;
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
    const t2 = t * t, t3 = t2 * t;
    const out = [0, 0, 0];
    for (let k = 0; k < 3; k += 1) {
      out[k] = 0.5 * (2 * p1[k] + (p2[k] - p0[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t3);
    }
    return out;
  };

  /* 4x4 matrices, column-major, as WebGL wants them. */
  const M = {
    ident: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    mul: (a, b) => {
      const o = new Array(16);
      for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
      return o;
    },
    translate: (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1],
    scale: (x, y, z) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1],
    rotX: (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; },
    rotY: (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; },
    rotZ: (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; },
    chain: (...ms) => ms.reduce((a, b) => M.mul(a, b)),
    point: (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]],
    dir: (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2], m[1] * p[0] + m[5] * p[1] + m[9] * p[2], m[2] * p[0] + m[6] * p[1] + m[10] * p[2]],
    /* A pinhole camera looking down -z whose principal point sits at frame (cx, cy). */
    lens: (f, cx, cy, near, far) => [
      f / (W / 2), 0, 0, 0,
      0, f / (H / 2), 0, 0,
      -(cx - W / 2) / (W / 2), (cy - H / 2) / (H / 2), (far + near) / (near - far), -1,
      0, 0, (2 * far * near) / (near - far), 0,
    ],
  };

  /* ---------- the light of the hour ---------- */

  const c255 = (r, g, b) => [r / 255, g / 255, b / 255];
  /* Sky from zenith to horizon, the light and its colour on things, the sea, the sand, the clouds. */
  const PAL = {
    night: {
      top: c255(7, 12, 34), mid: c255(15, 26, 62), hor: c255(40, 58, 104), glow: c255(120, 146, 220), glowA: 0.22,
      key: c255(128, 156, 232), keyI: 0.5, amb: c255(52, 70, 138), ambI: 0.62, rim: c255(150, 180, 255), rimI: 0.55,
      deep: c255(6, 16, 44), near: c255(12, 34, 70), shal: c255(30, 72, 108), sand: c255(64, 70, 104), wet: c255(34, 42, 76),
      cloudLit: c255(74, 92, 148), cloudMid: c255(40, 52, 98), cloudShade: c255(20, 28, 62), sunC: c255(255, 250, 235),
      stars: 1, bloom: 1.15, expo: 1.0, sat: 1.05, bio: 1, haze: c255(26, 38, 80),
    },
    dawn: {
      top: c255(66, 100, 178), mid: c255(190, 160, 196), hor: c255(255, 198, 160), glow: c255(255, 190, 140), glowA: 0.6,
      key: c255(255, 200, 164), keyI: 0.92, amb: c255(168, 160, 210), ambI: 0.6, rim: c255(255, 206, 160), rimI: 0.9,
      deep: c255(40, 66, 126), near: c255(78, 106, 160), shal: c255(170, 172, 196), sand: c255(214, 180, 168), wet: c255(150, 126, 142),
      cloudLit: c255(255, 216, 188), cloudMid: c255(216, 160, 176), cloudShade: c255(128, 116, 170), sunC: c255(255, 232, 190),
      stars: 0.12, bloom: 1.0, expo: 1.0, sat: 1.06, bio: 0.1, haze: c255(212, 172, 186),
    },
    day: {
      top: c255(44, 118, 208), mid: c255(108, 178, 232), hor: c255(206, 232, 240), glow: c255(255, 252, 236), glowA: 0.3,
      key: c255(255, 248, 234), keyI: 1.0, amb: c255(150, 188, 240), ambI: 0.52, rim: c255(255, 252, 240), rimI: 0.75,
      deep: c255(16, 82, 152), near: c255(22, 142, 178), shal: c255(112, 214, 204), sand: c255(246, 228, 190), wet: c255(196, 166, 128),
      cloudLit: c255(255, 255, 252), cloudMid: c255(214, 232, 246), cloudShade: c255(150, 186, 224), sunC: c255(255, 252, 240),
      stars: 0, bloom: 0.8, expo: 1.0, sat: 1.08, bio: 0, haze: c255(176, 214, 236),
    },
    golden: {
      top: c255(72, 122, 200), mid: c255(190, 190, 204), hor: c255(255, 218, 164), glow: c255(255, 208, 140), glowA: 0.7,
      key: c255(255, 212, 150), keyI: 1.0, amb: c255(182, 174, 206), ambI: 0.52, rim: c255(255, 214, 140), rimI: 1.05,
      deep: c255(34, 76, 140), near: c255(64, 112, 160), shal: c255(180, 182, 170), sand: c255(240, 200, 150), wet: c255(176, 140, 120),
      cloudLit: c255(255, 234, 190), cloudMid: c255(232, 186, 170), cloudShade: c255(150, 138, 176), sunC: c255(255, 238, 180),
      stars: 0, bloom: 1.0, expo: 1.0, sat: 1.08, bio: 0, haze: c255(226, 200, 180),
    },
    sunset: {
      top: c255(50, 66, 146), mid: c255(204, 124, 140), hor: c255(255, 166, 100), glow: c255(255, 156, 92), glowA: 0.95,
      key: c255(255, 160, 104), keyI: 0.9, amb: c255(150, 122, 180), ambI: 0.56, rim: c255(255, 170, 96), rimI: 1.25,
      deep: c255(40, 46, 108), near: c255(92, 80, 130), shal: c255(206, 146, 136), sand: c255(204, 146, 124), wet: c255(140, 96, 110),
      cloudLit: c255(255, 184, 122), cloudMid: c255(214, 120, 126), cloudShade: c255(104, 84, 144), sunC: c255(255, 226, 170),
      stars: 0.04, bloom: 1.25, expo: 1.0, sat: 1.1, bio: 0, haze: c255(216, 140, 136),
    },
    dusk: {
      top: c255(22, 30, 82), mid: c255(80, 70, 130), hor: c255(196, 118, 118), glow: c255(226, 138, 130), glowA: 0.5,
      key: c255(200, 150, 180), keyI: 0.42, amb: c255(110, 104, 172), ambI: 0.62, rim: c255(226, 150, 150), rimI: 0.7,
      deep: c255(18, 26, 66), near: c255(40, 46, 92), shal: c255(98, 88, 120), sand: c255(110, 92, 118), wet: c255(64, 56, 92),
      cloudLit: c255(206, 134, 144), cloudMid: c255(110, 84, 132), cloudShade: c255(44, 44, 96), sunC: c255(255, 210, 170),
      stars: 0.35, bloom: 1.15, expo: 1.0, sat: 1.06, bio: 0.45, haze: c255(104, 84, 128),
    },
  };
  const TIMELINE = [[0, "night"], [4.9, "night"], [6.3, "dawn"], [8.8, "day"], [15, "day"], [16.9, "golden"], [17.7, "sunset"], [18.5, "dusk"], [19.7, "night"], [24, "night"]];
  const PAL_KEYS = Object.keys(PAL.day);
  /* High daylight, [hour, azimuth to the right of the camera, elevation]. */
  const HIGH_SUN = [[7.3, 26, 13], [9, 70, 35], [11, 140, 55], [13.2, 211, 59], [15, 268, 42], [16.2, 318, 20]];
  const track = (keys, h) => {
    if (h <= keys[0][0]) return [keys[0][1], keys[0][2]];
    for (let i = 0; i < keys.length - 1; i += 1) {
      const a = keys[i], b = keys[i + 1];
      if (h <= b[0]) { const f = (h - a[0]) / (b[0] - a[0]); return [mix(a[1], b[1], f), mix(a[2], b[2], f)]; }
    }
    const z = keys[keys.length - 1];
    return [z[1], z[2]];
  };
  const dirOf = (az, el) => {
    const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
    return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
  };
  // The sun and the moon cross the frame from right to left, as in the other renderers.
  const skyRay = (phase, height) => norm3([(W * (0.96 - 0.86 * phase) - W / 2) / F, (height * Math.sin(Math.PI * phase)) / F, -1]);

  const LCACHE = new Map();
  const lighting = (hourIn) => {
    const hour = ((hourIn % 24) + 24) % 24;
    const ck = Math.round(hour * 400);
    if (LCACHE.has(ck)) return LCACHE.get(ck);
    let i = 0;
    while (i < TIMELINE.length - 2 && hour >= TIMELINE[i + 1][0]) i += 1;
    const A = PAL[TIMELINE[i][1]], B = PAL[TIMELINE[i + 1][1]];
    const f = smooth(TIMELINE[i][0], TIMELINE[i + 1][0], hour);
    const L = { hour };
    for (const k of PAL_KEYS) L[k] = Array.isArray(A[k]) ? mix3(A[k], B[k], f) : mix(A[k], B[k], f);
    const dayPhase = (hour - 6) / 12;
    const nightPhase = (hour < 6 ? hour + 6 : hour - 18) / 12;
    const altitude = Math.sin(Math.PI * dayPhase);
    // Once the disc is above the frame, the high sun moves over the beach and lights his face.
    const overhead = smooth(0.62, 0.93, altitude);
    L.sunDir = norm3(mix3(skyRay(dayPhase, 330), dirOf(...track(HIGH_SUN, hour)), overhead));
    L.moonDir = skyRay(nightPhase, 152);
    L.sunEl = (Math.asin(L.sunDir[1]) * 180) / Math.PI;
    L.sunUp = smooth(-0.07, 0.03, altitude);
    L.moonUp = nightPhase > -0.05 && nightPhase < 1.05 ? smooth(-0.05, 0.08, Math.sin(Math.PI * nightPhase)) * (1 - smooth(-0.1, 0.24, altitude)) : 0;
    const wSun = smooth(-6, 0, L.sunEl);
    const kd = mix3(L.moonDir, L.sunDir, wSun);
    kd[1] = Math.max(kd[1], 0.07);
    L.keyDir = norm3(kd); // the light on the world
    L.glowDir = L.sunEl > -8 ? L.sunDir : L.moonDir;
    // He is lit by the same light, turned toward the camera so that his face stays readable;
    // the true direction of the light is kept for the rim.
    const k2 = L.keyDir;
    L.bustDir = norm3([k2[0] * 0.9 + 0.18, Math.max(k2[1], 0.3) + 0.15, (k2[2] >= 0.4 ? k2[2] : 0.4 + (k2[2] - 0.4) * 0.1) + 0.5]);
    L.night = 1 - smooth(-9, 3, L.sunEl); // how much of the artificial light is on
    L.keyC = mul3(L.key, L.keyI);
    L.ambC = mul3(L.amb, L.ambI);
    LCACHE.set(ck, L);
    if (LCACHE.size > 600) LCACHE.delete(LCACHE.keys().next().value);
    return L;
  };

  /* ---------- the lie of the land ---------- */

  /* Height of the sand at distance d from the camera (metres toward the sea) and x along the
     shore. A long flat foreshore that the tide runs over, then the dune he stands on. The
     same function is written again in GLSL below. */
  const sandH = (dIn, x) => {
    const d = 0.5 * (dIn + DUNE + Math.sqrt((dIn - DUNE) * (dIn - DUNE) + 1)); // the dune levels off under the camera and behind it
    const k = Math.max(30 - d, 0);
    const cusp = 0.045 * Math.sin(x * 0.17 + 1.3 + 0.5 * Math.sin(x * 0.045)) * smooth(18, 34, d) * smooth(75, 55, d);
    return 0.02 * (SHORE0 - d) + 0.01023 * k * k + cusp;
  };
  /* The frame row at which a point on the ground at distance d appears, and its inverse. */
  const rowOf = (d, h) => HORIZON + (F * (CAMH - h)) / d;
  const groundAtRow = (row) => { // distance of the sand seen at a frame row (x = 0)
    let lo = 3, hi = 400;
    for (let i = 0; i < 40; i += 1) {
      const m = (lo + hi) / 2;
      if (rowOf(m, sandH(m, 0)) > row) lo = m; else hi = m;
    }
    return (lo + hi) / 2;
  };
  /* The other renderers put the waterline at row 286 + (tide - 0.4) * 62. Find the sea level that does the same here. */
  const seaOfTide = (tide) => {
    const d = groundAtRow(286 + (clamp(tide, 0, 1) - PHOTO_TIDE) * 62);
    return { level: sandH(d, 0), d };
  };

  /* ---------- WebGL: one context, kept for the life of the page ---------- */

  const glCanvas = document.createElement("canvas");
  const gl = glCanvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  if (!gl) return; // without WebGL 2 nothing registers, and each renderer paints its own backdrop

  const R = { ready: false, lost: false }; // everything that lives on the GPU

  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      const log = gl.getShaderInfoLog(shader) || "";
      const lines = source.split("\n");
      const where = /ERROR: \d+:(\d+)/.exec(log);
      throw new Error(`env: shader did not compile: ${log.trim()}${where ? `\n> ${lines[Number(where[1]) - 1]}` : ""}`);
    }
    return shader;
  };
  /* A program with its uniform locations looked up once. Attribute slots are fixed by name. */
  const ATTR = { aPos: 0, aNor: 1, aCol: 2, aAux: 3, aKind: 4, aOther: 5, aSide: 6 };
  const program = (vs, fs) => {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, "#version 300 es\nprecision highp float;\n" + vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, "#version 300 es\nprecision highp float;\nprecision highp sampler2D;\n" + fs));
    for (const [name, slot] of Object.entries(ATTR)) gl.bindAttribLocation(p, slot, name);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error("env: program did not link: " + gl.getProgramInfoLog(p));
    const u = {};
    const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) || 0;
    for (let i = 0; i < count; i += 1) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, "");
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u };
  };
  /* Set uniforms by name from a plain object; the kind is taken from the value. */
  const setUniforms = (prog, values) => {
    for (const name in values) {
      const loc = prog.u[name];
      if (loc === undefined || loc === null) continue;
      const v = values[name];
      if (typeof v === "number") gl.uniform1f(loc, v);
      else if (v.tex !== undefined) gl.uniform1i(loc, v.tex);
      else if (v.int !== undefined) gl.uniform1i(loc, v.int);
      else if (v.length === 2) gl.uniform2fv(loc, v);
      else if (v.length === 3) gl.uniform3fv(loc, v);
      else if (v.length === 4) gl.uniform4fv(loc, v);
      else if (v.length === 16) gl.uniformMatrix4fv(loc, false, v);
      else gl.uniform4fv(loc, v); // arrays of vec4
    }
  };

  const texture = (w, h, { data = null, filter = gl.LINEAR, wrap = gl.CLAMP_TO_EDGE, mip = false, format = gl.RGBA8 } = {}) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, format, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    if (mip && data) gl.generateMipmap(gl.TEXTURE_2D);
    return t;
  };
  /* A texture to render into, optionally with depth. */
  const target = (w, h, { depth = false, filter = gl.LINEAR, wrap = gl.CLAMP_TO_EDGE } = {}) => {
    const fb = gl.createFramebuffer();
    const tex = texture(w, h, { filter, wrap });
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    let rb = null;
    if (depth) {
      rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    }
    return { fb, tex, rb, w, h };
  };
  /* The multisampled buffer the picture is drawn into, with depth and stencil. */
  const msaaTarget = (w, h, samples) => {
    const fb = gl.createFramebuffer();
    const color = gl.createRenderbuffer();
    const ds = gl.createRenderbuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.bindRenderbuffer(gl.RENDERBUFFER, color);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
    gl.bindRenderbuffer(gl.RENDERBUFFER, ds);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH24_STENCIL8, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, ds);
    return { fb, color, ds, w, h };
  };
  const freeTarget = (t) => {
    if (!t) return;
    gl.deleteFramebuffer(t.fb);
    if (t.tex) gl.deleteTexture(t.tex);
    if (t.rb) gl.deleteRenderbuffer(t.rb);
    if (t.color) gl.deleteRenderbuffer(t.color);
    if (t.ds) gl.deleteRenderbuffer(t.ds);
  };
  const bindTex = (unit, tex) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); };

  /* ---------- geometry ---------- */

  /* Material kinds, carried per vertex so that one shader can draw a whole figure. */
  const K = { plain: 0, skin: 1, hair: 2, cloth: 3, glow: 4, leaf: 5, face: 6 };

  /* A mesh under construction. Every vertex has a position, a colour, an occlusion (how far it
     sits in shadow whatever the light), and four spare numbers: sway weight, sway phase, u, v. */
  class Geo {
    constructor() { this.p = []; this.c = []; this.a = []; this.k = []; this.i = []; this.e = []; this.n = null; this.hard = []; }
    get count() { return this.p.length / 3; }
    vert(pos, col, occ = 0, aux = [0, 0, 0, 0], kind = 0) {
      this.p.push(pos[0], pos[1], pos[2]);
      this.c.push(col[0], col[1], col[2], occ);
      this.a.push(aux[0], aux[1], aux[2], aux[3]);
      this.k.push(kind);
      return this.count - 1;
    }
    tri(a, b, c) { this.i.push(a, b, c); }
    quad(a, b, c, d, edges = true) { // counter-clockwise seen from outside
      this.i.push(a, b, c, a, c, d);
      if (edges) this.e.push(a, b, b, c, c, d, d, a);
    }
    edge(a, b) { this.e.push(a, b); }
    /* A lattice of nu x nv points from fn(u, v) -> { p, c, occ, aux, kind }; u wraps when closed. */
    grid(nu, nv, fn, { closed = false, flip = false, kind = 0 } = {}) {
      const base = this.count;
      const cols = closed ? nu : nu + 1;
      for (let j = 0; j <= nv; j += 1) {
        for (let i = 0; i < cols; i += 1) {
          const s = fn(i / nu, j / nv, i, j);
          this.vert(s.p, s.c, s.occ || 0, s.aux || [0, 0, 0, 0], s.kind === undefined ? kind : s.kind);
        }
      }
      const at = (i, j) => base + j * cols + (closed ? i % nu : i);
      for (let j = 0; j < nv; j += 1) {
        for (let i = 0; i < nu; i += 1) {
          const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
          if (flip) this.quad(a, d, c, b); else this.quad(a, b, c, d);
        }
      }
      return base;
    }
    /* Smooth normals: each vertex takes the area-weighted normals of its triangles. Vertices
       that coincide (the poles of a loft, a seam) are welded first so no crease shows. */
    normals() {
      const n = new Float32Array(this.p.length);
      const p = this.p;
      const key = new Map();
      const rep = new Int32Array(this.count);
      for (let v = 0; v < this.count; v += 1) {
        const id = `${Math.round(p[v * 3] * 2e4)},${Math.round(p[v * 3 + 1] * 2e4)},${Math.round(p[v * 3 + 2] * 2e4)},${this.hard[v] || 0}`;
        if (!key.has(id)) key.set(id, v);
        rep[v] = key.get(id);
      }
      for (let t = 0; t < this.i.length; t += 3) {
        const a = this.i[t], b = this.i[t + 1], c = this.i[t + 2];
        const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
        const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const v of [rep[a], rep[b], rep[c]]) { n[v * 3] += nx; n[v * 3 + 1] += ny; n[v * 3 + 2] += nz; }
      }
      for (let v = 0; v < this.count; v += 1) {
        const r = rep[v];
        const l = Math.hypot(n[r * 3], n[r * 3 + 1], n[r * 3 + 2]) || 1;
        if (r === v) { n[v * 3] /= l; n[v * 3 + 1] /= l; n[v * 3 + 2] /= l; }
      }
      for (let v = 0; v < this.count; v += 1) {
        const r = rep[v];
        if (r !== v) { n[v * 3] = n[r * 3]; n[v * 3 + 1] = n[r * 3 + 1]; n[v * 3 + 2] = n[r * 3 + 2]; }
      }
      this.n = n;
      return this;
    }
    /* Flat shading: every triangle gets its own three vertices. */
    faceted() {
      const g = new Geo();
      for (let t = 0; t < this.i.length; t += 3) {
        const ids = [0, 1, 2].map((k) => {
          const v = this.i[t + k];
          return g.vert([this.p[v * 3], this.p[v * 3 + 1], this.p[v * 3 + 2]], [this.c[v * 4], this.c[v * 4 + 1], this.c[v * 4 + 2]], this.c[v * 4 + 3], this.a.slice(v * 4, v * 4 + 4), this.k[v]);
        });
        g.tri(ids[0], ids[1], ids[2]);
        g.e.push(ids[0], ids[1], ids[1], ids[2], ids[2], ids[0]);
      }
      g.hard = Array.from({ length: g.count }, (_, v) => Math.floor(v / 3) + 1);
      return g;
    }
    /* Move every vertex by a matrix (before normals are computed). */
    apply(m) {
      for (let v = 0; v < this.count; v += 1) {
        const q = M.point(m, [this.p[v * 3], this.p[v * 3 + 1], this.p[v * 3 + 2]]);
        this.p[v * 3] = q[0]; this.p[v * 3 + 1] = q[1]; this.p[v * 3 + 2] = q[2];
      }
      return this;
    }
    add(other) {
      const base = this.count;
      for (const x of other.p) this.p.push(x);
      for (const x of other.c) this.c.push(x);
      for (const x of other.a) this.a.push(x);
      for (const x of other.k) this.k.push(x);
      for (const x of other.i) this.i.push(x + base);
      for (const x of other.e) this.e.push(x + base);
      if (other.hard.length) for (let v = 0; v < other.count; v += 1) this.hard[base + v] = other.hard[v] ? other.hard[v] + base : 0;
      return this;
    }
  }

  /* Make the triangles added since index i0 face outward (positive volume about their centre). */
  const outward = (g, i0) => {
    let cx = 0, cy = 0, cz = 0, n = 0;
    for (let t = i0; t < g.i.length; t += 1) { const v = g.i[t]; cx += g.p[v * 3]; cy += g.p[v * 3 + 1]; cz += g.p[v * 3 + 2]; n += 1; }
    if (!n) return;
    cx /= n; cy /= n; cz /= n;
    let vol = 0;
    for (let t = i0; t < g.i.length; t += 3) {
      const [a, b, c] = [g.i[t], g.i[t + 1], g.i[t + 2]].map((v) => [g.p[v * 3] - cx, g.p[v * 3 + 1] - cy, g.p[v * 3 + 2] - cz]);
      vol += dot3(a, cross(b, c));
    }
    if (vol < 0) for (let t = i0; t < g.i.length; t += 3) { const k = g.i[t + 1]; g.i[t + 1] = g.i[t + 2]; g.i[t + 2] = k; }
  };

  /* A surface of revolution-like loft: rings(v) -> { c: [x, y, z] centre, rx, rz, tilt?, n? (superellipse power) },
     with colour from col(u, v). Closed around, optionally capped. */
  const loft = (g, nu, nv, ring, col, opts = {}) => {
    const { kind = 0, occ = () => 0, aux = () => [0, 0, 0, 0], frame = null } = opts;
    const i0 = g.i.length;
    const base = g.grid(nu, nv, (u, v) => {
      const r = ring(v);
      const a = u * TAU;
      const pw = 2 / (r.n || 2);
      const cs = Math.cos(a), sn = Math.sin(a);
      const lx = Math.sign(sn) * Math.pow(Math.abs(sn), pw) * r.rx;
      const lz = Math.sign(cs) * Math.pow(Math.abs(cs), pw) * (cs >= 0 ? r.rz : r.rzb === undefined ? r.rz : r.rzb);
      let p;
      if (frame) { const fr = frame(v); p = add3(add3(r.c, mul3(fr.x, lx)), mul3(fr.z, lz)); }
      else p = [r.c[0] + lx, r.c[1], r.c[2] + lz];
      return { p, c: col(u, v, p), occ: occ(u, v, p), aux: aux(u, v, p) };
    }, { closed: true, kind });
    outward(g, i0);
    return base;
  };

  /* A tube along a path: at(t) -> point, radius(t) -> [across, thick] or number. The cross
     section keeps a steady orientation given by `up` (it does not twist). Ends close to a point. */
  const tube = (g, nt, nr, at, radius, col, opts = {}) => {
    const { kind = 0, occ = () => 0, aux = () => [0, 0, 0, 0], up = [0, 1, 0], capStart = true, capEnd = true, facing = null } = opts;
    const i0 = g.i.length;
    const pts = [], tans = [];
    for (let j = 0; j <= nt; j += 1) pts.push(at(j / nt));
    for (let j = 0; j <= nt; j += 1) tans.push(norm3(sub3(pts[Math.min(nt, j + 1)], pts[Math.max(0, j - 1)])));
    const base = g.grid(nr, nt, (u, v, i, j) => {
      const t = tans[j];
      const ref = facing ? facing(pts[j], v) : up;
      let side = cross(t, ref);
      if (Math.hypot(...side) < 1e-4) side = cross(t, [1, 0, 0]);
      side = norm3(side);
      const nrm = norm3(cross(side, t));
      let r = radius(v);
      if (typeof r === "number") r = [r, r];
      const shut = (capStart && j === 0) || (capEnd && j === nt) ? 0 : 1;
      const a = u * TAU;
      const p = add3(pts[j], add3(mul3(side, Math.cos(a) * r[0] * shut), mul3(nrm, Math.sin(a) * r[1] * shut)));
      return { p, c: col(u, v, p), occ: occ(u, v, p), aux: aux(u, v, p) };
    }, { closed: true, kind });
    outward(g, i0);
    return base;
  };

  const ball = (g, c, r, col, { nu = 12, nv = 8, kind = 0, occ = 0, aux = [0, 0, 0, 0] } = {}) => {
    const rr = typeof r === "number" ? [r, r, r] : r;
    const i0 = g.i.length;
    const base = g.grid(nu, nv, (u, v) => {
      const a = u * TAU, b = v * Math.PI;
      return { p: [c[0] + Math.sin(a) * Math.sin(b) * rr[0], c[1] + Math.cos(b) * rr[1], c[2] + Math.cos(a) * Math.sin(b) * rr[2]], c: col, occ, aux };
    }, { closed: true, kind });
    outward(g, i0);
    return base;
  };

  const box = (g, c, s, col, { kind = 0, occ = 0 } = {}) => {
    const b = new Geo();
    const [x, y, z] = s.map((v) => v / 2);
    const P = [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z], [-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z]];
    const faces = [[0, 1, 2, 3], [1, 5, 6, 2], [5, 4, 7, 6], [4, 0, 3, 7], [3, 2, 6, 7], [4, 5, 1, 0]];
    faces.forEach((f, fi) => {
      const ids = f.map((k) => b.vert(add3(c, P[k]), col, occ, [0, 0, 0, 0], kind));
      ids.forEach((id) => { b.hard[id] = fi + 1; });
      b.quad(ids[0], ids[1], ids[2], ids[3]);
    });
    return g.add(b);
  };

  /* Upload a finished mesh: triangles, and its construction lines as thick line quads. */
  const upload = (g) => {
    if (!g.n) g.normals();
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = (slot, data, size) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data instanceof Float32Array ? data : new Float32Array(data), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(slot);
      gl.vertexAttribPointer(slot, size, gl.FLOAT, false, 0, 0);
      return b;
    };
    buf(ATTR.aPos, g.p, 3);
    buf(ATTR.aNor, g.n, 3);
    buf(ATTR.aCol, g.c, 4);
    buf(ATTR.aAux, g.a, 4);
    buf(ATTR.aKind, g.k, 1);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    const big = g.count > 65535;
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, big ? new Uint32Array(g.i) : new Uint16Array(g.i), gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    // lines: each unique edge becomes a quad that the vertex shader widens on screen
    const seen = new Set();
    const lp = [], lo = [], ls = [], la = [], lix = [];
    const total = g.e.length / 2;
    for (let k = 0; k < g.e.length; k += 2) {
      const a = g.e[k], b = g.e[k + 1];
      const id = a < b ? a * 1e6 + b : b * 1e6 + a;
      if (seen.has(id)) continue;
      seen.add(id);
      const base = lp.length / 3;
      const order = k / 2 / Math.max(1, total);
      for (const [from, to, end] of [[a, b, 0], [a, b, 0], [b, a, 1], [b, a, 1]]) {
        lp.push(g.p[from * 3], g.p[from * 3 + 1], g.p[from * 3 + 2]);
        lo.push(g.p[to * 3], g.p[to * 3 + 1], g.p[to * 3 + 2]);
        la.push(g.a[from * 4], g.a[from * 4 + 1], order, end);
      }
      ls.push(1, -1, -1, 1);
      lix.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
    const lvao = gl.createVertexArray();
    gl.bindVertexArray(lvao);
    buf(ATTR.aPos, lp, 3);
    buf(ATTR.aOther, lo, 3);
    buf(ATTR.aAux, la, 4);
    buf(ATTR.aSide, ls, 1);
    const lib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lib);
    const lbig = lp.length / 3 > 65535;
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, lbig ? new Uint32Array(lix) : new Uint16Array(lix), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, n: g.i.length, type: big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, lvao, ln: lix.length, ltype: lbig ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
  };
  const drawMesh = (m) => { gl.bindVertexArray(m.vao); gl.drawElements(gl.TRIANGLES, m.n, m.type, 0); };
  const drawLines = (m) => { gl.bindVertexArray(m.lvao); gl.drawElements(gl.TRIANGLES, m.ln, m.ltype, 0); };

  /* ---------- shaders ---------- */

  const CLOUD_U = 2.8; // width of the cloud sheet in radians of azimuth (it wraps), and its height
  const CLOUD_V = 0.42;
  const SUN_R = 11 / F;
  const MOON_R = 12.5 / F;

  const GLSL_NOISE = `
    uniform sampler2D uNoise;
    uniform float uTime;
    vec4 n4(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3. - 2.*f); return texture(uNoise, (i + f + .5)/256.); }
    float n2(vec2 p){ return n4(p).r; }
    float fbm(vec2 p){ return n2(p)*.5 + n2(p*2.07 + 13.1)*.25 + n2(p*4.3 + 71.7)*.125 + n2(p*8.9 + 5.3)*.0625; }
  `;

  /* The sky as a function of direction, shared by the sky itself and by everything that mirrors it. */
  const GLSL_SKY = `
    uniform vec3 uTop, uMid, uHor, uGlowCol, uSunDir, uMoonDir, uGlowDir, uSunCol, uCloudLit, uCloudMid, uCloudShade;
    uniform float uGlowA, uSunUp, uMoonUp, uStars, uCloudOff, uHigh;
    uniform vec2 uLightUV;
    uniform sampler2D uCloud;
    vec3 skyGradient(vec3 d){
      float e = clamp(d.y, 0., 1.);
      vec3 c = mix(uHor, uMid, smoothstep(0., .2, e));
      c = mix(c, uTop, smoothstep(.1, .62, e));
      float g = max(dot(d, uGlowDir), 0.);
      c += uGlowCol * uGlowA * (.2*pow(g, 6.) + .3*pow(g, 48.));
      vec2 a = normalize(d.xz + 1e-5), b = normalize(uGlowDir.xz + 1e-5);
      c += uGlowCol * uGlowA * .42 * exp(-e*11.) * pow(max(dot(a, b), 0.), 4.) * (1. - uHigh);
      return c;
    }
    vec2 skyUV(vec3 d){ return vec2(atan(d.x, -d.z), d.y / max(length(d.xz), 1e-3)); }   // azimuth, and height above the horizon
    /* One look-up of the cloud sheet: colour and cover. Lit by comparing the thickness here with
       the thickness a step toward the light, which gives every billow its own bright side. */
    vec4 cloudAt(vec2 p, float lod, vec3 d){
      vec2 tc = vec2((p.x + uCloudOff) / ${CLOUD_U.toFixed(3)} + .5, p.y / ${CLOUD_V.toFixed(3)});
      if (tc.y <= 0.004 || tc.y >= .996) return vec4(0.);
      vec4 t = textureLod(uCloud, tc, lod);
      float a = smoothstep(.5 - .013 - lod*.02, .5 + .013 + lod*.02, t.r);
      if (a <= 0.) return vec4(0.);
      vec2 L = uLightUV - p; L /= max(length(L), 1e-4);
      vec2 st = vec2(1./${CLOUD_U.toFixed(3)}, 1./${CLOUD_V.toFixed(3)});
      float d1 = textureLod(uCloud, tc + L*.009*st, lod).r;
      float d2 = textureLod(uCloud, tc + L*.03*st, lod + 1.).r;
      float a2 = textureLod(uCloud, tc + L*.055*st, lod + 2.).a;
      float away = smoothstep(.05, .26, length(uLightUV - p));          // a cloud across the light is lit from behind
      float lit = .5 + ((t.r - d1)*1.4 + (t.r - d2)*1.2 + (t.a - a2)*4.4*(1. - uHigh*.5))*away + (t.b - .42)*.5*uHigh + (t.g - .5)*.03 - (1. - away)*.06;
      float t1 = smoothstep(.37, .42, lit), t2 = smoothstep(.57, .63, lit);
      vec3 col = mix(uCloudShade, uCloudMid, t1);
      col = mix(col, uCloudLit, t2);
      col = mix(col, uCloudShade, (1. - t.b)*.3*(1. - t2));
      float nearSun = pow(max(dot(d, uGlowDir), 0.), 12.);
      float rim = 1. - smoothstep(.5, .78, t.r);
      col += uSunCol * rim * nearSun * .9 * (1. - uHigh*.6);
      col = mix(col, uCloudLit, (1. - away) * smoothstep(.7, .5, t.r) * .5);
      col = mix(col, uHor, exp(-max(p.y, 0.)*16.)*.55);
      return vec4(col, a * smoothstep(0., .035, p.y));
    }
  `;

  /* The sand and the sea are one surface. Where the sea level is above the sand there is water. */
  const GLSL_LAND = `
    uniform float uSea, uSwashA, uSwell;
    float sandH(float dIn, float x){
      float d = .5*(dIn + ${DUNE.toFixed(2)} + sqrt((dIn - ${DUNE.toFixed(2)})*(dIn - ${DUNE.toFixed(2)}) + 1.));
      float k = max(30. - d, 0.);
      float cusp = .045*sin(x*.17 + 1.3 + .5*sin(x*.045)) * smoothstep(18., 34., d) * (1. - smoothstep(55., 75., d));
      return .02*(${SHORE0.toFixed(2)} - d) + .01023*k*k + cusp;
    }
    float swash(float x, float t){ return .5 + .5*sin(t*.7 + .7*sin(x*.09 + t*.11) + .35*sin(x*.27 - t*.17)); }
    float seaLevel(float x, float t){ return uSea + uSwashA * swash(x, t); }
  `;

  const VS_SCREEN = `
    out vec2 vUV;
    void main(){ vec2 p = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.; vUV = p; gl_Position = vec4(p*2. - 1., 0., 1.); }
  `;

  const FS_SKY = `
    in vec2 vUV; out vec4 o;
    uniform int uMode;
    uniform vec2 uShift;
    uniform vec3 uSeg, uCamX, uCamY, uCamZ;
    ${GLSL_NOISE} ${GLSL_SKY}
    vec3 stars(vec2 p){
      vec2 g = p*64.; vec2 id = floor(g); vec2 f = fract(g) - .5;
      vec4 h = texture(uNoise, (id + .5)/256.);
      float b = pow(h.z, 7.);
      float tw = .7 + .3*sin(uTime*(1.2 + h.w*2.6) + h.w*40.);
      float s = smoothstep(.05 + .09*b, 0., length(f - (h.xy - .5)*.7)) * (b*1.5 + .1*step(.55, h.z)) * tw;
      return s * mix(vec3(.72, .84, 1.), vec3(1., .9, .76), h.w);
    }
    void main(){
      vec2 fr = vec2(vUV.x*${W}., (1. - vUV.y)*${H}.);
      vec3 l = vec3((fr.x - ${W / 2}. + uShift.x)/${F}., (${HORIZON}. - fr.y)/${F}., -1.);
      vec3 d = normalize(uCamX*l.x + uCamY*l.y + uCamZ*l.z);
      if (uMode == 1) { o = vec4(.086, .102, .172, 1.); return; }
      if (uMode == 2) { o = vec4(0., 0., 0., 1.); return; }
      if (uMode == 3) { o = vec4(uSeg, 1.); return; }
      vec3 col = skyGradient(d);
      float mask = 0.;
      vec2 p = skyUV(d);
      // the milky way and the stars
      float band = smoothstep(.55, 0., abs(p.y*1.2 - p.x*.55 - .12)) ;
      col += uStars * band * vec3(.05, .07, .13) * (.5 + fbm(p*9. + 3.));
      float dim = 1. - smoothstep(.25, .6, dot(col, vec3(.3, .55, .15)));
      vec3 st = stars(p) * uStars * smoothstep(.01, .1, d.y) * dim;
      col += st * (1. + band);
      mask += length(st) * .25;
      // the moon
      {
        vec3 m = uMoonDir; vec3 rx = normalize(cross(vec3(0., 1., 0.), m)); vec3 ry = cross(m, rx);
        vec2 q = vec2(dot(d, rx), dot(d, ry)) / ${MOON_R.toFixed(5)};
        float r = length(q);
        float disc = smoothstep(1.03, .96, r) * uMoonUp;
        float sea = smoothstep(.46, .6, n2(q*1.9 + 7.3)*.62 + n2(q*4.6 + 3.1)*.38);
        vec3 nrm = vec3(q, sqrt(max(1. - r*r, 0.)));
        float ph = smoothstep(-.3, .1, dot(nrm, normalize(vec3(.62, .28, .55))));
        vec3 mc = mix(vec3(.97, .96, .88), vec3(.74, .79, .84), sea*.85) * (.86 + .14*nrm.z);
        mc = mix(vec3(.13, .18, .36), mc, ph);
        float halo = (exp(-max(r - 1., 0.)*1.5)*.34 + exp(-max(r - 1., 0.)*.3)*.13) * uMoonUp;
        col += vec3(.55, .66, 1.) * halo * (1. - disc);
        col = mix(col, mc, disc);
        mask = max(mask, disc * ph * .55);
      }
      // the sun
      {
        float s = length(d - uSunDir);
        float disc = smoothstep(${(SUN_R * 1.06).toFixed(5)}, ${(SUN_R * 0.9).toFixed(5)}, s) * uSunUp;
        col += uSunCol * uSunUp * (exp(-s*30.)*.2 + exp(-s*95.)*.35);
        col = mix(col, uSunCol, disc);
        mask = max(mask, disc*.9) + uSunUp * exp(-s*80.) * .3;
      }
      // thin high cloud, then the cumulus
      float ci = fbm(vec2(p.x*2.2 + uCloudOff*1.6 + 5., p.y*13.)) * fbm(vec2(p.x*.9 - uCloudOff*.8, p.y*3.) + 9.);
      ci = smoothstep(.2, .46, ci) * smoothstep(.02, .16, p.y) * .5;
      col = mix(col, mix(uCloudLit, uCloudMid, .35), ci);
      vec4 c = cloudAt(p, 0., d);
      if (uMode == 4) {
        float disc = max(step(length(d - uSunDir), ${SUN_R.toFixed(5)}) * step(.05, uSunUp), step(length(d - uMoonDir), ${MOON_R.toFixed(5)}) * step(.05, uMoonUp));
        o = vec4((c.a > .5 ? 2. : disc > .5 ? 3. : 1.)/255., 1./255., 0., 1.); return;
      }
      col = mix(col, c.rgb, c.a);
      mask *= 1. - c.a*.92;
      o = vec4(col, clamp(mask, 0., 1.));
    }
  `;

  /* Draws the cloud sheet once: R thickness (0.5 at the edge), G fine billow, B height above the base. */
  const FS_CLOUDBAKE = `
    in vec2 vUV; out vec4 o;
    ${GLSL_NOISE}
    uniform vec4 uPuff[192];
    uniform int uPuffs;
    float smin(float a, float b, float k){ float h = max(k - abs(a - b), 0.)/k; return min(a, b) - h*h*k*.25; }
    void main(){
      vec2 p = vec2((vUV.x - .5)*${CLOUD_U.toFixed(3)}, vUV.y*${CLOUD_V.toFixed(3)});
      float sd = 1e3, hgt = 0., wsum = 0.;
      for (int i = 0; i < 192; i++) {
        if (i >= uPuffs) break;
        vec4 q = uPuff[i];
        vec2 dd = p - q.xy;
        dd.x = mod(dd.x + ${(CLOUD_U / 2).toFixed(3)}, ${CLOUD_U.toFixed(3)}) - ${(CLOUD_U / 2).toFixed(3)};
        float base = q.y - abs(q.w);                  // q.w: how far the flat base sits below this puff
        float c = length(dd*vec2(1., 1.18)) - q.z;
        c = max(c, (base - p.y)*1.0);
        sd = smin(sd, c, .028);
        float w = exp(-max(c, 0.)*60.);
        hgt += w * clamp((p.y - base)/max(q.z*2.2 + abs(q.w), .01), 0., 1.); wsum += w;
      }
      vec2 np = vec2(p.x, p.y*1.25);
      float big = fbm(np*17.) - .5, mid = fbm(np*46. + 3.7) - .5, fine = fbm(np*120. + 9.1) - .5;
      float whole = sd;                              // the heap before it billows: its broad form
      sd -= big*.036 + mid*.013 + fine*.0025;
      o = vec4(clamp(.5 - sd/.2, 0., 1.), clamp(.5 + mid*1.6 + fine, 0., 1.), hgt/max(wsum, 1e-3), clamp(.5 - whole/.5, 0., 1.));
    }
  `;

  const VS_LAND = `
    in vec3 aPos;
    uniform mat4 uVP;
    ${GLSL_NOISE} ${GLSL_LAND}
    out vec3 vW;
    void main(){
      float d = -aPos.z;
      float y = max(sandH(d, aPos.x), uSea + uSwashA*.5);
      vW = vec3(aPos.x, y, aPos.z);
      gl_Position = uVP * vec4(vW, 1.);
    }
  `;
  const FS_LAND = `
    in vec3 vW; out vec4 o;
    uniform int uMode;
    uniform vec3 uCam, uDeep, uNear, uShal, uSand, uWet, uFoam, uFoamShade, uKeyDir, uHaze, uSeg, uSegSea;
    uniform vec2 uRes;
    uniform float uBio, uNight, uReflOn;
    uniform vec4 uBlob[8];
    uniform vec3 uShDir;
    uniform sampler2D uRefl;
    ${GLSL_NOISE} ${GLSL_SKY} ${GLSL_LAND}
    vec3 mirror(vec3 R, vec2 bend, float lod){
      R.y = abs(R.y) + .002;
      vec3 c = skyGradient(R);
      float s = length(R - uSunDir);
      c += uSunCol * uSunUp * (exp(-s*20.)*.3);
      vec4 cl = cloudAt(skyUV(R), lod, R);
      c = mix(c, cl.rgb, cl.a);
      vec4 r = texture(uRefl, gl_FragCoord.xy/uRes + bend) * uReflOn;
      return c*(1. - r.a) + r.rgb;
    }
    void main(){
      float d = -vW.z, x = vW.x;
      float h = sandH(d, x);
      float lvl = seaLevel(x, uTime);
      float depth = lvl - h;
      vec3 toCam = uCam - vW;
      float dist = length(toCam);
      vec3 V = toCam / dist;
      vec2 q = vW.xz;
      float aa = fwidth(depth) + 1e-4;
      float water = smoothstep(-aa, aa, depth);

      if (uMode == 3) { o = vec4(mix(uSeg, uSegSea, water), 1.); return; }
      if (uMode == 2) { float v = clamp(1. - log(dist/1.2)/log(4000./1.2), 0., 1.); o = vec4(vec3(v), 1.); return; }

      // ---- the sea ----
      float t = uTime;
      float fade = 1./(1. + dist*.01);
      vec4 w1 = n4(q*.045 + vec2(t*.012, t*.03));
      vec4 w2 = n4(q*.16 + vec2(-t*.04, t*.07));
      vec4 w3 = n4(q*.7 + vec2(t*.09, t*.15));
      vec2 slope = ((w1.rg - .5)*1.3 + (w2.gb - .5)*.9*fade + (w3.br - .5)*.55*fade*fade) * (.16 + .5*uSwell);
      float sw = sin(d*.21 + t*.85 + (w1.b - .5)*5. + x*.02);
      slope.y += sw * .1 * uSwell * (.4 + fade);
      vec3 N = normalize(vec3(-slope.x, 1., -slope.y));
      if (uMode == 1) {
        vec3 ns = normalize(vec3((n2(q*.9) - .5)*.08, 1., (n2(q*.9 + 40.) - .5)*.08));
        vec3 nn = mix(ns, N, water);
        o = vec4(nn.x*.5 + .5, nn.y*.5 + .5, nn.z*.5 + .5, 1.); return;
      }
      float fres = .02 + .98*pow(1. - max(dot(N, V), 0.), 5.);
      vec3 body = mix(uShal, uNear, smoothstep(.02, .7, depth));
      body = mix(body, uDeep, smoothstep(.6, 3.4, depth));
      // bands of darker and lighter water where the swell runs in
      body *= 1. + (smoothstep(.55, 1., sw) - smoothstep(-.4, -1., sw)*.7) * .09 * uSwell * (.3 + fade);
      vec3 Rv = reflect(-V, N);
      vec3 sky = mirror(Rv, N.xz*.035, 1. + 2.*(1. - fade));
      vec3 sea = mix(body, sky, clamp(fres*1.1 + .06, 0., .96));
      // sunlight and moonlight broken on the water
      float gl = pow(max(dot(normalize(vec3(Rv.x, abs(Rv.y), Rv.z)), uGlowDir), 0.), 260.);
      float spark = smoothstep(.55, .8, w3.g + w2.r*.5) ;
      float glit = smoothstep(.2, .6, gl * (.35 + spark)) * (uSunUp + uMoonUp*.7) * smoothstep(.45, .6, w3.r + (w2.g - .5)*.6);
      sea = mix(sea, uSunCol, glit * .85);
      float mask = glit * .7;
      // caustic light in the shallows
      float ca = abs(n2(q*1.3 + vec2(t*.12, -t*.09)) - n2(q*1.3 + 5. - vec2(t*.1, t*.05)));
      sea += uFoam * smoothstep(.07, .0, ca) * .2 * smoothstep(1.1, .12, depth) * (1. - uNight*.8);

      // ---- surf: three fronts roll in over a wide, shallow zone, and leave lace behind ----
      float s = depth / .02;                               // metres seaward of the edge
      float foam = 0.;
      float surf = 30. + 14.*uSwell;
      for (int k = 0; k < 3; k++) {
        float ph = fract(t/9.5 + float(k)/3. + .1*sin(x*.045 + float(k)*2.1) + (w1.r - .5)*.05);
        float sk = surf * (1. - ph) * (1. - ph*.25);
        float back = s - sk;                               // behind the front, toward the sea
        float wid = (.5 + 2.6*ph) * (.6 + .9*uSwell);
        float lace = n2(q*vec2(.7, 1.6) + vec2(float(k)*7., t*.25));
        float front = smoothstep(-.12, .04, back) * (1. - smoothstep(wid*.4, wid, back + (lace - .5)*wid*1.3));
        float trail = smoothstep(wid, wid*.5, back - wid) * smoothstep(.56, .7, lace*.6 + w3.r*.4 + ph*.12) * .9;
        foam = max(foam, max(front, trail*step(0., back)) * smoothstep(0., .25, ph) * (.45 + .55*ph));
      }
      float edge = 1. - smoothstep(0., .028 + .02*w3.b, depth);     // the thin sheet running up the sand
      foam = max(foam, edge * (.55 + .45*w2.a));
      foam = smoothstep(.34, .46, foam + (w3.a - .5)*.16);
      vec3 foamCol = mix(uFoamShade, uFoam, smoothstep(.2, .7, w2.g + foam*.3));
      sea = mix(sea, foamCol, foam * .96);
      // living light in the broken water at night
      float bio = smoothstep(.78, .95, w3.a*.6 + w2.b*.4 + foam*.12) * foam * uBio;
      sea += vec3(.25, .9, 1.) * bio * 1.1;
      mask = max(mask, bio*.9);
      mask = max(mask, foam * .0);

      // ---- the sand ----
      float nBig = n2(q*.11), nMid = n2(q*.8 + 31.), nFine = n2(q*6.5 + 3.);
      vec3 dry = uSand * (.94 + .09*nBig + .05*nMid);
      float close = smoothstep(42., 8., dist);
      float rip = sin(d*4.6 + n2(q*.42)*8. + x*.5);
      dry *= 1. - smoothstep(.72, 1., rip) * .07 * close;
      dry *= 1. + (step(.93, nFine) - step(nFine, .06)) * .08 * close;                 // grains
      vec2 cell = floor(q*2.2); vec4 hc = texture(uNoise, (cell + .5)/256.);           // pebbles and shells
      vec2 pc = fract(q*2.2) - .5 - (hc.xy - .5)*.6;
      float peb = step(.9, hc.z) * smoothstep(.1 + .08*hc.w, .06, length(pc*vec2(1., 1.6)));
      dry = mix(dry, mix(uWet*.8, uFoam*.95, step(.5, hc.w)), peb * close);
      // blob shadows of the people on the beach, thrown away from the light
      float shade = 0.;
      for (int i = 0; i < 8; i++) {
        vec4 b = uBlob[i];
        if (b.w <= 0.) continue;
        vec2 pa = q - b.xy; vec2 ba = uShDir.xz * b.z * uShDir.y;
        float hh = clamp(dot(pa, ba)/max(dot(ba, ba), 1e-4), 0., 1.);
        float dd = length(pa - ba*hh);
        shade = max(shade, b.w * (1. - smoothstep(b.z*.10, b.z*.22, dd)) * (1. - hh*.55));
      }
      float top = uSea + uSwashA + .012;
      float wetLine = top + .16 + (nBig - .5)*.12 + (nMid - .5)*.04;
      float damp = 1. - smoothstep(wetLine - .07, wetLine, h);
      float gloss = 1. - smoothstep(lvl - .01, top + .05, h);
      gloss = max(gloss*gloss, damp*.2);
      vec3 sandCol = mix(dry, mix(dry, uWet, .7), damp*(.75 + .25*nMid));
      sandCol *= 1. - shade*.42;
      vec3 Ns = normalize(vec3((nMid - .5)*.035, 1., (nFine - .5)*.035));
      vec3 Rs = reflect(-V, Ns);
      float fs = .05 + .95*pow(1. - max(dot(Ns, V), 0.), 5.);
      vec3 skyS = mirror(Rs, Ns.xz*.2, 2.);
      sandCol = mix(sandCol, skyS, gloss * clamp(fs*1.3 + .16, 0., .8));
      // a seam of dark weed and shells where the last tide stopped
      float wrack = smoothstep(.03, 0., abs(h - wetLine)) * smoothstep(.45, .7, nMid*.5 + nFine*.5);
      sandCol *= 1. - wrack*.2;

      if (uMode == 4) {
        o = water > .5 ? vec4((foam > .5 ? 6. : 5.)/255., 2./255., 0., 1.) : vec4((damp > .5 ? 8. : 7.)/255., 1./255., 0., 1.);
        return;
      }
      // shallow water lets the sand through
      float clear = smoothstep(.22, .0, depth) * .5;
      sea = mix(sea, sandCol*.9, clear * (1. - foam));
      vec3 col = mix(sandCol, sea, water);
      col = mix(col, uHaze, (1. - exp(-dist/2600.)) * .8);
      o = vec4(col, mask * water);
    }
  `;

  /* Everything made of triangles: people, boat, headland, rocks, grass. */
  const VS_MESH = `
    in vec3 aPos, aNor; in vec4 aCol, aAux; in float aKind;
    uniform mat4 uModel, uVP;
    uniform vec4 uSway;
    uniform float uTime, uOutline, uMirror, uClip;
    out vec3 vN, vW, vCol, vL;
    out float vOcc, vKind;
    out vec2 vUV;
    void main(){
      vec3 p = aPos;
      float w = aAux.x;
      if (w > 0.) {
        float ph = aAux.y;
        float s = sin(uTime*(2.1 + 1.3*fract(ph*.37)) + ph)*.6 + sin(uTime*5.1 + ph*1.7)*.25;
        p += uSway.xyz * (w*w) * uSway.w * (.6 + .4*s);
      }
      vec4 wp = uModel * vec4(p, 1.);
      if (uMirror > .5) wp.y = 2.*uClip - wp.y;
      vec3 n = normalize(mat3(uModel) * aNor);
      vec4 cp = uVP * wp;
      if (uOutline > 0.) {
        vec2 dir = (mat3(uVP) * n).xy * vec2(${W / 2}., ${H / 2}.);
        dir /= max(length(dir), 1e-5);
        cp.xy += dir * uOutline / vec2(${W / 2}., ${H / 2}.) * cp.w;
        cp.z += .0004 * cp.w;
      }
      vW = wp.xyz; vN = n; vCol = aCol.rgb; vOcc = aCol.a; vKind = aKind; vUV = aAux.zw; vL = aPos;
      gl_Position = cp;
    }
  `;
  const FS_MESH = `
    in vec3 vN, vW, vCol, vL; in float vOcc, vKind; in vec2 vUV;
    out vec4 o;
    uniform int uMode;
    uniform float uOutline, uMirror, uHazeK, uGlowI, uFaceOn, uClip, uSolid, uRimK, uMat, uPart;
    uniform vec3 uCam, uKeyDir, uLit, uShade, uRimDir, uRimCol, uHaze, uSeg, uCloth, uClothShade, uInk;
    uniform mat4 uView;
    uniform sampler2D uFace, uFold;
    vec4 shade(){
      vec3 N = normalize(vN);
      if (!gl_FrontFacing && uOutline <= 0.) N = -N;
      vec3 toCam = uCam - vW;
      float dist = length(toCam);
      vec3 V = toCam / dist;
      if (uMode == 1) { vec3 n = mat3(uView) * N; return vec4(n*.5 + .5, 1.); }
      if (uMode == 2) { float v = clamp(1. - log(dist/1.2)/log(4000./1.2), 0., 1.); return vec4(vec3(v), 1.); }
      if (uMode == 3) return vec4(uSeg, 1.);
      if (uMode == 4) return vec4(uMat/255., uPart/255., 0., 1.);
      int kind = int(vKind + .5);
      vec3 alb = vCol;
      vec3 dark = vec3(.8, .78, .86);          // what shadow does to a colour
      float soft = .03, rimK = .5, occ = vOcc, inkA = 0.;
      if (kind == 3) { alb = uCloth * vCol; dark = uClothShade / max(uCloth, vec3(.02)) * 1.12; rimK = .55; }
      else if (kind == 1 || kind == 6) { dark = vec3(.9, .74, .72); soft = .045; rimK = .35; }
      else if (kind == 2) { dark = vec3(.62, .62, .74); rimK = .42; }
      else if (kind == 5) { dark = vec3(.66, .78, .8); }
      if (kind == 3 || kind == 0) {
        vec4 fold = texture(uFold, vUV) * step(.001, vUV.x + vUV.y);
        occ += fold.r * .9; inkA = fold.g;
      }
      if (uOutline > 0.) {
        vec3 ink = kind == 1 || kind == 6 ? alb * vec3(.6, .36, .34) : kind == 2 ? alb * .45 : alb * uInk;
        return vec4(mix(ink * uLit, uHaze, uHazeK), 0.);
      }
      if (kind == 4) return vec4(alb * uGlowI, clamp(uGlowI - 1., 0., 1.));
      float hl = dot(N, uKeyDir)*.5 + .5 - occ*.55;
      float lit = smoothstep(.5 - soft, .5 + soft, hl);
      vec3 col = mix(alb * dark * uShade, alb * uLit, lit);
      col *= mix(.84, 1., smoothstep(.2, .3, hl));                        // a second, deeper tone
      if (kind == 1 || kind == 6) col += alb * vec3(.3, .05, .02) * (1. - abs(lit*2. - 1.)) * .35;   // warm blood at the edge of the shadow
      float mask = 0.;
      if (kind == 2) {
        // the bright band every lock carries where it turns to the light
        vec3 Hh = normalize(uKeyDir + V);
        float sp = smoothstep(.80, .86, dot(N, Hh)) * smoothstep(-.01, .04, vL.y) * lit;
        col = mix(col, alb * 2.1 * uLit + .06*uRimCol, sp*.5);
      }
      if (kind == 6 && uFaceOn > .5) {
        vec4 f = texture(uFace, vUV) * smoothstep(0., .02, vL.z);
        col = col*(1. - f.a) + f.rgb * mix(uShade*1.05, uLit, .55 + .45*lit);
      }
      col = mix(col, alb * uInk * uLit, inkA);
      float fr = 1. - max(dot(N, V), 0.);
      float rim = smoothstep(.56, .66, fr * (dot(N, uRimDir)*.5 + .62));
      col += uRimCol * rim * rimK * uRimK;
      mask = rim * rimK * uRimK * .35;
      col = mix(col, uHaze, uHazeK);
      return vec4(col, mask * (1. - uHazeK));
    }
    void main(){
      if (uMirror > .5 && vW.y > uClip) discard;
      o = shade();
      if (uSolid > .5) o.a = 1.;
    }
  `;

  /* The construction lines: every edge is a thin quad facing the camera. */
  const VS_WIRE = `
    in vec3 aPos, aOther; in vec4 aAux; in float aSide;
    uniform mat4 uModel, uVP;
    uniform vec4 uSway;
    uniform float uTime, uWidth;
    out float vOrder;
    vec3 sway(vec3 p, float w, float ph){
      if (w <= 0.) return p;
      float s = sin(uTime*(2.1 + 1.3*fract(ph*.37)) + ph)*.6 + sin(uTime*5.1 + ph*1.7)*.25;
      return p + uSway.xyz * (w*w) * uSway.w * (.6 + .4*s);
    }
    void main(){
      vec4 a = uVP * uModel * vec4(sway(aPos, aAux.x, aAux.y), 1.);
      vec4 b = uVP * uModel * vec4(sway(aOther, aAux.w, aAux.y), 1.);
      vec2 s = vec2(${W / 2}., ${H / 2}.);
      vec2 pa = a.xy/a.w*s, pb = b.xy/b.w*s;
      vec2 dir = pb - pa; dir /= max(length(dir), 1e-4);
      vec2 off = vec2(-dir.y, dir.x) * aSide * uWidth * .5;
      gl_Position = vec4((pa + off)/s*a.w, a.z, a.w);
      vOrder = aAux.z;
    }
  `;
  const FS_WIRE = `
    in float vOrder; out vec4 o;
    uniform vec4 uColor; uniform float uProgress;
    void main(){ if (vOrder > uProgress) discard; o = uColor; }
  `;

  /* Bloom: keep what glows, blur it at three sizes, add it back; then grade the picture. */
  const FS_BLUR = `
    in vec2 vUV; out vec4 o;
    uniform sampler2D uSrc; uniform vec2 uStep; uniform float uExtract;
    vec3 take(vec2 uv){
      vec4 c = texture(uSrc, uv);
      if (uExtract < .5) return c.rgb;
      float l = dot(c.rgb, vec3(.3, .55, .15));
      return c.rgb * (c.a + smoothstep(.9, 1.05, l)*.12);
    }
    void main(){
      vec3 c = take(vUV)*.227;
      c += (take(vUV + uStep*1.385) + take(vUV - uStep*1.385))*.316;
      c += (take(vUV + uStep*3.231) + take(vUV - uStep*3.231))*.0703;
      o = vec4(c, 1.);
    }
  `;
  const FS_POST = `
    in vec2 vUV; out vec4 o;
    uniform sampler2D uSrc, uB1, uB2, uB3, uNoise;
    uniform float uBloom, uExpo, uSat, uTime, uGrain, uVig;
    uniform vec3 uTint;
    void main(){
      vec3 c = texture(uSrc, vUV).rgb;
      vec3 b = texture(uB1, vUV).rgb*.5 + texture(uB2, vUV).rgb*.36 + texture(uB3, vUV).rgb*.3;
      c += b * uBloom;
      c *= uExpo;
      c = mix(c, .82 + .18*tanh((c - .82)/.18), step(.82, c));
      float l = dot(c, vec3(.3, .55, .15));
      c = mix(vec3(l), c, uSat);
      c = mix(c, c*c*(3. - 2.*c), .16);                                   // a little more contrast
      c *= mix(vec3(1.), uTint, smoothstep(.55, .0, l)*.5);                // shadows lean to the colour of the hour
      vec2 q = vUV - .5;
      c *= 1. - dot(q, q)*uVig;
      float g = texture(uNoise, vUV*vec2(${(W / 256 * 2).toFixed(3)}, ${(H / 256 * 2).toFixed(3)}) + fract(uTime*vec2(7.13, 3.71))).r - .5;
      c += g * uGrain;
      o = vec4(clamp(c, 0., 1.), 1.);
    }
  `;
  const FS_COPY = `
    in vec2 vUV; out vec4 o;
    uniform sampler2D uSrc;
    void main(){ o = texture(uSrc, vUV); }
  `;

  /* ---------- the things in the world ---------- */

  const SEG = { sky: c255(124, 166, 232), sea: c255(52, 112, 204), sand: c255(232, 198, 122), person: c255(234, 86, 98), walker: c255(234, 86, 98), rock: c255(142, 128, 122) };
  const WIRE = { sky: c255(104, 132, 196), sun: c255(255, 206, 120), sea: c255(84, 192, 236), sand: c255(222, 172, 112), rock: c255(204, 180, 152), walkers: c255(255, 128, 138), person: c255(255, 228, 196) };
  const OVER = { beach: c255(255, 222, 168), sea: c255(160, 236, 255), walkers: c255(255, 176, 176), person: c255(255, 238, 205) };
  const PART_N = { beach: 1, sea: 2, walkers: 3 };
  const PART_NAME = [null, "beach", "sea", "walkers"];
  /* What a cell of the picture shows, for the renderers that redraw it cell by cell (view "ids"). */
  const MATERIAL = { sky: 1, cloud: 2, sun: 3, gull: 4, sea: 5, foam: 6, sand: 7, wet: 8, rock: 9, walker: 10, land: 11, boat: 12, grass: 13, tower: 14 };

  /* Smooth noise for shaping things by hand. */
  const lattice = (() => {
    const r = rand(20261125);
    const t = new Float32Array(4096);
    for (let i = 0; i < t.length; i += 1) t[i] = r();
    return (x, y) => t[((x & 63) + (y & 63) * 64) & 4095];
  })();
  const vnoise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    return mix(mix(lattice(xi, yi), lattice(xi + 1, yi), fx), mix(lattice(xi, yi + 1), lattice(xi + 1, yi + 1), fx), fy);
  };

  /* The headland with the lighthouse: a ridge running out from the right, steep to the sea. */
  const HEAD = { d: 600, x0: 86, x1: 900 };
  const headHeight = curve([[86, 0], [100, 5], [130, 15], [170, 22], [200, 30], [230, 34], [270, 44], [320, 52], [380, 60], [470, 70], [560, 73], [650, 62], [730, 40], [800, 22], [860, 8], [900, 0]]);
  const headland = () => {
    const g = new Geo();
    const rock = c255(186, 170, 158), grass = c255(116, 164, 112), grassDark = c255(84, 132, 104), cliff = c255(150, 140, 142);
    g.grid(110, 9, (uIn, v) => {
      const x = mix(HEAD.x0, HEAD.x1, uIn);
      const u = (x - HEAD.x0) / 384; // the measure the near end was shaped in
      const across = smooth(0, 0.34, v) * (1 - 0.35 * smooth(0.55, 1, v));
      const n = vnoise(u * 16, v * 4 + 2) * 0.5 + vnoise(u * 41, v * 9) * 0.25;
      const y = headHeight(x) * across * (0.8 + 0.45 * n) - 0.6;
      const z = -(HEAD.d - 50) - v * 170 - (1 - smooth(0, 0.25, u)) * 30;
      const steep = 1 - smooth(0.16, 0.4, v);
      let c = mix3(mix3(grass, grassDark, smooth(0.35, 0.75, vnoise(u * 9 + 4, v * 5))), mix3(rock, cliff, n), Math.max(steep, 1 - smooth(1.5, 6, y)));
      return { p: [x, y, z], c };
    });
    // a stand of dark conifers along the top, far right
    const r = rand(77);
    for (let k = 0; k < 9; k += 1) {
      const x = 318 + k * 15 + r() * 8;
      const base = headHeight(x) * 0.93;
      const hgt = 11 + r() * 7;
      const tree = c255(52, 92, 86);
      loft(g, 6, 2, (v) => ({ c: [x, base - 1 + v * hgt, -(HEAD.d + 4 + (k % 3) * 9)], rx: 3.6 * (1 - v) + 0.05, rz: 3.6 * (1 - v) + 0.05 }), () => tree);
    }
    return g;
  };
  const LIGHT = { x: 213, z: -(HEAD.d + 6) };
  LIGHT.y = headHeight(LIGHT.x) * 0.9;
  const lighthouse = () => {
    const g = new Geo();
    const white = c255(250, 246, 238), red = c255(214, 84, 70), dark = c255(70, 66, 80), roof = c255(160, 62, 58);
    loft(g, 10, 8, (v) => ({ c: [0, v * 16, 0], rx: mix(2.5, 1.7, v), rz: mix(2.5, 1.7, v) }), (u, v) => (v > 0.36 && v < 0.6 ? red : white));
    loft(g, 10, 1, (v) => ({ c: [0, 16 + v * 0.6, 0], rx: 2.5, rz: 2.5 }), () => dark);
    loft(g, 10, 2, (v) => ({ c: [0, 18.9 + v * 2.2, 0], rx: 1.9 * (1 - v) + 0.02, rz: 1.9 * (1 - v) + 0.02 }), () => roof);
    // the keeper's house
    box(g, [-8.5, 2.2, 1], [8, 4.4, 6], white);
    box(g, [-8.5, 5.1, 1], [8.8, 1.6, 6.6], roof);
    return g;
  };
  const lantern = () => { // the lamp room, which glows after dark
    const g = new Geo();
    loft(g, 10, 2, (v) => ({ c: [0, 16.6 + v * 2.3, 0], rx: 1.45, rz: 1.45 }), () => [1, 0.93, 0.72], { kind: K.glow });
    box(g, [-8.5, 2.3, 4.05], [1.5, 1.4, 0.1], [1, 0.86, 0.6], { kind: K.glow });
    return g;
  };
  /* A soft disc of light that always faces the sea-side camera, bright in the middle. */
  const halo = (radius, colour) => {
    const g = new Geo();
    const c = g.vert([0, 0, 0], colour, 0, [0, 0, 0, 0], K.glow);
    const rim = [];
    for (let i = 0; i < 20; i += 1) { const a = (i / 20) * TAU; rim.push(g.vert([Math.cos(a) * radius, Math.sin(a) * radius, 0], [0, 0, 0], 0, [0, 0, 0, 0], K.glow)); }
    const mid = [];
    for (let i = 0; i < 20; i += 1) { const a = (i / 20) * TAU; mid.push(g.vert([Math.cos(a) * radius * 0.35, Math.sin(a) * radius * 0.35, 0], mul3(colour, 0.32), 0, [0, 0, 0, 0], K.glow)); }
    for (let i = 0; i < 20; i += 1) { const j = (i + 1) % 20; g.tri(c, mid[i], mid[j]); g.tri(mid[i], rim[i], rim[j]); g.tri(mid[i], rim[j], mid[j]); }
    g.n = new Float32Array(g.p.length).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0));
    return g;
  };
  const beam = () => { // the sweep of the lamp, two wedges of light
    const g = new Geo();
    for (const s of [1, -1]) {
      const a = g.vert([0, 0, 0], [0.9, 0.82, 0.6], 0, [0, 0, 0, 0], K.glow);
      const b = g.vert([s * 240, 9, 0], [0, 0, 0], 0, [0, 0, 0, 0], K.glow);
      const c = g.vert([s * 240, -9, 0], [0, 0, 0], 0, [0, 0, 0, 0], K.glow);
      g.tri(a, b, c);
    }
    g.n = new Float32Array(g.p.length).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0));
    return g;
  };

  /* A far shore as a cut-out standing on a circle around the camera, from one azimuth to another (radians). */
  const shore = (a0, a1, d, profile, colour) => {
    const g = new Geo();
    g.grid(96, 1, (u, v) => {
      const a = mix(a0, a1, u);
      const y = v * Math.max(0, profile(u)) * Math.pow(Math.sin(Math.PI * u), 0.5) - 2 * (1 - v);
      return { p: [Math.sin(a) * d, y, -Math.cos(a) * d], c: mul3(colour, 0.9 + 0.1 * v) };
    });
    g.n = new Float32Array(g.p.length);
    for (let i = 0; i < g.p.length; i += 3) { const l = Math.hypot(g.p[i], g.p[i + 2]) || 1; g.n[i] = -g.p[i] / l; g.n[i + 2] = -g.p[i + 2] / l; }
    return g;
  };

  /* Far hills as flat cut-outs, pale with distance. */
  const hills = (x0, x1, d, profile, colour) => {
    const g = new Geo();
    g.grid(64, 1, (u, v) => {
      const x = mix(x0, x1, u);
      const y = v * Math.max(0, profile(u)) * Math.pow(Math.sin(Math.PI * u), 0.6) - 2 * (1 - v);
      return { p: [x, y, -d], c: mul3(colour, 0.9 + 0.1 * v) };
    });
    g.n = new Float32Array(g.p.length).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0));
    return g;
  };

  const boat = () => {
    const g = new Geo();
    const hullW = c255(248, 244, 236), hullD = c255(46, 70, 112), wood = c255(150, 106, 78), sail = c255(255, 250, 240), jib = c255(244, 170, 110);
    tube(g, 12, 10, (t) => [mix(-3.3, 3.5, t), 0.32 + 0.35 * Math.pow(Math.abs(t - 0.45) * 2, 2.4), 0], (t) => { const w = Math.pow(Math.sin(Math.PI * clamp(t * 0.96 + 0.02, 0, 1)), 0.55); return [1.05 * w, 0.55 * w]; },
      (u) => (Math.sin(u * TAU) < -0.25 ? hullD : hullW), { up: [0, 1, 0] });
    box(g, [-0.4, 1.0, 0], [1.9, 0.55, 1.0], hullW);
    tube(g, 2, 5, (t) => [0.45, 0.6 + t * 7.4, 0], () => 0.06, () => wood, { up: [1, 0, 0] });
    tube(g, 2, 5, (t) => [mix(0.45, -3.0, t), 1.45, 0], () => 0.05, () => wood, { up: [0, 1, 0] });
    const cloth = (A, B, C, col, bulge) => {
      const s = new Geo();
      s.grid(6, 6, (u, v) => {
        const e = mix3(A, B, v);
        const f = mix3(A, C, v);
        const p = mix3(e, f, u);
        p[2] += bulge * Math.sin(Math.PI * u) * Math.sin(Math.PI * Math.min(1, v * 1.15)) * (0.4 + v);
        return { p, c: mul3(col, 0.9 + 0.1 * v) };
      });
      g.add(s);
    };
    cloth([0.45, 7.8, 0], [0.38, 1.6, 0], [-2.9, 1.6, 0], sail, 0.5);
    cloth([0.5, 7.2, 0], [0.6, 1.1, 0], [3.3, 0.95, 0], jib, 0.4);
    return g;
  };

  /* People on the shore. Each one is a few lofted limbs that swing from the hip and shoulder. */
  const WALKERS = [
    { x: 30, lo: 12, hi: 62, speed: 1.5, top: c255(228, 92, 84), legs: c255(52, 60, 96), hair: c255(40, 34, 44), size: 1.36 },
    { x: 384, lo: 352, hi: 470, speed: 1.2, top: c255(246, 246, 250), legs: c255(48, 78, 140), hair: c255(70, 46, 40), size: 1.28 },
    { x: 440, lo: 352, hi: 470, speed: -1.1, top: c255(246, 200, 92), legs: c255(70, 74, 104), hair: c255(36, 32, 40), size: 1.22 },
    { x: 52, lo: 12, hi: 62, speed: -0.9, top: c255(90, 186, 168), legs: c255(60, 64, 90), hair: c255(90, 60, 44), size: 1.2 },
    { x: 412, lo: 352, hi: 470, speed: 1.8, top: c255(250, 168, 186), legs: c255(84, 90, 124), hair: c255(44, 36, 40), size: 1.4 },
  ];
  const strollAt = (w, t) => {
    const span = w.hi - w.lo;
    const u = ((((w.x - w.lo + t * w.speed) / span) % 2) + 2) % 2; // 0..2: there and back
    return { x: w.lo + (u <= 1 ? u : 2 - u) * span, dir: (u <= 1 ? 1 : -1) * (w.speed > 0 ? 1 : -1) };
  };
  const SKIN = c255(246, 200, 164);
  const walkerParts = (w) => {
    const body = new Geo();
    const torso = curve([[0, 0.13], [0.3, 0.15], [0.75, 0.2], [0.9, 0.17], [1, 0.06]]);
    loft(body, 8, 7, (v) => ({ c: [0, 0.86 + v * 0.66, 0], rx: torso(v), rz: torso(v) * 0.62, n: 2.4 }), () => w.top);
    ball(body, [0, 1.63, 0.005], [0.1, 0.115, 0.105], SKIN, { nu: 8, nv: 6 });
    ball(body, [0, 1.665, -0.022], [0.108, 0.105, 0.11], w.hair, { nu: 8, nv: 6 });
    const leg = () => { const g = new Geo(); tube(g, 5, 6, (t) => [0, -t * 0.86, 0], (t) => mix(0.075, 0.052, t), (u, v) => (v > 0.9 ? c255(60, 56, 64) : w.legs), { up: [1, 0, 0] }); return g; };
    const arm = () => { const g = new Geo(); tube(g, 5, 6, (t) => [0, -t * 0.6, 0], (t) => mix(0.05, 0.038, t), (u, v) => (v > 0.8 ? SKIN : w.top), { up: [1, 0, 0] }); return g; };
    return { body, leg: leg(), arm: arm() };
  };

  const rockGeo = () => {
    const g = new Geo();
    const a = c255(168, 150, 142), b = c255(128, 112, 116), moss = c255(128, 142, 112);
    g.grid(11, 8, (u, v) => {
      const th = u * TAU, ph = v * Math.PI;
      const n = vnoise(u * 5 + 3, v * 4) * 0.55 + vnoise(u * 11, v * 9 + 5) * 0.3;
      const r = 0.72 + 0.5 * n;
      const p = [Math.sin(th) * Math.sin(ph) * 1.25 * r, Math.cos(ph) * 0.92 * r, Math.cos(th) * Math.sin(ph) * 1.0 * r];
      return { p, c: mix3(mix3(a, b, n), moss, smooth(0.5, 0.9, Math.cos(ph)) * 0.35) };
    }, { closed: true });
    outward(g, 0);
    return g.faceted();
  };
  const grassGeo = (seed, count, spread, tall) => {
    const g = new Geo();
    const r = rand(seed);
    const lo = c255(118, 150, 112), hi = c255(206, 214, 160);
    for (let k = 0; k < count; k += 1) {
      const a = r() * TAU, rr = Math.sqrt(r()) * spread;
      const root = [Math.cos(a) * rr, 0, Math.sin(a) * rr * 0.6];
      const hgt = tall * (0.55 + 0.6 * r());
      const lean = 0.25 + 0.55 * r();
      const dir = [Math.cos(a) * 0.6 + (r() - 0.5) * 0.5, 0, Math.sin(a) * 0.3];
      const phase = r() * 40;
      tube(g, 5, 4, (t) => [root[0] + dir[0] * lean * t * t * hgt, root[1] + hgt * (t - 0.22 * t * t), root[2] + dir[2] * lean * t * t * hgt],
        (t) => [0.03 * (1 - t * 0.92), 0.007], (u, v) => mix3(lo, hi, v * v), { up: [0, 0, 1], aux: (u, v) => [v, phase, 0, 0], kind: K.leaf });
    }
    return g;
  };
  const gullGeo = () => {
    const body = new Geo();
    const white = c255(250, 250, 248), grey = c255(150, 160, 178);
    ball(body, [0, 0, 0], [0.42, 0.11, 0.12], white, { nu: 6, nv: 4 });
    const wing = new Geo();
    wing.grid(3, 1, (u, v) => ({ p: [0.1 - v * 0.34 - u * u * 0.12, u * 0.18 * (1 - u), u * 1.15], c: mix3(white, grey, smooth(0.5, 1, u)) }));
    return { body, wing };
  };

  /* The cloud sheet: heaps of round puffs on flat bases. The same list is drawn as circles in the wire view. */
  const PUFFS = (() => {
    const r = rand(4242);
    const out = [];
    const cluster = (u, v, w, h, n, tower = 0) => {
      for (let i = 0; i < n; i += 1) {
        const t = (r() + r() + r()) / 1.5 - 1; // -1..1, thick in the middle
        const top = h * Math.pow(1 - Math.min(1, Math.abs(t)) ** (1.5 + tower), 0.8);
        const rad = (0.3 + 0.7 * r()) * h * (0.36 - 0.1 * tower) * (1 - 0.45 * Math.abs(t)) + 0.006;
        const up = rad * 0.55 + r() * Math.max(0, top - rad);
        out.push([u + (t * w) / 2 + tower * 0.02 * Math.sin(up * 60), v + up, rad, up]);
      }
    };
    cluster(0.3, 0.178, 0.3, 0.105, 18); // the big one, upper right
    cluster(-0.39, 0.02, 0.2, 0.25, 24, 1); // a tower standing on the horizon, left
    cluster(-0.2, 0.275, 0.2, 0.05, 9); // drifting above his head
    cluster(0.06, 0.305, 0.12, 0.03, 5);
    cluster(0.4, 0.022, 0.26, 0.06, 10); // low, behind the headland
    cluster(-0.62, 0.11, 0.2, 0.06, 8);
    cluster(0.63, 0.29, 0.16, 0.045, 6);
    cluster(0.08, 0.035, 0.16, 0.026, 5);
    // what the turning camera finds to the left and to the right
    cluster(0.98, 0.07, 0.3, 0.16, 20, 1);
    cluster(1.24, 0.25, 0.2, 0.05, 8);
    cluster(0.84, 0.31, 0.12, 0.03, 5);
    cluster(-0.9, 0.2, 0.28, 0.09, 14);
    cluster(-1.18, 0.04, 0.24, 0.07, 9);
    cluster(-1.3, 0.3, 0.14, 0.035, 5);
    cluster(-0.74, 0.33, 0.1, 0.026, 4);
    return out.slice(0, 192);
  })();

  /* ---------- building everything on the GPU ---------- */

  const build = () => {
    R.sky = program(VS_SCREEN, FS_SKY);
    R.bake = program(VS_SCREEN, FS_CLOUDBAKE);
    R.land = program(VS_LAND, FS_LAND);
    R.mesh = program(VS_MESH, FS_MESH);
    R.wire = program(VS_WIRE, FS_WIRE);
    R.blur = program(VS_SCREEN, FS_BLUR);
    R.post = program(VS_SCREEN, FS_POST);
    R.copy = program(VS_SCREEN, FS_COPY);
    R.emptyVao = gl.createVertexArray();

    // noise: four channels of random values, read with smooth interpolation
    const rnd = rand(1337);
    const bytes = new Uint8Array(256 * 256 * 4);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(rnd() * 256);
    R.noise = texture(256, 256, { data: bytes, wrap: gl.REPEAT });
    R.white = texture(1, 1, { data: new Uint8Array([0, 0, 0, 0]) });

    // the cloud sheet, drawn once
    const cw = 4096, ch = 512;
    R.cloud = target(cw, ch);
    gl.bindTexture(gl.TEXTURE_2D, R.cloud.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.viewport(0, 0, cw, ch);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.useProgram(R.bake.p);
    bindTex(0, R.noise);
    setUniforms(R.bake, { uNoise: { tex: 0 }, uPuffs: { int: PUFFS.length } });
    gl.uniform4fv(R.bake.u.uPuff, new Float32Array(PUFFS.flat()));
    gl.bindVertexArray(R.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, R.cloud.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);

    // the land: rings around the place he stands, from the dune underfoot to the horizon,
    // wide enough for the camera to turn
    {
      const rows = 176, cols = 96, span = Math.PI;
      const pos = [], idx = [];
      for (let j = 0; j <= rows; j += 1) {
        const r = 0.5 * Math.pow(9000 / 0.5, j / rows);
        for (let i = 0; i <= cols; i += 1) { const a = ((i / cols) * 2 - 1) * span; pos.push(r * Math.sin(a), 0, -r * Math.cos(a) - PIVOT); }
      }
      for (let j = 0; j < rows; j += 1) for (let i = 0; i < cols; i += 1) {
        const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, e = c + 1;
        idx.push(a, b, e, a, e, c);
      }
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const vb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(ATTR.aPos);
      gl.vertexAttribPointer(ATTR.aPos, 3, gl.FLOAT, false, 0, 0);
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      R.landMesh = { vao, n: idx.length };
    }

    // the world's objects
    const W_ = {};
    W_.headland = upload(headland());
    W_.lighthouse = upload(lighthouse());
    W_.lantern = upload(lantern());
    W_.halo = upload(halo(1, [1, 0.9, 0.66]));
    W_.beam = upload(beam());
    W_.hillsR = upload(hills(260, 2300, 2700, (u) => 40 + 150 * Math.pow(Math.sin(u * 2.3 + 0.9), 2) * (0.6 + 0.4 * vnoise(u * 9, 3)) + 36 * vnoise(u * 22, 7), c255(120, 150, 186)));
    W_.hillsL = upload(hills(-2100, -620, 3300, (u) => 24 + 84 * Math.pow(Math.sin(u * 3.1 + 1.1), 2) * (0.5 + 0.5 * vnoise(u * 8, 11)) + 22 * vnoise(u * 20, 2), c255(116, 148, 190)));
    W_.shoreL = upload(shore(-1.95, -0.78, 4300, (u) => 26 + 96 * Math.pow(Math.sin(u * 4.4 + 0.4), 2) * (0.45 + 0.55 * vnoise(u * 7, 21)) + 24 * vnoise(u * 26, 5), c255(118, 150, 192)));
    W_.shoreR = upload(shore(0.92, 1.95, 3900, (u) => 30 + 110 * Math.pow(Math.sin(u * 3.6 + 2.2), 2) * (0.45 + 0.55 * vnoise(u * 8, 33)) + 26 * vnoise(u * 24, 9), c255(120, 150, 188)));
    W_.boat = upload(boat());
    W_.rock = upload(rockGeo());
    W_.grassA = upload(grassGeo(11, 34, 0.6, 1.2));
    W_.grassB = upload(grassGeo(23, 20, 0.45, 0.85));
    W_.grassC = upload(grassGeo(37, 12, 0.3, 0.6));
    const gull = gullGeo();
    W_.gullBody = upload(gull.body);
    W_.gullWing = upload(gull.wing);
    W_.walkers = WALKERS.map((w) => { const p = walkerParts(w); return { body: upload(p.body), leg: upload(p.leg), arm: upload(p.arm) }; });
    R.world = W_;

    // construction lines of the sky: the horizon, the discs, the puffs of cloud
    {
      const g = new Geo();
      const far = 4000;
      const sk = (u, v) => [Math.sin(u) * far, CAMH + v * far, -Math.cos(u) * far];
      PUFFS.forEach(([u, v, r]) => {
        const ids = [];
        for (let i = 0; i < 14; i += 1) { const a = (i / 14) * TAU; ids.push(g.vert(sk(u + Math.cos(a) * r, Math.max(v + Math.sin(a) * r * 0.85, v - PUFFS.find((q) => q[0] === u)[3])), [1, 1, 1])); }
        for (let i = 0; i < 14; i += 1) g.edge(ids[i], ids[(i + 1) % 14]);
      });
      g.n = new Float32Array(g.p.length);
      R.cloudWire = upload(g);
      const c = new Geo();
      const ids = [];
      for (let i = 0; i < 28; i += 1) { const a = (i / 28) * TAU; ids.push(c.vert([Math.cos(a), Math.sin(a), 0], [1, 1, 1])); }
      for (let i = 0; i < 28; i += 1) c.edge(ids[i], ids[(i + 1) % 28]);
      for (let i = 0; i < 28; i += 7) { const a = (i / 28) * TAU; c.edge(c.vert([Math.cos(a) * 1.35, Math.sin(a) * 1.35, 0], [1, 1, 1]), c.vert([Math.cos(a) * 1.9, Math.sin(a) * 1.9, 0], [1, 1, 1])); }
      c.n = new Float32Array(c.p.length);
      R.discWire = upload(c);
    }
    R.landWire = {};
    R.ready = true;
  };

  /* The grid of the sand and of the sea as lines, for one tide. */
  const landWire = (seaD, level) => {
    const key = Math.round(seaD * 20);
    if (R.landWire.key === key) return R.landWire;
    const sand = new Geo(), sea = new Geo();
    const row = (g, d, y, n) => {
      const half = d * 3 + 10;
      let prev = -1;
      for (let i = 0; i <= n; i += 1) {
        const x = ((i / n) * 2 - 1) * half;
        const v = g.vert([x, y === null ? sandH(d, x) + 0.02 : y, -d], [1, 1, 1]);
        if (prev >= 0) g.edge(prev, v);
        prev = v;
      }
    };
    const ray = (g, xn, d0, d1, y, n) => {
      let prev = -1;
      for (let i = 0; i <= n; i += 1) {
        const d = d0 * Math.pow(d1 / d0, i / n);
        const x = xn * (d * 3 + 10);
        const v = g.vert([x, y === null ? sandH(d, x) + 0.02 : y, -d], [1, 1, 1]);
        if (prev >= 0) g.edge(prev, v);
        prev = v;
      }
    };
    for (let k = 0; k <= 13; k += 1) row(sand, 3.2 * Math.pow(seaD / 3.2, k / 13), null, 72);
    for (let k = -30; k <= 30; k += 1) ray(sand, Math.sign(k) * Math.pow(Math.abs(k) / 30, 1.7), 3.2, seaD, null, 14);
    for (let k = 1; k <= 22; k += 1) row(sea, seaD * Math.pow(6000 / seaD, Math.pow(k / 22, 1.5)), level, 2);
    for (let k = -30; k <= 30; k += 1) ray(sea, Math.sign(k) * Math.pow(Math.abs(k) / 30, 1.7), seaD, 6000, level, 1);
    for (const g of [sand, sea]) g.n = new Float32Array(g.p.length);
    if (R.landWire.sand) for (const m of [R.landWire.sand, R.landWire.sea]) { gl.deleteVertexArray(m.vao); gl.deleteVertexArray(m.lvao); }
    R.landWire = { key, sand: upload(sand), sea: upload(sea) };
    return R.landWire;
  };

  /* Buffers that depend on the size of the picture. */
  const SETS = new Map(); // a few sizes are kept: the picture, a renderer's grid, the small copy for pointing
  const TARGETS = ["msaa", "scene", "out", "ids", "refl", "b1a", "b1b", "b2a", "b2b", "b3a", "b3b"];
  const fit = (pw, ph) => {
    if (R.pw === pw && R.ph === ph) return;
    const key = pw + "x" + ph;
    let T = SETS.get(key);
    if (T) SETS.delete(key);
    else {
      // a renderer's small grid wants hard edges, one sample per cell; the picture is smoothed
      const samples = pw < 300 ? 0 : Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0);
      const half = (n) => Math.max(2, Math.round(n));
      T = {
        pw, ph,
        msaa: msaaTarget(pw, ph, samples), scene: target(pw, ph), out: target(pw, ph, { filter: gl.NEAREST }),
        ids: target(pw, ph, { depth: true, filter: gl.NEAREST }),
        // the mirror image is not drawn smaller on a small grid: thin things would break up in it
        refl: target(Math.max(2, pw < 400 ? pw : pw >> 1), Math.max(2, pw < 400 ? ph : ph >> 1), { depth: true }),
        b1a: target(half(pw / 2), half(ph / 2)), b1b: target(half(pw / 2), half(ph / 2)),
        b2a: target(half(pw / 4), half(ph / 4)), b2b: target(half(pw / 4), half(ph / 4)),
        b3a: target(half(pw / 8), half(ph / 8)), b3b: target(half(pw / 8), half(ph / 8)),
      };
    }
    SETS.set(key, T);
    if (SETS.size > 4) {
      const old = SETS.keys().next().value;
      TARGETS.forEach((k) => freeTarget(SETS.get(old)[k]));
      SETS.delete(old);
    }
    Object.assign(R, T);
  };

  /* ---------- one frame ---------- */

  const screen = () => { gl.bindVertexArray(R.emptyVao); gl.drawArrays(gl.TRIANGLES, 0, 3); };

  /* Everything a frame needs to know, worked out once. */
  const frameOf = (s) => {
    const L = lighting(s.hour);
    const t = s.time;
    const lean = clamp(s.lean, -1, 1);
    const sea = seaOfTide(s.tide);
    const swell = clamp(s.swell, 0, 1), wind = clamp(s.wind, 0, 1);
    // The camera turns about the place he stands, so that the world swings round behind him.
    const yaw = clamp(+s.yaw || 0, -YAW_MAX, YAW_MAX), pitch = clamp(+s.pitch || 0, PITCH_MIN, PITCH_MAX);
    const turn = M.rotY(-yaw); // the camera's axes in the world, without the tilt
    const Rw = M.mul(turn, M.rotX(pitch));
    const view = M.mul(M.rotX(-pitch), M.rotY(yaw));
    const cam = [-Math.sin(yaw) * PIVOT + Rw[0] * lean * 0.36, CAMH, -PIVOT + Math.cos(yaw) * PIVOT + Rw[2] * lean * 0.36];
    const vp = M.chain(M.lens(F, W / 2, HORIZON, 0.5, 12000), view, M.translate(-cam[0], -cam[1], -cam[2]));
    const g = L.glowDir;
    const lightUV = [Math.atan2(g[0], -g[2]), g[1] / Math.max(Math.hypot(g[0], g[2]), 0.12)];
    const high = Math.max(smooth(-0.3, 0.1, g[2]), smooth(0.55, 0.9, g[1]));
    const foam = mix3(L.cloudLit, L.sand, 0.12);
    const lit = mul3(add3(mul3(L.keyC, 0.82), mul3(L.ambC, 0.5)), 1 + 0.22 * L.night);
    const shade = mul3(add3(mul3(L.ambC, 1.35), mul3(L.keyC, 0.26)), 1 + 0.12 * L.night);
    const kxz = Math.hypot(L.keyDir[0], L.keyDir[2]) || 1e-3;
    const fr = {
      s, L, t, lean, sea, swell, wind, cam, vp, lit, shade, view, turn, Rw, yaw, pitch,
      seg: s.seg ? Object.assign({}, SEG, s.seg) : SEG,
      swashA: 0.025 + 0.055 * swell,
      sky: {
        uTop: L.top, uMid: L.mid, uHor: L.hor, uGlowCol: L.glow, uGlowA: L.glowA, uSunDir: L.sunDir, uMoonDir: L.moonDir, uGlowDir: g,
        uSunCol: L.sunC, uCloudLit: L.cloudLit, uCloudMid: L.cloudMid, uCloudShade: L.cloudShade, uSunUp: L.sunUp, uMoonUp: L.moonUp,
        uStars: L.stars, uCloudOff: (t * (0.0012 + 0.006 * wind)) % CLOUD_U, uHigh: high, uLightUV: lightUV, uTime: t, uNoise: { tex: 0 }, uCloud: { tex: 1 },
        uCamX: [Rw[0], Rw[1], Rw[2]], uCamY: [Rw[4], Rw[5], Rw[6]], uCamZ: [Rw[8], Rw[9], Rw[10]],
      },
      shDir: [-L.keyDir[0] / kxz, Math.min(2.6, kxz / Math.max(L.keyDir[1], 0.12)), -L.keyDir[2] / kxz],
      foam, foamShade: mix3(L.cloudMid, L.near, 0.25),
    };
    // where the walkers are
    const count = clamp(Math.round(s.walkers), 0, 5);
    const wd = Math.max(22, sea.d - 9);
    fr.walkers = [];
    for (let k = 0; k < count; k += 1) {
      const w = WALKERS[k];
      const { x: fx, dir } = strollAt(w, t);
      const x = ((fx - W / 2) / F) * wd;
      const d = wd + (k % 2) * 1.6 - 0.8;
      const size = 1.3 * (0.7 + 0.3 * w.size);
      fr.walkers.push({ k, w, x, d, y: sandH(d, x), dir, size, phase: t * 3.2 * Math.abs(w.speed) + k * 2 });
    }
    return fr;
  };

  const meshUniforms = (fr, extra) => Object.assign({
    uVP: fr.vp, uModel: M.ident(), uView: fr.view, uCam: fr.cam, uTime: fr.t, uSway: [0, 0, 0, 0], uOutline: 0, uMirror: 0, uClip: 0, uSolid: 0,
    uKeyDir: fr.L.keyDir, uLit: fr.lit, uShade: fr.shade, uRimDir: fr.L.glowDir, uRimCol: mul3(fr.L.rim, fr.L.rimI), uHaze: fr.L.haze, uHazeK: 0,
    uGlowI: 1, uFaceOn: 0, uRimK: 0, uSeg: SEG.rock, uCloth: [1, 1, 1], uClothShade: [0.7, 0.7, 0.8], uInk: [0.34, 0.3, 0.4], uFace: { tex: 3 }, uFold: { tex: 4 },
  }, extra);

  /* The list of things to draw this frame: mesh, where, how. */
  const worldItems = (fr) => {
    const { L, t, s } = fr;
    const O = R.world;
    const items = [];
    const hazeAt = (d) => 1 - Math.exp(-d / 2400);
    const SG = fr.seg;
    const put = (mesh, model, o = {}) => items.push(Object.assign({ mesh, model, part: "beach", seg: SG.rock, mat: MATERIAL.rock, outline: 0, cull: true, haze: 0, sway: [0, 0, 0, 0], plane: null, glow: 1, add: false, wire: "rock", rim: 0 }, o));
    const facing = fr.turn; // flat discs of light are turned to the camera
    put(O.hillsR, M.ident(), { haze: 0.62, plane: 0, cull: false, mat: MATERIAL.land });
    put(O.hillsL, M.ident(), { haze: 0.7, plane: 0, cull: false, mat: MATERIAL.land });
    put(O.shoreL, M.ident(), { haze: 0.74, plane: 0, cull: false, mat: MATERIAL.land });
    put(O.shoreR, M.ident(), { haze: 0.72, plane: 0, cull: false, mat: MATERIAL.land });
    put(O.headland, M.ident(), { haze: hazeAt(HEAD.d) * 0.9, plane: 0, mat: MATERIAL.land });
    const lh = M.translate(LIGHT.x, LIGHT.y, LIGHT.z);
    put(O.lighthouse, lh, { haze: hazeAt(HEAD.d) * 0.55, plane: 0, outline: 0.35, mat: MATERIAL.tower });
    put(O.lantern, lh, { haze: 0, plane: 0, glow: mix(0.82, 2.2, L.night), mat: MATERIAL.tower });
    if (L.night > 0.02) {
      const top = [LIGHT.x, LIGHT.y + 17.7, LIGHT.z];
      put(O.halo, M.chain(M.translate(...top), facing, M.scale(14, 14, 1)), { add: true, glow: L.night * 0.9, wire: null });
      const a = t * 0.55;
      const sweep = Math.abs(Math.cos(a));
      put(O.beam, M.chain(M.translate(...top), M.rotY(a)), { add: true, glow: L.night * 0.5, cull: false, wire: null });
      put(O.halo, M.chain(M.translate(...top), facing, M.scale(30, 30, 1)), { add: true, glow: L.night * 0.5 * Math.pow(sweep, 24), wire: null });
    }
    // the boat tacks slowly across the bay
    const bd = 94;
    const bx = ((76 + 18 * Math.sin(t * 0.024) - W / 2) / F) * bd;
    const boatM = M.chain(M.translate(bx, fr.sea.level + 0.05 * Math.sin(t * 1.1), -bd), M.rotZ(0.035 * Math.sin(t * 0.9)), M.rotX(0.03 * Math.sin(t * 0.7 + 1)));
    put(O.boat, boatM, { part: "sea", seg: SG.sea, mat: MATERIAL.boat, plane: fr.sea.level, outline: 0.45, cull: false, wire: "sea", rim: 0.5 });
    if (L.night > 0.02) put(O.halo, M.chain(M.translate(bx + 0.45, fr.sea.level + 8.1, -bd + 0.2), facing, M.scale(1.6, 1.6, 1)), { part: "sea", add: true, glow: L.night * 1.1, plane: fr.sea.level, wire: null });
    // gulls
    for (let k = 0; k < 3; k += 1) {
      const gx = ((((t * (2.6 + k) + k * 170 + 290) % 920) + 920) % 920) - 460;
      const gy = 66 + k * 15 + 4 * Math.sin(t * 0.5 + k * 2);
      const gd = 230 + k * 60;
      const flap = Math.sin(t * (5.4 + k) + k * 2.4);
      const base = M.chain(M.translate(gx, gy, -gd), M.scale(4.2, 4.2, 4.2));
      put(O.gullBody, base, { wire: "sky", outline: 0, mat: MATERIAL.gull });
      put(O.gullWing, M.chain(base, M.rotX(-0.25 - flap * 0.55)), { cull: false, wire: "sky", mat: MATERIAL.gull });
      put(O.gullWing, M.chain(base, M.scale(1, 1, -1), M.rotX(-0.25 - flap * 0.55)), { cull: false, wire: "sky", mat: MATERIAL.gull });
    }
    // people along the water
    for (const wk of fr.walkers) {
      const P = O.walkers[wk.k];
      const sw = Math.sin(wk.phase);
      const base = M.chain(M.translate(wk.x, wk.y + Math.abs(Math.cos(wk.phase)) * 0.035 * wk.size, -wk.d), M.rotY(wk.dir > 0 ? Math.PI / 2 : -Math.PI / 2), M.scale(wk.size, wk.size, wk.size));
      const o = { part: "walkers", seg: SG.walker, mat: MATERIAL.walker, outline: 0.5, plane: wk.y, wire: "walkers", rim: 0.7 };
      put(P.body, base, o);
      put(P.leg, M.chain(base, M.translate(0.075, 0.88, 0), M.rotX(sw * 0.5)), o);
      put(P.leg, M.chain(base, M.translate(-0.075, 0.88, 0), M.rotX(-sw * 0.5)), o);
      put(P.arm, M.chain(base, M.translate(0.225, 1.4, 0), M.rotZ(0.1), M.rotX(-sw * 0.42)), o);
      put(P.arm, M.chain(base, M.translate(-0.225, 1.4, 0), M.rotZ(-0.1), M.rotX(sw * 0.42)), o);
    }
    // the dune he stands on: a rock and the marram grass, close to the camera
    const sway = [1, 0.05, 0.25, 0.04 + 0.3 * fr.wind];
    const onDune = (x, d, lift = 0) => M.translate(x, sandH(d, x) + lift, -d);
    put(O.rock, M.chain(onDune(-3.05, 7.3, 0.3), M.rotY(0.6)), { outline: 0.9 });
    const grass = { sway, cull: false, mat: MATERIAL.grass };
    put(O.grassA, onDune(2.55, 6.5), grass);
    put(O.grassB, onDune(3.35, 7.6), grass);
    put(O.grassB, M.chain(onDune(1.75, 5.8), M.rotY(1.2)), grass);
    put(O.grassC, onDune(-2.0, 6.2), grass);
    put(O.grassC, M.chain(onDune(-3.4, 5.6), M.rotY(2)), grass);
    return items;
  };

  const landUniforms = (fr, mode) => Object.assign({}, fr.sky, {
    uMode: { int: mode }, uVP: fr.vp, uCam: fr.cam, uSea: fr.sea.level, uSwashA: fr.swashA, uSwell: fr.swell,
    uDeep: fr.L.deep, uNear: fr.L.near, uShal: fr.L.shal, uSand: fr.L.sand, uWet: fr.L.wet, uFoam: fr.foam, uFoamShade: fr.foamShade,
    uKeyDir: fr.L.keyDir, uHaze: fr.L.haze, uRes: [R.pw, R.ph], uBio: fr.L.bio, uNight: fr.L.night, uReflOn: mode === 0 ? 1 : 0,
    uShDir: fr.shDir, uRefl: { tex: 2 }, uSeg: fr.seg.sand, uSegSea: fr.seg.sea,
  });

  const drawItems = (fr, items, mode, { mirror = false, outlines = true } = {}) => {
    const prog = R.mesh;
    gl.useProgram(prog.p);
    for (const it of items) {
      if (mirror && it.plane === null) continue;
      if (it.add && mode !== 0) continue;
      const u = meshUniforms(fr, {
        uMode: { int: mode }, uModel: it.model, uHazeK: mode === 0 ? it.haze : 0, uSway: it.sway, uGlowI: it.glow, uRimK: it.rim,
        uSeg: it.seg, uMat: it.mat, uPart: PART_N[it.part], uMirror: mirror ? 1 : 0, uClip: mirror ? it.plane : 0, uSolid: mirror ? 1 : 0,
      });
      setUniforms(prog, u);
      if (it.add) {
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false); gl.disable(gl.CULL_FACE);
        drawMesh(it.mesh);
        gl.disable(gl.BLEND); gl.depthMask(true);
        continue;
      }
      if (it.cull) { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); } else gl.disable(gl.CULL_FACE);
      drawMesh(it.mesh);
      if (outlines && mode === 0 && it.outline > 0 && !mirror) {
        gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT);
        gl.uniform1f(prog.u.uOutline, it.outline);
        drawMesh(it.mesh);
        gl.cullFace(gl.BACK);
      }
    }
    gl.disable(gl.CULL_FACE);
  };

  const blobs = (fr) => {
    const b = new Float32Array(32);
    fr.walkers.forEach((wk, i) => { b.set([wk.x, -wk.d, 1.75 * wk.size, 1], i * 4); });
    return b;
  };

  /* The picture, or one of its buffers, into the framebuffer that is bound (w x h). */
  const drawWorld = (fr, mode, w, h) => {
    const items = worldItems(fr);
    gl.viewport(0, 0, w, h);
    bindTex(0, R.noise); bindTex(1, R.cloud.tex); bindTex(2, mode === 0 ? R.refl.tex : R.white); bindTex(3, R.white); bindTex(4, R.white);
    gl.disable(gl.BLEND); gl.disable(gl.STENCIL_TEST);
    gl.depthMask(true);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    // sky
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(R.sky.p);
    setUniforms(R.sky, Object.assign({}, fr.sky, { uMode: { int: mode }, uShift: [0, 0], uSeg: fr.seg.sky }));
    screen();
    // land and sea
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.useProgram(R.land.p);
    setUniforms(R.land, landUniforms(fr, mode));
    gl.uniform4fv(R.land.u.uBlob, blobs(fr));
    gl.bindVertexArray(R.landMesh.vao);
    gl.drawElements(gl.TRIANGLES, R.landMesh.n, gl.UNSIGNED_SHORT, 0);
    // things
    drawItems(fr, items, mode);
    return items;
  };

  const drawMirror = (fr) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, R.refl.fb);
    gl.viewport(0, 0, R.refl.w, R.refl.h);
    gl.clearColor(0, 0, 0, 0);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND);
    bindTex(0, R.noise); bindTex(3, R.white); bindTex(4, R.white);
    gl.frontFace(gl.CW);
    drawItems(fr, worldItems(fr), 0, { mirror: true, outlines: false });
    gl.frontFace(gl.CCW);
  };

  const blurPass = (src, dst, dx, dy, extract) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
    gl.viewport(0, 0, dst.w, dst.h);
    bindTex(0, src.tex);
    setUniforms(R.blur, { uSrc: { tex: 0 }, uStep: [dx / src.w, dy / src.h], uExtract: extract ? 1 : 0 });
    screen();
  };

  const WIRE_BG = c255(15, 19, 34);
  const drawWire = (fr, parts, overlay) => {
    const part = (k) => (parts && parts[k] !== undefined ? clamp(+parts[k], 0, 1) : 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, R.msaa.fb);
    gl.viewport(0, 0, R.pw, R.ph);
    gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.STENCIL_TEST);
    if (overlay) gl.clearColor(0, 0, 0, 0); else gl.clearColor(WIRE_BG[0], WIRE_BG[1], WIRE_BG[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    bindTex(0, R.noise); bindTex(1, R.cloud.tex); bindTex(2, R.white); bindTex(3, R.white); bindTex(4, R.white);
    const items = worldItems(fr);
    const lw = landWire(fr.sea.d, fr.sea.level + fr.swashA * 0.5 + 0.02);
    const width = overlay ? 1.0 : 0.85;
    const line = (mesh, model, colour, alpha, progress, sway = [0, 0, 0, 0], vp = fr.vp) => {
      if (progress <= 0 || !mesh.ln) return;
      setUniforms(R.wire, { uVP: vp, uModel: model, uSway: sway, uTime: fr.t, uWidth: width, uProgress: progress, uColor: [colour[0] * alpha, colour[1] * alpha, colour[2] * alpha, alpha] });
      drawLines(mesh);
    };
    const tone = (key, p) => (overlay ? OVER[p] : WIRE[key]);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    // the sky first, behind everything
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(R.wire.p);
    const pb = part("beach");
    if (pb > 0) {
      const off = fr.sky.uCloudOff;
      for (const turned of [off, off - CLOUD_U]) line(R.cloudWire, M.rotY(turned), tone("sky", "beach"), overlay ? 0.6 : 0.55, pb);
      const disc = (dir, r, up) => { if (up > 0.05) line(R.discWire, M.chain(M.translate(dir[0] * 4000, CAMH + dir[1] * 4000, dir[2] * 4000), fr.Rw, M.scale(r * 4000, r * 4000, 1)), overlay ? OVER.beach : WIRE.sun, 0.9, pb); };
      disc(fr.L.sunDir, SUN_R, fr.L.sunUp);
      disc(fr.L.moonDir, MOON_R, fr.L.moonUp);
    }
    // depth of every surface, so that lines behind something are hidden
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.colorMask(false, false, false, false);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 3);
    gl.useProgram(R.land.p);
    setUniforms(R.land, landUniforms(fr, 3));
    gl.bindVertexArray(R.landMesh.vao);
    gl.drawElements(gl.TRIANGLES, R.landMesh.n, gl.UNSIGNED_SHORT, 0);
    drawItems(fr, items.filter((it) => !it.add && part(it.part) > 0), 3);
    gl.colorMask(true, true, true, true);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.useProgram(R.wire.p);
    line(lw.sand, M.ident(), tone("sand", "beach"), overlay ? 0.7 : 0.55, pb);
    line(lw.sea, M.ident(), tone("sea", "sea"), overlay ? 0.75 : 0.6, part("sea"));
    for (const it of items) {
      if (it.add || !it.wire) continue;
      const p = part(it.part);
      line(it.mesh, it.model, tone(it.wire, it.part), overlay ? 0.9 : 0.8, p, it.sway);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  };

  /* Render state `s` in its view into R.out (or, for "ids", into R.ids), at pw x ph. */
  const render = (s, pw, ph) => {
    fit(pw, ph);
    const fr = frameOf(s);
    const view = s.view || "rgb";
    const look = s.look || {};
    if (view === "ids") {
      gl.bindFramebuffer(gl.FRAMEBUFFER, R.ids.fb);
      drawWorld(fr, 4, pw, ph);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return fr;
    }
    if (view === "wire") {
      drawWire(fr, s.parts, s.overlay === true);
    } else {
      const mode = view === "normal" ? 1 : view === "depth" ? 2 : view === "seg" ? 3 : 0;
      if (mode === 0) drawMirror(fr);
      gl.bindFramebuffer(gl.FRAMEBUFFER, R.msaa.fb);
      drawWorld(fr, mode, pw, ph);
      if (mode === 0) {
        // resolve, bloom, grade
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, R.msaa.fb);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, R.scene.fb);
        gl.blitFramebuffer(0, 0, pw, ph, 0, 0, pw, ph, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
        gl.useProgram(R.blur.p);
        blurPass(R.scene, R.b1a, 1, 0, true); blurPass(R.b1a, R.b1b, 0, 1, false);
        blurPass(R.b1b, R.b2a, 1, 0, false); blurPass(R.b2a, R.b2b, 0, 1, false);
        blurPass(R.b2b, R.b3a, 1, 0, false); blurPass(R.b3a, R.b3b, 0, 1, false);
        gl.bindFramebuffer(gl.FRAMEBUFFER, R.out.fb);
        gl.viewport(0, 0, pw, ph);
        gl.useProgram(R.post.p);
        bindTex(0, R.scene.tex); bindTex(1, R.b1b.tex); bindTex(2, R.b2b.tex); bindTex(3, R.b3b.tex); bindTex(4, R.noise);
        const opt = (v, d) => (v === undefined ? d : v);
        setUniforms(R.post, { uSrc: { tex: 0 }, uB1: { tex: 1 }, uB2: { tex: 2 }, uB3: { tex: 3 }, uNoise: { tex: 4 }, uBloom: fr.L.bloom * opt(look.bloom, 1), uExpo: fr.L.expo, uSat: fr.L.sat * opt(look.sat, 1), uTime: fr.t, uGrain: opt(look.grain, 0.018), uVig: opt(look.vignette, 0.22), uTint: mix3([1, 1, 1], norm3(fr.L.amb).map((v) => v * 1.6), 0.5) });
        screen();
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return fr;
      }
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, R.msaa.fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, R.out.fb);
    gl.blitFramebuffer(0, 0, pw, ph, 0, 0, pw, ph, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return fr;
  };

  /* ---------- the world, as the renderers know it ---------- */

  try {
    build();
  } catch (error) {
    if (window.console) console.error(error);
    return;
  }
  glCanvas.addEventListener("webglcontextlost", (event) => { event.preventDefault(); R.lost = true; });
  glCanvas.addEventListener("webglcontextrestored", () => {
    SETS.clear();
    R.pw = 0; R.ph = 0;
    try { build(); R.lost = false; } catch (error) { /* stays lost */ }
  });

  const normalise = (state) => ({
    time: +state.time || 0,
    hour: state.hour === undefined ? 13.2 : +state.hour,
    wind: state.wind === undefined ? 0.3 : +state.wind,
    tide: state.tide === undefined ? 0.4 : +state.tide,
    swell: state.swell === undefined ? 0.5 : +state.swell,
    walkers: state.walkers === undefined ? 2 : +state.walkers,
    lean: +state.lean || 0,
    yaw: +state.yaw || 0,
    pitch: +state.pitch || 0,
    view: state.view || "rgb",
    parts: state.parts,
    overlay: state.overlay === true,
    look: state.look,
    seg: state.seg,
  });

  let bytes = new Uint8Array(0), rows = new Uint8Array(0);
  /* Copy the frame just rendered out of the GPU, rows top-down. */
  const readBack = (fb, pw, ph) => {
    const n = pw * ph * 4;
    if (bytes.length !== n) { bytes = new Uint8Array(n); rows = new Uint8Array(n); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.readPixels(0, 0, pw, ph, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const line = pw * 4;
    for (let y = 0; y < ph; y += 1) rows.set(bytes.subarray((ph - 1 - y) * line, (ph - y) * line), y * line);
    return rows;
  };

  const PICK_W = 240, PICK_H = 200;
  let picked = { key: "", data: null };

  window.BeachEnv = {
    W,
    H,
    YAW_MAX,
    PITCH_MIN,
    PITCH_MAX,
    MATERIAL,
    ready() { return !R.lost; },
    /* The world in this state, drawn pw x ph. The canvas is reused: copy it before asking again. */
    canvas(state, pw, ph) {
      if (R.lost) return null;
      render(normalise(state), pw, ph);
      if (glCanvas.width !== pw || glCanvas.height !== ph) { glCanvas.width = pw; glCanvas.height = ph; }
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, R.out.fb);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, pw, ph, 0, 0, pw, ph, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return glCanvas;
    },
    /* The same, small, as bytes: RGBA, gw x gh, rows from the top. The array is reused. */
    pixels(state, gw, gh) {
      if (R.lost) return null;
      const s = normalise(state);
      render(s, gw, gh);
      return readBack(s.view === "ids" ? R.ids.fb : R.out.fb, gw, gh);
    },
    /* Which part of the world ("beach", "sea", "walkers") is at a point of the frame. */
    pick(x, y, state) {
      if (R.lost || !(x >= 0 && x < W && y >= 0 && y < H)) return null;
      const s = normalise(state);
      s.view = "ids";
      const key = [s.time, s.hour, s.tide, s.walkers, s.lean, s.yaw, s.pitch].join("|");
      if (picked.key !== key) {
        render(s, PICK_W, PICK_H);
        picked = { key, data: readBack(R.ids.fb, PICK_W, PICK_H).slice() };
      }
      const i = (Math.floor((y / H) * PICK_H) * PICK_W + Math.floor((x / W) * PICK_W)) * 4;
      return PART_NAME[picked.data[i + 1]] || null;
    },
  };
})();
