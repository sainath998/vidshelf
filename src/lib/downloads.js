// Download jobs live outside React so they keep running while you browse the library.
import { downloadFile, downloadHls, inspect, normalizeUrl, sanitizeName } from './fetcher'

let jobs = []
const listeners = new Set()
const controllers = new Map()
let onSaved = null

export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
export const getJobs = () => jobs
export const setOnSaved = (fn) => { onSaved = fn }

function update(id, patch) {
  jobs = jobs.map((j) => (j.id === id ? { ...j, ...(typeof patch === 'function' ? patch(j) : patch) } : j))
  listeners.forEach((l) => l())
}
const get = (id) => jobs.find((j) => j.id === id)

export function addLinks(text) {
  const urls = [...new Set(text.split(/[\s,]+/).map(normalizeUrl).filter(Boolean))]
  const created = urls.map((url) => ({ id: crypto.randomUUID(), url, status: 'checking', info: null, name: '', variant: 0, progress: null }))
  jobs = [...created, ...jobs]
  listeners.forEach((l) => l())
  created.forEach((j) => check(j.id))
  return created.length
}

async function check(id, keepName) {
  const job = get(id)
  const ac = new AbortController()
  controllers.set(id, ac)
  update(id, { status: 'checking', error: null })
  try {
    const info = await inspect(job.url, ac.signal)
    let name = keepName || job.name
    if (!name) {
      if (info.kind === 'file') name = info.name.replace(/\.[^.]+$/, '')
      else if (info.kind === 'page') name = info.title
      else {
        const u = new URL(job.url)
        name = decodeURIComponent(u.pathname.split('/').filter(Boolean).slice(-2, -1)[0] || u.hostname)
      }
    }
    update(id, { status: 'ready', info, name: sanitizeName(name) })
  } catch (e) {
    if (e.name !== 'AbortError') update(id, { status: 'error', error: e.message })
  } finally {
    controllers.delete(id)
  }
}

// From a scanned web page: switch the job to one of the media links found on it.
export function useMedia(id, mediaUrl) {
  const job = get(id)
  // keep what we learned about the page (title, description, thumbnail) for the .info.json
  update(id, { url: mediaUrl, info: null, page: job.info?.page || job.page || null })
  check(id, job.name)
}

export const setName = (id, name) => update(id, { name })
export const setVariant = (id, variant) => update(id, { variant })
export const retry = (id) => check(id, get(id).name)

export function remove(id) {
  controllers.get(id)?.abort()
  jobs = jobs.filter((j) => j.id !== id)
  listeners.forEach((l) => l())
}

export function cancel(id) {
  controllers.get(id)?.abort()
  update(id, { status: 'cancelled', progress: null })
}

async function folderHandle(root, folderPath) {
  let dir = root
  for (const part of folderPath.split('/').slice(1)) dir = await dir.getDirectoryHandle(part, { create: true })
  return dir
}

async function uniqueName(dir, base, ext) {
  for (let i = 0; i < 1000; i++) {
    const name = i ? `${base} (${i}).${ext}` : `${base}.${ext}`
    try { await dir.getFileHandle(name) } catch { return name }
  }
  return `${base}-${Date.now()}.${ext}`
}

function saveToDownloads(blob, filename) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 30000)
}

/** target: { type: 'folder', root, folder } | { type: 'browser' } */
export async function start(id, target) {
  const job = get(id)
  const { info } = job
  const ac = new AbortController()
  controllers.set(id, ac)
  const startedAt = Date.now()
  update(id, { status: 'downloading', error: null, startedAt, progress: { fraction: 0, bytes: 0, stage: 'Starting…' } })
  const onProgress = (p) => update(id, { progress: p })
  let writable = null
  try {
    const base = sanitizeName(job.name)
    const ext = info.kind === 'hls' ? 'mp4' : (info.name.match(/\.([a-z0-9]{2,5})$/i)?.[1] || 'mp4').toLowerCase()
    let dir = null
    let filename = `${base}.${ext}`
    if (target.type === 'folder') {
      dir = await folderHandle(target.root, target.folder)
      filename = await uniqueName(dir, base, ext)
    }

    if (info.kind === 'file') {
      if (dir) {
        const fh = await dir.getFileHandle(filename, { create: true })
        writable = await fh.createWritable()
        await downloadFile(info.url, ac.signal, onProgress, writable)
        await writable.close()
        writable = null
      } else {
        saveToDownloads(await downloadFile(info.url, ac.signal, onProgress), filename)
      }
    } else if (info.kind === 'hls') {
      const data = await downloadHls(info, job.variant, ac.signal, onProgress)
      if (ac.signal.aborted) return
      if (dir) {
        const fh = await dir.getFileHandle(filename, { create: true })
        const w = await fh.createWritable()
        await w.write(data)
        await w.close()
      } else {
        saveToDownloads(new Blob([data], { type: 'video/mp4' }), filename)
      }
    } else {
      throw new Error('This link can’t be downloaded in the browser.')
    }

    if (dir) await writeSidecars(dir, filename, get(id)).catch((e) => console.warn('sidecar', e))
    const savedPath = dir ? `${target.folder}/${filename}` : null
    update(id, { status: 'done', savedPath, filename, finishedAt: Date.now(), progress: { ...get(id).progress, fraction: 1 } })
    if (savedPath) onSaved?.(savedPath)
  } catch (e) {
    if (writable) await writable.abort().catch(() => {})
    if (e.name === 'AbortError' || ac.signal.aborted) update(id, { status: 'cancelled' })
    else update(id, { status: 'error', error: e.message })
  } finally {
    controllers.delete(id)
  }
}

// Writes "<name>.info.json" (yt-dlp compatible fields) and, if allowed, the page thumbnail "<name>.jpg".
async function writeSidecars(dir, filename, job) {
  const stem = filename.replace(/\.[^.]+$/, '')
  const page = job.page || {}
  const date = page.date && !Number.isNaN(Date.parse(page.date)) ? new Date(page.date) : null
  const info = {
    title: job.name,
    description: page.description || null,
    uploader: page.site || null,
    webpage_url: page.url || job.url,
    original_url: page.url || job.url,
    thumbnail: page.image || null,
    upload_date: date ? date.toISOString().slice(0, 10).replace(/-/g, '') : null,
    extractor: 'vidshelf',
    extractor_key: 'vidshelf',
    _vidshelf: { media_url: job.url, downloaded_at: new Date().toISOString() },
  }
  const w = await (await dir.getFileHandle(`${stem}.info.json`, { create: true })).createWritable()
  await w.write(JSON.stringify(info, null, 2))
  await w.close()
  if (page.image) {
    try {
      const r = await fetch(page.image, { credentials: 'omit' })
      const type = r.headers.get('content-type') || ''
      if (r.ok && type.startsWith('image/')) {
        const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg'
        const iw = await (await dir.getFileHandle(`${stem}.${ext}`, { create: true })).createWritable()
        await iw.write(await r.blob())
        await iw.close()
      }
    } catch { /* thumbnail host doesn't allow it — fine */ }
  }
}
