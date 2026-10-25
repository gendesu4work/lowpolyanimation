// Shorts Studio, the local app: ideas → animate (Claude on this PC) → review → post, plus the dashboard.
// usage: npm run app        → http://localhost:8800   (add --lan to also open it from other devices on your Wi-Fi)
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const { P, readJson, writeJson, listVideos, saveMeta, openBrowser, log, tokens } = require('./lib/common');
const claude = require('./lib/claude');
const trainer = require('./lib/trainer');
const comments = require('./comments');
const models = require('./lib/models');
const SUGGEST = path.join(P.root, 'data', 'suggestions.json');

// A suggestion counts as installed when every distinctive word of its name appears in an installed pack's
// folder name or source note (e.g. "City Kit (Commercial)" matches kenney_city-kit-commercial_2.1.zip).
const GENERIC = new Set(['kit', 'pack', 'the', 'free', 'tier', 'and', 'of', 'set', 'bundle', 'collection', 'models', 'model', 'low', 'poly', 'lowpoly', '3d']);
const words = s => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w && !GENERIC.has(w));
// Kenney's downloads carry "kenney" in the file name, so a Kenney suggestion needs it and anything else must not have it
// (Kenney's "Space Kit" is not Quaternius's "Ultimate Space Kit").
function installedSuggestion(name, creator) {
  const want = words(name); if (!want.length) return false;
  const byKenney = /kenney/i.test(creator || '');
  return [...new Set(models.load().map(m => m.pack + ' ' + (m.source || '')))].some(h => {
    const have = new Set(words(h));
    if (have.has('kenney') !== byKenney) return false;
    return want.every(w => have.has(w));
  });
}

// After a pack is imported, Claude tags each model with search keywords (a quick job in the normal queue).
function queueTagging(pack) {
  const all = jobs.all(); all.push({ id: id(), kind: 'tag', pack, headline: 'Catalog ' + pack.replace(/-/g, ' '), status: 'queued', createdAt: now() }); jobs.save(all);
  pump();
}

// Claude searches the web for free model packs and visual styles that fit the channel; it replies with JSON only.
function suggestPrompt() {
  const have = [...new Set(models.load().map(m => m.pack + (m.source ? ' (' + m.source + ')' : '')))];
  const prev = readJson(SUGGEST, { packs: [], styles: [] });
  const seenPacks = prev.packs.map(p => `${p.name} (${p.creator})`), seenStyles = prev.styles.map(s => s.name);
  const vids = videoList().map(v => '- ' + v.headline).slice(0, 15), upcoming = ideas.all().filter(i => i.status === 'new').map(i => '- ' + i.headline);
  return `Help a creator of low-poly 3D "What if...?" animated shorts (Three.js, vertical 9:16) find free 3D model packs and visual styles that would make their videos better.

Model packs they already have: ${have.join('; ') || 'none'}
Their videos so far:
${vids.join('\n') || '- none yet'}
Ideas they may make next:
${upcoming.join('\n') || '- none'}

Already suggested before (do NOT suggest these again): ${seenPacks.join('; ') || 'none'}

Use web search and fetch the actual pages. Find 12 NEW model packs that are free and CC0 (preferred) or CC-BY, from reputable sources: Kenney (kenney.nl/assets), Quaternius (quaternius.com/packs), KayKit (kaylousberg.itch.io), Poly Pizza (poly.pizza bundles), OpenGameArt (CC0 3D), itch.io CC0 3D packs, Zsky, Kay's or similar. Go beyond the obvious first results: browse the creators' full pack lists. Spread them across different categories useful for "What if" scenes: people and crowds, animals, sea life, dinosaurs, vehicles and planes, trains and ships, city buildings, houses and interiors, furniture, food, sports, space, nature and weather, industry and tools, medieval/historical, sci-fi, effects and particles. Prefer packs with glTF/GLB downloads and animated models. For each, open its page and copy the real URL of a preview image shown on that page; if you can't find one, use null. Don't invent URLs.

Also suggest 3 NEW visual styles they could try for variety (not these: ${seenStyles.join(', ') || 'none'}), each with a real example image URL from a page you visited (or null) and one concrete rule to try it.

Reply with only this JSON, no other text:
{"packs": [{"name": "", "creator": "", "license": "CC0 or CC-BY 4.0", "url": "page to download from", "image": "preview image URL or null", "contains": "what is in it, short", "formats": "file formats, e.g. GLB, FBX, OBJ (under 28 characters; empty if not listed)", "why": "one sentence: how it would improve these videos"}],
 "styles": [{"name": "", "description": "one sentence", "image": "example image URL or null", "source": "page the image is from", "tryNote": "one concrete rule to add to the animation brief"}]}`;
}
const { refreshStats } = require('./stats');
const { refreshAccounts, FILE: ACCOUNTS } = require('./accounts');

const PORT = 8800, LAN = process.argv.includes('--lan');
const PAGE = path.join(P.root, 'app', 'index.html');
const IDEAS = path.join(P.root, 'data', 'ideas.json'), JOBS = path.join(P.root, 'data', 'jobs.json'), LOGS = path.join(P.root, 'data', 'job-logs');
const now = () => new Date().toISOString();
const id = () => crypto.randomBytes(6).toString('hex');

// ---------- store (plain JSON files; job-note.js writes jobs.json too, so always read fresh) ----------
const ideas = { all: () => readJson(IDEAS, []), save: v => writeJson(IDEAS, v) };
const jobs = { all: () => readJson(JOBS, []), save: v => writeJson(JOBS, v) };
function patchJob(jid, fields) { const all = jobs.all(), j = all.find(x => x.id === jid); if (j) { Object.assign(j, fields, { updatedAt: now() }); jobs.save(all); } return j; }
function patchIdea(iid, fields) { const all = ideas.all(), i = all.find(x => x.id === iid); if (i) { Object.assign(i, fields); ideas.save(all); } return i; }

