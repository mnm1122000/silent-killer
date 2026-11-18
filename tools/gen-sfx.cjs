// SILENT KILLER — procedural horror SFX generator.
// Run: node tools/gen-sfx.js   (writes WAVs to tools/_wav, then ffmpeg -> assets/sfx/*.mp3)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SR = 44100;
const ROOT = path.join(__dirname, '..');
const WAV = path.join(__dirname, '_wav');
const OUT = path.join(ROOT, 'assets', 'sfx');
fs.mkdirSync(WAV, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

// ---------- deterministic random ----------
let seed = 1337;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const noise = () => rnd() * 2 - 1;

// ---------- buffers ----------
const buf = (sec) => new Float32Array(Math.ceil(sec * SR));
function mix(dst, src, at = 0, gain = 1) {
  const o = Math.floor(at * SR);
  for (let i = 0; i < src.length && o + i < dst.length; i++) dst[o + i] += src[i] * gain;
  return dst;
}
function normalize(b, peak = 0.89) {
  let m = 0;
  for (const v of b) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < b.length; i++) b[i] *= peak / m;
  return b;
}
function fadeEdges(b, inS = 0.005, outS = 0.05) {
  const a = Math.floor(inS * SR), z = Math.floor(outS * SR);
  for (let i = 0; i < a && i < b.length; i++) b[i] *= i / a;
  for (let i = 0; i < z && i < b.length; i++) b[b.length - 1 - i] *= i / z;
  return b;
}

// ---------- envelopes ----------
const env = {
  exp: (t, atk, dec) => (t < atk ? t / atk : Math.exp(-(t - atk) / dec)),
  adsr: (t, a, d, s, r, len) => {
    if (t < a) return t / a;
    if (t < a + d) return 1 - (1 - s) * ((t - a) / d);
    if (t < len - r) return s;
    return Math.max(0, s * (1 - (t - (len - r)) / r));
  },
};

