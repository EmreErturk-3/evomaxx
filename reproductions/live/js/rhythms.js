"use strict";
// Euclidean rhythms (Toussaint 2005), live: E(k, n) by Bjorklund's algorithm as the paper
// performs it, drawn as a necklace and played (WebAudio). Pick one of the paper's traditional
// rhythms or set k and n.
MODELS.push((() => {
  const NAMED = { "E(3,8) Cuban tresillo": [3, 8], "E(5,8) Cuban cinquillo": [5, 8], "E(2,5) Khafif-e-ramal (Persia)": [2, 5],
    "E(3,4) Cumbia (Colombia)": [3, 4], "E(4,9) Aksak (Turkey)": [4, 9], "E(5,12) Venda clapping (South Africa)": [5, 12],
    "E(7,12) West African bell": [7, 12], "E(7,16) Samba necklace (Brazil)": [7, 16], "E(9,16) Central African necklace": [9, 16],
    "E(5,16) Bossa-Nova necklace": [5, 16], "E(13,24) Aka Pygmies (Sangha)": [13, 24] };
  function bjorklund(k, n) {
    let groups = Array.from({ length: k }, () => [1]), rest = Array.from({ length: n - k }, () => [0]);
    while (rest.length && groups.length) {
      const pairs = Math.min(groups.length, rest.length);
      const merged = groups.slice(0, pairs).map((g, i) => g.concat(rest[i]));
      rest = groups.length > pairs ? groups.slice(pairs) : rest.slice(pairs); groups = merged;
      if (rest.length <= 1) break;
    }
    return groups.concat(rest).flat();
  }
  let audio = null, step = 0, nextTime = 0, pattern = [1, 0, 0, 1, 0, 0, 1, 0], playing = false;
  function click(t, accent) {
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = accent ? 1250 : 820; g.gain.setValueAtTime(accent ? 0.5 : 0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + 0.1);
  }
  function setPattern(env) { pattern = bjorklund(Math.min(env.params.k, env.params.n), env.params.n); step = 0; }
  return {
    id: "rhythms", title: "Euclidean rhythms", short: "Toussaint 2005 · music from Euclid", folder: "09_euclidean_rhythms_toussaint2005", flat: true,
    cite: "G. T. Toussaint, <i>The Euclidean algorithm generates traditional musical rhythms</i>, BRIDGES (2005).",
    about: `<p>Spread k beats as evenly as possible over n pulses, with Bjorklund's algorithm (Euclid's algorithm in disguise), and you
      get the timelines of music all over the world: E(3,8) is the Cuban tresillo, E(5,8) the cinquillo, E(7,12) a West African bell.</p>
      <p>Measured in Python: the algorithm gives 20 of the paper's 21 rhythms symbol for symbol (the 21st, E(5,16), is printed with 17
      symbols for 16 pulses: a typo), and the paper's sorting of them into Euclidean strings, reverse strings and neither agrees for all 22.</p>`,
    evomaxx: `<p>EvoMaxx's <b>Euclidean</b> drum style plays E(k, 16) with k set by the world: the kick's pulses by how many red bodies
      there are, the snare's by the green ones, the hats' by the blue ones, so the ecology writes the groove. EvoMaxx uses the closed
      form "pulse s sounds if (s·k) mod n &lt; k"; the reproduction checks that it gives a rotation of Bjorklund's rhythm for all 560
      pairs with n ≤ 32.</p>`,
    controls: [
      { label: "traditional rhythm", key: "named", options: Object.keys(NAMED), value: "E(3,8) Cuban tresillo",
        change: env => { const [k, n] = NAMED[env.params.named]; env.params.k = k; env.params.n = n;
          const r = document.querySelectorAll("#controls input"); r[0].value = k; r[1].value = n; setPattern(env); } },
      { label: "beats k", key: "k", min: 1, max: 24, step: 1, value: 3, digits: 0, change: setPattern },
      { label: "pulses n", key: "n", min: 2, max: 24, step: 1, value: 8, digits: 0, change: setPattern },
      { label: "tempo (bpm)", key: "bpm", min: 60, max: 200, step: 1, value: 110, digits: 0 },
      { button: "▶ play / ■ stop", action: () => { audio ??= new AudioContext(); playing = !playing; if (playing) { audio.resume(); nextTime = audio.currentTime + 0.05; } } },
    ],
    init(env) { setPattern(env); },
    stop() { playing = false; },
    frame(env) {
      const p = env.params, c = env.ctx, n = pattern.length, sixteenth = 60 / p.bpm / 4;
      if (playing && audio) while (nextTime < audio.currentTime + 0.1) { if (pattern[step % n]) click(nextTime, step % n === 0); nextTime += sixteenth; step++; }
      c.fillStyle = "#050508"; c.fillRect(0, 0, env.width, env.height);
      const cx = env.width / 2, cy = env.height / 2, R = 0.36 * Math.min(env.width, env.height);
      const pos = i => [cx + R * Math.sin(2 * Math.PI * i / n), cy - R * Math.cos(2 * Math.PI * i / n)];
      const onsets = pattern.map((b, i) => (b ? i : -1)).filter(i => i >= 0);
      c.fillStyle = "rgba(255,207,110,0.25)"; c.beginPath(); onsets.forEach((i, j) => { const [x, y] = pos(i); j ? c.lineTo(x, y) : c.moveTo(x, y); }); c.fill();
      c.strokeStyle = "#555"; c.beginPath(); c.arc(cx, cy, R, 0, 2 * Math.PI); c.stroke();
      const now = playing && audio ? (step - 1 + n) % n : -1;
      pattern.forEach((b, i) => { const [x, y] = pos(i);
        c.fillStyle = i === now ? "#ffffff" : b ? "#ff6b6b" : "#1b1b2a"; c.strokeStyle = "#8f8da0";
        c.beginPath(); c.arc(x, y, (b ? 13 : 8) * env.dpr, 0, 2 * Math.PI); c.fill(); c.stroke(); });
      c.fillStyle = "#e9e7f2"; c.font = `${16 * env.dpr}px monospace`; c.textAlign = "center";
      c.fillText(pattern.map(b => (b ? "x" : ".")).join(" "), cx, cy + 6 * env.dpr); c.textAlign = "start";
      env.readout(`E(${Math.min(p.k, p.n)}, ${p.n}) = [${pattern.map(b => (b ? "x" : ".")).join(" ")}] · intervals (${(() => {
        const iv = []; for (let j = 0; j < onsets.length; j++) iv.push((onsets[(j + 1) % onsets.length] - onsets[j] + n) % n || n); return iv.join(""); })()})`);
    },
  };
})());
