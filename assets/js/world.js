/* The hero figure: a moment at the beach, written as a program that keeps running.
 *
 * This file is the stage: it reads the parameters from the snippet in _includes/world.html,
 * keeps time, handles the controls, and asks a scene to draw each frame. The picture itself
 * (sky, sea, sand, the person) is drawn by a scene: one file per art style in
 * assets/js/scenes/, each exposing
 * window.BeachScene = { W, H, draw(ctx, state), hit(x, y), pick(x, y, state) }.
 * The same world, drawn by different renderers: the style picker above the code selects one, and
 * the others are fetched only when asked for. Behind the person, all of them show one 3D world
 * (assets/js/beach-env.js, WebGL 2), which is why the picture can be dragged to look around;
 * where that is not available each renderer paints a flat backdrop of its own.
 *
 * Besides the picture ("rgb") and the buffers ("normal", "depth", "seg"), a scene can draw its
 * own construction ("wire"): the world as the program holds it, before it is painted. The stage
 * uses it twice. In the opening, each part of the world is built as the line of code that makes
 * it is written, and then the picture is rendered in over it. Afterwards, pointing at a part of
 * the picture (or at its line of code) outlines that part and lights up the line.
 *
 * In the snippet, numbers are sliders (drag, or focus and use the arrow keys) and quoted
 * values are switches. Lines that make a part of the world carry data-part. */
