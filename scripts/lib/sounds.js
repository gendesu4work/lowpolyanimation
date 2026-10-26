// Soundtracks: the creator's library of free music and sound effects (soundtracks/files/<pack>/..., catalog in
// soundtracks/sounds.json). Claude names files from here in plan.json ("soundtrack", "sounds", scene "sfxFiles") and
// scripts/render.js mixes them into video.mp4.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const { P, readJson, writeJson } = require('./common');

const DIR = path.join(P.root, 'soundtracks'), FILES = path.join(DIR, 'files'), CATALOG = path.join(DIR, 'sounds.json');
const SUGGEST = path.join(P.root, 'data', 'sound-suggestions.json');
const AUDIO_EXT = ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.opus'];
// Sites a download may come from (direct audio files or zip packs). Everything else opens in the browser instead.
const FILE_HOSTS = /(^|\.)(kenney\.nl|opengameart\.org|assets\.mixkit\.co|mixkit\.co|cdn\.pixabay\.com|pixabay\.com|cdn\.freesound\.org|freesound\.org|incompetech\.com|archive\.org|us\.archive\.org|upload\.wikimedia\.org|raw\.githubusercontent\.com)$/i;
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ShortsStudio' };
const MAX = 400 * 1024 ** 2;
// Windows' own tar opens zips; a Git-Bash tar on PATH would read "C:" as a remote host.
const WIN_TAR = 'C:/Windows/System32/tar.exe';
const untar = (file, dir) => execFileSync(process.platform === 'win32' && fs.existsSync(WIN_TAR) ? WIN_TAR : 'tar', ['-xf', file, '-C', dir], { windowsHide: true });
const now = () => new Date().toISOString(), newId = () => crypto.randomBytes(5).toString('hex');
const slug = s => String(s || 'sounds').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'sounds';

const load = () => readJson(CATALOG, []);
function save(list) { fs.mkdirSync(DIR, { recursive: true }); writeJson(CATALOG, list); return list; }
const abs = s => path.join(FILES, s.file);

function duration(file) { try { return +(+execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { windowsHide: true }).toString()).toFixed(1) || null; } catch { return null; } }
function prettyName(file) { return path.basename(file, path.extname(file)).replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80); }
// Long files are music, short clips are sound effects, unless the creator said otherwise.
const guessKind = dur => (dur && dur >= 45 ? 'music' : 'sfx');

function register(file, { pack, kind, source, license, name }) {
  const dur = duration(file), list = load(), rel = path.relative(FILES, file).replace(/\\/g, '/');
  if (!dur) return null; // not playable audio
  if (list.some(x => x.file === rel)) return list.find(x => x.file === rel);
  const s = { id: newId(), name: String(name || prettyName(file)).slice(0, 80), pack, file: rel, kind: kind === 'music' || kind === 'sfx' ? kind : guessKind(dur), durationSec: dur, source: String(source || '').slice(0, 120), license: String(license || '').slice(0, 40), active: true, addedAt: now() };
  list.push(s); save(list); return s;
}
function packDir(name) { let pack = slug(name), n = 2; while (fs.existsSync(path.join(FILES, pack))) pack = slug(name) + '-' + n++; return pack; }

// Registers every audio file under dir (a zip pack, or one download).
function importDir(dir, pack, meta) {
  const found = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (AUDIO_EXT.includes(path.extname(e.name).toLowerCase())) found.push(p); } })(dir);
  if (!found.length) { fs.rmSync(dir, { recursive: true, force: true }); throw new Error('No audio files (.mp3, .wav, .ogg) inside.'); }
  const added = found.slice(0, 300).map(f => register(f, { ...meta, name: found.length === 1 ? meta.name : undefined, pack })).filter(Boolean); // a pack's files keep their own names
  if (!added.length) { fs.rmSync(dir, { recursive: true, force: true }); throw new Error('None of those files could be read as audio.'); }
  return { pack, added: added.length };
}

