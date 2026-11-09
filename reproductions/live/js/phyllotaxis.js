"use strict";
// Vogel's sunflower (1979), live: floret n at r = sqrt(n), angle n * divergence. Turn the angle
// by hundredths of a degree and watch the packing break; colour by n mod a Fibonacci number to
// see the parastichies.
MODELS.push((() => {
  const GOLDEN = 360 * (2 - (1 + Math.sqrt(5)) / 2);
  return {
    id: "phyllotaxis", title: "Phyllotaxis", short: "Vogel 1979 · the golden angle", folder: "08_phyllotaxis_vogel1979", flat: true,
    cite: "H. Vogel, <i>A better way to construct the sunflower head</i>, Mathematical Biosciences 44 (1979).",
    about: `<p>Florets placed one after another, each turned by the same angle and at distance √n from the centre. At the golden angle
      (137.508°) they pack evenly at every radius; move it by a tenth of a degree and gaps and spokes open. The spirals the eye sees
      come in consecutive Fibonacci numbers, larger ones further out.</p><p>Measured in Python: the most even packing over the whole
      head is at 137.508°, 0.1° off is 5 to 10 times less even, and the spiral counts run 13/21, 21/34, 34/55, 55/89, 89/144 from the
      centre out. Colour by a Fibonacci number to light up one family of spirals.</p>`,
    evomaxx: `<p>EvoMaxx's <b>phyllotaxis kernel</b> samples a cell's neighbourhood at Vogel's sunflower points (r = c√n, angle n · 137.5°)
      instead of on rings: a chiral, uneven way of seeing the neighbours, and one of EvoMaxx's tested kernels (with physarum it formed
      localised creatures for 72 % of fresh genomes).</p>`,
    controls: [
      { label: "divergence angle (°)", key: "angle", min: 135, max: 140, step: 0.001, value: +GOLDEN.toFixed(3), digits: 3 },
      { label: "florets", key: "n", min: 100, max: 4000, step: 50, value: 1500, digits: 0 },
      { label: "colour every", key: "every", options: ["none", "13", "21", "34", "55", "89"], value: "21" },
      { button: "golden angle", action: env => { env.params.angle = GOLDEN; document.querySelector("#controls input").value = GOLDEN; } },
    ],
    init() {},
    frame(env) {
      const p = env.params, c = env.ctx, cx = env.width / 2, cy = env.height / 2;
      const scale = 0.46 * Math.min(env.width, env.height) / Math.sqrt(p.n), every = p.every === "none" ? 0 : +p.every;
      c.fillStyle = "#050508"; c.fillRect(0, 0, env.width, env.height);
      const a = p.angle * Math.PI / 180, dot = Math.max(1.5, 0.42 * scale);
      for (let k = 1; k <= p.n; k++) {
        const r = scale * Math.sqrt(k), t = k * a;
        c.fillStyle = every ? `hsl(${(k % every) / every * 360},75%,${55 + 10 * (k / p.n)}%)` : `hsl(${40 + 20 * k / p.n},85%,${45 + 20 * k / p.n}%)`;
        c.beginPath(); c.arc(cx + r * Math.cos(t), cy - r * Math.sin(t), dot, 0, 2 * Math.PI); c.fill();
      }
      env.readout(`angle ${p.angle.toFixed(3)}° (golden ${GOLDEN.toFixed(3)}°, off by ${(p.angle - GOLDEN).toFixed(3)}°) · ${p.n} florets`);
    },
  };
})());
