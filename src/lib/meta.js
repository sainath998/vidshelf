// Reads video metadata in the browser, without FFmpeg:
//  • sidecar "<name>.info.json" (yt-dlp, and Vidshelf's own downloader)
//  • tags embedded in MP4/MOV (iTunes-style ilst + Nero chapters) and MKV/WebM (EBML Info/Tags/Chapters/Attachments)
// Result: { title, channel, channelUrl, date, description, views, likes, comments, url, site, tags, chapters, duration, cover }
import { get, set } from './db'

const read = async (file, start, len) => new Uint8Array(await file.slice(start, start + len).arrayBuffer())
const utf8 = new TextDecoder('utf-8')
const latin1 = new TextDecoder('latin1')

// ---------------------------------------------------------------- site names
const SITE_NAMES = {
  'youtube.com': 'YouTube', 'youtu.be': 'YouTube', 'm.youtube.com': 'YouTube', 'music.youtube.com': 'YouTube Music',
  'vimeo.com': 'Vimeo', 'instagram.com': 'Instagram', 'tiktok.com': 'TikTok', 'x.com': 'X', 'twitter.com': 'X',
  'facebook.com': 'Facebook', 'fb.watch': 'Facebook', 'dailymotion.com': 'Dailymotion', 'twitch.tv': 'Twitch',
  'reddit.com': 'Reddit', 'bilibili.com': 'Bilibili', 'soundcloud.com': 'SoundCloud', 'rumble.com': 'Rumble',
  'linkedin.com': 'LinkedIn', 'udemy.com': 'Udemy', 'coursera.org': 'Coursera', 'archive.org': 'Internet Archive',
}
export function siteName(url, extractorKey) {
  let host = null
  try { host = new URL(url).hostname.replace(/^(www|m)\./, '') } catch { /* no url */ }
  if (host && SITE_NAMES[host]) return SITE_NAMES[host]
  if (extractorKey && !['Generic', 'vidshelf'].includes(extractorKey)) return extractorKey.replace(/^Youtube/, 'YouTube')
  return host
}

// ---------------------------------------------------------------- yt-dlp info.json
const ymd = (s) => (s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null)

function fromInfoJson(j) {
  return {
    title: j.title || j.fulltitle,
    channel: j.channel || j.uploader || j.creator || j.uploader_id,
    channelUrl: j.channel_url || j.uploader_url,
    date: ymd(j.upload_date) || ymd(j.release_date) || (j.timestamp ? new Date(j.timestamp * 1000).toISOString().slice(0, 10) : null),
    description: j.description,
    views: j.view_count,
    likes: j.like_count,
    comments: j.comment_count,
    url: j.webpage_url || j.original_url,
    site: siteName(j.webpage_url || j.original_url, j.extractor_key),
    tags: Array.isArray(j.tags) ? j.tags.slice(0, 30) : [],
    chapters: Array.isArray(j.chapters) ? j.chapters.map((c) => ({ start: c.start_time, title: c.title })).filter((c) => Number.isFinite(c.start)) : [],
    duration: j.duration,
    thumbnailUrl: j.thumbnail,
  }
}

// ---------------------------------------------------------------- MP4 / MOV
async function boxHeader(file, off) {
  const b = await read(file, off, 16)
  if (b.length < 8) return null
  const dv = new DataView(b.buffer)
  let size = dv.getUint32(0)
  const type = latin1.decode(b.subarray(4, 8))
  let hdr = 8
  if (size === 1) { size = Number(dv.getBigUint64(8)); hdr = 16 }
  else if (size === 0) size = file.size - off
  return { size, type, hdr }
}

function* children(buf, start, end) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let off = start
  while (off + 8 <= end) {
    let size = dv.getUint32(off)
    const type = latin1.decode(buf.subarray(off + 4, off + 8))
    let hdr = 8
    if (size === 1) { size = Number(dv.getBigUint64(off + 8)); hdr = 16 }
    else if (size === 0) size = end - off
    if (size < hdr || off + size > end) return
    yield { type, start: off + hdr, end: off + size }
    off += size
  }
}

const find = (buf, start, end, type) => { for (const c of children(buf, start, end)) if (c.type === type) return c; return null }

const ILST = {
  '©nam': 'title', '©ART': 'channel', aART: 'channel', '©day': 'date', desc: 'description', ldes: 'description',
  '©cmt': 'comment', purl: 'url', '©alb': 'album', keyw: 'keywords',
}

