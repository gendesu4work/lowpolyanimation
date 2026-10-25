# Scene plan reference

A video is one `plan.json` in `videos/<folder>/`. The engine (`engine/engine.js`) does everything else: sets, models, camera, effects, the counter, captions, headline, end card and music. Don't write Three.js unless a scene truly needs something the plan can't express (see **custom**).

Check a plan with `node scripts/check-plan.js videos/<folder>` (instant, free), then `node scripts/render.js videos/<folder> --sample`.

## Whole video

```json
{
  "title": "What if gravity was half as strong for a day?",
  "highlight": "half",            // word in the title drawn in the accent color (optional)
  "seed": 3,                      // changes crowd positions/variety; any number
  "mood": "wonder",               // music: wonder | calm | tense | epic | playful
  "titleHold": 2.8,               // seconds the headline stays on the opening shot
  "counter": { "label": "Gravity", "unit": "%", "from": 100, "decimals": 0, "prefix": "" },
  "scenes": [ ... ],              // 6-12 scenes of 4-7 s; total 45-85 s
  "end": { "lines": ["Two short takeaway lines", "in capitals on the end card"], "share": "Send this to someone who...", "handle": "@yourhandle", "dur": 4.5 },
  "accent": "#ff6a5c",            // optional
  "preload": ["rocket"]           // extra model searches for custom code (optional)
}
```

The headline shows only on the first scene and the end card. The counter shows mid-left the whole time (after the headline), each scene tweening it to its own value.

## A scene

```json
{
  "dur": 5,
  "set": { "type": "city", "time": "day" },
  "caption": "One italic sentence, under ~60 characters.",
  "counter": { "to": 50, "sub": "9:00 AM" },     // to: new value (optional); sub: small label under it; text: replaces the number
  "camera": { "preset": "street", "move": "pushIn" },
  "objects": [ ... ],
  "effects": [ ... ],
  "sfx": ["whoosh", { "type": "boom", "at": 2.5 }]
}
```

**set.type**: `city` (road, sidewalks, city-kit buildings, street lamps), `nature` (grass, hills, nature-kit trees/rocks/bushes), `interior` (floor, two walls, window, warm lamp; add furniture as objects), `ocean` (animated water), `space` (stars), `globe` (stars + a spinning Earth at the origin; `size`), `void` (plain ground).
Story kits for "What if" moments (use them instead of improvising with boxes):
- `coast`: beach near the camera, open sea toward -z, a pier, ships on the water, port buildings and palms. `seaLevel` (meters, default 0.4); `ships: false`. Pair with the **seaLevel** effect to drain or raise the sea (ships settle onto the sand when it drops). Good cameras: `wide` or `aerial` looking out to sea.
- `seabed`: the dry ocean floor: dunes, kelp, rocks, two half-buried wrecks, stranded fish flopping, puddles. `waterWall: true` puts a giant wave on the horizon; the **wallApproach** effect brings it closer.

**set.time**: `day`, `sunset`, `dawn`, `night` (space/globe are always space). Optional `ground`, `wall`, `water` colors; `skyTop`/`skyBottom`; `lamps: false`; `fog: false`.
World units are meters. The city road runs along z; the camera's default area is around the origin (x -10..10, z -15..15). Buildings line the road further back (z < -4).

