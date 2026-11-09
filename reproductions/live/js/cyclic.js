"use strict";
// Cyclic dominance, live: the deterministic reaction-diffusion form of the rock-paper-scissors
// model of Reichenbach, Mobilia and Frey (2007), the May-Leonard equations with mobility
// (sigma = mu = 1, rho = a + b + c):
//   da/dt = D lap(a) + a (1 - rho) - a c,   db/dt = D lap(b) + b (1 - rho) - b a,
//   dc/dt = D lap(c) + c (1 - rho) - c b       (A beats B beats C beats A)
// with a little noise. The stochastic lattice and its critical mobility are in
// ../05_cyclic_dominance_mayleonard1975.
MODELS.push((() => {
  const N = 256;
  const STEP = `#version 300 es
precision highp float;
uniform sampler2D state; uniform float D, dt, noise, frame; uniform vec2 size;
out vec4 result;
float hash(vec2 p, float s) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + s) * 43758.5453); }
vec3 at(vec2 p) { return texture(state, p / size).rgb; }
void main() {
  vec2 p = gl_FragCoord.xy; vec3 x = at(p);
  vec3 lap = at(p + vec2(1, 0)) + at(p - vec2(1, 0)) + at(p + vec2(0, 1)) + at(p - vec2(0, 1)) - 4.0 * x;
  float rho = x.r + x.g + x.b;
  vec3 predator = x.brg;                                // a is eaten by c, b by a, c by b
  vec3 dx = D * lap + x * (1.0 - rho) - x * predator;
  vec3 xi = vec3(hash(p, frame), hash(p, frame + 7.0), hash(p, frame + 13.0)) - 0.5;
  result = vec4(clamp(x + dt * dx + noise * xi * x, 0.0, 1.0), 1.0);
}`;
  const PAINT = `vec3 paint(vec4 s) { vec3 x = s.rgb; float m = max(max(x.r, x.g), max(x.b, 1e-3));
    return (x / m) * pow(m, 0.6) * vec3(0.95, 0.85, 1.0); }`;
  let world, step, show, frameCount = 0;
  function reset() {
    const d = new Float32Array(N * N * 4);
    for (let i = 0; i < N * N; i++) for (let c = 0; c < 3; c++) d[4 * i + c] = Math.random() * 0.4;
    world.upload(d);
  }
  return {
    id: "cyclic", title: "Cyclic dominance", short: "May–Leonard 1975 · rock-paper-scissors", folder: "05_cyclic_dominance_mayleonard1975",
    cite: "R. M. May, W. J. Leonard, <i>Nonlinear aspects of competition between three species</i>, SIAM J. Appl. Math. 29 (1975); T. Reichenbach, M. Mobilia, E. Frey, <i>Mobility promotes and jeopardizes biodiversity in rock-paper-scissors games</i>, Nature 448 (2007).",
    about: `<p>Three species: red beats green, green beats blue, blue beats red, and each spreads into empty space. Without space,
      May and Leonard showed the populations swing from one species to the next for ever longer (measured: each stay grows by the
      predicted factor). In space, the chase becomes <b>spiral waves</b>.</p><p>Raise the mobility and the spirals grow; in the
      stochastic lattice, above a critical mobility M<sub>c</sub> ≈ 4.5·10⁻⁴ they outgrow the world and two species die out. Measured in
      Python: extinction becomes certain above about 10⁻³ and vanishes below 3·10⁻⁴ as the lattice grows.</p>`,
    evomaxx: `<p>EvoMaxx's <b>cyclic dominance</b> delta adds exactly this to the three chemicals: x<sub>c</sub> += ρ x<sub>c</sub>
      (x<sub>c+1</sub> − x<sub>c−1</sub>), so red eats green, green eats blue and blue eats red, conserving the total. Its
      <b>colour game</b> physics is the related replicator dynamics. In EvoMaxx's experiments cyclic dominance with the tangent
      response was lifelike for 85 % of fresh genomes.</p>`,
    controls: [
      { label: "mobility D", key: "D", min: 0.02, max: 1.2, step: 0.01, value: 0.25, digits: 2 },
      { label: "noise", key: "noise", min: 0, max: 0.05, step: 0.001, value: 0.005, digits: 3 },
      { label: "steps per frame", key: "speed", min: 1, max: 20, step: 1, value: 8, digits: 0 },
      { button: "restart", action: () => reset() },
    ],
    init(env) { step = GL.program(env.gl, STEP); show = GL.program(env.gl, GL.SHOW(PAINT)); world = GL.pingpong(env.gl, N, N); reset(); },
    frame(env) {
      const gl = env.gl, p = env.params, size = [N, N];
      for (let i = 0; i < p.speed; i++) {
        GL.pass(gl, step, world.target, N, N, [["state", world.read]], { D: p.D, dt: 0.2, noise: p.noise, frame: (frameCount++ % 997) * 0.731, size });
        world.swap();
      }
      GL.pass(gl, show, null, env.width, env.height, [["state", world.read]], { screen: [env.width, env.height], size, zoom: Math.min(env.width, env.height) / N });
      env.readout("red beats green · green beats blue · blue beats red");
    },
  };
})());
