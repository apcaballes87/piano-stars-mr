// Wait mode = step ahead: the right note moves the song on at once.
import fs from 'node:fs';
import { Game, PENDING } from '../src/game.js';
const songs = JSON.parse(fs.readFileSync('src/songs.json', 'utf8'));
const song = songs.find((s) => s.id === 'twinkle') || songs[2];
const g = new Game(song, 0, true, false, 1.0, {});
const dt = 1 / 72;
let t = 0;
const step = () => { g.update(dt); t += dt; };
while (!g.waiting) step();
console.log('first wait at', t.toFixed(2), 's, note', g.notes[g.nextIdx].midi);
const waits = [];
for (let k = 0; k < 6; k++) {
  const n = g.notes[g.nextIdx];
  g.noteHeard(n.midi, 0.08);
  const t0 = t;
  step();
  while (!g.waiting && !g.finished) step();
  waits.push(+(t - t0).toFixed(3));
}
console.log('time from right note to next "Play X!" (s):', waits.join(', '));
// fast playing: play the next 3 notes 60 ms apart, without waiting for the blocks
const before = g.nextIdx;
for (let k = 0; k < 3; k++) {
  const idx = g.firstPending();
  g.noteHeard(g.notes[idx].midi, 0);
  for (let f = 0; f < 4; f++) step();
}
console.log('fast notes: next index', before, '->', g.nextIdx, 'hits so far', g.perfect + g.good);
// a wrong note gives a hint and does not move on
while (!g.waiting) step();
const idx = g.nextIdx;
g.noteHeard(g.notes[idx].midi + 2, 0); step();
console.log('wrong note: stays at', g.nextIdx === idx, 'hint:', g.hint);
