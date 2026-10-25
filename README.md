# Shorts Studio

A local app that makes low-poly "What if...?" shorts and posts them to **YouTube Shorts, Facebook Reels, Instagram Reels and TikTok**.

In the app you:

1. generate scored video ideas and pick one,
2. let Claude animate it in 3D on your PC and render a 1080x1920 MP4 with music and sound,
3. review it, ask for changes, or approve it,
4. post it now or at a time you choose (the title and a few hashtags go to Facebook, Instagram and TikTok; YouTube gets the full description),
5. and let it reply to new comments with a short, positive reply that is different every time.

It runs on **Windows** on your own PC. Nothing is sent anywhere except the platforms you connect and Claude.

---

## Quick start

You need: Windows, [Node.js](https://nodejs.org) 20 or newer, Google Chrome, [ffmpeg](https://ffmpeg.org) on your PATH, and the [Claude Code](https://claude.com/claude-code) command line signed in to a Claude account.

```bash
npm install
copy config.example.json config.json
```

1. Sign in to Claude once: open a terminal, run `claude`, type `/login`, and follow the steps.
2. Set `audienceTimezone` in `config.json` to where most of your viewers are (for example `America/New_York`).
3. Double-click **Shorts Studio.cmd** (or run `npm run app`). It opens http://localhost:8800. Keep its window open while you use the app.
4. Open the **Models** tab and add some 3D models (`.glb`, `.gltf` or a `.zip` pack, for example free packs from Kenney or Quaternius). They are not included in this project, so check each pack's license.
5. Connect your platforms (next section).

## The app

| Tab | What it does |
| --- | --- |
| **Create** | Generate ideas, animate one, review it, request changes, and approve & post. A box asks **Post now** or **Pick a time**. |
| **Dashboard** | Followers, growth and views per upload. |
| **Trainer** | Notes and reference videos that steer the style of future animations. |
| **Comments** | Automatic replies to comments on YouTube and Facebook (see below). |
| **Models** | Your 3D model library, and suggestions for free packs. |

The left panel also lets you choose, for each platform, how it is posted: **Buffer**, **Own login**, **I post it myself** or **Off**.

`npm run app -- --lan` also makes the app reachable from other devices on your Wi-Fi.

---

## Connecting platforms

Pick the easy route (Buffer) or the platforms' own developer apps. You can mix them per platform.

### Easiest: Buffer (YouTube, Instagram, TikTok)

Connect those channels in [Buffer](https://buffer.com) (the free plan allows 3 channels) and let it post them. Facebook uses its own setup below.

1. In Buffer, connect your channels, then create an API key at publish.buffer.com/settings/api.
2. Buffer's API takes a public link to the video, not a file. Create a free Netlify site for the videos, plus a personal access token (Netlify → User settings → Applications). Each video is added to that site and earlier links keep working.
3. In `config.json` set `platforms.buffer.apiKey` and `platforms.buffer.hosting` (Netlify token, site id, site URL), and set `"mode": "buffer"` on the platforms you want sent through Buffer.
4. Run `npm run auth -- buffer` once: it checks the key and finds your Buffer channels.

Every platform has a `mode` in `config.json` (the app's left panel sets it for you):
- `"own"` (default): the app posts with that platform's own API.
- `"buffer"`: the app hands the video to Buffer, which posts it.
- `"manual"`: the app skips it and saves the caption as `post-yourself-<platform>.txt` next to `video.mp4`, so you post it yourself (for example Instagram, when you only want the other two in Buffer). Set `"enabled": false` to leave a platform out entirely.

Buffer's free plan doesn't return view counts, so those platforms show no stats.

### YouTube (own login)

1. Go to [console.cloud.google.com](https://console.cloud.google.com), create a project, and enable **YouTube Data API v3** (APIs & Services → Library).
2. **OAuth consent screen**: choose External, fill in the app name and your email, and add yourself as a test user. Then click **Publish app** (set it to "In production"). In "Testing" mode Google expires the sign-in every 7 days. You'll see an "unverified app" warning when signing in; that's fine for your own channel.
3. **Credentials → Create credentials → OAuth client ID → Desktop app.** Click **Download JSON** and move the `client_secret_*.json` file into the `secrets` folder. (Or copy the client ID and secret into `config.json` under `platforms.youtube`.)
4. Run `npm run auth -- youtube` and approve in the browser. Comment replies need the permission to manage comments, which this sign-in asks for.

> **Important:** Google keeps videos uploaded through a new, unaudited API project **private**. Apply for the free audit with the [YouTube API Services audit form](https://support.google.com/youtube/contact/yt_api_form). Until it's approved, uploads and schedules work, but the videos stay private.

### Facebook and Instagram (own login: one Meta app, two separate sign-ins)

Requirements: a **Facebook Page**, and an **Instagram Professional account** (Creator or Business). They do **not** need to be linked to each other.

1. Go to [developers.facebook.com](https://developers.facebook.com/apps) → **Create app**. Pick the use cases for managing a **Page** and for **Instagram** ("Manage messaging & content on Instagram").
2. **Facebook:** under Facebook Login (or Facebook Login for Business) → Settings, add `http://localhost:8792/callback` as a valid OAuth redirect URI. Copy the App ID and App Secret (App settings → Basic) into `config.json` under `platforms.meta`. Run `npm run auth -- meta` and allow only your Page.
3. **Instagram:** under Instagram → **API setup with Instagram login** → Set up Instagram business login, add `https://localhost:8794/callback` as an OAuth redirect URI. Copy the **Instagram app ID** and **Instagram app secret** shown there (they differ from the Meta App ID) into `config.json` under `platforms.instagram`. Run `npm run auth -- instagram` and sign in to the Instagram account. The browser then warns that the localhost connection isn't private: click **Advanced → Proceed to localhost**. That page is the script running on your own PC.

Your own accounts work without App Review because you're the app's admin. If posts don't show up publicly while the app is in Development mode, switch it to **Live** (it asks for a privacy policy URL). Instagram video processing can also be refused for new accounts or apps with only Standard access; Buffer avoids this. The Instagram sign-in lasts 60 days and renews itself automatically while the app is running.

### TikTok (own login)

1. Go to [developers.tiktok.com](https://developers.tiktok.com) → **Manage apps → Connect an app**.
2. Add **Login Kit** and **Content Posting API** (turn on **Direct Post**). Request the scopes `user.info.basic`, `video.publish` and `video.list`.
3. Set the platform to **Desktop** and the redirect URI to `http://localhost:8793/callback`.
4. Copy the Client key and Client secret into `config.json` under `platforms.tiktok`.
5. Run `npm run auth -- tiktok`.

For the dashboard, also add the scopes `video.list` (per-video views) and `user.info.stats` (followers, likes). If your app can't add them, set `"viewStats": false` / `"accountStats": false` under `platforms.tiktok`.

> **Important:** until TikTok audits the app, its API can only post **private** videos (`SELF_ONLY`). Submit the app for review in the developer portal. Once approved, set `"privacy": "PUBLIC_TO_EVERYONE"` in `config.json`.

---

## Posting and scheduling

- In **Create**, click **Approve & post**, then choose **Post now** or **Pick a time** (your own time zone).
- Buffer posts YouTube, Instagram and TikTok at that time. Facebook is scheduled by Facebook itself.
- Platforms that use their own login and have no scheduling (Instagram, TikTok) are posted by the app when due, so **the PC and the app must be running at that time**. A background task can do this even when the app is closed:

```bash
powershell -ExecutionPolicy Bypass -File install-scheduler.ps1
```

- Facebook, Instagram and TikTok captions are only the headline question plus up to 4 hashtags. YouTube gets the title, full description and hashtags.

## Comment replies

Open the **Comments** tab. When automatic replies are on, the app checks YouTube (and Facebook, if enabled) every 15 minutes while it is running. Claude's cheapest model writes a short, positive reply to each new comment, worded differently every time. Rude, spammy or risky comments are skipped. There is a daily limit (start low, for example 5). Facebook replies need the Page permissions `pages_manage_engagement` and `pages_read_user_content`: add them to your Meta app, then run `npm run auth -- meta` again. Instagram and TikTok offer no way to reply to comments through their APIs.

---

## Command line

The scripts the app uses also work on their own:

| Command | What it does |
| --- | --- |
| `npm run app` | Opens Shorts Studio |
| `npm run status` | Every video, its time, per-platform status and views |
| `npm run accounts` | Fetch account totals (followers, subscribers, views) now |
| `npm run stats` | Refresh view counts now |
| `npm run render -- videos/<folder> [--sample]` | Render a video (or a 12-frame preview sheet) |
| `npm run publish -- videos/<folder> [--now \| --at <ISO time>] [--dry-run]` | Post or schedule a rendered video |
| `node scripts/comments.js [--dry-run]` | Check comments and send replies once |
| `npm run auth -- youtube\|meta\|instagram\|tiktok\|buffer` | Sign in again (if a token expires or is revoked) |

If you use Claude Code in this folder, typing **post a video** runs the whole pipeline in chat without the app (see `.claude/skills/post-video`).

Activity and errors are logged to `data/activity.log`. A failed upload is retried up to 3 times. After that it's marked `failed`, and re-running `publish` tries again.

## Limits to know

- Videos must be **45–90 seconds**; Facebook Reels rejects anything over 90 s.
- AI disclosure is on (`"aiDisclosure": true`), so platforms label posts as AI-generated. That's honest and avoids penalties.
- `config.json`, the `secrets` folder, your videos and your data stay on your PC and are never committed.
- Meta occasionally renames insight metrics. If `npm run stats` warns about Facebook or Instagram, posting still works; only the view counts for that platform are missing.