// ---------- filters ----------
function biquad(b, type, freq, q = 0.707) {
  const out = new Float32Array(b.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const fAt = typeof freq === 'function' ? freq : () => freq;
  let lastF = -1, b0, b1, b2, a1, a2;
  for (let i = 0; i < b.length; i++) {
    const f = Math.min(SR * 0.45, Math.max(10, fAt(i / SR)));
    if (Math.abs(f - lastF) > 0.5) {
      lastF = f;
      const w = 2 * Math.PI * f / SR, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
      let n0, n1, n2;
      if (type === 'lp') { n0 = (1 - cs) / 2; n1 = 1 - cs; n2 = (1 - cs) / 2; }
      else if (type === 'hp') { n0 = (1 + cs) / 2; n1 = -(1 + cs); n2 = (1 + cs) / 2; }
      else { n0 = al; n1 = 0; n2 = -al; } // bandpass
      const a0 = 1 + al;
      b0 = n0 / a0; b1 = n1 / a0; b2 = n2 / a0; a1 = (-2 * cs) / a0; a2 = (1 - al) / a0;
    }
    const x = b[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}
function drive(b, amt = 3) {
  for (let i = 0; i < b.length; i++) b[i] = Math.tanh(b[i] * amt) / Math.tanh(amt);
  return b;
}
// Schroeder-style reverb
function reverb(b, wet = 0.35, size = 1, tail = 2.5) {
  const out = new Float32Array(b.length + Math.floor(tail * SR));
  out.set(b);
  const combs = [1557, 1617, 1491, 1422, 1277, 1356].map((d) => Math.floor(d * size));
  const fb = 0.84;
  const wetBuf = new Float32Array(out.length);
  for (const d of combs) {
    const line = new Float32Array(d); let idx = 0, lp = 0;
    for (let i = 0; i < out.length; i++) {
      const y = line[idx];
      lp = y * 0.7 + lp * 0.3;
      line[idx] = (i < b.length ? b[i] : 0) + lp * fb;
      idx = (idx + 1) % d;
      wetBuf[i] += y / combs.length;
    }
  }
  for (const d of [225, 556, 441, 341]) {
    const line = new Float32Array(d); let idx = 0;
    for (let i = 0; i < out.length; i++) {
      const bufOut = line[idx];
      const x = wetBuf[i];
      line[idx] = x + bufOut * 0.5;
      wetBuf[i] = bufOut - x * 0.5;
      idx = (idx + 1) % d;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = out[i] * (1 - wet) + wetBuf[i] * wet * 2.2;
  return out;
}

// ---------- oscillators ----------
function osc(sec, freqFn, shape = 'sine', ampFn = () => 1) {
  const b = buf(sec);
  let ph = 0;
  const fF = typeof freqFn === 'function' ? freqFn : () => freqFn;
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    ph += fF(t) / SR;
    const p = ph % 1;
    let v;
    switch (shape) {
      case 'saw': v = 2 * p - 1; break;
      case 'square': v = p < 0.5 ? 1 : -1; break;
      case 'tri': v = 1 - 4 * Math.abs(p - 0.5); break;
      default: v = Math.sin(2 * Math.PI * ph);
    }
    b[i] = v * ampFn(t);
  }
  return b;
}
function noiseBuf(sec, ampFn = () => 1) {
  const b = buf(sec);
  for (let i = 0; i < b.length; i++) b[i] = noise() * ampFn(i / SR);
  return b;
}
// bell / music-box tone with inharmonic partials
function bell(sec, f, partials = [[1, 1, 1], [2.0, 0.5, 0.6], [2.76, 0.35, 0.4], [5.4, 0.2, 0.25], [8.9, 0.1, 0.15]], decay = 1.5) {
  const b = buf(sec);
  for (const [ratio, amp, dScale] of partials) {
    const fr = f * ratio;
    for (let i = 0; i < b.length; i++) {
      const t = i / SR;
      b[i] += Math.sin(2 * Math.PI * fr * t) * amp * env.exp(t, 0.002, decay * dScale);
    }
  }
  return b;
}
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

// ---------- sound designs ----------
const S = {};

S.click = () => {
  const b = noiseBuf(0.06, (t) => env.exp(t, 0.0005, 0.008));
  return mix(biquad(b, 'bp', 2400, 3), osc(0.06, 900, 'sine', (t) => env.exp(t, 0.001, 0.01)), 0, 0.5);
};

S.tick = () => {
  const b = buf(0.25);
  mix(b, biquad(noiseBuf(0.05, (t) => env.exp(t, 0.0003, 0.006)), 'bp', 3500, 4));
  mix(b, osc(0.2, 1800, 'sine', (t) => env.exp(t, 0.001, 0.03)), 0, 0.3);
  return reverb(b, 0.25, 0.6, 0.4);
};

S.tick_urgent = () => {
  const b = buf(0.35);
  mix(b, osc(0.3, 55, 'sine', (t) => env.exp(t, 0.002, 0.08)), 0, 1);
  mix(b, biquad(noiseBuf(0.06, (t) => env.exp(t, 0.0003, 0.01)), 'bp', 2500, 3), 0, 0.8);
  mix(b, osc(0.3, 1320, 'tri', (t) => env.exp(t, 0.001, 0.05)), 0, 0.25);
  return drive(reverb(b, 0.2, 0.5, 0.3), 1.5);
};

S.heartbeat = () => {
  // one cycle, 0.9 s, loopable (lub-dub)
  const len = 0.9, b = buf(len);
  const thump = (at, f, g) => mix(b, osc(0.3, (t) => f * (1 + 1.5 * Math.exp(-t / 0.02)), 'sine', (t) => env.exp(t, 0.004, 0.07)), at, g);
  thump(0.0, 48, 1); thump(0.22, 42, 0.7);
  return biquad(drive(b, 2), 'lp', 300);
};

S.thunder = () => {
  const len = 5, b = buf(len);
  const crack = biquad(noiseBuf(0.6, (t) => env.exp(t, 0.003, 0.12)), 'hp', 900);
  mix(b, crack, 0.0, 0.5);
  const rumble = noiseBuf(len, (t) => env.exp(t, 0.08, 1.4) * (0.6 + 0.4 * Math.sin(t * 9 + Math.sin(t * 3) * 2)));
  mix(b, biquad(biquad(rumble, 'lp', (t) => 400 * Math.exp(-t * 0.6) + 60), 'lp', 300), 0.03, 2.2);
  return reverb(drive(b, 1.6), 0.3, 1.3, 2);
};

S.sting_action = () => {
  // horror hit: boom + dissonant string cluster screech
  const len = 4.5, b = buf(len);
  mix(b, osc(3, (t) => 38 + 30 * Math.exp(-t / 0.08), 'sine', (t) => env.exp(t, 0.003, 0.9)), 0, 1.4);
  mix(b, biquad(noiseBuf(1.5, (t) => env.exp(t, 0.002, 0.25)), 'lp', 1200), 0, 0.8);
  const cluster = [76, 77, 79, 80, 82, 83];
  for (const n of cluster) {
    const f0 = midi(n) * (1 + (rnd() - 0.5) * 0.01);
    const s = osc(3.5, (t) => f0 * (1 + 0.012 * Math.sin(2 * Math.PI * (5.5 + rnd()) * t)) * (1 - 0.03 * t), 'saw',
      (t) => env.adsr(t, 0.015, 0.4, 0.45, 1.6, 3.5) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 11 * t)));
    mix(b, biquad(s, 'bp', 2600, 0.9), 0.02, 0.18);
  }
  return reverb(drive(b, 1.8), 0.4, 1.2, 2.5);
};

S.wink = () => {
  // glassy sinister shimmer for locking a target
  const len = 1.4, b = buf(len);
  for (const [n, d] of [[96, 0], [99, 0.05], [103, 0.1]]) mix(b, bell(1.2, midi(n), undefined, 0.5), d, 0.3);
  mix(b, biquad(noiseBuf(0.5, (t) => env.adsr(t, 0.2, 0.1, 0.3, 0.2, 0.5)), 'hp', (t) => 3000 + 8000 * t), 0, 0.15);
  return reverb(b, 0.5, 0.8, 1.5);
};

S.role_reveal = () => {
  const len = 3.2, b = buf(len);
  // reverse-whoosh into boom
  const sw = noiseBuf(1.6, (t) => Math.pow(t / 1.6, 3));
  mix(b, biquad(sw, 'bp', (t) => 300 + 3000 * (t / 1.6), 1.2), 0, 0.9);
  mix(b, osc(1.6, (t) => 45 + 40 * Math.exp(-t / 0.05), 'sine', (t) => env.exp(t, 0.002, 0.6)), 1.6, 1.4);
  mix(b, osc(1.6, midi(37), 'saw', (t) => env.exp(t, 0.01, 0.5)), 1.6, 0.15);
  mix(b, osc(1.6, midi(43), 'saw', (t) => env.exp(t, 0.01, 0.5)), 1.6, 0.12);
  return reverb(biquad(drive(b, 1.5), 'lp', 5000), 0.35, 1.2, 2);
};

S.report = () => {
  // eerie whisper-wind rising
  const len = 3, b = buf(len);
  for (let k = 0; k < 3; k++) {
    const f = 700 + k * 650;
    mix(b, biquad(noiseBuf(len, (t) => env.adsr(t, 1.2, 0.5, 0.6, 1.0, len) * (0.5 + 0.5 * Math.sin(t * (7 + k * 3)))), 'bp', (t) => f + 600 * Math.sin(t * 1.3 + k), 8), 0, 0.6);
  }
  mix(b, osc(len, (t) => midi(62) * (1 + 0.003 * Math.sin(t * 30)), 'sine', (t) => env.adsr(t, 1.5, 0.2, 0.7, 1, len)), 0, 0.12);
  mix(b, osc(len, (t) => midi(63) * (1 + 0.003 * Math.sin(t * 27)), 'sine', (t) => env.adsr(t, 1.5, 0.2, 0.7, 1, len)), 0, 0.1);
  return reverb(b, 0.5, 1.1, 2);
};

S.submit = () => {
  const len = 1.4, b = buf(len);
  mix(b, osc(0.5, (t) => 90 * Math.exp(-t * 3), 'sine', (t) => env.exp(t, 0.002, 0.12)), 0, 1);
  mix(b, bell(1.2, midi(81), undefined, 0.4), 0.03, 0.25);
  return reverb(b, 0.4, 0.9, 1.2);
};

S.scan = () => {
  // validation: tension riser with pulses
  const len = 4.5, b = buf(len);
  mix(b, osc(len, (t) => 60 + 40 * (t / len), 'saw', (t) => env.adsr(t, 0.5, 0.5, 0.8, 0.3, len)), 0, 0.25);
  mix(b, osc(len, (t) => 61.5 + 40 * (t / len), 'saw', (t) => env.adsr(t, 0.5, 0.5, 0.8, 0.3, len)), 0, 0.25);
  for (let t0 = 0, i = 0; t0 < len - 0.2; i++) {
    mix(b, osc(0.2, 1200 + i * 60, 'sine', (t) => env.exp(t, 0.002, 0.04)), t0, 0.25);
    t0 += Math.max(0.09, 0.5 - i * 0.03);
  }
  const riser = noiseBuf(len, (t) => Math.pow(t / len, 2));
  mix(b, biquad(riser, 'bp', (t) => 400 + 5000 * Math.pow(t / len, 2), 2), 0, 0.5);
  return reverb(biquad(b, 'lp', 7000), 0.3, 1, 1);
};

S.death = () => {
  // shrieking violin stab + boom + falling body
  const len = 5, b = buf(len);
  mix(b, osc(3, (t) => 34 + 50 * Math.exp(-t / 0.06), 'sine', (t) => env.exp(t, 0.002, 1.1)), 0, 1.6);
  mix(b, biquad(noiseBuf(1, (t) => env.exp(t, 0.001, 0.15)), 'lp', 2500), 0, 0.9);
  for (const n of [84, 85, 88, 89, 91]) {
    const f0 = midi(n);
    const s = osc(2.5, (t) => f0 * (1 + 0.02 * Math.sin(2 * Math.PI * 6.3 * t)) * (1 - 0.08 * t), 'saw',
      (t) => env.adsr(t, 0.006, 0.25, 0.5, 1.2, 2.5));
    mix(b, biquad(s, 'bp', 3200, 0.8), 0, 0.16);
  }
  // scream-ish formant glide
  const scr = osc(1.8, (t) => 620 + 220 * Math.sin(t * 2.2) - 180 * t, 'saw', (t) => env.adsr(t, 0.05, 0.3, 0.6, 0.9, 1.8) * (1 + 0.3 * noise()));
  let f = buf(1.8);
  for (const [fc, g] of [[800, 1], [1150, 0.7], [2900, 0.4]]) mix(f, biquad(scr, 'bp', fc, 6), 0, g);
  mix(b, f, 0.08, 0.45);
  // thud
  mix(b, osc(0.5, (t) => 70 * Math.exp(-t * 4), 'sine', (t) => env.exp(t, 0.002, 0.1)), 2.6, 0.8);
  mix(b, biquad(noiseBuf(0.3, (t) => env.exp(t, 0.001, 0.05)), 'lp', 600), 2.6, 0.6);
  return reverb(drive(b, 2), 0.38, 1.3, 2.5);
};

S.no_death = () => {
  // uneasy calm: low exhale + distant bell
  const len = 4, b = buf(len);
  mix(b, biquad(noiseBuf(len, (t) => env.adsr(t, 1, 1, 0.4, 1.5, len)), 'lp', (t) => 800 - 150 * t), 0, 0.6);
  mix(b, bell(3.5, midi(45), undefined, 2), 0.5, 0.5);
  mix(b, bell(3, midi(52), undefined, 1.6), 1.4, 0.25);
  return reverb(b, 0.5, 1.4, 2.5);
};

function musicBoxSeq(notes, step, tail = 2) {
  const len = notes.length * step + tail, b = buf(len);
  notes.forEach((n, i) => {
    if (n == null) return;
    const detune = 1 + (rnd() - 0.5) * 0.012; // warped, old music box
    mix(b, bell(2.2, midi(n) * detune, [[1, 1, 1], [3.01, 0.25, 0.3], [5.98, 0.08, 0.15]], 0.9), i * step, 0.4);
  });
  return b;
}

S.discussion = () => {
  // creepy music-box phrase
  const b = musicBoxSeq([76, 79, 78, 74, 76, null, 71, 72, 75], 0.32, 2.4);
  return reverb(b, 0.45, 1.2, 2);
};

S.warning = () => {
  const len = 1.2, b = buf(len);
  for (const [at, f] of [[0, 110], [0.35, 104]]) {
    mix(b, osc(0.3, f, 'square', (t) => env.adsr(t, 0.005, 0.05, 0.8, 0.08, 0.3)), at, 0.4);
    mix(b, osc(0.3, f * 1.5 + 3, 'saw', (t) => env.adsr(t, 0.005, 0.05, 0.8, 0.08, 0.3)), at, 0.25);
  }
  return reverb(biquad(drive(b, 3), 'lp', 2500), 0.2, 0.7, 0.6);
};

S.accuse = () => {
  // tension drum roll + slam
  const len = 5, b = buf(len);
  for (let t0 = 0, i = 0; t0 < 2.6; i++) {
    const g = 0.25 + 0.75 * (t0 / 2.6);
    mix(b, biquad(noiseBuf(0.12, (t) => env.exp(t, 0.001, 0.03)), 'bp', 1800, 1.2), t0, g * 0.6);
    mix(b, osc(0.12, 180, 'sine', (t) => env.exp(t, 0.001, 0.03)), t0, g * 0.4);
    t0 += Math.max(0.045, 0.16 - i * 0.004);
  }
  mix(b, osc(2.4, (t) => 40 + 50 * Math.exp(-t / 0.05), 'sine', (t) => env.exp(t, 0.002, 0.8)), 2.65, 1.6);
  mix(b, biquad(noiseBuf(1.5, (t) => env.exp(t, 0.001, 0.35)), 'lp', 3000), 2.65, 0.8);
  for (const n of [50, 56, 62]) mix(b, osc(2.3, midi(n), 'saw', (t) => env.exp(t, 0.01, 0.8)), 2.65, 0.12);
  return reverb(drive(b, 1.6), 0.35, 1.2, 2);
};

S.curse = () => {
  // reversed cymbal into thunder + demonic low voice
  const len = 6, b = buf(len);
  const rev = biquad(noiseBuf(1.8, (t) => Math.pow(t / 1.8, 4)), 'hp', 3000);
  mix(b, rev, 0, 0.6);
  mix(b, S.thunder(), 1.8, 0.7);
  const v = osc(3, (t) => 55 - 8 * t, 'saw', (t) => env.adsr(t, 0.1, 0.4, 0.7, 1.4, 3));
  let f = buf(3);
  for (const [fc, g] of [[300, 1], [700, 0.6], [2200, 0.2]]) mix(f, biquad(v, 'bp', fc, 5), 0, g);
  mix(b, drive(f, 3), 1.8, 0.5);
  return reverb(b, 0.3, 1.3, 1.5);
};

S.win_innocent = () => {
  // dawn breaks: rising choir pad + bells
  const len = 7, b = buf(len);
  for (const n of [57, 64, 69, 73, 76]) {
    for (const d of [-0.004, 0.004]) {
      mix(b, osc(len, (t) => midi(n) * (1 + d) * (1 + 0.004 * Math.sin(t * 5)), 'saw', (t) => env.adsr(t, 2, 1, 0.7, 2.5, len)), 0, 0.06);
    }
  }
  let pad = biquad(b, 'lp', (t) => 600 + 2200 * Math.min(1, t / 3));
  [81, 85, 88, 93].forEach((n, i) => mix(pad, bell(3, midi(n), undefined, 1.5), 1.5 + i * 0.4, 0.25));
  return reverb(pad, 0.55, 1.4, 3);
};

S.win_killer = () => {
  // descending doom: tritone brass + organ + thunder
  const len = 8, b = buf(len);
  mix(b, S.thunder(), 0, 0.5);
  const chords = [[38, 44, 50], [37, 43, 49], [34, 40, 46]];
  chords.forEach((ch, i) => {
    for (const n of ch) {
      mix(b, osc(2.8, (t) => midi(n) * (1 + 0.003 * Math.sin(t * 6)), 'saw', (t) => env.adsr(t, 0.05, 0.4, 0.7, 1, 2.8)), 0.3 + i * 1.6, 0.13);
      mix(b, osc(2.8, midi(n) / 2, 'square', (t) => env.adsr(t, 0.05, 0.4, 0.6, 1, 2.8)), 0.3 + i * 1.6, 0.06);
    }
  });
  mix(b, osc(4, (t) => 30 + 40 * Math.exp(-t / 0.1), 'sine', (t) => env.exp(t, 0.002, 1.5)), 3.5, 1.2);
  return reverb(biquad(drive(b, 2), 'lp', 3500), 0.45, 1.4, 3);
};

S.join = () => {
  const len = 1.2, b = buf(len);
  mix(b, bell(1, midi(84), undefined, 0.35), 0, 0.35);
  mix(b, bell(1, midi(91), undefined, 0.3), 0.07, 0.25);
  return reverb(b, 0.45, 0.9, 1);
};

S.creak = () => {
  // door creak: slow pulsed friction
  const len = 2.2, b = buf(len);
  let ph = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    const rate = 35 + 30 * Math.sin(t * 2.1) + 15 * Math.sin(t * 7.3);
    ph += rate / SR;
    const pulse = Math.pow(Math.max(0, Math.sin(2 * Math.PI * ph)), 18);
    b[i] = pulse * (0.6 + 0.4 * noise()) * env.adsr(t, 0.2, 0.3, 0.8, 0.6, len);
  }
  let o = buf(len);
  for (const [fc, g] of [[600, 1], [1400, 0.6], [2600, 0.3]]) mix(o, biquad(b, 'bp', fc, 10), 0, g);
  return reverb(o, 0.35, 1, 1.2);
};

S.start_game = () => {
  // big gong + choir stab to start the game
  const len = 6, b = buf(len);
  mix(b, bell(5, 65, [[1, 1, 1], [1.48, 0.7, 0.8], [2.1, 0.5, 0.6], [2.9, 0.4, 0.5], [4.2, 0.25, 0.4], [6.3, 0.15, 0.3]], 2.5), 0, 0.8);
  mix(b, osc(2, (t) => 40 + 40 * Math.exp(-t / 0.05), 'sine', (t) => env.exp(t, 0.002, 0.8)), 0, 1.2);
  return reverb(drive(b, 1.4), 0.45, 1.4, 3);
};

S.shh = () => {
  // a long whispered "shhhh" — silence during the Action Phase
  const len = 2.4, b = buf(len);
  const n = noiseBuf(len, (t) => env.adsr(t, 0.25, 0.3, 0.75, 0.9, len) * (0.85 + 0.15 * Math.sin(t * 23)));
  mix(b, biquad(biquad(n, 'hp', 2200), 'bp', (t) => 4200 - 500 * t, 1.4), 0, 1);
  mix(b, biquad(n, 'bp', 6500, 2), 0, 0.35);
  return reverb(b, 0.45, 1.2, 1.6);
};

// ---- loops ----
S.ambience = () => {
  // 32 s seamless drone: low detuned sines + wind + distant creaks
  const len = 32, b = buf(len);
  // frequencies chosen so cycles fit the loop length (seamless)
  const loopF = (f) => Math.round(f * len) / len;
  for (const [f, g] of [[55, 0.35], [55.25, 0.3], [82.5, 0.12], [110.5, 0.06], [77.75, 0.08]]) {
    const F = loopF(f);
    const lfoF = 1 / len * (1 + Math.floor(rnd() * 3));
    for (let i = 0; i < b.length; i++) {
      const t = i / SR;
      b[i] += Math.sin(2 * Math.PI * F * t) * g * (0.7 + 0.3 * Math.sin(2 * Math.PI * lfoF * t));
    }
  }
  const wind = noiseBuf(len, (t) => 0.5 + 0.5 * Math.sin(2 * Math.PI * t * 3 / len) * Math.sin(2 * Math.PI * t * 5 / len));
  mix(b, biquad(wind, 'bp', (t) => 500 + 350 * Math.sin(2 * Math.PI * t * 2 / len) + 150 * Math.sin(2 * Math.PI * t * 7 / len), 2.5), 0, 0.25);
  mix(b, S.creak(), 9, 0.15);
  mix(b, bell(4, midi(40), undefined, 2), 21, 0.12);
  mix(b, S.creak(), 26, 0.08);
  // seamless: crossfade tail of reverb back into head
  const wet = reverb(b, 0.3, 1.3, 3);
  const out = wet.slice(0, b.length);
  for (let i = 0; i < wet.length - b.length; i++) out[i] += wet[b.length + i];
  return out;
};

S.lobby = () => {
  // warped lullaby, 4 bars, loopable
  const step = 0.4;
  const mel = [69, 72, 76, 74, 72, 71, 69, null, 68, 71, 74, 72, 71, 69, 68, null,
    69, 72, 76, 77, 76, 74, 72, 71, 69, 68, 65, 64, 69, null, null, null];
  const len = mel.length * step, b = buf(len);
  const bass = [45, null, null, null, 41, null, null, null, 40, null, null, null, 45, null, null, null,
    45, null, null, null, 41, null, null, null, 38, null, null, null, 40, null, null, null];
  mel.forEach((n, i) => { if (n) mix(b, bell(2, midi(n) * (1 + (rnd() - 0.5) * 0.01), [[1, 1, 1], [3.01, 0.25, 0.3], [5.98, 0.08, 0.15]], 0.8), i * step, 0.35); });
  bass.forEach((n, i) => { if (n) mix(b, osc(1.6, midi(n), 'tri', (t) => env.exp(t, 0.01, 0.6)), i * step, 0.18); });
  // tape wobble pad
  mix(b, osc(len, (t) => midi(57) * (1 + 0.004 * Math.sin(2 * Math.PI * t / len * 4)), 'sine', () => 0.05), 0, 1);
  const wet = reverb(b, 0.45, 1.2, 3);
  const out = wet.slice(0, b.length);
  for (let i = 0; i < wet.length - b.length; i++) out[i] += wet[b.length + i];
  return out;
};

S.tension = () => {
  // action phase loop (16 s): pulsing low ostinato + high string harmonics
  const len = 16, b = buf(len);
  const beat = 0.5;
  for (let i = 0; i < len / beat; i++) {
    const f = i % 8 < 6 ? 41.2 : 43.65;
    mix(b, osc(0.45, (t) => f * (1 + 0.6 * Math.exp(-t / 0.03)), 'sine', (t) => env.exp(t, 0.003, 0.12)), i * beat, i % 2 ? 0.55 : 0.9);
  }
  for (let i = 0; i < len / 4; i++) {
    const n = [88, 87, 88, 89][i % 4];
    mix(b, osc(4.5, (t) => midi(n) * (1 + 0.004 * Math.sin(2 * Math.PI * 5 * t)), 'tri', (t) => env.adsr(t, 1.2, 0.5, 0.6, 1.5, 4.5)), i * 4, 0.05);
  }
  mix(b, biquad(noiseBuf(len, () => 0.3), 'bp', 900, 6), 0, 0.2);
  const wet = reverb(drive(b, 1.4), 0.3, 1.1, 2);
  const out = wet.slice(0, b.length);
  for (let i = 0; i < wet.length - b.length; i++) out[i] += wet[b.length + i];
  return out;
};

// ---------- phone speakers ----------
// Phone speakers can't reproduce much below ~250 Hz, so deep booms/drones/heartbeats vanish.
// Add harmonics of the bass (the ear hears the "missing" fundamental) and raise loudness.
function phoneify(b, amt = 1) {
  const low = biquad(b, 'lp', 170);
  const h = new Float32Array(b.length);
  for (let i = 0; i < b.length; i++) h[i] = Math.tanh(low[i] * 7);
  const hb = biquad(biquad(h, 'hp', 190), 'lp', 1400);
  for (let i = 0; i < b.length; i++) b[i] += hb[i] * 0.45 * amt;
  normalize(b, 1);
  const k = 1 + 1.4 * amt;
  for (let i = 0; i < b.length; i++) b[i] = Math.tanh(b[i] * k) / Math.tanh(k);
  return b;
}

// ---------- write ----------
function writeWav(file, data) {
  const n = data.length, bufOut = Buffer.alloc(44 + n * 2);
  bufOut.write('RIFF', 0); bufOut.writeUInt32LE(36 + n * 2, 4); bufOut.write('WAVE', 8);
  bufOut.write('fmt ', 12); bufOut.writeUInt32LE(16, 16); bufOut.writeUInt16LE(1, 20); bufOut.writeUInt16LE(1, 22);
  bufOut.writeUInt32LE(SR, 24); bufOut.writeUInt32LE(SR * 2, 28); bufOut.writeUInt16LE(2, 32); bufOut.writeUInt16LE(16, 34);
  bufOut.write('data', 36); bufOut.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) bufOut.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(data[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(file, bufOut);
}

const LOOPS = new Set(['ambience', 'lobby', 'tension', 'heartbeat']);
const only = process.argv.slice(2);
for (const name of Object.keys(S)) {
  if (name === 'creak' && !only.includes('creak')) continue;
  if (only.length && !only.includes(name)) continue;
  seed = 1337 + name.length * 97;
  let data = S[name]();
  const AMT = { heartbeat: 2.2, ambience: 1.3, tension: 1.1, lobby: 0.6 };
  if (!['click', 'tick'].includes(name)) phoneify(data, AMT[name] ?? 1);
  normalize(data, LOOPS.has(name) ? 0.8 : 0.95);
  if (!LOOPS.has(name)) fadeEdges(data, 0.002, 0.15);
  const wav = path.join(WAV, name + '.wav');
  writeWav(wav, data);
  const mp3 = path.join(OUT, name + '.mp3');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', LOOPS.has(name) ? '96k' : '128k', mp3]);
  console.log('✓', name, (data.length / SR).toFixed(2) + 's', Math.round(fs.statSync(mp3).size / 1024) + 'KB');
}
