// Reads a scene plan, forgiving // comments and trailing commas (the reference in engine/PLAN.md uses comments).
const fs = require('fs');

function stripComments(src) {
  let out = '', inStr = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inStr) { out += ch; if (ch === '\\') { out += src[++i] || ''; } else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; out += ch; continue; }
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue; }
    out += ch;
  }
  return out.replace(/,(\s*[\]}])/g, '$1');
}
const readPlan = file => JSON.parse(stripComments(fs.readFileSync(file, 'utf8')));

module.exports = { readPlan, stripComments };
