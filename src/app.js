// Piano Stars MR: menu, settings and start-up.
import * as THREE from 'three';
import SONGS from './songs.json';
import { Game, LEVEL_NAMES, EASY, starsKey, clampSpeed } from './game.js';
import { Stage } from './stage.js';
import { AudioIO } from './audio.js';
import { XRPlay, loadCal } from './xr.js';
import { PreviewPlay } from './preview.js';

const VERSION = '0.1.0';
const LEVEL_COLORS = ['#3BCEAC', '#4D9DE0', '#FF5A5F'];

// ------------------------------------------------------------ settings

const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('ps.' + k);
      return v == null ? d : JSON.parse(v);
    } catch (e) {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('ps.' + k, JSON.stringify(v));
    } catch (e) {
      /* ignore */
    }
  },
};

const S = {
  level: store.get('level', EASY),
  twoHands: store.get('two_hands', false),
  speed: store.get('speed', 1),
  input: store.get('input', 'mic'), // screen mode only: 'mic' or 'tap'
  view: store.get('view', null), // 'mr' or 'screen'
};
S.wait = store.get('wait_' + S.level, S.level === EASY);

// ------------------------------------------------------------ 3D setup

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setClearColor(0x000000, 0);
renderer.xr.enabled = true;
renderer.domElement.id = 'gl';
renderer.domElement.style.display = 'none';
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const stage = new Stage();
scene.add(stage.root);
const audio = new AudioIO();
const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 20);

let current = null; // the song being played
let mode = null; // 'xr' | 'screen' | null

const app = {
  renderer,
  scene,
  stage,
  audio,
  camera,
  makeGame() {
    const fx = {
      hit: (n, p) => stage.onHit(n, p),
      miss: (n) => stage.onMiss(n),
      wrong: (m) => stage.onWrong(m),
      combo: (c) => stage.onCombo(c),
      finish: (stars) => {
        const key = starsKey(current.id, S.level, S.twoHands);
        if (stars > store.get(key, 0)) store.set(key, stars);
      },
    };
    const g = new Game(current, S.level, S.wait, S.twoHands, S.speed, fx);
    app.game = g;
    return g;
  },
  onSessionEnd() {
    if (mode === 'screen') preview.stop();
    if (app.game && app.game.speed !== S.speed) {
      S.speed = app.game.speed;
      store.set('speed', S.speed);
    }
    app.game = null;
    mode = null;
    document.getElementById('menu').style.display = '';
    render();
  },
};

const xr = new XRPlay(app);
const preview = new PreviewPlay(app);

audio.onNote = (m, ago) => {
  if (app.game) app.game.noteHeard(m, ago);
  if (mode === 'screen') preview.heard(m);
};
audio.onHear = (m) => {
  stage.hearing = m;
};

// ------------------------------------------------------------ menu

const $ = (id) => document.getElementById(id);
let xrOk = false;
let listenTimer = null;
let listenId = null;

function toast(msg, ms = 4000) {
  const t = $('toast');
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.style.display = 'none'), ms);
}

function parts(song, twoHands) {
  const all = song.right.map((n) => ({ midi: n[0], beat: n[1], len: n[2] }));
  if (twoHands) for (const n of song.left) all.push({ midi: n[0], beat: n[1], len: n[2] });
  all.sort((a, b) => a.beat - b.beat || a.midi - b.midi);
  return all;
}

function stopListen() {
  if (listenTimer) clearInterval(listenTimer);
  listenTimer = null;
  listenId = null;
  audio.stopAll();
}

function listen(song) {
  stopListen();
  listenId = song.id;
  const ctx = audio.ensureCtx();
  const sec = 60 / (song.bpm * S.speed);
  const notes = parts(song, S.twoHands);
  const t0 = ctx.currentTime + 0.15;
  let end = 0;
  for (const n of notes) end = Math.max(end, n.beat + n.len);
  let i = 0;
  const pump = () => {
    const horizon = ctx.currentTime + 1.0;
    while (i < notes.length && t0 + notes[i].beat * sec < horizon) {
      audio.tone(notes[i].midi, t0 + notes[i].beat * sec, notes[i].len * sec);
      i++;
    }
    if (i >= notes.length && ctx.currentTime > t0 + end * sec + 0.4) {
      stopListen();
      renderSongs();
    }
  };
  pump();
  listenTimer = setInterval(pump, 200);
}

function setLevel(lv) {
  stopListen();
  S.level = lv;
  S.wait = store.get('wait_' + lv, lv === EASY);
  store.set('level', lv);
  render();
}

function render() {
  // level buttons
  const lv = $('levels');
  lv.innerHTML = '';
  LEVEL_NAMES.forEach((name, i) => {
    const b = document.createElement('button');
    b.textContent = name;
    b.className = 'lvl' + (i === S.level ? ' on' : '');
    b.style.setProperty('--c', LEVEL_COLORS[i]);
    b.onclick = () => setLevel(i);
    lv.appendChild(b);
  });
  $('wait').textContent = S.wait ? 'Wait for me: ON' : 'Wait for me: OFF';
  $('hands').textContent = S.twoHands ? '2 hands' : '1 hand';
  $('view').textContent = S.view === 'mr' ? 'Headset (mixed reality)' : 'Screen (practice)';
  $('input').textContent = S.input === 'tap' ? 'Tap the screen' : 'Real piano (mic)';
  $('inputRow').style.display = S.view === 'mr' ? 'none' : '';
  $('speedLabel').textContent = 'Speed: ' + S.speed.toFixed(2) + 'x';
  $('speed').value = Math.round((S.speed - 0.5) / 0.05);
  const needMic = !audio.micOk && (S.view === 'mr' || S.input === 'mic');
  $('micBar').style.display = needMic ? '' : 'none';
  const cal = loadCal();
  $('setupRow').style.display = S.view === 'mr' ? '' : 'none';
  $('setupState').textContent = cal ? 'Your piano is set up.' : 'Not set up yet. It takes 10 seconds.';
  renderSongs();
}

