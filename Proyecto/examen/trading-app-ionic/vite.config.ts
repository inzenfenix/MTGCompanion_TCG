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
  }
})
