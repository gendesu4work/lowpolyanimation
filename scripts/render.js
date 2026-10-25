// Renders a video folder's page.html to video.mp4 (or a 12-frame contact sheet with --sample).
// usage: node scripts/render.js <video dir> [--sample]
const puppeteer = require('puppeteer-core'), fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process'), { pathToFileURL } = require('url');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe', FPS = 30;
const dir = path.resolve(process.argv[2] || ''), sample = process.argv.includes('--sample');
const page_ = path.join(dir, 'page.html');
// scene-engine videos: page.html is generated from plan.json every time
if (fs.existsSync(path.join(dir, 'plan.json'))) require('./build-page').buildPage(dir);
if (!fs.existsSync(page_)) { console.error('no page.html or plan.json in ' + dir); process.exit(1); }

const ffmpeg = args => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 600000,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log('pageerror', e.message));
    // note every model file the page really loads, however its paths are built (for the app's "models used" check)
    await page.evaluateOnNewDocument(() => {
      window.__modelFiles = [];
      const note = u => { try { const s = decodeURIComponent(String(u)); if (/\.(glb|gltf)(\?|$)/i.test(s)) window.__modelFiles.push(s); } catch {} };
      const open = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (m, u) { note(u); return open.apply(this, arguments); };
      const f = window.fetch; window.fetch = function (u) { note(u && u.url || u); return f.apply(this, arguments); };
    });
    await page.goto(pathToFileURL(page_).href + '?export=1', { waitUntil: 'networkidle0', timeout: 120000 });
    await page.waitForFunction('window.__ready === true', { timeout: 60000 });
    const dur = await page.evaluate('window.__dur || 60');
    const loaded = await page.evaluate(() => [...new Set(window.__modelFiles || [])]);
    const rel = [...new Set(loaded.map(u => (u.match(/assets\/models\/(.+?\.(?:glb|gltf))/i) || [])[1]).filter(Boolean))];
    fs.writeFileSync(path.join(dir, 'models-used.json'), JSON.stringify(rel, null, 1));
    if (dur > 90) console.warn(`warning: ${dur}s is over Facebook Reels' 90 s limit`);
    const frame = t => page.evaluate(t => window.__frame(t), t).then(b64 => Buffer.from(b64, 'base64'));

    if (sample) {
      // 12 evenly spaced frames tiled 4x3 so the whole video can be checked in one image
      for (let i = 0; i < 12; i++) fs.writeFileSync(path.join(dir, `s_${i}.jpg`), await frame(dur * (i + 0.5) / 12));
      ffmpeg(['-i', path.join(dir, 's_%d.jpg'), '-vf', 'scale=270:480,tile=4x3', '-frames:v', '1', path.join(dir, 'sheet.jpg')]);
      for (let i = 0; i < 12; i++) fs.unlinkSync(path.join(dir, `s_${i}.jpg`));
      console.log('sheet ok', path.join(dir, 'sheet.jpg'));
      return;
    }

    const frames = path.join(dir, 'frames'), wav = path.join(dir, 'audio.wav'), out = path.join(dir, 'video.mp4');
    fs.rmSync(frames, { recursive: true, force: true }); fs.mkdirSync(frames);
    fs.writeFileSync(wav, Buffer.from(await page.evaluate(() => window.__audio()), 'base64'));
    console.log('audio ok');
    const n = Math.round(dur * FPS), t0 = Date.now();
    for (let i = 0; i < n; i++) {
      fs.writeFileSync(path.join(frames, 'f_' + String(i).padStart(5, '0') + '.jpg'), await frame(i / FPS));
      if (i % 300 === 0) console.log(`frame ${i}/${n} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    // H.264 high profile + 48 kHz AAC under 25 Mbps fits YouTube, TikTok, Facebook and Instagram specs
    ffmpeg(['-framerate', String(FPS), '-i', path.join(frames, 'f_%05d.jpg'), '-i', wav,
      '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '19', '-maxrate', '12M', '-bufsize', '24M',
      '-c:a', 'aac', '-ar', '48000', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out]);
    fs.rmSync(frames, { recursive: true, force: true }); fs.unlinkSync(wav);
    console.log(`video ok ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB, ${dur}s)`);
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
