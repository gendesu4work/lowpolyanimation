// 3D model library: assets/models/<pack>/... registered in assets/models/models.json, with preview images in
// assets/models/thumbs/. Models switched on are listed in the Trainer brief so animations can load them.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { execFileSync, spawn } = require('child_process');
const { P, readJson, writeJson } = require('./common');

const DIR = path.join(P.root, 'assets', 'models'), FILE = path.join(DIR, 'models.json'), THUMBS = path.join(DIR, 'thumbs');
const MODEL_EXT = ['.glb', '.gltf'];
const now = () => new Date().toISOString(), newId = () => crypto.randomBytes(5).toString('hex');
const slug = s => String(s).toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'pack';

const load = () => readJson(FILE, []);
// engine/library.json is what the scene engine searches: the models switched on, with only the fields it needs
function save(list) {
  writeJson(FILE, list);
  writeJson(path.join(P.root, 'engine', 'library.json'), list.filter(m => m.active).map(m => ({ name: m.name, file: m.file, kind: m.kind, tags: m.tags || [], animations: m.animations })));
}

// Reads a .glb/.gltf's JSON to learn what it is: animated character or static prop, its animations and materials.
function inspect(file) {
  let j;
  if (file.endsWith('.glb')) { const b = fs.readFileSync(file); j = JSON.parse(b.slice(20, 20 + b.readUInt32LE(12)).toString()); }
  else j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const animations = (j.animations || []).map(a => String(a.name || '').split('|').pop()).filter(Boolean);
  return { kind: (j.skins || []).length || animations.length ? 'character' : 'prop', animations, materials: (j.materials || []).map(m => m.name).filter(Boolean).slice(0, 12) };
}

// File names to readable names: "Astronaut_BarbaraTheBee" → "Astronaut Barbara The Bee", "hatchback-sports" → "Hatchback Sports".
function prettyName(file) {
  return path.basename(file).replace(/\.[^.]+$/, '').replace(/[_\s-]*LOD\d+$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2')
    .split(/[\s_.-]+/).filter(w => w && !/^(glb|gltf|lowpoly|low|poly|lod\d*|final|v\d+)$/i.test(w))
    .map(w => /^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w).join(' ') || 'Model';
}

function register(absFile, { pack, name, source, license }) {
  const list = load(), rel = path.relative(DIR, absFile).replace(/\\/g, '/');
  if (list.find(m => m.file === rel)) return null;
  let info; try { info = inspect(absFile); } catch { return null; }
  const m = { id: newId(), file: rel, name: name || prettyName(absFile), tags: [], pack, ...info, source: source || '', license: license || '', active: true, addedAt: now() };
  list.push(m); save(list); return m;
}

// Renders preview images for models that don't have one yet (headless Chrome + Three.js), in a separate
// process so the app stays responsive. Resolves with how many were attempted.
function makeThumbs(ids) {
  const todo = load().filter(m => (!ids || ids.includes(m.id)) && !fs.existsSync(path.join(THUMBS, m.id + '.png')));
  if (!todo.length) return Promise.resolve(0);
  fs.mkdirSync(THUMBS, { recursive: true });
  return new Promise(resolve => {
    const c = spawn(process.execPath, [path.join(P.root, 'scripts', 'model-thumbs.js'), ...todo.map(m => m.id)], { cwd: P.root, windowsHide: true, stdio: 'ignore' });
    c.on('close', () => resolve(todo.length)); c.on('error', () => resolve(0));
  });
}

// Registers every model in an unpacked pack folder after removing anything that isn't a model, texture or license.
// Throws (and removes the folder) when it holds no .glb/.gltf at all.
function importDir(dir, pack, source, license) {
  require('./fetchpack').prune(dir);
  const found = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (MODEL_EXT.includes(path.extname(e.name).toLowerCase())) found.push(p); } })(dir);
  if (!found.length) { fs.rmSync(dir, { recursive: true, force: true }); throw new Error('No .glb or .gltf models inside. On the download page, pick the glTF/GLB version of the pack.'); }
  const added = found.slice(0, 400).map(f => register(f, { pack, source, license })).filter(Boolean);
  return { pack, added: added.length, ids: added.map(m => m.id) };
}
// A free folder name for a new pack under assets/models/.
function packDir(name) { let pack = slug(name), n = 2; while (fs.existsSync(path.join(DIR, pack))) pack = slug(name) + '-' + n++; return pack; }

// Saves an uploaded .glb/.gltf/.zip into assets/models/<pack>/ and registers every model in it.
function receive(req, name, source, license) {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (![...MODEL_EXT, '.zip'].includes(ext)) return Promise.reject(new Error('Use a .glb, .gltf or .zip file'));
  const pack = packDir(name), dir = path.join(DIR, pack), file = path.join(dir, path.basename(String(name)));
  fs.mkdirSync(dir, { recursive: true });
  return new Promise((resolve, reject) => {
    let size = 0; const out = fs.createWriteStream(file);
    req.on('data', d => { size += d.length; if (size > 2 * 1024 ** 3) { req.destroy(); out.destroy(); reject(new Error('Files must be under 2 GB')); } });
    req.pipe(out);
    out.on('error', reject);
    out.on('finish', () => {
      try {
        if (ext === '.zip') { execFileSync('tar', ['-xf', file, '-C', dir], { windowsHide: true }); fs.unlinkSync(file); }
        resolve(importDir(dir, pack, source, license));
      } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); reject(new Error('Could not open that file: ' + e.message.split('\n')[0])); }
    });
  });
}

