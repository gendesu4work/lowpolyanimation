// Local dashboard: serves dashboard/index.html and the data behind it on http://localhost:8800.
// usage: npm run dashboard   (Refresh on the page pulls fresh numbers from every platform)
const http = require('http'), fs = require('fs'), path = require('path');
const { P, readJson, config, listVideos, openBrowser } = require('./lib/common');
const { refreshStats } = require('./stats');
const { refreshAccounts, FILE } = require('./accounts');

const PORT = 8800, PAGE = path.join(P.root, 'dashboard', 'index.html');

function data() {
  const cfg = config();
  return {
    timezone: cfg.audienceTimezone,
    accounts: readJson(FILE, { latest: {}, history: [] }),
    videos: listVideos().map(({ dir, meta }) => ({
      folder: path.basename(dir), headline: meta.headline, title: meta.title, scheduledAt: meta.scheduledAt || null,
      platforms: Object.fromEntries(Object.entries(meta.platforms || {}).map(([p, s]) => [p, { status: s.status, url: s.url || null, stats: s.stats || null, error: s.error || null }])),
    })),
  };
}

const send = (res, code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };

http.createServer(async (req, res) => {
  try {
    if (req.url === '/') return send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(PAGE));
    if (req.url === '/api/data') return send(res, 200, 'application/json', JSON.stringify(data()));
    if (req.url === '/api/refresh' && req.method === 'POST') {
      await refreshStats(); await refreshAccounts();
      return send(res, 200, 'application/json', JSON.stringify(data()));
    }
    send(res, 404, 'text/plain', 'not found');
  } catch (e) { send(res, 500, 'application/json', JSON.stringify({ error: e.message })); }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Dashboard on http://localhost:${PORT}  (Ctrl+C to stop)`);
  if (!process.argv.includes('--no-open')) openBrowser(`http://localhost:${PORT}`);
});
