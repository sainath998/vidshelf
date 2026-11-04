import { useState } from 'react'

export default function CopyBox({ text }) {
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
