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
        'src/react/index.ts',
        'src/react/MessageList.tsx',
        'src/react/hooks.ts',
        'src/react/types.ts',
        'src/runtime/index.ts',
        'src/runtime/runtime.ts',
        'src/runtime/identity.ts',
        'src/runtime/segment.ts',
        'src/runtime/snapshot.ts',
        'src/runtime/events.ts',
        'src/runtime/options.ts',
      ],
      insertTypesEntry: true,
      tsconfigPath: './tsconfig.app.json',
    }),
  ],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'XMessageList',
      fileName: 'x-message-list',
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react/jsx-runtime': 'jsxRuntime',
        },
      },
    },
  },
})
