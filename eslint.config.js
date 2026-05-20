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
        paths: [
          {
            name: '..',
            message: 'runtime-next must not import through the root entry.',
          },
          {
            name: '../..',
            message: 'runtime-next must not import through the root entry.',
          },
          {
            name: '../../..',
            message: 'runtime-next must not import through the root entry.',
          },
          {
            name: 'x-message-list',
            message: 'runtime-next must not import package self-reference.',
          },
        ],
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
            '../index',
            '../index.*',
            '../../index',
            '../../index.*',
            '../../../index',
            '../../../index.*',
            '../react',
            '../react/*',
            '../../react',
            '../../react/*',
            '../../../react',
            '../../../react/*',
            'x-message-list/*',
          ],
          message: 'runtime-next must not import deprecated runtime, old React adapter, root entry, or package self-reference.',
        }],
      }],
    },
  },
  {
    files: ['src/runtime-next/**/*.{ts,tsx}'],
    ignores: ['src/runtime-next/**/__tests__/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: 'ImportExpression',
        message: 'runtime-next production code must use static imports only.',
      }],
    },
  },
  {
    files: ['vite*.config.ts', 'vitest.config.ts', 'tools/**/*.ts'],
    extends: appTypeScriptRules,
    languageOptions: {
      globals: globals.node,
    },
  },
])
