---
name: post-video
description: Make and post one low-poly "What if" short end to end — invent a hooky idea, animate it in Three.js, render the MP4, write title/description/hashtags, and schedule it on YouTube Shorts, Facebook Reels, Instagram Reels and TikTok at the best time. Use when the user says "post a video", "make a video", "/post-video", or similar.
---

# Post a video

Runs fully automatically: the user approved posting without a review step. Go straight through every step; stop only if a step fails in a way you cannot fix.

Optional argument: an idea or theme from the user. If given, use it instead of inventing one.

## 1. Pick the idea

1. Run `node scripts/status.js` to see every past video, its headline and its views. Never repeat a premise.
2. Run `node scripts/best-times.js --ideas` to see which past videos did best per view. Lean toward the kinds of premise that won (topic area, scale of the twist), but keep each one fresh.
3. Invent 5 candidate premises, then pick the strongest. A good premise:
   - is a single "What if ...?" line a 12-year-old instantly understands (under ~60 characters);
   - has an obvious first consequence and a non-obvious escalation, so viewers stay to see "what happens next";
   - is grounded in real science, history or numbers, so the scenes can show concrete, accurate consequences;
   - lands on a twist or emotional ending in the last 10 seconds;
   - gives a counter that changes the whole time (years, people, degrees, meters).
   Good families: removing something everyday (smartphones, the Moon, friction), scaling something (Earth twice as big, a human 1 cm tall), changing history (the asteroid missed), impossible physics made concrete (crystal-clear oceans, zero gravity for 5 seconds), personal POV ("POV: you...").
4. Avoid: real living people, tragedies and disasters with real victims, medical or financial advice, fear bait that a fact-check would call misleading, and copyrighted characters or brands.

## 2. Animate it

Use the scene engine: write `videos/<YYYY-MM-DD>-<short-slug>/plan.json` following `engine/PLAN.md`, then run `node scripts/check-plan.js videos/<folder>`. The engine handles the sets, library models, camera, effects, text layout and sound, so don't write Three.js unless one scene needs a custom effect (PLAN.md "custom"). The older hand-written pages in `templates/` are for reference only.

Style rules (from what the user asked for):
- 1080x1920, **45–90 seconds** (Facebook Reels rejects anything over 90 s), 30 fps.
- Structure from the reference style (@meanwhileanimations): headline only on the opening shot and the end card, centered at ~40% height; a stat block mid-left (~46–53%) with a mono label, a big serif number and a time sub-label that advances; one italic serif sentence per scene at ~60–65%; 8–14 scenes of 5–7 s; end card with headline, a two-line takeaway and a "send this to someone who..." share line.
- Safe zones: no text above ~12% or below ~75% of the height, and keep the right ~18% clear (the like/comment/share buttons).
- Use the 3D model library in every scene with people, animals, vehicles, buildings, trees or props: name them in the plan's objects ("person", "dog", "taxi"). Use shapes only for things the library lacks (planets, the sun, a black hole).
- Varied sets, camera presets and moves; slow push-ins; one concrete consequence per scene.
- Sound: the engine's score plus the plan's scene sound effects; no narration unless the user asks.
- Facts must be accurate. Label speculative scenes ("A thought experiment · not a prediction").

Check before the full render, cheaply: `node scripts/render.js videos/<folder> --sample` writes `sheet.jpg` (12 frames in one image). Read it once, fix clear problems in plan.json (empty frames, objects blocking the subject or too small), and re-sample only if you changed something visible.

## 3. Render

`node scripts/render.js videos/<folder>` writes `video.mp4` (H.264 + AAC, ready for all four platforms). Run it in the background; it takes a few minutes.

## 4. Title, description, hashtags

Write `videos/<folder>/meta.json`:

```json
{
  "headline": "What if the asteroid missed?",
  "title": "What If the Dinosaurs Never Died? 🦖",
  "description": "Two hook sentences that tease the twist without giving it away. One line on the real science.",
  "hashtags": ["#whatif", "#dinosaurs", "#animation", "#science", "#shorts"],
  "tags": ["what if", "dinosaurs", "asteroid", "low poly animation"],
  "captions": {
    "tiktok": "optional: shorter, more casual, ends with a question to drive comments",
    "instagram": "optional"
  }
}
```

- Title: under 70 characters, curiosity gap, at most one emoji, no clickbait the video doesn't deliver.
- Description: 2–4 short lines; first line is the hook (it's all most people see); end with a comment prompt ("Which scene got you?").
- 4–7 hashtags, mixing broad (#whatif #animation) and topic-specific. YouTube gets #Shorts added automatically.
- `headline` is the question shown on screen ("What if gravity was half as strong for one day?"). Facebook, Instagram and TikTok posts use only the headline plus up to 4 hashtags (never the description, `captions` overrides are ignored for them), so nobody has to tap "more". YouTube uses the full title, description and hashtags.
- Don't set `scheduledAt`; publish picks the best slot. Set it only if the user asked for a specific time.

## 5. Publish

`node scripts/publish.js videos/<folder>`

This picks the next best time slot, uploads to YouTube and Facebook with native scheduling, and queues Instagram and TikTok for the scheduler, which posts them at that time. Read its output; if a platform failed, fix the cause if it's in our code or metadata and re-run (finished platforms are skipped). If it failed because an account isn't connected or a token expired, tell the user the exact `npm run auth -- <platform>` command to run.

## 6. Report

Tell the user, briefly: the idea, the scheduled time in their timezone and the audience timezone, each platform's status, and links where available. Mention anything that needs them (expired sign-in, a platform still limited to private posts).

YouTube is set to `manualPublish`: it uploads as private, and the user makes it public themselves. Always give them the YouTube Studio link and the exact time (their timezone) to switch it to Public.
