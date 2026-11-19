import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto('http://localhost:8765/index.html');
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('ps.view', '"screen"'); localStorage.setItem('ps.input', '"tap"'); });
await page.reload(); await page.waitForTimeout(400);
const rows = await page.$$('.song'); await (await rows[2].$('.play')).click();
const sample = () => page.evaluate(() => { const s = window.__ps.stage; let live = 0, belowFloor = 0, black = 0;
  for (let i = 0; i < s.sparkN; i++) { const a = s.sparkCol[i * 4 + 3]; if (a > 0) { live++; if (s.sparkPos[i * 3 + 1] < s.sparkData[i].floor) belowFloor++; } }
  return { live, belowFloor }; });
let maxLive = 0, bad = 0;
for (let k = 0; k < 6; k++) {
  await page.waitForFunction(() => window.__ps.app.game.waiting, null, { timeout: 20000 });
  await page.evaluate(() => { const g = window.__ps.app.game; window.__ps.app.input(g.notes[g.nextIdx].midi, 0, 'tap'); });
  for (let t = 0; t < 6; t++) { await page.waitForTimeout(60); const s = await sample(); maxLive = Math.max(maxLive, s.live); bad += s.belowFloor; }
  if (k === 2) await page.screenshot({ path: 'shots/sparks.png' });
}
await page.waitForTimeout(1200);
const end = await sample();
console.log(JSON.stringify({ maxLive, belowFloorSamples: bad, liveAfter1s: end.live, errs }));
await browser.close();
