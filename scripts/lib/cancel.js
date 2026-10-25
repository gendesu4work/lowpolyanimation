// Cancels posts that are scheduled but haven't gone out yet, on whichever service holds them.
// Only a post whose time is still in the future can be cancelled: a post that already went out is never touched.
const { config, tokens, api, saveMeta, log } = require('./common');

const MIN_AHEAD = 60e3;
const pending = s => s && (s.status === 'queued' || s.status === 'retry' || (s.status === 'scheduled' && Date.parse(s.scheduledFor || 0) > Date.now() + MIN_AHEAD));

async function cancelOne(platform, s) {
  if (s.status === 'queued' || s.status === 'retry') return; // waiting in this app only: nothing to delete elsewhere
  if (s.via === 'buffer') {
    const { lit } = require('../platforms/buffer');
    const key = (config().platforms.buffer || {}).apiKey;
    const { body } = await api('https://api.buffer.com', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ query: `mutation { deletePost(input: { id: ${lit(s.id)} }) { ... on DeletePostSuccess { id } ... on VoidMutationError { message } } }` }) });
    const r = body.data && body.data.deletePost;
    if ((body.errors && body.errors.length) || !r || r.message) throw new Error('Buffer: ' + ((body.errors && body.errors[0].message) || (r && r.message) || 'could not delete the post'));
    return;
  }
  if (platform === 'facebook') {
    const t = tokens.get('meta');
    await api(`https://graph.facebook.com/${config().platforms.meta.graphVersion || 'v23.0'}/${s.id}?` + new URLSearchParams({ access_token: t.page_token }), { method: 'DELETE' });
    return;
  }
  if (platform === 'youtube') {
    const token = await require('../platforms/youtube').access();
    await api('https://www.googleapis.com/youtube/v3/videos?id=' + encodeURIComponent(s.id), { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
    return;
  }
  throw new Error(`${platform} posts can't be cancelled from here`);
}

// Cancels every still-pending platform of one video. Returns { cancelled: [...], failed: { platform: message } }.
async function cancelScheduled(dir, meta) {
  const out = { cancelled: [], failed: {} };
  for (const [p, s] of Object.entries(meta.platforms || {})) {
    if (!pending(s)) continue;
    try {
      await cancelOne(p, s);
      meta.platforms[p] = { status: 'cancelled', cancelledAt: new Date().toISOString() };
      out.cancelled.push(p); log(`${p} cancelled: "${meta.title}"`);
    } catch (e) { out.failed[p] = e.message.slice(0, 200); log(`${p} cancel failed: ${e.message.slice(0, 200)}`); }
  }
  if (out.cancelled.length) { if (Object.values(meta.platforms).every(s => s.status === 'cancelled')) delete meta.scheduledAt; saveMeta(dir, meta); }
  return out;
}

module.exports = { cancelScheduled, pending };
