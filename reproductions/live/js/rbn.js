"use strict";
// Random Boolean networks (Kauffman 1969), live: N genes, each switched by K random genes
// through a random Boolean function. Time runs down the screen; a copy of the network started
// one gene different shows the damage in red.
MODELS.push((() => {
  const N = 200;
  let inputs, table, a, b, rows, k;
  function build(env) {
    k = env.params.k;
    inputs = Array.from({ length: N }, () => { const s = new Set(); while (s.size < k) s.add(Math.floor(Math.random() * N)); return [...s]; });
    table = Array.from({ length: N }, () => Uint8Array.from({ length: 1 << k }, () => (Math.random() < 0.5 ? 1 : 0)));
    restart();
  }
  function restart() {
    a = Uint8Array.from({ length: N }, () => (Math.random() < 0.5 ? 1 : 0));
    b = a.slice(); b[Math.floor(Math.random() * N)] ^= 1;
    rows = [];
  }
  function step(x) {
    const y = new Uint8Array(N);
    for (let i = 0; i < N; i++) { let idx = 0; for (const j of inputs[i]) idx = (idx << 1) | x[j]; y[i] = table[i][idx]; }
    return y;
  }
  return {
    id: "rbn", title: "Gene networks", short: "Kauffman 1969 · order and chaos", folder: "11_boolean_networks_kauffman1969", flat: true,
    cite: "S. A. Kauffman, <i>Metabolic stability and epigenesis in randomly constructed genetic nets</i>, J. Theor. Biol. 22 (1969); B. Derrida, Y. Pomeau, Europhys. Lett. 1 (1986).",
    about: `<p>Two hundred genes, each on or off, each switched by K other genes through a random rule. Every column is a gene, every row a moment;
      time runs down. A second copy starts with one gene flipped: where they differ is drawn in red.</p><p>With K = 1 or 2 the network settles into a
      short cycle and the flipped gene's effect stays small or dies: order. From K = 3 on, the damage spreads to a fixed share of all genes: chaos.
      Measured in Python: the transition is at K = 2, where the Derrida map's slope is 1, and the damage settles on the annealed prediction
      (0.38, 0.46, 0.48 for K = 3, 4, 5).</p>`,
    evomaxx: `<p>EvoMaxx v1 called its genome a <b>gene regulatory network</b>: eight genes, each a rule by which one chemical regulates another. EvoMaxx's
      genes are continuous and spatial rather than Boolean, but the question Kauffman asked is EvoMaxx's too: which random networks are ordered,
      which chaotic, and which live in between, where structure can last and still change. The health measures (dead, frozen, alive, noise) sort
      EvoMaxx's worlds along the same axis.</p>`,
    controls: [
      { label: "inputs per gene K", key: "k", min: 1, max: 6, step: 1, value: 2, digits: 0, change: env => build(env) },
      { label: "steps per frame", key: "speed", min: 1, max: 4, step: 1, value: 1, digits: 0 },
      { button: "new network", action: env => build(env) }, { button: "restart, one gene flipped", action: () => restart() },
    ],
    init(env) { build(env); },
    frame(env) {
      const c = env.ctx, p = env.params;
      for (let s = 0; s < p.speed; s++) { a = step(a); b = step(b); rows.push([a, b]); }
      const cell = Math.max(1, Math.floor(Math.min(env.width / N, 3 * env.dpr))), maxRows = Math.floor(env.height / cell);
      if (rows.length > maxRows) rows.splice(0, rows.length - maxRows);
      c.fillStyle = "#050508"; c.fillRect(0, 0, env.width, env.height);
      const x0 = (env.width - N * cell) / 2;
      rows.forEach(([x, y], r) => { for (let i = 0; i < N; i++) {
        c.fillStyle = x[i] !== y[i] ? "#ff5050" : x[i] ? "#e9e7f2" : "#1b1b2a"; c.fillRect(x0 + i * cell, r * cell, cell, cell); } });
      let damage = 0; for (let i = 0; i < N; i++) damage += a[i] !== b[i];
      env.readout(`K = ${k} · damage now ${(100 * damage / N).toFixed(1)} % of the genes (annealed prediction for K ≥ 3: ${k >= 3 ? (100 * (() => { let d = 0.01; for (let i = 0; i < 300; i++) d = (1 - (1 - d) ** k) / 2; return d; })()).toFixed(0) : 0} %)`);
    },
  };
})());
