import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const RUNTIME_DIR = path.join(ROOT, 'src', 'runtime')
const CODE_EXTENSIONS = new Set(['.ts', '.tsx'])
const LOGIC_BUDGET = 300
const CLASS_OR_REACT_BUDGET = 600
const ignoredSegments = new Set(['__tests__'])

const files = await collectRuntimeCodeFiles(RUNTIME_DIR)
const violations = []

for (const file of files) {
  const source = await readFile(file, 'utf8')
  const lines = countLines(source)
  const kind = getBudgetKind(file, source)
  const budget = kind === 'class-or-react' ? CLASS_OR_REACT_BUDGET : LOGIC_BUDGET

  if (lines > budget) {
    violations.push({
      file: path.relative(ROOT, file),
      lines,
      budget,
      kind,
    })
  }
}

if (violations.length > 0) {
  console.error('Runtime file budget violations:')
  for (const violation of violations) {
    console.error(
      `- ${violation.file}: ${violation.lines}/${violation.budget} (${violation.kind})`,
    )
  }
  process.exitCode = 1
}

async function collectRuntimeCodeFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    if (ignoredSegments.has(entry.name)) {
      continue
    }

    const absolute = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...await collectRuntimeCodeFiles(absolute))
      continue
    }

    if (entry.isFile() && CODE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(absolute)
    }
  }

  return files
}

function getBudgetKind(file, source) {
  if (path.extname(file) === '.tsx' || /\bclass\s+\w+/.test(source)) {
    return 'class-or-react'
  }

  return 'logic'
}

function countLines(source) {
  if (source.length === 0) {
    return 0
  }

  return source.endsWith('\n')
    ? source.split('\n').length - 1
    : source.split('\n').length
}
