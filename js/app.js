"use strict";
// EvoMaxx v10, the app: the world, the lava lamp, the music, the genome editor, morphing,
// discovery and the codex, on the WebGL 2 engine of js/engine.js.
const { KERNELS, DELTAS, RESPONSES, RESPONSE_FORMULAS, PHYSICS, PHYS_LIMITS, LIMITS, mulberry32, randomGenome,
        mutateGenome, normaliseGenome, localised, autonomous } = EvoMaxx;
// The default rule: the winner of the confirmation experiment (93 % of random genomes
// lifelike against 7 % for the original v1 rule; see the README): Mexican hat kernels, v1 decay,
// tangent response, hue transport.
const DEFAULT_RULE = { kernel: 7, delta: 0, response: 4, physics: 1 };

const $ = id => document.getElementById(id);
const canvas = $("view");
const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: false });
if (!gl) { document.body.innerHTML = '<p style="padding:2em;font:16px sans-serif;color:#eee">EvoMaxx needs WebGL 2. Try a current Firefox, Chrome, Edge or Safari.</p>'; throw new Error("no WebGL 2"); }
const E = EvoMaxx.engine(gl);
let rng = mulberry32(Date.now() >>> 0);
const pick = n => Math.floor(rng() * n);

const settings = { mode: "main", seedMode: "blobs", speed: 1, strength: 0.15, revive: true, ink: [1, 1, 1], testSteps: 600,
                   display: "lava", plane: { threshold: 0.4, base: 16, lift: 14, thickness: 4, softness: 1.8, bloom: 0.6, mirror: 0.5,
                            inertia: 0.6, shadow: 0.6, translucency: 0.5, fog: 0.45, azimuth: -0.95, elevation: 1.1 }, floatAuto: true,
                   follow: false, dolly: false, quality: "auto", volume: 0.5 };
const orbit = { yaw: 0.7, pitch: 0.42, distance: 260, target: [256, 256] };   // the lava-lamp camera, in cells
const planeView = () => settings.display !== "flat";
let organism = null, paused = false, main = new E.World(512);
const pool = Array.from({ length: 9 }, () => new E.World(160));
let lastHealthCheck = 0, deadChecks = 0, healthProbe = null;
// The main world's health, once a second, measured as in the experiments: snapshots at
// 0, 50 and 60 steps; motion over the 50 steps or the last 10 (whichever saw more), change
// over the last 10. With WebGPU the numbers arrive a frame or two later.
function checkHealth(now) {
  if (paused) return;
  if (!healthProbe) {
    if (now - lastHealthCheck < 1000) return;
    lastHealthCheck = now; main.measure(); healthProbe = { start: main.t, taken: 1, history: main.history };
    return;
  }
  if (healthProbe.history !== main.history) { healthProbe = null; return; }        // reseeded meanwhile
  if (healthProbe.taken < 3) {
    if (main.t >= healthProbe.start + [0, 50, 60][healthProbe.taken]) { main.measure(); healthProbe.taken++; healthProbe.last = main.t; }
    return;
  }
  if (main.pending || main.last?.t !== healthProbe.last) return;
  healthProbe = null;
  const [slow, h] = main.history.slice(-2);
  if (slow.motion > h.motion) { h.motion = slow.motion; h.drift = slow.drift; }
  h.quality = EvoMaxx.quality(h); main.health = h;
  main.history.splice(0, main.history.length - 3);
  deadChecks = h.status === "dead" ? deadChecks + 1 : 0;
  if (settings.revive && deadChecks >= 2) reseed();
}
const ui = () => ({ kernel: +$("kernel").value, delta: +$("delta").value, response: +$("response").value, physics: +$("physics").value });
(typeof EVOMAXX_PRESETS === "undefined" ? [] : EVOMAXX_PRESETS).forEach((p, i) => $("preset").add(new Option(p.name, i)));
$("preset").onchange = () => {
  const p = EVOMAXX_PRESETS[+$("preset").value];
  if (!p) return;
  settings.seedMode = p.seedMode; $("seedMode").value = p.seedMode;
  openOrganism(p.genome);
  if (typeof setMode === "function") setMode("main");
};
for (const [id, list] of [["kernel", KERNELS], ["delta", DELTAS], ["response", RESPONSES], ["physics", PHYSICS]])
  list.forEach((item, i) => $(id).add(new Option(item.name, i)));

function describeRule(g) {
  const k = KERNELS[g.kernel], d = DELTAS[g.delta];
  $("formula").textContent = `kernel: ${k.note}\ndelta: ${d.formula}\nresponse: f(z) = ${RESPONSE_FORMULAS[g.response]}` +
    (g.physics ? `\nphysics: ${PHYSICS[g.physics].formula}` : "");
}
function openOrganism(genome, reseed = true) {
  morph = null;
  organism = normaliseGenome(structuredClone(genome), rng);
  main.genome = organism;
  for (const key of ["kernel", "delta", "response", "physics"]) $(key).value = organism[key];
  describeRule(organism);
  if (reseed) main.seed(settings.seedMode, 1 + pick(1e9));
  renderGenomeEditor();
}
function reseed() { main.seed(settings.seedMode, 1 + pick(1e9)); deadChecks = 0; }

// ---- tests for discover (nine worlds stepped a few steps per frame)
// Measured 60 and 10 steps before the end and at the end; the test is over when every
// measurement has arrived (at once with WebGL, a frame or two later with WebGPU).
function runTests(steps, perFrame) {
  for (let s = 0; s < perFrame && pool[0].t < steps; s++) {
    pool.forEach(w => w.step());
    const t = pool[0].t;
    if (t === steps - 60 || t === steps - 10 || t === steps) pool.forEach(w => w.measure());
  }
  if (pool[0].t < steps || pool.some(w => w.pending || w.history.length < 3)) return false;
  pool.forEach(w => {      // keep whichever interval saw more motion, with its drift
    const [slow, h] = w.history.slice(-2);
    if (slow.motion > h.motion) { h.motion = slow.motion; h.drift = slow.drift; }
    h.quality = EvoMaxx.quality(h); w.health = h;
  });
  return true;
}

// ---- MAP-Elites: 8 hue bins x 8 activity bins (log10 change per step from -6 to -3)
const ATLAS = 8, THUMB = 96, atlas = new Array(ATLAS * ATLAS).fill(null);
const atlasCanvas = document.createElement("canvas"); atlasCanvas.width = atlasCanvas.height = ATLAS * THUMB;
const atlasImage = E.image(ATLAS * THUMB, ATLAS * THUMB);
let tested = 0, testing = false;
function startTests() {
  const seed = 1 + pick(1e9), filled = atlas.filter(Boolean);
  pool.forEach(w => { w.genome = filled.length < 9 || rng() < 0.2 ? randomGenome(rng, ui()) : mutateGenome(filled[pick(filled.length)].genome, rng, settings.strength); w.seed(settings.seedMode, seed); });
  testing = true;
}
function finishTests() {
  for (const w of pool) {
    const h = w.health;
    if (!h || h.quality <= 0) continue;
    const column = Math.min(ATLAS - 1, Math.floor(h.hue * ATLAS));
    const row = Math.min(ATLAS - 1, Math.max(0, Math.floor((Math.log10(h.change) + 6) / 3 * ATLAS)));
    const cell = row * ATLAS + column;
    if (!atlas[cell] || h.quality > atlas[cell].quality) {
      atlas[cell] = { genome: structuredClone(w.genome), quality: h.quality };
      E.pictureAsync(w, THUMB).then(c => { atlasCanvas.getContext("2d").drawImage(c, column * THUMB, (ATLAS - 1 - row) * THUMB); atlasImage.update(atlasCanvas); });
    }
  }
  tested += pool.length;
  $("tested").textContent = tested; $("filled").textContent = `${atlas.filter(Boolean).length} / 64`;
  testing = false;
}

