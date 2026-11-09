"use strict";
// EvoMaxx v10 music: the world plays itself. Everything is synthesised with WebAudio and every
// note comes from the world: no samples, no pre-written patterns.
//
// Three channel strips, one per chemical (R, G, B), each with an instrument, octave, level,
// pan, filter, envelope and effects send. Note sources play through the strip of their
// chemical:
//   box      a music box: a bar sweeps the world; the bright cells under it sound (pitch
//            from their position across the bar, velocity from brightness, strip from the
//            dominant chemical);
//   melody   the genome as a sequence: gene i is a note (pitch from mu, loudness from |w|,
//            weak genes rest, inhibitory genes an octave down, length from sigma, strip
//            from the gene's target chemical), so mutations are heard;
//   births   a bright body forming rings its chemical's strip; one fading sounds low;
//   drone    one sustained voice per chemical: loud with its mass, bright with its
//            contrast, trembling with the world's motion;
//   rhythm   drums: motion-driven, Euclidean (pulse counts from how many bodies of each
//            chemical there are), four-on-the-floor or breakbeat.
// The organism's own sound (on by default): its genome picks the instruments (the rule a
// palette of families, the genes the instrument, octave and brightness of each chemical),
// the tempo, scale, swing, drums and melody order, so the music evolves with the organism.
// Harmony: the key follows the mean hue around the circle of fifths (Scriabin's colour-key
// circle, changed on bar lines), the colour balance picks a chord per bar, strong beats
// keep to it and the drone holds it. Any of fifteen scales, equal, just or Pythagorean
// tuning. Effects: ping-pong delay, reverb, drive, tone. Optional: MIDI out, audio
// recording, a microphone that feeds the world.
const EvoMaxxAudio = (() => {

const SCALES = {
  "major pentatonic": [0, 2, 4, 7, 9], "minor pentatonic": [0, 3, 5, 7, 10], major: [0, 2, 4, 5, 7, 9, 11],
  "natural minor": [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10], "harmonic minor": [0, 2, 3, 5, 7, 8, 11],
  blues: [0, 3, 5, 6, 7, 10], hirajoshi: [0, 2, 3, 7, 8], "in-sen": [0, 1, 5, 7, 10], pelog: [0, 1, 3, 7, 8],
  "whole tone": [0, 2, 4, 6, 8, 10], chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
const TUNINGS = {      // frequency ratios of the twelve semitones above the root
  equal: Array.from({ length: 12 }, (_, s) => Math.pow(2, s / 12)),
  just: [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8],
  pythagorean: [1, 256 / 243, 9 / 8, 32 / 27, 81 / 64, 4 / 3, 729 / 512, 3 / 2, 128 / 81, 27 / 16, 16 / 9, 243 / 128],
};
const KEYS = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
// instruments by family; the organism's voice picks a family per chemical from its rule
// and an instrument within it from its genes
const FAMILIES = {
  bells: ["FM bell", "glass", "celesta", "glockenspiel", "gong", "steel drum"],
  keys: ["e-piano", "organ", "harpsichord", "vibraphone"],
  plucked: ["pluck", "harp", "koto", "kalimba"],
  winds: ["flute", "ocarina", "choir", "brass"],
  strings: ["strings", "pad", "colour"],
  synth: ["acid", "supersaw", "chip", "wobble"],
  bass: ["bass", "sub bass", "mallet"],
};
const INSTRUMENT_NAMES = Object.values(FAMILIES).flat();
const PALETTES = [["bass", "plucked", "bells"], ["strings", "keys", "bells"], ["synth", "plucked", "winds"], ["bass", "keys", "winds"],
                  ["plucked", "bells", "strings"], ["synth", "synth", "bells"], ["keys", "winds", "bells"], ["bass", "strings", "plucked"],
                  ["plucked", "winds", "strings"], ["bass", "synth", "keys"], ["bells", "bells", "winds"]];
// the scale by the response's shape, the drums by the delta, the melody's order by the physics
const SCALE_OF_RESPONSE = ["major pentatonic", "dorian", "hirajoshi", "major pentatonic", "minor pentatonic", "lydian", "major",
  "phrygian", "mixolydian", "in-sen", "whole tone", "pelog", "dorian", "harmonic minor", "major", "blues"];
const RHYTHM_OF_DELTA = ["motion", "off", "motion", "breakbeat", "euclidean", "motion", "breakbeat", "euclidean", "four on the floor", "euclidean"];
const ORDER_OF_PHYSICS = ["genome", "up", "pendulum", "genome", "random", "down", "pendulum", "up", "pendulum"];
const clip = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
// The organism's own sound, from its genome: continuous genes give continuous sound
// parameters, so a mutation shifts the sound a little and a new species sounds new.
function organismVoice(g) {
  const palette = PALETTES[(g.kernel * 7 + g.response * 3 + g.delta + g.physics * 5) % PALETTES.length];
  const channels = [0, 1, 2].map(c => {
    const mine = g.genes.filter(e => e.dst === c), genes = mine.length ? mine : g.genes;
    const mean = k => genes.reduce((s, e) => s + e[k], 0) / genes.length;
    const family = FAMILIES[palette[c]], pick = ((mean("mu") + 0.2) * 2.2 + 0.37 * c + 0.13 * g.kernel) % 1;
    return { instrument: family[Math.floor(clip(pick, 0, 0.999) * family.length)],
             octave: Math.round(mean("ring")) - 1 - (palette[c] === "bass" ? 1 : 0),
             cutoff: clip(0.95 - 3 * mean("sigma"), 0.35, 1), resonance: clip(0.5 * Math.abs(mean("w")), 0, 0.6),
             attack: clip(3 * (g.decay ?? 0.05) - 0.05, 0, 0.6), release: clip(0.5 + 5 * (g.speed ?? 0.15), 0.5, 2.2) };
  });
  return { channels, tempo: 2 * Math.round(clip(66 + 150 * (g.speed ?? 0.15), 60, 140) / 2), scale: SCALE_OF_RESPONSE[g.response % SCALE_OF_RESPONSE.length],
           swing: clip(Math.abs(g.phys?.omega ?? 0) * 8, 0, 0.4), rhythm: RHYTHM_OF_DELTA[g.delta % RHYTHM_OF_DELTA.length],
           order: ORDER_OF_PHYSICS[g.physics % ORDER_OF_PHYSICS.length], palette };
}
const RHYTHMS = ["off", "motion", "euclidean", "four on the floor", "breakbeat"];
const ORDERS = ["genome", "up", "down", "pendulum", "random"];
const DELAYS = { "1/8": 2, "dotted 1/8": 3, "1/4": 4, "triplet 1/4": 8 / 3 };      // in sixteenths

const channel = (instrument, pan) => ({ instrument, follow: true, octave: 0, volume: 0.8, pan, cutoff: 0.8, resonance: 0.2, attack: 0, release: 1, send: 0.4, mute: false, solo: false });
const DEFAULTS = {
  volume: 0.6, tempo: 96, swing: 0, key: "auto", scale: "major pentatonic", tuning: "equal", range: 3,
  organism: true,       // the organism chooses instruments, tempo, scale, drums (its genome; it evolves with it)
  harmony: true,        // the colour balance picks a chord per bar; strong beats keep to it
  channels: [channel("pluck", -0.5), channel("FM bell", 0), channel("mallet", 0.5)],
  box: { on: true, axis: "x", steps: 32, notes: 3, show: false },     // show: draw the bar in the world
  melody: { on: true, rate: 2, order: "genome", gate: 1 },
  births: { on: true }, drone: { on: true, level: 0.6 },
  rhythm: { style: "motion", level: 0.8 },
  fx: { delay: "dotted 1/8", feedback: 0.4, reverb: 3.2, wet: 0.45, drive: 0, tone: 1 },
};
const PRESETS = {
  "EvoMaxx: the organism's own sound": {},
  "lava lounge": { organism: false, tempo: 72, scale: "dorian", channels: [{ instrument: "e-piano", release: 1.6 }, { instrument: "pad", volume: 0.6 }, { instrument: "glass", octave: 1 }],
                   melody: { rate: 4 }, rhythm: { style: "motion", level: 0.5 }, fx: { reverb: 5, wet: 0.6, feedback: 0.5 } },
  "music box": { organism: false, tempo: 108, scale: "major", channels: [{ instrument: "kalimba" }, { instrument: "glass" }, { instrument: "mallet", octave: 1 }],
                 melody: { on: false }, drone: { on: false }, rhythm: { style: "off" }, box: { notes: 4 }, fx: { reverb: 2.4, wet: 0.35 } },
  "gamelan": { organism: false, tempo: 84, scale: "pelog", tuning: "just", channels: [{ instrument: "steel drum" }, { instrument: "FM bell" }, { instrument: "kalimba", octave: -1 }],
               rhythm: { style: "euclidean", level: 0.6 }, fx: { delay: "1/4", feedback: 0.3 } },
  "acid lab": { organism: false, tempo: 128, scale: "phrygian", channels: [{ instrument: "acid", octave: -1, resonance: 0.8 }, { instrument: "bass", octave: -1 }, { instrument: "pluck", octave: 1 }],
                rhythm: { style: "four on the floor", level: 1 }, melody: { rate: 1 }, drone: { on: false }, fx: { drive: 0.5, wet: 0.25, delay: "dotted 1/8" } },
  "organism choir": { organism: false, tempo: 60, scale: "major", tuning: "just", channels: [{ instrument: "choir" }, { instrument: "choir", octave: 1 }, { instrument: "organ", octave: -1, volume: 0.5 }],
                      melody: { rate: 4, gate: 2 }, rhythm: { style: "off" }, box: { notes: 2 }, fx: { reverb: 7, wet: 0.7 } },
  "broken beat": { organism: false, tempo: 104, scale: "blues", channels: [{ instrument: "bass", octave: -1 }, { instrument: "e-piano" }, { instrument: "pluck", octave: 1 }],
                   rhythm: { style: "breakbeat", level: 0.9 }, swing: 0.3, fx: { drive: 0.25 } },
  "colour field": { organism: false, tempo: 66, scale: "lydian", channels: [{ instrument: "colour" }, { instrument: "colour", octave: 1 }, { instrument: "vibraphone" }],
                    melody: { rate: 4, gate: 1.5 }, rhythm: { style: "off" }, fx: { reverb: 6, wet: 0.6, feedback: 0.45 } },
  "chip garden": { organism: false, tempo: 132, scale: "major", channels: [{ instrument: "chip" }, { instrument: "chip", octave: 1 }, { instrument: "sub bass", octave: -1 }],
                   rhythm: { style: "euclidean", level: 0.8 }, melody: { rate: 1 }, fx: { reverb: 1.2, wet: 0.2 } },
  "temple": { organism: false, tempo: 58, scale: "in-sen", tuning: "just", channels: [{ instrument: "gong", octave: -1 }, { instrument: "koto" }, { instrument: "flute", octave: 1 }],
              rhythm: { style: "off" }, melody: { rate: 4 }, fx: { reverb: 8, wet: 0.65 } },
};
// a preset is a partial settings object over the defaults (channels by index)
function presetSettings(name) {
  const p = PRESETS[name] || {}, s = structuredClone(DEFAULTS);
  for (const [k, v] of Object.entries(p)) {
    if (k === "channels") v.forEach((c, i) => Object.assign(s.channels[i], c));
    else if (typeof v === "object") Object.assign(s[k], v);
    else s[k] = v;
  }
  return s;
}

// Euclidean rhythm: k pulses spread as evenly as possible over n steps (Bjorklund / Toussaint)
const euclid = (k, n, step) => k > 0 && ((step % n) * k) % n < k;

function create(initial = DEFAULTS) {
  let U = structuredClone(initial), S = structuredClone(U), voice = null;
  // what plays: the user's settings, with the organism's choices where it chooses
  function effective() {
    S = structuredClone(U);
    if (!U.organism || !voice) return;
    Object.assign(S, { tempo: voice.tempo, scale: voice.scale, swing: voice.swing });
    S.rhythm.style = U.rhythm.style === "off" ? "off" : voice.rhythm; S.melody.order = voice.order;
    S.channels.forEach((c, i) => { if (c.follow !== false) Object.assign(c, voice.channels[i]); });
  }
  const ctx = new AudioContext();
  const master = ctx.createGain(), tone = ctx.createBiquadFilter(), drive = ctx.createWaveShaper(), comp = ctx.createDynamicsCompressor();
  const tape = ctx.createMediaStreamDestination(), bus = ctx.createGain();
  tone.type = "lowpass"; comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
  bus.connect(drive); drive.connect(tone); tone.connect(comp); comp.connect(master); master.connect(ctx.destination); master.connect(tape);

  // effects: reverb and a ping-pong delay on the send bus
  const reverb = ctx.createConvolver(), reverbOut = ctx.createGain();
  reverb.connect(reverbOut); reverbOut.connect(bus);
  const send = ctx.createGain(), delayIn = ctx.createGain(), delayTone = ctx.createBiquadFilter(), left = ctx.createDelay(4), right = ctx.createDelay(4),
        feedback = ctx.createGain(), merger = ctx.createChannelMerger(2), delayOut = ctx.createGain();
  delayTone.type = "lowpass"; delayTone.frequency.value = 3200; delayOut.gain.value = 0.55;
  send.connect(delayIn); send.connect(reverb);
  delayIn.connect(delayTone); delayTone.connect(left); left.connect(right); right.connect(feedback); feedback.connect(left);
  left.connect(merger, 0, 0); right.connect(merger, 0, 1); merger.connect(delayOut); delayOut.connect(bus); delayOut.connect(reverb);
  function impulse(seconds) {
    const len = Math.max(1, Math.floor(seconds * ctx.sampleRate)), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.5); }
    return ir;
  }

  // ---- channel strips: input -> filter -> level -> pan -> bus (+ send), with a meter
  const strips = [0, 1, 2].map(() => {
    const input = ctx.createGain(), filter = ctx.createBiquadFilter(), level = ctx.createGain(), pan = ctx.createStereoPanner(),
          sendGain = ctx.createGain(), meter = ctx.createAnalyser();
    filter.type = "lowpass"; meter.fftSize = 256;
    input.connect(filter); filter.connect(level); level.connect(pan); pan.connect(bus); pan.connect(sendGain); sendGain.connect(send); level.connect(meter);
    return { input, filter, level, pan, sendGain, meter, data: new Uint8Array(meter.fftSize) };
  });
  const drums = ctx.createGain(), drumSend = ctx.createGain(); drumSend.gain.value = 0.12;
  drums.connect(bus); drums.connect(drumSend); drumSend.connect(send);

  const noise = ctx.createBuffer(1, 2 * ctx.sampleRate, ctx.sampleRate);
  { const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }

  // apply the settings to the audio graph (cheap; called after every change)
  let reverbSeconds = 0;
  function apply() {
    effective();
    const t = ctx.currentTime, soloing = S.channels.some(c => c.solo);
    master.gain.setTargetAtTime(S.volume, t, 0.05);
    tone.frequency.setTargetAtTime(400 * Math.pow(2, 5.6 * S.fx.tone), t, 0.05);
    const k = 1 + 30 * S.fx.drive, curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(k * x) / Math.tanh(k); }
    drive.curve = S.fx.drive > 0 ? curve : null;
    feedback.gain.setTargetAtTime(S.fx.feedback, t, 0.05);
    reverbOut.gain.setTargetAtTime(S.fx.wet, t, 0.05);
    if (Math.abs(reverbSeconds - S.fx.reverb) > 0.05) { reverbSeconds = S.fx.reverb; reverb.buffer = impulse(reverbSeconds); }
    S.channels.forEach((c, i) => {
      const s = strips[i], audible = !c.mute && (!soloing || c.solo);
      s.filter.frequency.setTargetAtTime(80 * Math.pow(2, 8 * c.cutoff), t, 0.05);
      s.filter.Q.setTargetAtTime(0.5 + 18 * c.resonance * c.resonance, t, 0.05);
      s.level.gain.setTargetAtTime(audible ? c.volume : 0, t, 0.05);
      s.pan.pan.setTargetAtTime(c.pan, t, 0.05);
      s.sendGain.gain.setTargetAtTime(c.send, t, 0.05);
    });
    drums.gain.setTargetAtTime(S.rhythm.style === "off" ? 0 : S.rhythm.level, t, 0.05);
  }

  // ---- instruments: (time, frequency, velocity, strip, channel settings, length scale)
  const osc = (type, f, t, stop) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(t); o.stop(stop); return o; };
  function env(t, peak, attack, decay, dest) {
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(1e-4, t + attack + decay); g.connect(dest); return g;
  }
  const fm = (t, f, ratio, depth, decay, carrier, stop) => {      // a modulator on a carrier's frequency
    const m = osc("sine", f * ratio, t, stop), index = ctx.createGain();
    index.gain.setValueAtTime(f * depth, t); index.gain.exponentialRampToValueAtTime(Math.max(f * depth * 0.02, 1e-3), t + decay);
    m.connect(index); index.connect(carrier.frequency);
  };
  const INSTRUMENTS = {
    "pluck"(t, f, v, dest, a, d) {
      const g = env(t, 0.22 * v, 0.004 + a, 0.45 * d, dest), flt = ctx.createBiquadFilter(), stop = t + a + 0.5 * d + 0.1;
      flt.type = "lowpass"; flt.Q.value = 6; flt.frequency.setValueAtTime(500 + 5500 * v, t); flt.frequency.exponentialRampToValueAtTime(260, t + 0.3);
      osc("sawtooth", f, t, stop).connect(flt); osc("square", f * 1.004, t, stop).connect(flt); flt.connect(g);
    },
    "FM bell"(t, f, v, dest, a, d) {
      const decay = 1.8 * d, c = osc("sine", f, t, t + a + decay + 0.1);
      fm(t, f, 3.5, 2.2 * v, decay, c, t + a + decay + 0.1); c.connect(env(t, 0.15 * v, 0.003 + a, decay, dest));
    },
    "mallet"(t, f, v, dest, a, d) {
      const decay = 0.7 * d;
      osc("sine", f, t, t + a + decay + 0.1).connect(env(t, 0.2 * v, 0.002 + a, decay, dest));
      osc("sine", 3.99 * f, t, t + a + decay).connect(env(t, 0.05 * v, 0.001 + a, decay * 0.25, dest));
    },
    "kalimba"(t, f, v, dest, a, d) {
      const decay = 0.9 * d, o = osc("sine", f, t, t + a + decay + 0.1);
      o.frequency.setValueAtTime(f * 1.02, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.03);
      o.connect(env(t, 0.22 * v, 0.001 + a, decay, dest));
      osc("sine", 5.4 * f, t, t + 0.2).connect(env(t, 0.06 * v, 0.001, 0.08, dest));
    },
    "e-piano"(t, f, v, dest, a, d) {
      const decay = 1.4 * d, c = osc("sine", f, t, t + a + decay + 0.1);
      fm(t, f, 1, 1.4 * v, 0.6, c, t + a + decay + 0.1); c.connect(env(t, 0.18 * v, 0.003 + a, decay, dest));
      osc("sine", 14 * f, t, t + 0.06).connect(env(t, 0.015 * v, 0.001, 0.04, dest));      // the tine's click
    },
    "pad"(t, f, v, dest, a, d) {
      const attack = 0.35 + a, decay = 1.6 * d, stop = t + attack + decay + 0.1, flt = ctx.createBiquadFilter();
      flt.type = "lowpass"; flt.frequency.value = 900 + 1800 * v; const g = env(t, 0.1 * v, attack, decay, dest); flt.connect(g);
      for (const detune of [-12, -4, 5, 11]) { const o = osc("sawtooth", f, t, stop); o.detune.value = detune; o.connect(flt); }
    },
    "organ"(t, f, v, dest, a, d) {
      const decay = 0.9 * d, stop = t + a + decay + 0.1;
      [[1, 0.5], [2, 0.3], [3, 0.2], [4, 0.12], [8, 0.05]].forEach(([h, l]) => osc("sine", f * h, t, stop).connect(env(t, 0.12 * v * l, 0.01 + a, decay, dest)));
    },
    "bass"(t, f, v, dest, a, d) {
      const decay = 0.5 * d, stop = t + a + decay + 0.1, flt = ctx.createBiquadFilter();
      flt.type = "lowpass"; flt.frequency.value = 600 + 900 * v; const g = env(t, 0.3 * v, 0.004 + a, decay, dest); flt.connect(g);
      osc("sine", f, t, stop).connect(g); osc("square", f, t, stop).connect(flt);
    },
    "acid"(t, f, v, dest, a, d) {        // a resonant filter swept down: the 303 gesture
      const decay = 0.35 * d, stop = t + a + decay + 0.1, flt = ctx.createBiquadFilter();
      flt.type = "lowpass"; flt.Q.value = 14; flt.frequency.setValueAtTime(300 + 3500 * v, t); flt.frequency.exponentialRampToValueAtTime(180, t + decay);
      osc("sawtooth", f, t, stop).connect(flt); flt.connect(env(t, 0.2 * v, 0.003 + a, decay, dest));
    },
    "choir"(t, f, v, dest, a, d) {       // a sawtooth through the formants of "ah"
      const attack = 0.12 + a, decay = 1.2 * d, stop = t + attack + decay + 0.1, g = env(t, 0.16 * v, attack, decay, dest);
      const src = [osc("sawtooth", f, t, stop), osc("sawtooth", f * 1.006, t, stop)];
      [[700, 1], [1220, 0.5], [2600, 0.25]].forEach(([formant, l]) => {
        const bp = ctx.createBiquadFilter(), lv = ctx.createGain(); bp.type = "bandpass"; bp.frequency.value = formant; bp.Q.value = 9; lv.gain.value = l * 3;
        src.forEach(o => o.connect(bp)); bp.connect(lv); lv.connect(g);
      });
    },
    "steel drum"(t, f, v, dest, a, d) {
      const decay = 1.1 * d, c = osc("sine", f, t, t + a + decay + 0.1);
      fm(t, f, 1.5, 1.6 * v, 0.25, c, t + a + decay + 0.1); c.connect(env(t, 0.17 * v, 0.002 + a, decay, dest));
      osc("sine", 2 * f, t, t + a + decay * 0.5).connect(env(t, 0.06 * v, 0.002 + a, decay * 0.4, dest));
    },
    "glass"(t, f, v, dest, a, d) {       // inharmonic partials, long and clear
      const decay = 2.4 * d;
      [[1, 1], [2.32, 0.4], [4.25, 0.2], [6.63, 0.1]].forEach(([r, l]) => osc("sine", f * r, t, t + a + decay + 0.1).connect(env(t, 0.09 * v * l, 0.003 + a, decay / Math.sqrt(r), dest)));
    },
    "celesta"(t, f, v, dest, a, d) {
      const decay = 1.3 * d, c = osc("sine", f, t, t + a + decay + 0.1);
      fm(t, f, 4, 0.9 * v, 0.2, c, t + a + decay + 0.1); c.connect(env(t, 0.15 * v, 0.002 + a, decay, dest));
    },
    "glockenspiel"(t, f, v, dest, a, d) {
      const decay = 1.4 * d;
      osc("sine", 2 * f, t, t + a + decay + 0.1).connect(env(t, 0.13 * v, 0.001 + a, decay, dest));
      osc("sine", 5.4 * f, t, t + a + decay).connect(env(t, 0.04 * v, 0.001 + a, decay * 0.4, dest));
    },
    "gong"(t, f, v, dest, a, d) {        // inharmonic modes that swell and ring for long
      const decay = 4 * d;
      [[1, 1], [1.48, 0.6], [2.1, 0.45], [2.76, 0.3], [3.9, 0.18]].forEach(([r, l]) => {
        const o = osc("sine", 0.5 * f * r, t, t + a + decay + 0.2); o.frequency.setValueAtTime(0.5 * f * r * 0.99, t); o.frequency.linearRampToValueAtTime(0.5 * f * r, t + 0.4);
        o.connect(env(t, 0.1 * v * l, 0.02 + a, decay / (0.6 + 0.4 * r), dest));
      });
    },
    "harpsichord"(t, f, v, dest, a, d) {
      const decay = 0.9 * d, stop = t + a + decay + 0.1, hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 350;
      osc("square", f, t, stop).connect(hp); osc("sawtooth", 2 * f, t, stop).connect(hp); hp.connect(env(t, 0.1 * v, 0.001 + a, decay, dest));
    },
    "vibraphone"(t, f, v, dest, a, d) {
      const decay = 2.6 * d, stop = t + a + decay + 0.1, trem = ctx.createGain(), lfo = osc("sine", 5.5, t, stop), depth = ctx.createGain();
      depth.gain.value = 0.35; lfo.connect(depth); depth.connect(trem.gain); trem.connect(dest);
      osc("sine", f, t, stop).connect(env(t, 0.17 * v, 0.002 + a, decay, trem)); osc("sine", 4 * f, t, t + 0.4).connect(env(t, 0.04 * v, 0.001, 0.25, trem));
    },
    "harp"(t, f, v, dest, a, d) {
      const decay = 1.7 * d, stop = t + a + decay + 0.1, flt = ctx.createBiquadFilter(); flt.type = "lowpass"; flt.frequency.value = 1800 + 3000 * v;
      osc("triangle", f, t, stop).connect(flt); osc("sine", 2 * f, t, stop).connect(env(t, 0.05 * v, 0.002 + a, decay * 0.5, dest));
      flt.connect(env(t, 0.22 * v, 0.002 + a, decay, dest));
    },
    "koto"(t, f, v, dest, a, d) {        // a plucked silk string: a bend into the note, then a vibrato
      const decay = 1.2 * d, stop = t + a + decay + 0.1, o = osc("sawtooth", f, t, stop), bp = ctx.createBiquadFilter(), lfo = osc("sine", 5, t, stop), depth = ctx.createGain();
      o.frequency.setValueAtTime(f * 1.03, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
      depth.gain.setValueAtTime(0, t); depth.gain.linearRampToValueAtTime(f * 0.008, t + 0.5); lfo.connect(depth); depth.connect(o.frequency);
      bp.type = "bandpass"; bp.frequency.value = 2 * f; bp.Q.value = 1.4; o.connect(bp); bp.connect(env(t, 0.3 * v, 0.002 + a, decay, dest));
    },
    "flute"(t, f, v, dest, a, d) {
      const attack = 0.06 + a, decay = 0.9 * d, stop = t + attack + decay + 0.1, o = osc("sine", f, t, stop), lfo = osc("sine", 5, t, stop), depth = ctx.createGain();
      depth.gain.setValueAtTime(0, t); depth.gain.linearRampToValueAtTime(f * 0.006, t + 0.35); lfo.connect(depth); depth.connect(o.frequency);
      o.connect(env(t, 0.17 * v, attack, decay, dest)); osc("sine", 2 * f, t, stop).connect(env(t, 0.03 * v, attack, decay, dest));
      const breath = ctx.createBufferSource(), bp = ctx.createBiquadFilter(); breath.buffer = noise; bp.type = "bandpass"; bp.frequency.value = 2 * f; bp.Q.value = 2;
      breath.connect(bp); bp.connect(env(t, 0.04 * v, attack, decay * 0.6, dest)); breath.start(t, Math.random()); breath.stop(stop);
    },
    "ocarina"(t, f, v, dest, a, d) {
      const attack = 0.03 + a, decay = 0.7 * d, stop = t + attack + decay + 0.1;
      osc("sine", f, t, stop).connect(env(t, 0.2 * v, attack, decay, dest)); osc("sine", 3 * f, t, stop).connect(env(t, 0.012 * v, attack, decay, dest));
    },
    "brass"(t, f, v, dest, a, d) {       // the filter opens with the breath
      const attack = 0.04 + a, decay = 0.8 * d, stop = t + attack + decay + 0.1, flt = ctx.createBiquadFilter();
      flt.type = "lowpass"; flt.Q.value = 2; flt.frequency.setValueAtTime(350, t); flt.frequency.linearRampToValueAtTime(1200 + 2600 * v, t + attack + 0.06);
      flt.frequency.exponentialRampToValueAtTime(600, t + attack + decay);
      osc("sawtooth", f, t, stop).connect(flt); osc("sawtooth", f * 1.003, t, stop).connect(flt); flt.connect(env(t, 0.13 * v, attack, decay, dest));
    },
    "strings"(t, f, v, dest, a, d) {
      const attack = 0.25 + a, decay = 1.5 * d, stop = t + attack + decay + 0.1, flt = ctx.createBiquadFilter(), lfo = osc("sine", 5.2, t, stop), depth = ctx.createGain();
      flt.type = "lowpass"; flt.frequency.value = 1600 + 1600 * v; depth.gain.value = f * 0.004; lfo.connect(depth);
      for (const detune of [-9, 0, 8]) { const o = osc("sawtooth", f, t, stop); o.detune.value = detune; depth.connect(o.frequency); o.connect(flt); }
      flt.connect(env(t, 0.07 * v, attack, decay, dest));
    },
    "supersaw"(t, f, v, dest, a, d) {
      const decay = 0.7 * d, stop = t + a + decay + 0.1, flt = ctx.createBiquadFilter(); flt.type = "lowpass"; flt.frequency.value = 2500 + 3500 * v;
      for (const detune of [-24, -15, -7, 0, 7, 15, 24]) { const o = osc("sawtooth", f, t, stop); o.detune.value = detune; o.connect(flt); }
      flt.connect(env(t, 0.045 * v, 0.005 + a, decay, dest));
    },
    "chip"(t, f, v, dest, a, d) {        // an 8-bit square that flicks through its octave
      const decay = 0.3 * d, o = osc("square", f, t, t + a + decay + 0.1);
      [0, 0.03, 0.06].forEach((dt, k) => o.frequency.setValueAtTime(f * [1, 2, 1][k], t + dt));
      o.connect(env(t, 0.08 * v, 0.001 + a, decay, dest));
    },
    "wobble"(t, f, v, dest, a, d) {
      const decay = 0.9 * d, stop = t + a + decay + 0.1, flt = ctx.createBiquadFilter(), lfo = osc("sine", S.tempo / 60 * 2, t, stop), depth = ctx.createGain();
      flt.type = "lowpass"; flt.Q.value = 9; flt.frequency.value = 700; depth.gain.value = 600; lfo.connect(depth); depth.connect(flt.frequency);
      osc("sawtooth", f, t, stop).connect(flt); flt.connect(env(t, 0.18 * v, 0.005 + a, decay, dest));
    },
    "sub bass"(t, f, v, dest, a, d) {
      const decay = 0.7 * d;
      osc("sine", f, t, t + a + decay + 0.1).connect(env(t, 0.38 * v, 0.006 + a, decay, dest));
      osc("triangle", 2 * f, t, t + 0.1).connect(env(t, 0.03 * v, 0.002, 0.06, dest));
    },
    // the timbre is the colour: a harmonic spectrum built from the note's own rgb. Red lifts
    // the low harmonics (warm), green the middle ones, blue the high ones (airy)
    "colour"(t, f, v, dest, a, d, rgb = [0.5, 0.5, 0.5]) {
      const n = 20, real = new Float32Array(n), imag = new Float32Array(n);
      for (let k = 1; k < n; k++)
        imag[k] = (rgb[0] * Math.exp(-(k - 1) / 1.8) + rgb[1] * Math.exp(-((k - 5) ** 2) / 8) + rgb[2] * Math.exp(-((k - 12) ** 2) / 14)) / Math.sqrt(k);
      const o = ctx.createOscillator(), decay = 1.3 * d; o.setPeriodicWave(ctx.createPeriodicWave(real, imag)); o.frequency.value = f;
      o.start(t); o.stop(t + 0.12 + a + decay); o.connect(env(t, 0.15 * v, 0.02 + a, decay, dest));
    },
  };

  // ---- MIDI out (R, G, B on channels 1-3, drums on 10)
  let midi = null, midiOut = null;
  async function midiOutputs() {
    if (!navigator.requestMIDIAccess) throw new Error("this browser has no Web MIDI");
    midi ??= await navigator.requestMIDIAccess();
    return [...midi.outputs.values()].map(o => ({ id: o.id, name: o.name }));
  }
  function setMidiOutput(id) { midiOut = id && midi ? midi.outputs.get(id) : null; }
  function sendMidi(channelIndex, number, velocity, t, length) {
    if (!midiOut) return;
    const at = performance.now() + (t - ctx.currentTime) * 1000, n = Math.max(0, Math.min(127, Math.round(number)));
    midiOut.send([0x90 | channelIndex, n, Math.max(1, Math.round(velocity * 127))], at);
    midiOut.send([0x80 | channelIndex, n, 0], at + length * 1000);
  }

  // ---- notes
  const W = { field: null, health: null, genome: null, threshold: 0.4, blobs: null, panOf: () => 0, counts: [0, 0, 0],
              mean: [0.3, 0.3, 0.3], key: 9, candidate: 9, held: 0, chord: 0 };
  let step = 0, next = ctx.currentTime + 0.1;
  const scans = [], roll = [];             // where the bar was when; the recent notes (for the roll)
  // the key: fixed, or the hue's around the circle of fifths (Scriabin's colour-key circle)
  const keyOf = () => S.key === "auto" ? W.key : KEYS.indexOf(S.key);
  const hueKey = () => W.health ? (Math.round(W.health.hue * 12) * 7) % 12 : W.key;
  // on every bar line: the key (if the hue has moved and held for two bars) and the chord.
  // The chord is the triad on a scale degree chosen by the colour balance: red-led the
  // tonic, green-led the subdominant, blue-led the dominant, a balanced mix the relative minor.
  function barLine() {
    const k = hueKey();
    if (k !== W.key) { W.held = k === W.candidate ? W.held + 1 : 0; W.candidate = k; if (W.held >= 1) W.key = k; }
    const [r, g, b] = W.mean, order = [r, g, b].map((v, i) => [v, i]).sort((x, y) => y[0] - x[0]);
    const n = SCALES[S.scale].length, balanced = order[0][0] - order[1][0] < 0.12 * order[0][0];
    W.chord = balanced ? Math.round(5 / 7 * n) % n : [0, Math.round(3 / 7 * n), Math.round(4 / 7 * n)][order[0][1]];
  }
  // the nearest chord tone (scale degrees chord, chord + 2, chord + 4) to a degree
  function toChord(degree) {
    const n = SCALES[S.scale].length, tones = [W.chord, W.chord + 2, W.chord + 4].map(d => d % n);
    let best = degree, gap = Infinity;
    for (let d = degree - 3; d <= degree + 3; d++) if (tones.includes(((d % n) + n) % n) && Math.abs(d - degree) < gap) { gap = Math.abs(d - degree); best = d; }
    return best;
  }
  const sixteenth = () => 60 / S.tempo / 4;
  // the semitone (above C1 = 32.7 Hz, before the key) of scale degree k above octave o
  function pitch(degree, octave) {
    const scale = SCALES[S.scale], n = scale.length, oct = Math.floor(degree / n);
    return 12 * (octave + oct) + scale[((degree % n) + n) % n];
  }
  function frequency(semitone) {
    const s = semitone + keyOf(), ratios = TUNINGS[S.tuning];
    return 32.703 * Math.pow(2, Math.floor(s / 12)) * ratios[((s % 12) + 12) % 12];
  }
  function playNote(c, degree, octave, velocity, t, length = 1, rgb = null) {
    const ch = S.channels[c], semitone = pitch(degree, octave + ch.octave), f = frequency(semitone);
    if (f < 20 || f > 12000) return;
    const colour = rgb ?? W.mean.map((v, i) => (i === c ? 0.5 + v : 0.4 * v));      // the note's colour (for the colour instrument)
    (INSTRUMENTS[ch.instrument] ?? INSTRUMENTS.pluck)(t, f, velocity, strips[c].input, ch.attack, ch.release * length, colour);
    roll.push({ t, midi: 24 + semitone + keyOf(), c, v: velocity });
    if (roll.length > 400) roll.shift();
    if (!ch.mute) sendMidi(c, 24 + semitone + keyOf(), velocity, t, Math.min(2, 0.4 * ch.release * length));
  }

  // drums
  function kick(t, v) {
    const g = env(t, 0.9 * v, 0.002, 0.32, drums), o = osc("sine", 140, t, t + 0.4);
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14); o.connect(g);
    sendMidi(9, 36, v, t, 0.1);
  }
  function hiss(t, v, type, f, q, decay, pan) {
    const src = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), p = ctx.createStereoPanner();
    src.buffer = noise; flt.type = type; flt.frequency.value = f; flt.Q.value = q; p.pan.value = pan;
    src.connect(flt); flt.connect(p); p.connect(env(t, v, 0.001, decay, drums)); src.start(t, Math.random()); src.stop(t + decay + 0.05);
  }
  function hat(t, v, pan = 0) { hiss(t, 0.12 * v, "highpass", 7500, 0.7, 0.05, pan); sendMidi(9, 42, v, t, 0.05); }
  function snare(t, v) {
    hiss(t, 0.3 * v, "bandpass", 1800, 0.8, 0.16, 0);
    const o = osc("triangle", 190, t, t + 0.12); o.frequency.exponentialRampToValueAtTime(140, t + 0.08); o.connect(env(t, 0.25 * v, 0.001, 0.09, drums));
    sendMidi(9, 38, v, t, 0.1);
  }

  // the drone: one sustained voice per chemical, through its strip
  const drone = [0, 1, 2].map(c => {
    const amp = ctx.createGain(), trem = ctx.createGain(), lfo = ctx.createOscillator(), depth = ctx.createGain(), bright = ctx.createBiquadFilter();
    amp.gain.value = 0; lfo.frequency.value = 0.3; depth.gain.value = 0; bright.type = "lowpass"; bright.frequency.value = 300;
    lfo.connect(depth); depth.connect(trem.gain); lfo.start();
    const oscs = [-7, 7].map(cents => { const o = ctx.createOscillator(); o.type = c === 2 ? "triangle" : "sawtooth"; o.detune.value = cents; o.connect(bright); o.start(); return o; });
    bright.connect(amp); amp.connect(trem); trem.connect(strips[c].input);
    return { oscs, amp, lfo, depth, bright };
  });

  function play(k, t) {
    const F = W.field, h = W.health, g = W.genome;
    if (k % 16 === 0) barLine();
    const strong = S.harmony && k % 4 === 0, fit = d => (strong ? toChord(d) : d);
    if (k % 2 === 1) t += S.swing * 0.5 * sixteenth();        // swing: the off sixteenths come late
    if (S.box.on && F) {                                       // the music box: one line under the bar
      const m = F.m, steps = S.box.steps, col = Math.floor((k % steps) * m / steps), cells = [];
      scans.push([t, (k % steps) / steps]); if (scans.length > 64) scans.shift();
      for (let j = 0; j < m; j++) {
        const i = S.box.axis === "x" ? j * m + col : col * m + j, b = F.values[i];
        if (b > W.threshold) cells.push([b, j, i]);
      }
      cells.sort((a, b) => b[0] - a[0]);
      for (const [b, j, i] of cells.slice(0, S.box.notes)) {
        const rgb = [F.rgb[4 * i], F.rgb[4 * i + 1], F.rgb[4 * i + 2]], c = rgb.indexOf(Math.max(...rgb));
        playNote(c, fit(Math.floor(j / m * S.range * SCALES[S.scale].length)), 3, Math.min(1, Math.max(0.15, 1.6 * (b - W.threshold) / (1 - W.threshold))), t, 1, rgb);
      }
    }
    if (S.melody.on && g && k % S.melody.rate === 0) {         // the genome
      const n = g.genes.length, i = Math.floor(k / S.melody.rate);
      const degreeOf = gene => Math.floor(Math.min(Math.max((gene.mu + 0.2) / 1.0, 0), 1) * 2 * SCALES[S.scale].length);
      let order = g.genes.map((_, j) => j);
      if (S.melody.order === "up" || S.melody.order === "down" || S.melody.order === "pendulum") order.sort((a, b) => degreeOf(g.genes[a]) - degreeOf(g.genes[b]));
      if (S.melody.order === "down") order.reverse();
      const index = S.melody.order === "random" ? Math.floor(Math.random() * n)
                  : S.melody.order === "pendulum" ? order[(i % (2 * n - 2)) < n ? i % (2 * n - 2) : 2 * n - 2 - (i % (2 * n - 2))]
                  : order[i % n];
      const gene = g.genes[index];
      if (Math.abs(gene.w) >= 0.15)
        playNote(gene.dst, fit(degreeOf(gene)), gene.w < 0 ? 1 : 2, Math.min(1, 0.25 + 0.75 * Math.abs(gene.w)), t,
                 S.melody.gate * (0.4 + Math.min(gene.sigma, 0.25) * 8));
    }
    if (S.rhythm.style !== "off" && h && h.status === "alive") {
      const motion = h.motion, activity = Math.min(Math.max((Math.log10(Math.max(h.change, 1e-9)) + 6) / 3, 0), 1), s = k % 16;
      if (S.rhythm.style === "motion") {
        if (k % 8 === 0 && motion > 0.05) kick(t, 0.35 + 0.65 * motion);
        if (k % 8 === 4 && motion > 0.35) snare(t, motion);
        if (k % 2 === 1 && Math.random() < activity) hat(t, 0.5 + 0.5 * Math.random(), Math.random() - 0.5);
      } else if (S.rhythm.style === "euclidean") {          // pulses: bodies of each chemical
        const [r, gr, b] = W.counts;
        if (euclid(Math.min(1 + r, 9), 16, s)) kick(t, 0.6 + 0.4 * motion);
        if (gr && euclid(Math.min(gr, 7), 16, (s + 4) % 16)) snare(t, 0.5 + 0.5 * motion);
        if (euclid(Math.min(2 + 2 * b, 15), 16, (s + 2) % 16)) hat(t, 0.4 + 0.6 * activity, 0.3);
      } else if (S.rhythm.style === "four on the floor") {
        if (s % 4 === 0) kick(t, 0.9);
        if (s === 4 || s === 12) snare(t, 0.4 + 0.6 * motion);
        if (s % 4 === 2) hat(t, 0.7); else if (Math.random() < activity * 0.6) hat(t, 0.3, 0.4);
      } else {                                                 // breakbeat
        if (s === 0 || s === 10 || (s === 7 && motion > 0.3)) kick(t, 0.85);
        if (s === 4 || s === 12 || (s === 15 && activity > 0.5)) snare(t, 0.5 + 0.5 * motion);
        if (s % 2 === 0) hat(t, 0.5 + 0.3 * activity, s % 4 ? 0.3 : -0.3);
      }
    }
  }
  function scheduler() {
    if (ctx.state !== "running") return;
    if (next < ctx.currentTime) next = ctx.currentTime + 0.02;
    while (next < ctx.currentTime + 0.12) { play(step, next); next += sixteenth(); step++; }
    const d = DELAYS[S.fx.delay] * sixteenth();
    left.delayTime.setTargetAtTime(d, ctx.currentTime, 0.2); right.delayTime.setTargetAtTime(d, ctx.currentTime, 0.2);
  }
  const timer = setInterval(scheduler, 25);

  // called a few times a second with the latest field, health and genome
  function update({ field, health, genome, threshold, panOf }) {
    Object.assign(W, { field, health, genome, threshold: threshold ?? W.threshold, panOf: panOf ?? W.panOf });
    // the organism's voice follows its genome (during a morph it glides with it)
    if (genome) {
      const v = organismVoice(genome), changed = JSON.stringify(v) !== JSON.stringify(voice);
      voice = v; if (changed && U.organism) apply();
    }
    if (ctx.state !== "running" || !field) return;
    const t = ctx.currentTime, { rgb, m } = field, motion = health?.motion ?? 0;
    drone.forEach((v, c) => {
      let mean = 0, sq = 0;
      for (let i = 0; i < m * m; i++) { const x = rgb[4 * i + c]; mean += x; sq += x * x; }
      mean /= m * m; const std = Math.sqrt(Math.max(sq / (m * m) - mean * mean, 0));
      W.mean[c] = mean;
      // the drone holds the chord: root, third and fifth, one per chemical
      const degree = S.harmony ? W.chord + [0, 2, 4][c] : [0, 2, 4][c] % SCALES[S.scale].length;
      const f = frequency(pitch(degree, 2 + S.channels[c].octave));
      v.oscs.forEach(o => o.frequency.setTargetAtTime(f, t, 1.5));
      v.amp.gain.setTargetAtTime(S.drone.on ? 0.07 * S.drone.level * Math.sqrt(Math.min(mean, 1)) : 0, t, 0.4);
      v.bright.frequency.setTargetAtTime(150 + 4500 * Math.pow(Math.min(4 * std, 1), 1.5), t, 0.3);
      v.lfo.frequency.setTargetAtTime(0.2 + 7 * motion, t, 0.5);
      v.depth.gain.setTargetAtTime(0.5 * motion, t, 0.5);
    });
    const blobs = EvoMaxx.bodies(field, W.threshold), before = W.blobs;
    W.counts = [0, 1, 2].map(c => blobs.filter(b => b.channel === c).length);
    if (before && S.births.on) {
      const near = (a, list) => list.some(b => Math.hypot(a.wrap(a.x - b.x), a.wrap(a.z - b.z)) < 3 * field.cell);
      blobs.filter(b => !near(b, before)).slice(0, 3).forEach((b, k) =>
        playNote(b.channel, (b.n + 2 * b.channel) % 10, 4, 0.9, next + k * sixteenth(), 1.5));
      before.filter(b => !near(b, blobs)).slice(0, 1).forEach(b => playNote(b.channel, 0, 1, 0.6, next, 1.2));
    }
    W.blobs = blobs;
  }

  // a swell of filtered noise while the world morphs into another organism
  function event(name) {
    if (ctx.state !== "running") return;
    if (name === "morph") {
      const src = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), g = ctx.createGain(), t = next;
      src.buffer = noise; src.loop = true; flt.type = "bandpass"; flt.Q.value = 5;
      flt.frequency.setValueAtTime(180, t); flt.frequency.exponentialRampToValueAtTime(4500, t + 1.4);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.15, t + 0.7); g.gain.linearRampToValueAtTime(0, t + 1.4);
      src.connect(flt); flt.connect(g); g.connect(send); g.connect(bus); src.start(t); src.stop(t + 1.5);
    }
  }

  // where the music box bar is now, as a fraction of the sweep (0-1), or -1
  function scanNow() {
    if (!S.box.on || ctx.state !== "running") return -1;
    const now = ctx.currentTime;
    for (let i = scans.length - 1; i >= 0; i--)
      if (scans[i][0] <= now) return (scans[i][1] + Math.min((now - scans[i][0]) / sixteenth(), 1) / S.box.steps) % 1;
    return -1;
  }
  // levels of the three strips (0-1), for meters
  function levels() {
    return strips.map(s => { s.meter.getByteTimeDomainData(s.data); let m = 0; for (const x of s.data) m = Math.max(m, Math.abs(x - 128)); return m / 128; });
  }

  // a microphone: energies of bass, mids and treble against their running averages
  let mic = null;
  async function startMic() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false } });
    const source = ctx.createMediaStreamSource(stream), analyser = ctx.createAnalyser();
    analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.5; source.connect(analyser);
    mic = { stream, analyser, data: new Uint8Array(analyser.frequencyBinCount), mean: [20, 20, 20] };
  }
  function stopMic() { if (mic) { mic.stream.getTracks().forEach(t => t.stop()); mic = null; } }
  function micBands() {
    if (!mic) return null;
    mic.analyser.getByteFrequencyData(mic.data);
    const hz = ctx.sampleRate / mic.analyser.fftSize, band = (lo, hi) => {
      let s = 0, n = 0; for (let i = Math.floor(lo / hz); i < Math.min(hi / hz, mic.data.length); i++) { s += mic.data[i]; n++; } return n ? s / n : 0; };
    const e = [band(40, 250), band(250, 2000), band(2000, 8000)];
    const surge = e.map((v, c) => { const r = v / Math.max(mic.mean[c], 5); mic.mean[c] += 0.02 * (v - mic.mean[c]); return r; });
    return { energy: e.map(v => v / 255), surge };
  }

  // recording the music alone
  let recorder = null;
  function toggleRecording(done) {
    if (recorder) { recorder.stop(); return false; }
    const chunks = [], type = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"].find(t => MediaRecorder.isTypeSupported(t));
    recorder = new MediaRecorder(tape.stream, { mimeType: type, audioBitsPerSecond: 256000 });
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => { done(new Blob(chunks, { type })); recorder = null; };
    recorder.start(1000);
    return true;
  }

  apply();
  return {
    ctx, tape, apply, update, event, scanNow, levels, roll, startMic, stopMic, micBands, midiOutputs, setMidiOutput, toggleRecording,
    get mic() { return !!mic; }, get recording() { return !!recorder; }, get key() { return KEYS[keyOf()]; },
    load(settings) { U = structuredClone(settings); apply(); },
    get playing() { return S; }, get voice() { return voice; },
    close() { clearInterval(timer); stopMic(); ctx.close(); },
  };
}

return { create, DEFAULTS, PRESETS, presetSettings, organismVoice, FAMILIES, SCALES, TUNINGS, KEYS, INSTRUMENT_NAMES, RHYTHMS, ORDERS, DELAYS: Object.keys(DELAYS) };
})();
