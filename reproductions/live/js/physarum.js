"use strict";
// Jones's particle model of Physarum (2010), live on the GPU: particles sense the trail at
// three sensors (offset SO, angles 0 and +-SA), turn by RA, step forward and deposit; the trail
// diffuses (3 x 3 mean) and decays by 10 %. Unlike ../04_physarum_jones2010 (C, one particle
// per site, random order), the GPU moves all particles at once and lets them share sites.
MODELS.push((() => {
  const N = 256, SIDE = 100;                    // 256^2 world; 100^2 = 10,000 particles (15 %)
  const AGENTS = `#version 300 es
precision highp float;
uniform sampler2D agents, trail; uniform float sa, ra, so, frame; uniform vec2 size;
out vec4 result;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + frame * 0.618) * 43758.5453); }
float sense(vec2 pos, float a) { return texture(trail, (floor(pos + so * vec2(cos(a), sin(a))) + 0.5) / size).r; }
void main() {
  vec4 s = texelFetch(agents, ivec2(gl_FragCoord.xy), 0);
  vec2 pos = s.xy; float a = s.z;
  float f = sense(pos, a), fl = sense(pos, a - sa), fr = sense(pos, a + sa);
  if (f > fl && f > fr) {}
  else if (f < fl && f < fr) a += hash(gl_FragCoord.xy) < 0.5 ? -ra : ra;
  else if (fl < fr) a += ra;
  else if (fr < fl) a -= ra;
  pos = mod(pos + vec2(cos(a), sin(a)), size);
  result = vec4(pos, a, 1.0);
}`;
  const DEPOSIT_V = `#version 300 es
uniform sampler2D agents; uniform vec2 size; uniform int side;
void main() {
  vec4 s = texelFetch(agents, ivec2(gl_VertexID % side, gl_VertexID / side), 0);
  gl_Position = vec4((floor(s.xy) + 0.5) / size * 2.0 - 1.0, 0.0, 1.0); gl_PointSize = 1.0;
}`;
  const DEPOSIT_F = `#version 300 es
precision highp float; out vec4 result; void main() { result = vec4(5.0, 0.0, 0.0, 0.0); }`;
  const DIFFUSE = `#version 300 es
precision highp float;
uniform sampler2D trail; uniform vec2 size;
out vec4 result;
void main() {
  float s = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) s += texture(trail, (gl_FragCoord.xy + vec2(x, y)) / size).r;
  result = vec4(0.9 * s / 9.0, 0.0, 0.0, 1.0);
}`;
  const PAINT = `vec3 paint(vec4 s) { float g = pow(clamp(s.r / 14.0, 0.0, 1.0), 0.6);
    return vec3(0.95 * g, 0.8 * pow(g, 1.4), 0.25 * g * g); }`;
  let agents, trail, step, deposit, diffuse, show, frameCount = 0;

  function reset(env) {
    const gl = env.gl, d = new Float32Array(SIDE * SIDE * 4);
    for (let i = 0; i < SIDE * SIDE; i++) { d[4 * i] = Math.random() * N; d[4 * i + 1] = Math.random() * N; d[4 * i + 2] = Math.random() * 2 * Math.PI; }
    agents.upload(d); trail.upload(new Float32Array(N * N * 4));
  }
  return {
    id: "physarum", title: "Physarum", short: "Jones 2010 · slime mould", folder: "04_physarum_jones2010",
    cite: "J. Jones, <i>Characteristics of pattern formation and evolution in approximations of Physarum transport networks</i>, Artificial Life 16 (2010); parameters from Jones, Natural Computing 10 (2011), Fig. 2.",
    about: `<p>Ten thousand particles, each with three sensors ahead (straight, left and right, at distance SO). Each step a particle
      turns towards the strongest trail, steps forward and leaves trail behind; the trail spreads and fades. Nobody plans a network,
      yet one forms: a mesh of veins that slowly <b>coarsens</b> as small loops close, like the slime mould's.</p>
      <p>Measured in Python (with Jones's one-particle-per-site rule): the loops (lacunae) fall from 49 to 8 over 3,000 steps.
      Jones's remark that the sensor and rotation angles control contraction against branching was <i>not</i> reproduced by our
      measures; see the README.</p>`,
    evomaxx: `<p>EvoMaxx's <b>physarum</b> physics is this rule made continuous and coloured: each cell's <i>hue</i> is its heading, it
      senses ahead-left and ahead-right along it, turns its hue towards where its own colour is stronger, and moves by hue transport.
      With the gaze kernel it gave EvoMaxx's best creatures: 82 % of fresh genomes formed localised organisms, against 22 % before
      (p ≈ 10⁻⁷).</p>`,
    controls: [
      { label: "sensor angle SA (°)", key: "sa", min: 5, max: 90, step: 0.5, value: 22.5, digits: 1 },
      { label: "rotation angle RA (°)", key: "ra", min: 5, max: 90, step: 0.5, value: 45, digits: 1 },
      { label: "sensor offset SO", key: "so", min: 2, max: 20, step: 1, value: 9, digits: 0 },
      { label: "steps per frame", key: "speed", min: 1, max: 6, step: 1, value: 2, digits: 0 },
      { button: "restart", action: env => reset(env) },
    ],
    init(env) {
      const gl = env.gl;
      step = GL.program(gl, AGENTS); deposit = GL.program(gl, DEPOSIT_F, DEPOSIT_V); diffuse = GL.program(gl, DIFFUSE); show = GL.program(gl, GL.SHOW(PAINT));
      agents = GL.pingpong(gl, SIDE, SIDE); trail = GL.pingpong(gl, N, N, null, true);
      reset(env);
    },
    frame(env) {
      const gl = env.gl, p = env.params, size = [N, N];
      for (let i = 0; i < p.speed; i++) {
        GL.pass(gl, step, agents.target, SIDE, SIDE, [["agents", agents.read], ["trail", trail.read]],
                { sa: p.sa * Math.PI / 180, ra: p.ra * Math.PI / 180, so: p.so, frame: frameCount + i * 0.37, size });
        agents.swap();
        // deposit: one point per particle, added to the trail
        gl.useProgram(deposit.p);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, agents.read); gl.uniform1i(deposit.u.agents, 0);
        gl.uniform2f(deposit.u.size, N, N); gl.uniform1i(deposit.u.side, SIDE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, trail.fb[trail.i]); gl.viewport(0, 0, N, N);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.disableVertexAttribArray(0);
        gl.drawArrays(gl.POINTS, 0, SIDE * SIDE);
        gl.disable(gl.BLEND); gl.enableVertexAttribArray(0);
        GL.pass(gl, diffuse, trail.target, N, N, [["trail", trail.read]], { size });
        trail.swap();
      }
      frameCount++;
      GL.pass(gl, show, null, env.width, env.height, [["state", trail.read]], { screen: [env.width, env.height], size, zoom: Math.min(env.width, env.height) / N });
      env.readout(`10,000 particles · SA ${p.sa}° · RA ${p.ra}° · SO ${p.so}`);
    },
  };
})());
