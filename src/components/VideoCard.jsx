import { useEffect, useRef } from 'react'
import { nav } from '../nav'
import { fmtAgo, fmtSize, fmtTime, folderLabel, isWatched, ratio } from '../lib/format'
import { fmtCount } from '../lib/meta'

export function Thumb({ video, thumb, progress, small, onNeed, meta }) {
  const r = ratio(progress)
  const ref = useRef(null)
  // Ask for a thumbnail only once this card is (nearly) on screen.
  useEffect(() => {
    if (thumb || !onNeed || !ref.current) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { onNeed(video); io.disconnect() }
    }, { rootMargin: '300px' })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [thumb, onNeed, video])
  return (
    <div className={`thumb ${small ? 'small' : ''}`} ref={ref}>
      {thumb?.url ? (
        <img src={thumb.url} alt="" loading="lazy" />
      ) : (
        <div className="thumb-placeholder">
          {thumb?.unsupported ? <span className="unsupported">🛠 .{video.ext} — click to make playable</span> : <span className="spinner" />}
        </div>
      )}
      {thumb?.duration || meta?.duration ? <span className="duration">{fmtTime(thumb?.duration || meta.duration)}</span> : null}
      {!small && meta?.site && <span className="site-badge">{meta.site}</span>}
      {isWatched(progress) && <span className="watched">WATCHED</span>}
      {r > 0 && <div className="progress"><div style={{ width: `${r * 100}%` }} /></div>}
    </div>
  )
}

/** "1.2M views · 3 years ago" when the video has metadata, else size · modified. */
export function metaLine(video, meta) {
  const parts = []
  if (meta?.views != null) parts.push(`${fmtCount(meta.views)} views`)
  if (meta?.date) parts.push(fmtAgo(Date.parse(meta.date)))
  return parts.length ? parts.join(' · ') : `${fmtSize(video.size)} · ${fmtAgo(video.lastModified)}`
}

export default function VideoCard({ video, thumb, progress, onNeedThumb, meta }) {
  const title = meta?.title || video.title
  const channel = meta?.channel || folderLabel(video.folder)
  return (
    <a className="card" href={`#/watch?${new URLSearchParams({ v: video.id })}`}>
      <Thumb video={video} thumb={thumb} progress={progress} onNeed={onNeedThumb} meta={meta} />
      <div className="card-body">
        <div className="avatar">{channel.slice(0, 1).toUpperCase()}</div>
        <div>
          <div className="card-title" title={title}>{title}</div>
          <div
            className="card-meta link"
            onClick={(e) => { e.preventDefault(); nav('/', { folder: video.folder }) }}
            title={`Folder: ${video.folder}`}
          >
            {channel}
          </div>
          <div className="card-meta">{metaLine(video, meta)}</div>
        </div>
      </div>
    </a>
  )
}
