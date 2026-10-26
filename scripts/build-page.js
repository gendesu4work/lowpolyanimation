// Builds videos/<folder>/page.html from plan.json (+ optional custom.js) for the scene engine.
// render.js calls this automatically when a folder has a plan.json. usage: node scripts/build-page.js <video dir>
const fs = require('fs'), path = require('path');
const { readJson } = require('./lib/common');

const CDN = 'https://cdn.jsdelivr.net/npm/three@0.128.0';
const SCRIPTS = ['build/three.min.js', 'examples/js/loaders/GLTFLoader.js', 'examples/js/utils/SkeletonUtils.js',
  'examples/js/shaders/CopyShader.js', 'examples/js/shaders/LuminosityHighPassShader.js', 'examples/js/postprocessing/EffectComposer.js',
  'examples/js/postprocessing/RenderPass.js', 'examples/js/postprocessing/ShaderPass.js', 'examples/js/postprocessing/UnrealBloomPass.js'];

function buildPage(dir) {
  const plan = require('./lib/plan').readPlan(path.join(dir, 'plan.json'));
  if (plan.soundtrack && plan.soundtrack.file) plan.music = false; // the chosen music file replaces the built-in synth music (render.js mixes it in)
  const lib = readJson(path.join(__dirname, '..', 'engine', 'library.json'), []);
  const custom = fs.existsSync(path.join(dir, 'custom.js')) ? fs.readFileSync(path.join(dir, 'custom.js'), 'utf8') : '';
  const safe = v => JSON.stringify(v).replace(/</g, '\\u003c'); // plan text can't close the script tag
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${String(plan.title || 'Short').replace(/[<&]/g, '')}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=IBM+Plex+Mono:wght@500;600&display=swap">
<style>html,body{margin:0;background:#000}canvas{display:block;max-width:100%;height:auto}</style></head><body>
${SCRIPTS.map(s => `<script src="${CDN}/${s}"></script>`).join('\n')}
<script src="../../engine/resolve.js"></script>
<script src="../../engine/engine.js"></script>
<script>window.PLAN = ${safe(plan)};
window.LIB = ${safe(lib)};</script>
${custom ? `<script>\n${custom}\n</script>` : ''}
<script>ShortsEngine.start(window.PLAN, window.LIB);</script>
</body></html>`;
  fs.writeFileSync(path.join(dir, 'page.html'), html);
  return path.join(dir, 'page.html');
}

if (require.main === module) console.log('page ok', buildPage(path.resolve(process.argv[2] || '')));
module.exports = { buildPage };
