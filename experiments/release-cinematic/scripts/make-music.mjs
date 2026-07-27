// Generates the cinematic backing track (public/music.wav).
// Ambient electronic: slow pads, sub bass, a riser into the theme switch,
// and soft plucks once the new UI lands. Convert to mp3 with ffmpeg after.
import fs from "node:fs";
import path from "node:path";

const SR = 44100;
const DUR = 24;
const N = SR * DUR;
const L = new Float64Array(N);
const R = new Float64Array(N);

const TAU = Math.PI * 2;
const noteHz = (midi) => 440 * 2 ** ((midi - 69) / 12);

// A minor progression: Am, F, C, G — two bars each half
const CHORDS = [
  [57, 60, 64], // Am
  [53, 57, 60], // F
  [48, 52, 55, 60], // C
  [55, 59, 62], // G
];
const CHORD_LEN = DUR / 4 / 1.0; // 4 chords over the piece
const SWITCH_T = 8.8; // the theme-switch moment

const softClip = (x) => Math.tanh(x);

// pads
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const chordIdx = Math.min(CHORDS.length - 1, Math.floor(t / CHORD_LEN));
  const chord = CHORDS[chordIdx];
  const tc = (t % CHORD_LEN) / CHORD_LEN;
  const env = Math.min(1, tc * 6) * Math.min(1, (1 - tc) * 3 + 0.35);
  const master = Math.min(1, t * 0.8) * Math.min(1, (DUR - t) * 0.45);
  let s = 0;
  for (let v = 0; v < chord.length; v++) {
    const hz = noteHz(chord[v]);
    const det = 1 + 0.0016 * Math.sin(TAU * 0.13 * t + v);
    s += Math.sin(TAU * hz * det * t) * 0.5;
    s += Math.sin(TAU * hz * 0.5 * t) * 0.28; // octave below
    s += Math.sin(TAU * hz * 2 * t + Math.sin(TAU * 0.09 * t)) * 0.1;
  }
  s = (s / chord.length) * env * master;
  // brighter after the switch
  const brightness = t < SWITCH_T ? 0.55 : 0.8;
  L[i] += s * 0.32 * brightness * (1 + 0.15 * Math.sin(TAU * 0.05 * t));
  R[i] += s * 0.32 * brightness * (1 - 0.15 * Math.sin(TAU * 0.05 * t));
}

// sub bass (root notes)
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const chordIdx = Math.min(CHORDS.length - 1, Math.floor(t / CHORD_LEN));
  const root = CHORDS[chordIdx][0] - 24;
  const master = Math.min(1, t * 0.6) * Math.min(1, (DUR - t) * 0.4);
  const s = Math.sin(TAU * noteHz(root) * t) * 0.16 * master;
  L[i] += s;
  R[i] += s;
}

// riser into the switch: filtered-noise swell that cuts at SWITCH_T
let lp = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  if (t < SWITCH_T - 5 || t > SWITCH_T) continue;
  const p = (t - (SWITCH_T - 5)) / 5;
  const noise = Math.random() * 2 - 1;
  const alpha = 0.02 + 0.3 * p * p;
  lp += alpha * (noise - lp);
  const amp = 0.22 * p * p;
  L[i] += lp * amp;
  R[i] += lp * amp * 0.9;
}

// impact at the switch: low thump + shimmer
for (let i = Math.floor(SWITCH_T * SR); i < N; i++) {
  const t = i / SR - SWITCH_T;
  if (t > 3) break;
  const thump = Math.sin(TAU * 52 * t * Math.exp(-t * 1.2)) * Math.exp(-t * 3.2) * 0.5;
  const shimmer = Math.sin(TAU * 1568 * t) * Math.exp(-t * 2.2) * 0.05;
  L[i] += thump + shimmer;
  R[i] += thump + shimmer * 1.2;
}

