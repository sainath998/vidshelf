import { useEffect, useState, useSyncExternalStore } from 'react'
import * as dl from '../lib/downloads'
import { ytDlpCommand } from '../lib/fetcher'
import { fmtSize, fmtTime, folderLabel } from '../lib/format'
import { nav } from '../nav'

const BROWSER = '__browser__'

function CopyBox({ text }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="copybox">
      <code>{text}</code>
      <button
        className="btn ghost small"
        onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      >
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
    </div>
  )
}

function YtDlpHelp({ url, reason }) {
  return (
    <div className="dl-help">
      <p>{reason}</p>
      <p className="muted small">Run this on your computer instead (free, open-source <a href="https://github.com/yt-dlp/yt-dlp" target="_blank" rel="noreferrer">yt-dlp</a>), inside your Vidshelf folder:</p>
      <CopyBox text={ytDlpCommand(url)} />
      <p className="muted small">
        Install once: <code>brew install yt-dlp ffmpeg</code> (Mac) · <code>winget install yt-dlp</code> (Windows). Then click <strong>Rescan</strong> here and the video appears in your library.
      </p>
    </div>
  )
}

function speedText(job) {
  const p = job.progress
  if (!p || !job.startedAt) return ''
  const secs = (Date.now() - job.startedAt) / 1000
  const rate = secs > 0.5 ? p.bytes / secs : 0
  const parts = [fmtSize(p.bytes) + (p.total ? ` of ${fmtSize(p.total)}` : '')]
  if (rate) parts.push(`${fmtSize(rate)}/s`)
  if (p.fraction && p.fraction > 0.02 && p.fraction < 1) parts.push(`~${fmtTime(secs / p.fraction - secs)} left`)
  return parts.join(' · ')
}

