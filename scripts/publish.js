// Schedules one rendered video on every enabled platform.
// usage: node scripts/publish.js <video dir> [--now | --at 2026-10-25T18:00:00Z] [--dry-run]
//        node scripts/publish.js <video dir> --private   (YouTube test upload that stays private)
const fs = require('fs'), path = require('path');
const { config, enabledPlatforms, readJson, saveMeta, captionFor } = require('./lib/common');
const { REG, postTo, modeOf } = require('./lib/platforms');
const { nextSlot, fmt } = require('./best-times');

const args = process.argv.slice(2), flag = f => args.includes(f), opt = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const dir = path.resolve(args[0] || ''), dry = flag('--dry-run');

(async () => {
  const meta = readJson(path.join(dir, 'meta.json'));
  if (!fs.existsSync(path.join(dir, 'video.mp4'))) throw new Error('no video.mp4 in ' + dir + ': render it first');
  if (!meta.title || !meta.description) throw new Error('meta.json needs at least a title and a description');
  const cfg = config(), tz = cfg.audienceTimezone, mine = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // --private: a YouTube-only test upload that stays private and doesn't count as a real post
  if (flag('--private')) {
    const r = await REG.youtube().publish(path.join(dir, 'video.mp4'), meta, Date.now(), { privateOnly: true });
    meta.testUploads = [...(meta.testUploads || []), { platform: 'youtube', ...r, at: new Date().toISOString() }];
    saveMeta(dir, meta);
    return console.log(`youtube: private test uploaded ${r.url}\nStudio: https://studio.youtube.com/video/${r.id}/edit`);
  }

  if (!meta.scheduledAt || flag('--now') || opt('--at')) {
    const slot = flag('--now') ? { at: Date.now(), reason: 'posted immediately' }
      : opt('--at') ? { at: Date.parse(opt('--at')), reason: 'time set by hand' } : nextSlot();
    if (isNaN(slot.at)) throw new Error('could not read --at time');
    meta.scheduledAt = new Date(slot.at).toISOString(); meta.slotReason = slot.reason;
  }
  const at = Date.parse(meta.scheduledAt);
  console.log(`"${meta.title}"\nTime: ${fmt(at, tz)} = ${fmt(at, mine)} for you (${meta.slotReason})\n`);
  meta.platforms = meta.platforms || {};

  for (const p of enabledPlatforms(cfg)) {
    const st = (meta.platforms[p] || {}).status;
    if (st === 'posted' || st === 'scheduled' || st === 'private' || st === 'manual') { console.log(`${p}: already ${st}`); continue; }
    if (modeOf(p) === 'manual') { // you post this one yourself: keep the caption next to the video
      const cap = path.join(dir, 'post-yourself-' + p + '.txt');
      if (!dry) { fs.writeFileSync(cap, captionFor(meta, p)); meta.platforms[p] = { status: 'manual', caption: path.basename(cap) }; }
      console.log(p + ': post it yourself, using video.mp4 and ' + path.basename(cap) + ' in ' + dir);
      continue;
    }
    if (st === 'failed') meta.platforms[p].attempts = 0; // a manual run gets fresh attempts
    const now = REG[p]().nativeSchedule || at - Date.now() <= 5 * 60e3;
    if (dry) { console.log(`${p}: would ${now ? 'upload now' : 'queue for the scheduler'}`); continue; }
    if (now) {
      const r = await postTo(p, dir, meta);
      if (r.status === 'private') { console.log(`${p}: uploaded as private. Make it public at ${fmt(at, mine)} in Studio: ${r.studio}`); continue; }
      console.log(`${p}: ${r.status}${r.url ? ' ' + r.url : ''}${r.privacy && r.privacy !== 'PUBLIC_TO_EVERYONE' ? ' (privacy ' + r.privacy + ')' : ''}${r.error ? ' - ' + r.error : ''}`);
    } else {
      meta.platforms[p] = { status: 'queued' };
      console.log(`${p}: queued; the scheduler posts it at that time`);
    }
  }
  if (!dry) saveMeta(dir, meta);
})().catch(e => { console.error(e.message); process.exit(1); });
