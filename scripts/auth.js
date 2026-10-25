// One-time sign-in per platform. usage: npm run auth -- youtube|meta|instagram|tiktok
const which = process.argv[2];
const mods = { youtube: () => require('./platforms/youtube'), meta: () => require('./platforms/meta'),
  instagram: () => require('./platforms/instagram'), tiktok: () => require('./platforms/tiktok'), buffer: () => require('./platforms/buffer') };
if (!mods[which]) { console.error('usage: npm run auth -- youtube|meta|instagram|tiktok|buffer   (meta is the Facebook Page)'); process.exit(1); }
mods[which]().auth().catch(e => { console.error(e.message); process.exit(1); });
