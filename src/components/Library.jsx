import { useEffect, useMemo, useRef, useState } from 'react'
import VideoCard from './VideoCard'
import { folderLabel, isWatched, ratio } from '../lib/format'

const PAGE = 120

export default function Library({
  videos, thumbs, metas = {}, progress, folder, query, rootName, roots, activeRoot, onSwitchRoot, onForgetRoot, onAddFolder,
  partialScan, onRescan, onNeedThumb,
}) {
  // Render cards in pages as you scroll, so huge folders stay fast.
  const [limit, setLimit] = useState(PAGE)
  const sentinel = useRef(null)
  useEffect(() => { setLimit(PAGE); window.scrollTo(0, 0) }, [folder, query])
  const folders = useMemo(() => {
    const map = new Map()
    for (const v of videos) {
      const f = map.get(v.folder) || { path: v.folder, count: 0, watched: 0 }
      f.count++
      if (isWatched(progress[v.id])) f.watched++
      map.set(v.folder, f)
    }
    return [...map.values()]
  }, [videos, progress])

  const shown = useMemo(() => {
    const q = query.toLowerCase()
    const hit = (v) => {
      if (!q) return true
      const m = metas[v.id]
      return [v.title, v.folder, m?.title, m?.channel, ...(m?.tags || [])].some((t) => t && t.toLowerCase().includes(q))
    }
    return videos.filter((v) => (!folder || v.folder === folder) && hit(v))
  }, [videos, metas, folder, query])

  const continueWatching = useMemo(() => {
    if (folder || query) return []
    return videos
      .filter((v) => ratio(progress[v.id]) > 0.01 && !isWatched(progress[v.id]))
      .sort((a, b) => progress[b.id].at - progress[a.id].at)
      .slice(0, 8)
  }, [videos, progress, folder, query])

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) setLimit((l) => l + PAGE) }, { rootMargin: '800px' })
    io.observe(el)
    return () => io.disconnect()
  })

  const heading = query ? `Results for “${query}”` : folder ? folderLabel(folder) : rootName

  return (
    <div className="layout">
      <aside className="sidebar">
        <a className={`side-item ${!folder && !query ? 'active' : ''}`} href="#/">
          <span>🏠 Home</span><span className="count">{videos.length.toLocaleString()}</span>
        </a>
        {(roots.length > 0 || onAddFolder) && (
          <>
            <div className="side-heading">Libraries</div>
            {roots.map((r, i) => (
              <div key={i} className={`side-item side-root ${i === activeRoot ? 'active' : ''}`} title={r.name}>
                <button className="side-root-btn" onClick={() => onSwitchRoot(i)}>
                  <span className="side-name">{i === activeRoot ? '📂' : '🗂️'} {r.name}</span>
                </button>
                <button className="x side-forget" onClick={() => onForgetRoot(i)} title="Remove from list (files are not touched)">✕</button>
              </div>
            ))}
            {onAddFolder && (
              <button className="side-item side-add" onClick={onAddFolder}><span>＋ Add folder</span></button>
            )}
          </>
        )}
        <div className="side-heading">Playlists</div>
        {folders.map((f) => (
          <a
            key={f.path}
            className={`side-item ${folder === f.path ? 'active' : ''}`}
            href={`#/?${new URLSearchParams({ folder: f.path })}`}
            title={f.path}
          >
            <span className="side-name">📁 {f.path.split('/').length > 2 ? '· ' : ''}{folderLabel(f.path)}</span>
            <span className="count">{f.watched}/{f.count}</span>
            <span className="side-progress"><span style={{ width: `${(f.watched / f.count) * 100}%` }} /></span>
          </a>
        ))}
      </aside>

      <main className="content">
        {partialScan && !folder && !query && (
          <div className="notice">
            Scan was stopped early, so only part of this folder is shown.
            <button className="btn ghost small" onClick={onRescan}>Scan everything</button>
          </div>
        )}
        {continueWatching.length > 0 && (
          <section>
            <h2>Continue watching</h2>
            <div className="grid">
              {continueWatching.map((v) => (
                <VideoCard key={v.id} video={v} thumb={thumbs[v.id]} meta={metas[v.id]} progress={progress[v.id]} onNeedThumb={onNeedThumb} />
              ))}
            </div>
          </section>
        )}
        <section>
          <h2>
            {heading} <span className="muted small">· {shown.length} videos</span>
            {folder && (
              <span className="muted small">
                {' '}· {folders.find((f) => f.path === folder)?.watched || 0} watched
              </span>
            )}
          </h2>
          {shown.length === 0 ? (
            <div className="empty">
              <p className="muted">{query || folder ? 'No videos match.' : 'No videos found in this folder.'}</p>
              {!query && !folder && <p className="muted small">Vidshelf looks for MP4, MKV, WebM, MOV, AVI and more, in every subfolder.</p>}
            </div>
          ) : (
            <div className="grid">
              {shown.slice(0, limit).map((v) => (
                <VideoCard key={v.id} video={v} thumb={thumbs[v.id]} meta={metas[v.id]} progress={progress[v.id]} onNeedThumb={onNeedThumb} />
              ))}
            </div>
          )}
          {shown.length > limit && <div ref={sentinel} className="load-more muted small"><span className="spinner" /> Loading more…</div>}
        </section>
      </main>
    </div>
  )
}
