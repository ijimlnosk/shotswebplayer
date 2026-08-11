# shotswebplayer

React + Vite web player that searches YouTube Shorts and plays them through the
YouTube IFrame Player API. Built to be served from an HTTPS domain and driven
from a macOS widget's `WKWebView` via `evaluateJavaScript`.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static output in dist/
node --test src/youtube.test.mjs
```

Set the API key either at build time in `.env`:

```
VITE_YT_API_KEY=...
```

or paste it into the key field in the UI (stored in `localStorage`). Create the
key in Google Cloud Console with **YouTube Data API v3** enabled.

**The key ships in the client bundle.** Restrict it in the Cloud Console to the
YouTube Data API and to your site's HTTP referrer, otherwise anyone loading the
page can spend your quota.

## Deploy (HTTPS required)

The IFrame API and the widget bridge both need a real `https://` origin — a
`file://` page or plain HTTP will not work.

Vercel:

```bash
npx vercel --prod     # framework: Vite, build: npm run build, output: dist
```

GitHub Pages: push `dist/` to `gh-pages`, or use any static host (Netlify,
Cloudflare Pages). `vite.config.js` sets `base: './'`, so a project subpath such
as `https://user.github.io/shotswebplayer/` works without extra config.

## Swift bridge

These functions are installed on `window` in a `useEffect` in `src/App.jsx`, so
they are callable by name from `evaluateJavaScript`:

| Function | Behavior |
| --- | --- |
| `onYouTubeIframeAPIReady()` | Called by the YouTube API script; creates the player. |
| `loadQueue(ids, muted)` | Replaces the queue with an array of video IDs, starts at index 0, mutes if `muted` is true. Safe to call before the player is ready — the queue is buffered and applied on `onReady`. |
| `playNext()` | Next video in the queue (clamped at the end). Also fires automatically when a video ends. |
| `playPrevious()` | Previous video (clamped at 0). |
| `togglePlayPause()` | Pause if playing, otherwise play. |
| `resumePlaying()` | Play the current video. |
| `muteVideo()` / `unmuteVideo()` | Mute state. |

Example from Swift:

```swift
webView.evaluateJavaScript("loadQueue(['abc123','def456'], true)")
webView.evaluateJavaScript("playNext()")
```

Autoplay in a `WKWebView` needs
`configuration.mediaTypesRequiringUserActionForPlayback = []`, and muted start
(`loadQueue(ids, true)`) is the reliable path — call `unmuteVideo()` after a
user gesture.
