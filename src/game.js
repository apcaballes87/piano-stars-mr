// Game rules, ported from the tablet app (GameView.java). No drawing here.

export const EASY = 0;
export const MEDIUM = 1;
export const ADVANCED = 2;
export const LEVEL_NAMES = ['Easy', 'Medium', 'Advanced'];
export const MIN_SPEED = 0.5;
export const MAX_SPEED = 2.5;

export const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const PC_COLORS = ['#FF5A5F', '#C9444A', '#FF9F1C', '#C97C14', '#FFD23F', '#3BCEAC',
  '#2E9E85', '#4D9DE0', '#3A78AD', '#8C6BFF', '#6A50C9', '#E15FED'];

export const PENDING = 0;
export const HIT = 1;
export const MISS = 2;
export const SKIP = 3;

const WHITE = [true, false, true, false, true, true, false, true, false, true, false, true];

export function isWhite(m) {
  return WHITE[((m % 12) + 12) % 12];
}

export function noteName(m) {
  return NAMES[m % 12] + (Math.floor(m / 12) - 1);
}

export class Game {
  /**
   * song: {title, bpm, barBeats, pickup, windowLow, right:[[midi,beat,len]], left:[...]}
   * fx: optional callbacks {hit(n, perfect), miss(n), wrong(midi), combo(count), finish(stars)}
   */
  constructor(song, level, waitMode, twoHands, speed, fx = {}) {
    this.song = song;
    this.level = level;
    this.waitMode = waitMode;
    this.twoHands = twoHands;
    this.fx = fx;
    this.speed = clampSpeed(speed);
    this.octaveFree = level !== ADVANCED;
    this.window = level === EASY ? 0.6 : level === MEDIUM ? 0.45 : 0.28;
    this.lookAhead = level === EASY ? 3.5 : level === MEDIUM ? 3.0 : 2.5;

    // Fixed keyboard: 1 hand = 2 octaves (14 white keys), 2 hands = 4 octaves (C2 to B5).
    const start = twoHands ? 36 : song.windowLow;
    const whiteCount = twoHands ? 28 : 14;
    this.whiteKeys = [];
    for (let m = start; this.whiteKeys.length < whiteCount; m++) {
      if (isWhite(m)) this.whiteKeys.push(m);
    }
    this.lowMidi = start;
    this.highMidi = this.whiteKeys[this.whiteKeys.length - 1];

    const parts = song.right.map((n) => ({ midi: n[0], beat: n[1], len: n[2], left: false }));
    if (twoHands) {
      for (const n of song.left) parts.push({ midi: n[0], beat: n[1], len: n[2], left: true });
    }
    parts.sort((a, b) => (a.beat !== b.beat ? a.beat - b.beat : a.midi - b.midi));

    this.notes = [];
    this.endTime = 0;
    for (const p of parts) {
      let m = p.midi;
      while (m > this.highMidi) m -= 12;
      while (m < this.lowMidi) m += 12;
      const g = { midi: m, start: p.beat, end: p.beat + p.len, left: p.left, state: PENDING, tries: 0, id: this.notes.length };
      this.notes.push(g);
      this.endTime = Math.max(this.endTime, g.end);
    }

    this.events = [];
    this.hearingMidi = -1;
    this.songTime = -(this.lookAhead + 1.0) * this.bps();
    this.paused = false; // the app is hidden or the headset menu is open
    this.userPaused = false;
    this.scrolled = false;
    this.finished = false;
    this.waiting = false;
    this.nextIdx = 0;
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.perfect = 0;
    this.good = 0;
    this.missed = 0;
    this.stars = 0;
    this.hint = '';
    this.hintAge = 99;
    this.rushRate = 0; // wait mode: beats per second to bring the next block down fast
  }

  /** Beats per second at the current speed. */
  bps() {
    return (this.song.bpm * this.speed) / 60.0;
  }

  /** The timing window for a hit, in beats. */
  win() {
    return this.window * this.bps();
  }

  setSpeed(v) {
    this.speed = clampSpeed(v);
  }

  /** A key press was heard. ago = seconds since the sound. */
  noteHeard(midi, ago = 0) {
    this.events.push([midi, ago]);
  }

