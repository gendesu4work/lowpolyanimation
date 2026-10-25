// Picks posting times from how past videos performed per hour of day (audience timezone), starting from sensible defaults.
// usage: node scripts/best-times.js           report + next slot
//        node scripts/best-times.js --ideas   past videos ranked by relative views
const { config, listVideos } = require('./lib/common');

const HOUR = 3600e3, MATURE = 48 * HOUR, PRIOR_WEIGHT = 2;

function tzParts(ms, tz) {
  const o = {};
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' }).formatToParts(ms))
    o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, min: +o.minute, wd: o.weekday };
}
// Wall-clock time in a timezone -> epoch ms (second pass handles DST changes).
function zoned(y, m, d, h, tz) {
  let t = Date.UTC(y, m - 1, d, h);
  for (let i = 0; i < 2; i++) { const p = tzParts(t, tz); t -= Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Date.UTC(y, m - 1, d, h); }
  return t;
}
const fmt = (ms, tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(ms);

// Each mature post scores its views relative to the median on each platform, averaged across platforms.
function postScores(videos, now) {
  const views = {};
  for (const { meta } of videos) for (const [p, s] of Object.entries(meta.platforms || {})) if (s.stats && s.stats.views > 0) (views[p] = views[p] || []).push(s.stats.views);
  const median = Object.fromEntries(Object.entries(views).map(([p, v]) => { v.sort((a, b) => a - b); return [p, v[Math.floor(v.length / 2)]]; }));
  return videos.flatMap(({ dir, meta }) => {
    const at = Date.parse(meta.scheduledAt);
    if (!at || now - at < MATURE) return [];
    const rel = Object.entries(meta.platforms || {}).filter(([p, s]) => s.stats && median[p]).map(([p, s]) => s.stats.views / median[p]);
    return rel.length ? [{ dir, meta, at, score: rel.reduce((a, b) => a + b, 0) / rel.length }] : [];
  });
}

function hourTable(cfg, scored) {
  return cfg.candidateHours.map(h => {
    const mine = scored.filter(s => tzParts(s.at, cfg.audienceTimezone).h === h);
    const prior = cfg.defaultHours.includes(h) ? 1.15 : 0.9;
    const sum = mine.reduce((a, s) => a + s.score, 0);
    return { hour: h, posts: mine.length, avg: mine.length ? sum / mine.length : null, score: (sum + prior * PRIOR_WEIGHT) / (mine.length + PRIOR_WEIGHT) };
  });
}

// Earliest open slot among the good hours (within 10% of the best), sometimes trying an under-tested hour instead.
function nextSlot({ now = Date.now(), rand = Math.random } = {}) {
  const cfg = config(), tz = cfg.audienceTimezone, videos = listVideos();
  const scored = postScores(videos, now), table = hourTable(cfg, scored);
  const best = Math.max(...table.map(r => r.score));
  let hours = table.filter(r => r.score >= best * 0.9), reason = scored.length ? 'best-performing hours' : 'default hours (no stats yet)';
  const untested = table.filter(r => r.posts < 3);
  if (untested.length && rand() < cfg.explore) {
    const pick = untested.sort((a, b) => a.posts - b.posts || b.score - a.score)[0];
    hours = [pick]; reason = `testing ${pick.hour}:00 (only ${pick.posts} posts so far)`;
  }
  const taken = videos.map(v => Date.parse(v.meta.scheduledAt)).filter(Boolean);
  const today = tzParts(now, tz);
  for (let day = 0; day < 60; day++) {
    const d = new Date(Date.UTC(today.y, today.m - 1, today.d + day));
    const [y, m, dd] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
    const sameDay = taken.filter(t => { const p = tzParts(t, tz); return p.y === y && p.m === m && p.d === dd; }).length;
    if (sameDay >= cfg.postsPerDay) continue;
    for (const { hour } of [...hours].sort((a, b) => a.hour - b.hour)) {
      const at = zoned(y, m, dd, hour, tz);
      if (at < now + 30 * 60e3) continue;
      if (taken.some(t => Math.abs(t - at) < cfg.minHoursBetweenPosts * HOUR)) continue;
      return { at, hour, reason };
    }
  }
  throw new Error('no free slot in the next 60 days: check postsPerDay / minHoursBetweenPosts in config.json');
}

if (require.main === module) {
  const cfg = config(), tz = cfg.audienceTimezone, now = Date.now(), videos = listVideos(), scored = postScores(videos, now);
  if (process.argv.includes('--ideas')) {
    if (!scored.length) console.log('No videos with 48h+ of stats yet.');
    for (const s of scored.sort((a, b) => b.score - a.score))
      console.log(`${s.score.toFixed(2)}x  ${s.meta.headline || s.meta.title}  (` + Object.entries(s.meta.platforms).map(([p, x]) => `${p} ${x.stats ? x.stats.views : '-'}`).join(', ') + ')');
  } else {
    console.log(`Audience timezone: ${tz}   (${scored.length} posts with 48h+ of stats)\n`);
    console.log('hour   posts  avg vs median  score');
    for (const r of hourTable(cfg, scored))
      console.log(`${String(r.hour).padStart(2)}:00  ${String(r.posts).padStart(5)}  ${r.avg == null ? '            -' : (r.avg.toFixed(2) + 'x').padStart(13)}  ${r.score.toFixed(2)}${cfg.defaultHours.includes(r.hour) ? '  (default)' : ''}`);
    const s = nextSlot({ rand: () => 1 });
    console.log(`\nNext slot: ${fmt(s.at, tz)}  =  ${fmt(s.at, Intl.DateTimeFormat().resolvedOptions().timeZone)} for you  (${s.reason})`);
  }
}

module.exports = { nextSlot, tzParts, zoned, fmt };
