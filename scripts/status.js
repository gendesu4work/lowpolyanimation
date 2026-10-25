// Lists every video with its time, per-platform status and views. usage: node scripts/status.js
const { config, listVideos } = require('./lib/common');
const { fmt } = require('./best-times');

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
let cfg; try { cfg = config(); } catch { cfg = null; }
const videos = listVideos().sort((a, b) => (a.meta.scheduledAt || '9').localeCompare(b.meta.scheduledAt || '9'));
if (!videos.length) console.log('No videos yet.');
for (const { dir, meta } of videos) {
  console.log(`${meta.headline || meta.title || require('path').basename(dir)}`);
  console.log(`  ${require('path').basename(dir)}  |  ${meta.scheduledAt ? fmt(Date.parse(meta.scheduledAt), tz) : 'not published'}`);
  for (const [p, s] of Object.entries(meta.platforms || {}))
    console.log(`  ${p.padEnd(9)} ${s.status.padEnd(9)} ${s.stats ? s.stats.views + ' views' : ''}${s.error ? ' ' + s.error.slice(0, 120) : ''}`);
}
if (!cfg) console.log('\n(config.json not set up yet: see README.md)');