  togglePause() {
    this.userPaused = !this.userPaused;
    if (!this.userPaused && this.scrolled) {
      this.songTime -= 1.0 * this.bps(); // a short run-up after a jump
      this.scrolled = false;
    }
  }

  /** Moves the song to beat t. Notes from t on can be played again. */
  seekTo(t) {
    const lead = -(this.lookAhead + 1.0) * this.bps();
    this.songTime = Math.max(lead, Math.min(this.endTime, t));
    for (const n of this.notes) {
      if (n.start >= this.songTime - 1e-6) {
        n.state = PENDING;
        n.tries = 0;
      } else if (n.state === PENDING) {
        n.state = SKIP;
      }
    }
    this.nextIdx = 0;
    this.nextIdx = this.firstPending();
    this.waiting = false;
    this.scrolled = true;
  }

  matches(heard, target) {
    return this.octaveFree ? heard % 12 === target % 12 : heard === target;
  }

  update(dt) {
    const evs = this.events;
    this.events = [];
    for (const [midi, ago] of evs) {
      if (!this.paused && !this.userPaused && !this.finished) {
        this.handleEvent(midi, this.songTime - (this.waiting ? 0 : ago * this.bps()));
      }
    }
    this.hintAge += dt;
    if (this.paused || this.finished || this.userPaused) return;
    this.songTime += dt * this.bps();
    this.nextIdx = this.firstPending();
    const notes = this.notes;
    if (this.waitMode) {
      this.waiting = false;
      if (this.nextIdx < notes.length) {
        const n = notes[this.nextIdx];
        if (this.rushRate > 0 && this.songTime < n.start) {
          // A right note was played: bring the next block down fast, do not wait for the beat.
          this.songTime = Math.min(n.start, this.songTime + Math.max(0, (this.rushRate - this.bps()) * dt));
        }
        if (this.songTime >= n.start) {
          this.songTime = n.start;
          this.waiting = true;
          this.rushRate = 0;
        }
      }
    } else {
      for (let i = this.nextIdx; i < notes.length; i++) {
        const n = notes[i];
        if (n.start > this.songTime) break;
        if (n.state === PENDING && this.songTime > n.start + this.win()) this.miss(n);
      }
      while (this.nextIdx < notes.length && notes[this.nextIdx].state !== PENDING) this.nextIdx++;
    }
    if (this.nextIdx >= notes.length && this.songTime > this.endTime + 1.2 * this.bps()) {
      this.finish();
    }
  }

  firstPending() {
    let i = this.nextIdx;
    while (i < this.notes.length && this.notes[i].state !== PENDING) i++;
    return i;
  }

  /** Index after the last note that starts together with the note at i (a chord). */
  groupEnd(i) {
    const g0 = this.notes[i].start;
    let j = i;
    while (j < this.notes.length && this.notes[j].start <= g0 + 1e-6) j++;
    return j;
  }

  handleEvent(midi, evTime) {
    const notes = this.notes;
    if (this.waitMode) {
      this.nextIdx = this.firstPending();
      if (this.nextIdx >= notes.length) return;
      const first = notes[this.nextIdx];
      // Listen as soon as the next block can be seen. The right key moves the song on at once.
      if (first.start - this.songTime > this.lookAhead * this.bps()) return;
      const end = this.groupEnd(this.nextIdx);
      for (let i = this.nextIdx; i < end; i++) {
        const n = notes[i];
        if (n.state === PENDING && this.matches(midi, n.midi)) {
          this.hit(n, n.tries === 0);
          this.nextIdx = this.firstPending();
          return;
        }
      }
      // Two-hand listening is less strict, so do not count wrong notes there.
      if (!this.twoHands) {
        first.tries++;
        this.hint = 'That was ' + NAMES[midi % 12] + '. Find ' + NAMES[first.midi % 12] + '!';
        this.hintAge = 0;
        this.fx.wrong && this.fx.wrong(midi);
      }
      return;
    }
    let best = null;
    let bestErr = 99;
    for (let i = this.nextIdx; i < notes.length; i++) {
      const n = notes[i];
      if (n.start > evTime + this.win()) break;
      if (n.state !== PENDING || !this.matches(midi, n.midi)) continue;
      const err = Math.abs(n.start - evTime);
      if (err <= this.win() && err < bestErr) {
        best = n;
        bestErr = err;
      }
    }
    if (best) this.hit(best, bestErr <= this.win() * 0.45);
  }

