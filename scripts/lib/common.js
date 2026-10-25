// Shared paths, config, token storage and HTTP helpers.
const fs = require('fs'), path = require('path'), { execFile } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const P = {
  root: ROOT,
  config: path.join(ROOT, 'config.json'),
  tokens: path.join(ROOT, 'secrets', 'tokens.json'),
  state: path.join(ROOT, 'data', 'state.json'),
  lock: path.join(ROOT, 'data', 'scheduler.lock'),
  log: path.join(ROOT, 'data', 'activity.log'),
  videos: path.join(ROOT, 'videos'),
};

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' && fallback !== undefined) return fallback; throw e; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2));
  fs.renameSync(file + '.tmp', file);
}

function config() {
  if (!fs.existsSync(P.config)) throw new Error('config.json is missing: copy config.example.json to config.json and fill it in (see README.md)');
  return readJson(P.config);
}
// Which platforms are switched on in config.json, in posting order.
function enabledPlatforms(cfg = config()) {
  return ['youtube', 'facebook', 'instagram', 'tiktok'].filter(p => cfg.platforms[p] && cfg.platforms[p].enabled);
}

const tokens = {
  get(key) { return readJson(P.tokens, {})[key]; },
  set(key, value) { const t = readJson(P.tokens, {}); t[key] = value; writeJson(P.tokens, t); },
};

// fetch wrapper: parses JSON, throws on HTTP errors with the query string (tokens) stripped from the message.
async function api(url, opts = {}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let body; try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!r.ok) {
    const err = new Error(`${opts.method || 'GET'} ${url.split('?')[0]} -> ${r.status}: ${text.slice(0, 600)}`);
    err.status = r.status; err.body = body; throw err;
  }
  return { body, headers: r.headers };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function log(...args) {
  const line = new Date().toISOString() + ' ' + args.join(' ');
  console.log(line);
  fs.mkdirSync(path.dirname(P.log), { recursive: true });
  fs.appendFileSync(P.log, line + '\n');
}

// rundll32 hands the URL to the default browser without cmd.exe mangling the & characters.
function openBrowser(url) { execFile('rundll32', ['url.dll,FileProtocolHandler', url], () => {}); }

// Every video lives in videos/<folder>/ with meta.json beside page.html and video.mp4.
function listVideos() {
  if (!fs.existsSync(P.videos)) return [];
  return fs.readdirSync(P.videos, { withFileTypes: true })
    .filter(d => d.isDirectory() && fs.existsSync(path.join(P.videos, d.name, 'meta.json')))
    .map(d => { const dir = path.join(P.videos, d.name); return { dir, meta: readJson(path.join(dir, 'meta.json')) }; });
}
const saveMeta = (dir, meta) => writeJson(path.join(dir, 'meta.json'), meta);

// The post text for every platform: just the headline question plus a few hashtags, so nothing needs a tap on "more".
// (YouTube's title is set separately and its description stays short too, with #Shorts.)
const SHORT_TAGS = 4;
function captionFor(meta, platform) {
  const yt = platform === 'youtube';
  const tags = (meta.hashtags || []).filter(t => !/^#shorts$/i.test(t)).slice(0, SHORT_TAGS);
  if (yt) tags.push('#Shorts');
  return [meta.headline || meta.title, tags.join(' ')].filter(Boolean).join('\n\n');
}

module.exports = { P, readJson, writeJson, config, enabledPlatforms, tokens, api, sleep, log, openBrowser, listVideos, saveMeta, captionFor };
