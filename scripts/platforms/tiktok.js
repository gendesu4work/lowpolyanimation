// TikTok Content Posting API (Direct Post): desktop OAuth with PKCE, chunked file upload, video stats.
const fs = require('fs'), crypto = require('crypto');
const { config, tokens, api, sleep, captionFor } = require('../lib/common');
const { loopback, b64url } = require('../lib/oauth');

const BASE = 'https://open.tiktokapis.com';
const CHUNK = 10 * 1024 * 1024, SINGLE_MAX = 64 * 1024 * 1024;

function creds() {
  const c = config().platforms.tiktok;
  if (!c.clientKey || !c.clientSecret) throw new Error('TikTok clientKey/clientSecret missing in config.json (see README.md)');
  return c;
}

// Optional scopes, switched on in config.json once added to the TikTok app: video.list (per-video views), user.info.stats (followers, likes).
const scopes = () => ['user.info.basic', 'video.publish', 'video.upload', ...(creds().viewStats ? ['video.list'] : []), ...(creds().accountStats ? ['user.info.stats'] : [])].join(',');

function saveToken(body) {
  tokens.set('tiktok', { access_token: body.access_token, refresh_token: body.refresh_token, open_id: body.open_id, scope: body.scope || '',
    expires_at: Date.now() + body.expires_in * 1000, refresh_expires_at: Date.now() + body.refresh_expires_in * 1000 });
}
const form = obj => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(obj) });

async function auth() {
  const c = creds(), verifier = b64url(crypto.randomBytes(48));
  // TikTok's desktop flow expects the PKCE challenge as hex, not base64url
  const challenge = crypto.createHash('sha256').update(verifier).digest('hex');
  const { code, redirectUri } = await loopback({ port: 8793, buildUrl: (redirect_uri, state) => 'https://www.tiktok.com/v2/auth/authorize/?' + new URLSearchParams({
    client_key: c.clientKey, scope: scopes(), response_type: 'code', redirect_uri, state,
    code_challenge: challenge, code_challenge_method: 'S256' }) });
  const { body } = await api(BASE + '/v2/oauth/token/', form({ client_key: c.clientKey, client_secret: c.clientSecret, code,
    grant_type: 'authorization_code', redirect_uri: redirectUri, code_verifier: verifier }));
  if (!body.access_token) throw new Error('TikTok sign-in failed: ' + JSON.stringify(body));
  saveToken(body);
  const user = await call('GET', '/v2/user/info/?fields=open_id,display_name');
  console.log('TikTok connected: ' + user.user.display_name);
}

async function access() {
  const t = tokens.get('tiktok'), c = creds();
  if (!t) throw new Error('TikTok is not connected: run npm run auth -- tiktok');
  if (Date.now() < t.expires_at - 60000) return t.access_token;
  if (Date.now() > t.refresh_expires_at) throw new Error('TikTok sign-in expired: run npm run auth -- tiktok');
  const { body } = await api(BASE + '/v2/oauth/token/', form({ client_key: c.clientKey, client_secret: c.clientSecret, grant_type: 'refresh_token', refresh_token: t.refresh_token }));
  if (!body.access_token) throw new Error('TikTok token refresh failed: ' + JSON.stringify(body));
  saveToken(body);
  return body.access_token;
}

// TikTok reports API errors inside a 200 response as error.code != "ok".
async function call(method, p, json) {
  const { body } = await api(BASE + p, { method, headers: { Authorization: 'Bearer ' + await access(), 'Content-Type': 'application/json; charset=UTF-8' },
    body: json ? JSON.stringify(json) : undefined });
  if (body.error && body.error.code !== 'ok') throw new Error(`TikTok ${p}: ${body.error.code} ${body.error.message}`);
  return body.data;
}

