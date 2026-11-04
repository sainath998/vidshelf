# Vidshelf — handoff notes

## What it is
A **static, backend-free web app** (React 19 + Vite 8, plain JS, no TypeScript) that turns a local folder of videos into a
YouTube-style library and player. Everything runs in the user's browser: nothing is uploaded, and there is no server, database or account.
Hosting is just the `dist/` folder (~300 KB). All features are free (a paid "lifetime" tier was removed on purpose).

Location: `/Users/sainathreddy/.t3/scratch/2026-11-04-scrape-the-entire-reddit-and-35b5b9ca/vidshelf`
**Not a git repo yet**, so make a backup or run `git init` before big changes.

Run: `npm install && npm run dev` (http://localhost:5173) · Build: `npm run build` · Lint: `npx oxlint src`

## Owner's preferences (important)
- Wants **no backend, ever**. All processing must happen on the user's machine.
- Did **not** like a home-screen redesign (hero banner, filter chips, folder "shelves", SVG sidebar icons, folder header). It was reverted.
  **Don't redo the home/Library layout without asking first.** Smaller, targeted polish is fine.
- Likes features to be tested before being called done. Testing so far uses headless Chrome via `playwright-core`
  with `channel: 'chrome'`; test scripts live outside the repo in `/tmp/vidshelf-test/runner/`.
- Uses the "Global Speed" Chrome extension. Its default A/S/D hotkeys clash with Vidshelf's own A/S/D speed keys. A web page can't
  override this; the user needs to disable the extension on the site or remove those hotkeys.

## Architecture
Routing is a hash router in `App.jsx` (`#/`, `#/?folder=…`, `#/?q=…`, `#/watch?v=<id>`, `#/download`). `nav()` lives in `src/nav.js`.
A video's `id` is its path including the root folder name, e.g. `Course/Week 1/Lesson 2.mp4`.

| File | Purpose |
|---|---|
| `src/App.jsx` | App state: scan status, videos, lazy thumbnails/metadata (`needThumb`), watch progress, remembered folders (`roots` in IndexedDB), routes, top bar, `/` search shortcut |
| `src/lib/scan.js` | Folder scan via the File System Access API (`showDirectoryPicker`) with an `<input webkitdirectory>` fallback. Skips `node_modules`, `Library`, `.app` bundles and similar. Supports stop/cancel. Attaches sidecar files: `.srt/.vtt`, `.info.json`, thumbnail images, and `<name>.vidshelf.mp4` converted copies |
| `src/lib/thumbs.js` | Makes thumbnails in the browser (hidden `<video>` drawn to a canvas, 2 at a time) and caches them in IndexedDB |
| `src/lib/meta.js` | Metadata reader with no FFmpeg: yt-dlp `.info.json`, MP4 tags (`udta/meta/ilst`, Nero `chpl` chapters, `covr` cover art, `mvhd` duration) and an MKV/WebM EBML parser (Info, Tags, Chapters, Attachments). Cached in IndexedDB under `meta:v3:` keys |
| `src/lib/db.js` | Tiny IndexedDB key-value wrapper |
| `src/lib/convert.js` | ffmpeg.wasm "Make playable": probe, then repackage / fix audio / full convert. The 31 MB engine loads from **jsDelivr only when needed** (`@ffmpeg/core(-mt)@0.12.10`). Multi-threaded when the page is cross-origin isolated. **x264 must be capped with `-threads 4`, or it hangs.** Results are saved next to the original (`.vidshelf.mp4`), in browser storage (OPFS), or as a download |
| `src/lib/fetcher.js` + `src/lib/downloads.js` | "Download from link" tab: direct files (streamed straight to disk), unencrypted HLS (picks a quality, merges separate audio, joins via ffmpeg), and scanning web pages for embedded video. Platforms like YouTube, and servers that block other sites (CORS), get a copyable **yt-dlp command** instead. Writes `.info.json` + a thumbnail next to each download. Jobs live outside React so downloads continue while you browse |
| `src/lib/settings.js` | Appearance: 16 themes, 12 accent colours, card size, corners, font size, ambient glow. Applied as CSS variables |
| `src/components/Player.jsx` | Watch page: resume, autoplay next, subtitles, keyboard shortcuts, ambient glow, theater mode, detecting "no sound" / "no picture" issues, ⋯ menu. **"Fix playback" shows only when there's an error or an issue** (user asked for that) |
| `src/components/PlayerControls.jsx` | Custom controls: hover frame preview, buffered bar, note markers, chapter gaps, speed menu, volume, PiP, fullscreen, auto-hide |
| `src/components/Description.jsx` | YouTube-style description box (links, clickable timestamps, tags, chapter list) |
| `src/components/Library.jsx` | Home and folder grid, sidebar (Home / Libraries / Playlists), "Continue watching" row, pages of 120 cards as you scroll |
| `src/components/VideoCard.jsx` | Card + `Thumb` (asks for its thumbnail when it scrolls into view), "views · date" line |
| `ConvertDialog`, `Downloader`, `Landing`, `Notes`, `SettingsModal`, `Icon`, `FallbackPicker` | As named |
| `vite.config.js`, `public/_headers`, `vercel.json` | COOP/COEP headers so ffmpeg can use multiple threads. `optimizeDeps.exclude` for `@ffmpeg/*` |

## Keyboard shortcuts (player)
Space/K play · J/L ±10s · ←/→ ±5s · ↑/↓ volume · 0–9 jump · F fullscreen · T theater · M mute · C subtitles ·
Shift+N/P next/prev · D/A speed ±0.1x · S toggles 1x ↔ last speed · `<`/`>` speed steps · `/` focuses search (works anywhere).

## Tested and working (headless Chrome)
- Library, thumbnails, resume, subtitles, shortcuts, themes, custom player, theater mode.
- Make playable: wmv, mpeg2 .m2ts, mkv+AC3 (fix audio), xvid avi, flv, ts (repackage), mpg, vob, mts, divx, rm, asf, 3g2 (no-picture detection).
- Download tab: direct mp4, HLS master with 720p/360p and separate audio, page scanning, blocked servers, YouTube showing the yt-dlp command.
- Big folders: 2,500 videos, stop/cancel, paging, lazy thumbnails, switching between libraries.
- Metadata: real yt-dlp `.info.json` ("Me at the zoo"), plus MP4/MKV with embedded tags, chapters and cover art.

## Not tested / known limits
- Real "save next to original" through the folder-permission prompt (tests used OPFS as a stand-in for the picked folder).
- Picture-in-picture and fullscreen in a real window.
- Real large files: over ~2 GB can run out of browser memory during conversion or HLS joining.
- Real public websites in the Download tab (only local test servers).
- Encrypted/DRM streams, DASH (`.mpd`) and byte-range HLS aren't supported.
- Mobile isn't supported (desktop Chromium is best; Firefox and Safari use the fallback picker, and the folder isn't remembered).
- Some harmless oxlint warnings (`set-state-in-effect`, `immutability` on the video element, a control-character regex).

## Deploy
`npm run build` and upload `dist/` to Vercel, Netlify or Cloudflare Pages (headers are already configured). No environment variables are needed.

## Possible next steps (ask the owner first)
- Run `git init` and make a first commit; push to GitHub (the owner asked to "push" once, but no remote exists yet).
- Option to merge several libraries into one view (currently you switch between them).
- Turn it into a PWA so it works offline after the first visit.
- Small home-screen polish only with approval (see preferences above).
