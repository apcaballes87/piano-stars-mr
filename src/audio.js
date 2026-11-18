// Microphone note listening + a small piano-like synth for "Listen" and tap mode.
import tapCode from './tap.wjs';
import detectCode from './detect.wjs';

export class AudioIO {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.worker = null;
    this.micOk = false;
    this.mode = 'mono';
    this.onNote = null; // (midi, agoSeconds)
    this.onHear = null; // (midi, level)
    this.voices = new Set();
    this.out = null;
  }

  ensureCtx() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.5;
      this.out.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  /** Asks for the microphone and starts the note finder. Returns true if it works. */
  async startMic() {
    if (this.micOk) return true;
    const ctx = this.ensureCtx();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (e) {
      console.warn('mic', e);
      return false;
    }
    try {
      const url = URL.createObjectURL(new Blob([tapCode], { type: 'text/javascript' }));
      await ctx.audioWorklet.addModule(url);
      const src = ctx.createMediaStreamSource(this.stream);
      const tap = new AudioWorkletNode(ctx, 'ps-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      const mute = ctx.createGain();
      mute.gain.value = 0;
      src.connect(tap);
      tap.connect(mute);
      mute.connect(ctx.destination);
      const wurl = URL.createObjectURL(new Blob([detectCode], { type: 'text/javascript' }));
      this.worker = new Worker(wurl);
      const ch = new MessageChannel();
      tap.port.postMessage({ port: ch.port1 }, [ch.port1]);
      this.worker.postMessage({ cmd: 'init', sr: ctx.sampleRate, port: ch.port2 }, [ch.port2]);
      this.worker.postMessage({ cmd: 'mode', mode: this.mode, reset: true });
      this.worker.onmessage = (e) => this.fromWorker(e.data);
      this.tapNode = tap;
      this.micOk = true;
      return true;
    } catch (e) {
      console.warn('mic pipeline', e);
      return false;
    }
  }

  fromWorker(d) {
    if (d.t === 'note') {
      const ago = this.ctx ? Math.max(0, Math.min(0.5, this.ctx.currentTime - d.at)) : 0;
      this.onNote && this.onNote(d.m, ago);
    } else if (d.t === 'hear') {
      this.onHear && this.onHear(d.m, d.lv);
    }
  }

  /** 'mono' for one hand, 'poly' for two hands. Also re-measures the room noise. */
  setMode(mode) {
    this.mode = mode;
    if (this.worker) this.worker.postMessage({ cmd: 'mode', mode, reset: true });
  }

  // ---------------------------------------------------------------- synth

  tone(midi, when = 0, len = 0.9) {
    const ctx = this.ensureCtx();
    const t0 = Math.max(ctx.currentTime, when || ctx.currentTime);
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.3, len) + 0.6);
    g.connect(this.out);
    const oscs = [];
    const parts = [[1, 1, 'triangle'], [2, 0.35, 'sine'], [3, 0.12, 'sine']];
    for (const [mul, amp, type] of parts) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * mul;
      const og = ctx.createGain();
      og.gain.value = amp;
      o.connect(og);
      og.connect(g);
      o.start(t0);
      o.stop(t0 + Math.max(0.3, len) + 0.7);
      oscs.push(o);
    }
    const v = { oscs, g };
    this.voices.add(v);
    oscs[0].onended = () => this.voices.delete(v);
  }

  stopAll() {
    for (const v of this.voices) {
      for (const o of v.oscs) {
        try {
          o.stop();
        } catch (e) {
          /* already stopped */
        }
      }
    }
    this.voices.clear();
  }
}
