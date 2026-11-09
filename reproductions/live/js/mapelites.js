"use strict";
// MAP-Elites (Mouret & Clune 2015), live, on a 12-joint planar arm: behaviour = where the hand
// is (64 x 64 cells), fitness = smoothness (minus the spread of the joint angles). Random
// sampling runs beside it with the same number of evaluations. Click a cell: its arm.
MODELS.push((() => {
  const J = 12, G = 64;
  let me, rs, evals, chosen = null;
  function arm(g) {
    let a = 0, x = 0, y = 0; const pts = [[0, 0]], angles = [];
    for (let i = 0; i < J; i++) { const t = (g[i] - 0.5) * 2 * Math.PI; angles.push(t); a += t; x += Math.cos(a) / J; y += Math.sin(a) / J; pts.push([x, y]); }
    const mean = angles.reduce((s, v) => s + v, 0) / J;
    const fit = -Math.sqrt(angles.reduce((s, v) => s + (v - mean) ** 2, 0) / J);
    return { fit, x, y, pts };
  }
  const cell = (x, y) => Math.min(G - 1, Math.floor((x + 1) / 2 * G)) + G * Math.min(G - 1, Math.floor((y + 1) / 2 * G));
  function archive() { return { fit: new Float64Array(G * G).fill(-Infinity), genome: new Array(G * G), filled: [] }; }
  function add(A, g) {
    const r = arm(g), c = cell(r.x, r.y);
    if (r.fit > A.fit[c]) { if (A.fit[c] === -Infinity) A.filled.push(c); A.fit[c] = r.fit; A.genome[c] = g; }
  }
  const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
  function reset() { me = archive(); rs = archive(); evals = 0; chosen = null; }
  function layout(env) {
    const side = Math.min((env.width - 60 * env.dpr) / 2, env.height - 120 * env.dpr);
    return { side, x: [20 * env.dpr, 40 * env.dpr + side], y: 50 * env.dpr };
  }
  return {
    id: "mapelites", title: "MAP-Elites", short: "Mouret & Clune 2015 · illumination", folder: "07_map_elites_mouret2015", flat: true,
    cite: "J.-B. Mouret, J. Clune, <i>Illuminating search spaces by mapping elites</i>, arXiv:1504.04909 (2015). Arm benchmark as in later quality-diversity work.",
    about: `<p>Instead of one best solution, MAP-Elites keeps the best solution of <i>each kind</i>: a grid over a feature of the
      solutions (here: where a 12-joint arm puts its hand), one elite per cell. It mutates random elites and keeps children that fill
      an empty cell or beat its elite. Colour: how smooth the arm is (bright = smoother).</p><p>Measured in Python over 200,000
      evaluations: see the README for coverage and quality against random sampling and against an optimiser of smoothness alone.
      Click a cell to see its arm.</p>`,
    evomaxx: `<p>EvoMaxx's <b>Discover</b> mode is MAP-Elites: genomes of the current rule are tested nine at a time and kept in an
      8 × 8 atlas by hue of the world's mean colour and by its activity, one elite per cell, so you see every kind of organism the rule
      can make instead of only the "best" one.</p>`,
    controls: [
      { label: "evaluations per frame", key: "speed", min: 10, max: 2000, step: 10, value: 300, digits: 0 },
      { label: "mutation σ", key: "sigma", min: 0.01, max: 0.3, step: 0.01, value: 0.1, digits: 2 },
      { button: "restart", action: () => reset() },
    ],
    init() { reset(); },
    click(env, x, y) {
      const L = layout(env);
      for (const [k, A] of [[0, me], [1, rs]]) {
        const u = (x - L.x[k]) / L.side, v = 1 - (y - L.y) / L.side;
        if (u >= 0 && u < 1 && v >= 0 && v < 1) { const c = Math.floor(u * G) + G * Math.floor(v * G); if (A.genome[c]) chosen = { k, c, g: A.genome[c] }; }
      }
    },
    frame(env) {
      const p = env.params, c = env.ctx;
      for (let i = 0; i < p.speed; i++) {
        evals++;
        add(rs, Float64Array.from({ length: J }, Math.random));
        if (me.filled.length < 100) add(me, Float64Array.from({ length: J }, Math.random));
        else { const parent = me.genome[me.filled[Math.floor(Math.random() * me.filled.length)]];
               add(me, parent.map(v => Math.min(1, Math.max(0, v + p.sigma * gauss())))); }
      }
      const L = layout(env);
      c.fillStyle = "#050508"; c.fillRect(0, 0, env.width, env.height);
      const img = c.createImageData(G, G);
      [me, rs].forEach((A, k) => {
        for (let i = 0; i < G * G; i++) {
          const x = i % G, y = G - 1 - Math.floor(i / G), j = 4 * (y * G + x), f = A.fit[i];
          if (f === -Infinity) { img.data[j] = 18; img.data[j + 1] = 18; img.data[j + 2] = 28; }
          else { const t = 1 + f / Math.PI; img.data[j] = 255 * t * t; img.data[j + 1] = 200 * t; img.data[j + 2] = 120 + 100 * (1 - t); }
          img.data[j + 3] = 255;
        }
        const tmp = document.createElement("canvas"); tmp.width = tmp.height = G; tmp.getContext("2d").putImageData(img, 0, 0);
        c.imageSmoothingEnabled = false; c.drawImage(tmp, L.x[k], L.y, L.side, L.side);
        c.fillStyle = "#e9e7f2"; c.font = `${13 * env.dpr}px monospace`;
        c.fillText(`${k ? "random sampling" : "MAP-Elites"}: ${(100 * A.filled.length / (G * G)).toFixed(1)} % of cells`, L.x[k], L.y - 12 * env.dpr);
      });
      if (chosen) {
        const pts = arm(chosen.g).pts, s = L.side / 2, ox = L.x[chosen.k] + s, oy = L.y + s;
        c.strokeStyle = "#6ff0e0"; c.lineWidth = 2.5 * env.dpr; c.beginPath();
        pts.forEach(([x, y], i) => (i ? c.lineTo : c.moveTo).call(c, ox + x * s, oy - y * s)); c.stroke(); c.lineWidth = 1;
      }
      env.readout(`${evals.toLocaleString()} evaluations each · MAP-Elites ${me.filled.length} cells, random ${rs.filled.length}`);
    },
  };
})());
