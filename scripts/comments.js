// Replies to new comments on YouTube and Facebook with a short, positive reply that is different every time.
// Claude (cheap model, one step per batch) writes the replies; rude, spammy or risky comments are skipped, not answered.
// usage: node scripts/comments.js [--dry-run]     (the app also runs it every 15 minutes while switched on)
const path = require('path');
const { P, readJson, writeJson, listVideos, tokens, api, log, sleep } = require('./lib/common');
const claude = require('./lib/claude');

const FILE = path.join(P.root, 'data', 'comments.json');
const DEFAULT = { enabled: false, platforms: { youtube: true, facebook: true }, dailyCap: 20, handled: {}, recent: [] };
const BATCH = 8, MAX_REPLY = 160;

const load = () => { const d = readJson(FILE, {}); return { ...DEFAULT, ...d, platforms: { ...DEFAULT.platforms, ...(d.platforms || {}) }, handled: d.handled || {}, recent: d.recent || [] }; };
const save = d => writeJson(FILE, { ...d, recent: d.recent.slice(-200), handled: trimHandled(d.handled) });
function trimHandled(h) { // keep the last ~3000 so the file stays small
  const e = Object.entries(h); return e.length <= 3000 ? h : Object.fromEntries(e.slice(-3000));
}
const repliedToday = d => d.recent.filter(r => r.status === 'replied' && new Date(r.at).toDateString() === new Date().toDateString()).length;

// ---------- YouTube ----------
const yt = {
  name: 'youtube',
  ready() { const t = tokens.get('youtube'); return !!t && String(t.scope || '').includes('youtube.force-ssl'); },
  async list() {
    const { access } = require('./platforms/youtube'), token = await access(), H = { headers: { Authorization: 'Bearer ' + token } };
    const mine = (await api('https://www.googleapis.com/youtube/v3/channels?part=id&mine=true', H)).body.items[0].id;
    const items = (await api('https://www.googleapis.com/youtube/v3/commentThreads?' + new URLSearchParams({ part: 'snippet', allThreadsRelatedToChannelId: mine, order: 'time', maxResults: '50', textFormat: 'plainText' }), H)).body.items || [];
    return items.filter(t => t.snippet.canReply && !t.snippet.totalReplyCount && (t.snippet.topLevelComment.snippet.authorChannelId || {}).value !== mine)
      .map(t => ({ id: t.id, author: t.snippet.topLevelComment.snippet.authorDisplayName, text: t.snippet.topLevelComment.snippet.textDisplay, at: t.snippet.topLevelComment.snippet.publishedAt }));
  },
  async reply(id, text) {
    const { access } = require('./platforms/youtube'), token = await access();
    await api('https://www.googleapis.com/youtube/v3/comments?part=snippet', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ snippet: { parentId: id, textOriginal: text } }) });
  },
};

// ---------- Facebook ----------
const G = (p, q) => `https://graph.facebook.com/v23.0/${p}` + (q ? '?' + new URLSearchParams(q) : '');
const fb = {
  name: 'facebook',
  ready() { return !!tokens.get('meta'); },
  async list() {
    const t = tokens.get('meta'), out = [], since = Date.now() - 14 * 864e5;
    for (const { meta } of listVideos()) {
      const s = (meta.platforms || {}).facebook;
      if (!s || !s.id || (s.status !== 'posted' && s.status !== 'scheduled') || Date.parse(meta.scheduledAt || 0) < since) continue;
      let items = [];
      try { items = (await api(G(`${s.id}/comments`, { fields: 'id,message,from,created_time,comment_count,can_comment', order: 'reverse_chronological', limit: '50', access_token: t.page_token }))).body.data || []; }
      catch (e) { log('facebook comments skipped for ' + s.id + ': ' + e.message.slice(0, 200)); continue; }
      for (const c of items) if (c.message && c.can_comment !== false && !c.comment_count && (!c.from || c.from.id !== t.page_id)) out.push({ id: c.id, author: c.from ? c.from.name : '', text: c.message, at: c.created_time });
    }
    return out;
  },
  async reply(id, text) {
    const t = tokens.get('meta');
    await api(G(`${id}/comments`), { method: 'POST', body: new URLSearchParams({ message: text, access_token: t.page_token }) });
  },
};
const ADAPTERS = { youtube: yt, facebook: fb };

