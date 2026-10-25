// Instagram API with Instagram Login: signs in to the Instagram professional account directly (no Facebook Page link needed).
// Reels are posted when due by the scheduler; the 60-day token is refreshed automatically.
const fs = require('fs');
const { config, tokens, api, sleep, captionFor } = require('../lib/common');
const { loopback } = require('../lib/oauth');

const ver = () => config().platforms.meta.graphVersion || 'v23.0';
const G = (p, q) => `https://graph.instagram.com/${ver()}/${p}` + (q ? '?' + new URLSearchParams(q) : '');
const SCOPES = ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_insights'];
const DAY = 86400e3;

function creds() {
  const c = config().platforms.instagram;
  if (!c.appId || !c.appSecret) throw new Error('Instagram appId/appSecret missing in config.json: use the Instagram app ID and secret from the Meta app dashboard (see README.md)');
  return c;
}

async function auth() {
  const c = creds();
  const { code, redirectUri } = await loopback({ port: 8794, secure: true, buildUrl: (redirect_uri, state) => 'https://www.instagram.com/oauth/authorize?' + new URLSearchParams({
    client_id: c.appId, redirect_uri, response_type: 'code', scope: SCOPES.join(','), state, enable_fb_login: '0', force_reauth: 'true' }) });
  let { body } = await api('https://api.instagram.com/oauth/access_token', { method: 'POST', body: new URLSearchParams({
    client_id: c.appId, client_secret: c.appSecret, grant_type: 'authorization_code', redirect_uri: redirectUri, code }) });
  const short = (body.data ? body.data[0] : body).access_token;
  // swap the 1-hour token for a 60-day one
  ({ body } = await api('https://graph.instagram.com/access_token?' + new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: c.appSecret, access_token: short })));
  const me = (await api(G('me', { fields: 'user_id,username,account_type', access_token: body.access_token }))).body;
  tokens.set('instagram', { access_token: body.access_token, expires_at: Date.now() + body.expires_in * 1000, issued_at: Date.now(), user_id: me.user_id, username: me.username });
  console.log(`Instagram connected: @${me.username}` + (me.account_type && me.account_type !== 'BUSINESS' && me.account_type !== 'MEDIA_CREATOR' ? ` (account type ${me.account_type}: switch it to Professional)` : ''));
}

// Tokens last 60 days; refresh once they're over a day old and within 20 days of expiring.
async function session() {
  const t = tokens.get('instagram');
  if (!t) throw new Error('Instagram is not connected: run npm run auth -- instagram');
  if (Date.now() > t.expires_at) throw new Error('Instagram sign-in expired: run npm run auth -- instagram');
  if (t.expires_at - Date.now() < 20 * DAY && Date.now() - t.issued_at > DAY) {
    const { body } = await api('https://graph.instagram.com/refresh_access_token?' + new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: t.access_token }));
    Object.assign(t, { access_token: body.access_token, expires_at: Date.now() + body.expires_in * 1000, issued_at: Date.now() });
    tokens.set('instagram', t);
  }
  return t;
}

// Instagram Login accepts videos only by public link (no file upload), so it uses the copy on the creator's
// Facebook Page: Facebook's own CDN link, nothing third-party. Facebook is uploaded first by publish.js.
async function facebookVideoUrl(meta) {
  const fb = (meta.platforms || {}).facebook;
  if (!fb || !fb.id) throw new Error('Instagram needs the Facebook copy of this video first: post it to Facebook (switch Facebook on in config.json)');
  const m = tokens.get('meta'); if (!m) throw new Error('Facebook is not connected: run npm run auth -- meta');
  const v = (await api(`https://graph.facebook.com/${ver()}/${fb.id}?` + new URLSearchParams({ fields: 'source', access_token: m.page_token }))).body;
  if (!v.source) throw new Error('Facebook has not finished processing the video yet; it will be retried');
  return v.source;
}

async function publish(file, meta) {
  const t = await session(), video_url = await facebookVideoUrl(meta);
  const box = (await api(G(`${t.user_id}/media`), { method: 'POST', body: new URLSearchParams({
    media_type: 'REELS', video_url, caption: captionFor(meta, 'instagram').slice(0, 2200), share_to_feed: 'true', access_token: t.access_token }) })).body;
  for (let i = 0; ; i++) {
    const s = (await api(G(box.id, { fields: 'status_code,status', access_token: t.access_token }))).body;
    if (s.status_code === 'FINISHED') break;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error('Instagram could not process the video: ' + (s.status || s.status_code));
    if (i > 60) throw new Error('Instagram processing timed out');
    await sleep(10000);
  }
  const id = (await api(G(`${t.user_id}/media_publish`), { method: 'POST', body: new URLSearchParams({ creation_id: box.id, access_token: t.access_token }) })).body.id;
  const url = (await api(G(id, { fields: 'permalink', access_token: t.access_token }))).body.permalink;
  return { id, url, scheduledFor: null };
}

// Best-effort: a renamed metric shouldn't stop the other platforms' stats.
async function stats(ids) {
  const t = await session(), out = {};
  for (const id of ids) {
    try {
      const d = (await api(G(`${id}/insights`, { metric: 'views,reach,likes,comments,shares,saved', access_token: t.access_token }))).body.data || [];
      const m = Object.fromEntries(d.map(x => [x.name, x.total_value ? x.total_value.value : x.values && x.values[0] ? x.values[0].value : 0]));
      out[id] = { views: +m.views || 0, likes: +m.likes || 0, comments: +m.comments || 0, shares: +m.shares || 0, saves: +m.saved || 0 };
    } catch (e) { console.warn(`instagram stats ${id}: ${e.message}`); }
  }
  return out;
}

// Profile totals for the dashboard.
async function account() {
  const t = await session();
  const me = (await api(G('me', { fields: 'username,followers_count,media_count', access_token: t.access_token }))).body;
  return { name: '@' + me.username, followers: me.followers_count, views: null, posts: me.media_count };
}

module.exports = { auth, publish, stats, account, nativeSchedule: false };
