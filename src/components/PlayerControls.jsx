import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { fmtTime } from '../lib/format'

export const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]

// Custom overlay controls for a <video>. Reads state straight from the element via events.
export default function PlayerControls({
  video, stageRef, src, rate, onRate, hasSubs, onPrev, onNext, prevTitle, nextTitle,
  autoplay, onAutoplay, theater, onTheater, markers, chapters = [], onSeekFlash, ended, onReplay,
}) {
  const [paused, setPaused] = useState(true)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [ccOn, setCcOn] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [idle, setIdle] = useState(false)
  const [menu, setMenu] = useState(false)
  const [pulse, setPulse] = useState(null) // big center icon after click
  const [hover, setHover] = useState(null) // { x, t }
  const [scrubbing, setScrubbing] = useState(false)
  const barRef = useRef(null)
  const previewVideo = useRef(null)
  const previewCanvas = useRef(null)
  const idleTimer = useRef(null)

  // ---- sync state from the <video> element ----
  useEffect(() => {
    if (!video) return
    const v = video
    const vol = Number(localStorage.getItem('vidshelf.volume'))
    if (!Number.isNaN(vol) && localStorage.getItem('vidshelf.volume') != null) v.volume = vol
    v.muted = localStorage.getItem('vidshelf.muted') === 'true'
    const sync = () => {
      setPaused(v.paused)
      setTime(v.currentTime)
      setDuration(Number.isFinite(v.duration) ? v.duration : 0)
      setVolume(v.volume)
      setMuted(v.muted)
      const b = v.buffered
      setBuffered(b.length ? b.end(b.length - 1) : 0)
    }
    const onWaiting = () => setWaiting(true)
    const onReady = () => setWaiting(false)
    const onVolume = () => {
      sync()
      localStorage.setItem('vidshelf.volume', v.volume)
      localStorage.setItem('vidshelf.muted', v.muted)
    }
    const events = ['play', 'pause', 'timeupdate', 'durationchange', 'progress', 'loadedmetadata', 'seeked']
    events.forEach((e) => v.addEventListener(e, sync))
    v.addEventListener('volumechange', onVolume)
    v.addEventListener('waiting', onWaiting)
    ;['playing', 'canplay', 'seeked'].forEach((e) => v.addEventListener(e, onReady))
    sync()
    return () => {
      events.forEach((e) => v.removeEventListener(e, sync))
      v.removeEventListener('volumechange', onVolume)
      v.removeEventListener('waiting', onWaiting)
      ;['playing', 'canplay', 'seeked'].forEach((e) => v.removeEventListener(e, onReady))
    }
  }, [video])

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === stageRef.current)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [stageRef])

  // Subtitle track on/off
  useEffect(() => {
    const t = video?.textTracks?.[0]
    if (t) t.mode = ccOn ? 'showing' : 'hidden'
  })

  // ---- auto-hide controls + cursor while playing ----
  const wake = () => {
    setIdle(false)
    clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setIdle(true), 2600)
  }
  useEffect(() => () => clearTimeout(idleTimer.current), [])
  const hidden = idle && !paused && !menu && !scrubbing && !ended

  // ---- actions ----
  const togglePlay = () => {
    if (!video) return
    if (ended) return onReplay()
    if (video.paused) video.play()
    else video.pause()
    setPulse(video.paused ? 'pause' : 'play')
    setTimeout(() => setPulse(null), 500)
  }
  const toggleMute = () => { if (video) video.muted = !video.muted }
  const setVol = (val) => {
    if (!video) return
    video.volume = val
    video.muted = val === 0
  }
  const toggleFullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : stageRef.current?.requestFullscreen())
  const togglePip = async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else await video?.requestPictureInPicture()
    } catch { /* not supported */ }
  }
  const skip = (d) => {
    if (!video) return
    video.currentTime = Math.max(0, Math.min(duration, video.currentTime + d))
    onSeekFlash?.(`${d > 0 ? '+' : ''}${d}s`)
  }

  // ---- progress bar: hover preview + scrubbing ----
  const timeAt = (clientX) => {
    const r = barRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(r.width, clientX - r.left))
    return { x, t: duration ? (x / r.width) * duration : 0, w: r.width }
  }
  const lastPreview = useRef(0)
  const showPreview = (t) => {
    const pv = previewVideo.current
    if (!pv || !src) return
    const now = performance.now()
    if (now - lastPreview.current < 80) return
    lastPreview.current = now
    pv.currentTime = t
  }
  const onBarMove = (e) => {
    const h = timeAt(e.clientX)
    setHover(h)
    showPreview(h.t)
    if (scrubbing && video) video.currentTime = h.t
  }
  const onBarDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setScrubbing(true)
    const { t } = timeAt(e.clientX)
    if (video) video.currentTime = t
  }
  const onBarUp = (e) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
    setScrubbing(false)
  }

  const pct = (v) => `${duration ? (v / duration) * 100 : 0}%`
  const volIcon = muted || volume === 0 ? 'volMute' : volume < 0.5 ? 'volLow' : 'volHigh'
  const shownTime = scrubbing && hover ? hover.t : time
  const chapterAt = (t) => { let c = null; for (const ch of chapters) if (ch.start <= t + 0.25) c = ch; return c }
  const currentChapter = chapterAt(shownTime)

  return (
    <div
      className={`pc ${hidden ? 'pc-hidden' : ''}`}
      onMouseMove={wake}
      onMouseLeave={() => setIdle(true)}
    >
      {/* click layer: play/pause, double-click fullscreen */}
      <div className="pc-click" onClick={() => { if (menu) setMenu(false); else togglePlay() }} onDoubleClick={toggleFullscreen} />

      {waiting && !paused && <div className="pc-spinner"><span className="spinner big" /></div>}
      {pulse && <div className="pc-pulse" key={pulse + time}><Icon name={pulse} size={40} /></div>}
      {paused && !ended && !waiting && time === 0 && (
        <button className="pc-bigplay" onClick={togglePlay} aria-label="Play"><Icon name="play" size={44} /></button>
      )}
      {ended && (
        <div className="pc-ended">
          <button className="pc-bigplay" onClick={onReplay} aria-label="Replay"><Icon name="replay" size={40} /></button>
          {nextTitle && (
            <button className="pc-upnext" onClick={onNext}>
              <span className="muted small">Up next</span>
              <strong>{nextTitle}</strong>
            </button>
          )}
        </div>
      )}

      <div className="pc-bottom">
        <div
          className={`pc-bar ${scrubbing ? 'active' : ''}`}
          ref={barRef}
          onPointerMove={onBarMove}
          onPointerDown={onBarDown}
          onPointerUp={onBarUp}
          onPointerLeave={() => !scrubbing && setHover(null)}
        >
          <div className="pc-track">
            <div className="pc-buffered" style={{ width: pct(buffered) }} />
            {hover && <div className="pc-hoverfill" style={{ width: `${hover.x}px` }} />}
            <div className="pc-played" style={{ width: pct(shownTime) }} />
            {chapters.filter((c) => c.start > 0.5).map((c, i) => (
              <span key={`c${i}`} className="pc-chapter-gap" style={{ left: pct(c.start) }} />
            ))}
            {markers.map((m, i) => (
              <span key={i} className="pc-marker" style={{ left: pct(m.t) }} title={m.text} />
            ))}
          </div>
          <div className="pc-thumb" style={{ left: pct(shownTime) }} />
          {hover && (
            <div className="pc-preview" style={{ left: Math.max(84, Math.min(hover.w - 84, hover.x)) }}>
              <canvas ref={previewCanvas} width="160" height="90" />
              {chapterAt(hover.t)?.title && <span className="pc-preview-chapter">{chapterAt(hover.t).title}</span>}
              <span>{fmtTime(hover.t)}</span>
            </div>
          )}
        </div>

        <div className="pc-row">
          <div className="pc-group">
            <button className="pc-btn" onClick={onPrev} disabled={!onPrev} title={prevTitle ? `Previous: ${prevTitle} (Shift+P)` : 'Previous'}><Icon name="prev" /></button>
            <button className="pc-btn pc-play" onClick={togglePlay} title={paused ? 'Play (k)' : 'Pause (k)'}>
              <Icon name={ended ? 'replay' : paused ? 'play' : 'pause'} size={30} />
            </button>
            <button className="pc-btn" onClick={onNext} disabled={!onNext} title={nextTitle ? `Next: ${nextTitle} (Shift+N)` : 'Next'}><Icon name="next" /></button>
            <button className="pc-btn hide-sm" onClick={() => skip(-10)} title="Back 10s (j)"><Icon name="rewind" size={22} /></button>
            <button className="pc-btn hide-sm" onClick={() => skip(10)} title="Forward 10s (l)"><Icon name="forward" size={22} /></button>
            <div className="pc-volume">
              <button className="pc-btn" onClick={toggleMute} title="Mute (m)"><Icon name={volIcon} /></button>
              <input
                type="range" min="0" max="1" step="0.01"
                value={muted ? 0 : volume}
                onChange={(e) => setVol(Number(e.target.value))}
                style={{ '--vol': `${(muted ? 0 : volume) * 100}%` }}
                aria-label="Volume"
              />
            </div>
            <span className="pc-time">{fmtTime(shownTime) || '0:00'} <span className="pc-time-sep">/</span> {fmtTime(duration) || '0:00'}</span>
            {currentChapter?.title && <span className="pc-chapter-name" title={currentChapter.title}>• {currentChapter.title}</span>}
          </div>

          <div className="pc-group">
            <label className="pc-switch" title="Autoplay next video">
              <input type="checkbox" checked={autoplay} onChange={(e) => onAutoplay(e.target.checked)} />
              <span className="pc-switch-track"><Icon name={autoplay ? 'play' : 'pause'} size={12} /></span>
            </label>
            {hasSubs && (
              <button className={`pc-btn ${ccOn ? 'on' : ''}`} onClick={() => setCcOn(!ccOn)} title="Subtitles (c)"><Icon name="cc" /></button>
            )}
            <div className="pc-menu-wrap">
              <button className="pc-btn pc-rate" onClick={() => setMenu(!menu)} title="Playback speed (a / s / d)">
                {Math.round(rate * 100) / 100}x
              </button>
              {menu && (
                <div className="pc-menu" onClick={(e) => e.stopPropagation()}>
                  <div className="pc-menu-head">
                    <span>Speed</span>
                    <span className="pc-stepper">
                      <button onClick={() => onRate(rate - 0.1)}>−</button>
                      <strong>{(Math.round(rate * 100) / 100).toFixed(2)}x</strong>
                      <button onClick={() => onRate(rate + 0.1)}>+</button>
                    </span>
                  </div>
                  {RATES.map((r) => (
                    <button key={r} className={`pc-menu-item ${Math.abs(r - rate) < 0.001 ? 'active' : ''}`} onClick={() => { onRate(r); setMenu(false) }}>
                      <span className="pc-check">{Math.abs(r - rate) < 0.001 && <Icon name="check" size={18} />}</span>
                      {r === 1 ? 'Normal' : `${r}x`}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {document.pictureInPictureEnabled && (
              <button className="pc-btn hide-sm" onClick={togglePip} title="Picture in picture"><Icon name="pip" /></button>
            )}
            {!fullscreen && (
              <button className={`pc-btn hide-sm ${theater ? 'on' : ''}`} onClick={onTheater} title="Theater mode (t)"><Icon name="theater" /></button>
            )}
            <button className="pc-btn" onClick={toggleFullscreen} title="Fullscreen (f)"><Icon name={fullscreen ? 'exitFullscreen' : 'fullscreen'} /></button>
          </div>
        </div>
      </div>

      {/* hidden twin video used to draw hover previews */}
      {src && (
        <video
          ref={previewVideo}
          src={src}
          muted
          preload="auto"
          className="pc-preview-src"
          onSeeked={(e) => {
            const c = previewCanvas.current
            const v = e.currentTarget
            if (!c || !v.videoWidth) return
            const ctx = c.getContext('2d')
            ctx.fillStyle = '#000'
            ctx.fillRect(0, 0, c.width, c.height)
            const s = Math.min(c.width / v.videoWidth, c.height / v.videoHeight)
            ctx.drawImage(v, (c.width - v.videoWidth * s) / 2, (c.height - v.videoHeight * s) / 2, v.videoWidth * s, v.videoHeight * s)
          }}
        />
      )}
    </div>
  )
}