// ---- camera (organism view)
const dpr = () => window.devicePixelRatio || 1;
const camera = { x: 256, y: 256, zoom: 1, goal: { x: 256, y: 256, zoom: 1 }, vx: 0, vy: 0 };
function resize() { canvas.width = Math.round(innerWidth * dpr()); canvas.height = Math.round(innerHeight * dpr()); }
function fit() {
  Object.assign(camera.goal, { x: main.size / 2, y: main.size / 2, zoom: Math.min(canvas.width, canvas.height) / main.size });
  Object.assign(orbit, { distance: 0.5 * main.size, target: [main.size / 2, main.size / 2] });
}
function worldAt(cx, cy, cam = camera) { return [cam.x + (cx * dpr() - canvas.width / 2) / cam.zoom, cam.y + (cy * dpr() - canvas.height / 2) / cam.zoom]; }
function updateCamera(dt) {
  if (!panning) { camera.goal.x += camera.vx * dt; camera.goal.y += camera.vy * dt; const k = Math.exp(-5 * dt); camera.vx *= k; camera.vy *= k; }
  const ease = 1 - Math.exp(-14 * dt);
  camera.zoom *= Math.pow(camera.goal.zoom / camera.zoom, ease);
  camera.x += (camera.goal.x - camera.x) * ease; camera.y += (camera.goal.y - camera.y) * ease;
}
function gridCells(count, columns) {
  const rows = Math.ceil(count / columns), gap = 8 * dpr(), usable = [canvas.width - 390 * dpr(), canvas.height];
  const side = Math.floor(Math.min((usable[0] - gap * (columns + 1)) / columns, (usable[1] - gap * (rows + 1)) / rows));
  const x0 = (usable[0] - columns * side - (columns - 1) * gap) / 2, y0 = (usable[1] - rows * side - (rows - 1) * gap) / 2;
  return Array.from({ length: count }, (_, i) => { const c = i % columns, r = Math.floor(i / columns);
    return { x: Math.round(x0 + c * (side + gap)), y: Math.round(canvas.height - y0 - (r + 1) * side - r * gap), side }; });
}
function cellUnder(e, cells) {
  const px = e.clientX * dpr(), py = canvas.height - e.clientY * dpr();
  return cells.findIndex(c => px >= c.x && px < c.x + c.side && py >= c.y && py < c.y + c.side);
}

// ---- input
let stroke = null, panning = null, orbiting = null;
// the place on the floor under the pointer, at the height where the bodies hover
const skyPoint = e => { const p = E.planePoint(orbit, e.clientX * dpr(), canvas.height - e.clientY * dpr(), canvas.width, canvas.height, settings.plane.base); return p && wrapped(p); };
let followPause = 0;
const held = new Set();
addEventListener("keyup", e => held.delete(e.key));
addEventListener("blur", () => held.clear());
const wrapped = ([x, y]) => [((x % main.size) + main.size) % main.size, ((y % main.size) + main.size) % main.size];
canvas.addEventListener("contextmenu", e => e.preventDefault());
canvas.addEventListener("pointerdown", e => {
  if (settings.mode === "discover") {
    const i = cellUnder(e, gridCells(64, 8)), cell = i < 0 ? -1 : (ATLAS - 1 - Math.floor(i / ATLAS)) * ATLAS + (i % ATLAS);
    if (cell >= 0 && atlas[cell]) { openOrganism(atlas[cell].genome); setMode("main"); }
    return;
  }
  canvas.setPointerCapture(e.pointerId);
  if (planeView()) {
    const p = e.shiftKey && e.button === 0 ? skyPoint(e) : null;
    if (p) stroke = { from: p, to: p, erase: false, sky: true };
    else { orbiting = { x: e.clientX, y: e.clientY, pan: e.button !== 0 }; followPause = performance.now(); }
    return;
  }
  if (e.button === 1 || e.button === 2) { panning = { x: e.clientX, y: e.clientY, t: performance.now() }; camera.vx = camera.vy = 0; }
  else { const p = wrapped(worldAt(e.clientX, e.clientY)); stroke = { from: p, to: p, erase: e.shiftKey }; }
});
canvas.addEventListener("pointermove", e => {
  if (orbiting) {
    const dx = e.clientX - orbiting.x, dy = e.clientY - orbiting.y;
    if (orbiting.pan) {        // move the target over the ground, in the camera's frame
      const k = orbit.distance / 900, c = Math.cos(orbit.yaw), sn = Math.sin(orbit.yaw);
      orbit.target[0] -= k * (dx * c - dy * sn); orbit.target[1] -= k * (-dx * sn - dy * c);
    } else {
      orbit.yaw -= dx * 0.005; orbit.pitch = Math.min(Math.max(orbit.pitch + dy * 0.005, 0.05), 1.5);
    }
    Object.assign(orbiting, { x: e.clientX, y: e.clientY });
    return;
  }
  if (stroke) { const p = stroke.sky ? skyPoint(e) : wrapped(worldAt(e.clientX, e.clientY)); if (!p) return; if (Math.hypot(p[0] - stroke.to[0], p[1] - stroke.to[1]) > main.size / 2) stroke.from = p; stroke.to = p; }
  if (panning) {
    const now = performance.now(), dt = Math.max((now - panning.t) / 1000, 1e-3);
    const dx = (e.clientX - panning.x) * dpr() / camera.zoom, dy = (e.clientY - panning.y) * dpr() / camera.zoom;
    camera.x -= dx; camera.y -= dy; camera.goal.x -= dx; camera.goal.y -= dy; camera.vx = -dx / dt; camera.vy = -dy / dt;
    Object.assign(panning, { x: e.clientX, y: e.clientY, t: now });
  }
});
addEventListener("pointerup", () => { stroke = null; panning = null; orbiting = null; });
canvas.addEventListener("wheel", e => {
  e.preventDefault();
  if (settings.mode !== "main") return;
  if (planeView()) { orbit.distance = Math.min(Math.max(orbit.distance * Math.exp(e.deltaY * 0.0012), 25), 3 * main.size); return; }
  const [ax, ay] = worldAt(e.clientX, e.clientY, { x: camera.goal.x, y: camera.goal.y, zoom: camera.goal.zoom });
  const zoom = Math.min(Math.max(camera.goal.zoom * Math.exp(-e.deltaY * 0.0018), 0.2), 40), k = camera.goal.zoom / zoom;
  Object.assign(camera.goal, { x: ax - (ax - camera.goal.x) * k, y: ay - (ay - camera.goal.y) * k, zoom });
}, { passive: false });
addEventListener("keydown", e => {
  if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
  const actions = { " ": () => { paused = !paused; }, n: () => { paused = true; main.step(); }, r: reseed,
    m: () => openOrganism(mutateGenome(organism, rng, settings.strength), false), x: () => openOrganism(randomGenome(rng, ui())),
    s: saveToCodex, f: fit, h: collapse, p: () => setDisplay(settings.display === "flat" ? "lava" : "flat"), v: () => setMode("main"), e: () => setMode("discover"),
    a: toggleSound, o: toggleV1, c: toggleRecording, k: () => { shotPending = true; },
    t: () => { settings.follow = !settings.follow; $("follow").checked = settings.follow; },
    g: () => { settings.dolly = !settings.dolly; $("dolly").checked = settings.dolly; } };
  if (e.key.startsWith("Arrow")) { held.add(e.key); e.preventDefault(); return; }
  const action = actions[e.key.toLowerCase()];
  if (action) { action(); e.preventDefault(); }
});

