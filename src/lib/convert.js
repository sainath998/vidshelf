// In-browser conversion with ffmpeg.wasm. Nothing is uploaded.
import { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg'
import { toBlobURL } from '@ffmpeg/util'
import * as db from './db'

// The ~31 MB FFmpeg engine is loaded from the jsDelivr CDN only when a user converts a file,
// so it is never part of your deploy. Pinned version = reproducible + long-lived browser cache.
const CORE_VERSION = '0.12.10'
const cdn = (pkg, file) => `https://cdn.jsdelivr.net/npm/@ffmpeg/${pkg}@${CORE_VERSION}/dist/esm/${file}`
const ST = { core: cdn('core', 'ffmpeg-core.js'), wasm: cdn('core', 'ffmpeg-core.wasm') }
const MT = { core: cdn('core-mt', 'ffmpeg-core.js'), wasm: cdn('core-mt', 'ffmpeg-core.wasm'), worker: cdn('core-mt', 'ffmpeg-core.worker.js') }

// Codecs Chrome can play inside an MP4.
const VIDEO_OK = ['h264', 'hevc', 'av1', 'vp9']
const AUDIO_OK = ['aac', 'mp3', 'opus', 'flac']

let ffmpeg = null
let loading = null

export const multiThreaded = () => !!globalThis.crossOriginIsolated

export function getFFmpeg(onStatus) {
  if (ffmpeg) return Promise.resolve(ffmpeg)
  if (!loading) {
    loading = (async () => {
      const mt = multiThreaded()
      onStatus?.('Downloading converter (about 31 MB, only the first time)…')
      const f = new FFmpeg()
      const src = mt ? MT : ST
      const cfg = {
        coreURL: await toBlobURL(src.core, 'text/javascript'),
        wasmURL: await toBlobURL(src.wasm, 'application/wasm'),
      }
      if (mt) cfg.workerURL = await toBlobURL(src.worker, 'text/javascript')
      onStatus?.('Starting converter…')
      await f.load(cfg)
      ffmpeg = f
      return f
    })().catch((e) => { loading = null; throw e })
  }
  return loading
}

// Stop a running conversion (the converter is reloaded next time).
export function cancel() {
  ffmpeg?.terminate()
  ffmpeg = null
  loading = null
}

async function withInput(ff, file, fn) {
  const dir = '/in'
  await ff.createDir(dir).catch(() => {})
  await ff.mount(FFFSType.WORKERFS, { files: [file] }, dir) // reads the file lazily, no copy
  try {
    return await fn(`${dir}/${file.name}`)
  } finally {
    await ff.unmount(dir).catch(() => {})
  }
}

export async function probe(file, onStatus) {
  const ff = await getFFmpeg(onStatus)
  onStatus?.('Checking the file…')
  const logs = []
  const onLog = ({ message }) => logs.push(message)
  ff.on('log', onLog)
  try {
    await withInput(ff, file, (input) => ff.exec(['-hide_banner', '-i', input]).catch(() => {}))
  } finally {
    ff.off('log', onLog)
  }
  const info = { video: null, audio: null, duration: null, raw: logs.join('\n') }
  for (const line of logs) {
    const d = line.match(/Duration: (\d+):(\d+):([\d.]+)/)
    if (d && info.duration == null) info.duration = +d[1] * 3600 + +d[2] * 60 + +d[3]
    const s = line.match(/Stream #\d+:\d+.*?: (Video|Audio): ([\w-]+)/)
    if (!s || line.includes('attached pic')) continue
    if (s[1] === 'Video' && !info.video) info.video = s[2]
    if (s[1] === 'Audio' && !info.audio) info.audio = s[2]
    const res = line.match(/, (\d{2,5})x(\d{2,5})/)
    if (s[1] === 'Video' && res && !info.height) info.height = +res[2]
  }
  info.videoOk = !!info.video && VIDEO_OK.includes(info.video)
  info.audioOk = !info.audio || AUDIO_OK.includes(info.audio)
  info.recommended = info.videoOk ? (info.audioOk ? 'remux' : 'audio') : 'full'
  return info
}

/**
 * mode: 'remux' (copy everything) | 'audio' (copy video, re-encode audio) | 'full' (re-encode everything)
 * opts: { preset: 'ultrafast'|'veryfast'|'medium', maxHeight: null|1080|720|480, video: codec }
 */
export async function convert(file, mode, opts, duration, onProgress) {
  const ff = await getFFmpeg()
  const out = 'out.mp4'
  const onProg = ({ time }) => {
    if (duration) onProgress?.(Math.max(0, Math.min(1, time / 1e6 / duration)))
  }
  ff.on('progress', onProg)
  const logs = []
  const onLog = ({ message }) => { logs.push(message); if (logs.length > 40) logs.shift() }
  ff.on('log', onLog)
  try {
    const code = await withInput(ff, file, (input) => {
      const args = ['-hide_banner', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn']
      if (mode === 'remux' || mode === 'audio') {
        args.push('-c:v', 'copy')
        if (opts.video === 'hevc') args.push('-tag:v', 'hvc1')
      } else {
        args.push('-c:v', 'libx264', '-preset', opts.preset || 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p')
        // x264 picks ~1.5x CPU-core threads by default, which exceeds the wasm thread pool and hangs. Cap it.
        if (multiThreaded()) args.push('-threads', '4')
        if (opts.maxHeight) args.push('-vf', `scale=-2:'min(${opts.maxHeight},ih)'`)
      }
      if (mode === 'remux') args.push('-c:a', 'copy')
      else args.push('-c:a', 'aac', '-b:a', '160k', '-ac', '2')
      args.push('-movflags', '+faststart', out)
      return ff.exec(args)
    })
    if (code !== 0) throw new Error('Conversion failed:\n' + logs.slice(-6).join('\n'))
    const data = await ff.readFile(out)
    await ff.deleteFile(out).catch(() => {})
    onProgress?.(1)
    return data
  } finally {
    ff.off('progress', onProg)
    ff.off('log', onLog)
  }
}

// ---------- where converted files live ----------
export const convertedName = (video) => `${video.title}.vidshelf.mp4`
const convKey = (v) => `conv:${v.id}:${v.size}:${v.lastModified}`

async function opfsDir() {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle('converted', { create: true })
}

async function writeTo(dirHandle, name, data) {
  const fh = await dirHandle.getFileHandle(name, { create: true })
  const w = await fh.createWritable()
  await w.write(data)
  await w.close()
  return fh.getFile()
}

// Saves next to the original video (needs read-write permission on the picked folder).
export async function saveNextToOriginal(rootHandle, video, data) {
  let dir = rootHandle
  for (const part of video.folder.split('/').slice(1)) dir = await dir.getDirectoryHandle(part)
  return writeTo(dir, convertedName(video), data)
}

// Saves inside the browser's private storage (OPFS); remembered for this video.
export async function saveInBrowser(video, data) {
  const name = `${crypto.randomUUID()}.mp4`
  const file = await writeTo(await opfsDir(), name, data)
  await db.set(convKey(video), name)
  return file
}

export async function getSavedInBrowser(video) {
  try {
    const name = await db.get(convKey(video))
    if (!name) return null
    return await (await (await opfsDir()).getFileHandle(name)).getFile()
  } catch {
    return null
  }
}

export function download(video, data) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([data], { type: 'video/mp4' }))
  a.download = convertedName(video)
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
  return new File([data], convertedName(video), { type: 'video/mp4' })
}
