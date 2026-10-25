// Finds library models by everyday words ("taxi", "person", "dog"). Shared by the scene engine (browser) and
// scripts/check-plan.js (node). The library is engine/library.json: the models switched on in the app.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShortsResolve = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SYN = {
    dog: ['husky', 'shiba', 'shibainu', 'dog'], puppy: ['husky', 'shiba'], cat: ['cat', 'kitten'], horse: ['horse', 'donkey'],
    person: ['person', 'human', 'man', 'woman', 'character'], people: ['person', 'human', 'character'], human: ['person', 'human', 'character'], crowd: ['person'],
    car: ['car', 'sedan', 'taxi', 'suv', 'hatchback', 'van', 'police', 'race'], vehicle: ['car', 'truck', 'van', 'sedan', 'suv', 'tractor', 'firetruck'],
    truck: ['truck', 'firetruck', 'delivery', 'garbage'], building: ['building', 'skyscraper', 'tower'], house: ['house', 'cabin', 'building'],
    tree: ['tree', 'pine', 'palm', 'oak', 'birch'], plant: ['plant', 'bush', 'grass', 'flower', 'mushroom'], rock: ['rock', 'stone', 'cliff'],
    rocket: ['rocket', 'spaceship', 'ship'], spaceship: ['spaceship', 'ship', 'rocket'], alien: ['alien', 'enemy'], robot: ['mech', 'robot'],
    sofa: ['sofa', 'couch'], couch: ['couch', 'sofa'], lamp: ['lamp', 'light'],
  };
  const toks = s => String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const hit = (tokens, w) => tokens.some(t => t === w || t === w + 's' || (w.length >= 5 && t.startsWith(w)));

  // Every match with a score, best first. {animated: true} keeps only rigged/animated models.
  function search(lib, query, opts = {}) {
    const words = toks(query).map(w => [w, ...(SYN[w] || SYN[w.replace(/s$/, '')] || []).filter(s => s !== w)]);
    if (!words.length) return [];
    // opts.prefer / opts.avoid: patterns on the file path, e.g. prefer the nature kit, avoid space-kit trees
    return lib.filter(m => !opts.animated || m.kind === 'character').map(m => {
      const name = toks(m.name), tags = toks((m.tags || []).join(' ')), hay = toks(m.file + ' ' + (m.animations || []).join(' '));
      let score = 0;
      for (const alts of words) score += hit(name, alts[0]) ? 4 : alts.some(w => hit(name, w)) ? 3 : alts.some(w => hit(tags, w)) ? 2 : alts.some(w => hit(hay, w)) ? 1 : 0;
      if (score && opts.prefer && opts.prefer.test(m.file)) score += 2;
      if (score && opts.avoid && opts.avoid.test(m.file)) score -= 3;
      return { m, score };
    }).filter(h => h.score > 0).sort((a, b) => b.score - a.score || a.m.name.localeCompare(b.m.name, undefined, { numeric: true })).map(h => h.m);
  }
  // Up to n different models for one query, e.g. 4 different people for a crowd.
  const pick = (lib, query, n = 1, opts) => search(lib, query, opts).slice(0, n);

  // A sensible real-world height (meters) for a model, so a taxi and a person end up the right size together.
  function height(m, rnd = Math.random) {
    const t = toks(m.name + ' ' + (m.tags || []).join(' ') + ' ' + m.file);
    const has = (...w) => w.some(x => t.includes(x));
    if (has('building', 'skyscraper', 'tower')) return 14 + rnd() * 22;
    if (has('house', 'cabin', 'shop')) return 7 + rnd() * 3;
    if (has('tree', 'pine', 'palm', 'oak', 'birch')) return 4.5 + rnd() * 3;
    if (has('bush', 'plant', 'flower', 'grass', 'mushroom', 'crop')) return 0.6 + rnd() * 0.6;
    if (has('rock', 'stone', 'boulder')) return 0.8 + rnd() * 1.5;
    if (has('truck', 'bus', 'firetruck', 'garbage', 'tractor')) return 3.2;
    if (has('car', 'taxi', 'sedan', 'suv', 'van', 'police', 'hatchback', 'ambulance', 'race', 'vehicle')) return 1.55;
    if (has('husky', 'shiba', 'dog', 'fox', 'cat', 'wolf')) return 0.7;
    if (has('horse', 'cow', 'bull', 'deer', 'alpaca', 'donkey', 'stag')) return 1.6;
    if (has('lamp', 'streetlight')) return 3.2;
    if (has('chair', 'stool')) return 0.9;
    if (has('table', 'desk')) return 0.78;
    if (has('sofa', 'couch', 'bed')) return 0.85;
    if (has('rocket', 'spaceship')) return 12;
    if (m.kind === 'character' || has('person', 'human', 'man', 'woman', 'astronaut', 'character')) return 1.8;
    return 1.5;
  }
  return { search, pick, height, toks };
});