function renderSongs() {
  const list = $('songs');
  list.innerHTML = '';
  const head = document.createElement('h2');
  head.textContent = LEVEL_NAMES[S.level] + ' songs';
  list.appendChild(head);
  for (const s of SONGS.filter((x) => x.level === S.level)) {
    const row = document.createElement('div');
    row.className = 'song';
    const info = document.createElement('div');
    info.className = 'info';
    const st = store.get(starsKey(s.id, S.level, S.twoHands), 0);
    let stars = '';
    for (let i = 0; i < 3; i++) stars += i < st ? '★' : '☆';
    info.innerHTML = '<div class="t"></div><div class="s"></div>';
    info.querySelector('.t').textContent = s.title;
    info.querySelector('.s').textContent = stars + '   ' + s.right.length + ' notes' + (s.full ? '  • full song' : '');
    row.appendChild(info);
    const lb = document.createElement('button');
    lb.className = 'listen';
    lb.textContent = listenId === s.id ? 'Stop' : 'Listen';
    lb.onclick = () => {
      if (listenId === s.id) stopListen();
      else listen(s);
      renderSongs();
    };
    row.appendChild(lb);
    const pb = document.createElement('button');
    pb.className = 'play';
    pb.textContent = 'Play';
    pb.onclick = () => play(s);
    row.appendChild(pb);
    list.appendChild(row);
  }
  const note = document.createElement('p');
  note.className = 'note';
  note.textContent = S.level === 2
    ? 'Full songs use free public-domain sheet music from the Mutopia Project (mutopiaproject.org).'
    : 'Tip: "Wait for me" stops the song until you play the right key.';
  list.appendChild(note);
}

function enterMR(opts) {
  stopListen();
  audio.ensureCtx();
  mode = 'xr';
  // requestSession must run right now, inside the tap.
  xr.start(opts).then(() => {
    $('menu').style.display = 'none';
  }).catch((e) => {
    mode = null;
    $('menu').style.display = '';
    toast('Could not start mixed reality: ' + (e && e.message ? e.message : e), 7000);
  });
}

function play(song) {
  current = song;
  stopListen();
  if (S.view === 'mr') {
    if (!audio.micOk) {
      audio.startMic().then((ok) => {
        render();
        toast(ok ? 'The microphone is on. Press Play again.' : 'Cannot use the microphone. Allow it in the browser settings.', 6000);
      });
      return;
    }
    enterMR({ setupOnly: false, twoHands: S.twoHands });
    return;
  }
  const go = () => {
    mode = 'screen';
    $('menu').style.display = 'none';
    preview.start({ input: S.input, twoHands: S.twoHands });
  };
  if (S.input === 'mic' && !audio.micOk) {
    audio.startMic().then((ok) => {
      if (!ok) {
        S.input = 'tap';
        store.set('input', 'tap');
        toast('No microphone. Switched to tapping the screen keys.');
      }
      render();
      go();
    });
    return;
  }
  audio.ensureCtx();
  go();
}

function wire() {
  $('wait').onclick = () => {
    S.wait = !S.wait;
    store.set('wait_' + S.level, S.wait);
    render();
  };
  $('hands').onclick = () => {
    stopListen();
    S.twoHands = !S.twoHands;
    store.set('two_hands', S.twoHands);
    render();
  };
  $('view').onclick = () => {
    S.view = S.view === 'mr' ? 'screen' : 'mr';
    if (S.view === 'mr' && !xrOk) {
      S.view = 'screen';
      toast('Mixed reality needs the Meta Quest browser. Open this page on your Quest 3S.', 6000);
    }
    store.set('view', S.view);
    render();
  };
  $('input').onclick = () => {
    S.input = S.input === 'tap' ? 'mic' : 'tap';
    store.set('input', S.input);
    render();
  };
  $('speed').oninput = (e) => {
    S.speed = clampSpeed(0.5 + Number(e.target.value) * 0.05);
    $('speedLabel').textContent = 'Speed: ' + S.speed.toFixed(2) + 'x';
  };
  $('speed').onchange = () => store.set('speed', S.speed);
  $('micBtn').onclick = () => {
    audio.startMic().then((ok) => {
      render();
      toast(ok ? 'The microphone is on.' : 'Cannot use the microphone. Allow it in the browser settings.');
    });
  };
  $('setupBtn').onclick = () => {
    current = current || SONGS[0];
    enterMR({ setupOnly: true, twoHands: S.twoHands });
  };
  $('resetBtn').onclick = () => {
    localStorage.removeItem('psmr.cal.v1');
    toast('Piano setup removed. You will set it up again next time.');
    render();
  };
  $('ver').textContent = 'v' + VERSION;
}

async function boot() {
  wire();
  try {
    xrOk = !!(navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar')));
  } catch (e) {
    xrOk = false;
  }
  if (S.view == null || (S.view === 'mr' && !xrOk)) S.view = xrOk ? 'mr' : 'screen';
  $('device').textContent = xrOk
    ? 'Headset found. Mixed reality is ready.'
    : 'No headset found. You can practise in Screen mode.';
  render();
  window.__ps = { app, stage, xr, preview, audio, S, SONGS, play, enterMR };
}

boot();
