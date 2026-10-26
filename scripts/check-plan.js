// Checks a scene plan before rendering: structure, timing, safe text lengths, and that every model word finds a
// model in the library. Instant and free. usage: node scripts/check-plan.js <video dir>
const path = require('path');
const { readJson } = require('./lib/common');
const { readPlan } = require('./lib/plan');
const R = require('../engine/resolve');

const dir = path.resolve(process.argv[2] || ''), errors = [], warns = [];
let plan;
try { plan = readPlan(path.join(dir, 'plan.json')); } catch (e) { console.log('ERROR plan.json: ' + e.message); process.exit(1); }
const lib = readJson(path.join(__dirname, '..', 'engine', 'library.json'), []);

const SETS = ['city', 'nature', 'interior', 'ocean', 'coast', 'seabed', 'space', 'globe', 'void'], TIMES = ['day', 'sunset', 'dawn', 'night'];
const PRESETS = ['street', 'wide', 'aerial', 'closeup', 'low', 'room', 'space', 'globe'], MOVES = ['pushIn', 'pullOut', 'orbit', 'pan', 'rise', 'drop', 'track'];
const SHAPES = ['earth', 'planet', 'moon', 'sun', 'blackhole', 'ship', 'wave', 'fish', 'kelp', 'crack', 'explosion', 'lightning', 'marker', 'rock', 'cloud', 'sphere', 'box', 'cylinder', 'cone', 'ring'];
const EFFECTS = ['lowGravity', 'shake', 'flash', 'darken', 'particles', 'fog', 'tint', 'slowmo', 'seaLevel', 'flood', 'wallApproach', 'storm', 'quake', 'impact'];
const SFX = ['whoosh', 'boom', 'chime', 'rumble', 'wind', 'siren', 'crowd', 'heartbeat', 'pop', 'thunder', 'jump'];
const LAYOUTS = ['crowd', 'scatter', 'row', 'grid', 'line', 'ring'];

if (!plan.title) errors.push('title is missing');
else if (plan.title.length > 70) warns.push('title is long (' + plan.title.length + ' chars); keep it under ~60');
if (plan.highlight && plan.title && !plan.title.toLowerCase().includes(String(plan.highlight).toLowerCase())) warns.push('highlight "' + plan.highlight + '" is not in the title');
if (!Array.isArray(plan.scenes) || !plan.scenes.length) errors.push('scenes must be a non-empty list');
if (!plan.counter) warns.push('no counter: the style uses one mid-left the whole video');
if (!plan.end || !plan.end.share) warns.push('end card has no share line');
{ // library sounds named in the plan must exist (Soundtracks tab)
  const sounds = require('./lib/sounds'), named = [];
  if (plan.soundtrack && plan.soundtrack.file) named.push(['soundtrack', plan.soundtrack.file, 'music']);
  for (const x of plan.sounds || []) named.push(['sounds', x.file, 'sfx']);
  (plan.scenes || []).forEach((s, i) => { for (const x of s.sfxFiles || []) named.push([`scene ${i + 1} sfxFiles`, x.file, 'sfx']); });
  for (const [where, file, kind] of named) if (!sounds.resolve(file, kind)) errors.push(`${where}: "${file}" is not in the Soundtracks library (use a name from the Trainer brief)`);
}

let total = 0; const used = new Map();
(plan.scenes || []).forEach((s, i) => {
  const at = `scene ${i + 1}`, dur = +s.dur || 0; total += dur;
  if (dur < 2 || dur > 12) warns.push(`${at}: dur ${dur}s (scenes are usually 4-7 s)`);
  const t = (s.set || {}).type;
  if (!SETS.includes(t)) errors.push(`${at}: set.type "${t}" (use ${SETS.join(', ')})`);
  if (s.set && s.set.time && !TIMES.includes(s.set.time)) errors.push(`${at}: set.time "${s.set.time}" (use ${TIMES.join(', ')})`);
  if (!s.caption) warns.push(`${at}: no caption`); else if (s.caption.length > 80) warns.push(`${at}: caption is ${s.caption.length} chars; it wraps to max 2 lines, keep it under ~60`);
  const c = s.camera || {};
  if (c.preset && !PRESETS.includes(c.preset)) errors.push(`${at}: camera.preset "${c.preset}" (use ${PRESETS.join(', ')})`);
  if (c.move && !MOVES.includes(c.move)) errors.push(`${at}: camera.move "${c.move}" (use ${MOVES.join(', ')})`);
  for (const [j, o] of (s.objects || []).entries()) {
    const ot = `${at} object ${j + 1}`;
    if (o.model) {
      const ms = R.pick(lib, o.model, Math.min(+o.variety || 4, +o.count || 1), { animated: !!o.animated });
      if (!ms.length) errors.push(`${ot}: no library model matches "${o.model}"${o.animated ? ' (animated only)' : ''}; try another word or a shape`);
      else {
        ms.forEach(m => used.set(m.name, (used.get(m.name) || 0) + 1));
        if (o.anim && !ms.some(m => (m.animations || []).some(a => a.toLowerCase().endsWith(String(o.anim).toLowerCase()) || a.toLowerCase().includes(String(o.anim).toLowerCase()))))
          warns.push(`${ot}: "${o.model}" has no "${o.anim}" animation (has: ${[...new Set(ms.flatMap(m => m.animations || []).map(a => a.split('_').pop()))].slice(0, 12).join(', ') || 'none'})`);
      }
    } else if (o.shape) { if (!SHAPES.includes(o.shape)) errors.push(`${ot}: shape "${o.shape}" (use ${SHAPES.join(', ')})`); }
    else errors.push(`${ot}: needs "model" or "shape"`);
    if (o.layout && !LAYOUTS.includes(o.layout)) errors.push(`${ot}: layout "${o.layout}" (use ${LAYOUTS.join(', ')})`);
    if (+o.count > 60) warns.push(`${ot}: count ${o.count} is heavy; about 30 keeps renders fast`);
  }
  for (const e of s.effects || []) if (!EFFECTS.includes(e.type)) errors.push(`${at}: effect "${e.type}" (use ${EFFECTS.join(', ')})`);
  for (const x of [].concat(s.sfx || [])) { const n = typeof x === 'string' ? x : x.type; if (!SFX.includes(n)) errors.push(`${at}: sfx "${n}" (use ${SFX.join(', ')})`); }
  if (s.custom && !require('fs').existsSync(path.join(dir, 'custom.js'))) errors.push(`${at}: custom "${s.custom}" but no custom.js`);
});
const endDur = plan.end === false ? 0 : +(plan.end && plan.end.dur) || 4.5;
if (total + endDur < 30 || total + endDur > 90) warns.push(`total length ${(total + endDur).toFixed(1)} s (aim for 45-85 s; Facebook rejects over 90 s)`);

for (const e of errors) console.log('ERROR ' + e);
for (const w of warns) console.log('warn  ' + w);
console.log(`${errors.length ? 'FIX THE ERRORS ABOVE' : 'plan ok'} · ${(plan.scenes || []).length} scenes · ${(total + endDur).toFixed(1)} s · library models: ${[...used.keys()].slice(0, 20).join(', ') || 'none'}`);
process.exit(errors.length ? 1 : 0);
