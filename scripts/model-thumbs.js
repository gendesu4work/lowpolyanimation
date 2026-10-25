// Renders a 320x320 preview of each model id given (or all without a preview) into assets/models/thumbs/<id>.png.
// usage: node scripts/model-thumbs.js [id ...]
const puppeteer = require('puppeteer-core'), fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');
const { readJson } = require('./lib/common');

const DIR = path.join(__dirname, '..', 'assets', 'models'), THUMBS = path.join(DIR, 'thumbs');
const ids = process.argv.slice(2), list = readJson(path.join(DIR, 'models.json'), []).filter(m => !ids.length || ids.includes(m.id));

// A tiny stage page: soft studio light, the model fitted to the frame, characters posed mid-idle.
const PAGE = `<!doctype html><html><body style="margin:0;background:transparent">
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>
<script>
window.shoot = url => new Promise((res, rej) => {
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(320, 320); r.outputEncoding = THREE.sRGBEncoding; document.body.replaceChildren(r.domElement);
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(3, 5, 4); scene.add(key);
  new THREE.GLTFLoader().load(url, g => {
    const m = g.scene; scene.add(m);
    if (g.animations.length) {
      const mixer = new THREE.AnimationMixer(m);
      const clip = g.animations.find(a => /idle|stand/i.test(a.name)) || g.animations[0];
      mixer.clipAction(clip).play(); mixer.setTime(0.4);
    }
    const box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const d = Math.max(size.x, size.y, size.z) / (2 * Math.tan(THREE.MathUtils.degToRad(15))) * 1.15;
    cam.position.set(c.x + d * 0.45, c.y + d * 0.25, c.z + d * 0.9); cam.lookAt(c);
    r.render(scene, cam); res(r.domElement.toDataURL('image/png').split(',')[1]);
  }, undefined, e => rej(String(e && e.message || e)));
});
</script></body></html>`;

(async () => {
  if (!list.length) return;
  fs.mkdirSync(THUMBS, { recursive: true });
  const stage = path.join(THUMBS, '_stage.html'); fs.writeFileSync(stage, PAGE);
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--allow-file-access-from-files', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  try {
    const p = await b.newPage(); await p.setViewport({ width: 320, height: 320 });
    await p.goto(pathToFileURL(stage).href, { waitUntil: 'networkidle0' });
    for (const m of list) {
      try {
        const png = await p.evaluate(u => window.shoot(u), pathToFileURL(path.join(DIR, m.file)).href);
        fs.writeFileSync(path.join(THUMBS, m.id + '.png'), Buffer.from(png, 'base64'));
        console.log('thumb', m.name);
      } catch (e) { console.log('thumb failed', m.name, String(e).slice(0, 120)); }
    }
  } finally { await b.close(); fs.rmSync(stage, { force: true }); }
})();