// ---- panel
const pages = [...document.querySelectorAll(".page")];
for (const page of pages) {
  const b = document.createElement("button"); b.textContent = page.dataset.tab;
  b.onclick = () => { pages.forEach(p => p.classList.toggle("on", p === page)); [...$("tabs").children].forEach(x => x.classList.toggle("on", x === b)); };
  $("tabs").append(b);
}
$("tabs").children[0].click();
function collapse() { $("side").classList.toggle("collapsed"); $("collapse").textContent = $("side").classList.contains("collapsed") ? "+" : "–"; }
$("collapse").onclick = collapse;
function setMode(mode) {
  if (mode === settings.mode) return;
  settings.mode = mode; $("mode").value = mode;
  if (mode === "discover") testing = false;
  $("labels").innerHTML = "";
}
$("mode").onchange = () => setMode($("mode").value);
for (const key of ["kernel", "delta", "response", "physics"])
  $(key).onchange = () => {
    const g = structuredClone(organism); g[key] = +$(key).value;
    // genes drawn for a v1-type delta do not suit a centred one (and the other way round)
    if (key === "delta" && DELTAS[g.delta].centred !== DELTAS[organism.delta].centred) openOrganism(randomGenome(rng, ui()));
    else openOrganism(g, false);
  };
$("seedMode").onchange = () => { settings.seedMode = $("seedMode").value; reseed(); };
$("worldSize").onchange = () => { main.dispose(); main = new E.World(+$("worldSize").value); main.genome = organism; reseed(); fit(); };
$("speed").oninput = () => { settings.speed = +$("speed").value; $("speedValue").textContent = settings.speed; };
$("strength").oninput = () => { settings.strength = $("strength").value / 100; $("strengthValue").textContent = settings.strength.toFixed(2); };
$("reseed").onclick = reseed;
$("mutate").onclick = () => openOrganism(mutateGenome(organism, rng, settings.strength), false);
$("reroll").onclick = () => openOrganism(randomGenome(rng, ui()));
$("revive").onchange = () => { settings.revive = $("revive").checked; };
$("ink").onchange = () => { settings.ink = $("ink").value.split(",").map(Number); };
$("testSteps").onchange = () => { settings.testSteps = +$("testSteps").value; };
function setDisplay(display) { settings.display = display; $("display").value = display; }
$("display").onchange = () => setDisplay($("display").value);
$("lift").oninput = () => { settings.plane.lift = +$("lift").value; $("liftValue").textContent = $("lift").value; };
$("thickness").oninput = () => { settings.plane.thickness = +$("thickness").value; $("thicknessValue").textContent = $("thickness").value; };
$("base").oninput = () => { settings.plane.base = +$("base").value; $("baseValue").textContent = $("base").value; };
$("softness").oninput = () => { settings.plane.softness = +$("softness").value; $("softnessValue").textContent = $("softness").value; };
function setFloat(value) { settings.plane.threshold = value; $("floatAt").value = value; $("floatValue").textContent = value.toFixed(2); }
$("floatAt").oninput = () => { settings.floatAuto = false; $("floatAuto").checked = false; setFloat(+$("floatAt").value); };
$("floatAuto").onchange = () => { settings.floatAuto = $("floatAuto").checked; };
$("clearAtlas").onclick = () => { atlas.fill(null); tested = 0; atlasCanvas.getContext("2d").clearRect(0, 0, atlasCanvas.width, atlasCanvas.height);
  $("tested").textContent = 0; $("filled").textContent = "0 / 64"; atlasImage.clear(); };

// ---- genome editor: every number is a slider
function slider(label, value, [lo, hi], digits, onInput) {
  const wrap = document.createElement("label"), input = document.createElement("input"), out = document.createElement("span");
  wrap.className = "slider";
  input.type = "range"; input.min = lo; input.max = hi; input.step = (hi - lo) / 400; input.value = value;
  out.textContent = (+value).toFixed(digits);
  input.oninput = () => { out.textContent = (+input.value).toFixed(digits); onInput(+input.value); };
  wrap.append(label, input, out);
  return wrap;
}
const PHYS_NAMES = { tau: "τ transport", kappa: "κ alignment", omega: "ω chirality", gamma: "γ precession", alpha: "α damping",
                     rate: "ρ game rate", reach: "r sensor reach", chem: "κ chemotaxis", swirl: "κ swirl", current: "current speed", wavelength: "current scale" };
function renderGenomeEditor() {
  const g = organism, d = DELTAS[g.delta];
  $("globals").innerHTML = `<h2>${d.name} · ${RESPONSES[g.response].name}</h2>`;
  const keys = ["speed", ...(d.centred ? [] : ["decay", "bias"]), ...(g.delta === 5 ? ["decay", "momentum"] : []),
                ...(g.delta === 6 ? ["noise"] : []), ...(g.delta === 4 ? ["bias"] : []), ...(g.delta === 8 ? ["cycle"] : []),
                ...(g.delta === 9 ? ["excite"] : [])];
  for (const key of [...new Set(keys)]) $("globals").append(slider(key, g[key], LIMITS[key], 3, v => { g[key] = v; }));
  const box = $("physicsParams");
  box.innerHTML = g.physics ? `<h2>${PHYSICS[g.physics].name}</h2>` : "";
  for (const key of PHYSICS[g.physics].params) {
    if (key !== "payoff") { box.append(slider(PHYS_NAMES[key], g.phys[key], PHYS_LIMITS[key], 3, v => { g.phys[key] = v; })); continue; }
    g.phys.payoff.forEach((a, i) => box.append(slider(`${"RGB"[Math.floor(i / 3)]} vs ${"RGB"[i % 3]}`, a, [-1.5, 1.5], 2, v => { g.phys.payoff[i] = v; })));
  }
  $("genes").innerHTML = "<h2>Genes</h2>";
  g.genes.forEach(gene => {
    const row = document.createElement("div"); row.className = "gene";
    const name = c => `<span class="ch-${"rgb"[c]}">${"RGB"[c]}</span>`;
    row.innerHTML = `<div class="wire">${name(gene.dst)} ← ${name(gene.src)}<br><span style="color:var(--dim)">kernel ${gene.ring + 1}</span></div>`;
    const controls = document.createElement("div");
    controls.append(slider("w", gene.w, LIMITS.w, 2, v => { gene.w = v; }), slider("μ", gene.mu, LIMITS.mu, 3, v => { gene.mu = v; }),
                    slider("σ", gene.sigma, LIMITS.sigma, 3, v => { gene.sigma = v; }));
    row.append(controls); $("genes").append(row);
  });
}
$("copyGenome").onclick = () => navigator.clipboard.writeText(JSON.stringify(organism));
$("pasteGenome").onclick = async () => { try { openOrganism(JSON.parse(await navigator.clipboard.readText())); } catch { alert("The clipboard does not hold a genome."); } };

// ---- codex
const CODEX_KEY = "evomaxx.codex.v5";
const readCodex = () => { try { return JSON.parse(localStorage.getItem(CODEX_KEY)) || []; } catch { return []; } };
const writeCodex = list => { try { localStorage.setItem(CODEX_KEY, JSON.stringify(list)); } catch { alert("Could not store the codex in this browser."); } };
function saveToCodex() {
  const genome = structuredClone(organism), status = main.health?.status || "?";
  E.pictureAsync(main, THUMB).then(c => {
    const list = readCodex();
    list.unshift({ name: `specimen ${list.length + 1}`, genome, status, saved: new Date().toISOString(), thumb: c.toDataURL("image/jpeg", 0.85) });
    writeCodex(list); renderCodex();
  });
}
function renderCodex() {
  const box = $("codexList"); box.innerHTML = "";
  readCodex().forEach((entry, i) => {
    const fig = document.createElement("figure");
    fig.innerHTML = `<img src="${entry.thumb}" alt=""><figcaption>${entry.name} · ${entry.status}</figcaption><button class="del" title="delete">×</button>`;
    fig.onclick = () => { openOrganism(entry.genome); setMode("main"); };
    fig.querySelector(".del").onclick = ev => { ev.stopPropagation(); const list = readCodex(); list.splice(i, 1); writeCodex(list); renderCodex(); };
    box.append(fig);
  });
}
$("save").onclick = saveToCodex;
$("share").onclick = () => navigator.clipboard.writeText(`${location.href.split("#")[0]}#g=${btoa(JSON.stringify(organism))}`);
$("export").onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(readCodex(), null, 1)], { type: "application/json" })); a.download = "evomaxx-codex.json"; a.click(); };
$("import").onclick = () => $("importFile").click();
$("importFile").onchange = async () => { try { writeCodex([...JSON.parse(await $("importFile").files[0].text()), ...readCodex()]); renderCodex(); } catch { alert("Not an EvoMaxx codex file."); } };

