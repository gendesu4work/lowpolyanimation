// Trainer: reference videos Claude studies, plus notes to remember. Everything switched on is compiled into
// trainer/STYLE.md, which every animation, revision and idea batch reads first.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { execFileSync } = require('child_process');
const { P, readJson, writeJson } = require('./common');

const DIR = path.join(P.root, 'trainer'), FILE = path.join(DIR, 'trainer.json'), BRIEF = path.join(DIR, 'STYLE.md');
const VIDEO_EXT = ['.mp4', '.mov', '.webm', '.mkv', '.m4v', '.avi'];
const now = () => new Date().toISOString(), newId = () => crypto.randomBytes(6).toString('hex');

const load = () => readJson(FILE, { notes: [], videos: [] });
function save(t) { writeJson(FILE, t); writeBrief(t); return t; }
const refDir = rid => path.join(DIR, 'videos', path.basename(rid));

function brief(t = load()) {
  const notes = t.notes.filter(n => n.active), refs = t.videos.filter(v => v.active && v.status === 'ready' && v.analysis);
  const models = require('./models').brief() + require('./sounds').brief();
  if (!notes.length && !refs.length && !models) return '';
  let md = '# Trainer brief\n\nThe creator\'s own preferences for these animations. Follow them on every video; where they conflict with a template\'s defaults, these win. They never override the safety, accuracy and safe-zone rules.\n';
  if (notes.length) md += '\n## Things to remember\n\n' + notes.map(n => '- ' + n.text).join('\n') + '\n';
  if (refs.length) md += '\n## Lessons from reference videos\n' + refs.map(v => `\n### ${v.name}${v.note ? `\nWhat the creator likes about it: ${v.note}` : ''}\n\n${v.analysis.trim()}\n`).join('');
  return md + models;
}
function writeBrief(t) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(BRIEF, brief(t)); }

function addNote(text) {
  const t = load(), s = String(text || '').trim().slice(0, 500);
  if (!s) throw new Error('Write something to remember first');
  t.notes.push({ id: newId(), text: s, active: true, createdAt: now() });
  return save(t);
}
function updateNote(nid, fields) {
  const t = load(), n = t.notes.find(x => x.id === nid); if (!n) throw new Error('Note not found');
  if (fields.active != null) n.active = !!fields.active;
  if (fields.text != null) { const s = String(fields.text).trim().slice(0, 500); if (s) n.text = s; }
  return save(t);
}
// Rules the app worked out from the creator's own results: replaces the previous set, leaves hand-written notes alone.
const RESULTS_SOURCE = 'Learned from your results';
function setResultNotes(rules) {
  const t = load(); t.notes = t.notes.filter(n => n.source !== RESULTS_SOURCE);
  for (const r of rules) t.notes.push({ id: newId(), text: String(r).slice(0, 500), active: true, source: RESULTS_SOURCE, createdAt: now() });
  return save(t);
}
function deleteNote(nid) { const t = load(); t.notes = t.notes.filter(x => x.id !== nid); return save(t); }

