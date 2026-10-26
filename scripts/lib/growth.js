// Growth helpers: learn from the creator's own results, score a finished video before posting, and offer title options.
const path = require('path');
const { listVideos, saveMeta } = require('./common');
const claude = require('./claude'), trainer = require('./trainer');

const MIN_VIDEOS = 3; // fewer than this and the numbers say nothing yet
const json = (text, open = '{', close = '}') => JSON.parse(text.slice(text.indexOf(open), text.lastIndexOf(close) + 1));
const clip = (s, n) => String(s || '').trim().slice(0, n);

// Posted videos with their total views across platforms, best first.
function results() {
  return listVideos().filter(({ meta }) => meta.title).map(({ dir, meta }) => {
    const per = Object.entries(meta.platforms || {}).map(([p, x]) => [p, x.stats ? x.stats.views || 0 : null]).filter(([, v]) => v != null);
    return { folder: path.basename(dir), headline: meta.headline || meta.title, title: meta.title, description: meta.description || '', durationSec: (meta.studio || {}).durationSec || null, views: per.reduce((s, [, v]) => s + v, 0), per: Object.fromEntries(per) };
  }).filter(v => v.views > 0).sort((a, b) => b.views - a.views);
}
const line = v => `- "${v.title}" (${v.durationSec ? v.durationSec + ' s, ' : ''}${v.views} views: ${Object.entries(v.per).map(([p, n]) => p + ' ' + n).join(', ')})\n  Description: ${clip(v.description, 220).replace(/\n/g, ' ')}`;

// Looks at what worked and what didn't, and saves 3 to 5 rules as Trainer notes (replacing the previous ones).
async function learnFromResults() {
  const all = results();
  if (all.length < MIN_VIDEOS) throw new Error(`Need views on at least ${MIN_VIDEOS} videos first (you have ${all.length}). Post more, then use "Refresh" so the app can read the numbers.`);
  const cut = Math.max(1, Math.floor(all.length / 2)), top = all.slice(0, cut), bottom = all.slice(-cut);
  const text = await claude.ask(`A creator makes low-poly 3D "What if...?" animated shorts. Compare their best and weakest videos by views and say what the data suggests about WHY, so the next videos do better.

Best:
${top.map(line).join('\n')}

Weakest:
${bottom.map(line).join('\n')}

Rules:
- Only claim patterns the examples actually show (topic type, title wording, emoji, length, description style). Small samples are noise, so say "may" when it's thin.
- Each rule must be a concrete instruction for future videos, under 140 characters.
- 3 to 5 rules. Reply with only JSON: {"rules": ["..."]}`, 'ideas', 'Learn from results');
  const rules = json(text).rules.map(r => clip(r, 300)).filter(Boolean).slice(0, 5);
  if (!rules.length) throw new Error('Claude found no clear pattern yet');
  trainer.setResultNotes(rules);
  return { rules, videos: all.length };
}

const find = folder => { const v = listVideos().find(x => path.basename(x.dir) === path.basename(folder)); if (!v) throw new Error('Video not found'); return v; };
const context = () => { const r = results().slice(0, 3); return (trainer.brief() ? 'Creator\'s Trainer brief (follow it):\n' + trainer.brief().slice(0, 4000) + '\n\n' : '') + (r.length ? 'Their best videos so far:\n' + r.map(line).join('\n') + '\n\n' : ''); };

// A blunt pre-post check of the hook, the idea and the title.
async function reviewVideo(folder) {
  const { dir, meta } = find(folder);
  const text = await claude.ask(`${context()}Review this finished short before it is posted to YouTube Shorts, TikTok, Instagram and Facebook. Be honest and specific; don't flatter.

Premise: ${meta.headline || meta.title}
Title: ${meta.title}
Description: ${clip(meta.description, 600)}
Length: ${(meta.studio || {}).durationSec || '?'} s
You can't see the video itself, so judge the hook from the premise and title, and say so where that limits you.

Score 1 to 10 each: hook (first 2 seconds), idea (is it surprising and shareable), title (would it get clicked). Keep each "why" under 200 characters. Then give at most 3 fixes, each something that can be done by revising the video, title or description.
Reply with only JSON: {"hook": {"score": 0, "why": ""}, "idea": {"score": 0, "why": ""}, "title": {"score": 0, "why": ""}, "fixes": [""]}`, 'ideas', 'Score ' + (meta.headline || meta.title));
  const r = json(text), n = x => Math.max(1, Math.min(10, Math.round(+x.score) || 1));
  const review = { hook: { score: n(r.hook), why: clip(r.hook.why, 450) }, idea: { score: n(r.idea), why: clip(r.idea.why, 450) }, title: { score: n(r.title), why: clip(r.title.why, 450) },
    fixes: (r.fixes || []).slice(0, 3).map(f => clip(f, 300)), at: new Date().toISOString() };
  meta.studio = { ...(meta.studio || {}), review }; saveMeta(dir, meta);
  return review;
}

// Five title + short caption options to choose from.
async function titleOptions(folder) {
  const { dir, meta } = find(folder);
  const text = await claude.ask(`${context()}Write 5 different title options for this short, each with a one-line caption for TikTok/Instagram. Vary the angle (curiosity, a number, a bold claim, a question), keep titles under 70 characters, start with "What If" only when it reads best, and use at most one emoji. Never promise something the video doesn't show.

Premise: ${meta.headline || meta.title}
Current title: ${meta.title}
Description: ${clip(meta.description, 600)}
Reply with only JSON: [{"title": "", "caption": ""}]`, 'ideas', 'Titles for ' + (meta.headline || meta.title));
  const options = json(text, '[', ']').slice(0, 5).map(o => ({ title: clip(o.title, 100), caption: clip(o.caption, 200) })).filter(o => o.title);
  if (!options.length) throw new Error('Claude replied without titles');
  meta.studio = { ...(meta.studio || {}), titleOptions: options }; saveMeta(dir, meta);
  return options;
}

// Uses one option: sets the title and refreshes the short captions that quote the old one.
function applyTitle(folder, title, caption) {
  const { dir, meta } = find(folder), t = clip(title, 100);
  if (!t) throw new Error('Pick a title first');
  meta.title = t;
  if (caption && meta.captions) for (const k of Object.keys(meta.captions)) meta.captions[k] = clip(caption, 200) + ' ' + (String(meta.captions[k]).match(/#\w+/g) || []).join(' ');
  saveMeta(dir, meta);
}

module.exports = { results, learnFromResults, reviewVideo, titleOptions, applyTitle, MIN_VIDEOS };
