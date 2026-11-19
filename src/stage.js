// Everything that is drawn on and above the real piano keys.
import * as THREE from 'three';
import { KeyLayout, FRONT_Z, isBlack, CAL_LOW, CAL_HIGH } from './layout.js';
import { PC_COLORS, NAMES, ADVANCED, EASY, PENDING, MISS, SKIP, HIT, MAX_SPEED, MIN_SPEED } from './game.js';
import { Panel, drawStar } from './panel.js';
import { meter } from './audio.js';

const FALL_H = 0.3; // blocks start this high above the keys (metres)
const DIM = new THREE.Color('#4A4E72');
const BLACK_C = new THREE.Color('#000000');
const WHITE_C = new THREE.Color('#FFFFFF');
const RED = '#FF6B6B';
const GHOST_LO = 36; // C2
const GHOST_HI = 84; // C6
const SPARK_LIFE = 0.55; // seconds

/** A soft round dot for the sparks. */
function dotTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.9)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function pcColor(m) {
  return new THREE.Color(PC_COLORS[((m % 12) + 12) % 12]);
}

/** A soft vertical light texture: bright at the bottom, clear at the top. */
function beamTexture() {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 128, 0, 0);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 8, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function letterTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.font = 'bold ' + (text.length > 1 ? 70 : 92) + 'px system-ui, Roboto, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(text, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function popTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  g.font = 'bold 84px system-ui, Roboto, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 12;
  g.strokeStyle = 'rgba(15,12,40,0.85)';
  g.strokeText(text, 256, 66);
  g.fillStyle = color;
  g.fillText(text, 256, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Stage {
  constructor() {
    this.layout = new KeyLayout();
    this.root = new THREE.Group(); // the keyboard frame (set from calibration / anchor)
    this.content = new THREE.Group(); // + fine-tune offset
    this.root.add(this.content);
    this.adj = { dx: 0, dy: 0, dz: 0, s: 1 };
    this.baseOctave = this.layout.octave;
    this.game = null;
    this.time = 0;

    this.beamTex = beamTexture();
    this.letterTex = NAMES.map((n) => letterTexture(n, 'rgba(26,21,48,0.92)'));
    this.popCache = new Map();

    // light bar where the blocks come from
    this.ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 0.006),
      new THREE.MeshBasicMaterial({ color: '#B9B3FF', transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.content.add(this.ceiling);

    this.buildGhost();
    this.buildPools();

    // HUD above the keys
    this.hud = new Panel(0.5, 0.17, 1200);
    this.content.add(this.hud.mesh);
    this.hud.mesh.visible = false;

    // guide panel (setup steps); placed by the app
    this.guide = new Panel(0.46, 0.25, 1100);
    this.guide.mesh.visible = false;

    this.setVisibleMode('none');
  }

  // ------------------------------------------------------------ calibration

  setAdjust(adj) {
    this.adj = { ...adj };
    this.content.position.set(adj.dx, adj.dy, adj.dz);
    this.layout.setOctave(this.baseOctave * adj.s);
    this.relayout();
  }

  setOctave(o) {
    this.baseOctave = o;
    this.layout.setOctave(o * this.adj.s);
    this.relayout();
  }

  relayout() {
    this.placeGhost();
    if (this.game) this.placeGameStatic();
  }

  // ------------------------------------------------------------ ghost keyboard (setup check)

  buildGhost() {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false });
    const n = GHOST_HI - GHOST_LO + 1;
    this.ghost = new THREE.InstancedMesh(geo, mat, n);
    this.ghost.renderOrder = 1;
    this.ghost.frustumCulled = false;
    this.content.add(this.ghost);
    this.ghostLabels = null;
    this.placeGhost();
  }

  placeGhost() {
    const L = this.layout;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let m = GHOST_LO; m <= GHOST_HI; m++) {
      const i = m - GHOST_LO;
      const [zf, zb] = L.lightZ(m);
      const w = L.keyW(m) * (isBlack(m) ? 0.9 : 0.86);
      const pos = new THREE.Vector3(L.x(m), L.topY(m) + 0.001, (zf + zb) / 2);
      m4.compose(pos, q, new THREE.Vector3(w, 1, Math.abs(zf - zb) * 0.96));
      this.ghost.setMatrixAt(i, m4);
      let col;
      if (m === CAL_LOW || m === CAL_HIGH) col = new THREE.Color('#5BE38B');
      else if (m === 60) col = new THREE.Color('#FFD23F');
      else col = isBlack(m) ? new THREE.Color('#6A50C9') : pcColor(m).lerp(WHITE_C, 0.55);
      this.ghost.setColorAt(i, col);
    }
    this.ghost.instanceMatrix.needsUpdate = true;
    if (this.ghost.instanceColor) this.ghost.instanceColor.needsUpdate = true;
    // labels under the ghost
    if (this.ghostLabels) {
      this.content.remove(this.ghostLabels);
      this.ghostLabels.geometry.dispose();
      this.ghostLabels.material.map.dispose();
    }
    this.ghostLabels = this.labelStrip(GHOST_LO, GHOST_HI, true, true);
    this.ghostLabels.visible = this.ghost.visible;
    this.content.add(this.ghostLabels);
  }

  /** A flat strip on the front of the white keys, with a coloured dot and a letter on each. */
  labelStrip(lo, hi, allNames, octaveNums) {
    const L = this.layout;
    const whites = [];
    for (let m = lo; m <= hi; m++) if (!isBlack(m)) whites.push(m);
    const pxPerKey = 64;
    const c = document.createElement('canvas');
    c.width = whites.length * pxPerKey;
    c.height = 96;
    const g = c.getContext('2d');
    whites.forEach((m, i) => {
      const cx = i * pxPerKey + pxPerKey / 2;
      g.fillStyle = PC_COLORS[m % 12];
      g.beginPath();
      g.arc(cx, 22, 11, 0, Math.PI * 2);
      g.fill();
      const isC = m % 12 === 0;
      if (isC || allNames || m === 60) {
        const label = isC && octaveNums ? 'C' + (Math.floor(m / 12) - 1) : NAMES[m % 12];
        g.font = (isC ? 'bold ' : '') + (isC ? 34 : 30) + 'px system-ui, Roboto, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = m === 60 ? '#FFD23F' : isC ? '#FFFFFF' : 'rgba(255,255,255,0.85)';
        g.lineWidth = 6;
        g.strokeStyle = 'rgba(20,17,46,0.8)';
        g.strokeText(label, cx, 66);
        g.fillText(label, cx, 66);
      }
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    const [x0] = L.span(whites[0], whites[0]);
    const [, x1] = L.span(whites[whites.length - 1], whites[whites.length - 1]);
    const depth = 0.024;
    const geo = new THREE.PlaneGeometry(x1 - x0, depth);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
    mesh.position.set((x0 + x1) / 2, 0.0015, FRONT_Z - depth / 2 - 0.001);
    mesh.renderOrder = 2;
    return mesh;
  }

  // ------------------------------------------------------------ pools

  buildPools() {
    this.blockGeo = new THREE.BoxGeometry(1, 1, 1);
    this.planeGeo = new THREE.PlaneGeometry(1, 1);
    this.blocks = [];
    this.blockGroup = new THREE.Group();
    this.content.add(this.blockGroup);

    this.beams = [];
    for (let i = 0; i < 10; i++) {
      const b = new THREE.Mesh(this.planeGeo, new THREE.MeshBasicMaterial({
        map: this.beamTex, transparent: true, depthWrite: false, opacity: 0.16, blending: THREE.AdditiveBlending,
      }));
      b.visible = false;
      b.renderOrder = 3;
      this.content.add(b);
      this.beams.push(b);
    }
    this.columns = [];
    for (let i = 0; i < 16; i++) {
      const b = new THREE.Mesh(this.planeGeo, new THREE.MeshBasicMaterial({
        map: this.beamTex, transparent: true, depthWrite: false, opacity: 0, blending: THREE.AdditiveBlending,
      }));
      b.visible = false;
      b.renderOrder = 3;
      b.userData = { age: 9, life: 0.45 };
      this.content.add(b);
      this.columns.push(b);
    }
    // sparks
    const N = 400;
    this.sparkN = N;
    this.sparkPos = new Float32Array(N * 3);
    // RGBA per spark: the alpha goes to 0, so a spark fades to clear (not to black).
    this.sparkCol = new Float32Array(N * 4);
    this.sparkData = Array.from({ length: N }, () => ({ age: 9, vx: 0, vy: 0, vz: 0, r: 0, g: 0, b: 0, floor: 0 }));
    this.sparkNext = 0;
    for (let i = 0; i < N; i++) this.sparkPos[i * 3 + 1] = -10; // parked out of sight
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 4));
    this.sparks = new THREE.Points(sg, new THREE.PointsMaterial({
      size: 0.006, map: dotTexture(), vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.NormalBlending,
    }));
    this.sparks.frustumCulled = false;
    this.sparks.renderOrder = 6;
    this.content.add(this.sparks);
    // text pops
    this.pops = [];
    for (let i = 0; i < 12; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false }));
      s.visible = false;
      s.renderOrder = 8;
      s.userData = { age: 9 };
      this.content.add(s);
      this.pops.push(s);
    }
  }

  getBlock(i) {
    while (this.blocks.length <= i) {
      const body = new THREE.Mesh(this.blockGeo, new THREE.MeshBasicMaterial({ color: '#ffffff' }));
      const edge = new THREE.Mesh(this.blockGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.BackSide }));
      const top = new THREE.Mesh(this.planeGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false }));
      const label = new THREE.Mesh(this.planeGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
      label.renderOrder = 4;
      top.renderOrder = 4;
      for (const o of [body, edge, top, label]) {
        o.visible = false;
        this.blockGroup.add(o);
      }
      this.blocks.push({ body, edge, top, label });
    }
    return this.blocks[i];
  }

  // ------------------------------------------------------------ modes

  /** 'none', 'ghost' (setup check), 'play' */
  setVisibleMode(mode) {
    this.mode = mode;
    const ghost = mode === 'ghost';
    this.ghost.visible = ghost;
    if (this.ghostLabels) this.ghostLabels.visible = ghost;
    const play = mode === 'play';
    this.ceiling.visible = play;
    this.blockGroup.visible = play;
    if (this.rangeLabels) this.rangeLabels.visible = play;
    if (this.keyLights) for (const k of this.keyLights.values()) k.visible = false;
    this.hud.mesh.visible = play;
    if (!play) {
      for (const b of this.beams) b.visible = false;
      for (const c of this.columns) c.visible = false;
    }
  }

  setGame(game) {
    this.game = game;
    this.keyFlash = new Float32Array(128);
    this.keyFlashColor = Array(128).fill(null);
    this.hearing = -1;
    this.lastPress = '';
    this.firstVis = 0;
    this.lastSongTime = -1e9;
    if (this.keyLights) for (const k of this.keyLights.values()) this.content.remove(k);
    this.keyLights = new Map();
    for (let m = game.lowMidi; m <= game.highMidi; m++) {
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.rotateX(-Math.PI / 2);
      const k = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0.6 }));
      k.renderOrder = 2;
      k.visible = false;
      this.content.add(k);
      this.keyLights.set(m, k);
    }
    this.placeGameStatic();
    for (const p of this.pops) p.visible = false;
    for (let i = 0; i < this.sparkN; i++) this.killSpark(i);
    this.sparks.geometry.attributes.position.needsUpdate = true;
    this.sparks.geometry.attributes.color.needsUpdate = true;
  }

  /** Things that only move when the calibration changes. */
  placeGameStatic() {
    const g = this.game;
    const L = this.layout;
    for (const [m, k] of this.keyLights) {
      const [zf, zb] = L.lightZ(m);
      k.position.set(L.x(m), L.topY(m) + 0.0025, (zf + zb) / 2);
      k.scale.set(L.keyW(m) * (isBlack(m) ? 0.95 : 0.9), 1, Math.abs(zf - zb));
    }
    if (this.rangeLabels) {
      this.content.remove(this.rangeLabels);
      this.rangeLabels.geometry.dispose();
      this.rangeLabels.material.map.dispose();
    }
    this.rangeLabels = this.labelStrip(g.lowMidi, g.highMidi, g.level === EASY, true);
    this.rangeLabels.visible = this.mode === 'play';
    this.content.add(this.rangeLabels);
    const [x0, x1] = L.span(g.lowMidi, g.highMidi);
    this.rangeX = [x0, x1];
    this.ceiling.position.set((x0 + x1) / 2, FALL_H, L.landZ(60));
    this.ceiling.scale.set(x1 - x0, 1, 1);
    // HUD above the middle of the range
    this.hud.mesh.position.set((x0 + x1) / 2, FALL_H + 0.105, -0.02);
    this.hud.mesh.rotation.set(-0.12, 0, 0);
  }

  // ------------------------------------------------------------ effects (called by the game)

  onHit(n, perfect) {
    const m = n.midi;
    const col = PC_COLORS[m % 12];
    this.flashKey(m, col);
    this.addColumn(m, col);
    const L = this.layout;
    const c = new THREE.Color(col);
    for (let i = 0; i < 14; i++) {
      const d = this.sparkData[this.sparkNext];
      const idx = this.sparkNext;
      this.sparkNext = (this.sparkNext + 1) % this.sparkN;
      d.age = 0;
      d.floor = L.topY(m) - 0.001;
      const white = Math.random() < 0.5;
      d.r = white ? 1 : c.r;
      d.g = white ? 1 : c.g;
      d.b = white ? 1 : c.b;
      this.sparkPos[idx * 3] = L.x(m) + (Math.random() - 0.5) * L.keyW(m);
      this.sparkPos[idx * 3 + 1] = L.topY(m) + 0.005;
      this.sparkPos[idx * 3 + 2] = L.landZ(m);
      d.vx = (Math.random() - 0.5) * 0.12;
      d.vy = 0.05 + Math.random() * 0.16;
      d.vz = (Math.random() - 0.5) * 0.05;
    }
    this.addPop(perfect ? 'Perfect!' : 'Good!', perfect ? '#FFE066' : '#8BE9FD', L.x(m), L.topY(m) + 0.05, L.landZ(m));
  }

  onMiss(n) {
    const L = this.layout;
    this.flashKey(n.midi, RED);
    this.addPop('Oops', '#B0B0C0', L.x(n.midi), L.topY(n.midi) + 0.05, L.landZ(n.midi));
  }

  onWrong(midi) {
    // flash the key that was played, if it is in our range (fold by octaves)
    const g = this.game;
    let m = midi;
    while (m > g.highMidi) m -= 12;
    while (m < g.lowMidi) m += 12;
    this.flashKey(m, RED);
  }

  onCombo(count) {
    const [x0, x1] = this.rangeX;
    this.addPop(count + ' in a row!', '#FF9FF3', (x0 + x1) / 2, FALL_H * 0.6, -0.02, 1.5);
  }

  killSpark(i) {
    this.sparkData[i].age = 9;
    this.sparkCol[i * 4 + 3] = 0;
    this.sparkPos[i * 3 + 1] = -10; // park it out of sight
  }

  flashKey(m, color) {
    if (m >= 0 && m < 128) {
      this.keyFlash[m] = 1;
      this.keyFlashColor[m] = color;
    }
  }

  addColumn(m, color) {
    const L = this.layout;
    const c = this.columns.find((x) => x.userData.age >= x.userData.life) || this.columns[0];
    c.userData.age = 0;
    c.userData.m = m;
    c.material.color.set(color);
    c.position.set(L.x(m), L.topY(m), L.landZ(m));
    c.userData.w = L.keyW(m) * 0.9;
    c.visible = true;
  }

  addPop(text, color, x, y, z, big = 1) {
    const key = text + '|' + color;
    let tex = this.popCache.get(key);
    if (!tex) {
      tex = popTexture(text, color);
      this.popCache.set(key, tex);
    }
    const p = this.pops.find((s) => s.userData.age > 0.9) || this.pops[0];
    p.material.map = tex;
    p.material.needsUpdate = true;
    p.userData = { age: 0, y, big };
    p.position.set(x, y, z);
    p.visible = true;
  }

  // ------------------------------------------------------------ per frame

  update(dt, now) {
    this.time = now;
    const g = this.game;
    if (this.mode !== 'play' || !g) return;
    const L = this.layout;
    const bps = g.bps();
    const mpb = FALL_H / (g.lookAhead * bps); // metres per beat
    const st = g.songTime;

    // --- blocks
    if (st < this.lastSongTime - 1e-6) this.firstVis = 0; // jumped back
    this.lastSongTime = st;
    const notes = g.notes;
    while (this.firstVis < notes.length && notes[this.firstVis].start < st - 16) this.firstVis++;
    let used = 0;
    const showLabels = (n) => g.level !== ADVANCED || n.state === PENDING;
    for (let i = this.firstVis; i < notes.length; i++) {
      const n = notes[i];
      const base = L.topY(n.midi);
      const bottom = (n.start - st) * mpb;
      if (bottom > FALL_H) break;
      if (n.state === HIT) continue;
      const full = (n.end - n.start) * mpb;
      const len = Math.max(full - 0.003, Math.min(0.02, Math.max(full * 0.85, 0.014)));
      const top = bottom + len;
      if (top <= 0) continue; // sank fully into the key
      const vb = Math.max(0, bottom);
      const vt = Math.min(top, FALL_H);
      if (vt - vb < 0.0015) continue;
      const black = isBlack(n.midi);
      const w = black ? L.blackW * 0.9 : Math.min(L.white * 0.62, 0.018);
      const d = black ? 0.012 : 0.014;
      const x = L.x(n.midi);
      const z = L.landZ(n.midi);
      const b = this.getBlock(used++);
      const dim = n.state === MISS || n.state === SKIP;
      const col = dim ? DIM.clone() : pcColor(n.midi);
      if (n.left && !dim) col.lerp(BLACK_C, 0.25);
      b.body.material.color.copy(col);
      b.body.position.set(x, base + (vb + vt) / 2, z);
      b.body.scale.set(w, vt - vb, d);
      b.body.visible = true;
      // light top band
      b.top.position.set(x, base + vt - Math.min((vt - vb) * 0.35, 0.006) / 2, z + d / 2 + 0.0004);
      b.top.scale.set(w * 0.86, Math.min((vt - vb) * 0.35, 0.006), 1);
      b.top.visible = !dim;
      // left hand: white border
      b.edge.visible = n.left && !dim;
      if (b.edge.visible) {
        b.edge.position.copy(b.body.position);
        b.edge.scale.set(w + 0.003, vt - vb + 0.003, d + 0.003);
      }
      // letter at the bottom of the block, facing the player
      const ls = w * 0.95;
      if (showLabels(n) && vt - vb > ls * 0.7) {
        b.label.material.map = this.letterTex[n.midi % 12];
        b.label.position.set(x, base + vb + Math.min(ls, vt - vb) / 2, z + d / 2 + 0.0006);
        b.label.scale.set(ls, Math.min(ls, vt - vb), 1);
        b.label.visible = true;
      } else {
        b.label.visible = false;
      }
    }
    for (let i = used; i < this.blocks.length; i++) {
      const b = this.blocks[i];
      if (!b.body.visible) break;
      b.body.visible = b.edge.visible = b.top.visible = b.label.visible = false;
    }

    // --- light beams over the next notes
    const next = g.nextGroup();
    for (let i = 0; i < this.beams.length; i++) {
      const bm = this.beams[i];
      const n = next[i];
      if (!n) {
        bm.visible = false;
        continue;
      }
      bm.visible = true;
      bm.material.color.set(PC_COLORS[n.midi % 12]);
      bm.position.set(L.x(n.midi), L.topY(n.midi) + FALL_H / 2, L.landZ(n.midi) - 0.008);
      bm.scale.set(L.keyW(n.midi) * 0.9, FALL_H, 1);
    }

    // --- key lights
    const glow = g.glowKeys();
    const pulse = 0.5 + 0.5 * Math.sin(now * 8);
    for (const [m, k] of this.keyLights) {
      const f = this.keyFlash[m];
      if (f > 0) this.keyFlash[m] = Math.max(0, f - dt * 3);
      if (f > 0) {
        k.visible = true;
        k.material.color.set(this.keyFlashColor[m]);
        k.material.opacity = 0.85 * f;
      } else if (glow.has(m)) {
        k.visible = true;
        k.material.color.set(PC_COLORS[m % 12]);
        k.material.opacity = (g.waiting ? 0.45 : 0.3) + 0.4 * pulse;
      } else {
        k.visible = false;
      }
    }

    this.updateFx(dt);
  }

  updateFx(dt) {
    const L = this.layout;
    for (const c of this.columns) {
      const u = c.userData;
      if (u.age >= u.life) {
        c.visible = false;
        continue;
      }
      u.age += dt;
      const a = Math.max(0, 1 - u.age / u.life);
      const h = 0.11 * (0.6 + 0.4 * a);
      c.scale.set(u.w, h, 1);
      c.position.y = L.topY(u.m) + h / 2;
      c.material.opacity = 0.75 * a;
    }
    let any = false;
    for (let i = 0; i < this.sparkN; i++) {
      const d = this.sparkData[i];
      if (d.age >= SPARK_LIFE) continue;
      any = true;
      d.age += dt;
      d.vy -= 0.25 * dt;
      this.sparkPos[i * 3] += d.vx * dt;
      this.sparkPos[i * 3 + 1] += d.vy * dt;
      this.sparkPos[i * 3 + 2] += d.vz * dt;
      // A spark ends when its time is up, or before it falls below the key top.
      if (d.age >= SPARK_LIFE || this.sparkPos[i * 3 + 1] < d.floor) {
        this.killSpark(i);
        continue;
      }
      const a = Math.pow(1 - d.age / SPARK_LIFE, 1.5);
      this.sparkCol[i * 4] = d.r;
      this.sparkCol[i * 4 + 1] = d.g;
      this.sparkCol[i * 4 + 2] = d.b;
      this.sparkCol[i * 4 + 3] = a;
    }
    if (any) {
      this.sparks.geometry.attributes.position.needsUpdate = true;
      this.sparks.geometry.attributes.color.needsUpdate = true;
    }
    for (const p of this.pops) {
      const u = p.userData;
      if (u.age > 0.9) {
        p.visible = false;
        continue;
      }
      u.age += dt;
      const big = u.big || 1;
      p.position.y = u.y + u.age * 0.045;
      p.scale.set(0.09 * big * (1 + u.age * 0.3), 0.0225 * big * (1 + u.age * 0.3), 1);
      p.material.opacity = Math.max(0, 1 - u.age / 0.9);
    }
  }

  // ------------------------------------------------------------ HUD

  drawHud(now, opts) {
    const g = this.game;
    if (!g || !this.hud.mesh.visible) return;
    const hear = this.hearing;
    const ct = g.centerText();
    const hint = g.hintAge < 2 ? g.hint : '';
    const prog = Math.round(g.progress() * 100);
    const lv = Math.round(meter(opts.level || 0) * 8);
    const sig = [g.finished, g.score, g.combo, hear, ct && ct.text, ct && ct.sub, hint, g.speed, g.userPaused, prog, opts.input, lv, opts.mic, opts.fingers, opts.midi, this.lastPress].join('|');
    this.hud.draw(sig, (c, P) => (g.finished ? this.drawResults(c, P) : this.drawPlayHud(c, P, ct, hint, prog, opts)), now, 0.1);
  }

  drawPlayHud(c, P, ct, hint, prog, opts) {
    const g = this.game;
    const W = P.pxW;
    P.card();
    // top row
    P.text(g.song.title, 36, 52, 40, '#FFFFFF', 'left', true, 370);
    P.text('Score ' + g.score + (g.combo >= 3 ? '  x' + g.combo : ''), W * 0.52, 52, 38, '#FFE066');
    if (opts.input === 'tap') {
      P.text('Tap keys', W - 36, 52, 32, '#B8B3E6', 'right', false);
    } else {
      const hm = this.hearing;
      const txt = hm >= 0 ? 'Hear: ' + NAMES[hm % 12] : 'Listening';
      c.font = 'bold 32px system-ui, Roboto, sans-serif';
      const tw = c.measureText(txt).width;
      c.fillStyle = hm >= 0 ? PC_COLORS[hm % 12] : '#4A4480';
      c.beginPath();
      c.arc(W - 36 - tw - 24, 52, 13, 0, Math.PI * 2);
      c.fill();
      P.text(txt, W - 36, 52, 32, '#FFFFFF', 'right', true);
    }
    // progress bar
    c.fillStyle = 'rgba(255,255,255,0.18)';
    c.fillRect(36, 92, W - 72, 10);
    c.fillStyle = '#3BCEAC';
    c.fillRect(36, 92, ((W - 72) * prog) / 100, 10);
    // what the game can hear and see
    if (opts.input !== 'tap') this.drawInputs(c, P, opts);
    // centre text
    if (ct) {
      P.text(ct.text, W / 2, 184, ct.text.length > 3 ? 64 : 84, ct.color);
      if (ct.sub) P.text(ct.sub, W / 2, 240, 28, '#DCD8FF', 'center', false);
    }
    if (hint) P.text(hint, W / 2, ct && ct.sub ? 268 : 246, 32, '#FFB3B3');
    // buttons
    const y = 296;
    const h = 84;
    P.button('pause', 36, y, 190, h, g.userPaused ? '▶ Play' : '❚❚ Pause', g.userPaused ? '#5BE38B' : '#3B3570', g.userPaused ? '#15122E' : '#fff', 34);
    P.button('back', 244, y, 170, h, '↺ Back', '#3B3570', '#fff', 34);
    P.button('slower', 432, y, 110, h, '−', '#3B3570', '#fff', 52);
    P.text(g.speed.toFixed(2) + 'x', 612, y + h / 2, 38, '#DCD8FF');
    P.button('faster', 682, y, 110, h, '+', '#3B3570', '#fff', 52);
    P.button('restart', 810, y, 170, h, 'Restart', '#4D9DE0', '#fff', 34);
    P.button('exit', 998, y, 166, h, 'Songs', '#8C6BFF', '#fff', 34);
  }

  /** Small status line: microphone level, finger tracking, USB piano, last key press. */
  drawInputs(c, P, opts) {
    const W = P.pxW;
    const y = 126;
    let x = W - 36;
    const parts = [];
    if (opts.midi) parts.push(['USB piano', '#5BE38B']);
    if (opts.fingers != null) parts.push([opts.fingers ? 'Fingers on' : 'Fingers off', opts.fingers ? '#5BE38B' : '#9C97CF']);
    if (this.lastPress) parts.push(['Pressed: ' + this.lastPress, '#FFFFFF']);
    c.font = '26px system-ui, Roboto, sans-serif';
    c.textAlign = 'right';
    c.textBaseline = 'middle';
    for (const [t, col] of parts.reverse()) {
      c.fillStyle = col;
      c.fillText(t, x, y);
      x -= c.measureText(t).width + 26;
    }
    // microphone: label + level bar
    const bw = 120;
    x -= bw;
    const m = meter(opts.level || 0);
    c.fillStyle = 'rgba(255,255,255,0.15)';
    c.fillRect(x, y - 9, bw, 18);
    c.fillStyle = opts.mic === 'ok' ? (m > 0.35 ? '#5BE38B' : '#FFD23F') : '#FF6B6B';
    c.fillRect(x, y - 9, bw * m, 18);
    const label = opts.mic === 'ok' ? 'Mic' : opts.mic === 'stalled' ? 'Mic: no sound data!' : opts.mic === 'muted' ? 'Mic muted!' : 'Mic off';
    c.fillStyle = opts.mic === 'ok' ? '#DCD8FF' : '#FF6B6B';
    c.fillText(label, x - 12, y);
  }

  /** Any detected key press: a short white flash on that key, and its name on the HUD. */
  onInput(midi) {
    const g = this.game;
    if (!g) return;
    let m = midi;
    while (m > g.highMidi) m -= 12;
    while (m < g.lowMidi) m += 12;
    if (this.keyFlash && this.keyFlash[m] < 0.4) this.flashKey(m, '#FFFFFF');
    this.lastPress = NAMES[midi % 12];
  }

  drawResults(c, P) {
    const g = this.game;
    const W = P.pxW;
    P.card('rgba(46,39,102,0.95)');
    const cheer = ['', 'Good try!', 'Great job!', 'Superstar!'][g.stars];
    P.text(cheer, W / 2, 56, 56, '#FFFFFF');
    for (let i = 0; i < 3; i++) drawStar(c, W / 2 + (i - 1) * 110, 140, 46, i < g.stars ? '#FFD23F' : '#4A4480');
    P.text('Perfect ' + g.perfect + '   Good ' + g.good + '   Missed ' + g.missed + '   Score ' + g.score, W / 2, 222, 32, '#DCD8FF', 'center', false);
    P.button('again', W / 2 - 330, 280, 310, 96, 'Play again', '#5BE38B', '#15122E', 40);
    P.button('exit', W / 2 + 20, 280, 310, 96, 'Songs', '#8C6BFF', '#fff', 40);
  }

  hudAction(id, g) {
    // shared HUD button rules; returns an action for the app or null
    if (!g) return null;
    if (id === 'pause') g.togglePause();
    else if (id === 'back') {
      g.seekTo(g.songTime - 2 * Math.max(0.5, g.song.barBeats));
      if (!g.userPaused) g.togglePause();
    } else if (id === 'slower') g.setSpeed(Math.max(MIN_SPEED, g.speed - 0.05));
    else if (id === 'faster') g.setSpeed(Math.min(MAX_SPEED, g.speed + 0.05));
    else return id; // restart, exit, again: the app handles these
    return 'changed';
  }
}

export { FALL_H };
