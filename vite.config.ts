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
        'src/x-message-list/core/session-registry/index.ts',
        'src/x-message-list/core/session-registry/contracts/index.ts',
        'src/x-message-list/react/index.ts',
        'src/x-message-list/react/components/MessageList.tsx',
        'src/x-message-list/react/hooks/useMessageListSession.ts',
        'src/x-message-list/react/hooks/useMessageListState.ts',
        'src/x-message-list/react/types.ts',
      ],
      insertTypesEntry: true,
      tsconfigPath: './tsconfig.app.json',
    }),
  ],
  build: {
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
