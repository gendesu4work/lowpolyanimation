# Shorts automation

Type **"post a video"** (or `/post-video`) in Claude Code opened in this folder, and Claude:

1. invents a hooky "What if...?" idea that hasn't been done yet (leaning toward what performed best),
2. animates it in low-poly 3D and renders a 1080x1920 MP4 with music and sound,
3. writes the title, description and hashtags,
4. schedules it on **YouTube Shorts, Facebook Reels, Instagram Reels and TikTok** at the best time for your audience.

Posting times start from sensible defaults and learn from your own results: every post's views are compared per hour of day, and about a quarter of posts test other hours so the system keeps learning.

---

## One-time setup (about an hour)

You create a free developer app on each platform, put its keys in `config.json`, and sign in once. Claude can't do these steps for you: they need your accounts and passwords.

### 0. Config

```bash
copy config.example.json config.json
```

Set `audienceTimezone` to where most of your viewers are (`America/New_York` for a US audience, `Asia/Manila` for the Philippines). `candidateHours` are the hours it may post at, `defaultHours` are the starting guesses, and `postsPerDay` caps the rate.

### 1. YouTube

1. Go to [console.cloud.google.com](https://console.cloud.google.com), create a project, and enable **YouTube Data API v3** (APIs & Services → Library).
2. **OAuth consent screen**: choose External, fill in the app name and your email, and add yourself as a test user. Then click **Publish app** (set it to "In production"). In "Testing" mode Google expires the sign-in every 7 days. You'll see an "unverified app" warning when signing in; that's fine for your own channel.
3. **Credentials → Create credentials → OAuth client ID → Desktop app.** Click **Download JSON** and move the `client_secret_*.json` file into the `secrets` folder. (Or copy the client ID and secret into `config.json` under `platforms.youtube`.)
4. Run `npm run auth -- youtube` and approve in the browser.

> **Important:** Google keeps videos uploaded through a new, unaudited API project **private**. Apply for the free audit with the [YouTube API Services audit form](https://support.google.com/youtube/contact/yt_api_form). Until it's approved, uploads and schedules work, but the videos stay private.

### 2. Facebook and Instagram (one Meta app, two separate sign-ins)

Requirements: a **Facebook Page**, and an **Instagram Professional account** (Creator or Business). They do **not** need to be linked to each other.

1. Go to [developers.facebook.com](https://developers.facebook.com/apps) → **Create app**. Pick the use cases for managing a **Page** and for **Instagram** ("Manage messaging & content on Instagram").
2. **Facebook:** under Facebook Login (or Facebook Login for Business) → Settings, add `http://localhost:8792/callback` as a valid OAuth redirect URI. Copy the App ID and App Secret (App settings → Basic) into `config.json` under `platforms.meta`. Run `npm run auth -- meta` and allow only your Page.
3. **Instagram:** under Instagram → **API setup with Instagram login** → Set up Instagram business login, add `https://localhost:8794/callback` as an OAuth redirect URI. Copy the **Instagram app ID** and **Instagram app secret** shown there (they differ from the Meta App ID) into `config.json` under `platforms.instagram`. Run `npm run auth -- instagram` and sign in to the Instagram account. The browser then warns that the localhost connection isn't private: click **Advanced → Proceed to localhost**. That page is the script running on your own PC.

Your own accounts work without App Review because you're the app's admin. If posts don't show up publicly while the app is in Development mode, switch it to **Live** (it asks for a privacy policy URL). The Instagram sign-in lasts 60 days and renews itself automatically while the scheduler runs.

### Easier option: Buffer (YouTube, Instagram, TikTok)

Instead of three developer apps, connect those channels in [Buffer](https://buffer.com) (the free plan allows 3 channels) and let it post them. Facebook still uses its own setup above.

1. In Buffer, connect your channels, then create an API key at publish.buffer.com/settings/api.
2. Buffer's API takes a public link to the video, not a file. Create a free Netlify site for the videos, plus a personal access token (Netlify → User settings → Applications). Each video is added to that site and earlier links keep working.
3. In `config.json` set `platforms.buffer.apiKey` and `platforms.buffer.hosting` (Netlify token, site id, site URL), and set `"mode": "buffer"` on the platforms you want sent through Buffer.
4. Run `npm run auth -- buffer` once: it checks the key and finds your Buffer channels.

Every platform has a `mode` in `config.json`:
- `"own"` (default): the app posts with that platform's own API.
- `"buffer"`: the app hands the video to Buffer, which posts it.
- `"manual"`: the app skips it and saves the caption as `post-yourself-<platform>.txt` next to `video.mp4`, so you post it yourself (for example Instagram, when you only want the other two in Buffer). Set `"enabled": false` to leave a platform out entirely.

Buffer's free plan doesn't return view counts, so those platforms show no stats.

### 3. TikTok

1. Go to [developers.tiktok.com](https://developers.tiktok.com) → **Manage apps → Connect an app**.
2. Add **Login Kit** and **Content Posting API** (turn on **Direct Post**). Request the scopes `user.info.basic`, `video.publish` and `video.list`.
3. Set the platform to **Desktop** and the redirect URI to `http://localhost:8793/callback`.
4. Copy the Client key and Client secret into `config.json` under `platforms.tiktok`.
5. Run `npm run auth -- tiktok`.

For the dashboard, also add the scopes `video.list` (per-video views) and `user.info.stats` (followers, likes). If your app can't add them, set `"viewStats": false` / `"accountStats": false` under `platforms.tiktok`.

> **Important:** until TikTok audits the app, its API can only post **private** videos (`SELF_ONLY`). Submit the app for review in the developer portal. Once approved, set `"privacy": "PUBLIC_TO_EVERYONE"` in `config.json`.

### 4. Background scheduler

Instagram and TikTok have no scheduling in their APIs, so a small task checks every 15 minutes and posts whatever is due. It also refreshes view counts every 6 hours, which feed the best-time learning.

```bash
powershell -ExecutionPolicy Bypass -File install-scheduler.ps1
```

**The PC must be on at the posting time** for Instagram and TikTok. YouTube and Facebook are scheduled on their own servers, so they post even if the PC is off.

---

## Shorts Studio app

Double-click **Shorts Studio.cmd** (or run `npm run app`). It opens http://localhost:8800 with:

- **Create:** generate five ideas with scores, pick one, and Claude animates it on this PC right away. Watch progress, cancel at any time, then review the video and approve it (posts to all four accounts), request changes, or discard it.
- **Dashboard:** followers, growth charts and views per upload for all four accounts.

The app runs Claude through the Claude Code command line, which needs a one-time sign-in: open a terminal, run `claude`, type `/login`, and follow the steps. Keep the app's window open while a video is being made. `npm run app -- --lan` also makes it reachable from other devices on your Wi-Fi.

## Daily use (chat)

Open Claude Code in this folder and type **post a video**. You can add an idea ("post a video about the Moon disappearing").

Useful commands:

| Command | What it does |
| --- | --- |
| `npm run dashboard` | Opens the dashboard at http://localhost:8800: subscribers/followers, growth, views per video |
| `npm run accounts` | Fetch account totals (followers, subscribers, views) now |
| `npm run status` | Every video, its time, per-platform status and views |
| `npm run best-times` | Performance by hour and the next slot |
| `npm run best-times -- --ideas` | Past videos ranked by relative views |
| `npm run render -- videos/<folder> [--sample]` | Render a video (or a 12-frame preview sheet) |
| `npm run publish -- videos/<folder> [--now \| --at <ISO time>] [--dry-run]` | Schedule a rendered video |
| `npm run stats` | Refresh view counts now |
| `npm run auth -- youtube\|meta\|instagram\|tiktok` | Sign in again (if a token expires or is revoked) |

Activity and errors are logged to `data/activity.log`. A failed upload is retried up to 3 times by the scheduler. After that it's marked `failed`, and re-running `publish` tries again.

## Limits to know

- Videos must be **45–90 seconds**; Facebook Reels rejects anything over 90 s.
- AI disclosure is on (`"aiDisclosure": true`), so TikTok labels posts as AI-generated. That's honest and avoids penalties.
- The best-time learning needs about 2 weeks of posts before it beats the defaults.
- Meta occasionally renames insight metrics. If `npm run stats` warns about Facebook or Instagram, posting still works; only the view counts for that platform are missing.
