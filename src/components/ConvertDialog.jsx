import { useEffect, useRef, useState } from 'react'
import { cancel, convert, convertedName, download, multiThreaded, probe, saveInBrowser, saveNextToOriginal } from '../lib/convert'
import { fmtSize, fmtTime } from '../lib/format'

const MODES = {
  remux: {
    title: 'Repackage',
    speed: 'Fastest · seconds',
    desc: 'Puts the same video and sound into an MP4. No quality loss.',
  },
  audio: {
    title: 'Fix audio',
    speed: 'Fast · ~1–3 min per hour of video',
    desc: 'Keeps the video as is, converts only the sound to AAC. Fixes “video plays but no sound”.',
  },
  full: {
    title: 'Full convert',
    speed: 'Slow · can take longer than the video itself',
    desc: 'Re-encodes everything to H.264 + AAC. Works for any file (AVI, WMV, DivX, MPEG-2…).',
  },
}

const PRESETS = { ultrafast: 'Fastest (bigger file)', veryfast: 'Balanced', medium: 'Best quality (slowest)' }
const HEIGHTS = { 0: 'Original', 1080: '1080p', 720: '720p', 480: '480p' }

function unavailableReason(mode, info) {
  if (!info) return null
  if (mode === 'remux' && !info.videoOk) return `Video codec “${info.video || 'unknown'}” can't play in browsers`
  if (mode === 'remux' && !info.audioOk) return `Audio codec “${info.audio}” can't play in browsers`
  if (mode === 'audio' && !info.videoOk) return `Video codec “${info.video || 'unknown'}” can't play in browsers`
  if (mode === 'audio' && !info.audio) return 'This file has no audio track'
  return null
}

