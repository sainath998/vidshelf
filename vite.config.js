import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// COOP/COEP make the page "cross-origin isolated", which lets the converter use all CPU cores.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  worker: { format: 'es' },
  server: { headers: isolation },
  preview: { headers: isolation },
})