// ---- shared helpers
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
function download(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
const torus = d => ((d % main.size) + 1.5 * main.size) % main.size - main.size / 2;   // the shortest way round the world

// ---- morph: continuous numbers glide, discrete choices switch halfway
const lerp = (a, b, s) => a + (b - a) * s;
let morph = null, morphSeconds = 8;
function morphTo(genome, seconds, onDone = null) {
  const to = normaliseGenome(structuredClone(genome), rng), from = structuredClone(organism);
  morph = { from, to, t: 0, duration: Math.max(seconds, 0.05), onDone, switched: false };
}
function morphStep(dt) {
  if (!morph) return;
  morph.t += dt;
  const x = Math.min(morph.t / morph.duration, 1), s = x * x * (3 - 2 * x), { from, to } = morph, g = organism, late = s >= 0.5;
  for (const key of ["kernel", "delta", "response", "physics"]) g[key] = late ? to[key] : from[key];
  for (const key of EvoMaxx.GLOBALS) g[key] = lerp(from[key] ?? to[key], to[key], s);
  for (const key of Object.keys(to.phys))
    g.phys[key] = Array.isArray(to.phys[key]) ? to.phys[key].map((v, i) => lerp(from.phys[key]?.[i] ?? v, v, s)) : lerp(from.phys[key] ?? to.phys[key], to.phys[key], s);
  g.genes.forEach((gene, i) => {
    const a = from.genes[i], b = to.genes[i] ?? a;
    for (const k of ["src", "dst", "ring"]) gene[k] = late ? b[k] : a[k];
    for (const k of ["w", "mu", "sigma"]) gene[k] = lerp(a[k], b[k], s);
  });
  if (late && !morph.switched) { morph.switched = true; for (const key of ["kernel", "delta", "response", "physics"]) $(key).value = g[key]; describeRule(g); }
  if (x >= 1) { const done = morph.onDone; openOrganism(to, false); done?.(); }
}

function fillMorphList() {
  const box = $("morphInto"); box.innerHTML = "";
  (typeof EVOMAXX_PRESETS === "undefined" ? [] : EVOMAXX_PRESETS).forEach((p, i) => box.add(new Option(`preset: ${p.name}`, `p${i}`)));
  readCodex().forEach((c, i) => box.add(new Option(`codex: ${c.name}`, `c${i}`)));
}
$("morphInto").onfocus = fillMorphList;
$("morphSeconds").oninput = () => { morphSeconds = +$("morphSeconds").value; $("morphSecondsValue").textContent = morphSeconds; };
$("morphGo").onclick = () => {
  const v = $("morphInto").value; if (!v) return;
  const g = v[0] === "p" ? EVOMAXX_PRESETS[+v.slice(1)].genome : readCodex()[+v.slice(1)]?.genome;
  if (g) { setMode("main"); morphTo(g, morphSeconds); audio?.event("morph"); }
};

// ---- the original evolution: EvoMaxx v1's own loop (legacy/v1/main.py and genome.py), on
// v10's world. Counted in simulation steps, as v1 counted frames (one step per frame).
const V1 = { on: false, pool: [], cur: null, steps: 0, born: 0, extinctions: 0, flat: 0, score: null };
const uniformIn = (lo, hi) => lo + (hi - lo) * rng();
const clip = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
function v1Mutate(genome) {          // genome.py: Organism.mutate, P.mutate and R.mutate
  const g = structuredClone(genome);
  if (rng() < 0.20) {
    g.decay = clip(g.decay + uniformIn(-0.01, 0.01), 0.001, 0.20);
    g.speed = clip(g.speed + uniformIn(-0.02, 0.02), 0.01, 0.40);
    g.bias = clip(g.bias + uniformIn(-0.005, 0.005), 0.0, 0.05);
  }
  const one = () => {
    const e = g.genes[pick(g.genes.length)], r = rng();
    if (r < 0.25) e.mu = clip(e.mu + uniformIn(-0.05, 0.05), 0.01, 0.60);
    else if (r < 0.50) e.sigma = clip(e.sigma + uniformIn(-0.01, 0.01), 0.005, 0.15);
    else if (r < 0.75) e.w = clip(e.w + uniformIn(-0.2, 0.2), -1, 1);
    else e.ring = pick(3);
  };
  one();
  if (rng() < 0.15) one();
  return g;
}
function v1Cross(a, b) {             // genome.py: Organism.crossover
  const g = structuredClone(a.fit >= b.fit ? a.genome : b.genome);
  g.genes = a.genome.genes.map((e, i) => structuredClone(rng() < 0.5 ? e : b.genome.genes[i]));
  return g;
}
// main.py: score(): texture (vertical differences near 0.2), colour diversity, brightness
// near 0.35 and contrast, from every 12th cell; -10 for a black or white world, -5 for a flat one
function v1Score(px, n) {
  const S = 12, rows = [];
  for (let y = 0; y < n; y += S) { const row = []; for (let x = 0; x < n; x += S) { const i = 4 * (y * n + x); row.push([px[i], px[i + 1], px[i + 2]]); } rows.push(row); }
  const R = rows.length, C = rows[0].length, all = rows.flat(), m = all.length;
  const g = [0, 1, 2].map(k => { let d = 0; for (let r = 1; r < R; r++) for (let c = 0; c < C; c++) d += Math.abs(rows[r][c][k] - rows[r - 1][c][k]); return d / ((R - 1) * C); });
  const mean = [0, 1, 2].map(k => all.reduce((s, v) => s + v[k], 0) / m);
  const b = (mean[0] + mean[1] + mean[2]) / 3;
  const std = Math.sqrt(all.reduce((s, v) => s + (v[0] - b) ** 2 + (v[1] - b) ** 2 + (v[2] - b) ** 2, 0) / (3 * m));
  if (b < 0.005 || b > 0.995) return -10;
  if (std < 0.03) return -5;
  const chStd = [0, 1, 2].map(k => Math.sqrt(all.reduce((s, v) => s + (v[k] - mean[k]) ** 2, 0) / m));
  const meanOfMeans = b, spread = Math.sqrt(mean.reduce((s, v) => s + (v - meanOfMeans) ** 2, 0) / 3);
  return (g.reduce((s, v) => s + 1 - Math.abs(v - 0.2), 0) / 3) * 8 + spread * 6 + (1 - Math.abs(b - 0.35) * 2) * 2
       + (chStd.reduce((s, v) => s + v, 0) / 3) * 4;
}
function v1Add(org) {                // the pool keeps 12: the weakest leaves
  V1.pool.push(org);
  if (V1.pool.length > 12) V1.pool.splice(V1.pool.indexOf(V1.pool.reduce((lo, o) => (o.fit < lo.fit ? o : lo))), 1);
}
function v1Adopt(org) { V1.cur = org; V1.born++; openOrganism(org.genome, false); }      // the world is not reseeded
function v1Extinction() {            // main.py: extinction(): a fresh pool, the best kept, a fresh world
  const best = V1.pool.reduce((hi, o) => (o.fit > hi.fit ? o : hi), V1.pool[0]);
  V1.pool = Array.from({ length: 11 }, () => ({ genome: randomGenome(rng, ui()), fit: 0 })).concat([{ genome: structuredClone(best.genome), fit: best.fit }]);
  v1Adopt(V1.pool[0]); main.seed("noise", 1 + pick(1e9)); V1.extinctions++; V1.flat = 0;
}
function toggleV1() {
  V1.on = !V1.on;
  if (V1.on) {
    V1.pool = [{ genome: structuredClone(organism), fit: 0 }].concat(Array.from({ length: 11 }, () => ({ genome: randomGenome(rng, ui()), fit: 0 })));
    Object.assign(V1, { cur: V1.pool[0], steps: 0, born: 0, extinctions: 0, flat: 0, score: null });
    setMode("main");
  }
  renderV1();
}
function v1Step() {                  // main.py's loop, once per simulation step
  V1.steps++;
  if (V1.steps % 90 === 0) { const child = { genome: v1Mutate(V1.cur.genome), fit: 0 }; v1Add(child); v1Adopt(child); }
  if (V1.steps % 270 === 0 || Math.max(...V1.pool.map(o => o.fit)) < 0.5) {
    const v = [...V1.pool].sort((a, b) => b.fit - a.fit);
    if (v.length >= 2) { const child = { genome: v1Cross(v[0], v[1]), fit: 0 }; v1Add(child); v1Adopt(child); }
  }
  if (V1.steps % 60 === 0) {
    V1.score = v1Score(E.readState(main), main.size);
    V1.cur.fit = V1.cur.fit * 0.7 + V1.score * 0.3;
    V1.flat = V1.score <= -5 ? V1.flat + 1 : 0;
    if ($("v1Auto").checked && V1.flat >= 5) v1Extinction();
    renderV1();
  }
}
function renderV1() {
  $("v1Start").textContent = V1.on ? "stop the v1 evolution (o)" : "start the v1 evolution (o)";
  $("v1Status").textContent = !V1.on ? "off" : `pool ${V1.pool.length} · best fitness ${Math.max(...V1.pool.map(o => o.fit)).toFixed(2)} · `
    + `score now ${V1.score === null ? "…" : V1.score.toFixed(2)} · ${V1.born} organisms born · ${V1.extinctions} extinctions`;
}
$("v1Start").onclick = toggleV1;
$("v1Extinction").onclick = () => { if (!V1.on) toggleV1(); v1Extinction(); renderV1(); };
$("v1Rule").onclick = () => { settings.seedMode = "noise"; $("seedMode").value = "noise"; openOrganism(randomGenome(rng, { kernel: 0, delta: 0, response: 0, physics: 0 })); };

// ---- cinema: render quality, follow camera, gliding, camera shots
// Auto quality is a ladder: first the mirror floor goes (it doubles the cost), then the
// resolution, but never below 60 % of the screen: a sharp picture comes first.
const LADDER = [{ scale: 1, mirror: 1 }, { scale: 1, mirror: 0 }, { scale: 0.85, mirror: 0 }, { scale: 0.72, mirror: 0 }, { scale: 0.6, mirror: 0 }];
const cinema = { level: 0, clock: 0, frameTime: 1 / 60, goal: null, field: null, fieldClock: 0 };
function renderOptions(now, dt) {
  if (settings.quality !== "auto") return { scale: +settings.quality, mirror: settings.plane.mirror };
  cinema.frameTime += 0.1 * (dt - cinema.frameTime);
  if (now - cinema.clock > 1200) {
    cinema.clock = now;
    const rate = 1 / cinema.frameTime;
    if (rate < 30) cinema.level = Math.min(LADDER.length - 1, cinema.level + 1);
    else if (rate > 52) cinema.level = Math.max(0, cinema.level - 1);
  }
  const step = LADDER[cinema.level];
  return { scale: step.scale, mirror: settings.plane.mirror * step.mirror };
}
function followGoal(field) {         // the bright place that is brightest and nearest to where we look
  const { values, m, cell } = field, R = 0.18 * main.size, threshold = settings.plane.threshold;
  let best = 0, goal = null;
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    const b = values[j * m + i];
    if (b < threshold) continue;
    const dx = torus((i + 0.5) * cell - orbit.target[0]), dz = torus((j + 0.5) * cell - orbit.target[1]);
    const score = b * Math.exp(-(dx * dx + dz * dz) / (2 * R * R));
    if (score > best) { best = score; goal = [orbit.target[0] + dx, orbit.target[1] + dz]; }
  }
  return goal;
}
function glide(dt, now) {
  const x = (held.has("ArrowRight") ? 1 : 0) - (held.has("ArrowLeft") ? 1 : 0), y = (held.has("ArrowUp") ? 1 : 0) - (held.has("ArrowDown") ? 1 : 0);
  if (x || y) {
    followPause = now;
    if (planeView()) {
      const v = 0.7 * orbit.distance * dt, c = Math.cos(orbit.yaw), s = Math.sin(orbit.yaw);
      orbit.target[0] += v * (x * c - y * s); orbit.target[1] += v * (-x * s - y * c);
    } else { const v = 0.6 * canvas.height / camera.zoom * dt; camera.goal.x += x * v; camera.goal.y -= y * v; }
  }
  if (planeView() && settings.follow && cinema.goal && now - followPause > 3000) {
    const k = 1 - Math.exp(-0.7 * dt);
    orbit.target[0] += (cinema.goal[0] - orbit.target[0]) * k; orbit.target[1] += (cinema.goal[1] - orbit.target[1]) * k;
  }
}
$("follow").onchange = () => { settings.follow = $("follow").checked; };
for (const key of ["inertia", "elevation", "azimuth", "shadow", "translucency", "fog"])
  $(key).oninput = () => { settings.plane[key] = +$(key).value; $(key + "Value").textContent = $(key).value; };
