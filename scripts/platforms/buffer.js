// Buffer (buffer.com) as a posting backend for YouTube, Instagram and TikTok: one API key instead of three developer apps.
// Buffer's API takes a public video link, not a file upload, so videos are hosted first (scripts/lib/hosting.js).
const { config, tokens, api } = require('../lib/common');
const { hostVideo } = require('../lib/hosting');

const ENDPOINT = 'https://api.buffer.com';
const SERVICES = ['youtube', 'instagram', 'tiktok', 'facebook'];

const cfg = () => {
  const c = (config().platforms || {}).buffer;
  if (!c || !c.apiKey) throw new Error('Buffer apiKey missing in config.json (platforms.buffer.apiKey): create one at publish.buffer.com/settings/api (see README.md)');
  return c;
};

// GraphQL literal from a JS value; { enum: 'x' } prints x unquoted.
function lit(v) {
  if (v && typeof v === 'object' && 'enum' in v) return v.enum;
  if (Array.isArray(v)) return '[' + v.map(lit).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => `${k}:${lit(x)}`).join(',') + '}';
  return JSON.stringify(v);
}

async function gql(query) {
  const { body } = await api(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg().apiKey }, body: JSON.stringify({ query }) });
  if (body.errors && body.errors.length) throw new Error('Buffer: ' + body.errors.map(e => e.message).join('; '));
  return body.data;
}

// npm run auth -- buffer: checks the key and remembers which Buffer channel is which service.
async function auth() {
  const orgs = (await gql('query { account { organizations { id name } } }')).account.organizations;
  if (!orgs.length) throw new Error('This Buffer account has no organization');
  const map = {};
  for (const o of orgs) {
    const chans = (await gql(`query { channels(input: { organizationId: ${lit(o.id)} }) { id name service } }`)).channels;
    for (const ch of chans) if (SERVICES.includes(String(ch.service).toLowerCase()) && !map[String(ch.service).toLowerCase()]) map[String(ch.service).toLowerCase()] = { id: ch.id, name: ch.name, organizationId: o.id };
  }
  tokens.set('buffer', { channels: map });
  console.log('Buffer channels found:\n' + (Object.entries(map).map(([s, c]) => `  ${s.padEnd(10)} ${c.name}`).join('\n') || '  none: connect channels in Buffer first'));
}

function channel(platform) {
  const c = ((tokens.get('buffer') || {}).channels || {})[platform];
  if (!c) throw new Error(`No Buffer channel for ${platform}: connect it in Buffer, then run npm run auth -- buffer`);
  return c;
}

// Per-network settings; Buffer's field names come from developers.buffer.com (PostInputMetaData).
function metadataFor(platform, meta) {
  const ai = config().aiDisclosure !== false;
  if (platform === 'instagram') return { instagram: { type: { enum: 'reel' }, shouldShareToFeed: true, isAiGenerated: ai } };
  if (platform === 'youtube') return { youtube: { title: String(meta.title).slice(0, 100), categoryId: String((config().platforms.youtube || {}).categoryId || '24'), isAiGenerated: ai } };
  if (platform === 'tiktok') return { tiktok: { isAiGenerated: ai } };
  return undefined;
}

function publisher(platform, captionFor) {
  return async function publish(file, meta, at) {
    const ch = channel(platform);
    const url = await hostVideo(file, meta);
    const future = at - Date.now() > 5 * 60e3;
    const input = { text: captionFor(meta, platform), channelId: ch.id, schedulingType: { enum: 'automatic' },
      mode: { enum: future ? 'customScheduled' : 'shareNow' }, dueAt: future ? new Date(at).toISOString() : undefined,
      assets: [{ video: { url } }], metadata: metadataFor(platform, meta) };
    const r = (await gql(`mutation { createPost(input: ${lit(input)}) { ... on PostActionSuccess { post { id } } ... on MutationError { message } } }`)).createPost;
    if (!r || !r.post) throw new Error('Buffer rejected the post: ' + ((r && r.message) || 'unknown error'));
    return { id: r.post.id, url: null, scheduledFor: new Date(future ? at : Date.now()).toISOString(), via: 'buffer' };
  };
}

// Buffer's free plan has no view counts through the API, so stats stay empty for these platforms.
function forPlatform(platform, captionFor) {
  return { publish: publisher(platform, captionFor), stats: async () => ({}), account: async () => ({ name: '(via Buffer)', followers: null, views: null, posts: null }), nativeSchedule: true, auth };
}

// Buffer posts start as "scheduled" here; once Buffer has sent one, mark it posted and keep its link (or mark it failed).
async function syncPosts(videos) {
  let changed = 0;
  for (const { dir, meta } of videos) {
    let touched = false;
    for (const [p, s] of Object.entries(meta.platforms || {})) {
      if (s.via !== 'buffer' || s.status !== 'scheduled' || Date.parse(s.scheduledFor || 0) > Date.now() + 60e3) continue;
      try {
        const r = (await gql(`query { post(input: { id: ${lit(s.id)} }) { status sentAt externalLink } }`)).post;
        if (!r) continue;
        if (r.status === 'sent') { Object.assign(s, { status: 'posted', url: r.externalLink || s.url || null, sentAt: r.sentAt }); touched = true; }
        else if (r.status === 'error' || r.status === 'failed') { Object.assign(s, { status: 'failed', error: 'Buffer could not publish this post: open it in Buffer to see why' }); touched = true; }
      } catch (e) { /* Buffer unreachable or the post is gone: try again next time */ }
    }
    if (touched) { require('../lib/common').saveMeta(dir, meta); changed++; }
  }
  return changed;
}

module.exports = { auth, forPlatform, lit, syncPosts };
