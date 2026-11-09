"use strict";
// Kuramoto (1975), live, two ways: a lattice of phase oscillators coupled to their eight
// neighbours, each shown as a hue (the form EvoMaxx's colour flocking takes), and in the
// corner Kuramoto's own mean-field model: 400 oscillators on a circle with the measured
// synchrony r against the exact result r = sqrt(1 - 2 gamma / K) for Lorentzian frequencies.
MODELS.push((() => {
  const N = 192, M = 400;
  const STEP = `#version 300 es
precision highp float;
uniform sampler2D state; uniform float K, dt; uniform vec2 size;
out vec4 result;
void main() {
  vec2 p = gl_FragCoord.xy; vec4 s = texture(state, p / size);       // r: phase, g: natural frequency
  float pull = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    if (x == 0 && y == 0) continue;
    pull += sin(texture(state, (p + vec2(x, y)) / size).r - s.r);
  }
  result = vec4(mod(s.r + dt * (s.g + K / 8.0 * pull), 6.2831853), s.g, 0.0, 1.0);
}`;
  const PAINT = `vec3 paint(vec4 s) { vec3 k = vec3(0.0, 2.0943951, 4.1887902); return 0.55 + 0.45 * cos(s.r - k); }`;
  let world, step, show, theta, omega;
  const lorentz = (q, g) => g * Math.tan(Math.PI * (q - 0.5));

  function reset(env) {
    const g = env.params.gamma ?? 1, d = new Float32Array(N * N * 4);
    for (let i = 0; i < N * N; i++) { d[4 * i] = Math.random() * 2 * Math.PI; d[4 * i + 1] = Math.max(-6, Math.min(6, 0.15 * lorentz(Math.random(), g))); }
    world.upload(d);
    theta = Float64Array.from({ length: M }, () => Math.random() * 2 * Math.PI);
    omega = Float64Array.from({ length: M }, (_, i) => lorentz((i + 0.5) / M, g));
  }
  return {
    id: "kuramoto", title: "Kuramoto oscillators", short: "Kuramoto 1975 · synchrony", folder: "06_kuramoto1975",
    cite: "Y. Kuramoto, <i>Self-entrainment of a population of coupled non-linear oscillators</i>, Lecture Notes in Physics 39 (1975); S. H. Strogatz, Physica D 143 (2000).",
    about: `<p>Oscillators with their own natural speeds, each pulled towards the phases of the others with strength K. Below a critical
      coupling they run independently; above it a growing crowd locks together. For Lorentzian speeds of width γ the result is exact:
      synchrony r = √(1 − 2γ/K) above K<sub>c</sub> = 2γ (inset, corner). Measured in Python with 4,000 oscillators: within 0.01
      of the formula above the transition.</p><p>The big picture is the same coupling on a lattice, every oscillator pulled only by its
      neighbours, its phase shown as a colour: patches of shared colour grow and turn into slowly spinning vortices.</p>`,
    evomaxx: `<p>EvoMaxx's <b>colour flocking</b> is this coupling on the colour wheel: each cell's hue turns towards the hue of its
      neighbourhood, Δθ = κ |c<sub>N</sub>| sin(θ<sub>N</sub> − θ) + ω, where ω is a chirality like the natural frequency here. Because
      hue is also heading in EvoMaxx, aligning colours aligns motion, so matter flocks.</p>`,
    controls: [
      { label: "coupling K", key: "K", min: 0, max: 6, step: 0.05, value: 3, digits: 2 },
      { label: "frequency spread γ", key: "gamma", min: 0.2, max: 2, step: 0.05, value: 1, digits: 2, change: env => reset(env) },
      { label: "steps per frame", key: "speed", min: 1, max: 10, step: 1, value: 3, digits: 0 },
      { button: "scramble", action: env => reset(env) },
    ],
    init(env) { step = GL.program(env.gl, STEP); show = GL.program(env.gl, GL.SHOW(PAINT)); world = GL.pingpong(env.gl, N, N); reset(env); },
    frame(env) {
      const gl = env.gl, p = env.params, dt = 0.05;
      for (let i = 0; i < p.speed; i++) { GL.pass(gl, step, world.target, N, N, [["state", world.read]], { K: p.K, dt, size: [N, N] }); world.swap(); }
      GL.pass(gl, show, null, env.width, env.height, [["state", world.read]], { screen: [env.width, env.height], size: [N, N], zoom: Math.min(env.width, env.height) / N });
      // mean field: d theta/dt = omega + K r sin(psi - theta)
      for (let s = 0; s < 4 * p.speed; s++) {
        let cx = 0, cy = 0; for (let i = 0; i < M; i++) { cx += Math.cos(theta[i]); cy += Math.sin(theta[i]); }
        const r = Math.hypot(cx, cy) / M, psi = Math.atan2(cy, cx);
        for (let i = 0; i < M; i++) theta[i] += dt * (omega[i] + p.K * r * Math.sin(psi - theta[i]));
      }
      let cx = 0, cy = 0; for (let i = 0; i < M; i++) { cx += Math.cos(theta[i]); cy += Math.sin(theta[i]); }
      const r = Math.hypot(cx, cy) / M, theory = Math.sqrt(Math.max(0, 1 - 2 * p.gamma / p.K));
      const c = env.ctx, R = 70 * env.dpr, x0 = R + 20 * env.dpr, y0 = R + 20 * env.dpr;
      c.clearRect(0, 0, env.width, env.height);
      c.fillStyle = "rgba(5,5,8,0.8)"; c.fillRect(x0 - R - 12 * env.dpr, y0 - R - 12 * env.dpr, 2 * R + 24 * env.dpr, 2 * R + 46 * env.dpr);
      c.strokeStyle = "#555"; c.beginPath(); c.arc(x0, y0, R, 0, 2 * Math.PI); c.stroke();
      for (let i = 0; i < M; i += 2) { c.fillStyle = `hsl(${(theta[i] * 180 / Math.PI) % 360},80%,60%)`; c.fillRect(x0 + R * Math.cos(theta[i]) - 2, y0 - R * Math.sin(theta[i]) - 2, 4, 4); }
      c.strokeStyle = "#fff"; c.lineWidth = 2 * env.dpr; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x0 + R * cx / M, y0 - R * cy / M); c.stroke(); c.lineWidth = 1;
      c.fillStyle = "#e9e7f2"; c.font = `${11 * env.dpr}px monospace`;
      c.fillText(`r = ${r.toFixed(2)}  theory ${theory.toFixed(2)}`, x0 - R, y0 + R + 26 * env.dpr);
      env.readout(`mean field (corner): r = ${r.toFixed(3)}, theory √(1 − 2γ/K) = ${theory.toFixed(3)} · K_c = ${(2 * p.gamma).toFixed(2)}`);
    },
  };
})());
