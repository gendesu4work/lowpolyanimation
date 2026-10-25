// YouTube Data API v3: OAuth sign-in, resumable upload with native scheduling (publishAt), view stats.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { P, config, readJson, tokens, api, captionFor } = require('../lib/common');
const { loopback, b64url } = require('../lib/oauth');

const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/youtube.force-ssl'];
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Keys come from config.json, or else from the client_secret_*.json Google lets you download, dropped into secrets/.
function creds() {
  const c = { ...config().platforms.youtube };
  if (!c.clientId || !c.clientSecret) {
    const dir = path.join(P.root, 'secrets');
    const file = fs.existsSync(dir) && fs.readdirSync(dir).find(f => /^client_secret.*\.json$/.test(f));
    if (!file) throw new Error('YouTube keys missing: put the client_secret_*.json from Google Cloud in the secrets folder (see README.md)');
    const j = readJson(path.join(dir, file)), k = j.installed || j.web;
    c.clientId = k.client_id; c.clientSecret = k.client_secret;
  }
  return c;
}

async function auth() {
  const c = creds(), verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const { code, redirectUri } = await loopback({ port: 8791, buildUrl: (redirect_uri, state) => 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: c.clientId, redirect_uri, response_type: 'code', scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent',
    state, code_challenge: challenge, code_challenge_method: 'S256' }) });
  const { body } = await api(TOKEN_URL, { method: 'POST', body: new URLSearchParams({
    code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier }) });
  if (!body.refresh_token) throw new Error('Google returned no refresh token: remove the app at myaccount.google.com/permissions and sign in again');
  tokens.set('youtube', { refresh_token: body.refresh_token, access_token: body.access_token, expires_at: Date.now() + body.expires_in * 1000, scope: body.scope || '' });
  const { body: ch } = await api('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: 'Bearer ' + body.access_token } });
  if (!ch.items || !ch.items.length) throw new Error('signed in, but this Google account has no YouTube channel');
  console.log('YouTube connected: ' + ch.items[0].snippet.title);
}

async function access() {
  const t = tokens.get('youtube');
  if (!t) throw new Error('YouTube is not connected: run npm run auth -- youtube');
  if (Date.now() < t.expires_at - 60000) return t.access_token;
  const c = creds();
  const { body } = await api(TOKEN_URL, { method: 'POST', body: new URLSearchParams({
    client_id: c.clientId, client_secret: c.clientSecret, refresh_token: t.refresh_token, grant_type: 'refresh_token' }) });
  tokens.set('youtube', { ...t, access_token: body.access_token, expires_at: Date.now() + body.expires_in * 1000 });
  return body.access_token;
}

// Uploads now; when `at` is more than 15 minutes away the video stays private and YouTube publishes it at that time.
// `privateOnly` uploads a private video that never goes public on its own: used for tests, and for every upload
// when config sets "manualPublish" (the user makes it public in YouTube Studio).
async function publish(file, meta, at, { privateOnly = creds().manualPublish } = {}) {
  const token = await access(), size = fs.statSync(file).size, future = !privateOnly && at - Date.now() > 15 * 60000;
  const status = { privacyStatus: future || privateOnly ? 'private' : 'public', selfDeclaredMadeForKids: false };
  if (future) status.publishAt = new Date(at).toISOString();
  const snippet = { title: meta.title.slice(0, 100), description: captionFor(meta, 'youtube').slice(0, 5000), tags: meta.tags || [], categoryId: creds().categoryId || '24' };
  const { headers } = await api('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST', body: JSON.stringify({ snippet, status }),
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(size) } });
  const { body } = await api(headers.get('location'), { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: fs.readFileSync(file) });
  return { id: body.id, url: 'https://youtube.com/shorts/' + body.id, scheduledFor: future ? status.publishAt : null,
    ...(privateOnly ? { private: true, studio: `https://studio.youtube.com/video/${body.id}/edit` } : {}) };
}

async function stats(ids) {
  const out = {}, token = await access();
  for (let i = 0; i < ids.length; i += 50) {
    const { body } = await api('https://www.googleapis.com/youtube/v3/videos?part=statistics,status&id=' + ids.slice(i, i + 50).join(','), { headers: { Authorization: 'Bearer ' + token } });
    for (const v of body.items || []) out[v.id] = { views: +v.statistics.viewCount || 0, likes: +v.statistics.likeCount || 0, comments: +v.statistics.commentCount || 0, privacy: v.status && v.status.privacyStatus };
  }
  return out;
}

// Channel totals for the dashboard.
async function account() {
  const { body } = await api('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true', { headers: { Authorization: 'Bearer ' + await access() } });
  const c = body.items[0], s = c.statistics;
  return { name: c.snippet.title, followers: s.hiddenSubscriberCount ? null : +s.subscriberCount, views: +s.viewCount, posts: +s.videoCount };
}

module.exports = { access, auth, publish, stats, account, nativeSchedule: true };
