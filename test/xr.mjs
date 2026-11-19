import { chromium } from 'playwright';
const errors = [];
const log = (...a) => console.log(...a);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.grantPermissions(['microphone']);
const page = await ctx.newPage();
page.on('console', (m) => { const t = m.text(); if ((m.type() === 'error' || m.type() === 'warning') && !t.includes('GPU stall')) errors.push(m.type() + ': ' + t); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto('http://localhost:8765/test.html');
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('ps.view', '"mr"'); });
await page.reload();
await page.waitForTimeout(800);
log('device:', await page.textContent('#device'));
await page.screenshot({ path: 'shots/xr-menu.png' });
// seated head pose, looking down at the keys
await page.evaluate(() => { const d = window.__dev; d.position.set(0, 1.15, 0.12); const a = -0.42; d.quaternion.set(Math.sin(a), 0, 0, Math.cos(a)); });
await page.click('#micBtn');
await page.waitForTimeout(800);
log('micOk:', await page.evaluate(() => window.__ps.audio.micOk));
await page.click('#setupBtn');
await page.waitForFunction(() => window.__ps.xr.state === 'calib1', null, { timeout: 8000 });
await page.evaluate(() => { const c = document.getElementById('gl'); c.style.display = 'block'; });
await page.waitForTimeout(500);
await page.screenshot({ path: 'shots/xr-calib1.png' });

const PIANO = { c3x: -0.165, y: 0.75, z: -0.36 };
// put the right index fingertip on a target point (key top + fingertip radius)
async function tipTo(tx, ty, tz) {
  await page.evaluate(() => { window.__dev.hands.right.poseId = 'point'; });
  for (let i = 0; i < 6; i++) {
    const tip = await page.evaluate(() => { const j = window.__ps.xr.hands.map((h) => h.hand.joints && h.hand.joints['index-finger-tip']).filter((j) => j && j.visible);
      const r = window.__ps.xr.hands.find((h) => h.hand.joints && h.hand.joints['index-finger-tip'] && h.hand.joints['index-finger-tip'].visible && h.hand.userData);
      const hand = window.__dev.hands.right; const hp = hand.position;
      // find the right hand group: compare to iwer right hand position
      let best = null, bd = 1e9; for (const jj of j) { const d = Math.hypot(jj.position.x - hp.x, jj.position.y - hp.y, jj.position.z - hp.z); if (d < bd) { bd = d; best = jj; } }
      return best ? { x: best.position.x, y: best.position.y, z: best.position.z, r: best.jointRadius, hx: hp.x, hy: hp.y, hz: hp.z } : null; });
    if (!tip) { await page.waitForTimeout(100); continue; }
    const dx = tx - tip.x, dy = ty - tip.y, dz = tz - tip.z;
    if (Math.hypot(dx, dy, dz) < 0.0015) return tip;
    await page.evaluate(([x, y, z]) => window.__dev.hands.right.position.set(x, y, z), [tip.hx + dx, tip.hy + dy, tip.hz + dz]);
    await page.waitForTimeout(80);
  }
  return null;
}
await page.evaluate(() => { window.__dev.hands.left.position.set(-0.5, 0.4, 0.3); });
let tip = await tipTo(PIANO.c3x, PIANO.y + 0.008, PIANO.z);
log('tip on C3:', JSON.stringify(tip));
await page.waitForTimeout(500);
await page.screenshot({ path: 'shots/xr-holding.png' });
await page.waitForFunction(() => window.__ps.xr.state === 'calib2', null, { timeout: 5000 });
log('state after C3 hold:', await page.evaluate(() => window.__ps.xr.state));
// move to C5 (2 octaves = 0.329 m to the right)
tip = await tipTo(PIANO.c3x + 0.329, PIANO.y + 0.008, PIANO.z);
log('tip C5:', JSON.stringify(tip)); await page.waitForTimeout(2500); log('dbg:', await page.evaluate(() => JSON.stringify({ s: window.__ps.xr.state, m: window.__ps.xr.message, pts: window.__ps.xr.points, holds: window.__ps.xr.hands.map(h => h.hold.pos && h.hold.pos.toArray()) }))); await page.waitForFunction(() => window.__ps.xr.state === 'adjust', null, { timeout: 6000 });
const cal = await page.evaluate(() => { const s = window.__ps.stage; return { pos: s.root.position.toArray().map((v) => +v.toFixed(4)), q: s.root.quaternion.toArray().map((v) => +v.toFixed(3)), oct: +s.layout.octave.toFixed(4), stored: localStorage.getItem('psmr.cal.v1') }; });
log('calibration:', JSON.stringify(cal));
// move hand away and add a virtual piano so the screenshot shows the alignment
await page.evaluate(() => { window.__dev.hands.right.position.set(0.5, 0.4, 0.3); window.__ps.preview.buildPiano(36, 84); });
// virtual piano is in the "real" place: undo the calibration offset so it marks where the real keys are
await page.waitForTimeout(700);
await page.screenshot({ path: 'shots/xr-adjust.png' });
// poke the "Done" button with the fingertip
const btn = await page.evaluate(() => { const P = window.__ps.stage.guide; const b = P.buttons.find((x) => x.id === 'done');
  const lx = ((b.x + b.w / 2) / P.pxW - 0.5) * P.wM, ly = (0.5 - (b.y + b.h / 2) / P.pxH) * P.hM;
  const front = P.mesh.localToWorld(P.mesh.position.clone().set(lx, ly, 0.05)); const on = P.mesh.localToWorld(P.mesh.position.clone().set(lx, ly, 0.0));
  return { front: front.toArray(), on: on.toArray() }; });
