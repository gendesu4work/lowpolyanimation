// Writes the Shorts Studio database documents the PC worker owns into data/studio/, ready to upload with ArtifactData:
//   data/studio/stats/accounts.json      -> stats/accounts
//   data/studio/videos/<folder>.json     -> videos/<folder>
// usage: node scripts/studio-sync.js        (prints one line per file)
const fs = require('fs'), path = require('path');
const { P, readJson, writeJson, listVideos } = require('./lib/common');
const { FILE: ACCOUNTS } = require('./accounts');

const OUT = path.join(P.root, 'data', 'studio');
fs.rmSync(OUT, { recursive: true, force: true });

const acc = readJson(ACCOUNTS, { latest: {}, history: [] });
const times = Object.values(acc.latest).map(a => a.at).filter(Boolean).sort();
writeJson(path.join(OUT, 'stats', 'accounts.json'), { updatedAt: times[times.length - 1] || null, latest: acc.latest, history: acc.history.slice(-180) });
console.log('stats/accounts', path.join(OUT, 'stats', 'accounts.json'));

// review until approved; once any platform has a result it's "posted" (or "failed" if every platform failed)
function stage(meta) {
  const st = Object.values(meta.platforms || {}).map(s => s.status);
  if (!st.length) return (meta.studio && meta.studio.stage) || 'review';
  if (st.every(s => s === 'failed')) return 'failed';
  return 'posted';
}

for (const { dir, meta } of listVideos()) {
  if (!meta.title) continue; // not finished yet
  const folder = path.basename(dir), s = meta.studio || {};
  writeJson(path.join(OUT, 'videos', folder + '.json'), {
    headline: meta.headline || meta.title, title: meta.title, description: meta.description || '', hashtags: meta.hashtags || [],
    stage: stage(meta), scheduledAt: meta.scheduledAt || null, ideaId: s.ideaId || null,
    previewUrl: s.previewUrl || null, posterUrl: s.posterUrl || null, durationSec: s.durationSec || null,
    platforms: Object.fromEntries(Object.entries(meta.platforms || {}).map(([p, x]) => [p, {
      status: x.status, url: x.url || null, views: x.stats ? x.stats.views : null, likes: x.stats && x.stats.likes != null ? x.stats.likes : null }])),
    createdAt: s.createdAt || meta.scheduledAt || fs.statSync(path.join(dir, 'meta.json')).birthtime.toISOString(),
    updatedAt: s.updatedAt || null,
  });
  console.log('videos/' + folder, path.join(OUT, 'videos', folder + '.json'));
}
