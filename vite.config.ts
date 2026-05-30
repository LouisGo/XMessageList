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
        'src/data.ts',
        'src/index.ts',
        'src/react/index.ts',
        'src/react/components/MessageList.tsx',
        'src/react/hooks/useMessageListSnapshot.ts',
        'src/react/types.ts',
        'src/runtime/index.ts',
        'src/runtime/controller/runtime.ts',
        'src/runtime/contracts/identity.ts',
        'src/runtime/contracts/segment.ts',
        'src/runtime/contracts/snapshot.ts',
        'src/runtime/contracts/events.ts',
        'src/runtime/contracts/options.ts',
        'src/runtime/data/index.ts',
        'src/runtime/data/dataRuntime.ts',
      ],
      insertTypesEntry: true,
      tsconfigPath: './tsconfig.app.json',
    }),
  ],
  build: {
    lib: {
      entry: {
        index: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        data: fileURLToPath(new URL('./src/data.ts', import.meta.url)),
      },
      formats: ['es', 'cjs'],
      name: 'XMessageList',
      fileName: (format, entryName) => {
        if (entryName === 'data') {
          return format === 'es' ? 'data.js' : 'data.cjs'
        }

        return format === 'es' ? 'x-message-list.js' : 'x-message-list.cjs'
      },
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
