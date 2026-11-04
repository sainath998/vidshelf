import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import * as db from './lib/db'
import { scanHandle, scanFileList } from './lib/scan'
import { getCachedThumb, requestThumb, resetThumbQueue } from './lib/thumbs'
import Landing from './components/Landing'
import Library from './components/Library'
import Player from './components/Player'
import SettingsModal from './components/SettingsModal'
import { loadSettings, applySettings, saveSettings } from './lib/settings'
import FallbackPicker from './components/FallbackPicker'
import { nav } from './nav'
import { getSavedInBrowser } from './lib/convert'
import { getMeta } from './lib/meta'
import Downloader from './components/Downloader'
import * as downloads from './lib/downloads'

const supportsPicker = typeof window.showDirectoryPicker === 'function'

function useHashRoute() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const onChange = () => setHash(location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const [path, query] = hash.replace(/^#/, '').split('?')
  return { path: path || '/', params: new URLSearchParams(query || '') }
}

export default function App() {
  const route = useHashRoute()
  const [status, setStatus] = useState('idle') // idle | needs-permission | scanning | ready
  const [scanInfo, setScanInfo] = useState({ videos: 0, folders: 0, current: '' })
  const [partialScan, setPartialScan] = useState(false)
  const [roots, setRoots] = useState([]) // every folder the user has opened
  const [activeRoot, setActiveRoot] = useState(-1)
  const scanControl = useRef(null)
  const libraryLoaded = useRef(false)
  const [storedHandle, setStoredHandle] = useState(null)
  const [videos, setVideos] = useState([])
  const [thumbs, setThumbs] = useState({})
  const [metas, setMetas] = useState({})
  const [progress, setProgress] = useState({})
  const [libraryFromHandle, setLibraryFromHandle] = useState(false)
  const [settings, setSettings] = useState(loadSettings)
  const [showSettings, setShowSettings] = useState(false)
  useEffect(() => { applySettings(settings); saveSettings(settings) }, [settings])

  // ---- thumbnails (batched state updates) ----
  const pendingThumbs = useRef({})
  const flushTimer = useRef(null)
  const thumbUrls = useRef([])
  const applyThumb = useCallback((id, result) => {
    const url = result?.blob ? URL.createObjectURL(result.blob) : null
    if (url) thumbUrls.current.push(url)
    pendingThumbs.current[id] = { url, duration: result?.duration ?? null, unsupported: !!result?.unsupported }
    if (!flushTimer.current) {
      flushTimer.current = setTimeout(() => {
        const batch = pendingThumbs.current
        pendingThumbs.current = {}
        flushTimer.current = null
        setThumbs((t) => ({ ...t, ...batch }))
      }, 120)
    }
  }, [])

  // Thumbnails are made lazily: only for cards that scroll into view.
  const requestedThumbs = useRef(new Set())
  const loadThumbs = useCallback(() => {
    resetThumbQueue()
    thumbUrls.current.forEach(URL.revokeObjectURL)
    thumbUrls.current = []
    requestedThumbs.current = new Set()
    setThumbs({})
    setMetas({})
  }, [])
  // Metadata (title, channel, views, chapters…) from sidecar .info.json or tags inside the file.
  const pendingMetas = useRef({})
  const metaTimer = useRef(null)
  const applyMeta = useCallback((id, meta) => {
    pendingMetas.current[id] = meta
    if (!metaTimer.current) {
      metaTimer.current = setTimeout(() => {
        const batch = pendingMetas.current
        pendingMetas.current = {}
        metaTimer.current = null
        setMetas((m) => ({ ...m, ...batch }))
      }, 120)
    }
  }, [])
  const needThumb = useCallback(async (v) => {
    if (requestedThumbs.current.has(v.id)) return
    requestedThumbs.current.add(v.id)
    const meta = await getMeta(v).catch(() => null)
    if (meta?.hasAny) applyMeta(v.id, meta)
    // Use the real thumbnail (yt-dlp sidecar / embedded cover art) when there is one.
    if (meta?.cover && !v.playFile) {
      applyThumb(v.id, { blob: meta.cover, duration: meta.duration, unsupported: false })
      return
    }
    const cached = await getCachedThumb(v).catch(() => null)
    if (cached) applyThumb(v.id, cached)
    else requestThumb(v, (r) => applyThumb(v.id, r))
  }, [applyThumb, applyMeta])

  const showLibrary = useCallback(async (list) => {
    // Re-attach copies converted earlier and kept inside the browser.
    list = await Promise.all(
      list.map(async (v) => {
        if (v.playFile || v.ext === 'mp4' || v.ext === 'webm') return v
        const f = await getSavedInBrowser(v)
        return f ? { ...v, playFile: f } : v
      }),
    )
    setVideos(list)
    setStatus('ready')
    libraryLoaded.current = true
    loadThumbs()
    if (route.path === '/watch' && !list.some((v) => v.id === route.params.get('v'))) nav('/')
  }, [loadThumbs, route])

  // Remember every opened folder (shown in the sidebar under "Libraries").
  const rememberRoot = useCallback(async (handle) => {
    const list = (await db.get('roots').catch(() => null)) || []
    let idx = -1
    for (let i = 0; i < list.length; i++) if (await list[i].isSameEntry(handle)) { idx = i; break }
    if (idx === -1) { list.unshift(handle); idx = 0 }
    const trimmed = list.slice(0, 20)
    await db.set('roots', trimmed).catch(() => {})
    setRoots(trimmed)
    setActiveRoot(idx)
  }, [])

  const loadHandle = useCallback(async (handle) => {
    const control = { stop: false, cancel: false }
    scanControl.current = control
    setStatus('scanning')
    setScanInfo({ videos: 0, folders: 0, current: '' })
    try {
      const list = await scanHandle(handle, setScanInfo, control)
      if (scanControl.current !== control) return
      setPartialScan(control.stop)
      setLibraryFromHandle(true)
      setStoredHandle(handle)
      db.set('rootHandle', handle).catch(() => {})
      rememberRoot(handle)
      showLibrary(list)
    } catch (e) {
      if (scanControl.current !== control) return
      if (e.name === 'AbortError') setStatus(libraryLoaded.current ? 'ready' : 'idle')
      else { console.error(e); setStatus('needs-permission') }
    } finally {
      if (scanControl.current === control) scanControl.current = null
    }
  }, [showLibrary, rememberRoot])

  const stopScan = () => { if (scanControl.current) scanControl.current.stop = true }
  const cancelScan = () => { if (scanControl.current) scanControl.current.cancel = true }

  const switchRoot = async (handle) => {
    let perm = await handle.queryPermission({ mode: 'read' })
    if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'read' })
    if (perm !== 'granted') return
    nav('/')
    loadHandle(handle)
  }

  const forgetRoot = async (index) => {
    const list = roots.filter((_, i) => i !== index)
    await db.set('roots', list).catch(() => {})
    setRoots(list)
    setActiveRoot((a) => (a === index ? -1 : a > index ? a - 1 : a))
  }

  // ---- startup: restore progress + remembered folder ----
  useEffect(() => {
    ;(async () => {
      setProgress((await db.get('progress').catch(() => null)) || {})
      if (!supportsPicker) return
      const handle = await db.get('rootHandle').catch(() => null)
      const saved = (await db.get('roots').catch(() => null)) || (handle ? [handle] : [])
      setRoots(saved)
      if (!handle) return
      setStoredHandle(handle)
      if ((await handle.queryPermission({ mode: 'read' })) === 'granted') loadHandle(handle)
      else setStatus('needs-permission')
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pickFolder = async () => {
    try {
      const handle = await window.showDirectoryPicker({ id: 'vidshelf', mode: 'read' })
      nav('/')
      loadHandle(handle)
    } catch (e) {
      if (e.name !== 'AbortError') alert(e.message)
    }
  }

  const reopenFolder = async () => {
    if ((await storedHandle.requestPermission({ mode: 'read' })) === 'granted') loadHandle(storedHandle)
  }

  const onFallbackFiles = (files) => {
    nav('/')
    setLibraryFromHandle(false)
    setActiveRoot(-1)
    showLibrary(scanFileList(files))
  }

  // Re-scan the folder without leaving the current page (e.g. after a download finished).
  const rescan = useCallback(async () => {
    if (!storedHandle || !libraryFromHandle) return
    try { setPartialScan(false); showLibrary(await scanHandle(storedHandle)) } catch (e) { console.error(e) }
  }, [storedHandle, libraryFromHandle, showLibrary])
  useEffect(() => downloads.setOnSaved(() => rescan()), [rescan])
  const jobs = useSyncExternalStore(downloads.subscribe, downloads.getJobs)
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine)
  const activeDownloads = jobs.filter((j) => j.status === 'downloading').length
  const folders = useMemo(() => {
    const set = new Set(videos.map((v) => v.folder))
    if (storedHandle) set.add(storedHandle.name)
    return [...set].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
  }, [videos, storedHandle])

  // ---- watch progress (debounced persistence) ----
  const saveTimer = useRef(null)
  const updateProgress = useCallback((id, t, d) => {
    if (!Number.isFinite(d) || d <= 0) return
    setProgress((p) => {
      const next = { ...p, [id]: { t, d, at: Date.now() } }
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => db.set('progress', next).catch(() => {}), 500)
      return next
    })
  }, [])

  // A converted copy now exists: play it from now on and refresh its thumbnail.
  const onConverted = useCallback((video, file) => {
    const updated = { ...video, playFile: file }
    setVideos((list) => list.map((v) => (v.id === video.id ? updated : v)))
    requestedThumbs.current.add(video.id)
    requestThumb(updated, (r) => applyThumb(video.id, r))
  }, [applyThumb])

  const current = useMemo(
    () => (route.path === '/watch' ? videos.find((v) => v.id === route.params.get('v')) : null),
    [route, videos],
  )

  let page
  if (status !== 'ready' && status !== 'scanning' && route.path === '/download') {
    // Downloading works without a library: files go to the browser's Downloads folder.
    page = <Downloader folders={[]} root={null} canSaveToFolder={false} />
  } else if (status !== 'ready') {
    page = (
      <Landing
        status={status}
        scanInfo={scanInfo}
        onStopScan={stopScan}
        onCancelScan={cancelScan}
        supportsPicker={supportsPicker}
        storedName={storedHandle?.name}
        onPick={pickFolder}
        onReopen={reopenFolder}
        onFallbackFiles={onFallbackFiles}
      />
    )
  } else if (route.path === '/download') {
    page = (
      <Downloader
        folders={folders}
        root={storedHandle}
        canSaveToFolder={!!storedHandle && libraryFromHandle}
        onRescan={rescan}
      />
    )
  } else if (current) {
    page = (
      <Player
        key={current.id}
        video={current}
        videos={videos}
        thumbs={thumbs}
        metas={metas}
        progress={progress}
        onProgress={updateProgress}
        canSaveNextTo={!!storedHandle && libraryFromHandle}
        rootHandle={storedHandle}
        onConverted={onConverted}
        ambient={settings.ambient}
        onNeedThumb={needThumb}
      />
    )
  } else {
    page = (
      <Library
        videos={videos}
        thumbs={thumbs}
        metas={metas}
        progress={progress}
        folder={route.params.get('folder')}
        query={route.params.get('q') || ''}
        rootName={libraryFromHandle ? storedHandle?.name : videos[0]?.id.split('/')[0]}
        roots={roots}
        activeRoot={activeRoot}
        onSwitchRoot={(i) => switchRoot(roots[i])}
        onForgetRoot={forgetRoot}
        onAddFolder={supportsPicker ? pickFolder : null}
        partialScan={partialScan}
        onRescan={rescan}
        onNeedThumb={needThumb}
      />
    )
  }

  return (
    <div className="app">
      {status === 'ready' && (
        <header className="topbar">
          <a className="logo" href="#/">▶ VideoShelf</a>
          <SearchBox initial={route.params.get('q') || ''} />
          <div className="topbar-actions">
            <a className={`btn ghost ${route.path === '/download' ? 'active' : ''}`} href="#/download" title="Download videos from links">
              ⬇ Download{activeDownloads > 0 && <span className="badge">{activeDownloads}</span>}
            </a>
            {supportsPicker ? (
              <button className="btn ghost" onClick={pickFolder}>+ Open folder</button>
            ) : (
              <FallbackPicker className="btn ghost" label="+ Open folder" onFiles={onFallbackFiles} />
            )}
            <button className="btn ghost icon" onClick={() => setShowSettings(true)} title="Appearance">🎨</button>
          </div>
        </header>
      )}
      {page}
      {status !== 'ready' && (
        <button className="btn ghost icon floating-settings" onClick={() => setShowSettings(true)} title="Appearance">🎨</button>
      )}
      {!online && (
        <div className="offline-pill" title="Your videos, library and player all work offline. Downloading from links and the first “Make playable” need internet.">
          Offline · using the saved copy
        </div>
      )}
      {showSettings && <SettingsModal settings={settings} onChange={setSettings} onClose={() => setShowSettings(false)} />}
    </div>
  )
}

function subscribeOnline(cb) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => { window.removeEventListener('online', cb); window.removeEventListener('offline', cb) }
}

function SearchBox({ initial }) {
  const [q, setQ] = useState(initial)
  const inputRef = useRef(null)

  // "/" focuses search (like YouTube); Esc leaves it
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return
      e.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <form
      className="search"
      onSubmit={(e) => { e.preventDefault(); inputRef.current?.blur(); nav('/', q.trim() ? { q: q.trim() } : undefined) }}
    >
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
        placeholder="Search your videos  ( / )"
      />
      <button type="submit" aria-label="Search">⌕</button>
    </form>
  )
}