// An uploaded audio file or zip: the raw file is the request body.
function receive(req, name, meta) {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (![...AUDIO_EXT, '.zip'].includes(ext)) return Promise.reject(new Error('Use an audio file (.mp3, .wav, .ogg) or a .zip of them'));
  const pack = packDir(path.basename(name, ext)), dir = path.join(FILES, pack), file = path.join(dir, path.basename(String(name)));
  fs.mkdirSync(dir, { recursive: true });
  return new Promise((resolve, reject) => {
    let size = 0; const out = fs.createWriteStream(file);
    req.on('data', d => { size += d.length; if (size > MAX) { req.destroy(); out.destroy(); fs.rmSync(dir, { recursive: true, force: true }); reject(new Error('Files must be under 400 MB')); } });
    req.pipe(out); out.on('error', reject);
    out.on('finish', () => {
      try {
        if (ext === '.zip') { untar(file, dir); fs.unlinkSync(file); }
        resolve(importDir(dir, pack, meta));
      } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); reject(new Error(e.message.split('\n')[0])); }
    });
  });
}

// Downloads a suggested file (direct audio or zip) from an allowed site. onNote reports progress.
async function install(url, meta, onNote = () => {}) {
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  if (!/^https:\/\//i.test(url) || !FILE_HOSTS.test(host)) throw new Error("This site isn't set up for automatic download. Use Open page, download it, and drop the file here.");
  const r = await fetch(url, { headers: UA, redirect: 'follow' });
  if (!r.ok) throw new Error(`Download failed (${r.status}). Use Open page and download it yourself.`);
  if (!FILE_HOSTS.test(new URL(r.url).hostname)) throw new Error('The download went to an unexpected site.');
  const type = r.headers.get('content-type') || '';
  if (/text\/html/i.test(type)) throw new Error('That link is a web page, not a file. Use Open page and download it yourself.');
  const ext = path.extname(new URL(r.url).pathname).toLowerCase() || (/mpeg|mp3/.test(type) ? '.mp3' : /wav/.test(type) ? '.wav' : /ogg/.test(type) ? '.ogg' : /zip/.test(type) ? '.zip' : '');
  if (![...AUDIO_EXT, '.zip'].includes(ext)) throw new Error("That file isn't audio or a zip.");
  const pack = packDir(meta.name || path.basename(new URL(r.url).pathname, ext)), dir = path.join(FILES, pack), file = path.join(dir, (slug(meta.name) || 'sound') + ext);
  fs.mkdirSync(dir, { recursive: true });
  try {
    const out = fs.createWriteStream(file); let size = 0;
    for await (const chunk of r.body) {
      size += chunk.length;
      if (size > MAX) throw new Error('The file is over 400 MB.');
      if (!out.write(chunk)) await new Promise(res => out.once('drain', res));
      onNote(`Downloading ${(size / 1e6).toFixed(1)} MB`);
    }
    await new Promise(res => out.end(res));
    if (ext === '.zip') { onNote('Unpacking'); untar(file, dir); fs.unlinkSync(file); }
    onNote('Adding to your library');
    return importDir(dir, pack, meta);
  } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); throw e; }
}

function update(sid, f) {
  const list = load(), s = list.find(x => x.id === sid); if (!s) throw new Error('Sound not found');
  if (f.active != null) s.active = !!f.active;
  if (f.kind === 'music' || f.kind === 'sfx') s.kind = f.kind;
  if (f.name != null) { const n = String(f.name).trim().slice(0, 80); if (n) s.name = n; }
  return save(list);
}
function updatePack(pack, active) { const list = load(); for (const x of list) if (x.pack === pack) x.active = !!active; return save(list); }
function removePack(pack) { save(load().filter(s => s.pack !== pack)); fs.rmSync(path.join(FILES, path.basename(pack)), { recursive: true, force: true }); }
function removeSound(sid) {
  const list = load(), s = list.find(x => x.id === sid); if (!s) return;
  fs.rmSync(abs(s), { force: true }); save(list.filter(x => x.id !== sid));
  if (!list.some(x => x.pack === s.pack && x.id !== sid)) fs.rmSync(path.join(FILES, path.basename(s.pack)), { recursive: true, force: true });
}

// plan.json names a sound by its library name (or id); render.js resolves it to a file.
function resolve(ref, kind) {
  const q = String(ref || '').trim().toLowerCase(); if (!q) return null;
  const on = load().filter(s => s.active && (!kind || s.kind === kind));
  const s = on.find(x => x.id === q) || on.find(x => x.name.toLowerCase() === q) || on.find(x => x.name.toLowerCase().includes(q));
  return s ? { ...s, path: abs(s) } : null;
}

