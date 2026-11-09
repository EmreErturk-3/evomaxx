"use strict";
// The edge of chaos (Langton 1990), live: a one-dimensional automaton with 4 states and
// neighbourhoods of 5 cells; lambda, the share of the rule table that leads to a non-quiescent
// state, is raised by Langton's table walk-through (entries filled one by one, in a fixed random
// order). Time runs down the screen.
MODELS.push((() => {
  const K = 4, NB = 5, ENTRIES = K ** NB, CELLS = 256;
  let table, order, values, x, rows, filled;
  const COLOURS = ["#08080e", "#ff6b6b", "#6bff8f", "#6b9bff"];
  function newWalk() {
    order = Array.from({ length: ENTRIES - 1 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);
    values = order.map(() => 1 + Math.floor(Math.random() * (K - 1)));
    filled = -1;
  }
  function setLambda(env) {
    const n = Math.round(env.params.lambda * ENTRIES);
    if (n === filled) return;
    table = new Uint8Array(ENTRIES);
    for (let i = 0; i < n; i++) table[order[i]] = values[i];
    filled = n; restart();
  }
  function restart() { x = Uint8Array.from({ length: CELLS }, () => Math.floor(Math.random() * K)); rows = []; }
  function step() {
    const y = new Uint8Array(CELLS);
    for (let i = 0; i < CELLS; i++) {
      let idx = 0; for (let j = -2; j <= 2; j++) idx = idx * K + x[(i + j + CELLS) % CELLS];
      y[i] = table[idx];
    }
    x = y;
  }
  return {
    id: "langton", title: "Edge of chaos", short: "Langton 1990 · λ", folder: "12_edge_of_chaos_langton1990", flat: true,
    cite: "C. G. Langton, <i>Computation at the edge of chaos: phase transitions and emergent computation</i>, Physica D 42 (1990).",
    about: `<p>A row of cells, each in one of four states, updated from itself and two neighbours on each side; time runs down. λ is the share of the
      rule table that leads anywhere but the quiescent state (black). Raise it slowly: rules die out, then freeze into stripes, then, in a narrow
      band, produce long-lived moving structures, then turn into noise.</p><p>Measured in Python over 40 walk-throughs: the cell entropy rises
      most steeply at λ ≈ 0.37, transients outgrow every window there, and the information a cell carries about its own future is highest at
      intermediate entropy, between order and chaos.</p>`,
    evomaxx: `<p>EvoMaxx sorts its worlds the way Langton and Wolfram sorted rules: <b>dead</b> and <b>frozen</b> (order), <b>noise</b> (chaos) and
      <b>alive</b> in between, changing structure above the cell scale. v1's own fitness already aimed there: neither dead nor saturated, a
      middling brightness and texture. Every EvoMaxx experiment counts how often a rule lands in the middle band.</p>`,
    controls: [
      { label: "λ", key: "lambda", min: 0, max: 0.75, step: 0.01, value: 0.36, digits: 2, change: env => setLambda(env) },
      { label: "steps per frame", key: "speed", min: 1, max: 6, step: 1, value: 2, digits: 0 },
      { button: "new walk-through", action: env => { newWalk(); setLambda(env); } }, { button: "restart", action: () => restart() },
    ],
    init(env) { newWalk(); setLambda(env); },
    frame(env) {
      const c = env.ctx;
      for (let s = 0; s < env.params.speed; s++) { step(); rows.push(x); }
      const cell = Math.max(1, Math.floor(Math.min(env.width / CELLS, 3 * env.dpr))), maxRows = Math.floor(env.height / cell);
      if (rows.length > maxRows) rows.splice(0, rows.length - maxRows);
      c.fillStyle = "#050508"; c.fillRect(0, 0, env.width, env.height);
      const x0 = (env.width - CELLS * cell) / 2;
      rows.forEach((r, t) => { for (let i = 0; i < CELLS; i++) if (r[i]) { c.fillStyle = COLOURS[r[i]]; c.fillRect(x0 + i * cell, t * cell, cell, cell); } });
      const counts = [0, 0, 0, 0]; for (const r of rows.slice(-100)) for (const v of r) counts[v]++;
      const total = counts.reduce((s, v) => s + v, 0), H = -counts.reduce((s, v) => (v ? s + (v / total) * Math.log2(v / total) : s), 0);
      env.readout(`λ = ${env.params.lambda.toFixed(2)} · state entropy of the last 100 rows ${H.toFixed(2)} bits (of 2)`);
    },
  };
})());
