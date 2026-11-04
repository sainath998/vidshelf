// Link downloader that runs entirely in the browser. No server, no proxy.
// Works for: direct media files, unencrypted HLS (.m3u8), and web pages that embed those.
// Servers that don't send CORS headers can't be read by any website — for those we fall back
// to the browser's own download, or a yt-dlp command the user can run locally.
import { getFFmpeg } from './convert'

const PLATFORMS = [
  ['YouTube', /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/],
  ['Vimeo', /(^|\.)vimeo\.com$/],
  ['Instagram', /(^|\.)instagram\.com$/],
  ['TikTok', /(^|\.)tiktok\.com$/],
  ['X / Twitter', /(^|\.)(x\.com|twitter\.com)$/],
  ['Facebook', /(^|\.)(facebook\.com|fb\.watch)$/],
  ['Dailymotion', /(^|\.)(dailymotion\.com|dai\.ly)$/],
  ['Twitch', /(^|\.)twitch\.tv$/],
  ['Reddit', /(^|\.)(reddit\.com|redd\.it)$/],
  ['Bilibili', /(^|\.)bilibili\.com$/],
  ['LinkedIn', /(^|\.)linkedin\.com$/],
  ['Pinterest', /(^|\.)(pinterest\.[a-z.]+|pin\.it)$/],
  ['Snapchat', /(^|\.)snapchat\.com$/],
  ['Rumble', /(^|\.)rumble\.com$/],
]

const MEDIA_EXT = ['mp4', 'm4v', 'webm', 'mkv', 'mov', 'avi', 'wmv', 'flv', 'ts', 'mpg', 'mpeg', '3gp', 'ogv', 'mp3', 'm4a', 'aac', 'opus', 'ogg', 'wav', 'flac']

export function platformOf(url) {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return PLATFORMS.find(([, re]) => re.test(host))?.[0] || null
  } catch {
    return null
  }
}

export function normalizeUrl(raw) {
  const s = raw.trim()
  if (!s) return null
  try {
    if (/^[a-z]+:\/\//i.test(s)) return new URL(s).href
    const local = /^(localhost|127\.|\d+\.\d+\.\d+\.\d+|\[)/i.test(s)
    return new URL(`${local ? 'http' : 'https'}://${s}`).href
  } catch {
    return null
  }
}

const extOf = (url) => {
  try {
    const p = new URL(url).pathname
    const m = p.match(/\.([a-z0-9]{2,5})$/i)
    return m ? m[1].toLowerCase() : ''
  } catch {
    return ''
  }
}

export function ytDlpCommand(url) {
  // Saves title/channel/views/description/chapters (.info.json), the real thumbnail and English subtitles,
  // all of which Vidshelf reads and shows.
  return `yt-dlp -f "bv*+ba/b" --merge-output-format mp4 --embed-metadata --embed-chapters --write-info-json --write-thumbnail --convert-thumbnails jpg --write-subs --write-auto-subs --sub-langs en --convert-subs srt -o "%(title)s.%(ext)s" "${url}"`
}

export function sanitizeName(name) {
  return (name || 'video').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150) || 'video'
}

function nameFromResponse(res, fallbackUrl) {
  const cd = res.headers.get('content-disposition') || ''
  const m = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="?([^";]+)"?/i)
  if (m) { try { return decodeURIComponent(m[1]) } catch { return m[1] } }
  try {
    const last = new URL(res.url || fallbackUrl).pathname.split('/').filter(Boolean).pop()
    return last ? decodeURIComponent(last) : 'video'
  } catch {
    return 'video'
  }
}

const isHls = (type, url) => /mpegurl/i.test(type) || extOf(url) === 'm3u8'
const isDash = (type, url) => /dash\+xml/i.test(type) || extOf(url) === 'mpd'
const isMedia = (type, url) =>
  /^(video|audio)\//i.test(type) || (MEDIA_EXT.includes(extOf(url)) && /octet-stream|^$|binary/i.test(type))

/**
 * Figures out what a link is.
 * → { kind: 'platform', platform } | { kind: 'blocked' } | { kind: 'error', message }
 *   { kind: 'file', name, size, type } | { kind: 'hls', ...playlist } | { kind: 'dash' }
 *   { kind: 'page', title, media: [{ url, label }] } | { kind: 'unknown', type }
 */
export async function inspect(url, signal) {
  const platform = platformOf(url)
  if (platform) return { kind: 'platform', platform }

  let res
  try {
    res = await fetch(url, { signal, mode: 'cors', credentials: 'omit' })
  } catch (e) {
    if (e.name === 'AbortError') throw e
    return { kind: 'blocked' } // CORS or network: the browser won't let a website read this server
  }
  if (!res.ok) return { kind: 'error', message: `The server answered ${res.status} ${res.statusText}` }
  const type = (res.headers.get('content-type') || '').toLowerCase()
  const finalUrl = res.url || url

  if (isHls(type, finalUrl)) {
    const text = await res.text()
    return { kind: 'hls', ...parsePlaylist(text, finalUrl) }
  }
  if (isDash(type, finalUrl)) { res.body?.cancel(); return { kind: 'dash' } }
  if (isMedia(type, finalUrl)) {
    res.body?.cancel()
    return { kind: 'file', url: finalUrl, name: nameFromResponse(res, url), size: Number(res.headers.get('content-length')) || null, type }
  }
  if (/text\/html|application\/xhtml/.test(type)) {
    const html = await res.text()
    return { kind: 'page', ...scanPage(html, finalUrl) }
  }
  res.body?.cancel()
  return { kind: 'unknown', type }
}