// What every animation reads (added to the Trainer brief).
function brief() {
  const on = load().filter(s => s.active);
  if (!on.length) return '';
  const row = s => `- "${s.name}" (${s.durationSec} s${s.license ? ', ' + s.license : ''})`;
  const music = on.filter(s => s.kind === 'music'), sfx = on.filter(s => s.kind === 'sfx');
  let md = `\n## Soundtracks: the creator's own sounds\n\nUse these instead of the built-in synth music/effects when one fits. In plan.json: \`"soundtrack": {"file": "<name>", "volume": 0.3}\` for background music (the engine music turns off by itself; it loops and fades out at the end) and \`"sfxFiles": [{"file": "<name>", "at": 1.5, "volume": 0.8}]\` on a scene for a sound effect (\`at\` = seconds into that scene). Names must match exactly. Pick music by mood and keep it quieter than the effects.\n`;
  if (music.length) md += '\nMusic:\n' + music.slice(0, 40).map(row).join('\n') + '\n';
  if (sfx.length) { // numbered variants (footstep 000-004) are listed once: the base name picks the first variant
    const groups = new Map();
    for (const x of sfx) { const base = x.name.replace(/\s*\d+$/, ''), g = groups.get(base) || { n: 0, s: x }; g.n++; groups.set(base, g); }
    md += '\nSound effects (a base name with a count has numbered variants; use the base name, or add the number for a specific one):\n' + [...groups].slice(0, 150).map(([b, g]) => `- "${b}"${g.n > 1 ? ' x' + g.n : ''} (${g.s.durationSec} s${g.s.license ? ', ' + g.s.license : ''})`).join('\n') + '\n';
  }
  return md;
}

function suggestPrompt() {
  const have = load().map(s => `${s.name} (${s.pack})`).slice(0, 60), prev = readJson(SUGGEST, { sounds: [] });
  const seen = prev.sounds.map(s => s.name);
  const vids = require('./common').listVideos().filter(v => v.meta.title).map(v => '- ' + (v.meta.headline || v.meta.title)).slice(0, 15);
  return `Help a creator of short vertical low-poly 3D "What if...?" animated videos (YouTube Shorts, TikTok, Instagram, Facebook; monetized) find FREE background music and sound effects.

Their videos so far:
${vids.join('\n') || '- none yet'}
Already in their library: ${have.join('; ') || 'nothing'}
Already suggested (do NOT suggest again): ${seen.join('; ') || 'none'}

Use web search and fetch the actual pages. Find 12 NEW items: about 6 background music tracks (epic, wonder, tense, calm, playful, sci-fi; loop-friendly, 60 to 150 s) and 6 sound packs or single effects useful for these videos (whooshes, impacts, booms, risers, UI blips, crowd, wind, explosions, space ambience). Only things that are free for commercial use on YouTube, TikTok, Instagram and Facebook without a Content ID claim risk: prefer CC0 and sites with a plain free license (Kenney audio packs, OpenGameArt CC0, Pixabay, Mixkit, Freesound CC0). CC-BY is allowed only if you say in "license" exactly what credit is needed (e.g. "CC-BY 4.0: credit Kevin MacLeod"). Never suggest anything from a commercial library, "royalty-free" sites that need an account, or anything you couldn't verify the license of on its page.

For each, open its page. Put the page address in "url". Put a direct download address in "download" ONLY if you saw it on the page and it is a plain https link to an .mp3, .wav, .ogg or .zip hosted on kenney.nl, opengameart.org, assets.mixkit.co, cdn.pixabay.com, cdn.freesound.org, incompetech.com or archive.org; otherwise null. Don't invent URLs.

Reply with only this JSON, no other text:
{"sounds": [{"name": "", "creator": "", "kind": "music or sfx", "license": "CC0, Pixabay License, Mixkit License, or CC-BY 4.0: credit ...", "url": "page", "download": "direct file or null", "mood": "short, e.g. epic, rising tension", "length": "e.g. 2:10 or 'pack of 60'", "why": "one sentence: how it would improve these videos"}]}`;
}

module.exports = { DIR, FILES, SUGGEST, AUDIO_EXT, FILE_HOSTS, load, save, register, receive, install, update, updatePack, removeSound, removePack, resolve, brief, suggestPrompt, abs, duration };