function stage(meta) {
  const st = Object.values(meta.platforms || {}).map(s => s.status);
  if (!st.length) return (meta.studio && meta.studio.stage) || 'review';
  return st.every(s => s === 'failed') ? 'failed' : 'posted';
}
const manualCaption = (dir, x) => { try { return fs.readFileSync(path.join(dir, x.caption), 'utf8'); } catch { return null; } };
function videoList() {
  return listVideos().filter(({ meta }) => meta.title).map(({ dir, meta }) => {
    const folder = path.basename(dir), s = meta.studio || {};
    return {
      id: folder, headline: meta.headline || meta.title, title: meta.title, description: meta.description || '', hashtags: meta.hashtags || [],
      stage: stage(meta), scheduledAt: meta.scheduledAt || null, durationSec: s.durationSec || null, models: modelsUsed(dir),
      videoUrl: `/media/${folder}/video.mp4`, posterUrl: fs.existsSync(path.join(dir, 'poster.jpg')) ? `/media/${folder}/poster.jpg` : null,
      platforms: Object.fromEntries(Object.entries(meta.platforms || {}).map(([p, x]) => [p, { status: x.status, url: x.url || null, studio: x.studio || null, views: x.stats ? x.stats.views : null, caption: x.status === 'manual' ? manualCaption(dir, x) : null }])),
      createdAt: s.createdAt || fs.statSync(path.join(dir, 'meta.json')).birthtime.toISOString(), updatedAt: s.updatedAt || null,
    };
  });
}
let claudeState = { ok: null, message: 'Checking…', at: 0 };

// Totals of what Claude runs cost (as Claude reports them), for the sidebar and the Dashboard.
function usageSummary() {
  const list = readJson(claude.USAGE, []), today = new Date().toDateString(), weekAgo = Date.now() - 7 * 864e5;
  const sum = l => ({ runs: l.length, cost: +l.reduce((s, x) => s + (x.cost || 0), 0).toFixed(2) });
  return { today: sum(list.filter(x => new Date(x.at).toDateString() === today)), week: sum(list.filter(x => Date.parse(x.at) > weekAgo)), recent: list.filter(x => x.kind !== 'check').slice(-15).reverse() };
}
// Saves the animation model choice into config.json ("studio": {"animationModel": "sonnet" | "opus"}).
function setAnimationModel(model) {
  if (!['sonnet', 'opus'].includes(model)) throw new Error('Choose Sonnet or Opus');
  const cfg = readJson(P.config, {}); cfg.studio = { ...(cfg.studio || {}), animationModel: model }; writeJson(P.config, cfg);
}
// Where each platform's posts go: "buffer", "own" (its own login), "manual" (you post it yourself) or "off". Saved in config.json.
const POST_PLATFORMS = ['youtube', 'facebook', 'instagram', 'tiktok'], POST_MODES = ['buffer', 'own', 'manual', 'off'];
function postingState() {
  const cfg = readJson(P.config, {}), pl = cfg.platforms || {}, found = (tokens.get('buffer') || {}).channels || {};
  return {
    buffer: { keySet: !!(pl.buffer && pl.buffer.apiKey), hostingSet: !!(pl.buffer && pl.buffer.hosting && pl.buffer.hosting.netlifyToken && pl.buffer.hosting.siteId && pl.buffer.hosting.siteUrl), channels: Object.keys(found) },
    modes: Object.fromEntries(POST_PLATFORMS.map(p => [p, pl[p] && pl[p].enabled === false ? 'off' : (pl[p] && pl[p].mode) || 'own'])),
  };
}
function setPlatformMode(platform, mode) {
  if (!POST_PLATFORMS.includes(platform) || !POST_MODES.includes(mode)) throw new Error('Unknown platform or mode');
  if (mode === 'buffer') {
    const b = postingState().buffer;
    if (!b.keySet || !b.hostingSet) throw new Error('Buffer isn\'t set up yet: add platforms.buffer (apiKey and hosting) to config.json, then run npm run auth -- buffer');
    if (!b.channels.includes(platform)) throw new Error('Buffer has no ' + platform + ' channel: connect it in Buffer, then run npm run auth -- buffer');
  }
  const cfg = readJson(P.config, {}); cfg.platforms = cfg.platforms || {}; const c = cfg.platforms[platform] = cfg.platforms[platform] || {};
  if (mode === 'off') c.enabled = false; else { c.enabled = true; c.mode = mode; }
  writeJson(P.config, cfg);
}
function state() {
  return {
    ideas: ideas.all().filter(i => i.status === 'new' || i.status === 'queued'),
    jobs: jobs.all().filter(j => j.status !== 'cleared').slice(-40),
    videos: videoList(), accounts: readJson(ACCOUNTS, { latest: {}, history: [] }),
    claude: claudeState, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    trainer: { ...trainer.load(), brief: trainer.brief() },
    models: models.load().map(m => ({ ...m, thumb: fs.existsSync(path.join(models.THUMBS, m.id + '.png')) ? '/model-thumb/' + m.id + '.png' : null })),
    suggestions: (s => s && { ...s, packs: s.packs.filter(p => !installedSuggestion(p.name, p.creator)) })(readJson(SUGGEST, null)),
    usage: usageSummary(),
    settings: { animationModel: claude.settings('make').model, posting: postingState() },
    comments: comments.summary(),
  };
}

// Comment replies: every 15 minutes while switched on in the Comments tab (also on demand from the page).
let commentsBusy = false;
async function runComments() {
  if (commentsBusy) return;
  commentsBusy = true;
  try { const r = await comments.runOnce(); if (r.replied || r.problems.length) log('comments: ' + JSON.stringify(r)); }
  catch (e) { log('comments failed: ' + e.message); }
  finally { commentsBusy = false; }
}
// ---------- job runner: one job at a time ----------
let running = null; // { id, child }

