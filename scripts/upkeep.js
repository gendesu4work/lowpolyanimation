// Background upkeep for the Studio worker, at most every 30 minutes: posts due Instagram/TikTok uploads, retries
// failures, refreshes stats. Prints "upkeep ran" or "upkeep skipped" so the worker knows whether to sync.
// usage: node scripts/upkeep.js [--force]
const { execFileSync } = require('child_process'), path = require('path');
const { P, readJson, writeJson } = require('./lib/common');

const EVERY = 30 * 60e3, state = readJson(P.state, {});
if (!process.argv.includes('--force') && state.lastUpkeep && Date.now() - state.lastUpkeep < EVERY) { console.log('upkeep skipped'); process.exit(0); }
for (const s of ['scheduler.js', 'accounts.js']) execFileSync(process.execPath, [path.join(__dirname, s)], { stdio: 'inherit', cwd: P.root });
writeJson(P.state, { ...readJson(P.state, {}), lastUpkeep: Date.now() });
console.log('upkeep ran');
