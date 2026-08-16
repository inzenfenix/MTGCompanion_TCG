/// <reference types="vitest" />

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vitejs.dev/config/
//
// Sin @vitejs/plugin-legacy: esta app corre dentro de un WebView de
// Capacitor en Android (evergreen, basado en Chromium), no en navegadores
// legacy de escritorio. El plugin legacy generaba un segundo build entero
// con polyfills + fallback nomodule (duplicaba el tamaño de dist/, ver build
// log anterior) sin ningún beneficio para el target real de esta app.
export default defineConfig({
  plugins: [
    react(),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
    // `@techstark/opencv-js` (ROADMAP.md G4c) is CJS whose `module.exports`
    // is itself a thenable — Vitest's default SSR module transform mishandles
    // that shape (`TypeError: Method Promise.prototype.then called on
    // incompatible receiver [object Module]`, reproduced on a bare
    // `await import('@techstark/opencv-js')`, before any of this project's
    // own code runs). Plain Node ESM `import()` of the same package works
    // fine, so this is specifically a Vitest/Vite dep-transform quirk with
    // this package's shape, not a real interop bug — `deps.inline` forces
    // Vitest to process it like Vite's real bundler would instead of via
    // its own SSR externalization path, which resolves it.
    server: {
      deps: {
        inline: ['@techstark/opencv-js'],
      },
    },
  }
})
