"use strict";
// EvoMaxx v10 engine: an RGB chemistry on the GPU (WebGL 2).
//
// The state of a cell is a colour x = (r, g, b) in [0, 1]^3: three chemicals, nothing else.
// Each step:
//   1. three neighbourhood fields N0, N1, N2 (one kernel family, three sizes);
//   2. eight genes: gene i adds w_i f((N_ring[src] - mu) / sigma) to channel dst;
//   3. a delta (update rule) turns the summed growth into the new colour;
//   4. optional colour physics: local colour terms, then mass-conserving transport.
// Also here: the health measures of a world (from block statistics), the flat view and the
// lava lamp (a ray-marched view of the world as an endless floor with floating wax).
const EvoMaxx = (() => {

// =============================================================== catalogue
const shell = r => (r > 0 && r < 1) ? Math.exp(4 - 1 / (r * (1 - r))) : 0;      // Lenia bump
const disc = (d, R) => Math.min(Math.max(R + 0.5 - d, 0), 1);                    // anti-aliased disc
const gauss = (d, s) => Math.exp(-0.5 * (d / s) ** 2);
const SHELLS = [3, 5.5, 8];

// Kernel families: three kernels each (near, mid, far), as weights on a 17 x 17 stencil.
// "signed" kernels sum to zero (positive and negative parts normalised to +1 and -1) and
// are read with an offset of 0.5, so that their potential still lies around [0, 1].
const KERNELS = [
  { name: "box (v1)", note: "3×3 and 7×7 boxes and a 7×7 lattice of spacing 2: the original EvoMaxx v1" },
  { name: "dense box", note: "3×3, 7×7 and 13×13 boxes, every cell counted",
    w: (x, y) => [1, 3, 6].map(R => +(Math.max(Math.abs(x), Math.abs(y)) <= R)) },
  { name: "disc", note: "round discs with the area of the v1 boxes",
    w: (x, y, d) => [1.7, 3.95, 7.3].map(R => disc(d, R)) },
  { name: "Gaussian", note: "Gaussian blurs, σ = 0.9, 2, 3.7",
    w: (x, y, d) => [0.9, 2.0, 3.7].map(s => gauss(d, s)) },
  { name: "Lenia shell", note: "smooth rings of radius 3, 5.5, 8 (Chan 2019)",
    w: (x, y, d) => SHELLS.map(R => shell(d / R)) },
  { name: "double shell", note: "two concentric rings",
    w: (x, y, d) => SHELLS.map(R => Math.exp(-((((d / R) - 0.3) / 0.1) ** 2)) + 0.6 * Math.exp(-((((d / R) - 0.75) / 0.1) ** 2))) },
  { name: "thin ring", note: "sharp annuli at 2, 4.5, 7.5",
    w: (x, y, d) => [2, 4.5, 7.5].map(R => Math.exp(-(((d - R) / 0.7) ** 2))) },
  { name: "Mexican hat", note: "centre minus surround (difference of Gaussians), signed", signed: true,
    w: (x, y, d) => [0.8, 1.6, 3.0].map(s => gauss(d, s) - gauss(d, 2 * s)) },
  { name: "exponential", note: "heavy tails, exp(−d/λ)",
    w: (x, y, d) => [0.7, 1.6, 3.2].map(l => Math.exp(-d / l)) },
  { name: "plus", note: "the arms of a cross: only along the axes",
    w: (x, y, d) => [1, 3, 6].map(R => +((Math.abs(x) < 0.5 || Math.abs(y) < 0.5) && d <= R)) },
  { name: "hexagonal shell", note: "rings with six-fold symmetry (crystal-like)",
    w: (x, y, d) => SHELLS.map(R => shell(d / R) * Math.max(0, 1 + 0.8 * Math.cos(6 * Math.atan2(y, x)))) },
  { name: "spiral shell", note: "rings with a spiral arm: chiral sensing",
    w: (x, y, d) => SHELLS.map(R => shell(d / R) * Math.max(0.05, 1 + 0.9 * Math.sin(Math.atan2(y, x) + 2 * Math.PI * d / R))) },
  { name: "dipole", note: "east minus west: directional sensing, signed", signed: true,
    w: (x, y, d) => SHELLS.map(R => shell(d / R) * (d > 0 ? x / d : 0)) },
  // V10
  { name: "Bessel rings", note: "J₀(2πd/λ) e^(−(d/R)²), λ = 2.5, 4, 6: oscillating rings (the kernel of quasicrystals), signed", signed: true,
    w: (x, y, d) => [[2.5, 3], [4, 5.5], [6, 8]].map(([l, R]) => besselJ0(2 * Math.PI * d / l) * Math.exp(-((d / R) ** 2))) },
  { name: "phyllotaxis", note: "taps on the sunflower spiral (golden angle 137.5°, r = c√n): chiral and anisotropic",
    grid: () => phyllotaxis() },
  { name: "power law", note: "scale-free (d + 1)^(−α), α = 3, 2, 1.2: no characteristic size",
    w: (x, y, d) => [3, 2, 1.2].map(a => (d + 1) ** -a) },
  { name: "gaze", gaze: true, note: "anisotropic: each cell senses rings of radius 2.5, 5, 7.5 weighted towards the direction of its own hue (von Mises, κ = 4 × saturation)",
    w: (x, y, d) => [2.5, 5, 7.5].map(R => Math.exp(-(((d - R) / 1.2) ** 2))) },
];
// Bessel function J0 (Abramowitz & Stegun 9.4.1 and 9.4.3)
function besselJ0(x) {
  const ax = Math.abs(x);
  if (ax <= 3) { const y = (x / 3) ** 2;
    return 1 + y * (-2.2499997 + y * (1.2656208 + y * (-0.3163866 + y * (0.0444479 + y * (-0.0039444 + y * 0.0002100))))); }
  const y = 3 / ax;
  const f = 0.79788456 + y * (-0.00000077 + y * (-0.00552740 + y * (-0.00009512 + y * (0.00137237 + y * (-0.00072805 + y * 0.00014476)))));
  const t = ax - 0.78539816 + y * (-0.04166397 + y * (-0.00003954 + y * (0.00262573 + y * (-0.00054125 + y * (-0.00029333 + y * 0.00013558)))));
  return f * Math.cos(t) / Math.sqrt(ax);
}
// Vogel's model of the sunflower: point n at radius c√n, angle n × 137.508°, splatted
// bilinearly onto the stencil; near, mid and far kernels end at radius 3, 5.5 and 8.
function phyllotaxis() {
  const n = 2 * KR + 1, out = Array.from({ length: n * n }, () => [0, 0, 0]), golden = Math.PI * (3 - Math.sqrt(5));
  [3, 5.5, 8].forEach((R, k) => {
    for (let i = 1; ; i++) {
      const r = 0.9 * Math.sqrt(i); if (r > R) break;
      const px = KR + r * Math.cos(i * golden), py = KR + r * Math.sin(i * golden), x0 = Math.floor(px), y0 = Math.floor(py);
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const wx = dx ? px - x0 : 1 - (px - x0), wy = dy ? py - y0 : 1 - (py - y0), x = x0 + dx, y = y0 + dy;
        if (x >= 0 && y >= 0 && x < n && y < n) out[y * n + x][k] += wx * wy;
      }
    }
  });
  return out;
}
const KR = 8;   // stencil radius of the texture kernels
const GAZE = KERNELS.findIndex(k => k.gaze);

// The weights of a kernel family on the (2 KR + 1)^2 stencil, as rgba (near, mid, far, 0)
// row by row, each kernel normalised (signed ones: positive and negative parts to +-1).
// The v1 boxes are weights too: a 3 x 3 and a 7 x 7 box and a 7 x 7 lattice of spacing 2.
function kernelWeights(index) {
  const n = 2 * KR + 1, data = new Float32Array(n * n * 4);
  const v1 = (x, y) => [+(Math.abs(x) <= 1 && Math.abs(y) <= 1), +(Math.abs(x) <= 3 && Math.abs(y) <= 3),
                        +(x % 2 === 0 && y % 2 === 0 && Math.abs(x) <= 6 && Math.abs(y) <= 6)];
  const family = KERNELS[index], weights = index === 0 ? v1 : family.w, grid = family.grid?.();
  const plus = [0, 0, 0], minus = [0, 0, 0];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = x - KR, dy = y - KR, w = grid ? grid[y * n + x] : weights(dx, dy, Math.hypot(dx, dy));
    for (let c = 0; c < 3; c++) { data[4 * (y * n + x) + c] = w[c]; if (w[c] > 0) plus[c] += w[c]; else minus[c] -= w[c]; }
  }
  for (let i = 0; i < n * n; i++) for (let c = 0; c < 3; c++) {
    const v = data[4 * i + c];
    data[4 * i + c] = v > 0 ? v / plus[c] : (v < 0 ? v / minus[c] : 0);
    if (Math.abs(data[4 * i + c]) < 1e-6) data[4 * i + c] = 0;      // let the shader skip it
  }
  return data;
}