function update(mid, fields) {
  const list = load(), m = list.find(x => x.id === mid); if (!m) throw new Error('Model not found');
  if (fields.active != null) m.active = !!fields.active;
  if (fields.name) m.name = String(fields.name).slice(0, 80);
  save(list); return m;
}
// The prompt that asks Claude for search keywords for every model in a pack (one short call, JSON back).
function tagPrompt(pack) {
  const ms = load().filter(m => m.pack === pack);
  return `These are 3D models from the pack "${pack}". For each one, give 3 to 6 lowercase search keywords someone might type to find it for an animated scene: what it is, its category, and common synonyms (e.g. "Husky" → dog, animal, pet; "Hatchback Sports" → car, vehicle, sports car; "Tree Blob 1" → tree, plant, nature, alien tree). Use the folder path as a hint about the kind of model.

${ms.map(m => `${m.id}: ${m.name} (${m.file.split('/').slice(1, -1).join('/') || m.pack})${m.animations.length ? ' animated' : ''}`).join('\n')}

Reply with only a JSON object mapping each id to its keyword array, no other text: {"${ms[0] ? ms[0].id : 'id'}": ["keyword", "keyword"]}`;
}
function setTags(map) {
  const list = load(); let n = 0;
  for (const m of list) if (Array.isArray(map[m.id])) { m.tags = [...new Set(map[m.id].map(t => String(t).toLowerCase().trim().slice(0, 30)).filter(Boolean))].slice(0, 8); n++; }
  save(list); return n;
}
// Readable names for models imported before names were cleaned automatically (keeps names someone typed).
function renamePack(pack) { const list = load(); for (const m of list) if (m.pack === pack) m.name = prettyName(m.file); save(list); }

// Turning a whole pack on or off at once (packs can hold hundreds of models).
function updatePack(pack, active) { const list = load(); for (const m of list) if (m.pack === pack) m.active = !!active; save(list); }
function removePack(pack) {
  const list = load(), gone = list.filter(m => m.pack === pack);
  for (const m of gone) fs.rmSync(path.join(THUMBS, m.id + '.png'), { force: true });
  save(list.filter(m => m.pack !== pack));
  if (pack && !pack.includes('..')) fs.rmSync(path.join(DIR, pack), { recursive: true, force: true });
}

// The part of the Trainer brief that tells animations which models exist and how to load them deterministically.
function brief() {
  const on = load().filter(m => m.active);
  if (!on.length) return '';
  const packs = {};
  for (const m of on) (packs[m.pack] = packs[m.pack] || []).push(m);
  let md = `\n## 3D models: use them by default\n\nThe creator wants their model library in every video. For every person, animal, vehicle, building, tree and prop in a scene, FIRST search the library and use the model it finds; build something from simple shapes only when the search finds nothing suitable. Search, don't read the library: run \`node scripts/find-models.js "<what you need>"\` (e.g. "person --animated", "dog", "taxi", "building", "tree"). It prints matching models with their path (relative to videos/<folder>/page.html), animations and materials.

Crowds: load 2-4 different people models once, clone them with THREE.SkeletonUtils.clone, vary their clothing colors through their named materials (clone the material first), offset their animation start times, and keep crowds to about 30 characters.\n
With the scene engine (plan.json), just name the thing in an object's "model" and the engine loads it; the notes below are only for custom Three.js code.
How to load them in custom code (Three.js r128, no modules):
- Add <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script> and, to reuse a character several times, <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/utils/SkeletonUtils.js"></script> (clone with THREE.SkeletonUtils.clone).
- Load every model before setting window.__ready = true (wait for all loader promises).
- Animations: one THREE.AnimationMixer per character; pick clips with THREE.AnimationClip.findByName(gltf.animations, '<Armature>|<Name>') or by matching the name's end. In __frame(t) drive them with mixer.setTime(t - sceneStart), never with a clock, so every rendered frame is reproducible.
- Scale each model to the scene (measure with new THREE.Box3().setFromObject(model)), enable castShadow, and recolor through its named materials when it helps the story.\n`;
  // one line per pack; the search command gives the details
  md += '\nPacks switched on:\n';
  for (const [pack, list] of Object.entries(packs)) {
    const kinds = [...new Set(list.map(m => m.name.toLowerCase().replace(/[\s_-]*\d+$/, '')))].slice(0, 10).join(', ');
    const animated = list.filter(m => m.kind === 'character').length;
    md += `- ${pack}: ${list.length} models${animated ? `, ${animated} animated` : ''}${list[0].license ? ` (${list[0].license})` : ''} · e.g. ${kinds}\n`;
  }
  return md;
}

module.exports = { DIR, THUMBS, load, register, makeThumbs, receive, importDir, packDir, update, updatePack, removePack, brief, inspect, prettyName, tagPrompt, setTags, renamePack };
