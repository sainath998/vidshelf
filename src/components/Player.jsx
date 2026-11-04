import { useEffect, useMemo, useRef, useState } from 'react'
import { nav } from '../nav'
import { toVtt } from '../lib/srt'
import { fmtAgo, fmtSize, fmtTime, folderLabel } from '../lib/format'
import { Thumb } from './VideoCard'
import Notes from './Notes'
import ConvertDialog from './ConvertDialog'
import { getSavedInBrowser } from '../lib/convert'
import PlayerControls, { RATES } from './PlayerControls'
import Icon from './Icon'
import Description from './Description'
import { fmtCount } from '../lib/meta'

const SAFE_AUDIO_EXT = ['mp4', 'webm'] // others may play video but have unsupported audio (AC3/DTS…)

export default function Player({ video, videos, thumbs, metas = {}, progress, onProgress, canSaveNextTo, rootHandle, onConverted, ambient, onNeedThumb }) {
  const ref = useRef(null)
  const stageRef = useRef(null)
  const ambientRef = useRef(null)
  const [videoEl, setVideoEl] = useState(null)
  const [theater, setTheater] = useState(() => localStorage.getItem('vidshelf.theater') === 'true')
  const [ended, setEnded] = useState(false)
  const [markers, setMarkers] = useState([])
  const [now, setNow] = useState(0)
  const meta = metas[video.id]
  const title = meta?.title || video.title
  const channel = meta?.channel || folderLabel(video.folder)
  useEffect(() => { onNeedThumb?.(video) }, [video, onNeedThumb])
  useEffect(() => {
    const prev = document.title
    document.title = `${title} — Vidshelf`
    return () => { document.title = prev }
  }, [title])
  const seekTo = (t) => {
    const el = ref.current
    if (!el) return
    el.currentTime = t
    el.play()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const [src, setSrc] = useState(null)
  const [subUrl, setSubUrl] = useState(null)
  const [error, setError] = useState(null)
  const [rate, setRate] = useState(() => Number(localStorage.getItem('vidshelf.rate')) || 1)
  const [autoplay, setAutoplay] = useState(() => localStorage.getItem('vidshelf.autoplay') !== 'false')
  const [flash, setFlash] = useState(null)
  const [showConvert, setShowConvert] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [issue, setIssue] = useState(null) // null | 'nosound' | 'nopicture'
  // A converted copy (next to the original, or saved in the browser) plays instead of the original.
  const [resolved, setResolved] = useState(null) // { file, converted }
  const lastSave = useRef(0)
  const startProgress = useRef(progress[video.id]) // read once, for resume

  const queue = useMemo(() => videos.filter((v) => v.folder === video.folder), [videos, video.folder])
  const index = queue.findIndex((v) => v.id === video.id)
  const next = queue[index + 1]
  const prev = queue[index - 1]
  const goTo = (v) => v && nav('/watch', { v: v.id })

  useEffect(() => {
    let alive = true
    if (video.playFile) setResolved({ file: video.playFile, converted: true })
    else getSavedInBrowser(video).then((f) => alive && setResolved(f ? { file: f, converted: true } : { file: video.file, converted: false }))
    return () => { alive = false }
  }, [video])

  useEffect(() => {
    if (!resolved) return
    const url = URL.createObjectURL(resolved.file)
    setSrc(url)
    setError(null)
    setIssue(null)
    return () => URL.revokeObjectURL(url)
  }, [resolved])

  useEffect(() => {
    if (!video.subs) return
    let url
    let cancelled = false
    video.subs.text().then((text) => {
      if (cancelled) return
      url = URL.createObjectURL(new Blob([toVtt(text, video.subs.name)], { type: 'text/vtt' }))
      setSubUrl(url)
    })
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [video])

  useEffect(() => localStorage.setItem('vidshelf.rate', rate), [rate])

  useEffect(() => localStorage.setItem('vidshelf.autoplay', autoplay), [autoplay])
  useEffect(() => {
    localStorage.setItem('vidshelf.theater', theater)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [theater])

  // Ambient glow: paint a tiny copy of the current frame behind the player, blurred by CSS.
  useEffect(() => {
    if (!ambient || !videoEl) return
    const c = ambientRef.current
    const ctx = c?.getContext('2d')
    if (!ctx) return
    const paint = () => { if (videoEl.readyState >= 2 && videoEl.videoWidth) ctx.drawImage(videoEl, 0, 0, c.width, c.height) }
    const t = setInterval(() => { if (!videoEl.paused) paint() }, 250)
    videoEl.addEventListener('seeked', paint)
    videoEl.addEventListener('loadeddata', paint)
    return () => { clearInterval(t); videoEl.removeEventListener('seeked', paint); videoEl.removeEventListener('loadeddata', paint) }
  }, [ambient, videoEl])

  const lastRate = useRef(rate !== 1 ? rate : null) // remembered speed for the S toggle

  const changeRate = (r) => {
    r = Math.round(Math.min(16, Math.max(0.1, r)) * 100) / 100
    if (ref.current) { ref.current.defaultPlaybackRate = r; ref.current.playbackRate = r }
    setRate(r)
    showFlash(`${r}x`)
  }

  const flashTimer = useRef(null)
  const showFlash = (text) => {
    setFlash(text)
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 700)
  }

  const save = () => {
    const el = ref.current
    if (el) onProgress(video.id, el.currentTime, el.duration)
  }

  // YouTube-style keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || showConvert) return
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = ref.current
      if (!el) return
      const seek = (d) => { el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + d)); showFlash(`${d > 0 ? '+' : ''}${d}s`) }
      const cur = el.playbackRate
      const up = RATES.find((r) => r > cur + 0.001)
      const down = [...RATES].reverse().find((r) => r < cur - 0.001)
      const handlers = {
        ' ': () => (el.paused ? el.play() : el.pause()),
        k: () => (el.paused ? el.play() : el.pause()),
        ArrowUp: () => { el.volume = Math.min(1, el.volume + 0.05); el.muted = false; showFlash(`Volume ${Math.round(el.volume * 100)}%`) },
        ArrowDown: () => { el.volume = Math.max(0, el.volume - 0.05); showFlash(`Volume ${Math.round(el.volume * 100)}%`) },
        j: () => seek(-10),
        l: () => seek(10),
        ArrowLeft: () => seek(-5),
        ArrowRight: () => seek(5),
        m: () => { el.muted = !el.muted; showFlash(el.muted ? 'Muted' : 'Unmuted') },
        f: () => (document.fullscreenElement ? document.exitFullscreen() : stageRef.current?.requestFullscreen()),
        t: () => setTheater((x) => !x),
        c: () => { const t = el.textTracks[0]; if (t) { t.mode = t.mode === 'showing' ? 'hidden' : 'showing'; showFlash(`Subtitles ${t.mode === 'showing' ? 'on' : 'off'}`) } },
        N: () => goTo(next),
        P: () => goTo(prev),
        d: () => changeRate(cur + 0.1),
        a: () => changeRate(cur - 0.1),
        s: () => {
          if (Math.abs(cur - 1) > 0.001) { lastRate.current = cur; changeRate(1) }
          else if (lastRate.current) changeRate(lastRate.current)
        },
        '>': () => up && changeRate(up),
        '<': () => down && changeRate(down),
      }
      if (/^[0-9]$/.test(e.key) && el.duration) {
        e.preventDefault()
        el.currentTime = (el.duration * Number(e.key)) / 10
        return
      }
      const h = handlers[e.key]
      if (h) { e.preventDefault(); h() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className={`watch ${theater ? 'theater' : ''}`}>
      <div className="watch-main">
        <div className="stage-wrap">
        {ambient && !error && <canvas ref={ambientRef} className="ambient" width="32" height="18" aria-hidden="true" />}
        <div className="video-wrap" ref={stageRef}>
          {error ? (
            <div className="video-error">
              <p>⚠️ Your browser can't play this file directly{resolved?.converted ? ' (converted copy)' : ''}.</p>
              <p className="muted small">{error}</p>
              <p className="muted small">Vidshelf can convert it to a playable MP4 right here in your browser. You choose how.</p>
              <div className="controls">
                <button className="btn primary" onClick={() => setShowConvert(true)}>🛠 Make playable…</button>
                {next && <button className="btn ghost" onClick={() => goTo(next)}>Skip to next</button>}
              </div>
            </div>
          ) : (
            src && (
              <video
                ref={(el) => { ref.current = el; setVideoEl(el) }}
                src={src}
                autoPlay
                onPlay={() => setEnded(false)}
                onLoadedMetadata={(e) => {
                  const el = e.currentTarget
                  // Audio plays but the video codec isn't supported (e.g. H.263 in .3gp)
                  if (!resolved?.converted && el.videoWidth === 0 && el.duration > 0) setIssue('nopicture')
                  if (el.playbackRate === 1 && el.defaultPlaybackRate === 1 && rate !== 1) {
                    el.defaultPlaybackRate = rate
                    el.playbackRate = rate
                  } else if (el.playbackRate !== rate) {
                    setRate(el.playbackRate)
                  }
                  const p = startProgress.current
                  if (p && p.t > 5 && p.t < el.duration - 10) el.currentTime = p.t
                }}
                onRateChange={(e) => {
                  setRate(e.currentTarget.playbackRate)
                }}
                onTimeUpdate={(e) => {
                  setNow(e.currentTarget.currentTime)
                  if (Date.now() - lastSave.current > 3000) { lastSave.current = Date.now(); save() }
                }}
                onPause={save}
                onPlaying={(e) => {
                  const el = e.currentTarget
                  if (resolved?.converted || SAFE_AUDIO_EXT.includes(video.ext)) return
                  setTimeout(() => {
                    if (ref.current === el && !el.paused && el.webkitAudioDecodedByteCount === 0) setIssue((i) => i || 'nosound')
                  }, 4000)
                }}
                onEnded={() => {
                  const el = ref.current
                  onProgress(video.id, el.duration, el.duration)
                  if (autoplay && next) goTo(next)
                  else setEnded(true)
                }}
                onError={(e) => setError(e.currentTarget.error?.message || `Unsupported format (.${video.ext})`)}
              >
                {subUrl && <track kind="subtitles" src={subUrl} srcLang="en" label="Subtitles" default />}
              </video>
            )
          )}
          {!error && src && (
            <PlayerControls
              video={videoEl}
              stageRef={stageRef}
              src={src}
              rate={rate}
              onRate={changeRate}
              hasSubs={!!subUrl}
              onPrev={prev ? () => goTo(prev) : null}
              onNext={next ? () => goTo(next) : null}
              prevTitle={prev?.title}
              nextTitle={next?.title}
              autoplay={autoplay}
              onAutoplay={setAutoplay}
              theater={theater}
              onTheater={() => setTheater((x) => !x)}
              markers={markers}
              chapters={meta?.chapters || []}
              onSeekFlash={showFlash}
              ended={ended}
              onReplay={() => { const el = ref.current; if (el) { el.currentTime = 0; el.play() } setEnded(false) }}
            />
          )}
          {flash && <div className="flash">{flash}</div>}
          {issue && !error && (
            <div className="nosound">
              {issue === 'nopicture'
                ? "🖼️ No picture? This file's video format isn't supported by your browser."
                : "🔇 No sound? This file's audio format may not be supported."}
              <button className="btn primary small" onClick={() => setShowConvert(true)}>
                {issue === 'nopicture' ? 'Make playable…' : 'Fix audio…'}
              </button>
              <button className="x" onClick={() => setIssue(null)} aria-label="Dismiss">✕</button>
            </div>
          )}
        </div>
        </div>

        <h1 className="watch-title">{title}</h1>
        <div className="watch-meta">
          <a className="channel" href={`#/?${new URLSearchParams({ folder: video.folder })}`} title={`Folder: ${video.folder}`}>
            <span className="avatar">{channel.slice(0, 1).toUpperCase()}</span>
            <span>
              <strong>{channel}</strong>
              <span className="muted small block">
                {meta?.channel ? `in ${folderLabel(video.folder)}` : `${fmtSize(video.size)} · modified ${fmtAgo(video.lastModified)}`}
              </span>
            </span>
          </a>
          <div className="controls">
            {meta?.likes != null && <span className="pill" title={`${meta.likes.toLocaleString()} likes`}>👍 {fmtCount(meta.likes)}</span>}
            {meta?.url && (
              <a className="btn ghost" href={meta.url} target="_blank" rel="noreferrer" title={meta.url}>
                Open on {meta.site || 'source'} ↗
              </a>
            )}
            {resolved?.converted && <span className="tag" title="Playing the converted MP4">Converted</span>}
            {(error || issue) && (
              <button className="btn primary" onClick={() => setShowConvert(true)} title="Convert this file to a playable MP4">🛠 Fix playback</button>
            )}
            {next && (
              <button className="btn ghost" onClick={() => goTo(next)} title={next.title}>
                <Icon name="next" size={18} /> Next
              </button>
            )}
            <div className="more-wrap">
              <button className="btn ghost icon" onClick={() => setMoreOpen((o) => !o)} title="More" aria-label="More">⋯</button>
              {moreOpen && (
                <div className="more-menu" onMouseLeave={() => setMoreOpen(false)}>
                  <button onClick={() => { setMoreOpen(false); setShowConvert(true) }}>🛠 Convert to MP4 / fix playback…</button>
                  <button onClick={() => { setMoreOpen(false); navigator.clipboard.writeText(`${video.folder}/${video.name}`) }}>📋 Copy file path</button>
                </div>
              )}
            </div>
          </div>
        </div>

        <Description video={video} meta={meta} currentTime={now} onSeek={seekTo} />
        <Notes video={video} playerRef={ref} onNotes={setMarkers} />
        {showConvert && (
          <ConvertDialog
            video={video}
            canSaveNextTo={canSaveNextTo}
            rootHandle={rootHandle}
            onClose={() => setShowConvert(false)}
            onDone={(file) => {
              setShowConvert(false)
              setResolved({ file, converted: true })
              onConverted(video, file)
            }}
          />
        )}

        <details className="shortcuts">
          <summary>Keyboard shortcuts</summary>
          <div className="muted small">
            Space/K play · J/L ±10s · ←/→ ±5s · ↑/↓ volume · 0–9 jump · F fullscreen · T theater · M mute · C subtitles · Shift+N/P next/prev · / search · D / A speed ±0.1x · S toggle 1x ↔ last speed · Shift+. / , speed steps
          </div>
        </details>
      </div>

      <aside className="upnext">
        <div className="upnext-head">
          <div>
            <strong>{folderLabel(video.folder)}</strong>
            <div className="muted small">
              {index + 1} / {queue.length} · {queue.filter((v) => (progress[v.id]?.t || 0) / (progress[v.id]?.d || 1) >= 0.9).length} watched
            </div>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={autoplay} onChange={(e) => setAutoplay(e.target.checked)} /> Autoplay
          </label>
        </div>
        <div className="upnext-progress">
          <span style={{ width: `${(queue.filter((v) => (progress[v.id]?.t || 0) / (progress[v.id]?.d || 1) >= 0.9).length / queue.length) * 100}%` }} />
        </div>
        <div className="upnext-list">
          {queue.map((v, i) => (
            <a
              key={v.id}
              href={`#/watch?${new URLSearchParams({ v: v.id })}`}
              className={`upnext-item ${v.id === video.id ? 'current' : ''}`}
              ref={v.id === video.id ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
            >
              <span className="idx">{v.id === video.id ? '▶' : i + 1}</span>
              <Thumb video={v} thumb={thumbs[v.id]} meta={metas[v.id]} progress={progress[v.id]} small onNeed={onNeedThumb} />
              <span className="upnext-title">
                {metas[v.id]?.title || v.title}
                <span className="muted small block">{fmtTime(thumbs[v.id]?.duration)}</span>
              </span>
            </a>
          ))}
        </div>
      </aside>
    </div>
  )
}
