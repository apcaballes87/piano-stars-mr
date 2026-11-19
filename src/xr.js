// Mixed reality mode for Meta Quest: passthrough, key setup, anchors, hands and the game.
import * as THREE from 'three';
import { CAL_LOW, CAL_HIGH, NOMINAL_OCTAVE } from './layout.js';
import { drawStar } from './panel.js';

const CAL_KEY = 'psmr.cal.v1';
const HOLD_TIME = 1.0; // seconds the finger must stay still on a key
const HOLD_MOVE = 0.012; // metres of allowed wobble

const FINGERS = ['thumb', 'index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
function chain(f) {
  if (f === 'thumb') return ['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'];
  return ['wrist', f + '-metacarpal', f + '-phalanx-proximal', f + '-phalanx-intermediate', f + '-phalanx-distal', f + '-tip'];
}
const BONES = [];
for (const f of FINGERS) {
  const c = chain(f);
  for (let i = 0; i + 1 < c.length; i++) BONES.push([c[i], c[i + 1]]);
}

export function loadCal() {
  try {
    return JSON.parse(localStorage.getItem(CAL_KEY) || 'null');
  } catch (e) {
    return null;
  }
}

function saveCal(cal) {
  try {
    localStorage.setItem(CAL_KEY, JSON.stringify(cal));
  } catch (e) {
    /* storage full or blocked */
  }
}

/** Invisible copies of the real hands, so blocks hide behind your fingers. */
class HandOccluder {
  constructor(hand) {
    this.hand = hand;
    this.mat = new THREE.MeshBasicMaterial({ colorWrite: false });
    this.sphereGeo = new THREE.SphereGeometry(1, 10, 8);
    this.cylGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    this.spheres = new Map();
    this.bones = BONES.map(() => {
      const m = new THREE.Mesh(this.cylGeo, this.mat);
      m.renderOrder = -10;
      m.visible = false;
      hand.add(m);
      return m;
    });
  }

  update() {
    const joints = this.hand.joints || {};
    for (const name in joints) {
      const j = joints[name];
      let s = this.spheres.get(name);
      if (!s) {
        s = new THREE.Mesh(this.sphereGeo, this.mat);
        s.renderOrder = -10;
        j.add(s);
        this.spheres.set(name, s);
      }
      const r = (j.jointRadius || 0.008) * 1.1;
      s.scale.setScalar(r);
      s.visible = j.visible;
    }
    const up = new THREE.Vector3(0, 1, 0);
    BONES.forEach(([a, b], i) => {
      const m = this.bones[i];
      const ja = joints[a];
      const jb = joints[b];
      if (!ja || !jb || !ja.visible || !jb.visible) {
        m.visible = false;
        return;
      }
      const d = new THREE.Vector3().subVectors(jb.position, ja.position);
      const len = d.length();
      if (len < 1e-4) {
        m.visible = false;
        return;
      }
      const r = Math.min(ja.jointRadius || 0.008, jb.jointRadius || 0.008) * 1.05;
      m.position.addVectors(ja.position, jb.position).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(up, d.divideScalar(len));
      m.scale.set(r, len, r);
      m.visible = true;
    });
  }
}

export class XRPlay {
  /**
   * app: {renderer, scene, stage, audio, makeGame(fx), onSessionEnd(result)}
   */
  constructor(app) {
    this.app = app;
    this.renderer = app.renderer;
    this.scene = app.scene;
    this.stage = app.stage;
    this.audio = app.audio;
    this.session = null;
    this.raycaster = new THREE.Raycaster();
    this.tmpM = new THREE.Matrix4();
    this.clock = 0;
    this.lastKeepAlive = 0;
    this.setupHands();
  }

  setupHands() {
    const r = this.renderer;
    this.hands = [];
    this.controllers = [];
    for (let i = 0; i < 2; i++) {
      const hand = r.xr.getHand(i);
      this.scene.add(hand);
      const occ = new HandOccluder(hand);
      const tipMark = new THREE.Mesh(
        new THREE.TorusGeometry(0.011, 0.0022, 8, 24),
        new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthTest: false }),
      );
      tipMark.renderOrder = 9;
      tipMark.visible = false;
      this.scene.add(tipMark);
      this.hands.push({ hand, occ, tipMark, hold: { pos: null, since: 0, sum: new THREE.Vector3(), n: 0 }, lastPoke: null, pokeAt: 0 });

      const ctrl = r.xr.getController(i);
      this.scene.add(ctrl);
      const info = { ctrl, source: null };
      ctrl.addEventListener('connected', (e) => (info.source = e.data));
      ctrl.addEventListener('disconnected', () => (info.source = null));
      ctrl.addEventListener('select', () => this.onSelect(info));
      // a short pointer line for controllers
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -0.4)]),
        new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 }),
      );
      line.visible = false;
      ctrl.add(line);
      info.line = line;
      this.controllers.push(info);
    }
    this.marks = [0, 1].map(() => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 8), new THREE.MeshBasicMaterial({ color: '#5BE38B' }));
      m.visible = false;
      this.scene.add(m);
      return m;
    });
  }

  /**
   * Must be called right inside a click (the browser needs a user tap to open the headset view).
   * opts: {song, level, wait, twoHands, speed, setupOnly}
   */
  start(opts) {
    this.opts = opts;
    const req = navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hand-tracking', 'anchors'],
    });
    return req.then((s) => this.begin(s));
  }

  async begin(session) {
    this.session = session;
    const r = this.renderer;
    r.xr.setReferenceSpaceType('local-floor');
    r.xr.setFoveation(0.5);
    await r.xr.setSession(session);
    this.refSpace = r.xr.getReferenceSpace();
    session.addEventListener('end', () => this.onEnd());
    session.addEventListener('visibilitychange', () => {
      if (this.game) this.game.paused = session.visibilityState !== 'visible';
    });
    this.anchor = null;
    this.anchorSeen = false;
    this.restoreStarted = null;
    this.game = null;
    this.result = null;
    this.message = '';
    this.points = [];
    this.stage.guide.mesh.visible = false;
    this.placeWanted = null;
    this.scene.add(this.stage.guide.mesh);
    this.stage.setVisibleMode('none');
    this.frameCount = 0;
    this.lastTime = null;
    r.setAnimationLoop((t, frame) => this.frame(t, frame));
    this.audio.keepAlive();

    const cal = loadCal();
    this.cal = cal;
    if (cal && cal.uuid && session.restorePersistentAnchor) {
      this.setState('restoring');
      try {
        const list = session.persistentAnchors ? Array.from(session.persistentAnchors) : null;
        if (list && !list.includes(cal.uuid)) throw new Error('anchor not in this room');
        this.anchor = await session.restorePersistentAnchor(cal.uuid);
        this.stage.baseOctave = cal.octave || NOMINAL_OCTAVE;
        this.stage.setAdjust(cal.adj || { dx: 0, dy: 0, dz: 0, s: 1 });
      } catch (e) {
        console.warn('restore anchor', e);
        this.anchor = null;
        this.setState('calib1');
      }
    } else {
      this.setState('calib1');
    }
  }

  end() {
    if (this.session) this.session.end();
  }

  onEnd() {
    this.renderer.setAnimationLoop(null);
    this.session = null;
    this.stage.guide.mesh.visible = false;
    this.stage.setVisibleMode('none');
    for (const h of this.hands) h.tipMark.visible = false;
    for (const m of this.marks) m.visible = false;
    const res = this.result;
    this.game = null;
    this.app.onSessionEnd(res);
  }

  // ------------------------------------------------------------ states

  setState(s) {
    this.state = s;
    this.message = '';
    const st = this.stage;
    for (const h of this.hands) h.hold.pos = null;
    if (s === 'calib1' || s === 'calib2') {
      st.setVisibleMode('none');
      if (s === 'calib1') {
        this.points = [];
        for (const m of this.marks) m.visible = false;
      }
      this.placeWanted = 'front';
    } else if (s === 'adjust' || s === 'check') {
      st.setVisibleMode('ghost');
      for (const m of this.marks) m.visible = false;
      this.placeWanted = 'keys';
    } else if (s === 'play') {
      st.guide.mesh.visible = false;
      this.placeWanted = null;
      this.startGame();
    } else if (s === 'restoring') {
      this.placeWanted = 'front';
    }
    st.guide.sig = null;
  }

  headPose() {
    const cam = this.renderer.xr.getCamera();
    const pos = new THREE.Vector3();
    const dir = new THREE.Vector3();
    cam.getWorldPosition(pos);
    cam.getWorldDirection(dir);
    return { pos, dir };
  }

  placeGuideInFront() {
    const { pos, dir } = this.headPose();
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    const m = this.stage.guide.mesh;
    m.position.copy(pos).addScaledVector(dir, 0.55);
    m.position.y -= 0.2;
    m.lookAt(pos);
    m.visible = true;
  }

  placeGuideOverKeys() {
    const st = this.stage;
    st.root.updateMatrixWorld(true);
    const [x0, x1] = st.layout.span(36, 83);
    const cx = Math.min(Math.max(st.layout.x(60), x0), x1);
    const local = new THREE.Vector3(cx, 0.3, -0.03);
    const world = st.content.localToWorld(local);
    const m = st.guide.mesh;
    m.position.copy(world);
    const { pos } = this.headPose();
    m.lookAt(pos);
    m.visible = true;
  }

  // ------------------------------------------------------------ game

  startGame() {
    const o = this.opts;
    this.audio.setMode(o.twoHands ? 'poly' : 'mono');
    this.game = this.app.makeGame();
    this.stage.setGame(this.game);
    this.stage.setVisibleMode('play');
    this.result = null;
  }

  // ------------------------------------------------------------ frame

  frame(t, frame) {
    const now = t / 1000;
    const dt = this.lastTime == null ? 0 : Math.max(0, Math.min(0.1, now - this.lastTime));
    this.lastTime = now;
    this.clock = now;
    this.frameCount++;
    if (frame && this.anchor) this.followAnchor(frame);
    if (this.state === 'restoring' && this.restoreStarted == null) this.restoreStarted = now;
    if (this.state === 'restoring' && now - this.restoreStarted > 6 && !this.anchorSeen) {
      this.anchor = null;
      this.setState('calib1');
    }
    // Place the setup panel only when the headset knows where you look.
    if (this.placeWanted && this.frameCount >= 3) {
      if (this.placeWanted === 'front') this.placeGuideInFront();
      else this.placeGuideOverKeys();
      this.placeWanted = null;
    }
    for (const h of this.hands) h.occ.update();
    const tips = this.fingertips();
    const st = this.state;
    if (st === 'calib1' || st === 'calib2') this.updateCalib(tips, now);
    else for (const h of this.hands) h.tipMark.visible = false;

    // pokes
    const panel = st === 'play' ? this.stage.hud : this.stage.guide;
    for (const tip of tips) {
      const h = this.hands[tip.i];
      const id = panel.poke(tip.pos);
      if (id && id !== h.lastPoke && now - h.pokeAt > 0.35) {
        h.pokeAt = now;
        this.press(id, panel);
      }
      h.lastPoke = id;
    }
    for (const c of this.controllers) c.line.visible = !!(c.source && !c.source.hand);

    if (now - this.lastKeepAlive > 1) {
      this.lastKeepAlive = now;
      this.audio.keepAlive();
    }
    if (st === 'play' && this.game) {
      this.game.update(dt);
      this.stage.update(dt, now);
      this.stage.drawHud(now, {
        input: 'mic',
        mic: this.audio.status(),
        level: this.audio.level,
        midi: this.app.midiCount() > 0,
      });
    } else {
      this.drawGuide(now);
    }
    this.renderer.render(this.scene, this.app.camera);
  }

  followAnchor(frame) {
    let pose = null;
    try {
      pose = frame.getPose(this.anchor.anchorSpace, this.refSpace);
    } catch (e) {
      pose = null;
    }
    if (!pose) return;
    this.tmpM.fromArray(pose.transform.matrix);
    const s = new THREE.Vector3();
    this.tmpM.decompose(this.stage.root.position, this.stage.root.quaternion, s);
    if (this.state === 'restoring') {
      this.anchorSeen = true;
      this.setState('check');
    }
  }

  fingertips() {
    const out = [];
    this.hands.forEach((h, i) => {
      const j = h.hand.joints && h.hand.joints['index-finger-tip'];
      if (j && j.visible) out.push({ i, pos: j.position.clone(), r: j.jointRadius || 0.008 });
    });
    return out;
  }

  // ------------------------------------------------------------ calibration

  updateCalib(tips, now) {
    const { pos: head, dir: gaze } = this.headPose();
    // Use only the fingertip you are looking at. A hand that rests on your lap
    // or on other keys must not count.
    let active = null;
    let bestAngle = THREE.MathUtils.degToRad(35);
    for (const tip of tips) {
      const v = new THREE.Vector3().subVectors(tip.pos, head);
      const d = v.length();
      if (d < 0.15 || d > 1.0) continue;
      const ang = v.angleTo(gaze);
      if (ang < bestAngle) {
        bestAngle = ang;
        active = tip;
      }
    }
    const seen = new Set();
    for (const tip of active ? [active] : []) {
      const h = this.hands[tip.i];
      seen.add(tip.i);
      const hold = h.hold;
      const below = head.y - tip.pos.y > 0.15; // keys are lower than the eyes
      if (!hold.pos || hold.pos.distanceTo(tip.pos) > HOLD_MOVE || !below) {
        hold.pos = tip.pos.clone();
        hold.since = now;
        hold.sum.set(0, 0, 0);
        hold.n = 0;
      }
      hold.sum.add(tip.pos);
      hold.n++;
      const p = below ? Math.min(1, (now - hold.since) / HOLD_TIME) : 0;
      h.tipMark.visible = true;
      h.tipMark.position.copy(tip.pos);
      h.tipMark.lookAt(head);
      h.tipMark.material.color.setRGB(1 - p, 1, 1 - p * 0.5);
      h.tipMark.scale.setScalar(1 + p * 0.8);
      if (p >= 1) {
        const avg = hold.sum.clone().divideScalar(hold.n);
        avg.y -= tip.r; // the key top is under the finger pad
        hold.pos = null;
        this.addPoint(avg);
        break;
      }
    }
    this.hands.forEach((h, i) => {
      if (!seen.has(i)) h.tipMark.visible = false;
    });
  }

  addPoint(p) {
    const now = this.clock;
    if (this.state === 'calib1') {
      this.points = [p];
      this.marks[0].position.copy(p);
      this.marks[0].visible = true;
      this.setState('calib2');
      this.pointAt = now;
      return;
    }
    if (this.state !== 'calib2' || now - this.pointAt < 0.8) return;
    const a = this.points[0];
    const dist = Math.hypot(p.x - a.x, p.z - a.z);
    if (dist < 0.08) return; // still on the first key
    this.marks[1].position.copy(p);
    this.marks[1].visible = true;
    if (dist < 0.25 || dist > 0.42) {
      this.setState('calib1');
      this.message = 'Those keys were ' + Math.round(dist * 100) + ' cm apart. Two octaves are about 33 cm. Please try again.';
      return;
    }
    this.finishCalib(a, p);
  }

  finishCalib(a, b) {
    const { pos: head } = this.headPose();
    const right = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    let toward = new THREE.Vector3().crossVectors(right, up); // x cross y = z (toward the player)
    let lo = a;
    let hi = b;
    if (toward.dot(new THREE.Vector3().subVectors(head, a)) < 0) {
      // The second key was on the left: swap so that x always points to the high notes.
      lo = b;
      hi = a;
      right.negate();
      toward = new THREE.Vector3().crossVectors(right, up);
    }
    const dist = Math.hypot(hi.x - lo.x, hi.z - lo.z);
    const origin = new THREE.Vector3(lo.x, (lo.y + hi.y) / 2, lo.z);
    const m = new THREE.Matrix4().makeBasis(right, up, toward);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const st = this.stage;
    st.root.position.copy(origin);
    st.root.quaternion.copy(q);
    st.baseOctave = dist / 2;
    st.setAdjust({ dx: 0, dy: 0, dz: 0, s: 1 });
    this.cal = { octave: dist / 2, adj: { dx: 0, dy: 0, dz: 0, s: 1 }, uuid: null };
    saveCal(this.cal);
    this.makeAnchor(origin, q);
    this.setState('adjust');
  }

  async makeAnchor(origin, q) {
    const frame = this.renderer.xr.getFrame();
    const old = loadCal();
    if (this.anchor && this.anchor.delete) {
      try {
        this.anchor.delete();
      } catch (e) {
        /* ignore */
      }
    }
    this.anchor = null;
    if (!frame || !frame.createAnchor) return;
    try {
      const pose = new XRRigidTransform({ x: origin.x, y: origin.y, z: origin.z }, { x: q.x, y: q.y, z: q.z, w: q.w });
      const anchor = await frame.createAnchor(pose, this.refSpace);
      this.anchor = anchor;
      if (anchor && anchor.requestPersistentHandle) {
        if (old && old.uuid && this.session.deletePersistentAnchor) {
          this.session.deletePersistentAnchor(old.uuid).catch(() => {});
        }
        const uuid = await anchor.requestPersistentHandle();
        this.cal.uuid = uuid;
        saveCal(this.cal);
      }
    } catch (e) {
      console.warn('anchor', e);
    }
  }

  nudge(key, delta) {
    const adj = { ...this.stage.adj };
    adj[key] = Math.round((adj[key] + delta) * 10000) / 10000;
    this.stage.setAdjust(adj);
    if (this.cal) {
      this.cal.adj = adj;
      saveCal(this.cal);
    }
  }

  // ------------------------------------------------------------ input

  onSelect(info) {
    if (!this.session) return;
    const c = info.ctrl;
    const src = info.source;
    const origin = new THREE.Vector3();
    const q = new THREE.Quaternion();
    c.getWorldPosition(origin);
    c.getWorldQuaternion(q);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    this.raycaster.set(origin, dir);
    const isHand = !!(src && src.hand);
    const panel = this.state === 'play' ? this.stage.hud : this.stage.guide;
    if (isHand && this.state === 'play') return; // a pinch while playing must not press buttons
    const hit = panel.ray(this.raycaster);
    if (hit && hit.id) {
      this.press(hit.id, panel);
      return;
    }
    if (!isHand && (this.state === 'calib1' || this.state === 'calib2')) {
      // controller: the tip of the controller marks the key
      const p = origin.clone();
      p.y -= 0.005;
      this.addPoint(p);
    }
  }

  press(id, panel) {
    panel.flash(id, this.clock);
    const g = this.game;
    if (this.state === 'play') {
      const a = this.stage.hudAction(id, g);
      if (a === 'restart' || a === 'again') {
        this.startGame();
      } else if (a === 'exit') {
        this.end();
      }
      return;
    }
    switch (id) {
      case 'cancel':
        this.end();
        break;
      case 'redo':
        this.setState('calib1');
        break;
      case 'play':
      case 'done':
        if (this.opts.setupOnly) this.end();
        else this.setState('play');
        break;
      case 'adjust':
        this.setState('adjust');
        break;
      case 'left':
        this.nudge('dx', -0.002);
        break;
      case 'right':
        this.nudge('dx', 0.002);
        break;
      case 'up':
        this.nudge('dy', 0.002);
        break;
      case 'down':
        this.nudge('dy', -0.002);
        break;
      case 'closer':
        this.nudge('dz', 0.003);
        break;
      case 'farther':
        this.nudge('dz', -0.003);
        break;
      case 'narrow':
        this.nudge('s', -0.003);
        break;
      case 'wide':
        this.nudge('s', 0.003);
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------ guide panel

  drawGuide(now) {
    const P = this.stage.guide;
    const st = this.state;
    const adj = this.stage.adj;
    const sig = [st, this.message, adj.dx, adj.dy, adj.dz, adj.s, this.opts.setupOnly].join('|');
    P.draw(sig, (c) => {
      const W = P.pxW;
      const H = P.pxH;
      P.card();
      if (st === 'restoring') {
        P.text('Finding your piano...', W / 2, H / 2 - 20, 54);
        P.text('Look at the piano keys.', W / 2, H / 2 + 50, 36, '#DCD8FF', 'center', false);
        return;
      }
      if (st === 'calib1' || st === 'calib2') {
        const second = st === 'calib2';
        P.text('Set up your piano (' + (second ? 2 : 1) + ' of 2)', 40, 52, 44, '#FFD23F', 'left');
        P.text(second ? 'Put your pointer finger on this C key:' : 'Put your pointer finger on this C key:', 40, 112, 34, '#FFFFFF', 'left', false);
        P.text(second ? 'one octave RIGHT of Middle C (C5).' : 'one octave LEFT of Middle C (C3).', 40, 156, 34, '#5BE38B', 'left', true);
        P.text('Touch the front of the key and hold still.', 40, 198, 30, '#DCD8FF', 'left', false);
        this.drawMiniPiano(c, 40, 250, W - 80, 165, second ? CAL_HIGH : CAL_LOW);
        if (this.message) P.text(this.message, W / 2, 440, 28, '#FFB3B3', 'center', true, W - 60);
        else P.text('With a controller: put its tip on the key and press the trigger.', W / 2, 440, 26, '#9C97CF', 'center', false);
        P.button('cancel', W - 230, 24, 190, 64, 'Cancel', '#3B3570', '#fff', 30);
        return;
      }
      if (st === 'check') {
        P.text('Welcome back!', W / 2, 60, 52, '#FFD23F');
        P.text('Do the coloured marks sit on your real keys?', W / 2, 130, 36, '#FFFFFF', 'center', false);
        P.text('Green = C3 and C5.  Yellow = Middle C.', W / 2, 180, 30, '#DCD8FF', 'center', false);
        P.button('play', 60, 250, 360, 110, this.opts.setupOnly ? 'Yes, done' : 'Yes, play!', '#5BE38B', '#15122E', 42);
        P.button('adjust', 440, 250, 280, 110, 'Adjust', '#4D9DE0', '#fff', 40);
        P.button('redo', 740, 250, 300, 110, 'Set up again', '#8C6BFF', '#fff', 38);
        P.button('cancel', 60, 390, 980, 70, 'Cancel', '#3B3570', '#fff', 30);
        return;
      }
      if (st === 'adjust') {
        P.text('Do the coloured marks sit on your keys?', W / 2, 46, 38, '#FFFFFF');
        P.text('If not, move them a little:', W / 2, 92, 30, '#DCD8FF', 'center', false);
        const bw = 150;
        const bh = 80;
        const row = (y, label, a, al, b, bl) => {
          P.text(label, 60, y + bh / 2, 32, '#DCD8FF', 'left', false);
          P.button(a, 290, y, bw, bh, al, '#3B3570', '#fff', 34);
          P.button(b, 290 + bw + 20, y, bw, bh, bl, '#3B3570', '#fff', 34);
        };
        row(122, 'Left / right', 'left', '◀', 'right', '▶');
        row(214, 'Up / down', 'up', '▲', 'down', '▼');
        row(306, 'Near / far', 'closer', 'Closer', 'farther', 'Farther');
        row(398, 'Key size', 'narrow', 'Smaller', 'wide', 'Bigger');
        P.button('done', 690, 140, 360, 140, this.opts.setupOnly ? 'Done ✓' : 'Play ✓', '#5BE38B', '#15122E', 46);
        P.button('redo', 690, 300, 360, 80, 'Set up again', '#8C6BFF', '#fff', 32);
        P.button('cancel', 690, 398, 360, 80, 'Cancel', '#3B3570', '#fff', 30);
      }
    }, now);
  }

  drawMiniPiano(c, x, y, w, h, target) {
    // C2..C6 drawn small, with Middle C and the target key marked
    const lo = 36;
    const hi = 84;
    const whites = [];
    for (let m = lo; m <= hi; m++) if (![1, 3, 6, 8, 10].includes(m % 12)) whites.push(m);
    const kw = w / whites.length;
    whites.forEach((m, i) => {
      c.fillStyle = m === target ? '#5BE38B' : m === 60 ? '#FFF3B0' : '#F4F4FA';
      c.fillRect(x + i * kw + 1, y, kw - 2, h);
      if (m % 12 === 0) {
        c.fillStyle = m === target ? '#15122E' : '#6E7194';
        c.font = 'bold ' + Math.round(kw * 0.45) + 'px system-ui, Roboto, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('C' + (Math.floor(m / 12) - 1), x + i * kw + kw / 2, y + h - 22);
      }
      if (m === target) drawStar(c, x + i * kw + kw / 2, y + h * 0.55, kw * 0.32, '#15122E');
    });
    for (let m = lo; m <= hi; m++) {
      if (![1, 3, 6, 8, 10].includes(m % 12)) continue;
      const i = whites.indexOf(m - 1);
      c.fillStyle = '#1A1A24';
      c.fillRect(x + (i + 1) * kw - kw * 0.3, y, kw * 0.6, h * 0.6);
    }
    c.fillStyle = '#FFD23F';
    c.font = 'bold 22px system-ui, Roboto, sans-serif';
    c.textAlign = 'center';
    const mi = whites.indexOf(60);
    c.fillText('Middle C', x + mi * kw + kw / 2, y - 14 + 0);
  }
}