// plucks after the switch (pentatonic sparkles on the grid)
const PLUCK_NOTES = [81, 76, 84, 79, 88, 81, 76, 84];
const step = 0.5;
for (let k = 0; k < PLUCK_NOTES.length * 3; k++) {
  const start = SWITCH_T + 1.5 + k * step;
  if (start > DUR - 2) break;
  const hz = noteHz(PLUCK_NOTES[k % PLUCK_NOTES.length]);
  const pan = 0.5 + 0.4 * Math.sin(k * 1.7);
  for (let i = Math.floor(start * SR); i < N; i++) {
    const t = i / SR - start;
    if (t > 1.2) break;
    const s = Math.sin(TAU * hz * t) * Math.exp(-t * 6) * 0.09;
    L[i] += s * (1 - pan);
    R[i] += s * pan;
  }
}

// drums — 120bpm. Sparse pulse before the switch, full kit after.
const BEAT = 0.5;
const kick = (start, amp) => {
  for (let i = Math.floor(start * SR); i < N; i++) {
    const t = i / SR - start;
    if (t > 0.35) break;
    const s = Math.sin(TAU * (48 + 90 * Math.exp(-t * 26)) * t) * Math.exp(-t * 14) * amp;
    L[i] += s;
    R[i] += s;
  }
};
const snare = (start, amp) => {
  for (let i = Math.floor(start * SR); i < N; i++) {
    const t = i / SR - start;
    if (t > 0.22) break;
    const body = Math.sin(TAU * 190 * t) * Math.exp(-t * 22) * 0.5;
    const rattle = (Math.random() * 2 - 1) * Math.exp(-t * 24);
    const s = (body + rattle * 0.7) * amp;
    L[i] += s * 0.95;
    R[i] += s;
  }
};
const hat = (start, amp, open = false) => {
  for (let i = Math.floor(start * SR); i < N; i++) {
    const t = i / SR - start;
    if (t > (open ? 0.3 : 0.06)) break;
    const s = (Math.random() * 2 - 1) * Math.exp(-t * (open ? 14 : 70)) * amp;
    L[i] += s * 0.8;
    R[i] += s;
  }
};
for (let b = 0; ; b++) {
  const t0 = 1 + b * BEAT;
  if (t0 > DUR - 1.2) break;
  const beatInBar = b % 4;
  if (t0 < SWITCH_T - 0.1) {
    // sparse intro pulse
    if (beatInBar === 0) kick(t0, 0.28);
    hat(t0 + BEAT / 2, 0.05);
  } else {
    kick(t0, 0.42);
    if (beatInBar === 1 || beatInBar === 3) snare(t0, 0.3);
    hat(t0, 0.09);
    hat(t0 + BEAT / 2, beatInBar === 3 ? 0.13 : 0.08, beatInBar === 3);
  }
}
// snare fill into the switch
for (let k = 0; k < 8; k++) snare(SWITCH_T - 1 + k * 0.125, 0.12 + k * 0.03);

// simple stereo echo for space
const delay = Math.floor(SR * 0.31);
for (let i = delay; i < N; i++) {
  L[i] += R[i - delay] * 0.22;
  R[i] += L[i - delay] * 0.22;
}

// write WAV (16-bit PCM stereo)
const out = Buffer.alloc(44 + N * 4);
out.write("RIFF", 0);
out.writeUInt32LE(36 + N * 4, 4);
out.write("WAVE", 8);
out.write("fmt ", 12);
out.writeUInt32LE(16, 16);
out.writeUInt16LE(1, 20);
out.writeUInt16LE(2, 22);
out.writeUInt32LE(SR, 24);
out.writeUInt32LE(SR * 4, 28);
out.writeUInt16LE(4, 32);
out.writeUInt16LE(16, 34);
out.write("data", 36);
out.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, softClip(L[i]))) * 32767), 44 + i * 4);
  out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, softClip(R[i]))) * 32767), 46 + i * 4);
}
const dest = path.join(import.meta.dirname, "..", "public", "music.wav");
fs.writeFileSync(dest, out);
console.log("wrote", dest);