function JobCard({ job, onStart }) {
  const { info } = job
  const host = (() => { try { return new URL(job.url).hostname } catch { return job.url } })()
  const kindLabel = {
    file: 'Video file', hls: 'HLS stream', page: 'Web page', platform: info?.platform, blocked: 'Blocked by server',
    dash: 'DASH stream', unknown: 'Not a video', error: 'Error',
  }[info?.kind]

  return (
    <div className={`dl-job ${job.status}`}>
      <div className="dl-job-head">
        <div className="dl-job-title">
          <span className="dl-host">{host}</span>
          {kindLabel && <span className="tag">{kindLabel}</span>}
          <a className="dl-url muted small" href={job.url} target="_blank" rel="noreferrer" title={job.url}>{job.url}</a>
        </div>
        <button className="x" onClick={() => dl.remove(job.id)} title="Remove">✕</button>
      </div>

      {job.status === 'checking' && <div className="muted small dl-row"><span className="spinner" /> Checking link…</div>}

      {job.status === 'error' && (
        <div className="dl-row">
          <span className="error small">{job.error}</span>
          <button className="btn ghost small" onClick={() => dl.retry(job.id)}>Retry</button>
        </div>
      )}

      {job.status === 'cancelled' && (
        <div className="dl-row"><span className="muted small">Cancelled.</span><button className="btn ghost small" onClick={() => dl.retry(job.id)}>Start over</button></div>
      )}

      {job.status === 'ready' && info && (
        <>
          {info.kind === 'platform' && (
            <YtDlpHelp url={job.url} reason={`${info.platform} hides and locks its video links, so no website can download them without its own server. Vidshelf has no server — everything runs on your computer.`} />
          )}
          {info.kind === 'blocked' && (
            <>
              <p className="small">This server doesn’t let websites read its files, so Vidshelf can’t save it into your library directly.</p>
              <div className="dl-row">
                <a className="btn primary" href={job.url} download target="_blank" rel="noreferrer">⬇ Download with browser</a>
                <span className="muted small">Saves to your Downloads folder (if the link is a file). Move it into your Vidshelf folder afterwards.</span>
              </div>
              <details className="dl-more"><summary className="muted small">It’s a video page, not a file?</summary><YtDlpHelp url={job.url} reason="" /></details>
            </>
          )}
          {info.kind === 'dash' && <YtDlpHelp url={job.url} reason="DASH (.mpd) streams aren’t supported in the browser yet." />}
          {info.kind === 'unknown' && <p className="muted small">This link isn’t a video ({info.type || 'unknown type'}).</p>}
          {info.kind === 'error' && (
            <div className="dl-row"><span className="error small">{info.message}</span><button className="btn ghost small" onClick={() => dl.retry(job.id)}>Retry</button></div>
          )}

          {info.kind === 'page' && (
            info.media.length ? (
              <div className="dl-media">
                <p className="small">Found {info.media.length} video link{info.media.length > 1 ? 's' : ''} on <strong>{info.title || 'this page'}</strong>. Pick one:</p>
                {info.media.map((m) => (
                  <div key={m.url} className="dl-media-item">
                    <span className="tag">{m.label}</span>
                    <span className="dl-url muted small" title={m.url}>{m.url}</span>
                    <button className="btn ghost small" onClick={() => dl.useMedia(job.id, m.url)}>Use this</button>
                  </div>
                ))}
              </div>
            ) : (
              <YtDlpHelp url={job.url} reason="No video links were found in this page (the site may load them with scripts)." />
            )
          )}

          {(info.kind === 'file' || info.kind === 'hls') && (
            <div className="dl-ready">
              <label className="dl-field grow">
                <span className="setting-label">File name</span>
                <input value={job.name} onChange={(e) => dl.setName(job.id, e.target.value)} />
              </label>
              {info.kind === 'hls' && info.variants.length > 1 && (
                <label className="dl-field">
                  <span className="setting-label">Quality</span>
                  <select value={job.variant} onChange={(e) => dl.setVariant(job.id, Number(e.target.value))}>
                    {info.variants.map((v, i) => (
                      <option key={v.uri} value={i}>
                        {v.height ? `${v.height}p` : `Option ${i + 1}`}{v.bandwidth ? ` · ${(v.bandwidth / 1e6).toFixed(1)} Mbps` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="dl-field">
                <span className="setting-label">{info.kind === 'file' ? (info.size ? fmtSize(info.size) : 'Size unknown') : 'Stream'}</span>
                <button className="btn primary" onClick={() => onStart(job)}>⬇ Download</button>
              </div>
            </div>
          )}
        </>
      )}

      {job.status === 'downloading' && (
        <div className="dl-progress">
          <div className={`bar ${job.progress?.fraction == null ? 'indeterminate' : ''}`}>
            <div style={{ width: `${(job.progress?.fraction ?? 0.3) * 100}%` }} />
          </div>
          <div className="dl-row">
            <span className="small">
              {job.progress?.fraction != null && <strong>{Math.round(job.progress.fraction * 100)}% </strong>}
              <span className="muted">{job.progress?.stage} · {speedText(job)}</span>
            </span>
            <button className="btn ghost small" onClick={() => dl.cancel(job.id)}>Cancel</button>
          </div>
        </div>
      )}

      {job.status === 'done' && (
        <div className="dl-row">
          <span className="small">✅ {job.savedPath ? <>Saved to <strong>{job.savedPath}</strong></> : <>Saved <strong>{job.filename}</strong> to your Downloads folder</>}</span>
          {job.savedPath && <button className="btn primary small" onClick={() => nav('/watch', { v: job.savedPath })}>▶ Play</button>}
        </div>
      )}
    </div>
  )
}

export default function Downloader({ folders, root, canSaveToFolder, onRescan }) {
  const jobs = useSyncExternalStore(dl.subscribe, dl.getJobs)
  const [text, setText] = useState('')
  const [target, setTarget] = useState(() => {
    const saved = localStorage.getItem('vidshelf.dlTarget')
    if (saved === BROWSER || !canSaveToFolder) return canSaveToFolder ? saved || folders[0] : BROWSER
    return folders.includes(saved) ? saved : folders[0]
  })
  const [, tick] = useState(0)
  const active = jobs.filter((j) => j.status === 'downloading').length
  // refresh speed / time-left text once a second while downloading
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [active])

  const chooseTarget = (t) => { setTarget(t); localStorage.setItem('vidshelf.dlTarget', t) }

  const add = (e) => {
    e?.preventDefault()
    if (dl.addLinks(text)) setText('')
  }

  const startJob = async (job) => {
    if (target !== BROWSER) {
      // Ask for write access while we still have the user's click.
      const perm = await root.requestPermission({ mode: 'readwrite' })
      if (perm !== 'granted') return alert('Vidshelf needs permission to save into your folder. You can choose “Downloads folder” instead.')
      dl.start(job.id, { type: 'folder', root, folder: target })
    } else {
      dl.start(job.id, { type: 'browser' })
    }
  }


  return (
    <main className="downloader">
      <div className="dl-head">
        <div>
          <h1>Download from a link</h1>
          <p className="muted">Paste links to video files, HLS streams (.m3u8) or pages with an embedded video. Downloads run in this tab — nothing goes through a server.</p>
        </div>
        <button className="btn ghost" onClick={onRescan} title="Look for new files in your folder">↻ Rescan</button>
      </div>

      <form className="dl-input" onSubmit={add}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) add(e) }}
          placeholder={'https://example.com/video.mp4\nhttps://example.com/stream/master.m3u8\n(one per line — Enter to add, Shift+Enter for a new line)'}
          rows={3}
        />
        <div className="dl-input-row">
          <label className="dl-field">
            <span className="setting-label">Save to</span>
            <select value={target} onChange={(e) => chooseTarget(e.target.value)}>
              {canSaveToFolder && folders.map((f) => (
                <option key={f} value={f}>📁 {f.includes('/') ? `${f.split('/')[0]} › ${f.split('/').slice(1).join(' › ')}` : folderLabel(f)}</option>
              ))}
              <option value={BROWSER}>⬇ Downloads folder (browser)</option>
            </select>
          </label>
          <button className="btn primary big" type="submit" disabled={!text.trim()}>Add links</button>
        </div>
        {!canSaveToFolder && <p className="muted small">Saving straight into your library needs Chrome, Edge or Brave with a picked folder.</p>}
      </form>

      <p className="muted small dl-legal">Only download videos you own or have permission to save. Respect each site’s terms and copyright.</p>

      {jobs.length > 0 && (
        <section className="dl-jobs">
          <div className="dl-jobs-head">
            <h2>Links {active > 0 && <span className="muted small">· {active} downloading</span>}</h2>
            {jobs.some((j) => ['done', 'cancelled', 'error'].includes(j.status)) && (
              <button className="btn ghost small" onClick={() => jobs.filter((j) => ['done', 'cancelled', 'error'].includes(j.status)).forEach((j) => dl.remove(j.id))}>Clear finished</button>
            )}
          </div>
          {jobs.map((j) => <JobCard key={j.id} job={j} onStart={startJob} />)}
        </section>
      )}
    </main>
  )
}
