// Renders a page that exposes __frame(t) / __audio() in export mode.
// usage: node render2.js <page.html> <outdir> frames|audio|sample [t1,t2,...]
const puppeteer = require('puppeteer-core'), fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');
const [page_, out, mode, list] = process.argv.slice(2);
(async () => {
  fs.mkdirSync(path.join(out, 'frames'), { recursive: true });
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('pageerror', e.message));
  await page.goto(pathToFileURL(path.resolve(page_)).href + '?export=1', { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__ready === true', { timeout: 60000 });
  if (mode === 'audio') {
    const b64 = await page.evaluate(() => window.__audio());
    fs.writeFileSync(path.join(out, 'audio.wav'), Buffer.from(b64, 'base64'));
    console.log('audio ok');
  } else {
    const times = mode === 'sample' ? list.split(',').map(Number) : [...Array(Math.round((await page.evaluate('window.__dur||60'))*30)).keys()].map(i => i / 30);
    const t0 = Date.now();
    for (let i = 0; i < times.length; i++) {
      const b64 = await page.evaluate(t => window.__frame(t), times[i]);
      fs.writeFileSync(path.join(out, mode === 'sample' ? 's_' + i + '.jpg' : 'frames/f_' + String(i).padStart(5, '0') + '.jpg'), Buffer.from(b64, 'base64'));
      if (i % 300 === 0) console.log('frame', i, ((Date.now() - t0) / 1000).toFixed(0) + 's');
    }
    console.log('frames ok', times.length);
  }
  await browser.close();
})();
