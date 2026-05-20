import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

const appTypeScriptRules = [
  js.configs.recommended,
  tseslint.configs.recommended,
]

export default defineConfig([
  globalIgnores(['dist', '.logs']),
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      ...appTypeScriptRules,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['src/runtime-next/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: [
            '../runtime.deprecated',
            '../runtime.deprecated/*',
            '../../runtime.deprecated',
            '../../runtime.deprecated/*',
            '../../../runtime.deprecated',
            '../../../runtime.deprecated/*',
            '**/runtime.deprecated',
            '**/runtime.deprecated/*',
            '../react',
            '../react/*',
            '../../react',
            '../../react/*',
            '../../../react',
            '../../../react/*',
          ],
          message: 'runtime-next must not import deprecated runtime or old React adapter.',
        }],
      }],
    },
  },
  {
    files: ['vite.config.ts', 'vitest.config.ts', 'tools/**/*.ts'],
    extends: appTypeScriptRules,
    languageOptions: {
      globals: globals.node,
    },
  },
])
