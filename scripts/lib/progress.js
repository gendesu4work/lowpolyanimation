// Rough completion (0-100) of a job from its latest note. Never goes backwards; "done" is set by the app.
const STEPS = {
  make: [[/start/i, 3], [/storyboard/i, 10], [/plan/i, 25], [/edit|writing (the )?scene/i, 40], [/check|frames|sample/i, 55], [/render/i, 70], [/title|caption/i, 92]],
  revise: [[/start/i, 3], [/plan|edit/i, 25], [/check|frames|sample/i, 50], [/render/i, 70], [/title|caption/i, 92]],
  analyze: [[/start/i, 3], [/download/i, 15], [/picking|frames/i, 40], [/study/i, 65]],
  post: [[/start/i, 3], [/upload/i, 50]],
};
function pctFor(kind, note) {
  let p = null;
  for (const [re, v] of STEPS[kind] || []) if (re.test(String(note || ''))) p = v;
  return p;
}
// Applies a note (and optional explicit progress) to a job object, keeping progress monotonic.
function apply(job, note, explicit) {
  const p = explicit != null ? explicit : pctFor(job.kind, note);
  if (p != null && p > (job.progress || 0)) job.progress = Math.min(99, Math.round(p));
}
module.exports = { pctFor, apply };