$("dolly").onchange = () => { settings.dolly = $("dolly").checked; };
// camera shots: the orbit glides to a framing in a second and a half
const SHOTS = { overview: { pitch: 0.42, distance: 0.5 }, glide: { pitch: 0.1, distance: 0.2 }, macro: { pitch: 0.3, distance: 0.08 },
                horizon: { pitch: 0.035, distance: 0.32 }, above: { pitch: 1.25, distance: 0.75 } };
let shot = null;
function takeShot(name) {
  const to = SHOTS[name];
  setDisplay("lava");
  shot = { t: 0, from: { pitch: orbit.pitch, distance: orbit.distance }, to: { pitch: to.pitch, distance: to.distance * main.size } };
}
document.querySelectorAll("[data-shot]").forEach(b => { b.onclick = () => takeShot(b.dataset.shot); });
function cameraMoves(dt) {
  if (shot) {
    shot.t = Math.min(shot.t + dt / 1.5, 1);
    const s = shot.t * shot.t * (3 - 2 * shot.t);
    orbit.pitch = lerp(shot.from.pitch, shot.to.pitch, s);
    orbit.distance = Math.exp(lerp(Math.log(shot.from.distance), Math.log(shot.to.distance), s));
    if (shot.t >= 1) shot = null;
  }
  if (settings.dolly && planeView()) {        // forward over the floor, the way the camera faces; never turning
    const v = 0.08 * orbit.distance * dt;
    orbit.target[0] -= v * Math.sin(orbit.yaw); orbit.target[1] -= v * Math.cos(orbit.yaw);
  }
}
$("bloom").oninput = () => { settings.plane.bloom = +$("bloom").value; $("bloomValue").textContent = settings.plane.bloom.toFixed(2); };
$("mirror").oninput = () => { settings.plane.mirror = +$("mirror").value; $("mirrorValue").textContent = settings.plane.mirror.toFixed(2); };
$("quality").onchange = () => { settings.quality = $("quality").value; };

// ---- music (evomaxx-audio.js): the world plays itself
const MUSIC_KEY = "evomaxx.music.v2";
let musicAdvancedOpen = false;
const music = (() => { try { const saved = JSON.parse(localStorage.getItem(MUSIC_KEY));
  if (saved) return Object.assign(EvoMaxxAudio.presetSettings("EvoMaxx"), saved); } catch { /* none saved */ }
  return EvoMaxxAudio.presetSettings("EvoMaxx"); })();