// Deltas: how the summed growth G changes a colour. "centred" deltas expect growth
// around zero, so responses in [0, 1] are mapped to [-1, 1] for them (as in Lenia).
const DELTAS = [
  { name: "v1 decay", formula: "x ← x(1 − d) + s(b + G)", centred: false },
  { name: "Lenia", formula: "x ← x + s G", centred: true },
  { name: "asymptotic", formula: "x ← x + s (½ + ½ tanh 2G − x)", centred: true },
  { name: "logit", formula: "logit x ← logit x + 4 s G", centred: true },
  { name: "multiplicative", formula: "x ← x e^(2sG) + s b / 10", centred: true },
  { name: "momentum", formula: "x ← x + β(x − x_prev) + s G − d x", centred: true },
  { name: "noisy v1", formula: "x ← x(1 − d) + s(b + G) + η ξ", centred: false },
  { name: "zero-sum", formula: "x ← x + s (G − mean_c G)", centred: true },
  // V10
  { name: "cyclic dominance", formula: "x_c ← x_c(1 − d) + s(b + G_c) + ρ x_c (x_c+1 − x_c−1): rock-paper-scissors (May–Leonard), R eats G eats B eats R", centred: false },
  { name: "Nagumo", formula: "x ← x + s (G + 4x(1 − x)(x − a)): an excitable, bistable medium", centred: true },
];

// Responses f(z), z = (N - mu) / sigma; "unipolar" ones lie in [0, 1].
const RESPONSES = [
  { name: "Gaussian", unipolar: true }, { name: "sine" }, { name: "band", unipolar: true },
  { name: "triangle", unipolar: true }, { name: "tangent" }, { name: "wavelet" },
  { name: "logistic", unipolar: true }, { name: "bistable cubic" }, { name: "Lorentzian", unipolar: true },
  { name: "bimodal", unipolar: true }, { name: "sinc" }, { name: "triangle wave", unipolar: true },
  { name: "Gabor" }, { name: "chirp" },
  { name: "Hill", unipolar: true }, { name: "logistic map", unipolar: true },     // V10
];
const RESPONSE_FORMULAS = ["e^(−z²)", "sin z", "1 if μ ≤ N ≤ μ+σ", "max(0, 1 − |z|)", "clip(tan z, ±2)",
  "e^(−z²) cos 2z", "1 / (1 + e^(−z))", "z(1 − z²), |z| ≤ 1.2", "1 / (1 + z²)", "e^(−(|z| − 1.5)²)",
  "sin πz / πz", "1 − |(z mod 2) − 1|", "sin z · e^(−z²/4)", "sin(z|z|)", "z⁴ / (1 + z⁴) for z > 0",
  "L(L(u)), u = 1/(1 + e^(−z)), L(u) = 3.9u(1 − u): chaotic"];

// Colour physics: local colour terms (2-4) and mass-conserving transport (1, 2, 5-7).
const PHYSICS = [
  { name: "none", params: [] },
  { name: "hue transport", params: ["tau"], formula: "every cell moves by v = τ chroma / max(r,g,b): hue is heading, saturation speed" },
  { name: "colour flocking", params: ["tau", "kappa", "omega"], formula: "hue turns towards the neighbourhood hue (Δθ = κ|c_N| sin(θ_N − θ) + ω), then hue transport" },
  { name: "colour precession", params: ["gamma", "alpha"], formula: "m = 2x − 1 rotates about h = 2N − 1 by γ|h|; m ← m + α(h − m)" },
  { name: "colour game", params: ["rate", "payoff"], formula: "replicator dynamics on the colour mix, payoff matrix A" },
  { name: "chemotaxis", params: ["chem"], formula: "matter moves up (or down) the gradient of brightness: v = κ∇L" },
  { name: "swirl", params: ["swirl"], formula: "matter circles bright regions: v = κ (−∂L/∂y, ∂L/∂x)" },
  { name: "currents", params: ["current", "wavelength"], formula: "an external, slowly changing divergence-free flow carries the matter" },
  { name: "physarum", params: ["tau", "kappa", "omega", "reach"], formula: "matter senses ahead-left and ahead-right along its hue heading (at distance r), turns its hue towards its own kind (Δθ = κ (s_L − s_R)/(s_L + s_R) + ω), then moves with hue transport: slime mould on the colour wheel" },
];
const PHYS_RANGES = { tau: [0.1, 0.8], kappa: [0.02, 0.3], omega: [-0.03, 0.03], gamma: [0.05, 0.6], alpha: [0, 0.1],
                      rate: [0.05, 0.5], chem: [-30, 30], swirl: [-30, 30], current: [0.1, 0.8], wavelength: [16, 64], reach: [3, 10] };
const PHYS_LIMITS = { tau: [0, 1], kappa: [0, 0.6], omega: [-0.1, 0.1], gamma: [0, 1.2], alpha: [0, 0.3],
                      rate: [0, 1], chem: [-60, 60], swirl: [-60, 60], current: [0, 1], wavelength: [8, 128], reach: [1.5, 14] };

// Gene parameter ranges. v1-type deltas use v1's ranges; centred deltas use balanced,
// Lenia-like genes (mostly excitatory, weights summing to one per destination channel).
const RANGES = { decay: [0.01, 0.10], speed: [0.05, 0.25], bias: [0.005, 0.02],
                 w: [-1, 1], mu: [0.10, 0.45], sigma: [0.01, 0.12], momentum: [0.3, 0.9], noise: [0.005, 0.05],
                 cycle: [0.05, 0.4], excite: [0.15, 0.45] };
const LIMITS = { decay: [0, 0.2], speed: [0.01, 0.4], bias: [0, 0.04], w: [-1.5, 1.5], mu: [-0.2, 0.8],
                 sigma: [0.005, 0.25], momentum: [0, 0.98], noise: [0, 0.1], cycle: [0, 0.8], excite: [0, 0.6] };
const GLOBALS = ["decay", "speed", "bias", "momentum", "noise", "cycle", "excite"];     // the genome's global numbers

// =============================================================== genomes
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
                 t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function tools(rng) {
  const uniform = ([lo, hi]) => lo + (hi - lo) * rng();
  return { uniform, pick: n => Math.floor(rng() * n),
           gauss: () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng()) };
}
const clamp = (v, [lo, hi]) => Math.min(Math.max(v, lo), hi);

function randomGenome(rng, { kernel = 0, delta = 0, response = 0, physics = 0 } = {}) {
  const { uniform, pick } = tools(rng);
  const centred = DELTAS[delta].centred;
  const genes = Array.from({ length: 8 }, () => centred
    ? { src: pick(3), dst: pick(3), ring: pick(3), w: (rng() < 0.8 ? 1 : -0.5) * uniform([0.3, 1]),
        mu: uniform([0.12, 0.35]), sigma: uniform([0.015, 0.06]) }
    : { src: pick(3), dst: pick(3), ring: pick(3), w: uniform(RANGES.w), mu: uniform(RANGES.mu), sigma: uniform(RANGES.sigma) });
  if (centred) for (let c = 0; c < 3; c++) {
    const mine = genes.filter(e => e.dst === c), total = mine.reduce((s, e) => s + Math.abs(e.w), 0);
    mine.forEach(e => { e.w /= total; });
  }
  // signed kernels read around 0.5, so their genes look there (a fair test of them)
  if (KERNELS[kernel].signed) genes.forEach(e => { e.mu = uniform([0.4, 0.62]); });
  const phys = Object.fromEntries(Object.entries(PHYS_RANGES).filter(([k]) => k !== "reach").map(([k, r]) => [k, uniform(r)]));
  phys.payoff = Array.from({ length: 9 }, () => uniform([-1, 1]));
  const g = { version: 10, kernel, delta, response, physics, genes, phys,
              decay: uniform(RANGES.decay), speed: centred ? uniform([0.08, 0.2]) : uniform(RANGES.speed),
              bias: uniform(RANGES.bias), momentum: uniform(RANGES.momentum), noise: uniform(RANGES.noise) };
  // V10 parameters, drawn after all earlier ones: a seed gives the same genome as before
  phys.reach = uniform(PHYS_RANGES.reach); g.cycle = uniform(RANGES.cycle); g.excite = uniform(RANGES.excite);
  return g;
}

