// Run every 15 minutes by Windows Task Scheduler: posts queued Instagram/TikTok uploads that are due, retries failures, refreshes stats every 6 hours.
const fs = require('fs');
const { P, readJson, writeJson, listVideos, log, config } = require('./lib/common');
const { postTo } = require('./lib/platforms');
const { refreshStats, checkYouTubePublished } = require('./stats');
const { refreshAccounts } = require('./accounts');

const STATS_EVERY = 6 * 3600e3, STALE_LOCK = 60 * 60e3;

(async () => {
  fs.mkdirSync(require('path').dirname(P.lock), { recursive: true });
  // one run at a time; a lock older than an hour is from a crashed run
  if (fs.existsSync(P.lock) && Date.now() - fs.statSync(P.lock).mtimeMs < STALE_LOCK) return;
  fs.writeFileSync(P.lock, String(process.pid));
  try {
    for (const { dir, meta } of listVideos()) {
      if (Date.parse(meta.scheduledAt) > Date.now() + 60e3) continue;
      for (const [p, s] of Object.entries(meta.platforms || {}))
        if (s.status === 'queued' || s.status === 'retry') await postTo(p, dir, meta);
    }
    try { if ((config().platforms.buffer || {}).apiKey) await require('./platforms/buffer').syncPosts(listVideos()); } catch (e) { log('buffer sync skipped: ' + e.message); }
    try { await checkYouTubePublished(); } catch (e) { log('youtube publish check skipped: ' + e.message); }
    const state = readJson(P.state, {});
    if (!state.lastStats || Date.now() - state.lastStats > STATS_EVERY) {
      await refreshStats();
      await refreshAccounts();
      writeJson(P.state, { ...state, lastStats: Date.now() });
    }
  } catch (e) {
    log('scheduler error: ' + e.message);
  } finally {
    fs.unlinkSync(P.lock);
  }
})();
