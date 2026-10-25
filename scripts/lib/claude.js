// Runs the Claude Code command line (headless, `claude -p`) for the app: idea batches, animation jobs and more.
// Every run picks a model, effort and step limit (cheap by default), and its cost is recorded in data/usage.json.
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const { P, readJson, writeJson, config } = require('./common');

const BIN = [process.env.CLAUDE_BIN, path.join(os.homedir(), '.local', 'bin', 'claude.exe'), path.join(os.homedir(), '.local', 'bin', 'claude')]
  .find(p => p && fs.existsSync(p)) || 'claude';
const USAGE = path.join(P.root, 'data', 'usage.json');

// Animation jobs may read and edit project files and run node/ffmpeg, nothing else.
const JOB_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash(node:*)', 'Bash(ffmpeg:*)', 'Bash(ffprobe:*)', 'Bash(mkdir:*)', 'Bash(ls:*)'].join(',');

// Per kind of work: which model, how hard it thinks, and how many steps it may take. Overridable in config.json "studio".
// tools: only what that work needs ('' = none); budget: a hard stop in dollars (as Claude counts them).
const FILE_TOOLS = 'Read,Write,Edit,Bash,Glob,Grep';
const DEFAULTS = {
  storyboard: { model: 'opus', effort: 'medium', maxTurns: 1, tools: '', budget: 0.3 }, // the story is worth the best model; it's one short reply
  make: { model: 'sonnet', effort: 'medium', maxTurns: 30, tools: FILE_TOOLS, budget: 0.8 }, // a scene plan needs far fewer steps than hand-written 3D code
  revise: { model: 'sonnet', effort: 'medium', maxTurns: 20, tools: FILE_TOOLS, budget: 0.35 },
  analyze: { model: 'sonnet', effort: 'low', maxTurns: 8, tools: 'Read,Write,Bash', budget: 0.15 },
  ideas: { model: 'sonnet', effort: 'low', maxTurns: 1, tools: '', budget: 0.12 },
  suggest: { model: 'sonnet', effort: 'low', maxTurns: 40, tools: 'WebSearch,WebFetch', budget: 0.6 },
  tag: { model: 'haiku', effort: 'low', maxTurns: 1, tools: '', budget: 0.05 },
  comments: { model: 'haiku', effort: 'low', maxTurns: 1, tools: '', budget: 0.05 }, // short replies to viewers' comments
  check: { model: 'haiku', effort: 'low', maxTurns: 1, tools: '', budget: 0.02 },
};
// Each step re-reads Claude Code's whole setup; without connectors, skills and browser tools that drops from ~31K to ~9K tokens.
const SLIM = ['--strict-mcp-config', '--disable-slash-commands', '--no-chrome', '--exclude-dynamic-system-prompt-sections', '--no-session-persistence'];
function settings(kind) {
  let cfg = {}; try { cfg = config().studio || {}; } catch {}
  const s = { ...DEFAULTS[kind] };
  if ((kind === 'make' || kind === 'revise') && cfg.animationModel) s.model = cfg.animationModel;
  return s;
}

// Started from inside a Claude session, the child would inherit that session's private settings; give it a clean env.
function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^CLAUDE_CODE_|^CLAUDECODE$|^CLAUDE_AGENT_SDK|^ANTHROPIC_BASE_URL$|^CLAUDE_EFFORT$/.test(k)) delete env[k];
  return env;
}

// Starts `claude -p` with the prompt on stdin, always with JSON output so cost and steps can be read afterwards.
// Resolves {code, out, err, result}; `child` is returned for cancelling.
function run(prompt, kind, extraArgs = [], { logFile, label } = {}) {
  const s = settings(kind);
  const args = ['-p', '--output-format', 'json', '--model', s.model, '--effort', s.effort, '--max-turns', String(s.maxTurns),
    '--tools', s.tools, '--max-budget-usd', String(s.budget), ...SLIM, ...extraArgs];
  const child = spawn(BIN, args, { cwd: P.root, env: cleanEnv(), windowsHide: true });
  let out = '', err = '';
  const log = logFile ? fs.createWriteStream(logFile, { flags: 'a' }) : null;
  child.stdout.on('data', d => { out += d; if (log) log.write(d); });
  child.stderr.on('data', d => { err += d; if (log) log.write(d); });
  const done = new Promise(resolve => {
    child.on('error', e => resolve({ code: -1, out, err: err + e.message, result: null }));
    child.on('close', code => {
      if (log) log.end();
      let result = null; try { result = JSON.parse(out); } catch {}
      if (result) record(kind, label, s, result);
      resolve({ code, out, err, result });
    });
  });
  child.stdin.end(prompt);
  return { child, done };
}

// One line per Claude run: what it was, which model, steps, tokens and the cost Claude reports.
function record(kind, label, s, r) {
  const u = r.usage || {}, list = readJson(USAGE, []);
  list.push({ at: new Date().toISOString(), kind, label: label || '', model: s.model, effort: s.effort,
    turns: r.num_turns || 0, cost: +(r.total_cost_usd || 0).toFixed(4),
    tokensIn: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), tokensOut: u.output_tokens || 0,
    hitLimit: /max.?turns|budget/i.test(String(r.subtype || '') + ' ' + String(r.terminal_reason || '')) });
  writeJson(USAGE, list.slice(-500));
}
const lastRun = () => readJson(USAGE, []).slice(-1)[0] || null;

// Kills the whole process tree (claude plus the node/ffmpeg it started).
function kill(child) {
  if (!child || child.exitCode != null) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill('SIGTERM');
}

// One short answer, e.g. a JSON batch of ideas. Throws with Claude's own message when it isn't signed in.
async function ask(prompt, kind = 'ideas', label) {
  const { code, out, err, result: res } = await run(prompt, kind, [], { label }).done;
  if (!res) throw new Error((out || err || 'no output').trim().slice(0, 300));
  if (res.is_error || code !== 0) throw new Error(String(res.result || res.terminal_reason || 'Claude returned an error').slice(0, 300));
  return String(res.result || '');
}

// Signed-in check for the app's status card (cheapest model, one step).
async function status() {
  const { out, err, result } = await run('Reply with only: ok', 'check').done;
  const text = result ? String(result.result || '') : (out + err).trim();
  return { ok: /^ok\b/i.test(text.trim()), message: text.slice(0, 200) };
}

module.exports = { run, kill, ask, status, lastRun, settings, JOB_TOOLS, BIN, USAGE };
