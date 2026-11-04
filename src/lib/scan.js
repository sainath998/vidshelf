// Turns a picked folder into a flat, naturally-sorted list of videos.
export const VIDEO_EXT = [
  // play directly in most browsers
  'mp4', 'm4v', 'webm', 'mkv', 'mov',
  // usually need "Make playable"
  'avi', 'divx', 'wmv', 'asf', 'flv', 'f4v', 'ts', 'm2ts', 'mts', 'mpg', 'mpeg', 'm2v', 'vob',
  '3gp', '3g2', 'ogv', 'rm', 'rmvb', 'dv', 'mxf',
]
const SUB_EXT = ['srt', 'vtt']

const extOf = (n) => { const i = n.lastIndexOf('.'); return i < 0 ? '' : n.slice(i + 1).toLowerCase() }
const stripExt = (n) => { const i = n.lastIndexOf('.'); return i < 0 ? n : n.slice(0, i) }
const wanted = (name) => { const x = extOf(name); return VIDEO_EXT.includes(x) || SUB_EXT.includes(x) }

// Sidecar files written by yt-dlp & co. next to a video: "<name>.info.json" and "<name>.jpg/.webp/.png"
const IMG_EXT = ['jpg', 'jpeg', 'png', 'webp']
const sidecarStem = (name) => {
  const l = name.toLowerCase()
  if (l.endsWith('.info.json')) return name.slice(0, -10)
  if (IMG_EXT.includes(extOf(name))) return stripExt(name)
  return null
}
// Keep only sidecars whose name matches a video next to them (so photo folders aren't pulled in).
function withSidecars(names) {
  const stems = new Set(names.filter((n) => VIDEO_EXT.includes(extOf(n))).map((n) => stripExt(n).toLowerCase()))
  return names.filter((n) => wanted(n) || (stems.size && stems.has((sidecarStem(n) || '\0').toLowerCase())))
}

export const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function build(entries) {
  const infos = new Map()
  const covers = new Map()
  for (const e of entries) {
    const stem = sidecarStem(e.path)
    if (!stem) continue
    if (e.path.toLowerCase().endsWith('.info.json')) infos.set(stem.toLowerCase(), e.file)
    else if (!covers.has(stem.toLowerCase()) || extOf(e.path) === 'jpg') covers.set(stem.toLowerCase(), e.file)
  }
  const subs = new Map()
  for (const e of entries) {
    if (SUB_EXT.includes(extOf(e.path))) subs.set(stripExt(e.path).toLowerCase(), e.file)
  }
  // "<name>.vidshelf.mp4" files are converted copies made by Vidshelf: attach them to the original.
  const converted = new Map()
  for (const e of entries) {
    if (e.path.toLowerCase().endsWith('.vidshelf.mp4')) converted.set(e.path.slice(0, -'.vidshelf.mp4'.length).toLowerCase(), e.file)
  }
  const originals = new Set(
    entries.filter((e) => VIDEO_EXT.includes(extOf(e.path)) && !e.path.toLowerCase().endsWith('.vidshelf.mp4'))
      .map((e) => stripExt(e.path).toLowerCase()),
  )
  const videos = []
  for (const e of entries) {
    const ext = extOf(e.path)
    if (!VIDEO_EXT.includes(ext)) continue
    const lower = e.path.toLowerCase()
    if (lower.endsWith('.vidshelf.mp4') && originals.has(lower.slice(0, -'.vidshelf.mp4'.length))) continue
    const parts = e.path.split('/')
    const name = parts.pop()
    const key = stripExt(e.path).toLowerCase()
    videos.push({
      id: e.path,
      name,
      title: stripExt(name),
      folder: parts.join('/'),
      ext,
      file: e.file,
      size: e.file.size,
      lastModified: e.file.lastModified,
      playFile: converted.get(key) || null,
      infoFile: infos.get(key) || null,
      coverFile: covers.get(key) || null,
      subs: subs.get(key) || subs.get(key + '.en') || subs.get(key + '.eng') || null,
    })
  }
  videos.sort((a, b) => collator.compare(a.folder, b.folder) || collator.compare(a.name, b.name))
  return videos
}

// Folders that never contain the user's videos but can hold millions of files.
const SKIP_DIRS = new Set([
  'node_modules', 'library', 'applications', 'system', 'appdata', '$recycle.bin', 'system volume information',
  '__pycache__', 'venv', 'site-packages', 'bower_components', 'caches',
  'windows', 'program files', 'program files (x86)', 'programdata',
])
const SKIP_DIR_EXT = /\.(app|bundle|framework|photoslibrary|musiclibrary|tvlibrary|plugin|kext|xcodeproj|xcassets|lproj|pkg|dmg)$/i
const skipDir = (name) => name.startsWith('.') || SKIP_DIRS.has(name.toLowerCase()) || SKIP_DIR_EXT.test(name)

/**
 * File System Access API (Chrome/Edge/Brave/Opera): handle can be remembered.
 * onProgress({ videos, folders, current }) · control: { stop: false, cancel: false }
 *   stop   → stop scanning and return what was found so far
 *   cancel → throw an AbortError
 */
export async function scanHandle(root, onProgress, control = {}) {
  const entries = []
  let folders = 0
  let videos = 0
  let lastReport = 0
  const report = (current) => {
    const now = performance.now()
    if (now - lastReport < 100) return
    lastReport = now
    onProgress?.({ videos, folders, current })
  }
  async function walk(dir, prefix) {
    if (control.cancel) throw new DOMException('Scan cancelled', 'AbortError')
    if (control.stop) return
    folders++
    report(prefix)
    const files = []
    const subdirs = []
    for await (const [name, handle] of dir.entries()) {
      if (control.cancel) throw new DOMException('Scan cancelled', 'AbortError')
      if (control.stop) return
      if (handle.kind === 'directory') { if (!skipDir(name)) subdirs.push([name, handle]) }
      else if (!name.startsWith('.') && (wanted(name) || sidecarStem(name))) files.push([name, handle])
    }
    const keep = new Set(withSidecars(files.map(([n]) => n)))
    files.splice(0, files.length, ...files.filter(([n]) => keep.has(n)))
    const got = await Promise.all(files.map(async ([name, h]) => {
      try { return { path: `${prefix}/${name}`, file: await h.getFile() } } catch { return null }
    }))
    for (const g of got) if (g) { entries.push(g); if (VIDEO_EXT.includes(extOf(g.path))) videos++ }
    report(prefix)
    for (const [name, h] of subdirs) {
      try { await walk(h, `${prefix}/${name}`) } catch (e) { if (e.name === 'AbortError') throw e }
    }
  }
  await walk(root, root.name)
  onProgress?.({ videos, folders, current: '' })
  return build(entries)
}

// <input webkitdirectory> fallback (Firefox/Safari): works, but can't be remembered.
export function scanFileList(fileList) {
  const all = [...fileList].filter((f) => !f.webkitRelativePath.split('/').some((p) => p.startsWith('.')))
  const byDir = new Map()
  for (const f of all) {
    const path = f.webkitRelativePath || f.name
    const dir = path.slice(0, path.lastIndexOf('/') + 1)
    if (!byDir.has(dir)) byDir.set(dir, [])
    byDir.get(dir).push(f)
  }
  const entries = []
  for (const files of byDir.values()) {
    const keep = new Set(withSidecars(files.map((f) => f.name)))
    for (const f of files) if (keep.has(f.name)) entries.push({ path: f.webkitRelativePath || f.name, file: f })
  }
  return build(entries)
}