// ---------- web pages: look for embedded media ----------
export function scanPage(html, baseUrl) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const found = new Map()
  const add = (raw, label) => {
    if (!raw) return
    let u
    try { u = new URL(raw.replace(/\\\//g, '/').replace(/&amp;/g, '&'), baseUrl).href } catch { return }
    if (!/^https?:/.test(u) || found.has(u)) return
    const ext = extOf(u)
    if (ext === 'm3u8') label = label || 'HLS stream'
    found.set(u, { url: u, label: label || (ext ? `.${ext} file` : 'Media') })
  }
  doc.querySelectorAll('video[src], audio[src], video source[src], audio source[src]').forEach((el) => add(el.getAttribute('src'), el.closest('audio') ? 'Audio element' : 'Video element'))
  doc.querySelectorAll('meta[property^="og:video"], meta[name^="twitter:player:stream"], meta[itemprop="contentUrl"]').forEach((el) => {
    const c = el.getAttribute('content')
    if (c && !/\.(html?|php)$/i.test(c)) add(c, 'Page metadata')
  })
  doc.querySelectorAll('a[href]').forEach((a) => {
    const h = a.getAttribute('href')
    let full
    try { full = new URL(h, baseUrl).href } catch { return }
    if (MEDIA_EXT.concat('m3u8').includes(extOf(full))) add(h, (a.textContent || '').trim().slice(0, 60) || 'Linked file')
  })
  // URLs inside scripts / JSON (often with escaped slashes)
  const re = /https?:(?:\\?\/){2}[^"'\s<>()]+?\.(?:mp4|m4v|webm|mov|mkv|m3u8)(?:\?[^"'\s<>()\\]*)?/gi
  for (const m of html.matchAll(re)) add(m[0])
  const metaContent = (sel) => doc.querySelector(sel)?.getAttribute('content')?.trim() || null
  const title = metaContent('meta[property="og:title"]') || doc.title || ''
  let image = metaContent('meta[property="og:image"]') || metaContent('meta[name="twitter:image"]')
  try { image = image ? new URL(image, baseUrl).href : null } catch { image = null }
  return {
    title: title.trim(),
    media: [...found.values()].slice(0, 40),
    page: {
      url: metaContent('meta[property="og:url"]') || baseUrl,
      title: title.trim() || null,
      description: metaContent('meta[property="og:description"]') || metaContent('meta[name="description"]'),
      site: metaContent('meta[property="og:site_name"]'),
      image,
      date: metaContent('meta[property="article:published_time"]') || metaContent('meta[itemprop="uploadDate"]'),
    },
  }
}

// ---------- HLS ----------
function attrs(line) {
  const out = {}
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g
  let m
  while ((m = re.exec(line))) out[m[1]] = m[2].replace(/^"|"$/g, '')
  return out
}

export function parsePlaylist(text, baseUrl) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines[0] !== '#EXTM3U') throw new Error('Not a valid HLS playlist')
  const abs = (u) => new URL(u, baseUrl).href

  if (lines.some((l) => l.startsWith('#EXT-X-STREAM-INF'))) {
    const variants = []
    const audio = {}
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      if (l.startsWith('#EXT-X-MEDIA:')) {
        const a = attrs(l.slice(13))
        if (a.TYPE === 'AUDIO' && a.URI) (audio[a['GROUP-ID']] ||= []).push({ uri: abs(a.URI), name: a.NAME, isDefault: a.DEFAULT === 'YES' })
      } else if (l.startsWith('#EXT-X-STREAM-INF:')) {
        const a = attrs(l.slice(18))
        const uri = lines[i + 1] && !lines[i + 1].startsWith('#') ? abs(lines[i + 1]) : null
        if (!uri) continue
        const height = Number(a.RESOLUTION?.split('x')[1]) || null
        variants.push({ uri, height, bandwidth: Number(a.BANDWIDTH) || 0, audio: a.AUDIO || null })
      }
    }
    variants.sort((x, y) => (y.height || 0) - (x.height || 0) || y.bandwidth - x.bandwidth)
    return { master: true, variants, audio }
  }
  return { master: false, variants: [{ uri: baseUrl, height: null, bandwidth: 0, audio: null, media: parseMedia(lines, abs) }], audio: {} }
}

