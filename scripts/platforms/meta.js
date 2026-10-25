// Facebook Graph API: Facebook Login for the Page, then Reels with native scheduling. (Instagram has its own sign-in in instagram.js.)
const fs = require('fs');
const { config, tokens, api, captionFor } = require('../lib/common');
const { loopback } = require('../lib/oauth');

const ver = () => config().platforms.meta.graphVersion || 'v23.0';
const G = (p, q) => `https://graph.facebook.com/${ver()}/${p}` + (q ? '?' + new URLSearchParams(q) : '');
const SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'read_insights', 'business_management', 'pages_manage_engagement', 'pages_read_user_content'];

async function auth() {
  const c = config().platforms.meta;
  if (!c.appId || !c.appSecret) throw new Error('Meta appId/appSecret missing in config.json (see README.md)');
  const { code, redirectUri } = await loopback({ port: 8792, buildUrl: (redirect_uri, state) =>
    `https://www.facebook.com/${ver()}/dialog/oauth?` + new URLSearchParams({ client_id: c.appId, redirect_uri, state, scope: SCOPES.join(','), response_type: 'code' }) });
  const short = (await api(G('oauth/access_token', { client_id: c.appId, client_secret: c.appSecret, redirect_uri: redirectUri, code }))).body.access_token;
  // a long-lived user token yields Page tokens that don't expire
  const long = (await api(G('oauth/access_token', { grant_type: 'fb_exchange_token', client_id: c.appId, client_secret: c.appSecret, fb_exchange_token: short }))).body.access_token;
  const pages = (await api(G('me/accounts', { fields: 'id,name,access_token', access_token: long }))).body.data || [];
  if (!pages.length) throw new Error('no Facebook Pages found: allow your Page during sign-in');
  const page = pages.find(p => p.id === c.pageId) || pages[0];
  if (pages.length > 1 && !c.pageId) console.log('Several Pages found; using the first. Set platforms.meta.pageId to pick another:\n' + pages.map(p => `  ${p.id}  ${p.name}`).join('\n'));
  tokens.set('meta', { page_id: page.id, page_name: page.name, page_token: page.access_token });
  console.log(`Facebook connected: ${page.name}`);
}

function session() {
  const t = tokens.get('meta');
  if (!t) throw new Error('Facebook is not connected: run npm run auth -- meta');
  return t;
}

async function publish(file, meta, at) {
  const t = session(), future = at - Date.now() > 20 * 60000;
  const start = (await api(G(`${t.page_id}/video_reels`), { method: 'POST', body: new URLSearchParams({ upload_phase: 'start', access_token: t.page_token }) })).body;
  await api(start.upload_url || `https://rupload.facebook.com/video-upload/${ver()}/${start.video_id}`, { method: 'POST', body: fs.readFileSync(file),
    headers: { Authorization: 'OAuth ' + t.page_token, offset: '0', file_size: String(fs.statSync(file).size) } });
  const finish = { upload_phase: 'finish', video_id: start.video_id, description: captionFor(meta, 'facebook'), access_token: t.page_token,
    video_state: future ? 'SCHEDULED' : 'PUBLISHED' };
  if (future) finish.scheduled_publish_time = String(Math.floor(at / 1000));
  await api(G(`${t.page_id}/video_reels`), { method: 'POST', body: new URLSearchParams(finish) });
  return { id: start.video_id, url: `https://www.facebook.com/reel/${start.video_id}`, scheduledFor: future ? new Date(at).toISOString() : null };
}

// Best-effort: a metric Meta renamed or a missing permission shouldn't stop the rest.
async function stats(ids) {
  const t = session(), out = {};
  for (const id of ids) {
    try {
      const d = (await api(G(`${id}/video_insights`, { metric: 'blue_reels_play_count', access_token: t.page_token }))).body.data || [];
      out[id] = { views: d[0] ? +d[0].values[0].value || 0 : 0 };
    } catch (e) { console.warn(`facebook stats ${id}: ${e.message}`); }
  }
  return out;
}

// Page totals for the dashboard; Pages don't expose an all-time view count.
async function account() {
  const t = session();
  const p = (await api(G(t.page_id, { fields: 'name,followers_count,fan_count', access_token: t.page_token }))).body;
  return { name: p.name, followers: p.followers_count != null ? p.followers_count : p.fan_count, views: null, posts: null };
}

module.exports = { auth, publish, stats, account, nativeSchedule: true };
