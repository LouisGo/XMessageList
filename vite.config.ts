import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { demoLocalStorePlugin } from './tools/demoLocalStorePlugin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    demoLocalStorePlugin(),
    react(),
    dts({
      entryRoot: 'src',
      include: [
        'src/index.ts',
        'src/x-message-list/**/*.ts',
        'src/x-message-list/**/*.tsx',
      ],
      exclude: [
        'src/x-message-list/**/__tests__/**',
        'src/x-message-list/**/*.test.ts',
        'src/x-message-list/**/*.test.tsx',
      ],
      insertTypesEntry: true,
      tsconfigPath: './tsconfig.app.json',
    }),
  ],
  build: {
    copyPublicDir: false,
    lib: {
      entry: {
        index: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      },
      formats: ['es', 'cjs'],
      name: 'XMessageList',
      fileName: (format) => {
        return format === 'es' ? 'x-message-list.js' : 'x-message-list.cjs'
      },
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'use-sync-external-store/with-selector',
      ],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react/jsx-runtime': 'jsxRuntime',
          'use-sync-external-store/with-selector': 'useSyncExternalStoreWithSelector',
        },
      },
    },
  },
})