async function parseMp4(file) {
  let off = 0
  let moov = null
  for (let i = 0; i < 64 && off < file.size; i++) {
    const h = await boxHeader(file, off)
    if (!h || h.size < 8) break
    if (h.type === 'moov') { moov = { off, ...h }; break }
    off += h.size
  }
  if (!moov || moov.size > 64 * 1024 * 1024) return {}
  const buf = await read(file, moov.off, moov.size)
  const dv = new DataView(buf.buffer)
  const out = {}

  const mvhd = find(buf, moov.hdr, buf.length, 'mvhd')
  if (mvhd) {
    const v = buf[mvhd.start]
    const ts = v === 1 ? dv.getUint32(mvhd.start + 20) : dv.getUint32(mvhd.start + 12)
    const dur = v === 1 ? Number(dv.getBigUint64(mvhd.start + 24)) : dv.getUint32(mvhd.start + 16)
    if (ts) out.duration = dur / ts
  }

  const udta = find(buf, moov.hdr, buf.length, 'udta')
  if (!udta) return out
  const meta = find(buf, udta.start, udta.end, 'meta')
  if (meta) {
    // 'meta' is a full box in MP4 (4 bytes version/flags) but not in some QuickTime files
    const isFull = latin1.decode(buf.subarray(meta.start + 4, meta.start + 8)) !== 'hdlr'
    const ilst = find(buf, meta.start + (isFull ? 4 : 0), meta.end, 'ilst')
    if (ilst) {
      for (const item of children(buf, ilst.start, ilst.end)) {
        const data = find(buf, item.start, item.end, 'data')
        if (!data) continue
        const kind = dv.getUint32(data.start) & 0xffffff
        const payload = buf.subarray(data.start + 8, data.end)
        if (item.type === 'covr') {
          if (!out.cover) out.cover = new Blob([payload.slice()], { type: kind === 14 ? 'image/png' : 'image/jpeg' })
        } else if (ILST[item.type] && (kind === 1 || kind === 0)) {
          const key = ILST[item.type]
          const text = utf8.decode(payload).trim()
          if (text && !(key === 'description' && out.description && out.description.length >= text.length)) out[key] = text
        }
      }
    }
  }
  // Nero chapters (written by FFmpeg / yt-dlp --embed-chapters)
  const chpl = find(buf, udta.start, udta.end, 'chpl')
  if (chpl) {
    let p = chpl.start + 4
    if (buf[chpl.start] === 1) p += 4
    const n = buf[p++]
    const chapters = []
    for (let i = 0; i < n && p + 9 <= chpl.end; i++) {
      const start = Number(dv.getBigUint64(p)) / 1e7
      const len = buf[p + 8]
      chapters.push({ start, title: utf8.decode(buf.subarray(p + 9, p + 9 + len)) })
      p += 9 + len
    }
    if (chapters.length) out.chapters = chapters
  }
  return out
}

// ---------------------------------------------------------------- MKV / WebM (EBML)
function vint(buf, p, keepMarker) {
  const first = buf[p]
  if (first === undefined) return null
  let len = 1
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++
  if (len > 8 || p + len > buf.length) return null
  let value = keepMarker ? first : first & (0xff >> len)
  let allOnes = (first & (0xff >> len)) === (0xff >> len)
  for (let i = 1; i < len; i++) { value = value * 256 + buf[p + i]; if (buf[p + i] !== 0xff) allOnes = false }
  return { value, len, unknown: !keepMarker && allOnes }
}

function* ebml(buf, start, end) {
  let p = start
  while (p < end) {
    const id = vint(buf, p, true)
    if (!id) return
    const size = vint(buf, p + id.len, false)
    if (!size) return
    const dataStart = p + id.len + size.len
    const dataEnd = size.unknown ? end : Math.min(end, dataStart + size.value)
    yield { id: id.value, start: dataStart, end: dataEnd, size: size.unknown ? null : size.value }
    if (size.unknown) return
    p = dataStart + size.value
  }
}

const uint = (buf, s, e) => { let v = 0; for (let i = s; i < e; i++) v = v * 256 + buf[i]; return v }
const float = (buf, s, e) => { const dv = new DataView(buf.buffer, buf.byteOffset + s, e - s); return e - s === 4 ? dv.getFloat32(0) : dv.getFloat64(0) }
const str = (buf, s, e) => utf8.decode(buf.subarray(s, e)).replace(/\0+$/, '')