let audio = null;
function musicChanged() {
  audio?.load(music);
  try { localStorage.setItem(MUSIC_KEY, JSON.stringify(music)); } catch { /* private window */ }
}
function toggleSound() {
  if (!audio) audio = EvoMaxxAudio.create(music);
  else if (audio.ctx.state === "running") audio.ctx.suspend(); else audio.ctx.resume();
  setTimeout(() => { const on = audio.ctx.state === "running";
    $("sound").textContent = on ? "■ stop (a)" : "▶ play the world (a)"; $("sound").classList.toggle("on", on); }, 60);
}
// stereo position of a place in the world, as heard from the camera
function panOf(b) {
  if (planeView()) return Math.max(-1, Math.min(1, (torus(b.x - orbit.target[0]) * Math.cos(orbit.yaw) - torus(b.z - orbit.target[1]) * Math.sin(orbit.yaw)) / (0.5 * orbit.distance)));
  return Math.max(-1, Math.min(1, torus(b.x - camera.x) * camera.zoom / (0.5 * canvas.width)));
}
function listen(field) {
  audio?.update({ field, health: main.health, genome: organism, threshold: settings.plane.threshold, panOf });
}

// the Music tab, built from a schema: [label, path, kind, options]
function bind(path) {
  const keys = path.split("."), last = keys.pop();
  const holder = () => keys.reduce((o, k) => o[k], music);
  return { get: () => holder()[last], set: v => { holder()[last] = v; musicChanged(); } };
}
function control(label, path, kind, options = {}) {
  const { get, set } = bind(path), row = document.createElement("label");
  row.className = kind === "check" ? "toggle" : "slider";
  const name = document.createElement("span"); name.textContent = label;
  if (kind === "check") {
    const box = document.createElement("input"); box.type = "checkbox"; box.checked = get(); box.onchange = () => set(box.checked);
    row.append(box, name); return row;
  }
  row.append(name);
  let input;
  if (kind === "select") {
    input = document.createElement("select");
    options.values.forEach(v => input.add(new Option(options.names?.[v] ?? v, v)));
    input.value = get(); input.onchange = () => set(options.number ? +input.value : input.value);
  } else {
    input = document.createElement("input"); input.type = "range";
    Object.assign(input, { min: options.min ?? 0, max: options.max ?? 1, step: options.step ?? 0.01, value: get() });
    const out = document.createElement("span"); out.className = "value";
    const show = () => { out.textContent = options.format ? options.format(+input.value) : (+input.value).toFixed(options.digits ?? 2); };
    input.oninput = () => { set(+input.value); show(); }; show();
    row.append(input, out); return row;
  }
  row.append(input);
  return row;
}
function instrumentPicker(i) {
  const row = document.createElement("label"), select = document.createElement("select"), c = music.channels[i];
  row.className = "slider";
  row.innerHTML = `<span>instrument</span>`;
  select.add(new Option("by the organism", "organism"));
  for (const [family, names] of Object.entries(EvoMaxxAudio.FAMILIES)) {
    const group = document.createElement("optgroup"); group.label = family;
    names.forEach(n => group.append(new Option(n, n))); select.append(group);
  }
  select.value = c.follow !== false && music.organism ? "organism" : c.instrument;
  select.onchange = () => {
    if (select.value === "organism") { c.follow = true; music.organism = true; }
    else { c.follow = false; c.instrument = select.value; }
    musicChanged(); renderMusic();
  };
  select.dataset.channel = i;
  row.append(select);
  return row;
}
// "energy" and "space": one slider each over several settings
function macro(label, value, onInput) {
  const row = document.createElement("label"), input = document.createElement("input");
  row.className = "slider"; row.innerHTML = `<span>${label}</span>`;
  Object.assign(input, { type: "range", min: 0, max: 1, step: 0.01, value });
  input.oninput = () => { onInput(+input.value); musicChanged(); };
  row.append(input);
  return row;
}
const section = (title, ...rows) => { const box = document.createElement("div"); box.innerHTML = `<h2>${title}</h2>`; box.append(...rows); return box; };
const pair = (...rows) => { const box = document.createElement("div"); box.className = "grid2"; box.append(...rows); return box; };
function renderMusic() {
  const A = EvoMaxxAudio, root = $("music");
  root.innerHTML = "";
  // ---- the simple view
  const simple = document.createElement("div");
  simple.append(control("the organism chooses its sound: it evolves as the organism does", "organism", "check"),
                control("harmony follows colour: hue picks the key, the colour balance the chords", "harmony", "check"));
  const now = document.createElement("div"); now.className = "note"; now.id = "musicNow"; simple.append(now);
  const picks = document.createElement("div");
  music.channels.forEach((c, i) => {
    const strip = document.createElement("div"); strip.className = `strip ch${i}`;
    strip.innerHTML = `<header><span class="ch-${"rgb"[i]}">${"RGB"[i]}</span><div class="meter"><div id="meter${i}" style="background:${["#ff6b6b", "#6bff8f", "#6b9bff"][i]}"></div></div></header>`;
    strip.querySelector("header").append(control("mute", `channels.${i}.mute`, "check"));
    strip.append(pair(instrumentPicker(i), control("level", `channels.${i}.volume`, "range")));
    picks.append(strip);
  });
  simple.append(picks,
    pair(control("volume", "volume", "range"), control("tempo (when you choose)", "tempo", "range", { min: 40, max: 200, step: 1, digits: 0 })),
    pair(macro("energy: notes and drums", (music.box.notes - 1) / 5, v => { music.box.notes = 1 + Math.round(5 * v); music.rhythm.level = 0.2 + 0.8 * v; }),
         macro("space: delay and reverb", music.fx.wet, v => { music.fx.wet = v; music.channels.forEach(c => { c.send = 0.15 + 0.7 * v; }); })));
  root.append(simple);
  // ---- everything else
  const details = document.createElement("details"), summary = document.createElement("summary");
  summary.textContent = "Advanced: every detail"; details.append(summary);
  details.open = musicAdvancedOpen; details.ontoggle = () => { musicAdvancedOpen = details.open; };
  root.append(details);
  const box = details;
  if (music.organism) {
    const note = document.createElement("div"); note.className = "note";
    note.textContent = "The organism is choosing the tempo, scale, swing, drum style and melody order, and for each chemical that follows it the instrument, octave, filter and envelope. Switch it off (or pick an instrument) to set those here.";
    box.append(note);
  }
  box.append(section("Transport",
    pair(control("volume", "volume", "range"), control("tempo", "tempo", "range", { min: 40, max: 200, step: 1, digits: 0 })),
    pair(control("swing", "swing", "range", { max: 0.6 }), control("range (octaves)", "range", "range", { min: 1, max: 5, step: 1, digits: 0 }))));
  box.append(section("Harmony",
    pair(control("key", "key", "select", { values: ["auto", ...A.KEYS], names: { auto: "auto: the hue" } }),
         control("scale", "scale", "select", { values: Object.keys(A.SCALES) })),
    control("tuning", "tuning", "select", { values: Object.keys(A.TUNINGS), names: { equal: "equal temperament", just: "just intonation", pythagorean: "Pythagorean" } })));
  const strips = document.createElement("div");
  strips.innerHTML = "<h2>Channels: one strip per chemical</h2>";
  music.channels.forEach((c, i) => {
    const strip = document.createElement("div"); strip.className = `strip ch${i}`;
    strip.innerHTML = `<header><span class="ch-${"rgb"[i]}">${"RGB"[i]}</span></header>`;
    const head = strip.querySelector("header");
    head.append(control("mute", `channels.${i}.mute`, "check"), control("solo", `channels.${i}.solo`, "check"));
    strip.append(pair(instrumentPicker(i),
                      control("octave", `channels.${i}.octave`, "range", { min: -2, max: 2, step: 1, digits: 0 })),
                 pair(control("level", `channels.${i}.volume`, "range"), control("pan", `channels.${i}.pan`, "range", { min: -1, max: 1 })),
                 pair(control("filter", `channels.${i}.cutoff`, "range"), control("resonance", `channels.${i}.resonance`, "range")),
                 pair(control("attack", `channels.${i}.attack`, "range", { max: 1.5 }), control("release", `channels.${i}.release`, "range", { min: 0.2, max: 4 })),
                 control("effects send", `channels.${i}.send`, "range"));
    strips.append(strip);
  });
  box.append(strips);
  box.append(section("Music box: a bar sweeps the world and plays it",
    pair(control("on", "box.on", "check"), control("axis", "box.axis", "select", { values: ["x", "y"] })),
    control("show the bar in the world", "box.show", "check"),
    pair(control("steps per sweep", "box.steps", "select", { values: [8, 16, 32, 64], number: true }),
         control("notes per step", "box.notes", "range", { min: 1, max: 6, step: 1, digits: 0 }))));
  box.append(section("Genome melody: the eight genes as a sequence",
    pair(control("on", "melody.on", "check"), control("order", "melody.order", "select", { values: A.ORDERS })),
    pair(control("rate", "melody.rate", "select", { values: [1, 2, 4, 8], number: true, names: { 1: "1/16", 2: "1/8", 4: "1/4", 8: "1/2" } }),
         control("gate", "melody.gate", "range", { min: 0.25, max: 3 }))));
  box.append(section("Births, drone, drums",
    pair(control("bells for new bodies", "births.on", "check"), control("drone", "drone.on", "check")),
    pair(control("drone level", "drone.level", "range"), control("drums", "rhythm.style", "select", { values: A.RHYTHMS })),
    control("drum level", "rhythm.level", "range")));
  box.append(section("Effects",
    pair(control("delay", "fx.delay", "select", { values: A.DELAYS }), control("feedback", "fx.feedback", "range", { max: 0.9 })),
    pair(control("reverb (s)", "fx.reverb", "range", { min: 0.3, max: 9, step: 0.1, digits: 1 }), control("reverb mix", "fx.wet", "range")),
    pair(control("drive", "fx.drive", "range"), control("tone", "fx.tone", "range"))));
  const io = section("Out and in");
  const midiRow = document.createElement("label"); midiRow.className = "row";
  midiRow.innerHTML = `<span>MIDI out (R, G, B: channels 1-3, drums 10)</span>`;
  const midiSelect = document.createElement("select"); midiSelect.add(new Option("off", ""));
  midiSelect.onfocus = async () => {
    try { if (!audio) toggleSound(); const outs = await audio.midiOutputs(); const v = midiSelect.value;
      midiSelect.length = 1; outs.forEach(o => midiSelect.add(new Option(o.name, o.id))); midiSelect.value = v; }
    catch (e) { midiSelect.title = e.message; midiSelect.options[0].text = "unavailable: " + e.message; }
  };
  midiSelect.onchange = () => audio?.setMidiOutput(midiSelect.value);
  midiRow.append(midiSelect);
  const micRow = document.createElement("label"); micRow.className = "row";
  micRow.innerHTML = `<span>microphone feeds the world (bass red, mids green, treble blue)</span><input type="checkbox" id="mic">`;
  io.append(midiRow, micRow);
  box.append(io);
  micRow.querySelector("input").onchange = async e => {
    if (!e.target.checked) { audio?.stopMic(); return; }
    if (!audio) toggleSound();
    try { await audio.startMic(); } catch (err) { e.target.checked = false; alert("No microphone: " + err.message); }
  };
}
Object.keys(EvoMaxxAudio.PRESETS).forEach(name => $("musicPreset").add(new Option(`preset: ${name}`, name)));
$("musicPreset").onchange = () => {
  const keep = { volume: music.volume };      // a preset is a sound; the organism's own is the first
  Object.assign(music, EvoMaxxAudio.presetSettings($("musicPreset").value), keep);
  musicChanged(); renderMusic();
};
$("sound").onclick = toggleSound;
renderMusic();

