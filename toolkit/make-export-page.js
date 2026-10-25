// Builds an export copy of the page: same scenes and sound, plus hooks that render frames and an offline soundtrack.
// usage: node make-export-page.js <page.html> <hooks.js> <out.html>
const fs = require('fs');
const [src, hooks, dst] = process.argv.slice(2);
let s = fs.readFileSync(src, 'utf8');
const rep = [
  ['const c=new (window.AudioContext||window.webkitAudioContext)(); AU.ctx=c;', 'const c=AU.offline||new (window.AudioContext||window.webkitAudioContext)(); AU.ctx=c;'],
  ['const c=AU.ctx, t0=c.currentTime+(o.delay||0);', 'const c=AU.ctx, t0=(AU.at!=null?AU.at:c.currentTime)+(o.delay||0);', 2],
  ['const c=AU.ctx, t0=c.currentTime, s=c.createBufferSource();', 'const c=AU.ctx, t0=(AU.at!=null?AU.at:c.currentTime), s=c.createBufferSource();'],
  ["if(c.state==='suspended') c.resume();", "if(!AU.offline&&c.state==='suspended') c.resume();"],
  ['  const now=c.currentTime;\n', '  const now=AU.at!=null?AU.at:c.currentTime;\n'],
  ['new ResizeObserver(fit).observe(viewport); fit();', 'fit();'],
  ['requestAnimationFrame(frame);\n})();', fs.readFileSync(hooks, 'utf8')],
];
for (const [a, b, n = 1] of rep) {
  const count = s.split(a).length - 1;
  if (count !== n) throw new Error('expected ' + n + ' x ' + JSON.stringify(a.slice(0, 60)) + ', found ' + count);
  s = s.split(a).join(b);
}
fs.writeFileSync(dst, s);
console.log('wrote', dst, s.length);
