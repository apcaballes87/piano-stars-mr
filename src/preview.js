// Screen mode: a 3D piano on the screen with the same falling blocks.
// Good for practice on a tablet or computer, and for testing without the headset.
import * as THREE from 'three';
import { FRONT_Z, isBlack, WHITE_FRONT_DEPTH, BLACK_LEN, BLACK_H } from './layout.js';

export class PreviewPlay {
  constructor(app) {
    this.app = app;
    this.renderer = app.renderer;
    this.scene = app.scene;
    this.stage = app.stage;
    this.audio = app.audio;
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 20);
    this.raycaster = new THREE.Raycaster();
    this.piano = null;
    this.pressed = new Map();
    this.onPointer = (e) => this.pointer(e);
    this.onResize = () => this.resize();
  }

  start(opts) {
    this.opts = opts;
    const st = this.stage;
    st.root.position.set(0, 0, 0);
    st.root.quaternion.identity();
    st.baseOctave = 0.1645;
    st.setAdjust({ dx: 0, dy: 0, dz: 0, s: 1 });
    this.game = this.app.makeGame();
    st.setGame(this.game);
    st.setVisibleMode('play');
    this.buildPiano(this.game.lowMidi, this.game.highMidi);
    this.scene.background = new THREE.Color('#1B1840');
    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.addEventListener('pointerdown', this.onPointer);
    window.addEventListener('resize', this.onResize);
    this.resize();
    this.lastTime = null;
    if (opts.input === 'mic') this.audio.setMode(opts.twoHands ? 'poly' : 'mono');
    this.audio.keepAlive();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  stop() {
    this.renderer.setAnimationLoop(null);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointer);
    window.removeEventListener('resize', this.onResize);
    canvas.style.display = 'none';
    if (this.piano) {
      this.stage.content.remove(this.piano);
      this.piano = null;
    }
    this.scene.background = null;
    this.stage.setVisibleMode('none');
    this.game = null;
  }

  restart() {
    this.game = this.app.makeGame();
    this.stage.setGame(this.game);
    this.stage.setVisibleMode('play');
  }

  buildPiano(lo, hi) {
    if (this.piano) this.stage.content.remove(this.piano);
    const L = this.stage.layout;
    const g = new THREE.Group();
    // a few more keys on each side
    let a = lo;
    for (let k = 0; k < 3; k++) do a--; while (isBlack(a));
    let b = hi;
    for (let k = 0; k < 3; k++) do b++; while (isBlack(b));
    this.keyMeshes = [];
    const whiteMat = new THREE.MeshStandardMaterial({ color: '#F6F6FB', roughness: 0.5 });
    const blackMat = new THREE.MeshStandardMaterial({ color: '#1C1C26', roughness: 0.35 });
    const whiteLen = 0.15;
    for (let m = a; m <= b; m++) {
      const black = isBlack(m);
      const geo = black
        ? new THREE.BoxGeometry(L.blackW, 0.022, BLACK_LEN)
        : new THREE.BoxGeometry(L.white * 0.965, 0.02, whiteLen);
      const mesh = new THREE.Mesh(geo, black ? blackMat : whiteMat);
      if (black) mesh.position.set(L.x(m), BLACK_H - 0.011, FRONT_Z - WHITE_FRONT_DEPTH - BLACK_LEN / 2);
      else mesh.position.set(L.x(m), -0.01, FRONT_Z - whiteLen / 2);
      mesh.userData = { midi: m, baseY: mesh.position.y };
      g.add(mesh);
      this.keyMeshes.push(mesh);
    }
    const [x0, x1] = L.span(a, b);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(x1 - x0 + 0.08, 0.06, 0.26),
      new THREE.MeshStandardMaterial({ color: '#2A1E3D', roughness: 0.6 }),
    );
    body.position.set((x0 + x1) / 2, -0.05, FRONT_Z - 0.12);
    g.add(body);
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(x1 - x0 + 0.08, 0.12, 0.04),
      new THREE.MeshStandardMaterial({ color: '#2A1E3D', roughness: 0.6 }),
    );
    back.position.set((x0 + x1) / 2, 0.03, FRONT_Z - 0.19);
    g.add(back);
    g.add(new THREE.HemisphereLight('#ffffff', '#3a3360', 2.2));
    const dl = new THREE.DirectionalLight('#ffffff', 1.2);
    dl.position.set(0.2, 1, 0.6);
    g.add(dl);
    this.stage.content.add(g);
    this.piano = g;
    this.rangeX = [x0, x1];
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h;
    // frame the range and the HUD like a seated player
    const [x0, x1] = this.stage.rangeX;
    const cx = (x0 + x1) / 2;
    const width = (x1 - x0) * 1.12;
    const target = new THREE.Vector3(cx, 0.2, -0.04);
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const distW = width / 2 / Math.tan(hfov / 2);
    const distH = 0.62 / 2 / Math.tan(vfov / 2);
    const dist = Math.max(distW, distH);
    const dir = new THREE.Vector3(0, 0.55, 0.84).normalize();
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
  }

  pointer(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hud = this.stage.hud.ray(this.raycaster);
    if (hud && hud.id) {
      this.press(hud.id);
      return;
    }
    if (this.opts.input !== 'tap' || !this.keyMeshes) return;
    const hits = this.raycaster.intersectObjects(this.keyMeshes, false);
    if (!hits.length) return;
    // black keys sit on top: prefer them when both are hit
    let pick = hits[0].object;
    for (const hh of hits) if (isBlack(hh.object.userData.midi)) {
      pick = hh.object;
      break;
    }
    const m = pick.userData.midi;
    this.audio.tone(m);
    this.app.input(m, 0, 'tap');
  }

  keyDown(m) {
    this.pressed.set(m, 0.16);
  }

  /** A note was heard by the mic: show the key going down (folded into the range). */
  heard(m) {
    const g = this.game;
    if (!g) return;
    let k = m;
    while (k > g.highMidi) k -= 12;
    while (k < g.lowMidi) k += 12;
    this.keyDown(k);
  }

  press(id) {
    const now = this.lastTime || 0;
    this.stage.hud.flash(id, now);
    const a = this.stage.hudAction(id, this.game);
    if (a === 'restart' || a === 'again') this.restart();
    else if (a === 'exit') this.app.onSessionEnd(null);
  }

  frame(t) {
    const now = t / 1000;
    const dt = this.lastTime == null ? 0 : Math.max(0, Math.min(0.1, now - this.lastTime));
    this.lastTime = now;
    if (this.game) {
      this.game.update(dt);
      this.stage.update(dt, now);
      this.stage.drawHud(now, {
        input: this.opts.input,
        mic: this.audio.status(),
        level: this.audio.level,
        midi: this.app.midiCount() > 0,
      });
    }
    for (const mesh of this.keyMeshes || []) {
      const m = mesh.userData.midi;
      const left = this.pressed.get(m) || 0;
      mesh.position.y = mesh.userData.baseY - (left > 0 ? 0.004 : 0);
      if (left > 0) this.pressed.set(m, left - dt);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
