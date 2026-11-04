export function fmtTime(sec) {
  if (sec == null || !Number.isFinite(sec)) return ''
  sec = Math.floor(sec)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = String(sec % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

export function fmtSize(bytes) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (bytes >= 1024 && i < u.length - 1) { bytes /= 1024; i++ }
  return `${bytes.toFixed(i > 1 ? 1 : 0)} ${u[i]}`
}

export function fmtAgo(ms) {
  const d = (Date.now() - ms) / 1000
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]
  for (const [name, s] of units) {
    const n = Math.floor(d / s)
    if (n >= 1) return `${n} ${name}${n > 1 ? 's' : ''} ago`
  }
  return 'just now'
}

export const folderLabel = (folder) => folder.split('/').pop() || folder

// A video counts as watched once 90% is done.
export const ratio = (p) => (p && p.d ? Math.min(1, p.t / p.d) : 0)
export const isWatched = (p) => ratio(p) >= 0.9
