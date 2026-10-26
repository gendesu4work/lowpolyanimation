// Shorts scene engine: turns a short scene plan (videos/<folder>/plan.json, documented in engine/PLAN.md) into a
// 1080x1920 low-poly "What if" video. Sets, library models, crowds, camera moves, effects, the counter, captions,
// headline, end card and a synthesized soundtrack all live here, so each video only needs a plan.
// Export contract used by scripts/render.js: window.__dur, __frame(t) -> base64 JPEG, __audio() -> base64 WAV, __ready.
(function () {
  const W = 1080, H = 1920, MODELS = '../../assets/models/';
  const SERIF = 'Newsreader, Georgia, serif', MONO = '"IBM Plex Mono", Consolas, monospace';
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const v3 = a => Array.isArray(a) ? V(+a[0] || 0, +a[1] || 0, +a[2] || 0) : V();
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const EASE = { linear: x => clamp(x, 0, 1), inOut: smooth, in: x => clamp(x, 0, 1) ** 2, out: x => 1 - (1 - clamp(x, 0, 1)) ** 2 };
  const col = c => new THREE.Color(c || '#cccccc');
  function rng(seed) { let a = seed >>> 0 || 1; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // ---------- skies and light by time of day ----------
  const SKY = {
    day: { top: '#4f9ee8', bottom: '#cfe7ff', hemi: 1.0, sun: 1.1, sunColor: '#fff3e0', ground: '#6b7a55', fog: '#cfe7ff' },
    sunset: { top: '#2a2f72', bottom: '#ff9d6a', hemi: 0.75, sun: 1.0, sunColor: '#ffb27a', ground: '#4a3a40', fog: '#e89a7c' },
    dawn: { top: '#6676c4', bottom: '#ffd3a6', hemi: 0.85, sun: 0.9, sunColor: '#ffd9b0', ground: '#5a5a60', fog: '#f2c9a8' },
    night: { top: '#03050d', bottom: '#18234a', hemi: 0.35, sun: 0.35, sunColor: '#9fb4ff', ground: '#1a1e2a', fog: '#18234a' },
    space: { top: '#000000', bottom: '#05060c', hemi: 0.25, sun: 1.2, sunColor: '#ffffff', ground: '#000000', fog: '#000000' },
  };
  function gradientTexture(top, bottom) {
    const c = document.createElement('canvas'); c.width = 4; c.height = 256;
    const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, top); gr.addColorStop(1, bottom); g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
  }

  // ---------- procedural shapes (planets, sun, black hole...) ----------
  const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color: col(color), flatShading: true, roughness: 0.85, metalness: 0, ...extra });
  function jitter(geo, r, amt) { const p = geo.attributes.position, v = V(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); v.multiplyScalar(1 + (r() - 0.5) * amt); p.setXYZ(i, v.x, v.y, v.z); } geo.computeVertexNormals(); return geo; }
  function vertexColors(geo, fn) { const p = geo.attributes.position, c = [], v = V(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const k = fn(v); c.push(k.r, k.g, k.b); } geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); return geo; }
  function shape(o, r) {
    const s = +o.size || 1, g = new THREE.Group();
    switch (o.shape) {
      case 'earth': {
        const geo = new THREE.IcosahedronGeometry(s, 3).toNonIndexed(), land = col('#2f8f3c'), sea = col('#1b4fa8'), ice = col('#e6eefc');
        vertexColors(geo, v => { const n = Math.sin(v.x * 1.7 / s * 3) + Math.sin(v.y * 2.3 / s * 3 + 1) + Math.sin(v.z * 1.9 / s * 3 + 2); return Math.abs(v.y) > s * 0.86 ? ice : n > 0.6 ? land : sea; });
        g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 })));
        if (o.clouds !== false) { const cl = new THREE.Mesh(jitter(new THREE.IcosahedronGeometry(s * 1.04, 2), r, 0.04), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.14, flatShading: true, depthWrite: false })); g.add(cl); }
        break;
      }
      case 'planet': case 'moon': case 'rock': {
        const geo = jitter(new THREE.IcosahedronGeometry(s, o.shape === 'rock' ? 1 : 2), r, o.shape === 'rock' ? 0.35 : 0.08);
        g.add(new THREE.Mesh(geo, flat(o.color || (o.shape === 'moon' ? '#b9bcc4' : o.shape === 'rock' ? '#8a8a86' : '#d58a4a'))));
        if (o.rings) { const ring = new THREE.Mesh(new THREE.RingGeometry(s * 1.4, s * 2.1, 48), new THREE.MeshBasicMaterial({ color: col(o.ringColor || '#e8d2a6'), side: THREE.DoubleSide, transparent: true, opacity: 0.8 })); ring.rotation.x = -Math.PI / 2.4; g.add(ring); }
        break;
      }
      case 'sun': {
        g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(s, 3), new THREE.MeshBasicMaterial({ color: col(o.color || '#ffc35a') })));
        [[1.3, 0.35], [1.8, 0.16], [2.8, 0.07]].forEach(([k, a]) => g.add(new THREE.Mesh(new THREE.SphereGeometry(s * k, 32, 20), new THREE.MeshBasicMaterial({ color: col(o.glow || '#ff9a3a'), transparent: true, opacity: a, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending }))));
        const light = new THREE.PointLight(col(o.glow || '#ffd29a'), 2.2, s * 60, 1.2); g.add(light);
        break;
      }
      case 'blackhole': {
        g.add(new THREE.Mesh(new THREE.SphereGeometry(s, 32, 20), new THREE.MeshBasicMaterial({ color: 0x000000 })));
        const disk = new THREE.Mesh(new THREE.RingGeometry(s * 1.5, s * 3.4, 64), new THREE.MeshBasicMaterial({ color: col(o.color || '#ff8a3c'), side: THREE.DoubleSide, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
        disk.rotation.x = -Math.PI / 2.3; g.add(disk);
        g.add(new THREE.Mesh(new THREE.RingGeometry(s * 1.05, s * 1.25, 64), new THREE.MeshBasicMaterial({ color: 0xffe2b0, side: THREE.DoubleSide, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending })));
        g.userData.spinChild = disk;
        break;
      }
      case 'ship': { // size = length; a low-poly freighter: hull, bow, cabin, funnel
        const L = s, hull = new THREE.Mesh(new THREE.BoxGeometry(L * 0.28, L * 0.14, L * 0.8), flat(o.color || '#2f3a4f')); hull.position.y = L * 0.07; g.add(hull);
        const bow = new THREE.Mesh(new THREE.ConeGeometry(L * 0.14, L * 0.22, 4), flat(o.color || '#2f3a4f')); bow.rotation.x = Math.PI / 2; bow.rotation.y = Math.PI / 4; bow.position.set(0, L * 0.07, L * 0.5); bow.scale.set(1, 1, 0.65); g.add(bow);
        const deck = new THREE.Mesh(new THREE.BoxGeometry(L * 0.27, L * 0.02, L * 0.78), flat('#b84a3a')); deck.position.y = L * 0.15; g.add(deck);
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(L * 0.2, L * 0.12, L * 0.14), flat('#eef0f2')); cabin.position.set(0, L * 0.22, -L * 0.28); g.add(cabin);
        const funnel = new THREE.Mesh(new THREE.CylinderGeometry(L * 0.03, L * 0.035, L * 0.12, 8), flat('#d8432f')); funnel.position.set(0, L * 0.33, -L * 0.3); g.add(funnel);
        for (let i = 0; i < 4; i++) { const c = new THREE.Mesh(new THREE.BoxGeometry(L * 0.22, L * 0.07, L * 0.1), flat(['#3f7ad6', '#e0a134', '#4aa36b', '#c85a4f'][i])); c.position.set(0, L * 0.19, L * (0.02 + i * 0.1)); g.add(c); }
        break;
      }
      case 'wave': { // size = height of a curling wall of water
        const H = s, wall = new THREE.Mesh(new THREE.CylinderGeometry(H * 1.2, H * 1.2, H * 4, 24, 4, true, -Math.PI / 2.6, Math.PI / 1.3), new THREE.MeshStandardMaterial({ color: col(o.color || '#2f86c9'), flatShading: true, roughness: 0.3, metalness: 0.05, transparent: true, opacity: 0.92, side: THREE.DoubleSide }));
        wall.rotation.z = Math.PI / 2; wall.position.y = H * 0.55; g.add(wall);
        const foam = new THREE.Mesh(new THREE.BoxGeometry(H * 4, H * 0.12, H * 0.5), flat('#f4fbff')); foam.position.set(0, H * 1.15, H * 0.25); g.add(foam);
        break;
      }
      case 'fish': { // size = length; flops when stranded (set by its object, flop: true)
        const body = new THREE.Mesh(new THREE.IcosahedronGeometry(s * 0.35, 1), flat(o.color || '#e2973a')); body.scale.set(0.55, 0.8, 1.6); g.add(body);
        const tail = new THREE.Mesh(new THREE.ConeGeometry(s * 0.22, s * 0.35, 4), flat(o.color || '#e2973a')); tail.rotation.x = -Math.PI / 2; tail.position.z = -s * 0.62; g.add(tail);
        g.rotation.z = Math.PI / 2; g.position.y = s * 0.15; break;
      }
      case 'kelp': { for (let i = 0; i < 5; i++) { const k = new THREE.Mesh(new THREE.ConeGeometry(s * 0.12, s * (0.6 + r() * 0.6), 5), flat(i % 2 ? '#3f7d3a' : '#5a9a44')); k.position.set((r() - 0.5) * s * 0.4, s * 0.4, (r() - 0.5) * s * 0.4); g.add(k); } g.userData.sway = true; break; }
      case 'crack': { // size = length of a jagged fissure lying on the ground
        const pts = []; for (let i = 0; i <= 10; i++) pts.push(new THREE.Vector2((i / 10 - 0.5) * s, (r() - 0.5) * s * 0.08 + (i % 2 ? 0.25 : -0.25) * s * 0.06));
        const sh = new THREE.Shape([...pts, ...pts.slice().reverse().map(p => new THREE.Vector2(p.x, p.y - s * 0.04 - r() * s * 0.03))]);
        const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshBasicMaterial({ color: 0x110c08, side: THREE.DoubleSide })); m.rotation.x = -Math.PI / 2; m.position.y = 0.03; g.add(m); g.userData.crackGrow = true; break;
      }
      case 'explosion': { // grows and fades over 1.6 s from its object's "at"
        g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(s, 2), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false })));
        g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(s * 1.5, 1), new THREE.MeshBasicMaterial({ color: 0xff6a2a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false })));
        g.add(new THREE.PointLight(0xffa04a, 4, s * 30, 1.5)); g.userData.explode = true; break;
      }
      case 'lightning': { // size = height of the bolt; flickers
        let y = s, x = 0; while (y > 0) { const ny = y - s * (0.08 + r() * 0.08), nx = x + (r() - 0.5) * s * 0.18, seg = new THREE.Mesh(new THREE.BoxGeometry(s * 0.012, Math.hypot(nx - x, ny - y), s * 0.012), new THREE.MeshBasicMaterial({ color: 0xe8f2ff })); seg.position.set((x + nx) / 2, (y + ny) / 2, 0); seg.rotation.z = Math.atan2(nx - x, y - ny); g.add(seg); x = nx; y = ny; }
        g.userData.flicker = true; break;
      }
      case 'marker': { const pin = new THREE.Mesh(new THREE.ConeGeometry(s * 0.25, s * 0.8, 10), flat(o.color || '#e5483d')); pin.rotation.x = Math.PI; pin.position.y = s * 0.4; g.add(pin); const head = new THREE.Mesh(new THREE.IcosahedronGeometry(s * 0.3, 1), flat(o.color || '#e5483d')); head.position.y = s * 0.95; g.add(head); break; }
      case 'cloud': {
        for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s * (0.5 + r() * 0.5), 1), flat('#ffffff', { roughness: 1 })); m.position.set((r() - 0.5) * s * 2.2, (r() - 0.3) * s * 0.6, (r() - 0.5) * s); g.add(m); }
        break;
      }
      case 'ring': g.add(new THREE.Mesh(new THREE.TorusGeometry(s, s * 0.08, 8, 48), flat(o.color))); break;
      case 'cylinder': g.add(new THREE.Mesh(new THREE.CylinderGeometry(s / 2, s / 2, +o.height || s, 16), flat(o.color))); break;
      case 'cone': g.add(new THREE.Mesh(new THREE.ConeGeometry(s / 2, +o.height || s, 12), flat(o.color))); break;
      case 'sphere': g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(s / 2, 2), flat(o.color))); break;
      default: g.add(new THREE.Mesh(new THREE.BoxGeometry(s, +o.height || s, s), flat(o.color)));
    }
    if (o.emissive) g.traverse(m => { if (m.isMesh && m.material.emissive) { m.material.emissive = col(o.emissive); m.material.emissiveIntensity = 0.8; } });
    g.traverse(m => { if (m.isMesh && !m.material.blending) { m.castShadow = true; m.receiveShadow = true; } });
    return g;
  }

  // ---------- library models ----------
  const loaded = {}; // file -> {gltf, h, min, center}
  function loadModel(file) {
    if (loaded[file]) return loaded[file].promise;
    const rec = loaded[file] = {};
    rec.promise = new Promise(res => new THREE.GLTFLoader().load(encodeURI(MODELS + file), gltf => {
      gltf.scene.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(gltf.scene), size = b.getSize(V());
      Object.assign(rec, { gltf, h: size.y || 1, w: Math.max(size.x, size.z) || 1, min: b.min.clone(), center: b.getCenter(V()) }); res(rec);
    }, undefined, e => { console.warn('model failed', file, e && e.message); rec.failed = true; res(rec); }));
    return rec.promise;
  }
  // A placed copy of a library model, scaled to a real-world height and standing on y=0.
  function instance(m, r, opts) {
    const rec = loaded[m.file];
    if (!rec || rec.failed) return { node: shape({ shape: 'box', size: 1, color: '#9aa4b2' }, r), mixer: null };
    const skinned = rec.gltf.animations.length > 0, clone = skinned ? THREE.SkeletonUtils.clone(rec.gltf.scene) : rec.gltf.scene.clone(true);
    const target = +opts.height || ShortsResolve.height(m, r);
    let k = target / rec.h * (+opts.scale || 1);
    // flat, wide pieces (a tile, a rug) must not balloon when scaled to a height; buildings may be wide
    if (!opts.height && !/building|skyscraper|tower|house/i.test(m.name + m.file)) k = Math.min(k, Math.max(target * 2.2, 3) / rec.w * (+opts.scale || 1));
    const inner = new THREE.Group(); inner.add(clone); clone.position.set(-rec.center.x, -rec.min.y, -rec.center.z); inner.scale.setScalar(k);
    clone.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    if (opts.tint || opts.vary) clone.traverse(o => {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material) ? o.material.map(x => x.clone()) : o.material.clone();
      for (const mat of [].concat(o.material)) {
        if (!mat.color || /skin|eye|face|mouth|teeth/i.test(mat.name)) continue;
        if (opts.tint) mat.color.lerp(col(opts.tint), 0.55);
        else if (opts.vary) mat.color.offsetHSL((r() - 0.5) * 0.5, (r() - 0.5) * 0.2, (r() - 0.5) * 0.14);
      }
    });
    let mixer = null;
    if (skinned) {
      mixer = new THREE.AnimationMixer(clone);
      const want = String(opts.anim || 'idle').toLowerCase();
      const clips = rec.gltf.animations, end = n => n.toLowerCase().split('|').pop();
      const clip = clips.find(c => end(c.name).replace(/^(man|female|male|woman)_/, '') === want) || clips.find(c => end(c.name).includes(want)) || clips.find(c => /idle/i.test(c.name)) || clips[0];
      mixer.clipAction(clip).play();
    }
    return { node: inner, mixer };
  }

  // ---------- sets ----------
  function sky(sc, time, extra) {
    const k = SKY[time] || SKY.day;
    sc.scene.background = gradientTexture(extra.skyTop || k.top, extra.skyBottom || k.bottom);
    if (extra.fog !== false && time !== 'space') sc.scene.fog = new THREE.Fog(col(extra.skyBottom || k.fog), 60, 260);
    const hemi = new THREE.HemisphereLight(col(k.top).lerp(col('#ffffff'), 0.5), col(k.ground), k.hemi); sc.scene.add(hemi);
    const sun = new THREE.DirectionalLight(col(k.sunColor), k.sun); sun.position.set(30, 60, 25); sun.castShadow = true;
    Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 220 }); sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005;
    sc.scene.add(sun, sun.target); sc.lights = { hemi, sun, time };
  }
  const ground = (sc, color, size = 600) => { const g = new THREE.Mesh(new THREE.PlaneGeometry(size, size), flat(color, { roughness: 1 })); g.rotation.x = -Math.PI / 2; g.receiveShadow = true; sc.scene.add(g); return g; };
  const box = (sc, w, h, d, color, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), flat(color)); m.position.set(x, y + h / 2, z); m.castShadow = m.receiveShadow = true; sc.scene.add(m); return m; };

  // sets dress themselves from the matching pack (city kit, nature kit), never from space or indoor packs
  const SET_AVOID = /space|sci-?fi|alien|interior|furniture|cliff|ground|path|platform|tile|floor|block|edge|fence|bridge|wall/i;
  const SET_PREFER = { city: /city/i, nature: /nature/i };
  function buildSet(sc, set, r, lib) {
    const type = set.type || 'void', time = set.time || (type === 'space' || type === 'globe' ? 'space' : 'day');
    sky(sc, time, set);
    const place = (query, n, spots, opts = {}) => {
      const ms = ShortsResolve.pick(lib, query, Math.max(1, Math.min(n, opts.variety || 6)), { prefer: opts.prefer, avoid: SET_AVOID });
      spots.forEach((s, i) => {
        const m = ms[i % Math.max(1, ms.length)];
        const it = m ? instance(m, r, opts) : { node: shape({ shape: opts.fallback || 'box', size: opts.fallbackSize || 2, height: opts.fallbackHeight, color: opts.fallbackColor || '#a7b0be' }, r) };
        it.node.position.set(s[0], s[1] || 0, s[2]); it.node.rotation.y = s[3] || 0; sc.scene.add(it.node);
        if (it.mixer) sc.mixers.push([it.mixer, r() * 3]);
      });
    };
    if (type === 'city') {
      ground(sc, set.ground || '#7f9466');
      box(sc, 12, 0.02, 300, '#3b3f46', 0, 0, 0); // road
      for (const x of [-7.5, 7.5]) box(sc, 3, 0.18, 300, '#c9c4b8', x, 0, 0); // sidewalks
      for (let z = -140; z < 150; z += 8) box(sc, 0.25, 0.03, 3, '#f2f2ea', 0, 0, z); // lane dashes
      const spots = [];
      for (const side of [-1, 1]) for (let z = -150; z < -4; z += 13) spots.push([side * (19 + r() * 3), 0, z + r() * 3, side < 0 ? Math.PI / 2 : -Math.PI / 2]); // kept out of the camera's area
      place('building', spots.length, spots, { fallback: 'box', fallbackSize: 10, fallbackHeight: 24, variety: 8, prefer: SET_PREFER.city });
      const lamps = []; for (let z = -120; z < 30; z += 18) for (const side of [-1, 1]) lamps.push([side * 8.4, 0, z, side < 0 ? Math.PI / 2 : -Math.PI / 2]);
      if (set.lamps !== false) place('streetlight', lamps.length, lamps, { variety: 1, fallback: 'cylinder', fallbackSize: 0.18, fallbackHeight: 4.2, fallbackColor: '#4a4f58' });
    } else if (type === 'nature') {
      ground(sc, set.ground || '#4f8f3a');
      for (let i = 0; i < 6; i++) { const hill = new THREE.Mesh(jitter(new THREE.IcosahedronGeometry(40 + r() * 30, 1), r, 0.2), flat(i % 2 ? '#6aa04c' : '#7fb85e')); hill.scale.y = 0.35; hill.position.set((r() - 0.5) * 300, -8, -150 - r() * 80); hill.receiveShadow = true; sc.scene.add(hill); }
      const ring = (n, rmin, rmax) => [...Array(n)].map(() => { const a = r() * Math.PI * 2, d = rmin + r() * (rmax - rmin); return [Math.cos(a) * d, 0, Math.sin(a) * d - 10, r() * 6.28]; });
      place('tree', 46, ring(46, 14, 80), { variety: 6, prefer: SET_PREFER.nature, fallback: 'cone', fallbackSize: 3, fallbackHeight: 6, fallbackColor: '#3f8a46' });
      place('rock', 14, ring(14, 10, 60), { variety: 4, prefer: SET_PREFER.nature, fallback: 'rock' });
      place('bush', 24, ring(24, 8, 50), { variety: 4, prefer: SET_PREFER.nature, fallback: 'sphere', fallbackColor: '#4f9a4a' });
    } else if (type === 'interior') {
      ground(sc, set.ground || '#a87449', 40);
      box(sc, 20, 7, 0.3, set.wall || '#e9e1d4', 0, 0, -6); box(sc, 0.3, 7, 14, set.wall || '#e3dacb', -8, 0, 1);
      const win = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.6), new THREE.MeshBasicMaterial({ color: col(time === 'night' ? '#20305e' : '#cfe9ff') })); win.position.set(2.5, 3.2, -5.8); sc.scene.add(win);
      const lamp = new THREE.PointLight(col('#ffd7a0'), time === 'night' ? 1.4 : 0.6, 24, 1.5); lamp.position.set(-2, 4.5, 1); lamp.castShadow = true; sc.scene.add(lamp);
    } else if (type === 'coast' || type === 'seabed') {
      const sand = ground(sc, set.ground || (type === 'seabed' ? '#b9a27a' : '#e2cf9c'));
      const mkWater = (y, size, zc) => {
        const geo = new THREE.PlaneGeometry(size, size, 80, 80); geo.rotateX(-Math.PI / 2);
        const w = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col(set.water || '#2c7fc0'), flatShading: true, roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.94 }));
        w.position.set(0, y, zc); sc.scene.add(w); const base = geo.attributes.position.array.slice();
        sc.updaters.push(lt => { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, Math.sin(base[i * 3] * 0.09 + lt * 1.2) * 0.3 + Math.cos(base[i * 3 + 2] * 0.11 + lt) * 0.25); p.needsUpdate = true; geo.computeVertexNormals(); });
        return w;
      };
      if (type === 'coast') {
        // beach near the camera, open sea toward -z (sea level: effect "seaLevel"), a pier, ships, port buildings on the sides
        sand.position.y = 0;
        const shelf = new THREE.Mesh(new THREE.PlaneGeometry(600, 300), flat('#a89068')); shelf.rotation.x = -Math.PI / 2; shelf.position.set(0, -6, -170); sc.scene.add(shelf);
        sc.sea = mkWater(+set.seaLevel || 0.4, 600, -160);
        box(sc, 3, 0.4, 30, '#7a5a3c', 7, 0.6, -14);
        const ships = [[-8, -40, 0.3], [14, -70, -0.4], [-26, -95, 0.9]].slice(0, set.ships === false ? 0 : 3).map(([x, z, ry]) => [x, 0, z, ry]);
        place('ship boat', ships.length, ships, { variety: 2, fallback: 'ship', fallbackSize: 22, fallbackColor: '#2f3a4f' });
        sc.ships = ships.length ? sc.scene.children.slice(-ships.length) : [];
        const port = []; for (let z = 4; z < 60; z += 14) for (const side of [-1, 1]) port.push([side * (24 + r() * 4), 0, z, side < 0 ? Math.PI / 2 : -Math.PI / 2]);
        place('building', port.length, port, { variety: 6, prefer: SET_PREFER.city, fallback: 'box', fallbackSize: 10, fallbackHeight: 16 });
        const palms = []; for (let i = 0; i < 6; i++) palms.push([(r() - 0.5) * 36, 0, 2 + r() * 10, r() * 6.28]);
        place('palm tree', palms.length, palms, { variety: 3, prefer: SET_PREFER.nature, fallback: 'cone', fallbackSize: 2, fallbackHeight: 6, fallbackColor: '#3f8a46' });
      } else {
        // dry sea floor: dunes, rocks, kelp, half-buried wrecks, stranded fish, puddles, and a far wall of water if wanted
        for (let i = 0; i < 9; i++) { const d = new THREE.Mesh(jitter(new THREE.IcosahedronGeometry(10 + r() * 14, 1), r, 0.25), flat(i % 2 ? '#a99070' : '#c2ab82')); d.scale.y = 0.18; d.position.set((r() - 0.5) * 160, -1, -20 - r() * 140); d.receiveShadow = true; sc.scene.add(d); }
        for (let i = 0; i < 14; i++) { const k = shape({ shape: 'kelp', size: 1.5 + r() * 1.5 }, r); k.position.set((r() - 0.5) * 50, 0, -r() * 60); sc.scene.add(k); sc.updaters.push(lt => { k.rotation.z = Math.sin(lt * 1.3 + i) * 0.12; }); }
        for (let i = 0; i < 12; i++) { const k = shape({ shape: 'rock', size: 0.6 + r() * 1.6 }, r); k.position.set((r() - 0.5) * 60, 0.2, -r() * 70); sc.scene.add(k); }
        for (const [x, z, ry, tilt] of [[-9, -18, 0.6, 0.35], [16, -46, -1.1, -0.28]]) { const w = shape({ shape: 'ship', size: 20, color: '#5a4636' }, r); w.position.set(x, -1.6, z); w.rotation.set(0, ry, tilt); sc.scene.add(w); }
        for (let i = 0; i < 10; i++) { const f = shape({ shape: 'fish', size: 0.5 + r() * 0.5, color: ['#e2973a', '#d8d2c0', '#9cc0d8'][i % 3] }, r); const fx0 = (r() - 0.5) * 14, fz0 = -2 - r() * 14; f.position.set(fx0, 0.1, fz0); sc.scene.add(f); const ph = r() * 9; sc.updaters.push(lt => { f.rotation.x = Math.sin(lt * 9 + ph) * 0.6 * Math.max(0, Math.sin(lt * 1.6 + ph)); f.position.y = 0.1 + 0.2 * Math.abs(Math.sin(lt * 4.4 + ph)); }); }
        for (let i = 0; i < 6; i++) { const p = new THREE.Mesh(new THREE.CircleGeometry(1 + r() * 2.5, 12), new THREE.MeshStandardMaterial({ color: col('#3f7fae'), roughness: 0.2 })); p.rotation.x = -Math.PI / 2; p.position.set((r() - 0.5) * 50, 0.04, -r() * 50); sc.scene.add(p); }
        if (set.waterWall) { const w = shape({ shape: 'wave', size: 60 }, r); w.position.set(0, 0, -170); sc.scene.add(w); sc.wall = w; }
      }
    } else if (type === 'ocean') {
      const geo = new THREE.PlaneGeometry(600, 600, 120, 120); geo.rotateX(-Math.PI / 2);
      const water = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col(set.water || '#2c7fc0'), flatShading: true, roughness: 0.35, metalness: 0.1 })); water.receiveShadow = true; sc.scene.add(water);
      const base = geo.attributes.position.array.slice();
      sc.updaters.push(lt => { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const x = base[i * 3], z = base[i * 3 + 2]; p.setY(i, Math.sin(x * 0.08 + lt * 1.3) * 0.45 + Math.cos(z * 0.1 + lt * 0.9) * 0.35); } p.needsUpdate = true; geo.computeVertexNormals(); });
    } else if (type === 'space' || type === 'globe') {
      const pts = [], cr = [], c = new THREE.Color();
      for (let i = 0; i < 2600; i++) { const u = r() * 2 - 1, a = r() * Math.PI * 2, d = 380 + r() * 60, s = Math.sqrt(1 - u * u); pts.push(Math.cos(a) * s * d, u * d, Math.sin(a) * s * d); c.setHSL(0.6 + r() * 0.1, 0.4, 0.6 + r() * 0.4); cr.push(c.r, c.g, c.b); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(cr, 3));
      sc.scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false })));
      if (type === 'globe') { const e = shape({ shape: 'earth', size: +set.size || 10 }, r); sc.scene.add(e); sc.updaters.push(lt => { e.rotation.y = lt * 0.12; }); }
    } else {
      ground(sc, set.ground || '#d9dde5', 300);
    }
  }

  // ---------- objects: layouts, models, motion ----------
  function spots(o, r) {
    const n = Math.max(1, Math.min(+o.count || 1, 200)), p = v3(o.pos), area = o.area || [10, 10], out = [];
    const face = o.rotate != null ? THREE.MathUtils.degToRad(+o.rotate) : null;
    const yaw = () => face != null ? face : (r() - 0.5) * 1.2;
    if (n === 1) return [[p.x, p.y, p.z, face != null ? face : 0]];
    switch (o.layout) {
      case 'row': for (let i = 0; i < n; i++) out.push([p.x - area[0] / 2 + area[0] * (i + 0.5) / n, p.y, p.z, yaw()]); break;
      case 'line': { const a = v3(o.from || [-10, 0, 0]), b = v3(o.to || [10, 0, 0]); for (let i = 0; i < n; i++) { const q = a.clone().lerp(b, n === 1 ? 0.5 : i / (n - 1)); out.push([q.x, q.y, q.z, yaw()]); } break; }
      case 'grid': { const c = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / c); for (let i = 0; i < n; i++) out.push([p.x - area[0] / 2 + area[0] * ((i % c) + 0.5) / c, p.y, p.z - area[1] / 2 + area[1] * (Math.floor(i / c) + 0.5) / rows, yaw()]); break; }
      case 'ring': for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; out.push([p.x + Math.cos(a) * area[0] / 2, p.y, p.z + Math.sin(a) * area[0] / 2, -a - Math.PI / 2]); } break;
      default: { // crowd / scatter: random, kept about a body-width apart
        for (let i = 0, tries = 0; i < n && tries < n * 40; tries++) {
          const x = p.x + (r() - 0.5) * area[0], z = p.z + (r() - 0.5) * area[1];
          if (out.some(s => (s[0] - x) ** 2 + (s[2] - z) ** 2 < 0.9)) continue;
          out.push([x, p.y, z, o.layout === 'scatter' ? r() * 6.28 : yaw()]); i++;
        }
      }
    }
    return out;
  }
  function addObjects(sc, o, r, lib, fx, dur) {
    const where = spots(o, r), group = new THREE.Group(); sc.scene.add(group);
    const ms = o.model ? ShortsResolve.pick(lib, o.model, Math.min(where.length, +o.variety || 4), { animated: !!o.animated }) : [];
    const low = fx.lowGravity ? (+fx.lowGravity.strength || 0.5) : 0;
    where.forEach((s, i) => {
      const m = ms[i % Math.max(1, ms.length)];
      const it = o.model && m ? instance(m, r, { ...o, vary: o.vary != null ? !!o.vary : where.length > 1 && /person|people|human|crowd|man|woman/i.test(o.model) }) : { node: shape(o.model ? { shape: 'box', size: 1, color: '#9aa4b2' } : o, r), mixer: null };
      const holder = new THREE.Group(); holder.add(it.node); holder.position.set(s[0], s[1], s[2]); holder.rotation.y = s[3]; group.add(holder);
      const phase = r() * 10, base = holder.position.clone(), rot0 = holder.rotation.y;
      if (it.mixer) sc.mixers.push([it.mixer, phase, o.speed]);
      const scale0 = it.node.scale.x;
      sc.updaters.push(lt => {
        const f = lt / dur, pos = base.clone();
        if (o.move) { const e = EASE[o.move.ease || 'inOut'], a = +o.move.start || 0, b = o.move.end != null ? +o.move.end : 1; pos.add(v3(o.move.to).sub(v3(o.pos)).multiplyScalar(e((f - a) / Math.max(0.01, b - a)))); }
        if (o.walk) { const d = (+o.walk) * lt; pos.x += Math.sin(rot0) * d; pos.z += Math.cos(rot0) * d; }
        if (o.jump) { const h = (+o.jump) * (low ? 1 + low * 3 : 1), per = (+o.jumpEvery || 1.1) * (low ? 1 + low * 1.2 : 1); pos.y += h * Math.abs(Math.sin(Math.PI * (lt + phase) / per)); }
        if (o.float) { pos.y += (+o.float) * lt * (0.7 + 0.6 * ((phase * 7) % 1)); holder.rotation.z = Math.sin(lt * 0.7 + phase) * 0.25; holder.rotation.x = Math.cos(lt * 0.5 + phase) * 0.2; }
        if (o.fall) { const h0 = +o.fall, tt = clamp((lt - (+o.fallAt || 0)) / 1.2, 0, 1); pos.y += h0 * (1 - tt * tt) + (tt === 1 ? 0 : 0); }
        if (o.spin) holder.rotation.y = rot0 + THREE.MathUtils.degToRad(+o.spin) * lt;
        if (o.tumble) { holder.rotation.x = lt * (+o.tumble) * 0.017 + phase; holder.rotation.z = lt * (+o.tumble) * 0.013; }
        if (o.grow) { const [a, b] = Array.isArray(o.grow) ? o.grow : [1, +o.grow]; it.node.scale.setScalar(scale0 * (a + (b - a) * smooth(f))); }
        if (it.node.userData.spinChild) it.node.userData.spinChild.rotation.z = lt * 0.6;
        const ud = it.node.userData;
        if (ud.sway) it.node.rotation.z = Math.sin(lt * 1.3 + phase) * 0.12;
        if (o.flop || (ud.flop)) { holder.rotation.x = Math.sin(lt * 9 + phase) * 0.5 * Math.max(0, Math.sin(lt * 1.7 + phase)); pos.y += 0.25 * Math.abs(Math.sin(lt * 4.5 + phase)); }
        if (ud.crackGrow) it.node.scale.set(scale0 * smooth((lt - (+o.at || 0)) / 1.2) + 0.001, scale0, scale0);
        if (ud.explode) { const e = (lt - (+o.at || 0)) / 1.6; it.node.visible = e >= 0 && e < 1; if (e >= 0) { it.node.scale.setScalar(scale0 * (0.2 + 1.6 * EASE.out(e))); it.node.children.forEach(c => { if (c.material) c.material.opacity = (1 - e) * (c === it.node.children[0] ? 1 : 0.6); }); } }
        if (ud.flicker) it.node.visible = Math.sin(lt * 31 + phase * 13) > 0.35 && Math.sin(lt * 2.3 + phase) > 0;
        if (o.face) { const f2 = v3(o.face); holder.rotation.y = Math.atan2(f2.x - pos.x, f2.z - pos.z); }
        holder.position.copy(pos);
      });
    });
  }

  // ---------- effects ----------
  function particles(sc, p, r) {
    const kind = p.kind || 'dust', n = Math.min(+p.amount || 800, 4000), area = p.area || [60, 40, 60];
    const g = new THREE.BufferGeometry(), base = new Float32Array(n * 3), pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { base[i * 3] = (r() - 0.5) * area[0]; base[i * 3 + 1] = r() * area[1]; base[i * 3 + 2] = (r() - 0.5) * area[2] - 10; }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const look = { rain: ['#bcd3ff', 0.12, 0.7], snow: ['#ffffff', 0.22, 0.95], dust: ['#f3e2c0', 0.1, 0.5], stars: ['#ffffff', 0.3, 0.95], sparks: ['#ffb45a', 0.18, 0.95], bubbles: ['#cfefff', 0.2, 0.7], leaves: ['#d98a3a', 0.26, 0.9] }[kind] || ['#ffffff', 0.4, 0.8];
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: col(p.color || look[0]), size: look[1], transparent: true, opacity: look[2], depthWrite: false, blending: kind === 'sparks' || kind === 'stars' ? THREE.AdditiveBlending : THREE.NormalBlending }));
    sc.scene.add(pts);
    const vel = { rain: [0, -22, 0], snow: [0.4, -1.4, 0], dust: [0.6, 0.15, 0], stars: [0, 0, 0], sparks: [0, 3.5, 0], bubbles: [0, 1.6, 0], leaves: [1.2, -1.1, 0.3] }[kind] || [0, -1, 0];
    sc.updaters.push(lt => {
      for (let i = 0; i < n; i++) {
        let y = base[i * 3 + 1] + vel[1] * lt; y = ((y % area[1]) + area[1]) % area[1];
        pos[i * 3] = base[i * 3] + vel[0] * lt + Math.sin(lt + i) * (kind === 'snow' || kind === 'leaves' ? 0.6 : 0);
        pos[i * 3 + 1] = y; pos[i * 3 + 2] = base[i * 3 + 2] + vel[2] * lt;
      }
      g.attributes.position.needsUpdate = true;
      if (kind === 'stars') pts.material.opacity = 0.6 + 0.35 * Math.sin(lt * 3);
    });
  }

  // ---------- camera ----------
  const CAM = {
    wide: { pos: [0, 7, 21], look: [0, 1.4, 0] }, street: { pos: [1.4, 1.65, 9.5], look: [0, 1.5, 0] }, aerial: { pos: [0, 46, 34], look: [0, 0, -4] },
    closeup: { pos: [0.6, 1.65, 4.2], look: [0, 1.45, 0] }, low: { pos: [0, 0.45, 11], look: [0, 3.2, 0] }, space: { pos: [0, 12, 70], look: [0, 0, 0] },
    room: { pos: [4.5, 2.6, 9], look: [-0.5, 1.3, 0] }, globe: { pos: [0, 4, 34], look: [0, 0, 0] },
  };
  function cameraPath(c, setType) {
    const pre = CAM[c.preset] || CAM[{ space: 'space', globe: 'globe', interior: 'room' }[setType]] || CAM.wide;
    const p0 = v3(c.pos || pre.pos), l0 = v3(c.look || pre.look);
    let p1 = c.to && c.to.pos ? v3(c.to.pos) : p0.clone(), l1 = c.to && c.to.look ? v3(c.to.look) : l0.clone();
    const dir = p0.clone().sub(l0), k = +c.amount || 1;
    switch (c.move) {
      case 'pushIn': p1 = l0.clone().add(dir.multiplyScalar(1 - 0.28 * k)); break;
      case 'pullOut': p1 = l0.clone().add(dir.multiplyScalar(1 + 0.4 * k)); break;
      case 'orbit': p1 = l0.clone().add(dir.applyAxisAngle(V(0, 1, 0), THREE.MathUtils.degToRad(40 * k))); break;
      case 'pan': p1 = p0.clone().add(V(8 * k, 0, 0)); l1 = l0.clone().add(V(8 * k, 0, 0)); break;
      case 'rise': p1 = p0.clone().add(V(0, 10 * k, 0)); break;
      case 'drop': p1 = p0.clone().add(V(0, -6 * k, 0)); break;
      case 'track': p1 = p0.clone().add(V(0, 0, -12 * k)); l1 = l0.clone().add(V(0, 0, -12 * k)); break;
    }
    return { p0, p1, l0, l1, fov0: +c.fov || 45, fov1: +(c.to && c.to.fov) || +c.fov || 45, ease: EASE[c.ease || 'inOut'] };
  }

  // ---------- 2D overlay: headline, counter, captions, end card ----------
  let g2;
  function text(str, x, y, font, color, o = {}) {
    g2.save(); g2.globalAlpha = o.alpha == null ? 1 : o.alpha; g2.font = font; g2.fillStyle = color; g2.textAlign = o.align || 'left'; g2.textBaseline = 'middle';
    if ('letterSpacing' in g2) g2.letterSpacing = (o.ls || 0) + 'px';
    if (o.shadow !== false) { g2.shadowColor = 'rgba(0,0,0,.55)'; g2.shadowBlur = 14; g2.shadowOffsetY = 3; }
    // no dark outline: the creator wants plain white text with just the soft shadow above
    g2.fillText(str, x, y); g2.restore();
  }
  function wrap(str, font, maxW) {
    g2.font = font; const words = String(str).split(/\s+/), lines = []; let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (g2.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur); return lines;
  }
  function headline(plan, y, size, alpha) {
    const font = `500 ${size}px ${SERIF}`, lines = wrap(plan.title || '', font, W * 0.8), lh = size * 1.18, hi = String(plan.highlight || '').toLowerCase();
    lines.forEach((ln, i) => {
      const yy = y - (lines.length - 1) * lh / 2 + i * lh;
      if (!hi || !ln.toLowerCase().includes(hi)) return text(ln, W / 2, yy, font, '#f3f4f6', { align: 'center', alpha });
      g2.font = font; const at = ln.toLowerCase().indexOf(hi), a = ln.slice(0, at), b = ln.slice(at, at + hi.length), c = ln.slice(at + hi.length);
      let x = W / 2 - g2.measureText(ln).width / 2;
      for (const [s, color] of [[a, '#f3f4f6'], [b, plan.accent || '#ff6a5c'], [c, '#f3f4f6']]) { text(s, x, yy, font, color, { alpha }); g2.font = font; x += g2.measureText(s).width; }
    });
  }
  const fmt = (v, c) => { const d = +c.decimals || 0, n = Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); return (c.prefix || '') + n + (c.unit || ''); };

  // ---------- soundtrack (synthesized, offline) ----------
  const MOODS = {
    wonder: [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 66]], calm: [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 67]],
    tense: [[57, 60, 63, 67], [56, 59, 63, 66], [53, 56, 60, 63], [52, 55, 59, 62]], epic: [[50, 57, 62, 65], [46, 53, 58, 62], [48, 55, 60, 64], [45, 52, 57, 61]],
    playful: [[60, 64, 67, 72], [65, 69, 72, 76], [62, 65, 69, 72], [67, 71, 74, 77]],
  };
  const hz = m => 440 * 2 ** ((m - 69) / 12);
  function noiseBuffer(c, sec) { const b = c.createBuffer(1, Math.ceil(c.sampleRate * sec), c.sampleRate), d = b.getChannelData(0), r = rng(99); for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1; return b; }
  function sfx(c, out, type, t, nb) {
    const env = (g, a, peak, d) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
    const noise = (dur, type2, f0, f1, peak, a = 0.05) => { const s = c.createBufferSource(); s.buffer = nb; const f = c.createBiquadFilter(); f.type = type2; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur); const g = c.createGain(); env(g, a, peak, dur); s.connect(f).connect(g).connect(out); s.start(t, (t * 7) % 3); s.stop(t + dur + a + 0.1); };
    const tone = (type2, f0, f1, dur, peak, a = 0.01) => { const o = c.createOscillator(); o.type = type2; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur); const g = c.createGain(); env(g, a, peak, dur); o.connect(g).connect(out); o.start(t); o.stop(t + dur + a + 0.1); };
    switch (type) {
      case 'whoosh': noise(0.9, 'bandpass', 300, 3000, 0.5, 0.25); break;
      case 'boom': tone('sine', 120, 32, 1.4, 0.9); noise(1.2, 'lowpass', 900, 80, 0.5); break;
      case 'chime': [0, 0.12, 0.24].forEach((d, i) => { const tt = t + d; const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = hz(84 + [0, 4, 7][i]); const g = c.createGain(); g.gain.setValueAtTime(0.0001, tt); g.gain.exponentialRampToValueAtTime(0.18, tt + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, tt + 1.6); o.connect(g).connect(out); o.start(tt); o.stop(tt + 1.8); }); break;
      case 'rumble': noise(3, 'lowpass', 160, 60, 0.6, 0.5); break;
      case 'wind': noise(4, 'bandpass', 500, 900, 0.22, 1.2); break;
      case 'siren': { const o = c.createOscillator(); o.type = 'triangle'; const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.2); g.gain.setValueAtTime(0.12, t + 2.6); g.gain.exponentialRampToValueAtTime(0.0001, t + 3); for (let k = 0; k < 6; k++) { o.frequency.setValueAtTime(700, t + k * 0.5); o.frequency.linearRampToValueAtTime(980, t + k * 0.5 + 0.25); } o.connect(g).connect(out); o.start(t); o.stop(t + 3.1); break; }
      case 'crowd': noise(3, 'bandpass', 700, 1100, 0.2, 0.6); break;
      case 'heartbeat': for (let k = 0; k < 4; k++) [0, 0.22].forEach(d => { const tt = t + k * 0.9 + d, o = c.createOscillator(); o.frequency.setValueAtTime(70, tt); o.frequency.exponentialRampToValueAtTime(40, tt + 0.15); const g = c.createGain(); g.gain.setValueAtTime(0.0001, tt); g.gain.exponentialRampToValueAtTime(0.7, tt + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.2); o.connect(g).connect(out); o.start(tt); o.stop(tt + 0.25); }); break;
      case 'pop': tone('sine', 900, 300, 0.12, 0.35); break;
      case 'thunder': noise(2.6, 'lowpass', 1400, 70, 0.8, 0.02); break;
      case 'jump': tone('triangle', 260, 620, 0.35, 0.18); break;
    }
  }
  async function soundtrack(plan, scenes, dur) {
    const SR = 48000, c = new OfflineAudioContext(2, Math.ceil(SR * dur), SR), master = c.createGain(); master.gain.value = 0.8;
    const comp = c.createDynamicsCompressor(); master.connect(comp).connect(c.destination);
    const music = c.createGain(); music.gain.value = plan.music === false ? 0 : 0.5; music.connect(master);
    const fx = c.createGain(); fx.gain.value = 0.9; fx.connect(master);
    const mood = MOODS[(plan.music && plan.music.mood) || plan.mood || 'wonder'] || MOODS.wonder, nb = noiseBuffer(c, 4);
    scenes.forEach((s, i) => {
      const chord = (s.chord && MOODS[s.chord] ? MOODS[s.chord][0] : mood[i % mood.length]), t0 = s.t0, t1 = s.t1;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1300; lp.connect(music);
      for (const n of chord) for (const det of [-6, 6]) {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(n); o.detune.value = det;
        const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.035, t0 + 0.6); g.gain.setValueAtTime(0.035, Math.max(t0 + 0.6, t1 - 0.4)); g.gain.linearRampToValueAtTime(0.0001, t1 + 0.3);
        o.connect(g).connect(lp); o.start(t0); o.stop(t1 + 0.4);
      }
      const b = c.createOscillator(); b.type = 'sine'; b.frequency.value = hz(chord[0] - 12); const bg = c.createGain(); bg.gain.setValueAtTime(0.0001, t0); bg.gain.linearRampToValueAtTime(0.16, t0 + 0.3); bg.gain.linearRampToValueAtTime(0.0001, t1 + 0.2); b.connect(bg).connect(music); b.start(t0); b.stop(t1 + 0.3);
      for (let tt = t0 + 0.25, k = 0; tt < t1 - 0.1; tt += 0.375, k++) { // soft arpeggio
        const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = hz(chord[k % chord.length] + 12); const g = c.createGain();
        g.gain.setValueAtTime(0.0001, tt); g.gain.exponentialRampToValueAtTime(0.05, tt + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.33); o.connect(g).connect(music); o.start(tt); o.stop(tt + 0.36);
      }
      if (i > 0) sfx(c, fx, 'whoosh', Math.max(0, t0 - 0.35), nb);
      // kits bring their own sound
      if (s.fx.storm) { sfx(c, fx, 'wind', t0, nb); sfx(c, fx, 'thunder', t0 + 1.2, nb); }
      if (s.fx.quake) sfx(c, fx, 'rumble', t0, nb);
      if (s.fx.impact) sfx(c, fx, 'boom', t0 + (+s.fx.impact.at || 1), nb);
      if (s.fx.flood || s.fx.seaLevel || s.fx.wallApproach) sfx(c, fx, 'rumble', t0 + 0.3, nb);
      for (const e of [].concat(s.sfx || [])) { const o = typeof e === 'string' ? { type: e } : e; sfx(c, fx, o.type, t0 + (+o.at || 0), nb); }
    });
    return c.startRendering();
  }
  function wav(buf) {
    const ch = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate, dv = new DataView(new ArrayBuffer(44 + n * ch * 2));
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); dv.setUint32(4, 36 + n * ch * 2, true); ws(8, 'WAVE'); ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true); ws(36, 'data'); dv.setUint32(40, n * ch * 2, true);
    const data = [...Array(ch)].map((_, k) => buf.getChannelData(k)); let o = 44;
    for (let i = 0; i < n; i++) for (let k = 0; k < ch; k++) { const v = clamp(data[k][i], -1, 1); dv.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
    const bytes = new Uint8Array(dv.buffer); let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  // ---------- start ----------
  async function start(plan, lib) {
    lib = lib || []; const custom = window.ShortsCustom || {};
    const out = document.createElement('canvas'); out.width = W; out.height = H; document.body.appendChild(out); g2 = out.getContext('2d');
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(W, H, false); renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.9; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // preload every library model the plan mentions (sets pull in buildings, trees, lamps...)
    const queries = [];
    for (const s of plan.scenes) {
      for (const o of s.objects || []) if (o.model) queries.push([o.model, Math.min(+o.variety || 4, +o.count || 1), { animated: !!o.animated }]);
      const t = (s.set || {}).type;
      if (t === 'city') queries.push(['building', 8, { prefer: SET_PREFER.city, avoid: SET_AVOID }], ['streetlight', 1, { avoid: SET_AVOID }]); // must match buildSet's place() calls
      if (t === 'nature') for (const [q, n] of [['tree', 6], ['rock', 4], ['bush', 4]]) queries.push([q, n, { prefer: SET_PREFER.nature, avoid: SET_AVOID }]);
      if (t === 'coast') queries.push(['ship boat', 2, { avoid: SET_AVOID }], ['building', 6, { prefer: SET_PREFER.city, avoid: SET_AVOID }], ['palm tree', 3, { prefer: SET_PREFER.nature, avoid: SET_AVOID }]);
    }
    for (const q of plan.preload || []) queries.push([q, 4]);
    const files = new Set(); for (const [q, n, o] of queries) for (const m of ShortsResolve.pick(lib, q, n, o)) files.add(m.file);
    await Promise.all([...files].map(loadModel));

    // build every scene up front (deterministic: everything depends only on the plan's seed and time)
    let t = 0; const scenes = [];
    plan.scenes.forEach((s, i) => {
      const r = rng((+plan.seed || 7) * 1000 + i), dur = Math.max(1.5, +s.dur || 5);
      const sc = { ...s, t0: t, t1: t + dur, dur, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(45, W / H, 0.1, 1200), updaters: [], mixers: [], fx: {} };
      for (const e of s.effects || []) sc.fx[e.type] = e;
      buildSet(sc, s.set || {}, r, lib);
      for (const o of s.objects || []) addObjects(sc, o, r, lib, sc.fx, dur);
      for (const e of s.effects || []) if (e.type === 'particles') particles(sc, e, r);
      // scene-level kits: water levels, storm, earthquake, impact (each one isolated so a mistake can't break the render)
      try {
        const lerpOver = (e, set) => sc.updaters.push(lt => set(+e.from + (+e.to - +e.from) * smooth((lt / dur - (+e.start || 0)) / Math.max(0.05, (e.end != null ? +e.end : 1) - (+e.start || 0)))));
        if (sc.fx.seaLevel && sc.sea) { const e = sc.fx.seaLevel; e.from = e.from != null ? e.from : sc.sea.position.y; lerpOver(e, y => { sc.sea.position.y = y; if (sc.ships) sc.ships.forEach(sh => { sh.position.y = Math.max(-1.2, y - 0.4); sh.rotation.z = y < 0 ? 0.25 : 0; }); }); }
        if (sc.fx.flood) { const e = { from: 0, to: 2, ...sc.fx.flood }; const geo = new THREE.PlaneGeometry(400, 400, 60, 60); geo.rotateX(-Math.PI / 2); const w = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col(e.color || '#5b7d8f'), flatShading: true, roughness: 0.3, transparent: true, opacity: 0.88 })); sc.scene.add(w); const base = geo.attributes.position.array.slice(); lerpOver(e, y => { w.position.y = y; }); sc.updaters.push(lt => { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, Math.sin(base[i * 3] * 0.3 + lt * 2) * 0.08 + Math.cos(base[i * 3 + 2] * 0.25 + lt * 1.6) * 0.06); p.needsUpdate = true; geo.computeVertexNormals(); }); }
        if (sc.fx.storm) { sc.fx.darken = sc.fx.darken || { to: 'night', start: 0, end: 0.35 }; particles(sc, { kind: 'rain', amount: +sc.fx.storm.rain || 2200 }, r); const bolt = shape({ shape: 'lightning', size: 70 }, r); bolt.position.set((r() - 0.5) * 60, 0, -90); sc.scene.add(bolt); sc.updaters.push(lt => { bolt.visible = (lt % 3.1) > 1.2 && (lt % 3.1) < 1.45; }); }
        if (sc.fx.quake) { sc.fx.shake = sc.fx.shake || { amount: +sc.fx.quake.amount || 0.35 }; for (let i = 0; i < 3; i++) { const c = shape({ shape: 'crack', size: 10 + r() * 10 }, r), at = 0.5 + i * 0.8; c.position.set((r() - 0.5) * 10, 0, -r() * 12); c.rotation.y = r() * 3; sc.scene.add(c); sc.updaters.push(lt => { c.scale.x = smooth((lt - at) / 1.2) + 0.001; }); } }
        if (sc.fx.impact) { const e = sc.fx.impact, at = +e.at || 1, ex = shape({ shape: 'explosion', size: +e.size || 8 }, r); ex.position.copy(v3(e.pos || [0, 4, -40])); sc.scene.add(ex); sc.updaters.push(lt => { const k = (lt - at) / 1.6; ex.visible = k >= 0 && k < 1; if (k >= 0) { ex.scale.setScalar(0.2 + 1.6 * EASE.out(k)); ex.children.forEach((c, j) => { if (c.material) c.material.opacity = (1 - k) * (j ? 0.6 : 1); }); } }); sc.fx.flash = sc.fx.flash || { at }; sc.impactAt = at; }
        if (sc.wall && sc.fx.wallApproach) { const e = { from: -170, to: -20, ...sc.fx.wallApproach }; lerpOver(e, z => { sc.wall.position.z = z; }); }
      } catch (err) { console.warn('effect kit failed', err && err.message); }
      if (sc.fx.fog) sc.scene.fog = new THREE.FogExp2(col(sc.fx.fog.color || (SKY[(s.set || {}).time] || SKY.day).fog), +sc.fx.fog.density || 0.02);
      if (s.custom && custom[s.custom]) { const u = custom[s.custom]({ THREE, scene: sc.scene, camera: sc.camera, rng: r, lib, instance: (q, o = {}) => { const m = ShortsResolve.pick(lib, q, 1)[0]; const it = m ? instance(m, r, o) : { node: shape({ shape: 'box' }, r) }; if (it.mixer) sc.mixers.push([it.mixer, 0]); return it.node; }, shape: o => shape(o, r), dur }); if (typeof u === 'function') sc.updaters.push(u); else if (u && u.update) sc.updaters.push(u.update); }
      sc.cam = cameraPath(s.camera || {}, (s.set || {}).type);
      scenes.push(sc); t += dur;
    });
    const endDur = plan.end === false ? 0 : +(plan.end && plan.end.dur) || 4.5, DUR = t + endDur;

    // counter values: each scene tweens from the previous value to its own
    let prev = plan.counter ? +plan.counter.from || 0 : 0;
    for (const sc of scenes) { sc.cFrom = prev; sc.cTo = sc.counter && sc.counter.to != null ? +sc.counter.to : prev; prev = sc.cTo; }

    function frame(time) {
      const last = scenes[scenes.length - 1], sc = scenes.find(s => time >= s.t0 && time < s.t1) || last, lt = Math.min(time - sc.t0, sc.dur + endDur);
      const k = sc.cam, f = k.ease(lt / sc.dur), slow = sc.fx.slowmo ? +sc.fx.slowmo.factor || 0.5 : 1;
      for (const u of sc.updaters) u(lt * slow, time);
      for (const [m, off, sp] of sc.mixers) m.setTime((lt * slow) * (+sp || 1) + off);
      const cam = sc.camera, p = k.p0.clone().lerp(k.p1, f), l = k.l0.clone().lerp(k.l1, f);
      if (sc.impactAt != null && lt > sc.impactAt) { const a = 0.8 * Math.max(0, 1 - (lt - sc.impactAt) / 1.5); p.add(V(Math.sin(time * 47) * a, Math.sin(time * 39) * a, 0)); }
      if (sc.fx.shake) { const a = +sc.fx.shake.amount || 0.25; p.add(V(Math.sin(time * 43.1) * a, Math.sin(time * 37.7 + 1) * a * 0.7, Math.sin(time * 29.3 + 2) * a * 0.5)); }
      cam.position.copy(p); cam.fov = k.fov0 + (k.fov1 - k.fov0) * f; cam.updateProjectionMatrix(); cam.lookAt(l);
      if (sc.fx.darken && sc.lights) { const night = SKY[sc.fx.darken.to || 'night'], base = SKY[sc.lights.time] || SKY.day, a = smooth((lt / sc.dur - (+sc.fx.darken.start || 0)) / Math.max(0.05, (+sc.fx.darken.end || 1) - (+sc.fx.darken.start || 0)));
        sc.lights.hemi.intensity = base.hemi + (night.hemi - base.hemi) * a; sc.lights.sun.intensity = base.sun + (night.sun - base.sun) * a;
        if (!sc.darkTex) sc.darkTex = [sc.scene.background, gradientTexture(night.top, night.bottom)];
        sc.scene.background = a > 0.5 ? sc.darkTex[1] : sc.darkTex[0]; if (sc.scene.fog && sc.scene.fog.color) sc.scene.fog.color.copy(col(base.fog).lerp(col(night.fog), a)); }
      renderer.render(sc.scene, cam); // straight to the canvas: a bloom pass here washed colors out (no gamma step in r128)

      // 2D overlay on top of the 3D frame
      g2.globalAlpha = 1; g2.drawImage(renderer.domElement, 0, 0, W, H);
      const vg = g2.createRadialGradient(W / 2, H * 0.45, H * 0.25, W / 2, H * 0.5, H * 0.75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.38)'); g2.fillStyle = vg; g2.fillRect(0, 0, W, H);
      if (sc.fx.tint) { g2.fillStyle = sc.fx.tint.color || '#ff6a00'; g2.globalAlpha = +sc.fx.tint.amount || 0.15; g2.fillRect(0, 0, W, H); g2.globalAlpha = 1; }
      const inEnd = time >= last.t1;
      // headline: opening shot only (and on the end card)
      if (sc === scenes[0] && !inEnd) { const a = smooth(lt / 0.5) * (1 - smooth((lt - (+plan.titleHold || 2.8)) / 0.5)); if (a > 0.01) headline(plan, H * 0.4, 66, a); }
      // counter block, mid-left, the whole video
      // the counter appears once the opening headline has gone
      const cAlpha = sc === scenes[0] ? smooth((lt - (+plan.titleHold || 2.8) - 0.2) / 0.4) : 1;
      if (plan.counter && !inEnd && cAlpha > 0.01) {
        g2.globalAlpha = cAlpha; const v = sc.cFrom + (sc.cTo - sc.cFrom) * EASE.out(lt / (+(sc.counter && sc.counter.over) || 1.6)), x = W * 0.08, y = H * 0.465;
        text(String(plan.counter.label || '').toUpperCase(), x, y, `600 24px ${MONO}`, '#f3f4f6', { ls: 4, alpha: 0.95 * cAlpha, outline: 6 });
        text(sc.counter && sc.counter.text ? sc.counter.text : fmt(v, plan.counter), x - 4, y + 72, `400 108px ${SERIF}`, '#ffffff', { alpha: cAlpha, outline: 12 });
        if (sc.counter && sc.counter.sub) text(String(sc.counter.sub).toUpperCase(), x, y + 146, `500 24px ${MONO}`, '#f3f4f6', { ls: 3, alpha: 0.9 * cAlpha, outline: 6 });
        g2.globalAlpha = 1;
      }
      // caption: one italic line per scene, around 63% height, never wider than 70% of the frame
      if (sc.caption && !inEnd) {
        const a = smooth((lt - 0.35) / 0.4) * (1 - smooth((lt - sc.dur + 0.35) / 0.3)), font = `italic 400 52px ${SERIF}`, lines = wrap(sc.caption, font, W * 0.7).slice(0, 2);
        lines.forEach((ln, i) => text(ln, W / 2, H * 0.635 + (i - (lines.length - 1) / 2) * 64, font, '#ffffff', { align: 'center', alpha: a, outline: 10 }));
      }
      // flash at a scene's start, and a quick dip to black between scenes
      if (sc.fx.flash) { const a = 1 - smooth((lt - (+sc.fx.flash.at || 0)) / 0.45); if (a > 0 && lt >= (+sc.fx.flash.at || 0)) { g2.globalAlpha = a; g2.fillStyle = sc.fx.flash.color || '#ffffff'; g2.fillRect(0, 0, W, H); g2.globalAlpha = 1; } }
      const edge = Math.min(lt, sc.dur - lt); if (!inEnd && edge < 0.14 && scenes.length > 1) { g2.globalAlpha = 1 - edge / 0.14; g2.fillStyle = '#000'; g2.fillRect(0, 0, W, H); g2.globalAlpha = 1; }
      // end card
      if (inEnd && plan.end !== false) {
        const e = plan.end || {}, et = time - last.t1, a = smooth(et / 0.6);
        g2.globalAlpha = a * (e.dim != null ? +e.dim : 0.86); // e.dim: how dark the end card is (0-1) g2.fillStyle = '#07090e'; g2.fillRect(0, 0, W, H); g2.globalAlpha = 1;
        headline(plan, H * 0.36, 72, a);
        (e.lines || []).slice(0, 2).forEach((ln, i) => text(String(ln).toUpperCase(), W / 2, H * 0.47 + i * 44, `500 26px ${MONO}`, '#d7dbe3', { align: 'center', ls: 3, alpha: smooth((et - 0.4) / 0.5), shadow: false }));
        if (e.share) { const sa = smooth((et - 0.9) / 0.5); text('↗', W / 2, H * 0.575, `400 54px ${SERIF}`, plan.accent || '#ff6a5c', { align: 'center', alpha: sa, shadow: false }); wrap(String(e.share).toUpperCase(), `600 26px ${MONO}`, W * 0.7).forEach((ln, i) => text(ln, W / 2, H * 0.62 + i * 40, `600 26px ${MONO}`, plan.accent || '#ff6a5c', { align: 'center', ls: 3, alpha: sa, shadow: false })); }
        if (e.handle) text(e.handle, W / 2, H * 0.7, `500 24px ${MONO}`, '#9aa3b2', { align: 'center', alpha: smooth((et - 1.2) / 0.5), shadow: false });
      }
      return out.toDataURL('image/jpeg', 0.92).split(',')[1];
    }

    window.__dur = DUR;
    window.__frame = frame;
    window.__audio = async () => wav(await soundtrack(plan, scenes, DUR));
    try { await Promise.all(['500 66px Newsreader', 'italic 400 52px Newsreader', '400 108px Newsreader', '600 24px "IBM Plex Mono"'].map(f => document.fonts.load(f))); } catch {}
    frame(0);
    window.__ready = true;
  }

  window.ShortsEngine = { start };
})();
