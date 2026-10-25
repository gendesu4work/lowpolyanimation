// Finds 3D models (switched on in the app) for a scene, so animations read a few lines instead of the whole library.
// usage: node scripts/find-models.js "taxi"            words to match (name, pack, file path, animations)
//        node scripts/find-models.js "dog" --animated  only rigged/animated models
//        node scripts/find-models.js --packs           what each pack contains
const { load } = require('./lib/models');

const args = process.argv.slice(2), flag = f => args.includes(f);
const limit = +(args[args.indexOf('--limit') + 1] || 0) || 15;
const query = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--limit').join(' ').toLowerCase();
const models = load().filter(m => m.active && (!flag('--animated') || m.kind === 'character'));

if (flag('--packs') || !query) {
  const packs = {};
  for (const m of models) (packs[m.pack] = packs[m.pack] || []).push(m);
  for (const [pack, ms] of Object.entries(packs)) {
    const sample = [...new Set(ms.map(m => m.name.toLowerCase().replace(/\s*\d+$/, '')))].slice(0, 12).join(', ');
    console.log(`${pack}: ${ms.length} models${ms.some(m => m.kind === 'character') ? `, ${ms.filter(m => m.kind === 'character').length} animated` : ''} · e.g. ${sample}`);
  }
  if (!query) console.log('\nSearch with: node scripts/find-models.js "<what you need>"');
  process.exit(0);
}

// Everyday words to the names packs actually use.
const SYN = {
  dog: ['husky', 'shiba', 'shibainu', 'dog'], puppy: ['husky', 'shiba'], cat: ['cat', 'kitten'], horse: ['horse', 'donkey'],
  person: ['person', 'human', 'man', 'woman', 'character'], people: ['person', 'human', 'character'], human: ['person', 'human', 'character'],
  car: ['car', 'sedan', 'taxi', 'suv', 'hatchback', 'van', 'police', 'ambulance', 'race'], vehicle: ['car', 'truck', 'van', 'sedan', 'suv', 'tractor', 'firetruck'],
  truck: ['truck', 'firetruck', 'delivery', 'garbage'], building: ['building', 'skyscraper', 'house', 'tower'], house: ['house', 'building', 'cabin'],
  tree: ['tree', 'pine', 'palm', 'oak', 'birch'], plant: ['plant', 'bush', 'grass', 'flower', 'mushroom'], rock: ['rock', 'stone', 'cliff'],
  rocket: ['rocket', 'spaceship', 'ship'], spaceship: ['spaceship', 'ship', 'rocket'], planet: ['planet'], alien: ['alien', 'enemy'], robot: ['mech', 'robot'],
};
// Score by how many query words (or their synonyms) appear in the model's name (worth most), file path or animations.
// each entry: the word itself first (an exact name match ranks highest), then its synonyms
const words = query.split(/[^a-z0-9]+/).filter(Boolean).map(w => [w, ...(SYN[w] || SYN[w.replace(/s$/, '')] || []).filter(s => s !== w)]);
// whole words only ("car" must not find "carrot"); long words may match a word's start ("skyscraper" → "skyscraper_large")
const toks = s => s.toLowerCase().replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^a-z0-9]+/).filter(Boolean);
const hit = (tokens, w) => tokens.some(t => t === w || t === w + 's' || (w.length >= 5 && t.startsWith(w)));
const hits = models.map(m => {
  const name = toks(m.name.replace(/([a-z])([A-Z])/g, '$1 $2')), tags = toks((m.tags || []).join(' ')), hay = toks(m.file + ' ' + m.pack + ' ' + m.animations.join(' '));
  let score = 0;
  for (const alts of words) score += hit(name, alts[0]) ? 4 : alts.some(w => hit(name, w)) ? 3 : alts.some(w => hit(tags, w)) ? 2 : alts.some(w => hit(hay, w)) ? 1 : 0;
  return { m, score };
}).filter(h => h.score > 0).sort((a, b) => b.score - a.score || a.m.name.localeCompare(b.m.name)).slice(0, limit);

if (!hits.length) { console.log(`No models match "${query}". Try a broader word, or build it from simple shapes.`); process.exit(0); }
for (const { m } of hits)
  console.log(`${m.name} [${m.kind}${m.tags && m.tags.length ? ': ' + m.tags.slice(0, 4).join(', ') : ''}] ../../assets/models/${m.file}${m.animations.length ? ` · animations: ${m.animations.join(', ')}` : ''}${m.materials.length ? ` · materials: ${m.materials.slice(0, 6).join(', ')}` : ''}`);