**camera.preset**: `street` (eye level, close), `wide`, `aerial`, `closeup` (a person's face), `low` (looking up), `room` (interior), `space`, `globe`.
**camera.move**: `pushIn`, `pullOut`, `orbit`, `pan`, `rise`, `drop`, `track` (moves along -z), or none. `amount` scales it (default 1). Full control instead: `"pos": [x,y,z], "look": [x,y,z], "to": { "pos": [...], "look": [...], "fov": 35 }`, `"fov"`, `"ease": "linear|inOut|in|out"`.

## Objects

Library models by everyday words (the engine searches the creator's library: people, animals, vehicles, buildings, trees, furniture, space kit):

```json
{ "model": "person", "animated": true, "count": 14, "layout": "crowd", "pos": [0, 0, 2], "area": [12, 8], "anim": "Walk", "walk": 1.3 }
{ "model": "taxi", "pos": [-2.5, 0, -12], "rotate": 0, "move": { "to": [-2.5, 0, 6], "ease": "inOut", "start": 0, "end": 1 } }
{ "model": "dog", "animated": true, "count": 3, "layout": "row", "area": [6, 2], "anim": "Gallop", "jump": 1.2 }
```

- `model`: words like person, dog, horse, cow, taxi, police, truck, building, tree, sofa, lamp, astronaut, spaceship. `animated: true` keeps rigged characters only. Run `node scripts/find-models.js "<word>"` only if unsure a word matches.
- `count` + `layout`: `crowd` (random, spaced), `scatter` (random facing), `row`, `grid` (in `area` [w, d] around `pos`), `line` (`from` → `to`), `ring` (diameter `area[0]`). People get varied outfit colors automatically; `variety` = how many different models (default 4).
- `anim`: animation name (people: Idle, Walk, Run, Jump, Wave, Clapping, Sitting, Punch, Death…; animals: Idle, Walk, Gallop, Jump, Eating…; astronauts: Wave, Yes, No, Run…). `speed` multiplies it.
- Size: real-world heights are automatic (person 1.8 m, car 1.55 m, building 14-36 m, tree 4.5-7.5 m). Override with `height` (meters) or `scale`.
- `rotate` (degrees, 0 faces the camera), `tint` ("#hex" recolor), `vary` (true/false outfit variety).

Motion (any object): `move` (to a point over the scene), `walk` (m/s forward, use with anim Walk/Run), `jump` (hop height m; `jumpEvery` s), `float` (rise m/s with a slow tumble), `fall` (start height m, lands over 1.2 s from `fallAt` s), `spin` (deg/s), `tumble` (deg/s), `grow` ([from, to] scale over the scene).

Shapes (no model needed): `{ "shape": "earth" | "planet" | "moon" | "sun" | "blackhole" | "ship" | "wave" | "fish" | "kelp" | "crack" | "explosion" | "lightning" | "marker" | "rock" | "cloud" | "sphere" | "box" | "cylinder" | "cone" | "ring", "size": 4, "color": "#hex", "pos": [...] }`. `ship` size = length (a freighter with containers); `wave` size = height of a curling water wall; `fish` with `"flop": true` flops on dry ground; `crack` is a fissure that opens from `at` s; `explosion` bursts at `at` s; `lightning` flickers; `marker` is a map pin (use on a globe).
People reacting: put a `"face": [x, y, z]` on a person/crowd object to turn them toward something (the wave, the sky, the explosion) and pick an anim (Idle, Wave, Run, Clapping, Jump); use `closeup` for one person's reaction. `planet` takes `rings: true`; `sun` glows and lights the scene; `earth` has clouds (`clouds: false` to remove); `emissive` makes a shape glow.

## Effects

```json
{ "type": "lowGravity", "strength": 0.5 }        // jumps go higher and slower
{ "type": "shake", "amount": 0.25 }              // camera shake
{ "type": "flash", "at": 0, "color": "#ffffff" } // white flash at a time in the scene
{ "type": "darken", "to": "night", "start": 0.2, "end": 1 }   // sky and light fade to night over the scene
{ "type": "particles", "kind": "rain|snow|dust|stars|sparks|bubbles|leaves", "amount": 800, "area": [60, 40, 60] }
{ "type": "fog", "density": 0.03, "color": "#hex" }
{ "type": "tint", "color": "#ff6a00", "amount": 0.15 }
{ "type": "slowmo", "factor": 0.5 }
{ "type": "seaLevel", "from": 0.4, "to": -6, "start": 0, "end": 1 }   // coast set: the sea drains (negative) or rises
{ "type": "flood", "from": 0, "to": 2.5 }        // any set: water rises in the street/room (meters)
{ "type": "wallApproach", "from": -170, "to": -20 } // seabed with waterWall: the wave rolls in
{ "type": "storm", "rain": 2200 }                // sky darkens, heavy rain, lightning, wind and thunder
{ "type": "quake", "amount": 0.35 }              // shaking ground, cracks opening, rumble
{ "type": "impact", "at": 1.2, "pos": [0, 4, -40], "size": 8 }   // explosion + flash + shake + boom
```
Kits add their own sound (storm: wind and thunder; quake and water: rumble; impact: boom).

**sfx** (at the scene start, or `at` seconds in): whoosh, boom, chime, rumble, wind, siren, crowd, heartbeat, pop, thunder, jump. A whoosh plays on every cut automatically.

## custom (rarely)

For one unusual effect, put `"custom": "name"` on a scene and write `videos/<folder>/custom.js`:

```js
window.ShortsCustom = {
  name({ THREE, scene, camera, rng, instance, shape, dur }) {
    const ship = instance('spaceship', { height: 10 }); scene.add(ship);   // a library model
    return lt => { ship.position.y = lt * 2; };                            // runs every frame; lt = seconds into the scene
  },
};
```
Keep custom code short and deterministic (use `rng`, never Math.random or clocks).
