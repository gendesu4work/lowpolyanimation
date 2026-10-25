// Puts a rendered video on a public HTTPS link (Buffer fetches it when the post goes out, possibly days later).
// Uses a Netlify site: each video is added to the site and the existing files are kept, so earlier links stay valid.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { config } = require('./common');

const NET = 'https://api.netlify.com/api/v1';

function settings() {
  const h = (config().platforms.buffer || {}).hosting;
  if (!h || !h.netlifyToken || !h.siteId || !h.siteUrl) throw new Error('Video hosting not set up: add platforms.buffer.hosting { netlifyToken, siteId, siteUrl } to config.json (see README.md)');
  return h;
}
async function net(h, p, opts = {}) {
  const r = await fetch(NET + p, { ...opts, headers: { Authorization: 'Bearer ' + h.netlifyToken, ...(opts.headers || {}) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`Netlify ${opts.method || 'GET'} ${p.split('?')[0]} -> ${r.status}: ${text.slice(0, 300)}`);
  try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
}

// Returns the public link, reusing it if this video was already uploaded.
async function hostVideo(file, meta) {
  const h = settings(), name = 'videos/' + path.basename(path.dirname(file)) + '.mp4';
  const url = h.siteUrl.replace(/\/$/, '') + '/' + name;
  if (meta.hostedUrl === url) return url;

  const buf = fs.readFileSync(file), sha = crypto.createHash('sha1').update(buf).digest('hex');
  const existing = await net(h, `/sites/${h.siteId}/files`);
  const files = Object.fromEntries(existing.map(f => [f.path.replace(/^\//, ''), f.sha]));
  files[name] = sha;
  const deploy = await net(h, `/sites/${h.siteId}/deploys`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files }) });
  if ((deploy.required || []).includes(sha))
    await net(h, `/deploys/${deploy.id}/files/${name}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: buf });
  for (let i = 0; i < 60; i++) {
    const d = await net(h, `/deploys/${deploy.id}`);
    if (d.state === 'ready') { meta.hostedUrl = url; return url; }
    if (d.state === 'error') throw new Error('Netlify deploy failed: ' + (d.error_message || 'unknown'));
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('Netlify deploy timed out');
}

module.exports = { hostVideo };
