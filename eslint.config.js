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
    files: [
      'vite.config.ts',
      'vitest.config.ts',
      'tools/**/*.ts',
      'e2e/runner/**/*.ts',
    ],
    extends: appTypeScriptRules,
    languageOptions: {
      globals: globals.node,
    },
  },
])
