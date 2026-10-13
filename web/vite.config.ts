import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

// The server's version (from ../Cargo.toml), baked into the UI at build time.
function appVersion(): string {
  try {
    const toml = readFileSync(path.resolve(import.meta.dirname, '../Cargo.toml'), 'utf8')
    const m = /^version\s*=\s*"([^"]+)"/m.exec(toml)
    if (m) return m[1]
  } catch {
    /* not available */
  }
  return process.env.npm_package_version ?? '0.0.0'
}

export default defineConfig({
  base: '/',
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false },
    },
  },
  build: { outDir: 'dist' },
})
