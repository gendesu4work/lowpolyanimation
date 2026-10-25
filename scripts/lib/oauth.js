// One-time browser sign-in: opens the platform's consent page and catches the redirect on localhost.
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const { P, openBrowser } = require('./common');

const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Self-signed certificate for platforms that only accept https redirects (Instagram); made once with openssl.
function localhostCert() {
  const dir = path.join(P.root, 'secrets'), key = path.join(dir, 'localhost-key.pem'), cert = path.join(dir, 'localhost-cert.pem');
  if (!fs.existsSync(key) || !fs.existsSync(cert)) {
    fs.mkdirSync(dir, { recursive: true });
    const args = ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '3650', '-subj', '/CN=localhost'];
    const bins = ['openssl', 'C:/Program Files/Git/usr/bin/openssl.exe', 'C:/Program Files/Git/mingw64/bin/openssl.exe'];
    if (!bins.some(bin => { try { execFileSync(bin, args, { stdio: 'ignore' }); return true; } catch { return false; } }))
      throw new Error('could not create a localhost certificate: install Git for Windows (it includes openssl) and try again');
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

function loopback({ port, buildUrl, secure = false }) {
  return new Promise((resolve, reject) => {
    const state = crypto.randomBytes(16).toString('hex');
    const redirectUri = `${secure ? 'https' : 'http'}://localhost:${port}/callback`;
    const timer = setTimeout(() => { srv.close(); reject(new Error('timed out waiting for sign-in')); }, 5 * 60 * 1000);
    const handler = (req, res) => {
      const u = new URL(req.url, redirectUri);
      if (u.pathname !== '/callback') { res.writeHead(404); return res.end(); }
      const code = u.searchParams.get('code'), ok = code && u.searchParams.get('state') === state;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(ok ? '<h2>Connected. You can close this tab.</h2>' : '<h2>Sign-in failed. Check the terminal.</h2>');
      clearTimeout(timer); srv.close();
      if (u.searchParams.get('state') !== state) return reject(new Error('sign-in state mismatch, try again'));
      if (!code) return reject(new Error('sign-in refused: ' + (u.searchParams.get('error_description') || u.searchParams.get('error'))));
      resolve({ code, redirectUri });
    };
    const srv = secure ? https.createServer(localhostCert(), handler) : http.createServer(handler);
    srv.listen(port, () => {
      const url = buildUrl(redirectUri, state);
      console.log('Opening your browser to sign in. If it does not open, visit:\n' + url + '\n');
      if (secure) console.log('After you approve, the browser warns that the localhost connection is not private: click Advanced, then Proceed to localhost. That page is this script on your own PC.\n');
      openBrowser(url);
    });
  });
}

module.exports = { loopback, b64url };
