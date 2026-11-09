"use strict";
// Small WebGL 2 helpers shared by the live models: float textures, framebuffers, full-screen
// passes and ping-pong pairs.
const GL = (() => {
  const VERTEX = `#version 300 es
in vec2 corner; void main() { gl_Position = vec4(corner, 0.0, 1.0); }`;

  function create(canvas) {
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error("WebGL 2 is needed");
    if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("float render targets are needed");
    gl.getExtension("OES_texture_float_linear");
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    return gl;
  }

  function program(gl, fragment, vertex = VERTEX) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + "\n" + src);
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

  // a float texture (RGBA32F), nearest or linear, repeating
  function texture(gl, w, h, data = null, linear = false) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data);
    const f = linear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return t;
  }
  function framebuffer(gl, tex) {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return f;
  }
  // two textures that take turns: read one, write the other
  function pingpong(gl, w, h, data = null, linear = false) {
    const tex = [texture(gl, w, h, data, linear), texture(gl, w, h, data, linear)];
    const fb = tex.map(t => framebuffer(gl, t));
    return { w, h, tex, fb, i: 0, get read() { return this.tex[this.i]; }, get target() { return this.fb[1 - this.i]; },
             swap() { this.i = 1 - this.i; },
             upload(d) { for (const t of tex) { gl.bindTexture(gl.TEXTURE_2D, t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, d); } } };
  }
  // run a full-screen pass: textures as [name, texture] pairs, uniforms as name -> value
  function pass(gl, prog, target, w, h, textures = [], uniforms = {}) {
    gl.useProgram(prog.p);
    textures.forEach(([name, t], i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(prog.u[name], i); });
    for (const [name, v] of Object.entries(uniforms)) {
      const loc = prog.u[name]; if (loc === undefined) continue;
      if (typeof v === "number") gl.uniform1f(loc, v);
      else if (v.int !== undefined) gl.uniform1i(loc, v.int);
      else if (v.length === 2) gl.uniform2fv(loc, v);
      else if (v.length === 3) gl.uniform3fv(loc, v);
      else if (v.length === 4) gl.uniform4fv(loc, v);
      else gl.uniform1fv(loc, v);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  // draw a texture to the screen, fitted and centred, through a colour mapping
  const SHOW = (map) => `#version 300 es
precision highp float;
uniform sampler2D state; uniform vec2 screen, size; uniform float zoom;
out vec4 colour;
${map}
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * screen) / zoom + 0.5 * size;
  colour = vec4(paint(texture(state, p / size)), 1.0);
}`;
  return { create, program, texture, framebuffer, pingpong, pass, SHOW };
})();