(() => {
  "use strict";

  const figure = document.querySelector("[data-world]");
  if (!figure) return;
  const canvas = figure.querySelector("canvas");
  const ctx = canvas && canvas.getContext && canvas.getContext("2d");
  if (!ctx) return;

  const still = figure.querySelector(".world__still");
  const hints = figure.querySelectorAll("[data-world-hint]");
  const stylePicker = figure.querySelector("[data-world-styles]");
  const styleInputs = stylePicker.querySelectorAll('input[type="radio"]');
  const styleValue = figure.querySelector("[data-world-style-value]");
  const controls = figure.querySelector("[data-world-controls]");
  const playButton = figure.querySelector("[data-world-play]");
  const track = figure.querySelector("[data-world-track]");
  const thumb = figure.querySelector("[data-world-thumb]");
  const clock = figure.querySelector("[data-world-clock]");
  const elapsed = figure.querySelector("[data-world-elapsed]");
  const lines = Array.from(figure.querySelectorAll(".world__code .ln"));
  const numbers = Array.from(figure.querySelectorAll("[data-param]"));
  const switches = Array.from(figure.querySelectorAll("[data-option]"));
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const W = 480; // every scene draws the same frame
  const H = 400;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /* ---------- Scenes: one renderer per style, fetched on demand ---------- */

  const scenes = {}; // style -> scene
  const loading = {}; // style -> promise
  let scene = null; // the one on stage

  const sceneDir = figure.dataset.scenes || "assets/js/scenes/";
  const version = figure.dataset.version ? `?v=${figure.dataset.version}` : "";
  const scriptAt = src => new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src + version;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.append(script);
  });

  /* Once the page is idle, fetch the other renderers into the browser cache (without running
     them), so that a change of style does not wait for the network. Skipped for visitors who
     asked to save data. */
  let warmed = false;
  const warmScenes = () => {
    if (warmed) return;
    warmed = true;
    const connection = navigator.connection;
    if (connection && (connection.saveData || /2g/.test(connection.effectiveType || ""))) return;
    const idle = window.requestIdleCallback || ((run) => setTimeout(run, 1200));
    idle(() => {
      const files = Array.from(styleInputs, (input) => input.value)
        .filter((style) => !scenes[style])
        .map((style) => `${style}.js`);
      if (!window.BeachPortrait) files.push("../beach-portrait.js");
      files.forEach((file) => {
        const link = document.createElement("link");
        link.rel = "prefetch";
        link.as = "script";
        link.href = sceneDir + file + version;
        document.head.append(link);
      });
    });
  };

  /* The 3D world the renderers share. It is optional: a browser without WebGL 2, or a visitor
     saving data, gets the renderers' own flat backdrops. */
  let worldReady;
  const loadWorld = () => {
    if (worldReady) return worldReady;
    const connection = navigator.connection;
    const skip = window.BeachEnv || (connection && connection.saveData);
    worldReady = skip ? Promise.resolve() : scriptAt(sceneDir + "../beach-env.js").catch(() => {});
    return worldReady;
  };
  const turns = () => (window.BeachEnv && window.BeachEnv.ready() ? window.BeachEnv : null); // the camera can turn in it

  let portraitReady;
  const loadScene = (style) => {
    if (scenes[style]) return Promise.resolve(scenes[style]);
    if (loading[style]) return loading[style];
    const needsPortrait = style === "pixel" || style === "ascii";
    if (needsPortrait && !window.BeachPortrait && !portraitReady) {
      portraitReady = scriptAt(sceneDir + "../beach-portrait.js").catch(error => {
        portraitReady = null;
        throw error;
      });
    }
    const ready = needsPortrait ? portraitReady : undefined;
    loading[style] = Promise.all([ready, loadWorld()])
      .then(() => scriptAt(sceneDir + style + ".js"))
      .then(() => {
        const loaded = window.BeachScene;
        if (!loaded || typeof loaded.draw !== "function" || loaded.style !== style) {
          throw new Error(`Scene "${style}" did not initialize`);
        }
        scenes[style] = loaded;
        return loaded;
      })
      .finally(() => { delete loading[style]; });
    return loading[style];
  };

  /* ---------- Parameters live in the markup ---------- */

  const params = {};
  const spec = {};
  numbers.forEach((el) => {
    const name = el.dataset.param;
    spec[name] = {
      el,
      min: Number(el.dataset.min),
      max: Number(el.dataset.max),
      step: Number(el.dataset.step),
      wrap: el.dataset.wrap !== undefined,
      digits: (String(el.dataset.step).split(".")[1] || "").length,
    };
    params[name] = Number(el.textContent);
  });
  const options = {};
  switches.forEach((el) => {
    options[el.dataset.option] = el.textContent.trim();
  });
  const param = (name, fallback) => (name in params ? params[name] : fallback);
  const option = (name, fallback) => (name in options ? options[name] : fallback);

  /* ---------- Which line of the program makes which part of the world ---------- */

  const wired = (which = scene) => Boolean(which) && typeof which.pick === "function"; // it can draw its own construction
  const PARTS = ["beach", "sea", "walkers", "person"];
  const firstLine = {}; // part -> index of the first line of code that makes it
  lines.forEach((line, k) => {
    const part = line.dataset.part;
    if (part && !(part in firstLine)) firstLine[part] = k;
  });
  const only = (part) => {
    const parts = { beach: 0, sea: 0, walkers: 0, person: 0 };
    if (part) parts[part] = 1;
    return parts;
  };

  const state = {
    seconds: 0, // since the shutter
    playing: false,
    lean: 0, // the camera nudged sideways, -1..1
    yaw: 0, // the camera turned to the right, radians
    pitch: 0, // and tilted up
    hello: -1, // seconds into a wave of the hand, or -1
    intro: null,
    focus: null, // the part being pointed at, outlined over the picture
    swap: null, // a change of style in progress: { from, at }
  };

  /* What a scene is asked to draw. */
  const sceneState = (time, view) => ({
    time,
    hour: param("hour", 13.2),
    wind: param("wind", 0.3),
    tide: param("tide", 0.4),
    swell: param("swell", 0.5),
    walkers: Math.round(param("walkers", 2)),
    hoodie: option("hoodie", "charcoal"),
    glasses: option("glasses", "True") === "True",
    smile: param("smile", 0.8),
    lean: state.lean,
    yaw: state.yaw,
    pitch: state.pitch,
    hello: state.hello,
    view,
  });

  /* ---------- One frame ---------- */

  let scale = 1;
  let shownTime = 0; // scene time of the frame on screen

  const paint = (time, view, extra, which = scene, target = ctx) => {
    target.save();
    target.beginPath();
    target.rect(0, 0, W, H);
    target.clip();
    which.draw(target, Object.assign(sceneState(time, view), extra));
    target.restore();
  };

  // The shutter is still during the reveal. Print each completed layer once
  // at device resolution, then slide the clip across the two prints.
  const printLayer = view => {
    const layer = document.createElement("canvas");
    layer.width = canvas.width;
    layer.height = canvas.height;
    const target = layer.getContext("2d");
    target.scale(scale, scale);
    paint(0, view, null, scene, target);
    return layer;
  };

  /* Draw `over` on top of what is there, up to a bright edge travelling from left to right. */
  const sweep = (amount, over) => {
    const edge = amount * (W + 60) - 30;
    if (edge <= 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, edge, H);
    ctx.clip();
    over();
    ctx.restore();
    if (edge < W) {
      const glow = ctx.createLinearGradient(edge - 14, 0, edge + 1, 0);
      glow.addColorStop(0, "rgba(255,255,255,0)");
      glow.addColorStop(1, "rgba(236,251,246,0.50)");
      ctx.fillStyle = glow;
      ctx.fillRect(edge - 14, 0, 15, H);
    }
  };

  const draw = (time) => {
    if (!scene) return;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, W, H);
    shownTime = time;
    const view = option("view", "rgb");
    const intro = state.intro;

    if (intro) {
      const under = wired() ? "wire" : "depth";
      if (intro.reveal === 0) {
        paint(0, under, { parts: intro.parts });
        return;
      }
      const key = [scene.style, scale, ...Object.values(sceneState(0, view))].join("|");
      if (intro.prints?.key !== key) {
        intro.prints = { key, under: printLayer(under), over: printLayer(view) };
      }
      ctx.drawImage(intro.prints.under, 0, 0, W, H);
      sweep(intro.reveal, () => ctx.drawImage(intro.prints.over, 0, 0, W, H));
      return;
    }

    if (state.swap) {
      // a change of style: the same moment, rendered again by the new renderer
      paint(time, view, null, state.swap.from);
      sweep(state.swap.reveal, () => paint(time, view));
      return;
    }

    paint(time, view);
    if (state.focus && state.hello < 0) paint(time, "wire", { overlay: true, parts: only(state.focus) });
  };

  const resize = () => {
    // Budget physical pixels against the displayed card, including narrow phones.
    const width = canvas.parentElement.clientWidth;
    if (!width) return false;
    const density = Math.min(2.5, window.devicePixelRatio || 1);
    const pixels = Math.max(1, Math.round(Math.min(W, width) * density));
    if (pixels === canvas.width && scale === pixels / W) return false;
    scale = pixels / W;
    canvas.width = pixels;
    canvas.height = Math.round(H * scale);
    return true;
  };

  /* ---------- Time ---------- */

  let dirty = true;
  let shownFrame = -1;
  let dragging = false;

  let displayedHour = -1;
  let displayedTenths = -1;
  const paintHud = () => {
    const hour = param("hour", 13.2);
    if (hour !== displayedHour) {
      displayedHour = hour;
      const minutes = Math.round(hour * 60) % 1440;
      const text = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
      if (clock) clock.textContent = text;
      if (thumb) thumb.style.left = `${(hour / 24) * 100}%`;
      if (track) {
        track.setAttribute("aria-valuenow", hour.toFixed(1));
        track.setAttribute("aria-valuetext", text);
      }
    }
    const tenths = Math.round(state.seconds * 10);
    if (elapsed && tenths !== displayedTenths) {
      displayedTenths = tenths;
      elapsed.textContent = `shutter +${(tenths / 10).toFixed(1)} s`;
    }
  };

  const render = () => {
    const fps = param("fps", 12);
    const frame = Math.floor(state.seconds * fps);
    // A wave already requests a draw on its own clock. Sample the current
    // beach frame on that draw instead of adding a second, interleaved repaint.
    if (!dirty && (frame === shownFrame || state.hello >= 0)) return;
    dirty = false;
    shownFrame = frame;
    draw(frame / fps);
    paintHud();
  };

  const refresh = () => {
    dirty = true;
    render();
  };

  let raf = 0;
  let last = 0;
  let visible = true;

  const busy = () => state.playing || state.intro || state.swap || state.hello >= 0 || state.lean !== 0 || dragging;

  const loop = () => {
    if (raf) return;
    if (!scene || !visible || document.hidden || !busy()) { last = 0; return; }
    if (!last) last = performance.now();
    raf = requestAnimationFrame(tick);
  };

  const halt = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
  };

  const setPlaying = (playing) => {
    state.playing = playing;
    if (playButton) {
      playButton.dataset.playing = String(playing);
      playButton.setAttribute("aria-label", playing ? "Pause the scene" : "Let the scene run");
    }
    if (playing) loop();
  };

  /* ---------- The opening: the program is written, its world is built, then rendered ---------- */

  const WRITING = 2.2; // seconds for the lines of code to appear
  const BUILD = { beach: 0.7, sea: 0.7, walkers: 0.5, person: 1.1 }; // seconds to draw each part in
  const SWEEP = 1.1; // seconds for the picture to sweep in
  const SWAP = 0.9; // seconds for a change of style to sweep in

  const lineAt = (k) => (k / lines.length) * WRITING; // when line k appears
  const built = (part, at) => (part in firstLine ? clamp((at - lineAt(firstLine[part])) / BUILD[part], 0, 1) : 1);
  const sweepAt = () =>
    wired()
      ? Math.max(WRITING * 0.75, ...PARTS.map((part) => (part in firstLine ? lineAt(firstLine[part]) + BUILD[part] + 0.15 : 0)))
      : WRITING * 0.72;

  const showLines = (count) => lines.forEach((line, k) => line.classList.toggle("is-waiting", k >= count));

  const finishIntro = () => {
    state.intro = null;
    showLines(lines.length);
    setPlaying(true);
    refresh();
    warmScenes();
  };

  const stepIntro = (delta) => {
    const intro = state.intro;
    intro.at += delta;
    showLines(Math.ceil(clamp(intro.at / WRITING, 0, 1) * lines.length));
    PARTS.forEach((part) => (intro.parts[part] = built(part, intro.at)));
    const t = clamp((intro.at - intro.sweepAt) / SWEEP, 0, 1);
    intro.reveal = t * t * (3 - 2 * t);
    dirty = true;
    if (t >= 1) finishIntro();
  };

  const startIntro = () => {
    state.intro = { at: 0, reveal: 0, parts: only(null), sweepAt: sweepAt() };
    setFocus(null);
    showLines(0);
    refresh();
    loop();
  };

  function tick(now) {
    raf = 0;
    const delta = clamp((now - last) / 1000, 0, 0.05); // a frame can carry a timestamp from just before it was asked for
    last = now;
    if (state.playing) state.seconds += delta;
    if (state.hello >= 0) {
      const previous = state.hello;
      state.hello += delta;
      if (state.hello > 2.6) state.hello = -1;
      // Keep the beach on its chosen frame clock. Sample the visitor's
      // gesture independently so wrist and fingertip arcs remain readable.
      if (Math.floor(previous * 30) !== Math.floor(state.hello * 30)) dirty = true;
    }
    if (!dragging && state.lean !== 0) {
      state.lean *= Math.pow(0.004, delta); // the camera drifts back to where it stood
      if (Math.abs(state.lean) < 0.002) state.lean = 0;
      dirty = true;
    }
    if (state.swap) {
      state.swap.at += delta;
      const t = clamp(state.swap.at / SWAP, 0, 1);
      state.swap.reveal = t * t * (3 - 2 * t);
      if (t >= 1) state.swap = null;
      dirty = true;
    }
    if (state.intro) stepIntro(delta);
    render();
    loop();
  }

  /* ---------- A change of style ---------- */

  let wanted = null; // the style most recently asked for

  const showStyle = (style) => {
    figure.dataset.style = style;
    styleValue.textContent = style;
    styleInputs.forEach(input => { input.checked = input.value === style; });
  };

  const setStyle = (style) => {
    wanted = style;
    showStyle(style);
    if (!scenes[style]) stylePicker.setAttribute("aria-busy", "true"); // on its way
    loadScene(style)
      .finally(() => {
        if (wanted === style) stylePicker.removeAttribute("aria-busy");
      })
      .then((next) => {
        if (wanted !== style || next === scene) return; // overtaken by a later choice
        const from = scene;
        scene = next;
        setFocus(null);
        if (from && !state.intro && !reducedMotion.matches) state.swap = { from, at: 0, reveal: 0 };
        refresh();
        loop();
      })
      .catch(() => {
        if (wanted !== style || !scene) return;
        wanted = scene.style || initial;
        showStyle(wanted);
      });
  };

  styleInputs.forEach(input => {
    input.addEventListener("change", () => { if (input.checked) setStyle(input.value); });
  });

  /* ---------- Controls ---------- */

  /* Anything that slides: drag horizontally, or use the arrow keys. */
  const slider = (el, { min, max, step, travel, get, set, wrap }) => {
    el.setAttribute("role", "slider");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-valuemin", min);
    el.setAttribute("aria-valuemax", max);
    el.setAttribute("aria-valuenow", get());

    const apply = (value) => {
      const span = max - min;
      set(wrap ? min + ((((value - min) % span) + span) % span) : clamp(value, min, max));
    };

    let drag = null;
    el.addEventListener("pointerdown", (event) => {
      drag = { x: event.clientX, value: get() };
      el.setPointerCapture(event.pointerId);
      el.classList.add("is-active");
      event.preventDefault();
    });
    el.addEventListener("pointermove", (event) => {
      if (drag) apply(drag.value + ((event.clientX - drag.x) / travel()) * (max - min));
    });
    const release = () => {
      drag = null;
      el.classList.remove("is-active");
    };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);

    el.addEventListener("keydown", (event) => {
      const big = (max - min) / 10;
      const moves = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: big, PageDown: -big };
      if (event.key in moves) apply(get() + moves[event.key]);
      else if (event.key === "Home") apply(min);
      else if (event.key === "End") apply(wrap ? max - step : max);
      else return;
      event.preventDefault();
    });
  };

  const setParam = (name, value) => {
    const { el, step, digits } = spec[name];
    const snapped = Number((Math.round(value / step) * step).toFixed(digits));
    if (snapped === params[name]) return;
    params[name] = snapped;
    el.textContent = snapped.toFixed(digits);
    el.setAttribute("aria-valuenow", snapped);
    refresh();
  };

  numbers.forEach((el) => {
    const name = el.dataset.param;
    const { min, max, step, wrap } = spec[name];
    el.setAttribute("aria-label", el.dataset.label || name);
    slider(el, { min, max, step, wrap, travel: () => 200, get: () => params[name], set: (value) => setParam(name, value) });
  });

  switches.forEach((el) => {
    const name = el.dataset.option;
    const values = el.dataset.values.split(",");
    const label = el.dataset.label || name;
    const set = (value) => {
      options[name] = value;
      el.textContent = value;
      el.setAttribute("aria-label", `${label}: ${value}. Activate to change.`);
      refresh();
    };
    const step = (by) => set(values[(values.indexOf(options[name]) + by + values.length) % values.length]);
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.addEventListener("click", () => step(1));
    el.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " " || event.key === "ArrowRight") step(1);
      else if (event.key === "ArrowLeft") step(-1);
      else return;
      event.preventDefault();
    });
    if (!values.includes(options[name])) options[name] = values[0];
    el.textContent = options[name];
    el.setAttribute("aria-label", `${label}: ${options[name]}. Activate to change.`);
  });

  if (track && spec.hour) {
    track.setAttribute("aria-label", "Time of day");
    slider(track, {
      min: 0,
      max: 24,
      step: 0.25,
      wrap: true,
      travel: () => track.getBoundingClientRect().width,
      get: () => params.hour,
      set: (value) => setParam("hour", value % 24),
    });
    // a click on the track jumps there
    track.addEventListener(
      "pointerdown",
      (event) => {
        const rect = track.getBoundingClientRect();
        setParam("hour", clamp((event.clientX - rect.left) / rect.width, 0, 0.9999) * 24);
      },
      true
    );
  }

  if (playButton) {
    playButton.addEventListener("click", () => {
      if (state.intro) finishIntro();
      else setPlaying(!state.playing);
    });
  }

  /* On the picture: drag to look around, click the person to say hi. */
  const toFrame = (event) => {
    const rect = canvas.getBoundingClientRect();
    return [((event.clientX - rect.left) / rect.width) * W, ((event.clientY - rect.top) / rect.height) * H];
  };
  let grab = null;

  canvas.addEventListener("pointerdown", (event) => {
    if (!scene) return;
    const skipping = Boolean(state.intro); // a touch during the opening only ends the opening
    if (skipping) finishIntro();
    const [x, y] = toFrame(event);
    grab = { x: event.clientX, y: event.clientY, moved: skipping, lean: state.lean, yaw: state.yaw, pitch: state.pitch, fx: x, fy: y };
    dragging = true;
    canvas.classList.add("is-active");
    canvas.setPointerCapture(event.pointerId);
    loop();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!grab) return pointAt(event);
    const dx = event.clientX - grab.x;
    const dy = event.clientY - grab.y;
    const world = turns();
    if (Math.abs(dx) > 3 || (world && Math.abs(dy) > 3)) grab.moved = true;
    if (grab.moved) {
      setFocus(null);
      state.lean = clamp(grab.lean + dx / 160, -1, 1);
      if (world) {
        // the world is held by the pointer: one frame unit of drag turns the camera by one frame unit of view
        const perPixel = W / canvas.getBoundingClientRect().width / 520;
        state.yaw = clamp(grab.yaw - dx * perPixel, -world.YAW_MAX, world.YAW_MAX);
        state.pitch = clamp(grab.pitch + dy * perPixel, world.PITCH_MIN, world.PITCH_MAX);
      }
    }
    refresh();
  });
  const letGo = () => {
    if (grab && !grab.moved && state.hello < 0 && scene && scene.hit(grab.fx, grab.fy)) {
      state.hello = 0;
      refresh();
    }
    grab = null;
    dragging = false;
    canvas.classList.remove("is-active");
    loop();
  };
  canvas.addEventListener("pointerup", letGo);
  canvas.addEventListener("pointercancel", () => { grab = null; letGo(); });

  /* Pointing at a part of the picture, or at the line of code that makes it, outlines the part
     and lights up the line. Only for a mouse or pen hovering, and keyboard focus in the code. */
  function setFocus(part) {
    const next = wired() && part in firstLine ? part : null;
    if (state.focus === next) return;
    state.focus = next;
    lines.forEach((line) => line.classList.toggle("is-focus", next !== null && line.dataset.part === next));
    refresh();
  }

  function pointAt(event) {
    if (!wired() || state.intro || state.swap || event.pointerType === "touch") return;
    const [x, y] = toFrame(event);
    setFocus(scene.pick(x, y, sceneState(shownTime, option("view", "rgb"))));
  }

  canvas.addEventListener("pointerleave", () => {
    if (!grab) setFocus(null);
  });

  lines.forEach((line) => {
    const part = line.dataset.part;
    if (!part) return;
    line.addEventListener("pointerenter", (event) => {
      if (!state.intro && event.pointerType !== "touch") setFocus(part);
    });
    line.addEventListener("pointerleave", () => setFocus(null));
    line.addEventListener("focusin", () => setFocus(part));
    line.addEventListener("focusout", () => setFocus(null));
  });

  // from the keyboard: arrows turn the camera, Enter or Space says hi
  canvas.setAttribute("tabindex", "0");
  canvas.addEventListener("keydown", (event) => {
    if (!scene) return;
    const world = turns();
    const turn = (by) => {
      state.lean = clamp(state.lean - by * 0.5, -1, 1);
      if (world) state.yaw = clamp(state.yaw + by * 0.12, -world.YAW_MAX, world.YAW_MAX);
    };
    if (event.key === "ArrowLeft") turn(-1);
    else if (event.key === "ArrowRight") turn(1);
    else if (event.key === "ArrowUp" && world) state.pitch = clamp(state.pitch + 0.05, world.PITCH_MIN, world.PITCH_MAX);
    else if (event.key === "ArrowDown" && world) state.pitch = clamp(state.pitch - 0.05, world.PITCH_MIN, world.PITCH_MAX);
    else if (event.key === "Enter" || event.key === " ") {
      if (state.hello < 0) state.hello = 0;
    } else return;
    event.preventDefault();
    refresh();
    loop();
  });

  /* ---------- Go: once the first scene has arrived ---------- */

  const start = (first) => {
    scene = first;
    resize();
    setPlaying(false);
    showStyle(first.style || initial);
    stylePicker.hidden = false;
    hints.forEach(hint => { hint.hidden = false; });
    // the caption turns from a description of the still picture into how to use the live one
    figure.querySelectorAll("[data-world-still]").forEach(note => { note.hidden = true; });
    figure.querySelectorAll("[data-world-turns]").forEach(note => { note.hidden = !turns(); });
    if (controls) controls.hidden = false;
    showLines(lines.length);

    // Measure bootstrap latency now, not when the visitor scrolls to the
    // figure. Once the fallback has been readable, keep all its lines visible.
    const fallbackAt = performance.getEntriesByName("first-contentful-paint")[0]?.startTime
      ?? performance.getEntriesByType("navigation")[0]?.domInteractive;
    const inTimeForIntro = !fallbackAt || performance.now() - fallbackAt < 450;
    let started = false;
    const begin = () => {
      if (started) return;
      started = true;
      if (reducedMotion.matches) {
        refresh();
        warmScenes();
      } else if (inTimeForIntro) startIntro();
      else finishIntro();
      canvas.hidden = false;
      if (still) still.hidden = true;
    };

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(
        (entries) => {
          // several reports can arrive at once; only the latest says where things stand now
          visible = entries[entries.length - 1].isIntersecting;
          if (!visible) return halt();
          begin();
          loop();
        },
        { threshold: 0.2 }
      ).observe(canvas.parentElement);
    } else {
      begin();
    }
    document.addEventListener("visibilitychange", () => (document.hidden ? halt() : loop()));
    const fit = () => { if (resize() && started) refresh(); };
    if ("ResizeObserver" in window) new ResizeObserver(fit).observe(canvas.parentElement);
    window.addEventListener("resize", fit);
  };

  // a scene already on the page (a plain <script> before this one) is used as it is
  const initial = styleValue.textContent.trim();
  wanted = initial;
  if (typeof window.BeachScene?.draw === "function" && (!window.BeachScene.style || window.BeachScene.style === initial)) {
    scenes[initial] = window.BeachScene;
    start(window.BeachScene);
  } else {
    loadScene(initial)
      .then(start)
      .catch(() => {
        /* without a scene the still image simply stays */
      });
  }
})();
