import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporaryRoot = mkdtempSync(join(tmpdir(), 'x-message-list-pack-'))

try {
  const packOutput = execFileSync(
    'npm',
    ['pack', '--json', '--pack-destination', temporaryRoot],
    { cwd: repositoryRoot, encoding: 'utf8' },
  )
  const [{ filename }] = JSON.parse(packOutput)
  const consumerRoot = join(temporaryRoot, 'consumer')
  const packageRoot = join(consumerRoot, 'node_modules', 'x-message-list')
  mkdirSync(packageRoot, { recursive: true })
  execFileSync(
    'tar',
    ['-xzf', join(temporaryRoot, filename), '-C', packageRoot, '--strip-components=1'],
    { stdio: 'inherit' },
  )

  for (const dependency of [
    'react',
    'react-dom',
    'use-sync-external-store',
    '@types/react',
    '@types/react-dom',
  ]) {
    const target = join(consumerRoot, 'node_modules', dependency)
    mkdirSync(dirname(target), { recursive: true })
    symlinkSync(join(repositoryRoot, 'node_modules', dependency), target, 'dir')
  }

  writeFileSync(
    join(consumerRoot, 'index.tsx'),
    `import { createMessageListSessionRegistry, MessageList } from 'x-message-list'\n` +
      `import type { MessageListAdapter, MessageListReloadCurrentResult } from 'x-message-list'\n\n` +
      `type Row = { id: string }\n` +
      `declare const adapter: MessageListAdapter<Row, string>\n` +
      `const registry = createMessageListSessionRegistry<Row, string>({\n` +
      `  getAdapter: () => adapter,\n` +
      `  defaults: { pageSize: 40 },\n` +
      `})\n` +
      `const session = registry.getSession('session')\n` +
      `const pending: Promise<MessageListReloadCurrentResult<Row>> = session.commands.reloadCurrent({ reason: 'structural' })\n` +
      `void pending\n` +
      `void <MessageList session={session} renderRow={({ row }) => row.id} />\n`,
  )
  writeFileSync(
    join(consumerRoot, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        jsx: 'react-jsx',
        strict: true,
        skipLibCheck: false,
        noEmit: true,
      },
      include: ['index.tsx'],
    }, null, 2),
  )

  execFileSync(
    join(repositoryRoot, 'node_modules', '.bin', 'tsc'),
    ['-p', join(consumerRoot, 'tsconfig.json')],
    { cwd: consumerRoot, stdio: 'inherit' },
  )

  const declarationFiles = readdirSync(join(packageRoot, 'dist'))
    .filter((file) => file.endsWith('.d.ts'))
  if (!declarationFiles.includes('index.d.ts')) {
    throw new Error('Packed package is missing dist/index.d.ts')
  }
  const declaration = readFileSync(join(packageRoot, 'dist', 'index.d.ts'), 'utf8')
  if (/from\s+['\"]@\//.test(declaration)) {
    throw new Error('Packed declaration contains a source alias import')
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
