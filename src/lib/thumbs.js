// Generates thumbnails + durations in the browser (hidden <video> -> <canvas>), cached in IndexedDB.
import { get, set } from './db'

const MAX_PARALLEL = 2
const queue = []
let active = 0
let generation = 0

export const thumbKey = (v) => `thumb:${v.id}:${v.size}:${v.lastModified}${v.playFile ? ':converted' : ''}`
export const getCachedThumb = (v) => get(thumbKey(v))

export function resetThumbQueue() {
  queue.length = 0
  generation++
}

export function requestThumb(v, cb) {
  queue.push({ v, cb, gen: generation })
  pump()
}

function pump() {
  while (active < MAX_PARALLEL && queue.length) {
    const { v, cb, gen } = queue.shift()
    active++
    generate(v.playFile || v.file)
      .then(async (result) => {
        await set(thumbKey(v), result).catch(() => {})
        if (gen === generation) cb(result)
      })
      .finally(() => { active--; pump() })
  }
}

function generate(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'metadata'
    video.playsInline = true
    let done = false
    const duration = () => (Number.isFinite(video.duration) ? video.duration : null)
    const finish = (result) => {
      if (done) return
      done = true
      clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
      resolve(result)
    }
    const timer = setTimeout(() => finish({ blob: null, duration: duration(), unsupported: false }), 15000)

    video.onerror = () => finish({ blob: null, duration: null, unsupported: true })
    video.onloadedmetadata = () => {
      const d = duration()
      video.currentTime = d ? Math.min(d * 0.1, 60) : 1
    }
    video.onseeked = () => {
      const vw = video.videoWidth
      const vh = video.videoHeight
      // No decodable video track (e.g. HEVC without hardware support).
      if (!vw || !vh) return finish({ blob: null, duration: duration(), unsupported: true })
      const W = 320, H = 180
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, W, H)
      const s = Math.min(W / vw, H / vh)
      ctx.drawImage(video, (W - vw * s) / 2, (H - vh * s) / 2, vw * s, vh * s)
      canvas.toBlob((blob) => finish({ blob, duration: duration(), unsupported: false }), 'image/jpeg', 0.72)
    }
    video.src = url
  })
}
