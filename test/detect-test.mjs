import fs from 'node:fs';
const code = fs.readFileSync('src/detect.wjs', 'utf8');
function run(mode, events, sr = 48000, noise = 0.002) {
  const out = [];
  const self = { postMessage: (m) => out.push(m) };
  new Function('self', code)(self);
  const port = {};
  self.onmessage({ data: { cmd: 'init', sr, port } });
  self.onmessage({ data: { cmd: 'mode', mode, reset: true } });
  // events: [{midis:[..], t:sec, dur:sec}]
  const total = Math.max(...events.map(e => e.t + e.dur)) + 0.5;
  const N = Math.ceil(total * sr);
  const x = new Float32Array(N);
  for (let i = 0; i < N; i++) x[i] = (Math.random() * 2 - 1) * noise;
  for (const e of events) for (const m of e.midis) {
    const f = 440 * Math.pow(2, (m - 69) / 12);
    const i0 = Math.floor(e.t * sr), i1 = Math.min(N, Math.floor((e.t + e.dur) * sr));
    for (let i = i0; i < i1; i++) {
      const tt = (i - i0) / sr;
      const env = Math.exp(-tt * 2.5) * Math.min(1, tt * 200);
      let s = 0;
      for (let h = 1; h <= 6; h++) s += Math.sin(2 * Math.PI * f * h * tt) * Math.pow(0.55, h - 1);
      x[i] += 0.12 * env * s;
    }
  }
  for (let i = 0; i + 1024 <= N; i += 1024) port.onmessage({ data: { s: x.slice(i, i + 1024), at: (i + 1024) / sr } });
  return out.filter(m => m.t === 'note').map(m => [m.m, +m.at.toFixed(3)]);
}
const mono = run('mono', [
  { midis: [60], t: 0.6, dur: 0.5 }, { midis: [64], t: 1.2, dur: 0.5 }, { midis: [67], t: 1.8, dur: 0.5 },
  { midis: [67], t: 2.4, dur: 0.4 }, { midis: [45], t: 3.0, dur: 0.6 }, { midis: [81], t: 3.8, dur: 0.5 }]);
console.log('mono 48k:', JSON.stringify(mono));
console.log('mono 44.1k:', JSON.stringify(run('mono', [{ midis: [60], t: 0.6, dur: 0.5 }, { midis: [62], t: 1.2, dur: 0.5 }], 44100)));
const poly = run('poly', [
  { midis: [48], t: 0.8, dur: 1.0 }, { midis: [64], t: 0.8, dur: 0.5 }, { midis: [67], t: 1.4, dur: 0.5 },
  { midis: [43, 71], t: 2.2, dur: 0.6 }]);
console.log('poly 48k:', JSON.stringify(poly));
