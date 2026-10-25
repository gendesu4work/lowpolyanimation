// Downloads a suggested model pack straight from its creator's page: Kenney's direct .zip, or the glTF files in a
// Quaternius Google Drive folder. Only https, only known creator sites, size-capped.
const fs = require('fs'), path = require('path');

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ShortsStudio' };
const PAGE_HOSTS = /(^|\.)(kenney\.nl|quaternius\.com|poly\.pizza|opengameart\.org)$/i;
const FILE_HOSTS = /(^|\.)(kenney\.nl|quaternius\.com|drive\.google\.com|drive\.usercontent\.google\.com|googleusercontent\.com|poly\.pizza|opengameart\.org)$/i;
const MAX = 2 * 1024 ** 3;
const SKIP_FOLDERS = /^(fbx|obj|blend|blender|usdz|unity|unreal|godot|stl|dae|collada|3ds|max|source|textures? \(psd\))$/i;
const KEEP_EXT = /\.(glb|gltf|bin|png|jpe?g|webp|ktx2|txt|md)$/i;

const host = u => { try { return new URL(u).hostname; } catch { return ''; } };
const https = u => /^https:\/\//i.test(u);

// Works out how a pack page offers its files. Returns {type: 'zip', url} | {type: 'drive', id} | null.
async function findDownload(pageUrl) {
  if (!https(pageUrl) || !PAGE_HOSTS.test(host(pageUrl))) return null;
  const html = await (await fetch(pageUrl, { headers: UA })).text();
  const links = [...html.matchAll(/https?:\/\/[^\s"'<>)]+|href=["']([^"']+)["']/g)].map(m => m[1] || m[0])
    .map(l => { try { return new URL(l.replace(/&amp;/g, '&'), pageUrl).href; } catch { return null; } }).filter(Boolean);
  const zips = links.filter(l => /\.zip(\?|$)/i.test(l) && FILE_HOSTS.test(host(l)));
  if (zips.length) return { type: 'zip', url: zips.find(l => /gltf|glb/i.test(l)) || zips[0] };
  const folder = links.map(l => l.match(/drive\.google\.com\/drive\/folders\/([\w-]+)/)).find(Boolean);
  if (folder) return { type: 'drive', id: folder[1] };
  return null;
}

// Streams one URL to a file, refusing web pages (a login or "virus scan" page instead of the file) and huge files.
async function save(url, file, onBytes, retried) {
  const r = await fetch(url, { headers: UA, redirect: 'follow' });
  if (!r.ok) throw new Error(`download failed (${r.status})`);
  if (!FILE_HOSTS.test(host(r.url))) throw new Error('the download went to an unexpected site');
  if (/text\/html/i.test(r.headers.get('content-type') || '')) {
    const html = await r.text();
    if (/quota exceeded/i.test(html)) throw new Error("Google Drive's daily download limit for this pack is reached. Try again tomorrow, or use Open page to download it yourself.");
    // Drive's "can't scan this large file for viruses" page: submit its confirm form to get the file
    const form = html.match(/<form[^>]+id="download-form"[^>]+action="([^"]+)"/i);
    if (form && !retried) {
      const q = new URLSearchParams(); for (const m of html.matchAll(/<input[^>]+type="hidden"[^>]+name="([^"]+)"[^>]+value="([^"]*)"/gi)) q.set(m[1], m[2]);
      return save(form[1].replace(/&amp;/g, '&') + (form[1].includes('?') ? '&' : '?') + q.toString(), file, onBytes, true);
    }
    throw new Error('the site sent a web page instead of the file');
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const out = fs.createWriteStream(file);
  let size = 0;
  for await (const chunk of r.body) {
    size += chunk.length;
    if (size > MAX) { out.destroy(); fs.rmSync(file, { force: true }); throw new Error('the pack is over 2 GB'); }
    if (!out.write(chunk)) await new Promise(res => out.once('drain', res));
    if (onBytes) onBytes(size);
  }
  await new Promise(res => out.end(res));
  return size;
}

// Lists a public Drive folder through Drive's simple embedded view: [{name, id, folder}].
async function driveList(id) {
  const html = await (await fetch('https://drive.google.com/embeddedfolderview?id=' + encodeURIComponent(id), { headers: UA })).text();
  return [...html.matchAll(/<a href="(https:\/\/drive\.google\.com\/[^"]+)"[^>]*>[\s\S]*?<div class="flip-entry-title">([^<]+)</g)].map(m => {
    const u = m[1].replace(/&amp;/g, '&'), f = u.match(/folders\/([\w-]+)/), d = u.match(/file\/d\/([\w-]+)/);
    return { name: m[2].replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim(), id: (f || d || [])[1], folder: !!f };
  }).filter(e => e.id);
}

// Lists the glTF/GLB side of a Drive folder tree (skips FBX/OBJ/Blend folders and other formats): [{rel, id}].
async function driveTree(id, rel = '', depth = 0, out = []) {
  if (depth > 4) return out;
  for (const e of await driveList(id)) {
    const safe = e.name.replace(/[<>:"/\\|?*]+/g, '_');
    if (e.folder) { if (!SKIP_FOLDERS.test(e.name)) await driveTree(e.id, path.join(rel, safe), depth + 1, out); }
    else if (KEEP_EXT.test(e.name)) out.push({ rel: path.join(rel, safe), id: e.id });
  }
  return out;
}
// Downloads that tree into dir, but only after checking it really contains glTF/GLB models.
async function driveFolder(id, dir, report) {
  report('Checking the pack');
  const list = await driveTree(id);
  if (!list.some(f => /\.(glb|gltf)$/i.test(f.rel))) throw new Error('This pack has no glTF/GLB files (only FBX, OBJ or Blend), so the app can\'t use it.');
  let files = 0, bytes = 0;
  for (const f of list) {
    bytes += await save(`https://drive.usercontent.google.com/download?id=${f.id}&export=download&confirm=t`, path.join(dir, f.rel));
    report(`Downloaded ${++files} of ${list.length} files`);
  }
  return { files, bytes };
}

// Downloads a pack into dir. Resolves {files, bytes}; a zip is extracted in place.
async function fetchPack(pageUrl, dir, report = () => {}) {
  const how = await findDownload(pageUrl);
  if (!how) throw new Error("This site doesn't offer a direct download. Open the page, download the glTF version, and drop the .zip under Your models.");
  fs.mkdirSync(dir, { recursive: true });
  if (how.type === 'zip') {
    const zip = path.join(dir, 'pack.zip');
    const bytes = await save(how.url, zip, n => report(`Downloading ${(n / 1e6).toFixed(0)} MB`));
    report('Unpacking');
    require('child_process').execFileSync('tar', ['-xf', zip, '-C', dir], { windowsHide: true });
    fs.unlinkSync(zip);
    return { files: 1, bytes };
  }
  return driveFolder(how.id, dir, report);
}

// Keeps only model, texture and license files from an unpacked pack (no scripts or programs).
function prune(dir) {
  let removed = 0;
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { walk(p); if (!fs.readdirSync(p).length) fs.rmdirSync(p); } else if (!KEEP_EXT.test(e.name)) { fs.unlinkSync(p); removed++; } } })(dir);
  return removed;
}

module.exports = { findDownload, fetchPack, prune, driveList };