function slugify(s) { return String(s).toLowerCase().replace(/^what if\s+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').split('-').slice(0, 5).join('-') || 'video'; }
function duration(file) { try { return Math.round(+execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString()); } catch { return null; } }
function node(args) { return new Promise(res => { let out = ''; const c = spawn(process.execPath, args, { cwd: P.root, windowsHide: true }); c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d); c.on('close', code => res({ code, out })); running && (running.child = c); }); }

// The Trainer brief comes first so the creator's own lessons shape every animation.
const trainerLine = () => trainer.brief() ? 'First read trainer/STYLE.md: the creator\'s Trainer brief (notes plus lessons from reference videos). Follow it throughout; it wins over template defaults.\n\n' : '';

// Step 1 of a video: Opus writes the storyboard (story, hook, facts, shots) using only what the engine can show.
function storyboardPrompt(idea) {
  const t = trainer.load(), notes = t.notes.filter(n => n.active).map(n => '- ' + n.text).join('\n');
  const refs = t.videos.filter(v => v.active && v.status === 'ready' && v.analysis).map(v => `From "${v.name}":\n${v.analysis.split('**Copy this:**')[1] || ''}`).join('\n').slice(0, 3000);
  return `You are the story lead for a viral low-poly 3D "What if...?" shorts channel (vertical, 45-85 s, in the style of @meanwhileanimations). Write the storyboard for this idea.

Idea: ${idea.headline}
Hook: ${idea.hook}
Beats suggested: ${(idea.beats || []).join(' | ')}
Ending suggested: ${idea.twist}
Counter suggested: ${idea.counter}

What makes these videos work:
- The first 2 seconds must make people stay: a striking image plus the question.
- Every scene is ONE concrete, visual, scientifically accurate consequence a viewer can picture ("Ships settle onto bare sand"), not an abstract statement. Use real numbers.
- Escalate: local and relatable (people, a street, a pet) → bigger (cities, coasts) → planetary. Include one emotional or human moment.
- The counter is something relatable that changes meaningfully every scene (time elapsed, meters, people affected, %).
- End on a satisfying twist or reflection that is true. Never end on nonsense.
- Captions: one sentence, under 60 characters, plain words, no hype.
${notes ? `\nThe creator's notes:\n${notes}\n` : ''}${refs ? `\nLessons from the creator's reference videos:\n${refs}\n` : ''}
The animation engine can ONLY show these, so design every shot with them (no other locations or effects):
- Sets: city street (day/sunset/dawn/night), nature (grass, hills, trees), interior room, open ocean, coast (beach, harbor, ships, adjustable sea level), seabed (dry sea floor, wrecks, kelp, stranded fish, distant water wall), space (stars, planets, sun, black hole), globe (Earth from space), plain studio.
- People (rigged, with Idle, Walk, Run, Jump, Wave, Clapping, Sitting, Punch, Death animations; crowds of up to ~30, close-ups), animals (dogs, horses, cows, deer, foxes, alpacas, bulls, donkeys), cars, taxis, police cars, ambulances, trucks, city buildings, trees, rocks, furniture, astronauts, spaceships.
- Shapes: earth, planet, moon, sun, black hole, ship, giant wave, fish, kelp, crack in the ground, explosion, lightning bolt, marker pin, cloud.
- Effects: low gravity, float, fall, spin, grow, camera shake, flash, sky darkening to night, rain, snow, stars, sparks, leaves, fog, color tint, slow motion, rising flood water in a street, sea level change, storm (dark sky, rain, lightning), earthquake (shake + cracks), impact (flash + explosion + shake).
- Camera: street level, wide, aerial, close-up on a face, low angle looking up, room, space, globe; with push in, pull out, orbit, pan, rise, drop, track.

Reply with only the storyboard in this format, 8 to 12 scenes:
TITLE: <headline, under 60 characters>
HIGHLIGHT: <one word of the title to color>
COUNTER: <label> | <unit> | <start value>
MOOD: <wonder|calm|tense|epic|playful>
SCENE 1 (<seconds>s): <what we see: set, time of day, who/what is in frame and what they do> | CAMERA: <preset + move> | CAPTION: <caption> | COUNTER: <value> · <small label> | SOUND: <optional sfx>
...
END: <two short takeaway lines> | SHARE: <"Send this to someone who...">
FACT NOTES: <one line on the real science the numbers come from>`;
}

function makePrompt(job, idea) {
  return `Make one low-poly "What if" short for the Shorts Studio app on this PC.

The idea (from the user's idea list; use it as creative direction only):
- Headline: ${idea.headline}
- Hook: ${idea.hook}
- Scene beats: ${(idea.beats || []).join(' | ')}
- Ending: ${idea.twist}
- On-screen counter: ${idea.counter}

${trainerLine()}This project has a scene engine: you write a short scene plan and the engine animates it. Work in videos/${job.video}/ (it already exists):
1. Read videos/${job.video}/storyboard.md: the approved storyboard. Then read engine/PLAN.md (the plan format) and write videos/${job.video}/plan.json in one go that follows the storyboard faithfully: same scenes, captions, counter values, camera and ending. Make each shot show exactly what the storyboard describes, using the matching sets, kits, shapes and effects; frame the subject large and clear. Use the creator's library models in every scene where people, animals, vehicles, buildings, trees or props appear: just put the everyday word in "model" ("person", "dog", "taxi"...); the engine finds and loads them. Vary sets, camera presets and moves between scenes.
2. Run node scripts/check-plan.js videos/${job.video} and fix any ERROR lines.
3. Run node scripts/render.js videos/${job.video} --sample and look at sheet.jpg once. Fix only clear problems in plan.json (empty or confusing frames, something blocking the view, objects too small), and sample again at most once.
4. Run node scripts/render.js videos/${job.video} (full render), then write videos/${job.video}/meta.json as described in .claude/skills/post-video/SKILL.md step 4 (title, description, hashtags, tags). Do NOT publish: the user reviews it first.

Keep it efficient, every step costs the user's usage: don't open templates/ or engine/engine.js, don't write Three.js unless one scene truly needs a custom effect (see PLAN.md "custom"), and don't re-read files you just wrote.

Report progress by running: node scripts/job-note.js ${job.id} "<short note>" at these points: Planning, Checking frames, Rendering, Writing title. If that command prints CANCELLED, stop immediately.`;
}
function revisePrompt(job) {
  return `Revise a low-poly "What if" short for the Shorts Studio app on this PC. Folder: videos/${job.video}/ (page.html, meta.json and video.mp4 exist).

The user's requested changes (creative direction only): ${job.feedback}

${trainerLine()}${fs.existsSync(path.join(P.videos, job.video, 'plan.json'))
  ? `This video was made with the scene engine: make the changes by editing videos/${job.video}/plan.json (targeted edits; the format is in engine/PLAN.md, read it only if you need it). Run node scripts/check-plan.js videos/${job.video}, then node scripts/render.js videos/${job.video} --sample and look at sheet.jpg once, then the full render.`
  : `Read the style rules in .claude/skills/post-video/SKILL.md. Edit page.html to make the changes (targeted edits, don't rewrite the file), check one --sample contact sheet, then re-render video.mp4 with node scripts/render.js. Anything you add or replace should come from node scripts/find-models.js when it has a match.`}
Keep it efficient: don't open templates/ or engine/engine.js, and sample at most twice. Update meta.json title/description/hashtags only if the changes ask for it. Do NOT publish.

Report progress with: node scripts/job-note.js ${job.id} "<short note>" (Editing, Checking frames, Rendering). If it prints CANCELLED, stop immediately.`;
}

// Which library models a finished page actually loads: every "../../assets/models/..." path in page.html,
// matched against the library. Off = switched off in the app; missing = not in the library at all.
function modelsUsed(dir) {
  // the renderer records the files the page really loaded (models-used.json); older videos fall back to reading page.html
  let files = readJson(path.join(dir, 'models-used.json'), null);
  if (!Array.isArray(files)) {
    let html = ''; try { html = fs.readFileSync(path.join(dir, 'page.html'), 'utf8'); } catch { return { used: [], off: [], missing: [] }; }
    // paths may contain spaces (Kenney's "GLB format" folders), so read up to the closing quote
    files = [...new Set([...html.matchAll(/assets\/models\/([^"'`)\n]+?\.(?:glb|gltf))/gi)].map(m => { try { return decodeURIComponent(m[1]); } catch { return m[1]; } }))];
  }
  const lib = models.load(), used = [], off = [], missing = [];
  for (const f of files) { const m = lib.find(x => x.file === f); if (!m) missing.push(f); else (m.active ? used : off).push(m.name); }
  return { used, off, missing };
}

