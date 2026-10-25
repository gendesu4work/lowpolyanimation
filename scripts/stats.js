// Pulls views/likes for every posted video into its meta.json. usage: node scripts/stats.js
const { enabledPlatforms, listVideos, saveMeta, log } = require('./lib/common');
const { REG } = require('./lib/platforms');

async function refreshStats() {
  const videos = listVideos(), now = Date.now();
  for (const p of enabledPlatforms()) {
    const live = videos.filter(({ meta }) => { const s = (meta.platforms || {})[p]; return s && s.id && (s.status === 'posted' || s.status === 'private' || (s.status === 'scheduled' && Date.parse(meta.scheduledAt) < now)); });
    if (!live.length) continue;
    let got;
    try { got = await REG[p]().stats(live.map(v => v.meta.platforms[p].id)); }
    catch (e) { log(`${p} stats skipped: ${e.message}`); continue; }
    for (const { dir, meta } of live) {
      const s = got[meta.platforms[p].id];
      if (!s) continue;
      meta.platforms[p].stats = { ...s, fetchedAt: new Date().toISOString() };
      if (meta.platforms[p].status === 'scheduled') meta.platforms[p].status = 'posted';
      if (meta.platforms[p].status === 'private' && s.privacy === 'public') meta.platforms[p].status = 'posted'; // made public by hand in YouTube Studio
      saveMeta(dir, meta);
    }
    console.log(`${p}: stats for ${Object.keys(got).length} videos`);
  }
}

// YouTube videos uploaded as private (manual publishing): notice when the user makes them public. One small API call.
async function checkYouTubePublished() {
  const waiting = listVideos().filter(({ meta }) => { const s = (meta.platforms || {}).youtube; return s && s.id && s.status === 'private'; });
  if (!waiting.length) return 0;
  const got = await REG.youtube().stats(waiting.map(v => v.meta.platforms.youtube.id));
  let n = 0;
  for (const { dir, meta } of waiting) {
    const s = got[meta.platforms.youtube.id];
    if (!s || s.privacy !== 'public') continue;
    meta.platforms.youtube.status = 'posted'; meta.platforms.youtube.stats = { ...s, fetchedAt: new Date().toISOString() };
    saveMeta(dir, meta); log(`youtube published: "${meta.title}"`); n++;
  }
  return n;
}

if (require.main === module) refreshStats().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { refreshStats, checkYouTubePublished };
