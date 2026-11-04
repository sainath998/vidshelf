# Vidshelf

Pick a local folder → every video inside becomes a YouTube-style library. 100% client-side: nothing is uploaded, so hosting is a static site (≈ $0/month).

## Run
    npm install
    npm run dev

## Deploy (static only, no backend)
`npm run build` → upload `dist/` (~300 KB) to Cloudflare Pages / Vercel / Netlify (free tier).
`public/_headers` (Cloudflare/Netlify) and `vercel.json` set COOP/COEP so conversion can use multiple CPU cores.
The ~31 MB FFmpeg engine is loaded from jsDelivr only when a user clicks "Make playable".

## Features (all free)
- YouTube-style library, playlists per folder, continue watching, search
- Resume, autoplay next, subtitles, timestamped notes + Markdown export
- Speed shortcuts: D/A ±0.1x, S toggles 1x ↔ last speed
- Make playable: convert AVI, DivX, WMV, ASF, FLV, TS/MTS/M2TS, MPG/MPEG, VOB, 3GP/3G2, RM/RMVB, DV, MXF and AC3/DTS audio in the browser (repackage / fix audio / full convert)
- Metadata: reads yt-dlp `.info.json` + thumbnail sidecars and tags/chapters/cover art inside MP4/MKV (title, channel, views, date, description, chapters)
- Download tab: direct files, HLS (.m3u8), pages with embedded video; writes `.info.json` + thumbnail next to downloads
- Appearance (🎨): 6 themes, 8 accent colours, thumbnail size, corners, text size

## Browser support
- Chrome / Edge / Brave / Opera (desktop): folder is remembered between visits (File System Access API).
- Firefox / Safari: works through the folder-upload fallback, but the folder must be picked each visit.
- Plays MP4 (H.264/AV1), WebM, most MKV. AVI/WMV/some HEVC are shown as "not playable".