// Adds the Claude run that just finished to the job's running total (cost as Claude reports it, steps, model).
function charge(jid) {
  const r = claude.lastRun(), j = jobs.all().find(x => x.id === jid);
  if (!r || !j) return;
  patchJob(jid, { cost: +((j.cost || 0) + r.cost).toFixed(4), turns: (j.turns || 0) + r.turns, model: r.model, hitLimit: j.hitLimit || r.hitLimit });
}
function whyStopped(result, raw, fallback) {
  if (result && /budget/i.test(String(result.subtype || '') + ' ' + String(result.terminal_reason || ''))) return 'Stopped at its spending cap before finishing, so it could not run up your usage. Try again, or make the request simpler.';
  if (result && (result.subtype === 'error_max_turns' || /max.?turns/i.test(String(result.terminal_reason || '')))) return 'Stopped at the step limit before finishing. Try again, or switch animations to Opus for this one.';
  const t = String((result && result.result) || raw || '').trim();
  return t ? t.split('\n').slice(-2).join(' ').slice(0, 200) : fallback;
}

async function runJob(job) {
  const dir = path.join(P.videos, job.video || '');
  running = { id: job.id, child: null };
  patchJob(job.id, { status: 'working', note: job.kind === 'post' ? 'Uploading' : 'Starting Claude', startedAt: now() });
  fs.mkdirSync(LOGS, { recursive: true });
  const logFile = path.join(LOGS, job.id + '.log');
  try {
    if (job.kind === 'make' || job.kind === 'revise') {
      const idea = job.kind === 'make' ? ideas.all().find(i => i.id === job.ideaId) : null;
      if (job.kind === 'make' && !fs.existsSync(path.join(dir, 'storyboard.md'))) {
        patchJob(job.id, { note: 'Writing the storyboard' });
        const sb = claude.run(storyboardPrompt(idea), 'storyboard', [], { logFile, label: job.headline });
        running.child = sb.child;
        const { result: sr } = await sb.done;
        charge(job.id);
        if (jobs.all().find(j => j.id === job.id).status === 'cancelled') return;
        if (!sr || sr.is_error || !/SCENE 1/i.test(String(sr.result || ''))) throw new Error(whyStopped(sr, '', 'Could not write the storyboard'));
        fs.writeFileSync(path.join(dir, 'storyboard.md'), String(sr.result).trim() + '\n');
      }
      const r = claude.run(job.kind === 'make' ? makePrompt(job, idea) : revisePrompt(job), job.kind, ['--permission-mode', 'acceptEdits', '--allowedTools', claude.JOB_TOOLS], { logFile, label: job.headline });
      running.child = r.child;
      const { code, out, err, result } = await r.done;
      charge(job.id);
      if (jobs.all().find(j => j.id === job.id).status === 'cancelled') return;
      const meta = readJson(path.join(dir, 'meta.json'), null);
      if (code !== 0 || !meta || !meta.title || !fs.existsSync(path.join(dir, 'video.mp4')))
        throw new Error(whyStopped(result, err || out, 'Claude stopped before the video was finished'));
      await node([path.join(__dirname, 'preview.js'), dir, '--poster-only']);
      const s = meta.studio || {};
      meta.studio = { ...s, stage: 'review', ideaId: s.ideaId || job.ideaId || null, durationSec: duration(path.join(dir, 'video.mp4')), createdAt: s.createdAt || now(), updatedAt: now(), models: modelsUsed(dir) };
      saveMeta(dir, meta);
      if (job.kind === 'make') patchIdea(job.ideaId, { status: 'made' });
      patchJob(job.id, { status: 'done', note: 'Ready for review' });
    } else if (job.kind === 'analyze') {
      const v = trainer.load().videos.find(x => x.id === job.ref);
      if (!v) throw new Error('The reference video was deleted');
      const dir = trainer.refDir(v.id), src = path.join(dir, v.file), dur = duration(src) || 60;
      trainer.updateVideo(v.id, { status: 'analyzing', durationSec: dur });
      patchJob(job.id, { note: 'Picking frames' });
      // 16 evenly spaced frames tiled 4x4, each fitted into a 270x480 box, plus a poster for the card
      const fit = 'scale=270:480:force_original_aspect_ratio=decrease,pad=270:480:(ow-iw)/2:(oh-ih)/2:color=black';
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vf', `fps=16/${dur},${fit},tile=4x4`, '-frames:v', '1', path.join(dir, 'sheet.jpg')]);
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(Math.min(2, dur / 2)), '-i', src, '-frames:v', '1', '-vf', 'scale=540:-2', path.join(dir, 'poster.jpg')]);
      const times = [...Array(16).keys()].map(i => ((i + 0.5) * dur / 16).toFixed(1) + 's').join(', ');
      patchJob(job.id, { note: 'Claude is studying it' });
      const r = claude.run(trainer.analyzePrompt({ ...v, durationSec: dur }, times, job.id), 'analyze', ['--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Write,Bash(node:*)'], { logFile, label: job.headline });
      running.child = r.child;
      const { code, out, err, result } = await r.done;
      charge(job.id);
      if (jobs.all().find(j => j.id === job.id).status === 'cancelled') return;
      const md = fs.existsSync(path.join(dir, 'analysis.md')) ? fs.readFileSync(path.join(dir, 'analysis.md'), 'utf8').trim() : '';
      if (code !== 0 || !md) throw new Error(whyStopped(result, err || out, 'Claude stopped before writing the analysis'));
      trainer.updateVideo(v.id, { status: 'ready', analysis: md.slice(0, 6000) });
      patchJob(job.id, { status: 'done', note: 'Learned' });
    } else if (job.kind === 'download') {
      // a suggested pack, fetched from its creator's page and imported like a dropped zip
      const pack = models.packDir(job.creator + ' ' + job.name), dir = path.join(models.DIR, pack);
      try {
        await require('./lib/fetchpack').fetchPack(job.url, dir, note => { if (jobs.all().find(j => j.id === job.id).status === 'cancelled') throw new Error('cancelled'); patchJob(job.id, { note }); });
      } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); if (e.message === 'cancelled') return; throw e; }
      patchJob(job.id, { note: 'Adding models' });
      const r = models.importDir(dir, pack, `${job.name} by ${job.creator}`, job.license);
      trainer.writeBrief(trainer.load());
      models.makeThumbs(r.ids);
      queueTagging(pack);
      patchJob(job.id, { status: 'done', note: `Added ${r.added} models` });
    } else if (job.kind === 'tag') {
      // big packs go in chunks so each answer stays short
      const ms = models.load().filter(m => m.pack === job.pack);
      if (!ms.length) throw new Error('That pack was deleted');
      let tagged = 0;
      for (let i = 0; i < ms.length; i += 120) {
        if (jobs.all().find(j => j.id === job.id).status === 'cancelled') return;
        patchJob(job.id, { note: `Tagging ${Math.min(i + 120, ms.length)} of ${ms.length}` });
        const chunk = new Set(ms.slice(i, i + 120).map(m => m.id));
        const prompt = models.tagPrompt(job.pack).replace(/^([a-f0-9]{10}): .*$/gm, (line, mid) => chunk.has(mid) ? line : '').replace(/\n{3,}/g, '\n\n');
        const text = await claude.ask(prompt, 'tag', job.headline);
        charge(job.id);
        tagged += models.setTags(JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)));
      }
      trainer.writeBrief(trainer.load());
      patchJob(job.id, { status: 'done', note: `Tagged ${tagged} models` });
    } else if (job.kind === 'suggest') {
      const r = claude.run(suggestPrompt(), 'suggest', ['--allowedTools', 'WebSearch,WebFetch'], { logFile, label: job.headline });
      running.child = r.child;
      const { out, err, result: res } = await r.done;
      charge(job.id);
      if (jobs.all().find(j => j.id === job.id).status === 'cancelled') return;
      if (!res) throw new Error((out || err || 'no reply').trim().slice(0, 200));
      if (res.is_error) throw new Error(String(res.result || 'Claude returned an error').slice(0, 200));
      const text = String(res.result || ''), data = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      const url = u => typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null; // only plain https links reach the page
      // each search adds to the list; the same page or name never appears twice
      const prev = readJson(SUGGEST, { packs: [], styles: [] }), at = now();
      const key = p => (p.url || p.name || '').toLowerCase().replace(/\/+$/, '');
      const known = new Set(prev.packs.map(key)), knownStyles = new Set(prev.styles.map(s => s.name.toLowerCase()));
      const packs = (data.packs || []).filter(p => !installedSuggestion(p.name, p.creator)).slice(0, 16).map(p => ({ name: String(p.name || '').slice(0, 80), creator: String(p.creator || '').slice(0, 60), license: String(p.license || '').slice(0, 30), url: url(p.url), image: url(p.image), contains: String(p.contains || '').slice(0, 200), formats: String(p.formats || '').slice(0, 60), why: String(p.why || '').slice(0, 240), at }))
        .filter(p => p.name && !known.has(key(p)) && known.add(key(p)));
      const styles = (data.styles || []).slice(0, 6).map(s => ({ name: String(s.name || '').slice(0, 60), description: String(s.description || '').slice(0, 240), image: url(s.image), source: url(s.source), tryNote: String(s.tryNote || '').slice(0, 300), at }))
        .filter(s => s.name && !knownStyles.has(s.name.toLowerCase()));
      writeJson(SUGGEST, { at, lastAdded: packs.length, packs: [...packs, ...prev.packs], styles: [...styles, ...prev.styles] });
      patchJob(job.id, { status: 'done', note: `Found ${packs.length} new packs` });
    } else if (job.kind === 'post') {
      const { code, out } = await node([path.join(__dirname, 'publish.js'), dir, ...(job.at ? ['--at', job.at] : ['--now'])]);
      fs.writeFileSync(logFile, out);
      if (jobs.all().find(j => j.id === job.id).status === 'cancelled') return;
      if (code !== 0) throw new Error(out.trim().split('\n').pop());
      const yt = out.split('\n').find(l => l.startsWith('youtube: uploaded as private'));
      patchJob(job.id, { status: 'done', note: yt ? yt.replace('youtube: uploaded as private. ', 'YouTube is private: ') : 'Posted' });
    }
  } catch (e) {
    log(`studio job ${job.kind} failed: ${e.message}`);
    patchJob(job.id, { status: 'failed', note: e.message });
    if (job.kind === 'make' && job.ideaId) patchIdea(job.ideaId, { status: 'new' });
    if (job.kind === 'analyze') try { trainer.updateVideo(job.ref, { status: 'failed', error: e.message }); } catch {}
  } finally {
    running = null;
    setTimeout(pump, 200);
  }
}
// Claude jobs wait (queued) until the command line is signed in; posting doesn't need Claude.
function pump() {
  if (running) return;
  const next = jobs.all().find(j => j.status === 'queued' && (j.kind === 'post' || j.kind === 'download' || claudeState.ok));
  if (next) runJob(next);
}