// Sends the file in TikTok's chunk sizes to an upload URL from an init call.
async function uploadChunks(url, file) {
  const size = fs.statSync(file).size, count = size <= SINGLE_MAX ? 1 : Math.floor(size / CHUNK), chunk = count === 1 ? size : CHUNK, buf = fs.readFileSync(file);
  for (let i = 0; i < count; i++) {
    const s = i * chunk, e = i === count - 1 ? size : s + chunk; // the last chunk takes the remainder
    const r = await fetch(url, { method: 'PUT', body: buf.subarray(s, e), headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${s}-${e - 1}/${size}` } });
    if (!r.ok) throw new Error(`TikTok upload chunk ${i + 1}/${count} -> ${r.status}: ${(await r.text()).slice(0, 300)}`);
  }
}
// Draft upload: the video lands in the creator's TikTok inbox to finish and post from the app (works before TikTok's audit).
async function publishDraft(file) {
  const size = fs.statSync(file).size, count = size <= SINGLE_MAX ? 1 : Math.floor(size / CHUNK);
  const init = await call('POST', '/v2/post/publish/inbox/video/init/', { source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: count === 1 ? size : CHUNK, total_chunk_count: count } });
  await uploadChunks(init.upload_url, file);
  return { id: null, publishId: init.publish_id, privacy: 'DRAFT', url: null, scheduledFor: null, draft: true };
}

async function publish(file, meta) {
  const mode = creds().mode || 'auto';
  if (mode === 'draft') return publishDraft(file);
  try { return await publishDirect(file, meta); }
  catch (e) {
    // before the audit TikTok only allows direct posts to private accounts; fall back to the inbox
    if (mode === 'auto' && /unaudited_client_can_only_post_to_private_accounts/.test(e.message)) {
      if (!String((tokens.get('tiktok') || {}).scope).includes('video.upload')) throw new Error('TikTok only accepts direct posts to a private account before its review. Either make your TikTok account private, or sign in again (npm run auth -- tiktok) so the app can send videos to your TikTok inbox as drafts.');
      return publishDraft(file);
    }
    throw e;
  }
}

async function publishDirect(file, meta) {
  const info = await call('POST', '/v2/post/publish/creator_info/query/', {});
  const want = creds().privacy || 'SELF_ONLY';
  // unaudited apps only get SELF_ONLY; use the configured level once TikTok allows it
  const privacy = info.privacy_level_options.includes(want) ? want : 'SELF_ONLY';
  const size = fs.statSync(file).size;
  const count = size <= SINGLE_MAX ? 1 : Math.floor(size / CHUNK), chunk = count === 1 ? size : CHUNK;
  const init = await call('POST', '/v2/post/publish/video/init/', {
    post_info: { title: captionFor(meta, 'tiktok').slice(0, 2200), privacy_level: privacy, disable_comment: false, disable_duet: false,
      disable_stitch: false, video_cover_timestamp_ms: 1000, is_aigc: config().aiDisclosure !== false },
    source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunk, total_chunk_count: count } });
  const buf = fs.readFileSync(file);
  for (let i = 0; i < count; i++) {
    const s = i * chunk, e = i === count - 1 ? size : s + chunk; // the last chunk takes the remainder
    const r = await fetch(init.upload_url, { method: 'PUT', body: buf.subarray(s, e), headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${s}-${e - 1}/${size}` } });
    if (!r.ok) throw new Error(`TikTok upload chunk ${i + 1}/${count} -> ${r.status}: ${(await r.text()).slice(0, 300)}`);
  }
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const s = await call('POST', '/v2/post/publish/status/fetch/', { publish_id: init.publish_id });
    if (s.status === 'FAILED') throw new Error('TikTok rejected the post: ' + s.fail_reason);
    if (s.status === 'PUBLISH_COMPLETE') {
      const id = (s.publicaly_available_post_id || [])[0]; // (sic) TikTok's field name
      return { id: id ? String(id) : null, publishId: init.publish_id, privacy, url: null, scheduledFor: null };
    }
  }
  // still processing: TikTok finishes it on its own
  return { id: null, publishId: init.publish_id, privacy, url: null, scheduledFor: null };
}

async function stats(ids) {
  const out = {}, t = tokens.get('tiktok');
  if (!t || !String(t.scope).includes('video.list')) return out; // no view-count permission granted

  for (let i = 0; i < ids.length; i += 20) {
    const d = await call('POST', '/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count', { filters: { video_ids: ids.slice(i, i + 20) } });
    for (const v of d.videos || []) out[v.id] = { views: v.view_count || 0, likes: v.like_count || 0, comments: v.comment_count || 0, shares: v.share_count || 0 };
  }
  return out;
}

// Profile totals for the dashboard; follower and like counts need the user.info.stats scope.
async function account() {
  const hasStats = String((tokens.get('tiktok') || {}).scope).includes('user.info.stats');
  const u = (await call('GET', '/v2/user/info/?fields=display_name' + (hasStats ? ',follower_count,likes_count,video_count' : ''))).user;
  return { name: u.display_name, followers: hasStats ? u.follower_count : null, likes: hasStats ? u.likes_count : null, views: null, posts: hasStats ? u.video_count : null };
}

module.exports = { auth, publish, stats, account, nativeSchedule: false };
