"use strict";
// Turing patterns with Gierer-Meinhardt kinetics (Murray's dimensionless form), live:
// du/dt = a - b u + u^2/v + lap u,  dv/dt = u^2 - v + d lap v. Patterns appear above d_c.
MODELS.push((() => {
  const N = 256, A = 0.1, B = 1.0, U0 = (A + 1) / B, V0 = U0 * U0;
  // Turing's critical d for these kinetics (as computed in ../10_turing_gierer_meinhardt1972)
  const fu = -B + 2 / U0, fv = -1 / (U0 * U0), gu = 2 * U0, gv = -1, det = fu * gv - fv * gu;
  const qa = fu * fu, qb = 2 * fu * gv - 4 * det, qc = gv * gv, DC = (-qb + Math.sqrt(qb * qb - 4 * qa * qc)) / (2 * qa);
  const STEP = `#version 300 es
precision highp float;
uniform sampler2D state; uniform float d, dt, h; uniform vec2 size;
out vec4 result;
vec2 at(vec2 p) { return texture(state, p / size).rg; }
void main() {
  vec2 p = gl_FragCoord.xy, s = at(p);
  vec2 lap = (at(p + vec2(1, 0)) + at(p - vec2(1, 0)) + at(p + vec2(0, 1)) + at(p - vec2(0, 1)) - 4.0 * s) / (h * h);
  float u = s.x, v = max(s.y, 1e-4);
  result = vec4(max(s + dt * vec2(${A.toFixed(3)} - ${B.toFixed(3)} * u + u * u / v + lap.x, u * u - v + d * lap.y), 0.0), 0.0, 1.0);
}`;
  const PAINT = `vec3 paint(vec4 s) { float u = clamp((s.r - 0.3) / 3.0, 0.0, 1.0); return vec3(pow(u, 0.7), pow(u, 1.6) * 0.8, 0.3 * u + 0.3 * pow(u, 4.0)); }`;
  let world, step, show;
  function reset() {
    const data = new Float32Array(N * N * 4);
    for (let i = 0; i < N * N; i++) { data[4 * i] = U0 * (1 + 0.01 * (Math.random() * 2 - 1)); data[4 * i + 1] = V0 * (1 + 0.01 * (Math.random() * 2 - 1)); }
    world.upload(data);
  }
  return {
    id: "turing", title: "Turing patterns", short: "Turing 1952 · Gierer–Meinhardt 1972", folder: "10_turing_gierer_meinhardt1972",
    cite: "A. M. Turing, <i>The chemical basis of morphogenesis</i>, Phil. Trans. R. Soc. B 237 (1952); A. Gierer, H. Meinhardt, <i>A theory of biological pattern formation</i>, Kybernetik 12 (1972).",
    about: `<p>Two chemicals: an activator that makes more of itself and of an inhibitor, and an inhibitor that spreads faster and holds the
      activator back. Well stirred, the mixture is stable. Turing's discovery: let them diffuse at different rates and the uniform state
      breaks into spots and stripes on its own. Here the inhibitor diffuses d times faster than the activator.</p><p>Linear stability predicts
      the critical ratio, d<sub>c</sub> = ${DC.toFixed(2)}, and the wavelength of the pattern. Measured in Python: noise dies away at 0.95 d<sub>c</sub>
      and a pattern grows at 1.05 d<sub>c</sub>; its wavelength matches the predicted fastest-growing mode. Try the slider below and above d<sub>c</sub>.</p>`,
    evomaxx: `<p>EvoMaxx was born as a reaction–diffusion system: v1's README calls itself "reaction-diffusion gene regulatory networks", and its first
      mode is "Turing patterns: stripes, spots, labyrinths". Every EvoMaxx step is reaction (the genes) plus diffusion-like spreading (the
      neighbourhood averages at three scales), and its Mexican hat kernel puts Turing's short-range activation and long-range inhibition into a
      single kernel.</p>`,
    controls: [
      { label: "diffusion ratio d / d_c", key: "ratio", min: 0.5, max: 6, step: 0.05, value: 2, digits: 2 },
      { label: "steps per frame", key: "speed", min: 1, max: 60, step: 1, value: 30, digits: 0 },
      { button: "restart from noise", action: () => reset() },
    ],
    init(env) { step = GL.program(env.gl, STEP); show = GL.program(env.gl, GL.SHOW(PAINT)); world = GL.pingpong(env.gl, N, N, null, true); reset(); },
    frame(env) {
      const gl = env.gl, p = env.params, d = p.ratio * DC, h = 1.0, dt = 0.5 * h * h / (4 * d);
      for (let i = 0; i < p.speed; i++) { GL.pass(gl, step, world.target, N, N, [["state", world.read]], { d, dt, h, size: [N, N] }); world.swap(); }
      GL.pass(gl, show, null, env.width, env.height, [["state", world.read]], { screen: [env.width, env.height], size: [N, N], zoom: Math.min(env.width, env.height) / N });
      env.readout(`d = ${d.toFixed(1)} (${p.ratio.toFixed(2)} d_c) · ${p.ratio > 1 ? "above d_c: a pattern grows" : "below d_c: the noise dies away"}`);
    },
  };
})());
