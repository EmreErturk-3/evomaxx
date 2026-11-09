"use strict";
// Flow-Lenia (Plantec et al. 2023), live: affinity U = sum_k h_k G_k(K_k * A), flow
// F = (1 - alpha) grad U - alpha grad A, alpha = clip(A^2, 0, 1), and reintegration tracking
// (dt 0.2, dd 5, s 0.65), as in the authors' code. For speed the live version uses 3 kernels
// (the code: 10) of radius at most 20 cells; ../02_flow_lenia_plantec2023/flow_lenia.py runs
// the full model.
MODELS.push((() => {
  const N = 128, K = 3, RMAX = 20, DT = 0.2, DD = 5, S = 0.65;
  const AFFINITY = `#version 300 es
precision highp float;
uniform sampler2D state, kernel; uniform vec3 m, s, h; uniform vec2 size;
out vec4 result;
void main() {
  vec2 p = gl_FragCoord.xy; vec3 u = vec3(0.0);
  for (int y = -${RMAX}; y <= ${RMAX}; y++) for (int x = -${RMAX}; x <= ${RMAX}; x++) {
    vec3 k = texelFetch(kernel, ivec2(x + ${RMAX}, y + ${RMAX}), 0).rgb;
    if (k != vec3(0.0)) u += k * texture(state, (p + vec2(x, y)) / size).r;
  }
  vec3 g = 2.0 * exp(-0.5 * (u - m) * (u - m) / (s * s)) - 1.0;
  result = vec4(dot(h, g), 0.0, 0.0, 1.0);
}`;
  // Sobel gradients of U and A, combined into the flow (stored premultiplied by dt and clipped)
  const FLOW = `#version 300 es
precision highp float;
uniform sampler2D state, affinity; uniform vec2 size;
out vec4 result;
float at(sampler2D t, vec2 p) { return texture(t, p / size).r; }
vec2 sobel(sampler2D t, vec2 p) {
  float gx = at(t, p + vec2(-1, 1)) + 2.0 * at(t, p + vec2(-1, 0)) + at(t, p + vec2(-1, -1)) - at(t, p + vec2(1, 1)) - 2.0 * at(t, p + vec2(1, 0)) - at(t, p + vec2(1, -1));
  float gy = at(t, p + vec2(1, -1)) + 2.0 * at(t, p + vec2(0, -1)) + at(t, p + vec2(-1, -1)) - at(t, p + vec2(1, 1)) - 2.0 * at(t, p + vec2(0, 1)) - at(t, p + vec2(-1, 1));
  return -vec2(gx, gy);
}
void main() {
  vec2 p = gl_FragCoord.xy;
  float a = at(state, p), alpha = clamp(a * a, 0.0, 1.0);
  vec2 f = (1.0 - alpha) * sobel(affinity, p) - alpha * sobel(state, p);
  result = vec4(clamp(${DT} * f, -${DD - S}, ${DD - S}), 0.0, 1.0);
}`;
  // reintegration tracking: the matter of each cell, a square of side 2s centred where its flow
  // takes it, is shared among the cells it overlaps
  const MOVE = `#version 300 es
precision highp float;
uniform sampler2D state, flow; uniform vec2 size;
out vec4 result;
void main() {
  vec2 p = gl_FragCoord.xy; float total = 0.0;
  for (int dy = -${DD}; dy <= ${DD}; dy++) for (int dx = -${DD}; dx <= ${DD}; dx++) {
    vec2 q = p - vec2(dx, dy);
    vec2 centre = vec2(dx, dy) - texture(flow, q / size).xy;          // source square, seen from p
    vec2 w = clamp(0.5 - abs(centre) + ${S}, 0.0, ${Math.min(1, 2 * S).toFixed(2)});
    total += texture(state, q / size).r * w.x * w.y / ${(4 * S * S).toFixed(4)};
  }
  result = vec4(total, 0.0, 0.0, 1.0);
}`;
  const PAINT = `vec3 paint(vec4 s) { float a = clamp(s.r, 0.0, 1.5) / 1.5; return vec3(pow(a, 0.6), pow(a, 1.4) * 0.8, 0.25 * a + 0.35 * pow(a, 3.0)); }`;
  let A, U, F, affinity, flow, move, show, kernelTex, rule, frameCount = 0;

  function randomRule() {
    const u = (lo, hi) => lo + (hi - lo) * Math.random();
    const R = u(2, 25), k = [];
    for (let i = 0; i < K; i++) k.push({ r: Math.min(u(0.2, 1), RMAX / (R + 15)), m: u(0.05, 0.5), s: u(0.001, 0.18), h: u(0.01, 1),
      a: [u(0, 1), u(0, 1), u(0, 1)], b: [u(0.001, 1), u(0.001, 1), u(0.001, 1)], w: [u(0.01, 0.5), u(0.01, 0.5), u(0.01, 0.5)] });
    return { R, k };
  }
  function build(env) {
    const gl = env.gl, n = 2 * RMAX + 1, data = new Float32Array(n * n * 4);
    rule.k.forEach((kk, c) => {
      let sum = 0;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const D = Math.hypot(x - RMAX, y - RMAX) / ((rule.R + 15) * kk.r);
        let v = 0; for (let j = 0; j < 3; j++) v += kk.b[j] * Math.exp(-0.5 * ((D - kk.a[j]) / kk.w[j]) ** 2);
        v *= 1 / (1 + Math.exp((D - 1) * 10)); data[4 * (y * n + x) + c] = v; sum += v;
      }
      for (let i = c; i < data.length; i += 4) data[i] /= sum;
    });
    kernelTex = GL.texture(gl, n, n, data);
  }
  function seed() {
    const d = new Float32Array(N * N * 4);
    for (let y = N / 2 - 20; y < N / 2 + 20; y++) for (let x = N / 2 - 20; x < N / 2 + 20; x++) d[4 * (y * N + x)] = Math.random();
    A.upload(d);
  }
  return {
    id: "flowlenia", title: "Flow-Lenia", short: "Plantec et al. 2023", folder: "02_flow_lenia_plantec2023",
    cite: "E. Plantec, G. Hamon, M. Etcheverry, P.-Y. Oudeyer, C. Moulin-Frier, B. W.-C. Chan, <i>Flow-Lenia: towards open-ended evolution in cellular automata through mass conservation and parameter localization</i>, ALIFE 2023.",
    about: `<p>Lenia with one change: matter is not created or destroyed, it <i>moves</i>. Lenia's growth becomes an affinity map U,
      matter flows up its gradient (and away from crowding), and reintegration tracking (Moroz 2020) moves it so that the total mass
      never changes; watch the readout.</p><p>The paper's claim, measured in Python on 80 random rules: 78 form compact creatures in
      Flow-Lenia, against 1 in plain Lenia (where 43 die and 36 spread over the world). Mass stays constant to 10⁻¹⁴.
      Press <b>new rule</b> for random rules; this live version uses 3 kernels, the full model 10.</p>`,
    evomaxx: `<p>Every EvoMaxx physics that moves matter (hue transport, colour flocking, chemotaxis, swirl, currents, physarum) moves it
      by <b>reintegration tracking</b>, as Flow-Lenia does: each cell's colour is spread as a small square where its velocity takes it,
      so each chemical's total is conserved. EvoMaxx's own idea is the velocity: the cell's <b>hue is its heading and its saturation
      its speed</b>.</p>`,
    controls: [
      { label: "steps per frame", key: "speed", min: 1, max: 6, step: 1, value: 2, digits: 0 },
      { button: "new rule", action: env => { rule = randomRule(); build(env); seed(); } },
      { button: "reseed", action: () => seed() },
    ],
    init(env) {
      const gl = env.gl;
      affinity = GL.program(gl, AFFINITY); flow = GL.program(gl, FLOW); move = GL.program(gl, MOVE); show = GL.program(gl, GL.SHOW(PAINT));
      A = GL.pingpong(gl, N, N, null, true);
      U = { tex: GL.texture(gl, N, N, null, true) }; U.fb = GL.framebuffer(gl, U.tex);
      F = { tex: GL.texture(gl, N, N) }; F.fb = GL.framebuffer(gl, F.tex);
      rule = randomRule(); build(env); seed();
    },
    frame(env) {
      const gl = env.gl, size = [N, N];
      for (let i = 0; i < env.params.speed; i++) {
        GL.pass(gl, affinity, U.fb, N, N, [["state", A.read], ["kernel", kernelTex]],
                { m: rule.k.map(k => k.m), s: rule.k.map(k => k.s), h: rule.k.map(k => k.h), size });
        GL.pass(gl, flow, F.fb, N, N, [["state", A.read], ["affinity", U.tex]], { size });
        GL.pass(gl, move, A.target, N, N, [["state", A.read], ["flow", F.tex]], { size });
        A.swap();
      }
      GL.pass(gl, show, null, env.width, env.height, [["state", A.read]], { screen: [env.width, env.height], size, zoom: Math.min(env.width, env.height) / N });
      if (++frameCount % 20 === 0) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, A.fb[A.i]);
        const px = new Float32Array(N * N * 4); gl.readPixels(0, 0, N, N, gl.RGBA, gl.FLOAT, px);
        let m = 0; for (let i = 0; i < px.length; i += 4) m += px[i];
        env.readout(`total mass ${m.toFixed(3)} (conserved) · kernels reach ${Math.max(...rule.k.map(k => (rule.R + 15) * k.r)).toFixed(0)} cells · 3 kernels`);
      }
    },
  };
})());
