// Drives the export page in headless Chrome so frames render at full speed.
const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1200,2000'],
  });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('pageerror', e.message));
  await page.goto('http://localhost:8766/?from=' + (process.argv[2] || 0),{ waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__exportReady === true');
  const t0 = Date.now();
  await page.evaluate(() => { window.__err = null; window.__exportAll(+(new URLSearchParams(location.search).get('from')||0)).catch(e => window.__err = String(e)); });
  let last = -1;
  for (;;) {
    await new Promise(r => setTimeout(r, 3000));
    const s = await page.evaluate(() => ({ p: window.__prog, d: window.__done, e: window.__err }));
    if (s.p !== last) { console.log('frames', s.p, ((Date.now() - t0) / 1000).toFixed(0) + 's'); last = s.p; }
    if (s.d || s.e) { console.log(s.e ? 'error ' + s.e : 'done'); break; }
  }
  await browser.close();
})();
