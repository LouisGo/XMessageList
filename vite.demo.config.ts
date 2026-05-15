import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { demoLocalStorePlugin } from './tools/demoLocalStorePlugin'
import { demoStandaloneHtmlPlugin } from './tools/demoStandaloneHtmlPlugin'

// https://vite.dev/config/
export default defineConfig({
  publicDir: false,
  plugins: [demoLocalStorePlugin(), react(), demoStandaloneHtmlPlugin()],
  build: {
    outDir: 'dist-demo',
  },
})
