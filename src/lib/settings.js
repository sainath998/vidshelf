// Appearance settings, stored in localStorage and applied as CSS variables.
export const THEMES = {
  dark:     { label: 'Dark',       bg: '#0f0f0f', panel: '#1a1a1a', panel2: '#272727', border: '#303030', text: '#f1f1f1', muted: '#aaaaaa', input: '#121212', scheme: 'dark' },
  light:    { label: 'Light',      bg: '#ffffff', panel: '#f2f2f2', panel2: '#e5e5e5', border: '#d9d9d9', text: '#0f0f0f', muted: '#606060', input: '#ffffff', scheme: 'light' },
  black:    { label: 'Pure Black', bg: '#000000', panel: '#0d0d0d', panel2: '#1a1a1a', border: '#242424', text: '#ffffff', muted: '#9a9a9a', input: '#000000', scheme: 'dark' },
  midnight: { label: 'Midnight',   bg: '#0b1220', panel: '#111a2e', panel2: '#1b2742', border: '#26355a', text: '#e6edf7', muted: '#8ea0bd', input: '#0d1626', scheme: 'dark' },
  forest:   { label: 'Forest',     bg: '#0e1612', panel: '#15211b', panel2: '#1f3027', border: '#2b4134', text: '#e3efe7', muted: '#93ab9c', input: '#0b130f', scheme: 'dark' },
  sepia:    { label: 'Sepia',      bg: '#f4ecd8', panel: '#ebe0c6', panel2: '#e0d3b4', border: '#d0c09a', text: '#3b2f1e', muted: '#7a6a50', input: '#fbf6ea', scheme: 'light' },
  slate:    { label: 'Slate',      bg: '#13161c', panel: '#1b1f27', panel2: '#262b35', border: '#333a47', text: '#e6e9ef', muted: '#9aa3b2', input: '#101318', scheme: 'dark' },
  ocean:    { label: 'Ocean',      bg: '#08151b', panel: '#0e2029', panel2: '#163039', border: '#21434f', text: '#dff1f6', muted: '#86aab5', input: '#061217', scheme: 'dark' },
  grape:    { label: 'Grape',      bg: '#140f1f', panel: '#1d162e', panel2: '#2a2041', border: '#3a2d58', text: '#efe9fb', muted: '#a99cc6', input: '#110c1b', scheme: 'dark' },
  mocha:    { label: 'Mocha',      bg: '#1a1411', panel: '#241c17', panel2: '#322720', border: '#46372c', text: '#f3e9e1', muted: '#b39d8c', input: '#15100d', scheme: 'dark' },
  ember:    { label: 'Ember',      bg: '#1a0f12', panel: '#25151a', panel2: '#341e25', border: '#4a2b35', text: '#fbe9ee', muted: '#c29aa8', input: '#160c0f', scheme: 'dark' },
  cyber:    { label: 'Neon',       bg: '#07070d', panel: '#0f0f1c', panel2: '#191930', border: '#2a2a50', text: '#e9e9ff', muted: '#8f8fc0', input: '#06060b', scheme: 'dark' },
  arctic:   { label: 'Arctic',     bg: '#eef3f8', panel: '#e1e9f2', panel2: '#d2deeb', border: '#bccbdc', text: '#1b2633', muted: '#5b6b7d', input: '#ffffff', scheme: 'light' },
  rose:     { label: 'Rose',       bg: '#fff5f7', panel: '#fde8ee', panel2: '#f8d7e1', border: '#efc2d0', text: '#3a1d27', muted: '#8a5b6a', input: '#ffffff', scheme: 'light' },
  mint:     { label: 'Mint',       bg: '#f3fbf7', panel: '#e3f4ec', panel2: '#d0eadf', border: '#b9dccb', text: '#14301f', muted: '#557566', input: '#ffffff', scheme: 'light' },
  contrast: { label: 'High Contrast', bg: '#000000', panel: '#000000', panel2: '#1c1c1c', border: '#ffffff', text: '#ffffff', muted: '#e6e6e6', input: '#000000', scheme: 'dark' },
}

export const ACCENTS = {
  red: '#ff3b3b', orange: '#ff8c1a', yellow: '#f5c518', green: '#2ecc71',
  teal: '#14c8b4', cyan: '#22d3ee', blue: '#3ea6ff', indigo: '#6366f1',
  purple: '#a970ff', pink: '#ff4fa3', lime: '#a3e635', white: '#e5e7eb',
}

export const CARD_SIZES = { compact: 210, comfortable: 280, large: 360 }
export const CORNERS = { rounded: 12, soft: 6, sharp: 0 }
export const FONT_SCALES = { small: 14, normal: 16, large: 18 }

const DEFAULTS = { theme: 'dark', accent: 'red', cardSize: 'comfortable', corners: 'rounded', font: 'normal', ambient: true }
const KEY = 'vidshelf.settings'

export function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) } } catch { return { ...DEFAULTS } }
}
export const saveSettings = (s) => localStorage.setItem(KEY, JSON.stringify(s))
export const DEFAULT_SETTINGS = DEFAULTS

export function applySettings(s) {
  const t = THEMES[s.theme] || THEMES.dark
  const root = document.documentElement.style
  for (const k of ['bg', 'panel', 'border', 'text', 'muted', 'input']) root.setProperty(`--${k}`, t[k])
  root.setProperty('--panel-2', t.panel2)
  root.setProperty('color-scheme', t.scheme)
  root.setProperty('--accent', ACCENTS[s.accent] || ACCENTS.red)
  root.setProperty('--card-min', `${CARD_SIZES[s.cardSize] ?? 280}px`)
  root.setProperty('--r', `${CORNERS[s.corners] ?? 12}px`)
  root.setProperty('font-size', `${FONT_SCALES[s.font] ?? 16}px`)
}
