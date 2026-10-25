# Shorts automation

Makes low-poly "What if" shorts and posts them to YouTube Shorts, Facebook Reels, Instagram Reels and TikTok.

When the user says "post a video" (or "make a video", "/post-video"), use the `post-video` skill in `.claude/skills/post-video/SKILL.md` and run it end to end without asking for review: the user chose fully automatic posting.

The main way the user works is the local **Shorts Studio app** (`scripts/app.js`, page in `app/index.html`, data in `data/ideas.json` and `data/jobs.json`). It runs `claude -p` itself for idea batches and animation jobs (see `scripts/lib/claude.js`). The older Shorts Studio artifact and its scheduled worker (`studio/`) are paused.

Videos are made with the **scene engine**: a short `videos/<folder>/plan.json` (format: `engine/PLAN.md`, check with `scripts/check-plan.js`) that `engine/engine.js` animates; `scripts/render.js` builds page.html from it. Don't hand-write Three.js pages anymore.

## Layout
- `templates/` — finished animation pages to adapt (`dinos.html` and `clear-ocean.html` are the newest).
- `videos/<date>-<slug>/` — one folder per video: `page.html`, `meta.json`, `video.mp4`, `sheet.jpg`. `meta.json` also records each platform's post id, status and stats.
- `scripts/` — `render.js`, `publish.js`, `scheduler.js`, `stats.js`, `best-times.js`, `status.js`, `auth.js`, and `platforms/` for each API.
- `config.json` (not committed) — timezone, posting slots, API keys. `secrets/tokens.json` — sign-in tokens. Never print either file's secrets.
- `toolkit/` — older render scripts from the first videos, kept for reference.

## Notes
- The user is cost-conscious: check animation with one `--sample` contact sheet instead of many screenshots.
- Instagram and TikTok have no API scheduling, so `scheduler.js` (Windows Task Scheduler, every 15 min) posts them when due; the PC must be on then.
- TikTok posts stay private (`SELF_ONLY`) until the TikTok app passes TikTok's audit; YouTube uploads stay private until the Google API project passes its audit. See README.md.
