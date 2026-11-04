import { useState } from 'react'
import { fmtSize, fmtAgo, fmtTime } from '../lib/format'
import { fmtCount } from '../lib/meta'

const TOKEN = /(https?:\/\/[^\s<>"')\]]+)|(\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b)/g

// Turns URLs into links and timestamps (1:23, 01:02:03) into seek buttons.
function rich(text, onSeek) {
  const out = []
  let last = 0
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1]) out.push(<a key={m.index} href={m[1]} target="_blank" rel="noreferrer">{m[1]}</a>)
    else {
      const secs = m[2].split(':').reduce((a, b) => a * 60 + Number(b), 0)
      out.push(<button key={m.index} className="ts" onClick={() => onSeek(secs)}>{m[2]}</button>)
    }
    last = m.index + m[0].length
  }
  out.push(text.slice(last))
  return out
}

export default function Description({ video, meta, currentTime, onSeek }) {
  const [open, setOpen] = useState(false)
  const chapters = meta?.chapters || []
  const current = chapters.reduce((c, ch, i) => (ch.start <= currentTime + 0.25 ? i : c), -1)
  const date = meta?.date ? new Date(meta.date + 'T00:00:00') : null
  const stats = [
    meta?.views != null && `${meta.views.toLocaleString()} views`,
    date && date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
  ].filter(Boolean)
  const desc = meta?.description?.trim()
  const long = (desc?.length || 0) > 260 || (desc?.split('\n').length || 0) > 4

  return (
    <section className={`desc ${open ? 'open' : ''}`} onClick={() => !open && long && setOpen(true)}>
      <div className="desc-stats">
        {stats.length ? stats.join('  ·  ') : `${fmtSize(video.size)} · modified ${fmtAgo(video.lastModified)}`}
        {meta?.tags?.slice(0, open ? 30 : 3).map((t) => <span key={t} className="desc-tag">#{t.replace(/\s+/g, '')}</span>)}
      </div>
      {desc ? (
        <div className={`desc-text ${long && !open ? 'clamped' : ''}`}>{rich(desc, onSeek)}</div>
      ) : (
        <div className="desc-text muted">No description.</div>
      )}
      {chapters.length > 0 && (
        <div className="chapters">
          <div className="chapters-head">Chapters</div>
          <div className="chapter-list">
            {chapters.map((c, i) => (
              <button key={i} className={`chapter ${i === current ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); onSeek(c.start) }}>
                <span className="chapter-time">{fmtTime(c.start)}</span>
                <span className="chapter-title">{c.title || `Chapter ${i + 1}`}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {open && (
        <div className="desc-file muted small">
          File: {video.folder}/{video.name} · {fmtSize(video.size)} · modified {fmtAgo(video.lastModified)}
          {meta?.url && <> · <a href={meta.url} target="_blank" rel="noreferrer">source</a></>}
        </div>
      )}
      {long && (
        <button className="desc-toggle" onClick={(e) => { e.stopPropagation(); setOpen(!open) }}>{open ? 'Show less' : '…more'}</button>
      )}
    </section>
  )
}

export { fmtCount }
