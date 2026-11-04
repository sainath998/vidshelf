import { ACCENTS, CARD_SIZES, CORNERS, DEFAULT_SETTINGS, FONT_SCALES, THEMES } from '../lib/settings'

const cap = (s) => s[0].toUpperCase() + s.slice(1)

function Segmented({ options, value, onChange }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o} className={value === o ? 'active' : ''} onClick={() => onChange(o)}>{cap(o)}</button>
      ))}
    </div>
  )
}

export default function SettingsModal({ settings, onChange, onClose }) {
  const set = (k) => (v) => onChange({ ...settings, [k]: v })
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings" onClick={(e) => e.stopPropagation()}>
        <button className="x close" onClick={onClose} aria-label="Close">✕</button>
        <h2>Appearance</h2>

        <div className="setting">
          <div className="setting-label">Theme</div>
          <div className="theme-grid">
            {Object.entries(THEMES).map(([key, t]) => (
              <button
                key={key}
                className={`theme-swatch ${settings.theme === key ? 'active' : ''}`}
                onClick={() => set('theme')(key)}
                style={{ background: t.bg, color: t.text, borderColor: settings.theme === key ? 'var(--accent)' : t.border }}
              >
                <span className="swatch-preview">
                  <span style={{ background: t.panel2 }} />
                  <span style={{ background: t.panel }} />
                  <span style={{ background: 'var(--accent)' }} />
                </span>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="setting">
          <div className="setting-label">Accent colour</div>
          <div className="accent-row">
            {Object.entries(ACCENTS).map(([key, c]) => (
              <button
                key={key}
                title={cap(key)}
                className={`accent-dot ${settings.accent === key ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => set('accent')(key)}
              />
            ))}
          </div>
        </div>

        <div className="setting">
          <div className="setting-label">Thumbnail size</div>
          <Segmented options={Object.keys(CARD_SIZES)} value={settings.cardSize} onChange={set('cardSize')} />
        </div>
        <div className="setting">
          <div className="setting-label">Corners</div>
          <Segmented options={Object.keys(CORNERS)} value={settings.corners} onChange={set('corners')} />
        </div>
        <div className="setting">
          <div className="setting-label">Text size</div>
          <Segmented options={Object.keys(FONT_SCALES)} value={settings.font} onChange={set('font')} />
        </div>

        <div className="setting setting-inline">
          <div>
            <div className="setting-label">Ambient glow</div>
            <div className="muted small">Soft light from the video spills around the player</div>
          </div>
          <label className="switch">
            <input type="checkbox" checked={settings.ambient} onChange={(e) => set('ambient')(e.target.checked)} />
            <span />
          </label>
        </div>

        <button className="btn ghost block" onClick={() => onChange({ ...DEFAULT_SETTINGS })}>Reset to default</button>
      </div>
    </div>
  )
}
