// Platform registry and the shared "post this video to one platform" step used by publish.js and scheduler.js.
const path = require('path');
const { config, saveMeta, log, captionFor } = require('./common');

const OWN = {
  youtube: () => require('../platforms/youtube'),
  facebook: () => require('../platforms/meta'),
  instagram: () => require('../platforms/instagram'),
  tiktok: () => require('../platforms/tiktok'),
};
// Each platform has a mode in config.json: "own" (default; its own API), "buffer" (hand it to Buffer) or "manual" (you post it yourself).
const modeOf = p => { try { return ((config().platforms || {})[p] || {}).mode || 'own'; } catch { return 'own'; } };
const REG = Object.fromEntries(Object.keys(OWN).map(p => [p, () => modeOf(p) === 'buffer' ? require('../platforms/buffer').forPlatform(p, captionFor) : OWN[p]()]));
const MAX_ATTEMPTS = 3;

// Statuses: queued (waiting for its time) -> posted | scheduled (platform publishes it later) | private (uploaded; the user
// makes it public by hand) | retry -> failed after MAX_ATTEMPTS.
async function postTo(platform, dir, meta) {
  const attempts = ((meta.platforms[platform] || {}).attempts || 0) + 1;
  try {
    const r = await REG[platform]().publish(path.join(dir, 'video.mp4'), meta, Date.parse(meta.scheduledAt));
    meta.platforms[platform] = { status: r.draft ? 'draft' : r.private ? 'private' : r.scheduledFor ? 'scheduled' : 'posted', ...r, attempts, doneAt: new Date().toISOString() };
    log(`${platform} ${meta.platforms[platform].status}: "${meta.title}" ${r.url || r.id || r.publishId || ''}`);
  } catch (e) {
    meta.platforms[platform] = { status: attempts >= MAX_ATTEMPTS ? 'failed' : 'retry', error: e.message, attempts };
    log(`${platform} error (attempt ${attempts}/${MAX_ATTEMPTS}) "${meta.title}": ${e.message}`);
  }
  saveMeta(dir, meta);
  return meta.platforms[platform];
}

module.exports = { REG, postTo, modeOf };
