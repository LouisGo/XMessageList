import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const INDEX_FILE = path.join(ROOT, 'src', 'index.ts')
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs'])
const NO_GOD_FILE_BUDGET = 600
const CHECKED_ROOTS = [
  path.join(ROOT, 'src'),
  path.join(ROOT, 'e2e', 'runner'),
  path.join(ROOT, 'tools'),
]
const RUNTIME_ROOT = path.join(ROOT, 'src', 'runtime')
const RUNTIME_INDEX = path.join(RUNTIME_ROOT, 'index.ts')
const RUNTIME_INTERNAL = path.join(RUNTIME_ROOT, 'internal.ts')
const RUNTIME_CONTROLLER_ROOT = path.join(RUNTIME_ROOT, 'controller')
const DATA_RUNTIME_INDEX = path.join(RUNTIME_ROOT, 'data', 'index.ts')
const FORBIDDEN_ROOT_EXPORTS = [
  'ProjectionCommitToken',
  'EdgeSnapshotState',
  'PendingIntent',
  'ShortSegmentAlignment',
  'ViewportPhase',
  'DOMRectLike',
  'MessageListRuntimeController',
  'MessageListAdapterRuntime',
  'RuntimeDomRegistry',
  'RuntimeMeasurement',
  'VisualAnchor',
]

const violations = []

await checkRootExports()
await checkNoGodFiles()
await checkImportGuards()
await checkRuntimeImportDirections()

if (violations.length > 0) {
  console.error('Public boundary violations:')
  for (const violation of violations) {
    console.error(`- ${violation}`)
  }
  process.exitCode = 1
}

async function checkRootExports() {
  const source = await readFile(INDEX_FILE, 'utf8')

  if (/\bexport\s+\*/.test(source)) {
    violations.push('src/index.ts must use explicit exports instead of export *')
  }

  for (const exportedName of FORBIDDEN_ROOT_EXPORTS) {
    const pattern = new RegExp(`\\b${escapeRegExp(exportedName)}\\b`)
    if (pattern.test(source)) {
      violations.push(`src/index.ts must not export private ${exportedName}`)
    }
  }
}

async function checkNoGodFiles() {
  const files = await collectCodeFiles(CHECKED_ROOTS)

  for (const file of files) {
    if (isGeneratedOrBuildOutput(file)) {
      continue
    }

    const source = await readFile(file, 'utf8')
    const lines = countLines(source)

    if (lines > NO_GOD_FILE_BUDGET) {
      violations.push(
        `${relative(file)} has ${lines} lines; split it below ${NO_GOD_FILE_BUDGET}`,
      )
    }
  }
}

async function checkImportGuards() {
  const files = await collectCodeFiles([
    path.join(ROOT, 'src', 'react'),
    path.join(ROOT, 'src', 'demo'),
    path.join(ROOT, 'src', 'e2e-app'),
    path.join(ROOT, 'e2e', 'runner'),
  ])

  for (const file of files) {
    if (isGeneratedOrBuildOutput(file) || isTestFile(file)) {
      continue
    }

    const source = await readFile(file, 'utf8')
    const specifiers = readModuleSpecifiers(source)

    for (const specifier of specifiers) {
      const target = await resolveLocalImport(file, specifier)

      if (!target) {
        continue
      }

      if (isUnder(file, path.join(ROOT, 'src', 'react'))) {
        guardReactImport(file, target)
        continue
      }

      guardDemoOrE2EImport(file, target)
    }
  }
}

async function checkRuntimeImportDirections() {
  const files = await collectCodeFiles([RUNTIME_ROOT])

  for (const file of files) {
    if (isGeneratedOrBuildOutput(file) || isTestFile(file)) {
      continue
    }

    const source = await readFile(file, 'utf8')
    const specifiers = readModuleSpecifiers(source)

    for (const specifier of specifiers) {
      const target = await resolveLocalImport(file, specifier)

      if (!target) {
        continue
      }

      guardRuntimeImport(file, target)
    }
  }
}

function guardRuntimeImport(file, target) {
  if (!isUnder(target, RUNTIME_CONTROLLER_ROOT)) {
    return
  }

  if (
    isUnder(file, RUNTIME_CONTROLLER_ROOT) ||
    file === RUNTIME_INDEX ||
    file === RUNTIME_INTERNAL
  ) {
    return
  }

  violations.push(
    `${relative(file)} must not import controller-domain module ${relative(target)}`,
  )
}

function guardReactImport(file, target) {
  if (!isUnder(target, RUNTIME_ROOT)) {
    return
  }

  if (target === RUNTIME_INDEX || target === RUNTIME_INTERNAL) {
    return
  }

  violations.push(
    `${relative(file)} must use runtime public/adapter-private barrels, not ${relative(target)}`,
  )
}

function guardDemoOrE2EImport(file, target) {
  if (!isUnder(target, RUNTIME_ROOT)) {
    return
  }

  if (target === RUNTIME_INDEX || target === DATA_RUNTIME_INDEX) {
    return
  }

  violations.push(
    `${relative(file)} must not import viewport runtime private module ${relative(target)}`,
  )
}

async function collectCodeFiles(roots) {
  const files = []

  for (const root of roots) {
    files.push(...await collectCodeFilesFrom(root))
  }

  return files.sort()
}

async function collectCodeFilesFrom(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...await collectCodeFilesFrom(absolute))
      continue
    }

    if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(absolute)
    }
  }

  return files
}

function readModuleSpecifiers(source) {
  const specifiers = []
  const importPattern =
    /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s*)?['"]([^'"]+)['"]/g

  for (const match of source.matchAll(importPattern)) {
    specifiers.push(match[1])
  }

  return specifiers
}

async function resolveLocalImport(file, specifier) {
  if (!specifier.startsWith('.')) {
    return null
  }

  const base = path.resolve(path.dirname(file), specifier)
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mjs`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    path.join(base, 'index.mjs'),
  ]

  for (const candidate of candidates) {
    if (await isFile(candidate)) {
      return candidate
    }
  }

  return null
}

async function isFile(file) {
  try {
    return (await stat(file)).isFile()
  } catch {
    return false
  }
}

function isUnder(file, directory) {
  const relativePath = path.relative(directory, file)
  return relativePath !== '' &&
    !relativePath.startsWith('..') &&
    !path.isAbsolute(relativePath)
}

function isGeneratedOrBuildOutput(file) {
  const relativePath = relative(file)
  return relativePath.startsWith('dist/') ||
    relativePath.startsWith('.logs/') ||
    relativePath.includes('/node_modules/')
}

function isTestFile(file) {
  const basename = path.basename(file)
  return basename.includes('.test.') ||
    basename.includes('.spec.') ||
    file.includes(`${path.sep}__tests__${path.sep}`)
}

function countLines(source) {
  if (source.length === 0) {
    return 0
  }

  return source.endsWith('\n')
    ? source.split('\n').length - 1
    : source.split('\n').length
}

function relative(file) {
  return path.relative(ROOT, file)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