// ---------- actions ----------
const IDEA_PROMPT = (past, tried, theme, notes = []) => `You create premises for 45-90 second vertical low-poly 3D animated shorts in the "What if...?" style (like @meanwhileanimations): one impossible question, then a chain of concrete, scientifically grounded consequences shown scene by scene, with a counter on screen the whole time and a twist or emotional ending.

Channel's past videos (with total views where known):
${past.join('\n') || '- none yet'}

Ideas already suggested (do not repeat or closely rephrase):
${tried.join('\n') || '- none'}
${theme ? `\nTheme the creator asked for: ${theme}\n` : ''}${notes.length ? `\nThe creator's notes to remember (apply where they matter for premises):\n${notes.map(n => '- ' + n).join('\n')}\n` : ''}
Write 5 new premises that most people would be hooked by and watch to the end. Favor a clear first consequence plus a surprising escalation, real numbers, and a satisfying last 10 seconds. Avoid real living people, tragedies with real victims, medical or financial advice, and copyrighted characters.

For each, estimate:
- bestScore: 0-100, how strong this premise is compared with the other four in this batch (exactly one should be the highest).
- viralChance: 0-100, your honest estimated % chance it reaches about 10x the channel's typical views. Most premises should land between 3 and 35; reserve higher numbers for truly exceptional hooks.