  hit(n, isPerfect) {
    n.state = HIT;
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    if (isPerfect) {
      this.perfect++;
      this.score += 100;
    } else {
      this.good++;
      this.score += 60;
    }
    this.score += Math.min(this.combo, 20) * 5;
    if (this.waitMode) this.startRush(n);
    this.fx.hit && this.fx.hit(n, isPerfect);
    if (this.combo > 0 && this.combo % 10 === 0) this.fx.combo && this.fx.combo(this.combo);
  }

  /** Wait mode: when the whole chord is played, the next block comes down in about 0.15 s. */
  startRush(n) {
    for (const g of this.notes) {
      if (g.start > n.start + 1e-6) break;
      if (g.state === PENDING && Math.abs(g.start - n.start) < 1e-6) return; // chord not done yet
    }
    let j = this.nextIdx;
    while (j < this.notes.length && this.notes[j].state !== PENDING) j++;
    if (j >= this.notes.length) return;
    const gap = this.notes[j].start - this.songTime;
    if (gap > 0) this.rushRate = Math.max(this.bps() * 3, gap / 0.15);
  }

  miss(n) {
    n.state = MISS;
    this.missed++;
    this.combo = 0;
    this.fx.miss && this.fx.miss(n);
  }

  finish() {
    this.finished = true;
    const total = Math.max(1, this.notes.length);
    const acc = (this.perfect + 0.7 * this.good) / total;
    this.stars = acc >= 0.9 ? 3 : acc >= 0.7 ? 2 : 1;
    this.fx.finish && this.fx.finish(this.stars);
  }

  /** Keys that should glow now (the next notes to play). */
  glowKeys() {
    const out = new Set();
    const lead = (this.waitMode ? 0.05 : 0.6) * this.bps();
    for (let i = this.nextIdx; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.start - this.songTime > lead) break;
      if (n.state === PENDING) out.add(n.midi);
    }
    return out;
  }

  /** Notes of the next chord (for the light beams over the keys). */
  nextGroup() {
    if (this.nextIdx >= this.notes.length) return [];
    const end = this.groupEnd(this.nextIdx);
    const out = [];
    for (let i = this.nextIdx; i < end; i++) {
      const n = this.notes[i];
      if (n.state === PENDING && n.start - this.songTime < this.lookAhead * this.bps()) out.push(n);
    }
    return out;
  }

  /** The big message in the middle (same rules as the tablet). Returns {text, color, sub}. */
  centerText() {
    if (this.finished) return null;
    if (this.userPaused) return { text: 'Paused', color: '#FFFFFF', sub: 'Press Play to go on' };
    if (this.songTime < 0 && !this.paused) {
      const left = -this.songTime / this.bps();
      const sub = this.twoHands ? 'Left hand notes have a white border' : '';
      return { text: left > 3 ? 'Get ready!' : String(Math.ceil(left)), color: '#FFFFFF', sub };
    }
    if (this.paused) return { text: 'Paused', color: '#FFFFFF', sub: '' };
    if (this.waiting && this.nextIdx < this.notes.length) {
      const n = this.notes[this.nextIdx];
      const end = this.groupEnd(this.nextIdx);
      const names = [];
      for (let i = this.nextIdx; i < end; i++) {
        const g = this.notes[i];
        if (g.state !== PENDING) continue;
        names.push(this.twoHands ? noteName(g.midi) : NAMES[g.midi % 12]);
      }
      return { text: 'Play ' + names.join(' + ') + '!', color: PC_COLORS[n.midi % 12], sub: '' };
    }
    return null;
  }

  progress() {
    return Math.max(0, Math.min(1, this.songTime / Math.max(1e-6, this.endTime)));
  }
}

export function clampSpeed(v) {
  v = Math.max(MIN_SPEED, Math.min(MAX_SPEED, v));
  return Math.round(v * 20) / 20;
}

export function starsKey(id, level, twoHands) {
  return 'stars_' + id + '_' + level + (twoHands ? '_2h' : '');
}
