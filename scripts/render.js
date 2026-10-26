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

// Sounds from the Soundtracks library named in plan.json: "soundtrack" (looped, faded out), "sounds" (absolute times)
// and scene "sfxFiles" (seconds into the scene). They are mixed with the engine's own audio track (wav).
function soundMix(dur) {
  const none = { inputs: [], map: [] };
  if (!fs.existsSync(path.join(dir, 'plan.json'))) return none;
  const plan = require('./lib/plan').readPlan(path.join(dir, 'plan.json')), sounds = require('./lib/sounds'), items = [];
  const add = (ref, kind, at, volume) => { const f = sounds.resolve(ref, kind); if (f) items.push({ path: f.path, kind, at, volume }); else console.log('sound not found in your library, skipped: ' + ref); };
  if (plan.soundtrack && plan.soundtrack.file) add(plan.soundtrack.file, 'music', 0, plan.soundtrack.volume != null ? +plan.soundtrack.volume : 0.3);
  for (const x of plan.sounds || []) add(x.file, 'sfx', Math.max(0, +x.at || 0), x.volume != null ? +x.volume : 0.8);
  let t0 = 0;
  for (const sc of plan.scenes || []) { for (const x of sc.sfxFiles || []) add(x.file, 'sfx', t0 + Math.max(0, +x.at || 0), x.volume != null ? +x.volume : 0.8); t0 += +sc.dur || 0; }
  if (!items.length) return none;
  const f = ['[1:a]aresample=48000[b]'], names = ['[b]'];
  items.forEach((it, i) => {
    const n = i + 2, v = Math.max(0, Math.min(2, it.volume)).toFixed(2), tag = `[x${i}]`;
    if (it.kind === 'music') f.push(`[${n}:a]aresample=48000,aloop=loop=-1:size=2147483647,atrim=0:${dur.toFixed(2)},afade=t=in:d=1,afade=t=out:st=${Math.max(0, dur - 2.5).toFixed(2)}:d=2.5,volume=${v}${tag}`);
    else f.push(`[${n}:a]aresample=48000,volume=${v},adelay=${Math.round(it.at * 1000)}:all=1${tag}`);
    names.push(tag);
  });
  f.push(`${names.join('')}amix=inputs=${names.length}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[a]`);
  console.log(`mixing ${items.length} library sound${items.length === 1 ? '' : 's'}`);
  return { inputs: items.flatMap(it => ['-i', it.path]), map: ['-filter_complex', f.join(';'), '-map', '0:v', '-map', '[a]'] };
}

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
    const mix = soundMix(dur);
    ffmpeg(['-framerate', String(FPS), '-i', path.join(frames, 'f_%05d.jpg'), '-i', wav, ...mix.inputs, ...mix.map,
      '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '19', '-maxrate', '12M', '-bufsize', '24M',
      '-c:a', 'aac', '-ar', '48000', '-b:a', '192k', '-shortest', '-map_metadata', '-1', '-movflags', '+faststart', out]);
    fs.rmSync(frames, { recursive: true, force: true }); fs.unlinkSync(wav);
    console.log(`video ok ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB, ${dur}s)`);
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