// Genomes saved by V5 and V6 carry an engine instead of kernel and delta (0 the original v1 rule, 1 Lenia).
function normaliseGenome(g, rng = Math.random) {
  if (g.version >= 10) return g;
  if (g.version >= 7) {          // V7: the V10 parameters are added
    const fresh = randomGenome(rng, g);
    return { ...g, version: 10, cycle: g.cycle ?? fresh.cycle, excite: g.excite ?? fresh.excite, phys: { reach: fresh.phys.reach, ...g.phys } };
  }
  const fresh = randomGenome(rng, { physics: g.physics || 0 });
  const lenia = g.engine === 1;
  return { ...fresh, ...g, version: 7, kernel: lenia ? 4 : 0, delta: lenia ? 1 : 0,
           physics: g.physics || 0, phys: { ...fresh.phys, ...(g.phys || {}) } };
}

function mutateGenome(g, rng, strength) {
  const { gauss, pick } = tools(rng);
  const step = (v, range, limit) => clamp(v + gauss() * strength * (range[1] - range[0]), limit);
  const child = normaliseGenome(structuredClone(g), rng);
  for (const key of GLOBALS) child[key] = step(child[key], RANGES[key], LIMITS[key]);
  for (const gene of child.genes) {
    for (const key of ["w", "mu", "sigma"]) gene[key] = step(gene[key], RANGES[key], LIMITS[key]);
    if (rng() < 0.15 * strength) gene.src = pick(3);
    if (rng() < 0.15 * strength) gene.dst = pick(3);
    if (rng() < 0.15 * strength) gene.ring = pick(3);
  }
  for (const key of Object.keys(PHYS_RANGES)) child.phys[key] = step(child.phys[key], PHYS_RANGES[key], PHYS_LIMITS[key]);
  child.phys.payoff = child.phys.payoff.map(a => clamp(a + gauss() * strength * 2, [-1.5, 1.5]));
  return child;
}

// =============================================================== shaders
const VERTEX = `#version 300 es
in vec2 corner; void main() { gl_Position = vec4(corner, 0.0, 1.0); }`;

// The v1 neighbourhoods, exactly as in the original EvoMaxx.
const NEIGHBOURS_V1 = `#version 300 es
precision highp float;
uniform sampler2D state; uniform ivec2 size;
layout(location = 0) out vec4 near; layout(location = 1) out vec4 mid; layout(location = 2) out vec4 far;
vec3 at(ivec2 p) { return texelFetch(state, (p + size) % size, 0).rgb; }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 a = vec3(0.0), b = vec3(0.0), c = vec3(0.0);
  for (int y = -3; y <= 3; y++) for (int x = -3; x <= 3; x++) {
    vec3 v = at(p + ivec2(x, y));
    b += v;
    if (abs(x) <= 1 && abs(y) <= 1) a += v;
    c += at(p + 2 * ivec2(x, y));
  }
  near = vec4(a / 9.0, 1.0); mid = vec4(b / 49.0, 1.0); far = vec4(c / 49.0, 1.0);
}`;

// Any other kernel family: weights of the three kernels in the r, g, b of a texture.
const NEIGHBOURS_TEXTURE = `#version 300 es
precision highp float;
uniform sampler2D state, kernel; uniform ivec2 size; uniform int radius; uniform float offset;
layout(location = 0) out vec4 near; layout(location = 1) out vec4 mid; layout(location = 2) out vec4 far;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 a = vec3(0.0), b = vec3(0.0), c = vec3(0.0);
  for (int y = -radius; y <= radius; y++) for (int x = -radius; x <= radius; x++) {
    vec3 k = texelFetch(kernel, ivec2(x + radius, y + radius), 0).rgb;
    if (k == vec3(0.0)) continue;
    vec3 v = texelFetch(state, (p + ivec2(x, y) + size) % size, 0).rgb;
    a += k.r * v; b += k.g * v; c += k.b * v;
  }
  near = vec4(offset + a, 1.0); mid = vec4(offset + b, 1.0); far = vec4(offset + c, 1.0);
}`;

// The gaze kernel: rings around the cell, weighted towards the direction of its own hue.
const NEIGHBOURS_GAZE = `#version 300 es
precision highp float;
uniform sampler2D state; uniform ivec2 size;
layout(location = 0) out vec4 near; layout(location = 1) out vec4 mid; layout(location = 2) out vec4 far;
vec3 ring(vec2 q, float R, float phi, float kappa) {
  vec3 s = vec3(0.0); float total = 0.0;
  for (int j = 0; j < 16; j++) {
    float a = 0.39269908 * float(j), w = exp(kappa * (cos(a - phi) - 1.0));
    vec2 d = vec2(cos(a), sin(a));
    s += w * (texture(state, (q + 0.65 * R * d) / vec2(size)).rgb + texture(state, (q + R * d) / vec2(size)).rgb);
    total += 2.0 * w;
  }
  return s / total;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 x = texelFetch(state, p, 0).rgb;
  vec2 c = vec2(x.r - 0.5 * (x.g + x.b), 0.8660254 * (x.g - x.b));
  float phi = atan(c.y, c.x), kappa = 4.0 * clamp(length(c) / max(max(x.r, x.g), max(x.b, 1e-3)), 0.0, 1.0);
  vec2 q = vec2(p) + 0.5;
  near = vec4(ring(q, 2.5, phi, kappa), 1.0); mid = vec4(ring(q, 5.0, phi, kappa), 1.0); far = vec4(ring(q, 7.5, phi, kappa), 1.0);
}`;