await tipTo(...btn.front);
await page.waitForTimeout(200);
await tipTo(...btn.on);
await page.waitForTimeout(600);
log('after poke Done -> session active?', await page.evaluate(() => !!window.__ps.xr.session), 'menu shown?', await page.evaluate(() => document.getElementById('menu').style.display !== 'none'));
await page.evaluate(() => { const g = window.__ps.preview; if (g.piano) { window.__ps.stage.content.remove(g.piano); g.piano = null; } });
log('setup text:', await page.textContent('#setupState'));

// ---- play a song in MR: should restore the saved anchor and ask "check"
await page.evaluate(() => { window.__dev.hands.right.position.set(0.5, 0.4, 0.3); });
const rows = await page.$$('.song');
await (await rows[3].$('.play')).click();  // Row Row Row Your Boat
await page.waitForFunction(() => ['check', 'calib1'].includes(window.__ps.xr.state), null, { timeout: 8000 });
log('state on new session:', await page.evaluate(() => window.__ps.xr.state));
await page.evaluate(() => { document.getElementById('gl').style.display = 'block'; });
await page.waitForTimeout(400);
await page.screenshot({ path: 'shots/xr-check.png' });
await page.evaluate(() => window.__ps.xr.press('play', window.__ps.stage.guide));
await page.waitForFunction(() => window.__ps.xr.state === 'play' && window.__ps.app.game, null, { timeout: 4000 });
await page.evaluate(() => window.__ps.preview.buildPiano(window.__ps.app.game.lowMidi, window.__ps.app.game.highMidi));
await page.waitForTimeout(1500);
log('g dbg:', await page.evaluate(() => { const g = window.__ps.app.game; return JSON.stringify({ st: g.songTime, p: g.paused, up: g.userPaused, w: g.waitMode, wt: g.waiting, f: g.finished, state: window.__ps.xr.state, vis: window.__ps.xr.session && window.__ps.xr.session.visibilityState, frames: window.__ps.xr.frameCount }); }));
await page.waitForFunction(() => window.__ps.app.game.waiting, null, { timeout: 45000 });
for (let i = 0; i < 4; i++) {
  await page.waitForFunction(() => window.__ps.app.game.waiting, null, { timeout: 30000 });
  await page.evaluate(() => { const g = window.__ps.app.game; g.noteHeard(g.notes[g.nextIdx].midi, 0); });
  await page.waitForTimeout(150);
}
await page.waitForTimeout(300);
await page.screenshot({ path: 'shots/xr-play.png' });
const gs = await page.evaluate(() => { const g = window.__ps.app.game; return { score: g.score, perfect: g.perfect, next: g.nextIdx, mode: window.__ps.audio.mode }; });
log('game:', JSON.stringify(gs));
// ---- finger tracking: press the next key with the fingertip (no mic event)
await page.waitForFunction(() => window.__ps.app.game.waiting, null, { timeout: 30000 });
const fk = await page.evaluate(() => { const { app, stage } = window.__ps; const g = app.game; const n = g.notes[g.nextIdx]; const L = stage.layout;
  const above = stage.content.localToWorld(stage.content.position.clone().set(L.x(n.midi), L.topY(n.midi) + 0.0066 + 0.02, L.landZ(n.midi)));
  const down = stage.content.localToWorld(stage.content.position.clone().set(L.x(n.midi), L.topY(n.midi) + 0.0066 - 0.006, L.landZ(n.midi)));
  return { midi: n.midi, above: above.toArray(), down: down.toArray(), perfect: g.perfect, next: g.nextIdx }; });
await tipTo(...fk.above);
await page.waitForTimeout(400);
await page.evaluate(([x, y, z]) => { const h = window.__dev.hands.right; h.position.y += (y - h.position.y); }, fk.down); // quick drop
await tipTo(...fk.down);
await page.waitForTimeout(400);
const after = await page.evaluate(() => { const g = window.__ps.app.game; return { perfect: g.perfect, next: g.nextIdx, pressed: window.__ps.stage.lastPress }; });
log('finger press (should not count now) on', fk.midi, 'before', JSON.stringify({ perfect: fk.perfect, next: fk.next }), 'after', JSON.stringify(after));
await page.screenshot({ path: 'shots/xr-finger.png' });
await tipTo(...fk.above);
await page.evaluate(() => { window.__dev.hands.right.position.set(0.5, 0.4, 0.3); });
log('hud mic status:', await page.evaluate(() => [window.__ps.audio.status(), window.__ps.audio.level.toFixed(4), window.__ps.audio.hops]));
// a wrong note in wait mode gives a hint
await page.waitForFunction(() => window.__ps.app.game.waiting, null, { timeout: 30000 });
await page.evaluate(() => { const g = window.__ps.app.game; g.noteHeard(g.notes[g.nextIdx].midi + 1, 0); });
await page.waitForTimeout(250);
log('hint:', await page.evaluate(() => window.__ps.app.game.hint));
await page.screenshot({ path: 'shots/xr-hint.png' });
// exit via HUD
await page.evaluate(() => window.__ps.xr.press('exit', window.__ps.stage.hud));
await page.waitForTimeout(500);
log('ended:', await page.evaluate(() => !window.__ps.xr.session));
log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
