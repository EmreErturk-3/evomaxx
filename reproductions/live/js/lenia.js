"use strict";
// Lenia (Chan 2019): Orbium unicaudatus, live. The same equations and seed as
// ../01_lenia_chan2019/lenia.py: A <- clip(A + dt G(K * A)), bump kernel of radius R = 13,
// Gaussian growth, T = 10.
MODELS.push((() => {
  const N = 256, R = 13;
  const ORBIUM = [[0,0,0,0,0,0,0,13,4,0,0,0,0,0,0,60,0,0,0,0],[0,0,0,0,0,0,35,53,54,21,18,25,26,18,1,65,0,0,0,0],[0,0,0,0,0,22,68,91,98,87,48,47,44,47,45,27,89,0,0,0],[0,0,0,0,3,17,89,116,119,97,33,20,14,16,31,55,180,0,0,0],[0,0,0,9,33,47,87,103,98,72,34,0,0,0,0,12,102,84,0,0],[1,0,4,35,43,34,28,63,69,67,53,0,0,0,0,0,5,220,0,0],[60,0,26,44,20,0,0,51,79,94,95,61,0,0,0,0,0,116,40,0],[0,31,47,28,0,0,0,69,109,129,137,130,0,0,0,0,0,0,132,0],[0,150,55,8,0,0,0,48,135,162,174,174,107,0,0,0,0,0,109,0],[0,141,60,0,0,0,0,7,158,193,214,218,206,27,0,0,0,0,72,25],[0,0,152,0,0,0,0,0,170,223,245,253,248,143,0,0,0,0,57,36],[0,0,214,0,0,0,0,0,129,247,255,255,255,233,71,0,0,6,56,34],[0,0,141,19,0,0,0,0,85,255,255,250,255,248,142,40,13,30,62,22],[0,0,8,114,0,0,0,0,45,217,255,228,220,221,166,85,50,55,59,10],[0,0,0,108,29,0,0,0,29,158,224,210,199,189,156,104,75,68,42,0],[0,0,0,20,85,19,0,0,30,108,172,184,173,160,134,103,79,57,16,0],[0,0,0,0,42,66,38,30,44,86,127,142,139,127,109,86,62,30,0,0],[0,0,0,0,0,37,59,60,66,81,99,108,105,92,78,58,32,5,0,0],[0,0,0,0,0,0,18,43,58,64,70,71,66,59,42,24,5,0,0,0],[0,0,0,0,0,0,0,0,15,26,33,34,30,20,11,0,0,0,0,0]];
  const STEP = `#version 300 es
precision highp float;
uniform sampler2D state, kernel; uniform float mu, sigma, dt; uniform vec2 size;
out vec4 result;
void main() {
  vec2 p = gl_FragCoord.xy;
  float u = 0.0;
  for (int y = -${R}; y <= ${R}; y++) for (int x = -${R}; x <= ${R}; x++) {
    float k = texelFetch(kernel, ivec2(x + ${R}, y + ${R}), 0).r;
    if (k > 0.0) u += k * texture(state, (p + vec2(x, y)) / size).r;
  }
  float a = texture(state, p / size).r;
  float g = 2.0 * exp(-(u - mu) * (u - mu) / (2.0 * sigma * sigma)) - 1.0;
  result = vec4(clamp(a + dt * g, 0.0, 1.0), 0.0, 0.0, 1.0);
}`;
  const PAINT = `vec3 paint(vec4 s) { float a = s.r;
    return clamp(vec3(0.27 + 1.2 * a * a - 0.25 * a, 0.0 + 0.9 * a, 0.33 + 0.6 * a - 0.8 * a * a), 0.0, 1.0); }`;
  let world, step, show, kernelTex, data, frameCount = 0;

  function stamp(cx, cy) {
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
      const v = ORBIUM[y][x] / 255; if (!v) continue;
      const i = 4 * (((cy - 10 + 19 - y + N) % N) * N + (cx - 10 + x + N) % N);
      data[i] = Math.max(data[i], v);
    }
    world.upload(data);
  }
  function reset(env, mode) {
    data = new Float32Array(N * N * 4);
    if (mode === "one") stamp(N / 2, N / 2);
    if (mode === "three") { stamp(70, 80); stamp(180, 120); stamp(110, 190); }
    if (mode === "noise") for (let y = 98; y < 158; y++) for (let x = 98; x < 158; x++) data[4 * (y * N + x)] = Math.random();
    world.upload(data);
  }
  return {
    id: "lenia", title: "Lenia", short: "Chan 2019 · Orbium", folder: "01_lenia_chan2019",
    cite: "B. W.-C. Chan, <i>Lenia: biology of artificial life</i>, Complex Systems 28 (2019). Orbium from the author's library.",
    about: `<p>A continuous cellular automaton: every cell holds a number between 0 and 1. Each step, a cell looks at a smooth ring
      around it (radius R = 13), and grows or shrinks by a bell-shaped growth function of what it sees:
      A ← clip(A + dt·G(K∗A)).</p><p>Orbium is a glider: a soft creature that keeps its shape and moves, here from the exact
      seed of Chan's library. Click to drop more. Measured in Python: it keeps its mass to 0.24 % and moves 0.47 R per unit of time,
      the same at every resolution (R = 13 to 65), as the paper reports; it lives only in a narrow band of (μ, σ).</p>`,
    evomaxx: `<p>Lenia is EvoMaxx's closest relative. EvoMaxx's genes have Lenia's structure (a kernel reads a chemical, a growth function
      maps it, the result is added to a chemical: Chan's 2020 multi-channel Lenia, reached independently in EvoMaxx v1). EvoMaxx's
      <b>Lenia shell</b> kernel, its <b>Lenia</b> delta (x + sG) and its <b>Gaussian</b> response are Lenia's, and centred deltas
      map responses to [−1, 1] as Lenia does.</p>`,
    controls: [
      { label: "growth centre μ", key: "mu", min: 0.1, max: 0.2, step: 0.001, value: 0.15, digits: 3 },
      { label: "growth width σ", key: "sigma", min: 0.005, max: 0.03, step: 0.0005, value: 0.015, digits: 4 },
      { label: "steps per frame", key: "speed", min: 1, max: 8, step: 1, value: 2, digits: 0 },
      { button: "one Orbium", action: env => reset(env, "one") }, { button: "three", action: env => reset(env, "three") },
      { button: "noise patch", action: env => reset(env, "noise") },
    ],
    init(env) {
      const gl = env.gl;
      step = GL.program(gl, STEP); show = GL.program(gl, GL.SHOW(PAINT));
      world = GL.pingpong(gl, N, N);
      const n = 2 * R + 1, k = new Float32Array(n * n * 4); let sum = 0;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const r = Math.hypot(x - R, y - R) / R;
        const v = r > 0 && r < 1 ? Math.exp(4 - 1 / (r * (1 - r))) : 0; k[4 * (y * n + x)] = v; sum += v;
      }
      for (let i = 0; i < k.length; i += 4) k[i] /= sum;
      kernelTex = GL.texture(gl, n, n, k);
      reset(env, "one");
    },
    click(env, x, y) {
      const zoom = Math.min(env.width, env.height) / N;
      const wx = Math.round((x - env.width / 2) / zoom + N / 2), wy = Math.round((env.height - y - env.height / 2) / zoom + N / 2);
      stamp((wx % N + N) % N, (wy % N + N) % N);
    },
    frame(env) {
      const gl = env.gl, p = env.params;
      for (let i = 0; i < p.speed; i++) {
        GL.pass(gl, step, world.target, N, N, [["state", world.read], ["kernel", kernelTex]], { mu: p.mu, sigma: p.sigma, dt: 0.1, size: [N, N] });
        world.swap();
      }
      GL.pass(gl, show, null, env.width, env.height, [["state", world.read]], { screen: [env.width, env.height], size: [N, N], zoom: Math.min(env.width, env.height) / N });
      if (++frameCount % 30 === 0) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, world.fb[world.i]);
        const px = new Float32Array(N * N * 4); gl.readPixels(0, 0, N, N, gl.RGBA, gl.FLOAT, px);
        let m = 0; for (let i = 0; i < px.length; i += 4) m += px[i];
        env.readout(`mass ${m.toFixed(1)} (one Orbium: about 71) · click to add an Orbium`);
      }
    },
  };
})());
