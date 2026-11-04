import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

// Builds sw.js from src/sw.js with the list of files to save for offline use.
const serviceWorker = () => ({
  name: 'vidshelf-sw',
  apply: 'build',
  generateBundle(_, bundle) {
    const files = [...Object.keys(bundle), ...readdirSync('public').filter((f) => !f.startsWith('_'))]
      .filter((f) => !f.endsWith('.map') && f !== 'index.html')
      .map((f) => `./${f}`)
    const version = createHash('sha256').update(files.join()).digest('hex').slice(0, 10)
    const source = readFileSync('src/sw.js', 'utf8')
      .replace('__VERSION__', version)
      .replace('__PRECACHE__', JSON.stringify(files))
    this.emitFile({ type: 'asset', fileName: 'sw.js', source })
  },
})

// COOP/COEP make the page "cross-origin isolated", which lets the converter use all CPU cores.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  // Relative asset paths so the build works at any URL (e.g. GitHub Pages at /vidshelf/).
  base: './',
  plugins: [react(), serviceWorker()],
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  worker: { format: 'es' },
  server: { headers: isolation },
  preview: { headers: isolation },
})