const UPDATE = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D state, previous, near, mid, far;
uniform float time;
uniform int delta, response, physics, centre;
uniform ivec3 wiring[8];        // source channel, target channel, kernel
uniform vec3 shape[8];          // weight, mu, sigma
uniform vec3 globals;           // decay, speed, bias
uniform vec2 deltaParams;       // momentum, noise
uniform vec3 extra;             // V10: cycle, excite, reach
uniform vec4 phys;              // tau, kappa, omega, gamma
uniform vec2 phys2;             // alpha, rate
uniform mat3 payoff;
uniform vec4 brush;             // from.xy, radius, mode (0 none, 1 paint, 2 erase)
uniform vec2 brushTo; uniform vec3 ink;
out vec4 result;
const vec3 GREY_AXIS = vec3(0.5773503);
float respond(float x, float mu, float sigma) {
  float z = (x - mu) / sigma;
  switch (response) {
    case 0: return exp(-z * z);
    case 1: return sin(z);
    case 2: return step(mu, x) * step(x, mu + sigma);
    case 3: return max(0.0, 1.0 - abs(z));
    case 4: return clamp(tan(z), -2.0, 2.0);
    case 5: return exp(-z * z) * cos(2.0 * z);
    case 6: return 1.0 / (1.0 + exp(-z));
    case 7: return abs(z) <= 1.2 ? z * (1.0 - z * z) : -sign(z) * 0.528;
    case 8: return 1.0 / (1.0 + z * z);
    case 9: return exp(-(abs(z) - 1.5) * (abs(z) - 1.5));
    case 10: return abs(z) < 1e-4 ? 1.0 : sin(3.14159265 * z) / (3.14159265 * z);
    case 11: return 1.0 - abs(mod(z, 2.0) - 1.0);
    case 12: return sin(z) * exp(-0.25 * z * z);
    case 13: return sin(z * abs(z));
    case 14: return z > 0.0 ? z * z * z * z / (1.0 + z * z * z * z) : 0.0;
    default: { float u = 1.0 / (1.0 + exp(-z)); u = 3.9 * u * (1.0 - u); return 3.9 * u * (1.0 - u); }
  }
}
vec3 channel(int c) { return vec3(equal(ivec3(0, 1, 2), ivec3(c))); }
vec2 chroma(vec3 c) { return vec2(c.r - 0.5 * (c.g + c.b), 0.8660254 * (c.g - c.b)); }
vec3 rotate(vec3 v, vec3 axis, float angle) {
  return v * cos(angle) + cross(axis, v) * sin(angle) + axis * dot(axis, v) * (1.0 - cos(angle));
}
float hash(vec2 p, float salt) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + salt) * 43758.5453); }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 x = texelFetch(state, p, 0).rgb;
  vec3 f0 = texelFetch(near, p, 0).rgb, f1 = texelFetch(mid, p, 0).rgb, f2 = texelFetch(far, p, 0).rgb;
  vec3 growth = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    vec3 field = wiring[i].z == 0 ? f0 : (wiring[i].z == 1 ? f1 : f2);
    float g = respond(dot(field, channel(wiring[i].x)), shape[i].y, shape[i].z);
    if (centre == 1) g = 2.0 * g - 1.0;
    growth += shape[i].x * g * channel(wiring[i].y);
  }
  float decay = globals.x, speed = globals.y, bias = globals.z;
  vec3 next;
  if (delta == 0) next = x * (1.0 - decay) + speed * (bias + growth);
  else if (delta == 1) next = x + speed * growth;
  else if (delta == 2) next = x + speed * (0.5 + 0.5 * tanh(2.0 * growth) - x);
  else if (delta == 3) { vec3 c = clamp(x, 1e-3, 1.0 - 1e-3);
                         next = 1.0 / (1.0 + exp(-(log(c / (1.0 - c)) + 4.0 * speed * growth))); }
  else if (delta == 4) next = x * exp(2.0 * speed * growth) + 0.1 * speed * bias;
  else if (delta == 5) next = x + deltaParams.x * (x - texelFetch(previous, p, 0).rgb) + speed * growth - decay * x;
  else if (delta == 6) {
    vec2 q = vec2(p) + 0.5;
    vec3 xi = 2.0 * vec3(hash(q, time), hash(q, time + 17.0), hash(q, time + 31.0)) - 1.0;
    next = x * (1.0 - decay) + speed * (bias + growth) + deltaParams.y * xi;
  }
  else if (delta == 7) next = x + speed * (growth - (growth.r + growth.g + growth.b) / 3.0);
  else if (delta == 8) next = x * (1.0 - decay) + speed * (bias + growth) + extra.x * x * (x.gbr - x.brg);
  else next = x + speed * (growth + 4.0 * x * (1.0 - x) * (x - extra.y));
  next = clamp(next, 0.0, 1.0);

  if (physics == 2) {                     // flocking: turn the hue towards the neighbourhood hue
    vec2 c = chroma(next), cn = chroma(f1);
    float len = length(c);
    next = rotate(next, GREY_AXIS, phys.z + (len > 1e-4 ? phys.y * (c.x * cn.y - c.y * cn.x) / len : 0.0));
  } else if (physics == 3) {              // precession of the centred colour about the local field
    vec3 m = 2.0 * next - 1.0, h = 2.0 * f1 - 1.0;
    float strength = length(h);
    if (strength > 1e-4) m = rotate(m, h / strength, phys.w * strength);
    m += phys2.x * (h - m);
    next = 0.5 * (m + 1.0);
  } else if (physics == 8) {              // physarum: turn the hue towards where its own kind is
    vec2 c = chroma(next);
    float len = length(c);
    if (len > 1e-4) {
      float phi = atan(c.y, c.x);
      vec3 own = next / max(length(next), 1e-4);
      vec2 n = vec2(textureSize(mid, 0)), q = vec2(p) + 0.5;
      ivec2 l = ivec2(mod(floor(q + extra.z * vec2(cos(phi + 0.6), sin(phi + 0.6))), n));
      ivec2 r = ivec2(mod(floor(q + extra.z * vec2(cos(phi - 0.6), sin(phi - 0.6))), n));
      float sl = max(dot(texelFetch(mid, l, 0).rgb, own), 0.0), sr = max(dot(texelFetch(mid, r, 0).rgb, own), 0.0);
      next = rotate(next, GREY_AXIS, phys.z + phys.y * (sl - sr) / max(sl + sr, 1e-3));
    }
  } else if (physics == 4) {              // replicator dynamics on the colour mix
    float s = next.r + next.g + next.b;
    if (s > 1e-4) {
      vec3 mix = next / s, q = f1 / max(f1.r + f1.g + f1.b, 1e-4), fitness = payoff * q;
      mix = max(mix + phys2.y * mix * (fitness - dot(mix, fitness)), 0.0);
      next = s * mix / max(mix.r + mix.g + mix.b, 1e-6);
    }
  }
  next = clamp(next, 0.0, 1.0);
  if (brush.w > 0.0) {
    vec2 q = vec2(p) + 0.5, d = brushTo - brush.xy;
    float t = clamp(dot(q - brush.xy, d) / max(dot(d, d), 1e-6), 0.0, 1.0);
    float k = 1.0 - smoothstep(0.5 * brush.z, brush.z, length(q - brush.xy - t * d));
    next = brush.w < 1.5 ? max(next, ink * k) : next * (1.0 - k);
  }
  result = vec4(next, 1.0);
}`;

// Transport: each cell moves by a velocity v (|v| <= 1 cell per step) and its contents are
// spread bilinearly where it lands, so every channel's total is conserved (reintegration
// tracking, Moroz 2020, as in Flow-Lenia). The velocity depends on the physics.
const TRANSPORT = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D state, mid; uniform ivec2 size; uniform int physics; uniform float time, offset;
uniform vec4 flow;      // tau, chem, swirl, current
uniform float wavelength;
out vec4 result;
vec2 chroma(vec3 c) { return vec2(c.r - 0.5 * (c.g + c.b), 0.8660254 * (c.g - c.b)); }
float light(ivec2 q) { vec3 m = texelFetch(mid, (q + size) % size, 0).rgb - offset; return (m.r + m.g + m.b) / 3.0; }
vec2 gradient(ivec2 q) {
  return 0.5 * vec2(light(q + ivec2(1, 0)) - light(q - ivec2(1, 0)), light(q + ivec2(0, 1)) - light(q - ivec2(0, 1)));
}
vec2 current(vec2 q) {               // curl of a sum of four slowly drifting waves
  float k = 6.2831853 / wavelength;
  vec2 v = vec2(0.0);
  for (int i = 0; i < 4; i++) {
    float a = 0.785398 * float(i) + 0.3;
    vec2 dir = vec2(cos(a), sin(a));
    float phase = k * dot(dir, q) + 0.004 * float(i + 1) * time + 1.7 * float(i);
    v += cos(phase) * vec2(dir.y, -dir.x);      // (d/dy, -d/dx) of sin(phase) / k
  }
  return 0.25 * v;
}
vec2 velocity(ivec2 q, vec3 y) {
  vec2 v;
  if (physics == 1 || physics == 2 || physics == 8) v = flow.x * chroma(y) / max(max(y.r, y.g), max(y.b, 1e-3));
  else if (physics == 5) v = flow.y * gradient(q);
  else if (physics == 6) { vec2 g = gradient(q); v = flow.z * vec2(-g.y, g.x); }
  else v = flow.w * current(vec2(q) + 0.5);
  float speed = length(v);
  return speed > 1.0 ? v / speed : v;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 total = vec3(0.0);
  for (int dy = -2; dy <= 2; dy++) for (int dx = -2; dx <= 2; dx++) {
    ivec2 q = (p + ivec2(dx, dy) + size) % size;
    vec3 y = texelFetch(state, q, 0).rgb;
    vec2 d = vec2(dx, dy) + velocity(q, y);
    total += y * max(0.0, 1.0 - abs(d.x)) * max(0.0, 1.0 - abs(d.y));
  }
  result = vec4(total, 1.0);
}`;

// Block means and mean squares over 8 x 8 cells, for the health measures.
const REDUCE = `#version 300 es
precision highp float;
uniform sampler2D state; uniform int block;
layout(location = 0) out vec4 mean; layout(location = 1) out vec4 square;
void main() {
  ivec2 origin = ivec2(gl_FragCoord.xy) * block;
  vec3 s = vec3(0.0), q = vec3(0.0);
  for (int y = 0; y < block; y++) for (int x = 0; x < block; x++) {
    vec3 v = texelFetch(state, origin + ivec2(x, y), 0).rgb; s += v; q += v * v;
  }
  float n = float(block * block);
  mean = vec4(s / n, 1.0); square = vec4(q / n, 1.0);
}`;

// The world as it is: the channels shown literally as red, green and blue (v10 contrast).
const DISPLAY = `#version 300 es
precision highp float;
uniform sampler2D state; uniform vec2 origin, extent, centre; uniform float zoom, size, highlight;
out vec4 colour;
void main() {
  vec2 local = gl_FragCoord.xy - origin;
  vec2 screen = vec2(local.x, extent.y - local.y);
  vec2 world = centre + (screen - 0.5 * extent) / zoom;
  vec3 c = smoothstep(0.0, 0.85, texture(state, world / size).rgb);
  vec2 edge = min(local, extent - local);
  if (highlight > 0.0 && min(edge.x, edge.y) < 3.0) c = highlight > 1.5 ? vec3(1.0, 0.48, 0.85) : vec3(0.35);
  colour = vec4(c, 1.0);
}`;

