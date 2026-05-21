import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: fileURLToPath(
        new URL('./src/runtime-next/index.ts', import.meta.url),
      ),
      formats: ['es'],
      fileName: () => 'runtime-next/index.js',
    },
    rollupOptions: {
      external: ['react', 'react/jsx-runtime'],
    },
  },
})
