// writes the same synthetic test signals as raw 16-bit PCM
import fs from 'node:fs';
export function synth(events, sr, noise = 0.002, seed = 1) {
  let r = seed; const rnd = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
  const total = Math.max(...events.map(e => e.t + e.dur)) + 0.5;
  const N = Math.ceil(total * sr); const x = new Float32Array(N);
  for (let i = 0; i < N; i++) x[i] = (rnd() * 2 - 1) * noise;
  for (const e of events) for (const m of e.midis) {
    const f = 440 * Math.pow(2, (m - 69) / 12);
    const i0 = Math.floor(e.t * sr), i1 = Math.min(N, Math.floor((e.t + e.dur) * sr));
    for (let i = i0; i < i1; i++) { const tt = (i - i0) / sr; const env = Math.exp(-tt * 2.5) * Math.min(1, tt * 200);
      let s = 0; for (let h = 1; h <= 6; h++) s += Math.sin(2 * Math.PI * f * h * tt) * Math.pow(0.55, h - 1); x[i] += 0.12 * env * s; }
  }
  return x;
}
const POLY = [{ midis: [48], t: 0.8, dur: 1.0 }, { midis: [64], t: 0.8, dur: 0.5 }, { midis: [67], t: 1.4, dur: 0.5 }, { midis: [43, 71], t: 2.2, dur: 0.6 }];
const MONO = [{ midis: [60], t: 0.6, dur: 0.5 }, { midis: [64], t: 1.2, dur: 0.5 }, { midis: [67], t: 1.8, dur: 0.5 }, { midis: [67], t: 2.4, dur: 0.4 }, { midis: [45], t: 3.0, dur: 0.6 }, { midis: [81], t: 3.8, dur: 0.5 }];
export const SETS = { POLY, MONO };
if (process.argv[2]) {
  const [name, sr, file] = process.argv.slice(2);
  const x = synth(SETS[name], +sr);
  const b = Buffer.alloc(x.length * 2);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), i * 2);
  fs.writeFileSync(file, b);
}