// the note roll and the meters (drawn while the Music tab is open)
function describeMusic() {
  const box = $("musicNow"); if (!box) return;
  const v = audio?.voice ?? EvoMaxxAudio.organismVoice(organism), p = audio?.playing;
  const names = [0, 1, 2].map(i => p ? p.channels[i].instrument : (music.organism && music.channels[i].follow !== false ? v.channels[i].instrument : music.channels[i].instrument));
  const tempo = p ? p.tempo : music.organism ? v.tempo : music.tempo, scale = p ? p.scale : music.organism ? v.scale : music.scale;
  box.innerHTML = `now: <span class="ch-r">${names[0]}</span> · <span class="ch-g">${names[1]}</span> · <span class="ch-b">${names[2]}</span> · ${tempo} bpm · ${scale}${audio ? ` in ${audio.key}` : ""}`;
  document.querySelectorAll("#music select[data-channel]").forEach(sel => {
    const opt = sel.options[0]; opt.text = `by the organism (${v.channels[+sel.dataset.channel].instrument})`; });
}
let describeClock = 0;
function drawRoll() {
  if (performance.now() - describeClock > 500 && $("music").offsetParent) { describeClock = performance.now(); describeMusic(); }
  if (!audio || !$("roll").offsetParent) return;
  const c = $("roll"), g = c.getContext("2d"), w = c.width = c.clientWidth * dpr(), h = c.height = 120 * dpr();
  const now = audio.ctx.currentTime, span = 8, colours = ["#ff6b6b", "#6bff8f", "#6b9bff"];
  g.fillStyle = "#08080e"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#ffffff22"; g.fillRect(w - 1, 0, 1, h);
  for (const n of audio.roll) {
    const x = w - (now - n.t) / span * w; if (x < 0 || n.t > now + 0.2) continue;
    const y = h - (Math.min(Math.max(n.midi, 24), 108) - 24) / 84 * h;
    g.fillStyle = colours[n.c]; g.globalAlpha = 0.35 + 0.65 * n.v; g.fillRect(x, y - 2 * dpr(), 6 * dpr(), 4 * dpr());
  }
  const p = audio.playing, caption = `${audio.key} ${p.scale} · ${p.tempo} bpm`;
  g.globalAlpha = 1; g.font = `${10 * dpr()}px monospace`;
  g.fillStyle = "#08080ee0"; g.fillRect(0, h - 16 * dpr(), g.measureText(caption).width + 12 * dpr(), 16 * dpr());
  g.fillStyle = "#c9c4ff"; g.fillText(caption, 6 * dpr(), h - 5 * dpr());
  audio.levels().forEach((v, i) => { const m = $(`meter${i}`); if (m) m.style.width = `${Math.min(100, 140 * v)}%`; });
}

// where the music box bar is (cells along its axis), or -1
function scanCells() {
  const f = audio && music.box.show ? audio.scanNow() : -1;
  return f < 0 ? -1 : f * main.size;
}
function drawScanLine() {                // the bar in the flat view
  const line = $("scanline"), x = settings.mode === "main" && !planeView() ? scanCells() : -1;
  if (x < 0) { line.style.display = "none"; return; }
  const vertical = music.box.axis === "x", centre = vertical ? camera.x : camera.y, extent = vertical ? canvas.width : canvas.height;
  const sx = (extent / 2 + (x - centre) * camera.zoom) / dpr(), period = main.size * camera.zoom / dpr(), at = `${((sx % period) + period) % period}px`;
  Object.assign(line.style, vertical ? { display: "block", left: at, top: "0", width: "2px", height: "100vh" }
                                     : { display: "block", top: at, left: "0", height: "2px", width: "100vw" });
}
// the microphone: a surge in a band drops ink of its chemical near the middle of the view
let micClock = 0;
function micDrop(now) {
  const bands = audio?.mic ? audio.micBands() : null;
  if (!bands || now - micClock < 90) return null;
  const c = [0, 1, 2].reduce((a, b) => (bands.surge[b] * bands.energy[b] > bands.surge[a] * bands.energy[a] ? b : a));
  if (bands.surge[c] < 1.5 || bands.energy[c] < 0.12) return null;
  micClock = now;
  const a = rng() * 2 * Math.PI, r = Math.sqrt(rng()) * (planeView() ? 0.35 * orbit.distance : 0.25 * main.size);
  const centre = planeView() ? orbit.target : [camera.x, camera.y], ink = [0, 0, 0]; ink[c] = 1;
  const at = wrapped([centre[0] + r * Math.cos(a), centre[1] + r * Math.sin(a)]);
  return { from: at, to: at, radius: 3 + 14 * bands.energy[c] * Math.min(bands.surge[c], 3) / 3, ink, erase: false };
}