// ---------- writing the replies ----------
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
function prompt(batch, recent) {
  return `You reply to comments on the creator's short "What if" animation videos (low-poly science and thought experiments).
Write ONE reply for each comment below. Rules:
- Positive, warm and friendly, in plain words. Reply to what the commenter actually said (use a detail from their comment).
- Short: one or two sentences, under ${MAX_REPLY} characters. At most one emoji, and only some of the time.
- Every reply must be clearly different from the others in this batch and from the recent replies listed below: vary the opening word, the structure and the length. Never start two replies the same way.
- No links, no hashtags. Never promise or confirm a future video or topic (for a suggestion just thank them for the idea). No medical, legal or money advice, no claims about facts you are not sure of.
- If a comment is rude, hateful, spam, a self-promotion or link, asks for something private, or is about something sensitive, skip it (reply: null). If it is just neutral or a question you cannot answer, thank them briefly and invite them to keep watching.
Do not mention that you are an AI or an automatic reply.

Recent replies already used (do not repeat their wording):
${recent.slice(-25).map(r => '- ' + r).join('\n') || '(none yet)'}

Comments (JSON): ${JSON.stringify(batch.map(c => ({ id: c.id, author: c.author, text: String(c.text).slice(0, 400) })))}

Answer with ONLY a JSON array like [{"id":"...","reply":"..."},{"id":"...","reply":null}], one entry per comment, no other text.`;
}
async function write(batch, recent) {
  const raw = await claude.ask(prompt(batch, recent), 'comments', batch.length + ' comments');
  const m = raw.match(/\[[\s\S]*\]/); if (!m) throw new Error('Claude did not return replies');
  return JSON.parse(m[0]);
}

// ---------- one pass ----------
async function runOnce({ dryRun = false } = {}) {
  const d = load(), result = { replied: 0, skipped: 0, problems: [] };
  let budget = d.dailyCap - repliedToday(d);
  for (const a of Object.values(ADAPTERS)) {
    if (!d.platforms[a.name]) continue;
    if (!a.ready()) { result.problems.push(`${a.name}: sign in again (npm run auth -- ${a.name === 'facebook' ? 'meta' : 'youtube'}) so the app may read and reply to comments`); continue; }
    let found;
    try { found = (await a.list()).filter(c => !d.handled[c.id]); } catch (e) { result.problems.push(`${a.name}: ${e.message.slice(0, 200)}`); continue; }
    if (dryRun) { result.problems.push(`${a.name}: ${found.length} new comments`); continue; }
    found.sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
    while (found.length && budget > 0) {
      const batch = found.splice(0, Math.min(BATCH, budget));
      let answers;
      try { answers = await write(batch, d.recent.filter(r => r.status === 'replied').map(r => r.reply)); }
      catch (e) { result.problems.push('writing replies: ' + e.message.slice(0, 200)); break; }
      for (const c of batch) {
        const ans = answers.find(x => x && x.id === c.id), text = ans && typeof ans.reply === 'string' ? ans.reply.trim() : null;
        const used = new Set(d.recent.map(r => norm(r.reply || '')));
        if (!text || text.length > MAX_REPLY + 40 || /https?:|www\.|#\w/.test(text) || used.has(norm(text))) {
          d.handled[c.id] = { at: new Date().toISOString(), status: 'skipped' };
          d.recent.push({ at: new Date().toISOString(), platform: a.name, comment: c.text.slice(0, 200), author: c.author, status: 'skipped' });
          result.skipped++; continue;
        }
        try {
          await a.reply(c.id, text);
          d.handled[c.id] = { at: new Date().toISOString(), status: 'replied' };
          d.recent.push({ at: new Date().toISOString(), platform: a.name, comment: c.text.slice(0, 200), author: c.author, reply: text, status: 'replied' });
          result.replied++; budget--; log(`${a.name} comment reply sent`);
          await sleep(4000 + Math.random() * 8000); // not all at the same second
        } catch (e) { result.problems.push(`${a.name} reply failed: ${e.message.slice(0, 200)}`); d.handled[c.id] = { at: new Date().toISOString(), status: 'failed' }; }
      }
      save(d);
    }
  }
  if (!dryRun) { d.lastRun = { at: new Date().toISOString(), ...result }; save(d); }
  return result;
}

function summary() {
  const d = load();
  return { enabled: d.enabled, platforms: d.platforms, dailyCap: d.dailyCap, repliedToday: repliedToday(d), lastRun: d.lastRun || null,
    ready: Object.fromEntries(Object.values(ADAPTERS).map(a => [a.name, a.ready()])), recent: d.recent.slice(-30).reverse() };
}
function setSettings(b) {
  const d = load();
  if (typeof b.enabled === 'boolean') d.enabled = b.enabled;
  if (b.platforms) for (const p of Object.keys(ADAPTERS)) if (typeof b.platforms[p] === 'boolean') d.platforms[p] = b.platforms[p];
  if (b.dailyCap != null) d.dailyCap = Math.max(1, Math.min(100, Math.round(+b.dailyCap) || DEFAULT.dailyCap));
  save(d);
}

if (require.main === module)
  runOnce({ dryRun: process.argv.includes('--dry-run') }).then(r => console.log(JSON.stringify(r, null, 2))).catch(e => { console.error(e.message); process.exit(1); });

module.exports = { runOnce, summary, setSettings, load, write };