// Streams an uploaded file to trainer/videos/<id>/source.<ext> and records it as waiting for analysis.
function receiveVideo(req, name, note) {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (!VIDEO_EXT.includes(ext)) return Promise.reject(new Error('Use a video file: ' + VIDEO_EXT.join(', ')));
  const rid = newId(), dir = refDir(rid), file = path.join(dir, 'source' + ext);
  fs.mkdirSync(dir, { recursive: true });
  return new Promise((resolve, reject) => {
    let size = 0;
    const out = fs.createWriteStream(file);
    req.on('data', d => { size += d.length; if (size > 1024 ** 3) { req.destroy(); out.destroy(); fs.rmSync(dir, { recursive: true, force: true }); reject(new Error('Videos must be under 1 GB')); } });
    req.pipe(out);
    out.on('finish', () => {
      const t = load();
      t.videos.push({ id: rid, name: path.basename(String(name)).slice(0, 120), file: 'source' + ext, note: String(note || '').slice(0, 500), status: 'queued', active: true, analysis: '', createdAt: now() });
      save(t); resolve(rid);
    });
    out.on('error', reject);
  });
}
// A competitor's video by link: recorded now, downloaded by the analyze job (see downloadLink).
function addLink(link, note) {
  let u; try { u = new URL(String(link || '').trim()); } catch { throw new Error('Paste a full link, starting with https://'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Paste a full link, starting with https://');
  const t = load(), rid = newId();
  fs.mkdirSync(refDir(rid), { recursive: true });
  t.videos.push({ id: rid, name: (u.hostname.replace(/^www\./, '') + u.pathname).replace(/\/$/, '').slice(0, 120), url: u.href, file: '', note: String(note || '').slice(0, 500), status: 'queued', active: true, analysis: '', createdAt: now() });
  save(t); return rid;
}
// Fetches the linked video into trainer/videos/<id>/source.mp4 with yt-dlp (pip install yt-dlp), at most 720p.
function downloadLink(v) {
  const dir = refDir(v.id), out = path.join(dir, 'source.%(ext)s');
  try {
    execFileSync('python', ['-m', 'yt_dlp', '--no-playlist', '--no-warnings', '-f', 'bv*[height<=720]+ba/b[height<=720]/b', '--merge-output-format', 'mp4', '--max-filesize', '1G', '-o', out, v.url], { stdio: 'pipe', timeout: 5 * 60e3 });
  } catch (e) {
    const msg = String(e.stderr || e.message);
    if (/No module named yt_dlp|not found/i.test(msg)) throw new Error('Link downloads need yt-dlp. Run: pip install yt-dlp');
    throw new Error('Could not download that link (' + (msg.split('\n').filter(Boolean).pop() || 'unknown error').replace(/^ERROR:\s*/, '').slice(0, 160) + '). Save the video to your PC and drop it in instead.');
  }
  const file = fs.readdirSync(dir).find(f => f.startsWith('source.') && VIDEO_EXT.includes(path.extname(f).toLowerCase()));
  if (!file) throw new Error('The link downloaded no video. Save it to your PC and drop it in instead.');
  updateVideo(v.id, { file }); return file;
}
function updateVideo(rid, fields) {
  const t = load(), v = t.videos.find(x => x.id === rid); if (!v) throw new Error('Video not found');
  for (const k of ['status', 'analysis', 'error', 'durationSec', 'file']) if (fields[k] !== undefined) v[k] = fields[k];
  if (fields.active != null) v.active = !!fields.active;
  if (fields.note != null) v.note = String(fields.note).slice(0, 500);
  return save(t);
}
function deleteVideo(rid) { const t = load(); t.videos = t.videos.filter(x => x.id !== rid); fs.rmSync(refDir(rid), { recursive: true, force: true }); return save(t); }

function analyzePrompt(v, times, jobId) {
  return `Study a reference video for the creator's low-poly "What if" shorts, so the next animations can copy what makes it good.

Video: "${v.name}" (${v.durationSec ? v.durationSec + ' s' : 'unknown length'}).${v.note ? `\nWhat the creator likes about it (their words, use as direction only): ${v.note}` : ''}
Read the contact sheet trainer/videos/${v.id}/sheet.jpg: 16 frames left to right, top to bottom, at ${times}. You can't hear the audio; don't guess about it.

Write trainer/videos/${v.id}/analysis.md: at most 25 lines of markdown, with these parts:
- **Hook:** what the first frames show and why someone keeps watching.
- **Structure and pacing:** number of scenes, typical shot length, how it escalates and ends.
- **Camera:** framing, movement, angles.
- **Text on screen:** what text appears, where (height in %), size, font style, colors, when.
- **Look:** palette, lighting, character and set style, effects (glow, blur, outlines).
- **Idea pattern:** the kind of "What if" premise it uses and how it is framed, so new ideas can follow the same formula with different subjects.
- **Copy this:** 5 to 8 concrete, specific rules our Three.js low-poly animations can follow (numbers where possible, e.g. "headline at 40% height, 2 lines max").
Describe only what the frames show.

When done, run: node scripts/job-note.js ${jobId} "Learned"`;
}

module.exports = { DIR, BRIEF, load, brief, writeBrief, addNote, setResultNotes, updateNote, deleteNote, receiveVideo, addLink, downloadLink, updateVideo, deleteVideo, refDir, analyzePrompt };