Reply with only a JSON array of 5 objects, no other text:
{"headline": "What if ...? (under 60 characters)", "hook": "one sentence on why viewers keep watching", "beats": ["5 to 7 short scene beats in order, each under 60 characters"], "twist": "the ending in one sentence", "counter": "what the on-screen counter tracks, 2-4 words", "bestScore": 0, "viralChance": 0, "why": "one sentence explaining the scores"}`;

let generating = false;
async function generateIdeas(theme) {
  if (generating) throw new Error('Already generating ideas');
  generating = true;
  try {
    const vids = videoList();
    const past = vids.map(v => { const n = Object.values(v.platforms).reduce((s, x) => s + (x.views || 0), 0); return `- ${v.headline}${n ? ` (${n} views total)` : ''}`; }).slice(0, 25);
    const tried = ideas.all().map(i => '- ' + i.headline).slice(-40);
    const notes = trainer.load().notes.filter(n => n.active).map(n => n.text);
    const text = await claude.ask(IDEA_PROMPT(past, tried, String(theme || '').slice(0, 120), notes), 'ideas', 'Idea batch');
    const list = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
    if (!Array.isArray(list) || !list.length) throw new Error('Claude replied without ideas');
    // a new batch replaces the ideas you didn't pick (ones being made stay)
    const all = ideas.all().map(i => i.status === 'new' ? { ...i, status: 'dismissed' } : i), t = Date.now();
    list.slice(0, 5).forEach((x, k) => all.push({
      id: id(), headline: String(x.headline || '').slice(0, 120), hook: String(x.hook || '').slice(0, 400),
      beats: Array.isArray(x.beats) ? x.beats.slice(0, 8).map(b => String(b).slice(0, 160)) : [], twist: String(x.twist || '').slice(0, 300),
      counter: String(x.counter || '').slice(0, 60), bestScore: Math.round(Math.max(0, Math.min(100, +x.bestScore || 0))),
      viralChance: Math.round(Math.max(0, Math.min(100, +x.viralChance || 0))), why: String(x.why || '').slice(0, 300),
      theme: theme || null, status: 'new', createdAt: new Date(t + k).toISOString(),
    }));
    ideas.save(all);
  } finally { generating = false; }
}

function makeIdea(iid) {
  const idea = ideas.all().find(i => i.id === iid);
  if (!idea || idea.status !== 'new') throw new Error('That idea is no longer available');
  let folder = new Date().toISOString().slice(0, 10) + '-' + slugify(idea.headline), n = 2;
  while (fs.existsSync(path.join(P.videos, folder))) folder = folder.replace(/-\d+$/, '') + '-' + n++;
  fs.mkdirSync(path.join(P.videos, folder), { recursive: true });
  patchIdea(iid, { status: 'queued' });
  const all = jobs.all(); all.push({ id: id(), kind: 'make', ideaId: iid, video: folder, headline: idea.headline, status: 'queued', createdAt: now() }); jobs.save(all);
  pump();
}
function addJob(kind, folder, extra = {}) {
  const v = videoList().find(x => x.id === folder);
  if (!v) throw new Error('Video not found');
  const all = jobs.all(); all.push({ id: id(), kind, video: folder, headline: v.title, status: 'queued', createdAt: now(), ...extra }); jobs.save(all);
  pump();
}
function cancelJob(jid) {
  const j = jobs.all().find(x => x.id === jid);
  if (!j || (j.status !== 'queued' && j.status !== 'working')) throw new Error('That task already finished');
  patchJob(jid, { status: 'cancelled', note: 'Cancelled' });
  if (running && running.id === jid) claude.kill(running.child);
  if (j.kind === 'analyze') try { trainer.updateVideo(j.ref, { status: 'failed', error: 'Cancelled' }); } catch {}
  if (j.kind === 'make') {
    if (j.ideaId) patchIdea(j.ideaId, { status: 'dismissed' });
    // the half-made folder goes once the processes have let go of its files
    setTimeout(() => fs.rm(path.join(P.videos, j.video), { recursive: true, force: true }, () => {}), 2500);
  }
}
function discardVideo(folder) {
  const dir = path.join(P.videos, folder), meta = readJson(path.join(dir, 'meta.json'), null);
  if (!meta) throw new Error('Video not found');
  for (const j of jobs.all()) if (j.video === folder && (j.status === 'queued' || j.status === 'working')) cancelJob(j.id);
  meta.studio = { ...(meta.studio || {}), stage: 'discarded', updatedAt: now() };
  saveMeta(dir, meta);
}

// ---------- http ----------
const send = (res, code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
const json = (res, obj, code = 200) => send(res, code, 'application/json', JSON.stringify(obj));
const body = req => new Promise(r => { let b = ''; req.on('data', d => b += d); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });
const SKELETON = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{height:100%}body{margin:0}[hidden]{display:none!important}</style></head><body>';

function media(req, res, folder, file) {
  const f = path.join(P.videos, path.basename(folder), path.basename(file));
  if (!['video.mp4', 'poster.jpg', 'sheet.jpg'].includes(path.basename(file)) || !fs.existsSync(f)) return send(res, 404, 'text/plain', 'not found');
  const size = fs.statSync(f).size, type = f.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg', range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (!range) { res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' }); return fs.createReadStream(f).pipe(res); }
  const start = range[1] ? +range[1] : 0, end = range[2] ? Math.min(+range[2], size - 1) : size - 1;
  res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' });
  fs.createReadStream(f, { start, end }).pipe(res);
}

http.createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]), parts = url.split('/').filter(Boolean);
  try {
    if (req.method === 'GET') {
      if (url === '/') return send(res, 200, 'text/html; charset=utf-8', SKELETON + fs.readFileSync(PAGE, 'utf8') + '</body></html>');
      if (url === '/api/state') return json(res, state());
      if (url === '/api/ping') return json(res, { ok: true });
      const LOGOS = { '/logo.svg': ['logo.svg', 'image/svg+xml'], '/logo-64.png': ['logo-64.png', 'image/png'], '/logo-256.png': ['logo-256.png', 'image/png'], '/favicon.ico': ['icon.ico', 'image/x-icon'] };
      if (LOGOS[url]) { res.writeHead(200, { 'Content-Type': LOGOS[url][1], 'Cache-Control': 'max-age=86400' }); return fs.createReadStream(path.join(P.root, 'app', LOGOS[url][0])).pipe(res); }
      if (parts[0] === 'media' && parts.length === 3) return media(req, res, parts[1], parts[2]);
      if (parts[0] === 'model-thumb' && parts.length === 2 && /^[a-f0-9]+\.png$/.test(parts[1])) {
        const f = path.join(models.THUMBS, parts[1]);
        if (!fs.existsSync(f)) return send(res, 404, 'text/plain', 'not found');
        res.writeHead(200, { 'Content-Type': 'image/png' }); return fs.createReadStream(f).pipe(res);
      }
      if (parts[0] === 'trainer-media' && parts.length === 3 && ['poster.jpg', 'sheet.jpg'].includes(parts[2])) {
        const f = path.join(trainer.refDir(parts[1]), parts[2]);
        if (!fs.existsSync(f)) return send(res, 404, 'text/plain', 'not found');
        res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return fs.createReadStream(f).pipe(res);
      }
      return send(res, 404, 'text/plain', 'not found');
    }
    // reference video upload: the raw file is the request body
    if (req.method === 'PUT' && url === '/api/trainer/videos') {
      const q = new URL(req.url, 'http://x').searchParams;
      const rid = await trainer.receiveVideo(req, q.get('name'), q.get('note'));
      const all = jobs.all(); all.push({ id: id(), kind: 'analyze', ref: rid, headline: 'Learn from ' + q.get('name'), status: 'queued', createdAt: now() }); jobs.save(all);
      pump(); return json(res, state());
    }
    // model pack upload (.glb/.gltf/.zip), then previews render in the background
    if (req.method === 'PUT' && url === '/api/models') {
      const q = new URL(req.url, 'http://x').searchParams;
      const r = await models.receive(req, q.get('name'), q.get('source'), q.get('license'));
      trainer.writeBrief(trainer.load());
      models.makeThumbs(r.ids);
      queueTagging(r.pack);
      return json(res, { ...state(), added: r.added });
    }
    if (req.method !== 'POST') return send(res, 405, 'text/plain', 'method not allowed');
    const b = await body(req);
    if (url === '/api/ideas/generate') { await generateIdeas(b.theme); return json(res, state()); }
    if (parts[1] === 'ideas' && parts[3] === 'make') { makeIdea(parts[2]); return json(res, state()); }
    if (parts[1] === 'ideas' && parts[3] === 'dismiss') { patchIdea(parts[2], { status: 'dismissed' }); return json(res, state()); }
    if (parts[1] === 'jobs' && parts[3] === 'cancel') { cancelJob(parts[2]); return json(res, state()); }
    if (parts[1] === 'jobs' && parts[3] === 'clear') { patchJob(parts[2], { status: 'cleared' }); return json(res, state()); }
    if (parts[1] === 'videos' && parts[3] === 'post') {
      // when: "now" posts straight away; otherwise "at" is the time (ISO) you chose
      let at = null;
      if (b.when === 'at') { at = new Date(b.at); if (isNaN(at) || at.getTime() < Date.now() + 60e3) throw new Error('Pick a time in the future'); at = at.toISOString(); }
      addJob('post', parts[2], { at });
      return json(res, state());
    }
    if (parts[1] === 'videos' && parts[3] === 'revise') { if (!String(b.feedback || '').trim()) throw new Error('Describe the changes first'); addJob('revise', parts[2], { feedback: String(b.feedback).slice(0, 1000) }); return json(res, state()); }
    if (parts[1] === 'videos' && parts[3] === 'discard') { discardVideo(parts[2]); return json(res, state()); }
    if (url === '/api/trainer/notes') { trainer.addNote(b.text); return json(res, state()); }
    if (parts[1] === 'trainer' && parts[2] === 'notes' && parts[4] === 'update') { trainer.updateNote(parts[3], b); return json(res, state()); }
    if (parts[1] === 'trainer' && parts[2] === 'notes' && parts[4] === 'delete') { trainer.deleteNote(parts[3]); return json(res, state()); }
    if (parts[1] === 'trainer' && parts[2] === 'videos' && parts[4] === 'update') { trainer.updateVideo(parts[3], { active: b.active, note: b.note }); return json(res, state()); }
    if (parts[1] === 'trainer' && parts[2] === 'videos' && parts[4] === 'delete') {
      for (const j of jobs.all()) if (j.ref === parts[3] && (j.status === 'queued' || j.status === 'working')) cancelJob(j.id);
      setTimeout(() => { try { trainer.deleteVideo(parts[3]); } catch {} }, running ? 2500 : 0);
      return json(res, state());
    }
    if (parts[1] === 'models' && parts[3] === 'update') { models.update(parts[2], b); trainer.writeBrief(trainer.load()); return json(res, state()); }
    if (parts[1] === 'packs' && parts[3] === 'update') { models.updatePack(parts[2], b.active); trainer.writeBrief(trainer.load()); return json(res, state()); }
    if (parts[1] === 'packs' && parts[3] === 'delete') { models.removePack(parts[2]); trainer.writeBrief(trainer.load()); return json(res, state()); }
    if (url === '/api/settings') { setAnimationModel(b.animationModel); return json(res, state()); }
    if (url === '/api/comments/settings') { comments.setSettings(b); return json(res, state()); }
    if (url === '/api/comments/run') { await runComments(); return json(res, state()); }
    if (url === '/api/platform-mode') { setPlatformMode(b.platform, b.mode); return json(res, state()); }
    if (url === '/api/suggestions/download') {
      const s = readJson(SUGGEST, { packs: [] }), p = s.packs.find(x => x.url === b.url && x.name === b.name);
      if (!p || !p.url) throw new Error('That suggestion is gone');
      if (jobs.all().some(j => j.kind === 'download' && j.url === p.url && (j.status === 'queued' || j.status === 'working'))) throw new Error('Already downloading that pack');
      const all = jobs.all(); all.push({ id: id(), kind: 'download', url: p.url, name: p.name, creator: p.creator || 'pack', license: p.license || '', headline: 'Download ' + p.name, status: 'queued', createdAt: now() }); jobs.save(all);
      pump(); return json(res, state());
    }
    if (url === '/api/suggestions/remove') {
      const s = readJson(SUGGEST, null);
      if (s) { s.packs = s.packs.filter(p => !(p.url === b.url && p.name === b.name)); writeJson(SUGGEST, s); }
      return json(res, state());
    }
    if (url === '/api/suggestions') {
      if (jobs.all().some(j => j.kind === 'suggest' && (j.status === 'queued' || j.status === 'working'))) throw new Error('Already looking for suggestions');
      const all = jobs.all(); all.push({ id: id(), kind: 'suggest', headline: 'Find model packs and styles', status: 'queued', createdAt: now() }); jobs.save(all);
      pump(); return json(res, state());
    }
    if (url === '/api/refresh') { await refreshStats(); await refreshAccounts(); return json(res, state()); }
    // Quit stops the server; a running job is cancelled first (it would requeue on the next start otherwise).
    if (url === '/api/quit') {
      if (running) cancelJob(running.id);
      json(res, { ok: true });
      return setTimeout(() => process.exit(0), running ? 3000 : 300);
    }
    if (url === '/api/claude-check') { claudeState = { ...(await claude.status()), at: Date.now() }; pump(); return json(res, state()); }
    return send(res, 404, 'text/plain', 'not found');
  } catch (e) { json(res, { error: e.message }, 400); }
}).listen(PORT, LAN ? '0.0.0.0' : '127.0.0.1', () => {
  // a job that was running when the app last closed gets requeued
  const all = jobs.all(); let fixed = false;
  for (const j of all) if (j.status === 'working') { j.status = 'queued'; j.note = 'Restarted after the app closed'; fixed = true; }
  if (fixed) jobs.save(all);
  console.log(`Shorts Studio on http://localhost:${PORT}  (Ctrl+C to stop)`);
  if (LAN) for (const n of Object.values(os.networkInterfaces()).flat()) if (n && n.family === 'IPv4' && !n.internal) console.log(`  on your Wi-Fi: http://${n.address}:${PORT}`);
  if (!process.argv.includes('--no-open')) openBrowser(`http://localhost:${PORT}`);
  claude.status().then(s => { claudeState = { ...s, at: Date.now() }; pump(); });
  // Instagram and TikTok can't be scheduled through their APIs: every 5 minutes, post whatever is due (no Claude involved)
  const postDue = () => { const c = spawn(process.execPath, [path.join(__dirname, 'scheduler.js')], { cwd: P.root, windowsHide: true, stdio: 'ignore' }); c.on('error', e => log('scheduler failed: ' + e.message)); };
  setTimeout(postDue, 20e3); setInterval(postDue, 5 * 60e3);
  setInterval(() => { if (comments.load().enabled) runComments(); }, 15 * 60e3);
});
