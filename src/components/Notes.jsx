import { useEffect, useState } from 'react'
import * as db from '../lib/db'
import { fmtTime } from '../lib/format'

export default function Notes({ video, playerRef, onNotes }) {
  const [notes, setNotes] = useState([])
  const [text, setText] = useState('')
  const key = `notes:${video.id}`

  useEffect(() => {
    let alive = true
    db.get(key).then((n) => alive && setNotes(n || [])).catch(() => {})
    return () => { alive = false }
  }, [key])

  useEffect(() => { onNotes?.(notes) }, [notes, onNotes])

  const persist = (next) => { setNotes(next); db.set(key, next).catch(() => {}) }

  const add = (e) => {
    e.preventDefault()
    const t = playerRef.current?.currentTime || 0
    persist([...notes, { t, text: text.trim() || 'Bookmark', at: Date.now() }].sort((a, b) => a.t - b.t))
    setText('')
  }

  const seek = (t) => { if (playerRef.current) { playerRef.current.currentTime = t; playerRef.current.play() } }

  const exportMd = () => {
    const md = `# ${video.title}\n\n_${video.folder}_\n\n` + notes.map((n) => `- **[${fmtTime(n.t)}]** ${n.text}`).join('\n') + '\n'
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }))
    a.download = `${video.title} - notes.md`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <section className="notes">
      <div className="notes-head">
        <strong>📝 Notes ({notes.length})</strong>
        {notes.length > 0 && <button className="btn ghost small" onClick={exportMd}>Export .md</button>}
      </div>
      <form onSubmit={add} className="note-form">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write a note — it's saved at the current timestamp (Enter)"
        />
        <button className="btn primary" type="submit">Add</button>
      </form>
      <ul className="note-list">
        {notes.map((n, i) => (
          <li key={n.at + '-' + i}>
            <button className="ts" onClick={() => seek(n.t)}>{fmtTime(n.t)}</button>
            <span className="note-text">{n.text}</span>
            <button className="x" onClick={() => persist(notes.filter((_, j) => j !== i))} aria-label="Delete note">✕</button>
          </li>
        ))}
      </ul>
    </section>
  )
}
