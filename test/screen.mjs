import { chromium } from 'playwright';
const errors = [];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto('http://localhost:8765/index.html');
await page.waitForTimeout(800);
await page.screenshot({ path: 'shots/menu.png' });
// screen mode, tap input
await page.evaluate(() => { localStorage.setItem('ps.input', '"tap"'); });
await page.reload(); await page.waitForTimeout(500);
const rows = await page.$$('.song');
await (await rows[0].$('.play')).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: 'shots/screen-ready.png' });
// wait until waiting for first note
await page.waitForFunction(() => window.__ps.app.game && window.__ps.app.game.waiting, null, { timeout: 15000 });
await page.waitForTimeout(400);
await page.screenshot({ path: 'shots/screen-wait.png' });
// click the right key on screen by projecting it
const clickKey = async () => page.evaluate(() => {
  const { app, stage, preview } = window.__ps; const g = app.game; const n = g.notes[g.nextIdx];
  const L = stage.layout; const THREE_V = stage.content.localToWorld(stage.content.position.clone().set(L.x(n.midi), L.topY(n.midi) + 0.004, L.landZ(n.midi)));
  const v = THREE_V.project(preview.camera);
  return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, midi: n.midi };
});
for (let i = 0; i < 5; i++) {
  await page.waitForFunction(() => window.__ps.app.game.waiting, null, { timeout: 10000 });
  const k = await clickKey();
  await page.mouse.click(k.x, k.y);
  await page.waitForTimeout(120);
  if (i === 2) await page.screenshot({ path: 'shots/screen-hit.png' });
}
const st = await page.evaluate(() => { const g = window.__ps.app.game; return { score: g.score, perfect: g.perfect, good: g.good, next: g.nextIdx }; });
console.log('after 5 taps', JSON.stringify(st));
// play the rest by feeding notes
await page.evaluate(async () => {
  const g = window.__ps.app.game;
  while (!g.finished) {
    if (g.waiting) g.noteHeard(g.notes[g.nextIdx].midi, 0);
    await new Promise((r) => setTimeout(r, 30));
  }
});
await page.waitForTimeout(500);
await page.screenshot({ path: 'shots/screen-result.png' });
// press "Songs" on the HUD by clicking the panel button
const btn = await page.evaluate(() => {
  const { stage, preview } = window.__ps; const P = stage.hud; const b = P.buttons.find((x) => x.id === 'exit');
  const lx = ((b.x + b.w / 2) / P.pxW - 0.5) * P.wM, ly = (0.5 - (b.y + b.h / 2) / P.pxH) * P.hM;
  const v = P.mesh.localToWorld(P.mesh.position.clone().set(lx, ly, 0)).project(preview.camera);
  return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
});
await page.mouse.click(btn.x, btn.y);
await page.waitForTimeout(500);
const back = await page.evaluate(() => document.getElementById('menu').style.display !== 'none' && document.querySelector('.song .s').textContent);
console.log('back at menu:', back);
// 2 hands + advanced full song quick look
await page.evaluate(() => { localStorage.setItem('ps.two_hands', 'true'); localStorage.setItem('ps.level', '2'); });
await page.reload(); await page.waitForTimeout(500);
const r2 = await page.$$('.song');
await (await r2[0].$('.play')).click();
await page.waitForTimeout(7500);
await page.screenshot({ path: 'shots/screen-2h.png' });
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
