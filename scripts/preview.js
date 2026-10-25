// Makes a small preview of a rendered video for the Shorts Studio review player: preview.mp4 (720x1280, a few MB) and poster.jpg.
// usage: node scripts/preview.js <video dir> [--poster-only]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');

const dir = path.resolve(process.argv[2] || '');
const src = path.join(dir, 'video.mp4');
if (!fs.existsSync(src)) { console.error('no video.mp4 in ' + dir); process.exit(1); }
const ff = args => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
if (process.argv.includes('--poster-only')) {
  ff(['-ss', '2', '-i', src, '-frames:v', '1', '-vf', 'scale=540:960', '-q:v', '4', path.join(dir, 'poster.jpg')]);
  console.log('poster ok'); process.exit(0);
}

ff(['-i', src, '-vf', 'scale=720:1280', '-c:v', 'libx264', '-preset', 'medium', '-crf', '30', '-maxrate', '1500k', '-bufsize', '3000k',
  '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', path.join(dir, 'preview.mp4')]);
ff(['-ss', '2', '-i', src, '-frames:v', '1', '-vf', 'scale=540:960', '-q:v', '4', path.join(dir, 'poster.jpg')]);
const mb = fs.statSync(path.join(dir, 'preview.mp4')).size / 1e6;
console.log(`preview ok ${path.join(dir, 'preview.mp4')} (${mb.toFixed(1)} MB)` + (mb > 14 ? '  WARNING: over the 15 MB upload limit' : ''));
