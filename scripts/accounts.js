// Snapshots each platform's account totals (followers/subscribers, views, posts) into data/accounts.json, one row per day.
// usage: node scripts/accounts.js
const path = require('path');
const { P, readJson, writeJson, enabledPlatforms, log } = require('./lib/common');
const { REG } = require('./lib/platforms');

const FILE = path.join(P.root, 'data', 'accounts.json');

async function refreshAccounts() {
  const data = readJson(FILE, { latest: {}, history: [] }), today = new Date().toISOString().slice(0, 10);
  let row = data.history.find(h => h.date === today);
  if (!row) { row = { date: today }; data.history.push(row); }
  for (const p of enabledPlatforms()) {
    try {
      const a = await REG[p]().account();
      data.latest[p] = { ...a, at: new Date().toISOString() };
      row[p] = { followers: a.followers, views: a.views };
    } catch (e) { log(`${p} account stats skipped: ${e.message}`); }
  }
  writeJson(FILE, data);
  return data;
}

if (require.main === module)
  refreshAccounts().then(d => { for (const [p, a] of Object.entries(d.latest)) console.log(`${p.padEnd(9)} ${a.name}: ${a.followers ?? '-'} followers, ${a.views ?? '-'} views`); })
    .catch(e => { console.error(e.message); process.exit(1); });

module.exports = { refreshAccounts, FILE };