// =============================================================== the GPU side
function engine(gl) {
  if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("float render targets are not supported");
  function program(fragment) {
    const p = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, fragment]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.bindAttribLocation(p, 0, "corner");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) {
      const info = gl.getActiveUniform(p, i);
      u[info.name.replace("[0]", "")] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }
  const P = { v1: program(NEIGHBOURS_V1), kernel: program(NEIGHBOURS_TEXTURE), gaze: program(NEIGHBOURS_GAZE), update: program(UPDATE),
              transport: program(TRANSPORT), reduce: program(REDUCE), display: program(DISPLAY) };
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  function texture(w, h, format, type, filter, wrap = gl.REPEAT, data = null) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, format, w, h, 0, gl.RGBA, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return t;
  }
  function framebuffer(textures) {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    textures.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
    gl.drawBuffers(textures.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    return f;
  }
  function quad(fb, w, h) { gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, w, h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
  function bind(unit, tex, location) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(location, unit); }

  // kernel textures, built on first use: weights normalised per kernel
  const kernelTextures = new Map();
  function kernelTexture(index) {
    if (kernelTextures.has(index)) return kernelTextures.get(index);
    const n = 2 * KR + 1, data = kernelWeights(index);
    const t = texture(n, n, gl.RGBA32F, gl.FLOAT, gl.NEAREST, gl.CLAMP_TO_EDGE, data);
    kernelTextures.set(index, t);
    return t;
  }

  const BLOCK = 8;     // cells per block side in the health measures
  const state16 = n => texture(n, n, gl.RGBA16F, gl.HALF_FLOAT, gl.LINEAR);   // half floats

  class World {
    constructor(size) {
      this.size = size;
      this.tex = [state16(size), state16(size), state16(size)];
      this.fb = this.tex.map(t => framebuffer([t]));
      this.current = 0; this.previous = 1; this.scratch = 2;    // x_t, x_(t-1), free
      this.fields = [0, 1, 2].map(() => texture(size, size, gl.RGBA16F, gl.HALF_FLOAT, gl.NEAREST));
      this.fieldsFb = framebuffer(this.fields);
      this.grid = size / BLOCK;
      this.blocks = [0, 1].map(() => texture(this.grid, this.grid, gl.RGBA32F, gl.FLOAT, gl.NEAREST));
      this.blocksFb = framebuffer(this.blocks);
      this.t = 0; this.last = null; this.health = null; this.genome = null; this.history = []; this.pending = 0;
    }
    dispose() {
      [...this.tex, ...this.fields, ...this.blocks].forEach(t => gl.deleteTexture(t));
      [...this.fb, this.fieldsFb, this.blocksFb].forEach(f => gl.deleteFramebuffer(f));
    }
    get state() { return this.tex[this.current]; }

    upload(data) {     // n * n * 4 floats, row 0 first; also the previous state (momentum)
      for (const i of [this.current, this.previous]) {
        gl.bindTexture(gl.TEXTURE_2D, this.tex[i]);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.size, this.size, gl.RGBA, gl.FLOAT, data);
      }
      this.t = 0; this.last = null; this.health = null; this.history = [];
    }
    seed(mode, seedNumber) { seedData(this, mode, seedNumber); }

    step(stroke = null) {
      const g = this.genome, n = this.size, family = KERNELS[g.kernel];
      const neighbours = g.kernel === 0 ? P.v1 : g.kernel === GAZE ? P.gaze : P.kernel;
      const textured = neighbours === P.kernel;
      const weights = textured ? kernelTexture(g.kernel) : null;   // built before binding: building binds unit 0
      gl.useProgram(neighbours.p);
      bind(0, this.state, neighbours.u.state);
      gl.uniform2i(neighbours.u.size, n, n);
      if (textured) {
        bind(1, weights, neighbours.u.kernel);
        gl.uniform1i(neighbours.u.radius, KR); gl.uniform1f(neighbours.u.offset, family.signed ? 0.5 : 0);
      }
      quad(this.fieldsFb, n, n);

      const u = P.update.u, ph = g.phys;
      gl.useProgram(P.update.p);
      bind(0, this.state, u.state); bind(1, this.tex[this.previous], u.previous);
      bind(2, this.fields[0], u.near); bind(3, this.fields[1], u.mid); bind(4, this.fields[2], u.far);
      gl.uniform1f(u.time, this.t);
      gl.uniform1i(u.delta, g.delta); gl.uniform1i(u.response, g.response); gl.uniform1i(u.physics, g.physics);
      gl.uniform1i(u.centre, DELTAS[g.delta].centred && RESPONSES[g.response].unipolar ? 1 : 0);
      gl.uniform3iv(u.wiring, g.genes.flatMap(e => [e.src, e.dst, e.ring]));
      gl.uniform3fv(u.shape, g.genes.flatMap(e => [e.w, e.mu, e.sigma]));
      gl.uniform3f(u.globals, g.decay, g.speed, g.bias);
      gl.uniform2f(u.deltaParams, g.momentum, g.noise);
      gl.uniform3f(u.extra, g.cycle ?? 0.2, g.excite ?? 0.3, ph.reach ?? 6);
      gl.uniform4f(u.phys, ph.tau, ph.kappa, ph.omega, ph.gamma);
      gl.uniform2f(u.phys2, ph.alpha, ph.rate);
      gl.uniformMatrix3fv(u.payoff, true, ph.payoff);         // row c: payoff to c against each colour
      if (stroke) {
        gl.uniform4f(u.brush, stroke.from[0], stroke.from[1], stroke.radius, stroke.erase ? 2 : 1);
        gl.uniform2f(u.brushTo, stroke.to[0], stroke.to[1]); gl.uniform3fv(u.ink, stroke.ink);
      } else gl.uniform4f(u.brush, 0, 0, 0, 0);
      quad(this.fb[this.scratch], n, n);

      // rotate the buffers: the new state is in scratch; x_t becomes the previous state
      let next = this.scratch;
      if ([1, 2, 5, 6, 7, 8].includes(g.physics)) {
        const t = P.transport.u;
        gl.useProgram(P.transport.p);
        bind(0, this.tex[this.scratch], t.state); bind(1, this.fields[1], t.mid);
        gl.uniform2i(t.size, n, n); gl.uniform1i(t.physics, g.physics); gl.uniform1f(t.time, this.t);
        gl.uniform1f(t.offset, family.signed ? 0.5 : 0);
        gl.uniform4f(t.flow, ph.tau, ph.chem, ph.swirl, ph.current); gl.uniform1f(t.wavelength, ph.wavelength);
        quad(this.fb[this.previous], n, n);
        next = this.previous;
      }
      const old = this.current;
      this.scratch = 3 - next - old;      // the buffer that is neither the new nor x_t
      this.previous = old; this.current = next;
      this.t++;
    }

    // Health from statistics of 8 x 8-cell blocks (as in the analysis of the original rule):
    //   contrast   std of the world; scale  how much of it is larger than a block;
    //   change     mean change of the block means per step since the previous measurement;
    //   motion     share of the active windows (4 x 4 windows tile the world) whose content
    //              moved: a shift of up to 2 blocks explains the change >= 30 % better;
    //   drift      how much the moving windows move the same way (1: the whole world drifts
    //              as one, 0: movers go in all directions);
    //   emptiness  share of blocks that are nearly black (mean brightness < 0.05).
    measure() {
      const G = this.grid, blocks = G * G;
      gl.useProgram(P.reduce.p);
      bind(0, this.state, P.reduce.u.state);
      gl.uniform1i(P.reduce.u.block, BLOCK);
      quad(this.blocksFb, G, G);
      const mean = new Float32Array(blocks * 4), square = new Float32Array(blocks * 4);
      gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.readPixels(0, 0, G, G, gl.RGBA, gl.FLOAT, mean);
      gl.readBuffer(gl.COLOR_ATTACHMENT1); gl.readPixels(0, 0, G, G, gl.RGBA, gl.FLOAT, square);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      return assess(this, mean, square, this.t);
    }
  }

  function drawWorld(world, x, y, w, h, centre, zoom, highlight = 0, target = null, tex = world.state, size = world.size) {
    const u = P.display.u;
    gl.useProgram(P.display.p);
    bind(0, tex, u.state);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(x, y, w, h);
    gl.uniform2f(u.origin, x, y); gl.uniform2f(u.extent, w, h);
    gl.uniform2f(u.centre, centre[0], centre[1]); gl.uniform1f(u.zoom, zoom);
    gl.uniform1f(u.size, size); gl.uniform1f(u.highlight, highlight);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // A small picture of a world as a 2D canvas (codex, atlas, reports).
  function picture(world, side) {
    const tex = texture(side, side, gl.RGBA8, gl.UNSIGNED_BYTE, gl.LINEAR), fb = framebuffer([tex]);
    drawWorld(world, 0, 0, side, side, [world.size / 2, world.size / 2], side / world.size, 0, fb);
    const pixels = new Uint8Array(side * side * 4);
    gl.readPixels(0, 0, side, side, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.deleteFramebuffer(fb); gl.deleteTexture(tex);
    const c = document.createElement("canvas"); c.width = c.height = side;
    const image = c.getContext("2d").createImageData(side, side);
    for (let y = 0; y < side; y++) image.data.set(pixels.subarray((side - 1 - y) * side * 4, (side - y) * side * 4), y * side * 4);
    c.getContext("2d").putImageData(image, 0, 0);
    return c;
  }

  // ---- lava-lamp view: the 2D world, unchanged, as an infinite floor (the torus tiles
  // seamlessly), with its bright matter floating above it as smooth glossy bodies. Ray
  // marching per pixel through the field itself, interpolated bilinearly, so every detail
  // of the 2D world is kept on the surfaces. The shape comes from a soft copy of the field
  // (mip levels of it, blurs over a few cells) so that bodies are rounded like wax: with
  // e = (brightness - threshold) / (1 - threshold) > 0, a body spans height
  //   base + lift e_wide  +-  thickness sqrt(e_soft)
  // where e_soft is blurred over a few cells and e_wide over a few more: a whole body rises
  // together and swells into a lens, brighter bodies higher.
  // Wax: what floats is not the field itself but a slow copy of it, so bodies behave like
  // wax in a lava lamp: they rise as they heat up (brighten), and when their matter fades
  // they cool, sink and shrink instead of vanishing. rgb: the lagged soft colour; a: the
  // height above the hover level. Display only: the chemistry still has three channels.
  const WAX = `#version 300 es
precision highp float;
uniform sampler2D soft, previous; uniform float softness, lift, threshold, kColour, kRise, kSink; uniform vec2 extent;
out vec4 result;
float excess(vec3 c) { return max(max(max(c.r, c.g), c.b) - threshold, 0.0) / max(1.0 - threshold, 1e-3); }
void main() {
  vec2 uv = gl_FragCoord.xy / extent;
  vec3 target = textureLod(soft, uv, softness).rgb;
  float h = lift * excess(textureLod(soft, uv, softness + 2.0).rgb);
  vec4 w = texelFetch(previous, ivec2(gl_FragCoord.xy), 0);
  result = vec4(w.rgb + kColour * (target - w.rgb), w.a + (h > w.a ? kRise : kSink) * (h - w.a));
}`;
  const LAVA = `#version 300 es
precision highp float;
uniform sampler2D state, soft, wax;
uniform float size, threshold, lift, thickness, base, softness, mirror, shadow, translucency, fog, scan, scanAxis;
uniform vec3 eye, forward, right, up, light; uniform vec2 extent;
// the music box bar: a line of light across the world at x (or z) = scan (cells), none if scan < 0
float bar(vec3 p) { float x = mix(p.x, p.z, scanAxis); if (scan < 0.0) return 0.0; return exp(-0.7 * abs(mod(x - scan + 0.5 * size, size) - 0.5 * size)); }
out vec4 result;
vec3 colourAt(vec2 q) { return texture(state, q / size).rgb; }
float excess(vec3 c) { return max(max(max(c.r, c.g), c.b) - threshold, 0.0) / max(1.0 - threshold, 1e-3); }
// signed distance (in height) to the floating wax above q; positive outside
float body(vec3 p) {
  vec4 w = texture(wax, p.xz / size);
  float e = excess(w.rgb);
  if (e <= 0.0) return 1e3;
  return abs(p.y - base - w.a) - thickness * sqrt(e);
}
vec3 sky(vec3 d) {
  return mix(vec3(0.035, 0.02, 0.05), vec3(0.012, 0.01, 0.02), clamp(d.y * 2.0, 0.0, 1.0))
       + vec3(0.07, 0.045, 0.03) * pow(max(dot(d, light), 0.0), 12.0);
}
bool march(vec3 o, vec3 d, float tEnd, int steps, out float t) {
  float top = base + lift + thickness + 1.0;
  t = 0.0;
  if (o.y > top) { if (d.y >= 0.0) return false; t = (o.y - top) / -d.y; }
  if (o.y < top && d.y > 0.0) tEnd = min(tEnd, (top - o.y) / d.y);
  float before = t;
  bool hit = false;
  for (int i = 0; i < 300; i++) {
    if (i >= steps || t > tEnd) break;
    float h = body(o + d * t);
    if (h < 0.0) { hit = true; break; }
    before = t;
    t += clamp(0.45 * h, 0.1 + 0.002 * t, 0.6 + 0.004 * t);   // fine near the bodies, coarser far away
  }
  if (!hit) return false;
  for (int i = 0; i < 8; i++) {                               // bisect onto the surface
    float m = 0.5 * (before + t);
    if (body(o + d * m) < 0.0) t = m; else before = m;
  }
  return true;
}
// glossy wax: the exact colour of the 2D world on the skin (plus the lag of the wax), glowing
// from inside, wrapped diffuse light and light shining through thin wax
vec3 shade(vec3 p, vec3 d) {
  float h = 0.6;
  vec3 n = normalize(vec3(body(p + vec3(h, 0, 0)) - body(p - vec3(h, 0, 0)),
                          body(p + vec3(0, h, 0)) - body(p - vec3(0, h, 0)),
                          body(p + vec3(0, 0, h)) - body(p - vec3(0, 0, h))));
  vec2 uv = p.xz / size;
  vec4 w = texture(wax, uv);
  vec3 c = smoothstep(0.0, 0.85, max(colourAt(p.xz) + w.rgb - textureLod(soft, uv, softness).rgb, 0.0));
  float e = excess(w.rgb);
  float diffuse = max((dot(n, light) + 0.35) / 1.35, 0.0);
  float gloss = pow(max(dot(reflect(-light, n), -d), 0.0), 40.0);
  float rim = pow(1.0 - max(dot(n, -d), 0.0), 3.0);
  float through = translucency * (1.0 - clamp(sqrt(e), 0.0, 1.0)) * (0.35 + 0.65 * pow(max(dot(d, light), 0.0), 3.0));
  return c * (0.22 + 0.55 * diffuse + 1.2 * bar(p)) + c * 0.7 * e + vec3(0.9) * gloss * 0.5 + c * rim * 0.6 + c * through * 1.3;
}
vec3 fogged(vec3 d, vec3 c, float t) { return mix(sky(d), c, exp(-t * fog / size)); }
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * extent) / extent.y;
  vec3 dir = normalize(forward + uv.x * right + uv.y * up);
  float far = 9.0 * size, tFloor = dir.y < 0.0 ? eye.y / -dir.y : far, t;
  vec3 colour;
  if (march(eye, dir, min(tFloor, far), 300, t)) colour = fogged(dir, shade(eye + dir * t, dir), t);
  else if (tFloor < far) {
    vec3 q = eye + dir * tFloor;
    vec3 c = colourAt(q.xz), pool = textureLod(soft, q.xz / size, softness + 2.5).rgb;
    // the floor: the 2D world dimly, the light of the bodies pooled under them, their
    // shadows, and a wet mirror of them
    vec3 floorColour = smoothstep(0.0, 0.85, c) * 0.3 * (1.0 - 0.6 * excess(c)) + smoothstep(0.0, 0.85, pool) * excess(pool) * 0.35;
    vec2 caster = q.xz + light.xz / light.y * (base + texture(wax, q.xz / size).a);
    floorColour *= 1.0 - shadow * 0.7 * smoothstep(0.0, 0.35, excess(texture(wax, caster / size).rgb));
    floorColour += vec3(0.5, 0.45, 0.38) * 0.35 * bar(q) * (0.3 + smoothstep(0.0, 0.85, c));
    vec3 r = vec3(dir.x, -dir.y, dir.z);
    float tr;
    if (mirror > 0.0 && march(q + r * 0.05, r, 1.2 * size, 56, tr)) {
      float fresnel = 0.25 + 0.75 * pow(1.0 - r.y, 5.0);
      floorColour += mirror * fresnel * shade(q + r * tr, r);
    }
    colour = fogged(dir, floorColour, tFloor);
  } else colour = sky(dir);
  result = vec4(colour, 1.0);
}`;
  // bloom and tone mapping: the frame plus its blurred mip levels
  const COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D image; uniform vec2 origin, extent; uniform float bloom;
out vec4 result;
void main() {
  vec2 uv = (gl_FragCoord.xy - origin) / extent;
  vec3 c = texture(image, uv).rgb;
  vec3 glow = 0.3 * textureLod(image, uv, 2.0).rgb + 0.3 * textureLod(image, uv, 3.0).rgb
            + 0.25 * textureLod(image, uv, 4.0).rgb + 0.15 * textureLod(image, uv, 5.0).rgb;
  c += bloom * glow * glow * 1.6;
  result = vec4(1.0 - exp(-1.25 * c), 1.0);
}`;
  function plainProgram(fragment) {
    const p = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, fragment]]) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, source); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      gl.attachShader(p, sh);
    }
    gl.bindAttribLocation(p, 0, "corner");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) {
      const info = gl.getActiveUniform(p, i);
      u[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }
  const lava = plainProgram(LAVA), composite = plainProgram(COMPOSITE), waxProgram = plainProgram(WAX);
  // the wax of each world: two textures (read one, write the other)
  const waxes = new WeakMap();
  function waxOf(world) {
    let w = waxes.get(world);
    if (!w || w.size !== world.size) {
      const tex = [0, 1].map(() => texture(world.size, world.size, gl.RGBA16F, gl.HALF_FLOAT, gl.LINEAR));
      w = { size: world.size, tex, fb: tex.map(t => framebuffer([t])), current: 0, fresh: true };
      waxes.set(world, w);
    }
    return w;
  }
  // the light: azimuth and elevation (radians) to a direction
  const lightDirection = (o) => { const az = o.azimuth ?? -0.95, el = o.elevation ?? 1.1;
    return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)]; };
  let frame = null;       // the off-screen frame of the lava view, with a mip chain for bloom
  function frameTarget(w, h) {
    if (frame && frame.w === w && frame.h === h) return frame;
    if (frame) { gl.deleteTexture(frame.tex); gl.deleteFramebuffer(frame.fb); }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(w, h))) + 1, gl.RGBA16F, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    frame = { w, h, tex, fb: framebuffer([tex]) };
    return frame;
  }

  // the soft field: a copy of the state with a mip chain (one per world size)
  const softCopies = new Map();
  function softCopy(world) {
    const n = world.size;
    if (!softCopies.has(n)) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, Math.log2(n) + 1, gl.RGBA16F, n, n);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      softCopies.set(n, { tex, fb: framebuffer([tex]) });
    }
    const copy = softCopies.get(n);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, world.fb[world.current]);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, copy.fb);
    gl.blitFramebuffer(0, 0, n, n, 0, 0, n, n, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, copy.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    return copy.tex;
  }

  // camera: { yaw, pitch, distance, target: [x, z] } in cells;
  // options: { threshold, base, lift, thickness, softness (mip level of the shape),
  //            mirror (0-1), bloom (0-1), scale (render resolution, 0.25-1) }
  function planeCamera(camera) {
    const target = [camera.target[0], 0, camera.target[1]];
    const eye = [target[0] + camera.distance * Math.cos(camera.pitch) * Math.sin(camera.yaw),
                 camera.distance * Math.sin(camera.pitch),
                 target[2] + camera.distance * Math.cos(camera.pitch) * Math.cos(camera.yaw)];
    const forward = target.map((v, i) => (v - eye[i]) / camera.distance);
    const rl = Math.hypot(forward[2], forward[0]);
    const right = [-forward[2] / rl, 0, forward[0] / rl];
    const up = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2],
                right[0] * forward[1] - right[1] * forward[0]];
    return { eye, forward, right, up };
  }
  // the point at height `height` under a pixel (px, py from the bottom left of a w x h view)
  function planePoint(camera, px, py, w, h, height) {
    const { eye, forward, right, up } = planeCamera(camera), u = (px - 0.5 * w) / h, v = (py - 0.5 * h) / h;
    const d = [0, 1, 2].map(i => forward[i] + u * right[i] + v * up[i]);
    if (d[1] >= -1e-4 || eye[1] <= height) return null;
    const t = (eye[1] - height) / -d[1];
    return [eye[0] + t * d[0], eye[2] + t * d[2]];
  }
  // options: threshold, base, lift, thickness, softness, mirror, bloom, scale; inertia (0: the
  // wax follows the field at once, 1: slow lava), dt (seconds since the last frame), shadow,
  // translucency, fog, azimuth and elevation of the light
  function drawPlane(world, x, y, w, h, camera, options) {
    const soft = softCopy(world), n = world.size;
    const { eye, forward, right, up } = planeCamera(camera);
    // the wax follows the field with rates that depend on the inertia
    const wax = waxOf(world), dt = Math.min(options.dt ?? 1 / 60, 0.1), inertia = wax.fresh ? 0 : options.inertia ?? 0.5;
    const rate = (fast, slow) => 1 - Math.exp(-dt * (fast + (slow - fast) * Math.pow(inertia, 0.5)));
    let u = waxProgram.u;
    gl.useProgram(waxProgram.p);
    bind(0, soft, u.soft); bind(1, wax.tex[wax.current], u.previous);
    gl.uniform1f(u.softness, options.softness ?? 1.8); gl.uniform1f(u.lift, options.lift); gl.uniform1f(u.threshold, options.threshold);
    gl.uniform1f(u.kColour, wax.fresh ? 1 : rate(60, 1.1)); gl.uniform1f(u.kRise, wax.fresh ? 1 : rate(60, 0.7));
    gl.uniform1f(u.kSink, wax.fresh ? 1 : rate(60, 0.35)); gl.uniform2f(u.extent, n, n);
    quad(wax.fb[1 - wax.current], n, n);
    wax.current = 1 - wax.current; wax.fresh = false;

    const scale = options.scale ?? 1, fw = Math.max(16, Math.round(w * scale)), fh = Math.max(16, Math.round(h * scale));
    const target_ = frameTarget(fw, fh);
    u = lava.u;
    gl.useProgram(lava.p);
    bind(0, world.state, u.state); bind(1, soft, u.soft); bind(2, wax.tex[wax.current], u.wax);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target_.fb);
    gl.viewport(0, 0, fw, fh);
    gl.uniform1f(u.softness, options.softness ?? 1.8); gl.uniform1f(u.mirror, options.mirror ?? 0.5);
    gl.uniform1f(u.size, n); gl.uniform1f(u.threshold, options.threshold);
    gl.uniform1f(u.lift, options.lift); gl.uniform1f(u.thickness, options.thickness); gl.uniform1f(u.base, options.base ?? 16);
    gl.uniform1f(u.shadow, options.shadow ?? 0.6); gl.uniform1f(u.translucency, options.translucency ?? 0.5);
    gl.uniform1f(u.fog, options.fog ?? 0.45); gl.uniform3fv(u.light, lightDirection(options)); gl.uniform1f(u.scan, options.scan ?? -1); gl.uniform1f(u.scanAxis, options.scanAxis ?? 0);
    gl.uniform3fv(u.eye, eye); gl.uniform3fv(u.forward, forward); gl.uniform3fv(u.right, right); gl.uniform3fv(u.up, up);
    gl.uniform2f(u.extent, fw, fh);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindTexture(gl.TEXTURE_2D, target_.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    u = composite.u;
    gl.useProgram(composite.p);
    bind(0, target_.tex, u.image);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(x, y, w, h);
    gl.uniform2f(u.origin, x, y); gl.uniform2f(u.extent, w, h); gl.uniform1f(u.bloom, options.bloom ?? 0.6);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // The brightest places of the soft field, for a camera that follows creatures: the
  // brightness of a coarse mip level (cells per value: 2^level), read back to the CPU.
  function brightness(world, level = 4) {
    const n = world.size, m = n >> level, soft = softCopy(world);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, soft, level);
    const px = new Float32Array(m * m * 4);
    gl.readPixels(0, 0, m, m, gl.RGBA, gl.FLOAT, px);
    gl.deleteFramebuffer(fb);
    const b = new Float32Array(m * m);
    for (let i = 0; i < m * m; i++) b[i] = Math.max(px[4 * i], px[4 * i + 1], px[4 * i + 2]);
    return { values: b, rgb: px, m, cell: n / m };
  }

  // the whole state of a world as floats (rgba per cell, row 0 at the bottom)
  function readState(world) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, world.fb[world.current]);
    const px = new Float32Array(world.size * world.size * 4);
    gl.readPixels(0, 0, world.size, world.size, gl.RGBA, gl.FLOAT, px);
    return px;
  }

  // a frame, and textures filled from 2D canvases
  function beginFrame(r, g, b) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(r, g, b, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  }
  function image(w, h) {       // a texture filled from a 2D canvas
    const tex = texture(w, h, gl.RGBA8, gl.UNSIGNED_BYTE, gl.LINEAR);
    return { tex, update(c) { gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, c); },
             clear() { gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); } };
  }
  return { World, drawWorld, drawPlane, planePoint, brightness, readState, picture,
           pictureAsync: (world, side) => Promise.resolve(picture(world, side)), beginFrame, endFrame() {}, image, BLOCK };
}

// What breeding, the atlas and the experiments reward: block-scale contrast, activity and
// motion in a world that is alive (a heuristic, see the README).
function quality(h) {
  return h.status === "alive" ? h.coarse * (1 - Math.exp(-h.change / 5e-5)) * (1 + h.motion) : 0;
}
// "Creature-like": alive, and organised as patterns on an empty background.
const localised = h => h.status === "alive" && h.emptiness >= 0.3 && h.emptiness <= 0.97;
// Motion that is not one global drift: movers that go their own ways.
const autonomous = h => h.status === "alive" && h.motion >= 0.5 && h.drift < 0.75;
// |mean shift| / mean |shift| of the moving windows: 1 when all move alike
// The starting states: uniform noise, a noise patch, or soft coloured blobs.
function seedData(world, mode, seedNumber) {
  const n = world.size, data = new Float32Array(n * n * 4), random = mulberry32(seedNumber);
  if (mode === "blobs") {
    for (let b = 0; b < 28; b++) {
      const cx = random() * n, cy = random() * n, r = n * (0.03 + 0.07 * random());
      const colour = [random(), random(), random()];
      for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const d = Math.hypot(x - cx, y - cy) / r;
        if (d >= 1) continue;
        const i = 4 * (((y % n + n) % n) * n + ((x % n + n) % n)), k = (1 - d * d) * (0.6 + 0.4 * random());
        for (let c = 0; c < 3; c++) data[i + c] = Math.max(data[i + c], colour[c] * k);
      }
    }
  } else {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const inside = mode === "noise" || Math.hypot(x - n / 2, y - n / 2) < n / 3;
      for (let c = 0; c < 3; c++) data[4 * (y * n + x) + c] = inside ? random() : 0;
    }
  }
  for (let i = 3; i < data.length; i += 4) data[i] = 1;
  world.upload(data);
}

// Bodies: the connected bright regions (brightest channel above threshold) of a coarse
// field read back from the GPU ({ values, rgb, m, cell }), on the torus. Each with its
// centre (x, z in cells), size n (field cells), mean colour and dominant chemical.
function bodies(field, threshold) {
  const { values, rgb, m, cell } = field, seen = new Uint8Array(m * m), found = [], span = m * cell;
  const wrap = d => ((d % span) + 1.5 * span) % span - span / 2;
  for (let start = 0; start < m * m; start++) {
    if (seen[start] || values[start] < threshold) continue;
    const stack = [start], x0 = start % m, y0 = Math.floor(start / m), colour = [0, 0, 0];
    let n = 0, sx = 0, sy = 0, peak = 0; seen[start] = 1;
    while (stack.length) {
      const k = stack.pop(), x = k % m, y = Math.floor(k / m);
      n++; sx += wrap((x - x0) * cell); sy += wrap((y - y0) * cell); peak = Math.max(peak, values[k]);
      for (let c = 0; c < 3; c++) colour[c] += rgb[4 * k + c];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = ((y + dy + m) % m) * m + (x + dx + m) % m;
        if (!seen[j] && values[j] >= threshold) { seen[j] = 1; stack.push(j); }
      }
    }
    found.push({ x: (x0 + 0.5) * cell + sx / n, z: (y0 + 0.5) * cell + sy / n, n, peak, wrap,
                 colour: colour.map(v => v / n), channel: colour.indexOf(Math.max(...colour)) });
  }
  return found;
}

// Health from the block means and mean squares of a world measured at step t (the CPU half
// of World.measure). Sets world.health and
// world.last and adds the health to world.history.
function assess(world, mean, square, t) {
  const G = world.grid, blocks = G * G;
  let std = 0, coarse = 0, empty = 0; const colour = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    let m = 0, q = 0, mm = 0;
    for (let i = c; i < mean.length; i += 4) { m += mean[i]; q += square[i]; mm += mean[i] * mean[i]; }
    m /= blocks; q /= blocks; mm /= blocks;
    std += Math.sqrt(Math.max(q - m * m, 0)) / 3; coarse += Math.sqrt(Math.max(mm - m * m, 0)) / 3; colour[c] = m;
  }
  const brightest = [];    // the brightest channel of every block, for the plane view's threshold
  for (let i = 0; i < mean.length; i += 4) {
    if ((mean[i] + mean[i + 1] + mean[i + 2]) / 3 < 0.05) empty++;
    brightest.push(Math.max(mean[i], mean[i + 1], mean[i + 2]));
  }
  brightest.sort((x, y) => x - y);
  let change = NaN, motion = 0, drift = 0;
  if (world.last) {
    const before = world.last.mean, steps = Math.max(t - world.last.t, 1);
    change = 0;
    for (let i = 0; i < mean.length; i++) if (i % 4 !== 3) change += Math.abs(mean[i] - before[i]);
    change /= 3 * blocks * steps;
    const W = G / 4, shifts = [];
    let moving = 0, active = 0;
    for (let wy = 0; wy < 4; wy++) for (let wx = 0; wx < 4; wx++) {
      const msd = (sx, sy) => {
        let s = 0;
        for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
          const bx = wx * W + x, by = wy * W + y, i = 4 * (by * G + bx);
          const j = 4 * (((by - sy + G) % G) * G + ((bx - sx + G) % G));
          for (let c = 0; c < 3; c++) { const d = mean[i + c] - before[j + c]; s += d * d; }
        }
        return s / (3 * W * W);
      };
      const still = msd(0, 0);
      if (still < 5e-8) continue;
      active++;
      let best = still, shift = [0, 0];
      for (let sy = -2; sy <= 2; sy++) for (let sx = -2; sx <= 2; sx++) {
        if (!sx && !sy) continue;
        const m = msd(sx, sy);
        if (m < best) { best = m; shift = [sx, sy]; }
      }
      if (best < 0.7 * still) { moving++; shifts.push(shift); }
    }
    motion = active ? moving / active : 0;
    drift = alignment(shifts);
  }
  world.last = { mean, t };
  const ratio = std > 0 ? coarse / std : 0;
  const status = std < 0.01 ? "dead" : isNaN(change) ? "starting" : change < 2e-6 ? "frozen"
               : ratio < 0.25 ? "noise" : "alive";
  const [r, g, b] = colour, max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hue = 0;
  if (max > min) hue = (max === r ? (g - b) / (max - min) : max === g ? 2 + (b - r) / (max - min) : 4 + (r - g) / (max - min)) / 6;
  world.health = { std, coarse, ratio, change, motion, drift, emptiness: empty / blocks, status, hue: (hue + 1) % 1, colour,
                  level75: brightest[Math.floor(0.75 * brightest.length)] };
  world.health.quality = quality(world.health);
  (world.history ??= []).push(world.health);
  return world.health;
}

function alignment(shifts) {
  if (!shifts.length) return 0;
  const sum = shifts.reduce((s, v) => s.map((x, i) => x + v[i]), shifts[0].map(() => 0));
  return Math.hypot(...sum) / shifts.reduce((s, v) => s + Math.hypot(...v), 0);
}

return { KERNELS, DELTAS, RESPONSES, RESPONSE_FORMULAS, PHYSICS, PHYS_RANGES, PHYS_LIMITS, RANGES, LIMITS, KR, GAZE, GLOBALS,
         kernelWeights, assess, seedData, bodies, mulberry32, randomGenome, normaliseGenome, mutateGenome, engine, quality, localised, autonomous, alignment };
})();
