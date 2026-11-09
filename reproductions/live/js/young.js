"use strict";
// Young's local activator-inhibitor model (1984), live, with the parameters of Piasecki et al.
// (2018): L = 83, R1 = 1.5, R2 = 6, w1 = 1; a cell counts itself. Synchronous updates:
// W > eps -> differentiated, W < eps -> not, W = eps -> unchanged.
MODELS.push((() => {
  const L = 83, R1 = 1.5, R2 = 6;
  const STEP = `#version 300 es
precision highp float;
uniform sampler2D state; uniform float w2, eps; uniform vec2 size;
out vec4 result;
void main() {
  vec2 p = gl_FragCoord.xy; float W = 0.0;
  for (int y = -6; y <= 6; y++) for (int x = -6; x <= 6; x++) {
    float r = length(vec2(x, y));
    if (r > ${R2.toFixed(1)}) continue;
    float dc = texture(state, (p + vec2(x, y)) / size).r;
    W += dc * (r <= ${R1} ? 1.0 : w2);
  }
  W = floor(W * 1e5 + 0.5) / 1e5;                       // exact sums of w1 and w2
  float now = texture(state, p / size).r;
  result = vec4(W > eps ? 1.0 : (W < eps ? 0.0 : now), 0.0, 0.0, 1.0);
}`;
  const PAINT = `vec3 paint(vec4 s) { return mix(vec3(0.93, 0.87, 0.72), vec3(0.12, 0.08, 0.06), s.r); }`;
  let world, step, show, j = 0, stable = false, clock = 0, previous = null;

  function reset(mode) {
    const d = new Float32Array(L * L * 4);
    if (mode === "single") d[4 * (41 * L + 41)] = 1;
    else { const sites = new Set(); while (sites.size < 455) sites.add(Math.floor(Math.random() * L * L)); for (const s of sites) d[4 * s] = 1; }
    world.upload(d); j = 0; stable = false; previous = null;
  }
  return {
    id: "young", title: "Activator–inhibitor", short: "Young 1984 · the Mexican hat", folder: "03_activator_inhibitor_young1984",
    cite: "D. A. Young, <i>A local activator-inhibitor model of vertebrate skin patterns</i>, Math. Biosci. 72 (1984); parameters as in R. Piasecki, W. Olchawa, K. Smaga, Acta Phys. Pol. B 49 (2018).",
    about: `<p>Cells are pigmented (dark) or not. Every dark cell <b>activates</b> its close neighbours (within 1.5 cells, weight +1)
      and <b>inhibits</b> those further out (to 6 cells, weight w₂ &lt; 0). A cell is dark where the sum is positive. Local activation
      and long-range inhibition: Turing's mechanism without diffusion, the pattern of animal skins.</p>
      <p>Weak inhibition gives stripes, strong inhibition spots. Measured in Python: from one dark cell the pattern stops at exactly
      step 115 (paper: 115), and at 71 with ε = 0.04 (paper: 71), provided a cell counts itself in its own sum.</p>`,
    evomaxx: `<p>This activation–inhibition profile is EvoMaxx's <b>Mexican hat</b> kernel (a difference of Gaussians, positive at the
      centre and negative around it), part of the default rule: Mexican hat · v1 decay · tangent · hue transport was lifelike for
      95 % of fresh genomes in the EvoMaxx experiments.</p>`,
    controls: [
      { label: "inhibition w₂", key: "w2", min: -0.3, max: -0.02, step: 0.01, value: -0.08, digits: 2, change: () => { stable = false; } },
      { label: "environment ε", key: "eps", min: -0.5, max: 0.5, step: 0.01, value: 0, digits: 2, change: () => { stable = false; } },
      { label: "iterations per second", key: "rate", min: 1, max: 60, step: 1, value: 12, digits: 0 },
      { button: "one cell", action: () => reset("single") }, { button: "455 random cells", action: () => reset("random") },
    ],
    init(env) {
      step = GL.program(env.gl, STEP); show = GL.program(env.gl, GL.SHOW(PAINT));
      world = GL.pingpong(env.gl, L, L); reset("single");
    },
    frame(env, dt) {
      const gl = env.gl, p = env.params;
      clock += dt;
      if (!stable && clock > 1 / p.rate) {
        clock = 0;
        GL.pass(gl, step, world.target, L, L, [["state", world.read]], { w2: p.w2, eps: p.eps, size: [L, L] });
        world.swap(); j++;
        gl.bindFramebuffer(gl.FRAMEBUFFER, world.fb[world.i]);
        const px = new Float32Array(L * L * 4); gl.readPixels(0, 0, L, L, gl.RGBA, gl.FLOAT, px);
        let n = 0, changed = 0; for (let i = 0; i < px.length; i += 4) { n += px[i]; if (previous && px[i] !== previous[i]) changed++; }
        if (previous && changed === 0) stable = true;
        previous = px;
        env.readout(`iteration ${j} · ${n} dark cells${stable ? ` · stable: final step ${j}` : ` · ${changed} changed`}`);
      }
      GL.pass(gl, show, null, env.width, env.height, [["state", world.read]], { screen: [env.width, env.height], size: [L, L], zoom: Math.min(env.width, env.height) / L });
    },
  };
})());
