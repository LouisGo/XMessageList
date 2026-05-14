import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { demoLocalStorePlugin } from './tools/demoLocalStorePlugin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [demoLocalStorePlugin(), react()],
  build: {
    outDir: 'dist-demo',
  },
})