export default function ConvertDialog({ video, canSaveNextTo, rootHandle, onClose, onDone }) {
  const [phase, setPhase] = useState('loading') // loading | choose | running | error
  const [status, setStatus] = useState('Preparing…')
  const [info, setInfo] = useState(null)
  const [mode, setMode] = useState('full')
  const [preset, setPreset] = useState('veryfast')
  const [maxHeight, setMaxHeight] = useState(0)
  const [dest, setDest] = useState(canSaveNextTo ? 'next' : 'browser')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState(null)
  const started = useRef(0)
  const cancelled = useRef(false)
  const [, tick] = useState(0)

  useEffect(() => {
    let alive = true
    probe(video.file, (s) => alive && setStatus(s))
      .then((i) => {
        if (!alive) return
        setInfo(i)
        setMode(i.recommended)
        setPhase('choose')
      })
      .catch((e) => { if (alive) { setError(e.message); setPhase('error') } })
    return () => { alive = false }
  }, [video])

  useEffect(() => {
    if (phase !== 'running') return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [phase])

  const start = async () => {
    // Ask for write access first, while we still have the user's click.
    if (dest === 'next') {
      const perm = await rootHandle.requestPermission({ mode: 'readwrite' })
      if (perm !== 'granted') { setDest('browser'); return }
    }
    cancelled.current = false
    setPhase('running')
    setProgress(0)
    started.current = Date.now()
    try {
      setStatus('Converting…')
      const data = await convert(video.file, mode, { preset, maxHeight: Number(maxHeight) || null, video: info.video }, info.duration, setProgress)
      setStatus('Saving…')
      let file
      if (dest === 'next') file = await saveNextToOriginal(rootHandle, video, data)
      else if (dest === 'browser') file = await saveInBrowser(video, data)
      else file = download(video, data)
      onDone(file)
    } catch (e) {
      if (cancelled.current) return
      setError(e.message || String(e))
      setPhase('error')
    }
  }

  const stop = () => {
    cancelled.current = true
    cancel()
    setPhase('choose')
    setStatus('Cancelled')
  }

  const elapsed = (Date.now() - started.current) / 1000
  const eta = progress > 0.02 ? elapsed / progress - elapsed : null
  const big = video.size > 2 * 1024 ** 3

  return (
    <div className="modal-backdrop" onClick={phase === 'running' ? undefined : onClose}>
      <div className="modal convert" onClick={(e) => e.stopPropagation()}>
        {phase !== 'running' && <button className="x close" onClick={onClose} aria-label="Close">✕</button>}
        <h2>Make playable</h2>
        <p className="muted small convert-file">{video.name} · {fmtSize(video.size)}</p>

        {phase === 'loading' && <div className="scanning"><span className="spinner" /> {status}</div>}

        {phase === 'error' && (
          <>
            <p className="error">Something went wrong.</p>
            <pre className="log">{error}</pre>
            <button className="btn ghost" onClick={onClose}>Close</button>
          </>
        )}

        {info && phase !== 'loading' && phase !== 'error' && (
          <>
            <div className="codec-row">
              <span className={`codec ${info.videoOk ? 'ok' : 'bad'}`}>Video: {info.video || 'none'}</span>
              <span className={`codec ${info.audioOk ? 'ok' : 'bad'}`}>Audio: {info.audio || 'none'}</span>
              {info.duration ? <span className="codec">{fmtTime(info.duration)}</span> : null}
            </div>
          </>
        )}

        {phase === 'choose' && info && (
          <>
            <div className="setting-label">How to convert</div>
            <div className="mode-list">
              {Object.entries(MODES).map(([key, m]) => {
                const reason = unavailableReason(key, info)
                return (
                  <label key={key} className={`mode ${mode === key ? 'active' : ''} ${reason ? 'disabled' : ''}`}>
                    <input type="radio" name="mode" disabled={!!reason} checked={mode === key} onChange={() => setMode(key)} />
                    <span>
                      <strong>{m.title}</strong>
                      {info.recommended === key && <span className="tag">Recommended</span>}
                      <span className="muted small block">{reason || m.desc}</span>
                      {!reason && <span className="small block speed">{m.speed}</span>}
                    </span>
                  </label>
                )
              })}
            </div>

            {mode === 'full' && (
              <div className="full-opts">
                <label>
                  <span className="setting-label">Speed / quality</span>
                  <select value={preset} onChange={(e) => setPreset(e.target.value)}>
                    {Object.entries(PRESETS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </label>
                <label>
                  <span className="setting-label">Max resolution</span>
                  <select value={maxHeight} onChange={(e) => setMaxHeight(e.target.value)}>
                    {Object.entries(HEIGHTS)
                      .filter(([h]) => !info.height || Number(h) === 0 || Number(h) < info.height)
                      .map(([h, l]) => <option key={h} value={h}>{l}</option>)}
                  </select>
                </label>
                <p className="muted small">Lower resolution converts much faster.</p>
              </div>
            )}

            <div className="setting-label">Save the playable copy</div>
            <div className="mode-list">
              <label className={`mode ${dest === 'next' ? 'active' : ''} ${canSaveNextTo ? '' : 'disabled'}`}>
                <input type="radio" name="dest" disabled={!canSaveNextTo} checked={dest === 'next'} onChange={() => setDest('next')} />
                <span>
                  <strong>Next to the original</strong>
                  <span className="muted small block">
                    {canSaveNextTo
                      ? `Saved as “${convertedName(video)}” in the same folder. Works on every device that opens this folder.`
                      : 'Needs Chrome, Edge or Brave (folder write access).'}
                  </span>
                </span>
              </label>
              <label className={`mode ${dest === 'browser' ? 'active' : ''}`}>
                <input type="radio" name="dest" checked={dest === 'browser'} onChange={() => setDest('browser')} />
                <span>
                  <strong>Inside this browser</strong>
                  <span className="muted small block">Your folder isn't touched. Lost if you clear browser data.</span>
                </span>
              </label>
              <label className={`mode ${dest === 'download' ? 'active' : ''}`}>
                <input type="radio" name="dest" checked={dest === 'download'} onChange={() => setDest('download')} />
                <span>
                  <strong>Download the file</strong>
                  <span className="muted small block">Saves an MP4 to your Downloads folder and plays it now.</span>
                </span>
              </label>
            </div>

            {big && <p className="warn small">⚠️ Files over 2 GB may run out of browser memory. If it fails, try Full convert at 720p.</p>}
            {status === 'Cancelled' && <p className="muted small">Cancelled.</p>}
            <div className="convert-actions">
              <span className="muted small">{multiThreaded() ? '⚡ Using all CPU cores' : 'Single-core mode'} · nothing is uploaded</span>
              <button className="btn primary" onClick={start}>Start</button>
            </div>
          </>
        )}

        {phase === 'running' && (
          <div className="running">
            <div className="bar"><div style={{ width: `${progress * 100}%` }} /></div>
            <div className="running-meta">
              <span>{status} {Math.round(progress * 100)}%</span>
              <span className="muted small">
                {fmtTime(elapsed)} elapsed{eta != null ? ` · ~${fmtTime(eta)} left` : ''}
              </span>
            </div>
            <p className="muted small">Keep this tab open. You can keep using your computer.</p>
            <button className="btn ghost" onClick={stop}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  )
}
