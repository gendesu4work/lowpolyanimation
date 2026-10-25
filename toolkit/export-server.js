// Serves the page and receives rendered frames + soundtrack from it.
// usage: node export-server.js <page dir> <output dir> <port>
const http = require('http'), fs = require('fs'), path = require('path');
const [ROOT, OUT, PORT] = [process.argv[2], process.argv[3], +process.argv[4] || 8766];
fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json' };

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (req.method === 'POST') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      let file = null;
      const m = url.match(/^\/frame\/(\d+)$/);
      if (m) file = path.join(OUT, 'frames', 'f_' + m[1].padStart(5, '0') + '.jpg');
      else if (url === '/audio') file = path.join(OUT, 'audio.wav');
      if (!file) { res.writeHead(404); return res.end(); }
      fs.writeFileSync(file, Buffer.concat(chunks));
      res.writeHead(200); res.end('ok');
    });
    return;
  }
  const file = path.join(ROOT, path.normalize(url === '/' ? '/index.html' : url));
  if (!file.startsWith(path.resolve(ROOT)) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log('export server on ' + PORT));