const ID = {
  Segment: 0x18538067, SeekHead: 0x114d9b74, Seek: 0x4dbb, SeekID: 0x53ab, SeekPos: 0x53ac,
  Info: 0x1549a966, TimecodeScale: 0x2ad7b1, Duration: 0x4489, Title: 0x7ba9,
  Chapters: 0x1043a770, Edition: 0x45b9, Atom: 0xb6, TimeStart: 0x91, Display: 0x80, ChapString: 0x85,
  Tags: 0x1254c367, Tag: 0x7373, Targets: 0x63c0, TrackUID: 0x63c5, SimpleTag: 0x67c8, TagName: 0x45a3, TagString: 0x4487,
  Attachments: 0x1941a469, AttachedFile: 0x61a7, FileName: 0x466e, FileMime: 0x4660, FileData: 0x465c,
}
const MKV_TAGS = { TITLE: 'title', ARTIST: 'channel', DATE: 'date', DATE_RELEASED: 'date', DESCRIPTION: 'description', SYNOPSIS: 'description', COMMENT: 'comment', PURL: 'url', URL: 'url' }

async function parseMkv(file) {
  const head = await read(file, 0, 256 * 1024)
  let seg = null
  for (const el of ebml(head, 0, head.length)) { if (el.id === ID.Segment) { seg = el; break } }
  if (!seg) return {}
  const segStart = seg.start
  const positions = {}
  const collectSeeks = (buf, s, e, base) => {
    for (const seek of ebml(buf, s, e)) {
      if (seek.id !== ID.Seek) continue
      let sid = null, pos = null
      for (const f of ebml(buf, seek.start, seek.end)) {
        if (f.id === ID.SeekID) sid = uint(buf, f.start, f.end)
        if (f.id === ID.SeekPos) pos = uint(buf, f.start, f.end)
      }
      if (sid != null && pos != null && positions[sid] == null) positions[sid] = base + pos
    }
  }
  // Top-level elements in the first chunk (SeekHead, Info, maybe Tags/Chapters)
  const inline = {}
  for (const el of ebml(head, segStart, head.length)) {
    if (el.id === ID.SeekHead) collectSeeks(head, el.start, el.end, segStart)
    if ([ID.Info, ID.Chapters, ID.Tags].includes(el.id) && el.end <= head.length) inline[el.id] = el
    if (el.id === 0x1f43b675) break // first Cluster: stop
  }
  if (positions[ID.SeekHead] && positions[ID.SeekHead] > head.length) {
    const b = await read(file, positions[ID.SeekHead], 64 * 1024)
    const el = ebml(b, 0, b.length).next().value
    if (el?.id === ID.SeekHead) collectSeeks(b, el.start, el.end, segStart)
  }
  const element = async (id, max) => {
    if (inline[id]) return { buf: head, el: inline[id] }
    const pos = positions[id]
    if (pos == null) return null
    const h = await read(file, pos, 16)
    const first = ebml(h, 0, h.length).next().value
    if (!first || first.id !== id || first.size == null || first.size > max) return null
    const b = await read(file, pos, first.start + first.size)
    return { buf: b, el: { start: first.start, end: first.start + first.size } }
  }

  const out = {}
  const info = await element(ID.Info, 1 << 20)
  if (info) {
    let scale = 1e6, dur = null
    for (const f of ebml(info.buf, info.el.start, info.el.end)) {
      if (f.id === ID.TimecodeScale) scale = uint(info.buf, f.start, f.end)
      if (f.id === ID.Duration) dur = float(info.buf, f.start, f.end)
      if (f.id === ID.Title) out.title = str(info.buf, f.start, f.end)
    }
    if (dur != null) out.duration = (dur * scale) / 1e9
  }

  const tags = await element(ID.Tags, 4 << 20)
  if (tags) {
    for (const tag of ebml(tags.buf, tags.el.start, tags.el.end)) {
      if (tag.id !== ID.Tag) continue
      let trackLevel = false
      const simple = []
      for (const f of ebml(tags.buf, tag.start, tag.end)) {
        if (f.id === ID.Targets) for (const t of ebml(tags.buf, f.start, f.end)) if (t.id === ID.TrackUID) trackLevel = true
        if (f.id === ID.SimpleTag) {
          let name = null, value = null
          for (const s of ebml(tags.buf, f.start, f.end)) {
            if (s.id === ID.TagName) name = str(tags.buf, s.start, s.end).toUpperCase()
            if (s.id === ID.TagString) value = str(tags.buf, s.start, s.end)
          }
          if (name && value) simple.push([name, value])
        }
      }
      if (trackLevel) continue
      for (const [name, value] of simple) {
        const key = MKV_TAGS[name]
        if (!key) continue
        if (key === 'description') { if (!out.description || value.length > out.description.length) out.description = value }
        else if (!out[key] || key === 'title') out[key] = value
      }
    }
  }

  const chapters = await element(ID.Chapters, 1 << 20)
  if (chapters) {
    const list = []
    for (const ed of ebml(chapters.buf, chapters.el.start, chapters.el.end)) {
      if (ed.id !== ID.Edition) continue
      for (const atom of ebml(chapters.buf, ed.start, ed.end)) {
        if (atom.id !== ID.Atom) continue
        let start = null, title = ''
        for (const f of ebml(chapters.buf, atom.start, atom.end)) {
          if (f.id === ID.TimeStart) start = uint(chapters.buf, f.start, f.end) / 1e9
          if (f.id === ID.Display) for (const d of ebml(chapters.buf, f.start, f.end)) if (d.id === ID.ChapString && !title) title = str(chapters.buf, d.start, d.end)
        }
        if (start != null) list.push({ start, title })
      }
      if (list.length) break
    }
    if (list.length) out.chapters = list
  }

  const att = await element(ID.Attachments, 16 << 20)
  if (att) {
    for (const f of ebml(att.buf, att.el.start, att.el.end)) {
      if (f.id !== ID.AttachedFile) continue
      let mime = '', data = null
      for (const a of ebml(att.buf, f.start, f.end)) {
        if (a.id === ID.FileMime) mime = str(att.buf, a.start, a.end)
        if (a.id === ID.FileData) data = att.buf.subarray(a.start, a.end)
      }
      if (data && /^image\//.test(mime)) { out.cover = new Blob([data.slice()], { type: mime }); break }
    }
  }
  return out
}

// ---------------------------------------------------------------- public API
function normalizeDate(d) {
  if (!d) return null
  if (/^\d{8}$/.test(d)) return ymd(d)
  const m = d.match(/^(\d{4})(-\d{2})?(-\d{2})?/)
  return m ? m[0] : null
}

export async function readMeta(v) {
  let embedded = {}
  try {
    if (['mp4', 'm4v', 'mov', '3gp', '3g2', 'f4v'].includes(v.ext)) embedded = await parseMp4(v.file)
    else if (['mkv', 'webm'].includes(v.ext)) embedded = await parseMkv(v.file)
  } catch (e) {
    console.warn('metadata', v.name, e)
  }
  let info = {}
  if (v.infoFile) {
    try { info = fromInfoJson(JSON.parse(await v.infoFile.text())) } catch (e) { console.warn('info.json', v.name, e) }
  }
  const pick = (k) => (info[k] != null && info[k] !== '' ? info[k] : embedded[k])
  // yt-dlp puts the page URL in the "comment" tag
  const url = pick('url') || (/^https?:\/\//.test(embedded.comment || '') ? embedded.comment.trim() : null)
  const site = info.site || (url ? siteName(url) : null)
  const meta = {
    title: pick('title') || null,
    channel: pick('channel') || null,
    channelUrl: info.channelUrl || null,
    date: normalizeDate(pick('date')),
    description: pick('description') || null,
    views: info.views ?? null,
    likes: info.likes ?? null,
    comments: info.comments ?? null,
    url,
    site,
    tags: info.tags?.length ? info.tags : embedded.keywords ? embedded.keywords.split(/[,;]\s*/).filter(Boolean) : [],
    chapters: (info.chapters?.length ? info.chapters : embedded.chapters) || [],
    duration: pick('duration') || null,
    cover: v.coverFile || embedded.cover || null,
  }
  meta.hasAny = !!(meta.title || meta.channel || meta.description || meta.url || meta.chapters.length || meta.cover)
  return meta
}

const metaKey = (v) => `meta:v3:${v.id}:${v.size}:${v.lastModified}:${v.infoFile?.lastModified || 0}:${v.coverFile?.lastModified || 0}`

/** Cached in IndexedDB so big libraries don't re-parse every visit. */
export async function getMeta(v) {
  const key = metaKey(v)
  const cached = await get(key).catch(() => null)
  if (cached) return cached
  const meta = await readMeta(v)
  set(key, meta).catch(() => {})
  return meta
}

// ---------------------------------------------------------------- display helpers
export function fmtCount(n) {
  if (n == null) return null
  if (n < 1000) return String(n)
  const units = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']]
  for (const [v, u] of units) if (n >= v) { const x = n / v; return `${x < 10 ? x.toFixed(1).replace(/\.0$/, '') : Math.floor(x)}${u}` }
}
