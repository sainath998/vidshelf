import FallbackPicker from './FallbackPicker'

export default function Landing({ status, scanInfo, onStopScan, onCancelScan, supportsPicker, storedName, onPick, onReopen, onFallbackFiles }) {
  return (
    <main className="landing">
      <div className="landing-card">
        <div className="landing-logo">▶ VideoShelf</div>
        <h1>Your video folders, YouTube-style.</h1>
        <p className="muted">
          Pick a folder and every video inside it becomes a browsable library with thumbnails,
          playlists, resume and progress tracking. <strong>Nothing is uploaded</strong> — your files never leave your device.
        </p>

        {status === 'scanning' ? (
          <div className="scan-box">
            <div className="scanning">
              <span className="spinner" />
              <span>Scanning… <strong>{scanInfo.videos.toLocaleString()}</strong> videos in {scanInfo.folders.toLocaleString()} folders</span>
            </div>
            <div className="scan-current muted small" title={scanInfo.current}>{scanInfo.current || ' '}</div>
            {scanInfo.folders > 300 && (
              <p className="hint">That’s a big folder. You can stop now and browse what’s found, or cancel and pick a smaller folder (e.g. Movies or Courses).</p>
            )}
            <div className="landing-actions">
              <button className="btn primary" onClick={onStopScan} disabled={!scanInfo.videos}>Stop &amp; show what’s found</button>
              <button className="btn ghost" onClick={onCancelScan}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="landing-actions">
            {status === 'needs-permission' && storedName && (
              <button className="btn primary big" onClick={onReopen}>Reopen “{storedName}”</button>
            )}
            {supportsPicker ? (
              <button className={`btn big ${status === 'needs-permission' ? 'ghost' : 'primary'}`} onClick={onPick}>
                {status === 'needs-permission' ? 'Choose a different folder' : 'Choose a video folder'}
              </button>
            ) : (
              <FallbackPicker className="btn primary big" label="Choose a video folder" onFiles={onFallbackFiles} />
            )}
            <a className="btn ghost big" href="#/download">⬇ Download from a link</a>
          </div>
        )}

        {supportsPicker && status !== 'scanning' && (
          <p className="hint">
            Chrome won’t open top-level folders like your home folder, Desktop or Documents.
            Pick a folder inside them instead, such as Desktop/Videos.
          </p>
        )}
        {!supportsPicker && (
          <p className="hint">
            Tip: in Chrome, Edge or Brave, VideoShelf remembers your folder between visits.
            In this browser you'll need to pick it each time.
          </p>
        )}
        <ul className="features">
          <li>🎞️ Auto thumbnails &amp; durations</li>
          <li>⏯️ Resume where you left off</li>
          <li>📂 Folders become playlists</li>
          <li>💬 Auto-loads .srt / .vtt subtitles</li>
          <li>⌨️ YouTube keyboard shortcuts</li>
          <li>🔒 100% offline &amp; private</li>
        </ul>
      </div>
    </main>
  )
}