// ---- capture
let recorder = null, shotPending = false;
function toggleRecording() {
  if (recorder) { recorder.stop(); return; }
  const stream = canvas.captureStream(60);
  if (audio) audio.tape.stream.getAudioTracks().forEach(t => stream.addTrack(t));
  const type = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find(t => MediaRecorder.isTypeSupported(t));
  const chunks = [];
  recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 16e6 });
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = () => { download(new Blob(chunks, { type: "video/webm" }), `evomaxx-${stamp()}.webm`); recorder = null; $("record").textContent = "record video (c)"; };
  recorder.start(1000); recorder.started = performance.now();
  $("record").textContent = "stop recording (c)";
}
$("record").onclick = toggleRecording;
$("recordAudio").onclick = () => {
  if (!audio) toggleSound();
  const started = audio.toggleRecording(blob => { download(blob, `evomaxx-${stamp()}.webm`); $("recordAudio").textContent = "record music"; });
  if (started) $("recordAudio").textContent = "■ stop music recording";
};
$("shot").onclick = () => { shotPending = true; };

// ---- which GPU: an integrated one cannot keep up with the lava lamp at full quality
(() => {
  let name = "";
  if (gl) { const info = gl.getExtension("WEBGL_debug_renderer_info"); name = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER); }
  if (!/intel|iris|uhd|hd graphics|llvmpipe|swiftshader|software/i.test(name)) return;
  const box = $("gpuWarning");
  box.innerHTML = `Your browser is drawing on an integrated GPU (<i>${name}</i>), so the lava lamp runs slowly.
    If the computer has a second, dedicated GPU, let the browser use it (Windows: Settings → Display → Graphics;
    Linux: PRIME offload, see open-on-nvidia.sh).<button>ok</button>`;
  box.style.display = "block";
  box.querySelector("button").onclick = () => { box.style.display = "none"; };
})();

// ---- main loop
let last = performance.now(), frames = 0, fps = 0, fpsClock = last;
function describe(h) {
  if (!h) return "measuring…";
  const colour = h.status === "alive" ? "#6ff0e0" : h.status === "noise" ? "#ffcf6e" : "#ff6b6b";
  return `<span style="color:${colour}">${h.status}</span> · contrast ${h.std.toFixed(3)} · motion ${(100 * h.motion).toFixed(0)}%` +
         (h.motion > 0.2 ? ` (${h.drift > 0.75 ? "drifting as one" : "own ways"})` : "") + ` · empty ${(100 * h.emptiness).toFixed(0)}%`;
}
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1); last = now;
  E.beginFrame(0.02, 0.02, 0.03);
  let line;
  if (settings.mode === "main") {
    morphStep(dt); glide(dt, now); cameraMoves(dt); updateCamera(dt);
    const brush = stroke ? { ...stroke, radius: stroke.sky ? Math.max(4, orbit.distance / 40) : Math.max(3, 10 / camera.zoom), ink: settings.ink } : micDrop(now);
    if (!paused) for (let i = 0; i < settings.speed; i++) { if (V1.on) v1Step(); main.step(i === 0 ? brush : null); }
    else if (brush) main.step(brush);
    if (stroke) stroke.from = stroke.to;
    checkHealth(now);
    if (settings.floatAuto && main.health?.level75 > 0) setFloat(Math.min(Math.max(main.health.level75, 0.2), 0.95));
    if ((settings.follow || audio) && now - cinema.fieldClock > 200) {
      cinema.fieldClock = now;
      cinema.field = E.brightness(main, Math.max(0, Math.log2(main.size / 32)));
      if (cinema.field) {
        if (settings.follow) cinema.goal = followGoal(cinema.field) ?? cinema.goal;
        listen(cinema.field);
      }
    }
    if (planeView()) {
      E.drawPlane(main, 0, 0, canvas.width, canvas.height, orbit, { ...settings.plane, ...renderOptions(now, dt), dt, scan: scanCells(), scanAxis: music.box.axis === "y" ? 1 : 0 });
    } else E.drawWorld(main, 0, 0, canvas.width, canvas.height, [camera.x, camera.y], camera.zoom);
    line = `<b>${KERNELS[organism.kernel].name}</b> · ${DELTAS[organism.delta].name} · ${RESPONSES[organism.response].name} · ${PHYSICS[organism.physics].name} · t ${main.t.toLocaleString()} · ${describe(main.health)}${paused ? " · paused" : ""}`;
  } else if (settings.mode === "discover") {
    if (!testing) startTests();
    if (runTests(settings.testSteps, 20)) finishTests();
    gridCells(64, 8).forEach((c, i) => {
      const column = i % ATLAS, row = ATLAS - 1 - Math.floor(i / ATLAS);
      E.drawWorld(null, c.x, c.y, c.side, c.side, [(column + 0.5) * THUMB, (ATLAS - 1 - row + 0.5) * THUMB], c.side / THUMB,
                  atlas[row * ATLAS + column] ? 0 : 1, null, atlasImage.tex, ATLAS * THUMB);
    });
    line = `<b>discover</b> · ${tested} tested · ${atlas.filter(Boolean).length}/64 cells · columns: hue · rows: activity (calm at the bottom)`;
  }
  E.endFrame();
  drawScanLine(); drawRoll();
  if (shotPending) { shotPending = false; canvas.toBlob(b => download(b, `evomaxx-${stamp()}.png`)); }
  if (V1.on && settings.mode === "main") line += ` · <b>v1 evolution</b>: ${V1.born} born, score ${V1.score === null ? "…" : V1.score.toFixed(1)}`;
  if (morph && settings.mode === "main") line += ` · <b>morphing</b> ${Math.round(100 * Math.min(morph.t / morph.duration, 1))} %`;
  if (planeView() && settings.mode === "main" && settings.quality === "auto" && cinema.level > 0)
    line += ` · <span title="auto quality: the GPU is too slow for everything">${cinema.level === 1 ? "mirror off" : `mirror off, ${Math.round(100 * LADDER[cinema.level].scale)} % resolution`}</span>`;
  if (recorder) line += ` · <span style="color:#ff5b5b">● REC ${Math.floor((now - recorder.started) / 1000)} s</span>`;
  frames++;
  if (now - fpsClock > 500) { fps = frames * 1000 / (now - fpsClock); frames = 0; fpsClock = now; }
  $("hud").innerHTML = `${line} · ${fps.toFixed(0)} fps`;
  requestAnimationFrame(frame);
}

resize(); addEventListener("resize", resize);
const shared = /#g=(.+)$/.exec(location.hash);
let start = randomGenome(rng, DEFAULT_RULE);
if (shared) { try { start = JSON.parse(atob(shared[1])); } catch { /* ignore a broken link */ } }
openOrganism(start); fit(); camera.x = camera.goal.x; camera.y = camera.goal.y; camera.zoom = camera.goal.zoom;
renderCodex(); fillMorphList();
requestAnimationFrame(frame);
