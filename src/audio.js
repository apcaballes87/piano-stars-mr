// Microphone note listening + a small piano-like synth for "Listen" and tap mode.
import tapCode from './tap.wjs';
import detectCode from './detect.wjs';

const MIC_CONSTRAINTS = {
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
};

export class AudioIO {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.source = null;
    this.tapNode = null;
    this.worker = null;
    this.micOk = false;
    this.mode = 'mono';
    this.onNote = null; // (midi, agoSeconds)
    this.onHear = null; // (midi, level)
    this.voices = new Set();
    this.out = null;
    // diagnostics
    this.level = 0; // last sound level (RMS)
    this.hops = 0; // sound blocks that reached the note finder
    this.lastHopAt = 0; // performance.now() of the last block
    this.heardMidi = -1;
    this.heardAt = 0;
    this.error = '';
    this.restarting = false;
  }

  ensureCtx() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.5;
      this.out.connect(this.ctx.destination);
      // Some browsers stop the audio when the headset view opens. Start it again.
      this.ctx.addEventListener('statechange', () => {
        if (this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.ctx.resume().catch(() => {});
      });
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /** Asks for the microphone and starts the note finder. Returns true if it works. */
  async startMic() {
    if (this.micOk) return true;
    const ctx = this.ensureCtx();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    } catch (e) {
      console.warn('mic', e);
      this.error = 'No microphone: ' + (e && e.name ? e.name : e);
      return false;
    }
    try {
      const url = URL.createObjectURL(new Blob([tapCode], { type: 'text/javascript' }));
      await ctx.audioWorklet.addModule(url);
      const tap = new AudioWorkletNode(ctx, 'ps-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      const mute = ctx.createGain();
      mute.gain.value = 0;
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
      this.connectStream();
      this.micOk = true;
      this.error = '';
      return true;
    } catch (e) {
      console.warn('mic pipeline', e);
      this.error = 'Sound setup failed: ' + (e && e.message ? e.message : e);
      return false;
    }
  }

  connectStream() {
    if (this.source) {
      try {
        this.source.disconnect();
      } catch (e) {
        /* ignore */
      }
    }
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.source.connect(this.tapNode);
    const tr = this.stream.getAudioTracks()[0];
    if (tr) tr.addEventListener('ended', () => this.restartMic());
  }

  /** Gets a new microphone stream (for example after the browser stopped the old one). */
  async restartMic() {
    if (this.restarting || !this.tapNode) return;
    this.restarting = true;
    try {
      if (this.stream) for (const t of this.stream.getTracks()) t.stop();
      this.stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      this.connectStream();
      if (this.worker) this.worker.postMessage({ cmd: 'mode', mode: this.mode, reset: true });
      this.error = '';
    } catch (e) {
      this.error = 'Microphone stopped: ' + (e && e.name ? e.name : e);
    }
    this.restarting = false;
  }

  /** Call often while playing: keeps the audio and the microphone running. */
  keepAlive() {
    if (!this.ctx) return;
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    if (!this.micOk) return;
    const tr = this.stream && this.stream.getAudioTracks()[0];
    const stalled = performance.now() - this.lastHopAt > 2500;
    if (tr && tr.muted) this.mutedSince = this.mutedSince || performance.now();
    else this.mutedSince = 0;
    const longMuted = this.mutedSince && performance.now() - this.mutedSince > 3000;
    const canRetry = performance.now() - (this.lastRestart || 0) > 6000;
    if (!tr || tr.readyState === 'ended' || ((stalled || longMuted) && this.ctx.state === 'running' && canRetry)) {
      this.lastRestart = performance.now();
      this.restartMic();
    }
  }

  /** 'ok', 'off' (not started), 'muted' (the system muted it) or 'stalled' (no sound data arrives). */
  status() {
    if (!this.micOk) return 'off';
    const tr = this.stream && this.stream.getAudioTracks()[0];
    if (tr && tr.muted) return 'muted';
    return performance.now() - this.lastHopAt < 1500 ? 'ok' : 'stalled';
  }

  fromWorker(d) {
    if (d.t === 'note') {
      const ago = this.ctx ? Math.max(0, Math.min(0.5, this.ctx.currentTime - d.at)) : 0;
      this.heardMidi = d.m;
      this.heardAt = performance.now();
      this.onNote && this.onNote(d.m, ago);
    } else if (d.t === 'hear') {
      this.level = d.lv;
      this.hops++;
      this.lastHopAt = performance.now();
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

/** 0..1 for a level meter (log scale, 0.0005 to 0.1 RMS). */
export function meter(level) {
  if (!(level > 0)) return 0;
  return Math.max(0, Math.min(1, (Math.log10(level) + 3.3) / 2.3));
}