function parseMedia(lines, abs) {
  const segments = []
  let map = null
  let encrypted = false
  let byterange = false
  let duration = 0
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (l.startsWith('#EXT-X-KEY:')) { const a = attrs(l.slice(11)); if (a.METHOD && a.METHOD !== 'NONE') encrypted = true }
    else if (l.startsWith('#EXT-X-MAP:')) map = abs(attrs(l.slice(11)).URI)
    else if (l.startsWith('#EXT-X-BYTERANGE')) byterange = true
    else if (l.startsWith('#EXTINF:')) duration += parseFloat(l.slice(8)) || 0
    else if (!l.startsWith('#')) segments.push(abs(l))
  }
  return { segments, map, encrypted, byterange, live: !lines.includes('#EXT-X-ENDLIST'), duration }
}

async function loadMedia(uri, signal) {
  const res = await fetch(uri, { signal, credentials: 'omit' })
  if (!res.ok) throw new Error(`Playlist request failed (${res.status})`)
  const lines = (await res.text()).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  return parseMedia(lines, (u) => new URL(u, res.url || uri).href)
}

async function fetchBytes(url, signal, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { signal, credentials: 'omit' })
      if (!r.ok) throw new Error(`Segment request failed (${r.status})`)
      return new Uint8Array(await r.arrayBuffer())
    } catch (e) {
      if (e.name === 'AbortError' || i >= tries) throw e
      await new Promise((r) => setTimeout(r, 500 * i))
    }
  }
}

async function fetchAll(urls, signal, onEach, parallel = 6) {
  const out = new Array(urls.length)
  let next = 0
  const worker = async () => {
    while (next < urls.length) {
      const i = next++
      out[i] = await fetchBytes(urls[i], signal)
      onEach(out[i].length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(parallel, urls.length) }, worker))
  return out
}

const concat = (parts) => {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

/** Downloads an HLS variant (+ its separate audio track, if any) and returns MP4 bytes. */
export async function downloadHls(info, variantIndex, signal, onProgress) {
  const variant = info.variants[variantIndex]
  const video = variant.media || (await loadMedia(variant.uri, signal))
  const audioTrack = variant.audio && info.audio[variant.audio]
  const audioUri = audioTrack ? (audioTrack.find((a) => a.isDefault) || audioTrack[0]).uri : null
  const audio = audioUri ? await loadMedia(audioUri, signal) : null

  for (const m of [video, audio].filter(Boolean)) {
    if (m.encrypted) throw new Error('This stream is encrypted, so it can’t be downloaded.')
    if (m.byterange) throw new Error('This stream uses byte-range segments, which aren’t supported yet.')
    if (!m.segments.length) throw new Error('The playlist has no segments.')
  }

  const vUrls = [...(video.map ? [video.map] : []), ...video.segments]
  const aUrls = audio ? [...(audio.map ? [audio.map] : []), ...audio.segments] : []
  const total = vUrls.length + aUrls.length
  let done = 0
  let bytes = 0
  const tick = (n) => { done++; bytes += n; onProgress?.({ fraction: (done / total) * 0.95, bytes, stage: `Segment ${done} of ${total}` }) }

  const vData = concat(await fetchAll(vUrls, signal, tick))
  const aData = audio ? concat(await fetchAll(aUrls, signal, tick)) : null

  // fMP4 without separate audio is already a playable MP4.
  if (video.map && !aData) { onProgress?.({ fraction: 1, bytes, stage: 'Done' }); return vData }

  onProgress?.({ fraction: 0.96, bytes, stage: 'Joining into MP4…' })
  const ff = await getFFmpeg()
  const vName = video.map ? 'v.mp4' : 'v.ts'
  const aName = audio ? (audio.map ? 'a.mp4' : /\.aac(\?|$)/i.test(audio.segments[0]) ? 'a.aac' : 'a.ts') : null
  await ff.writeFile(vName, vData)
  if (aName) await ff.writeFile(aName, aData)
  const args = ['-hide_banner', '-i', vName]
  if (aName) args.push('-i', aName, '-map', '0:v:0', '-map', '1:a:0')
  args.push('-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart', 'out.mp4')
  let code = await ff.exec(args)
  if (code !== 0) {
    // audio isn't AAC (e.g. MP3/AC3): re-encode audio only
    const i = args.indexOf('-c')
    args.splice(i, 4, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k')
    code = await ff.exec(args)
  }
  if (code !== 0) throw new Error('Could not join the stream into an MP4.')
  const out = await ff.readFile('out.mp4')
  for (const f of [vName, aName, 'out.mp4']) if (f) await ff.deleteFile(f).catch(() => {})
  onProgress?.({ fraction: 1, bytes, stage: 'Done' })
  return out
}

/** Streams a direct media file. Writes straight to disk when `writable` is given (no RAM limit). */
export async function downloadFile(url, signal, onProgress, writable) {
  const res = await fetch(url, { signal, credentials: 'omit' })
  if (!res.ok) throw new Error(`The server answered ${res.status}`)
  const total = Number(res.headers.get('content-length')) || 0
  const reader = res.body.getReader()
  const chunks = []
  let bytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.length
    if (writable) await writable.write(value)
    else chunks.push(value)
    onProgress?.({ fraction: total ? bytes / total : null, bytes, total, stage: 'Downloading' })
  }
  return writable ? null : new Blob(chunks, { type: res.headers.get('content-type') || 'application/octet-stream' })
}
