// Lets an animation job report progress to the app. usage: node scripts/job-note.js <jobId> "<note>"
const path = require('path');
const { P, readJson, writeJson } = require('./lib/common');

const [id, ...words] = process.argv.slice(2), FILE = path.join(P.root, 'data', 'jobs.json');
const jobs = readJson(FILE, []), job = jobs.find(j => j.id === id);
if (!job) { console.error('no job ' + id); process.exit(1); }
if (job.status === 'cancelled') { console.log('CANCELLED: stop working on this job now.'); process.exit(2); }
job.note = words.join(' ').slice(0, 160); job.updatedAt = new Date().toISOString();
writeJson(FILE, jobs);
console.log('noted');
