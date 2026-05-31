import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const RUNTIME_DIR = path.join(
  ROOT,
  'src',
  'x-message-list',
  'core',
  'runtime',
)
const CODE_EXTENSIONS = new Set(['.ts', '.tsx'])
const BUDGET_EXEMPT_DIRECTORIES = new Set(['__tests__'])
const LOGIC_BUDGET = 300
const CLASS_OR_REACT_BUDGET = 600

const files = await collectRuntimeCodeFiles(RUNTIME_DIR)
const violations = []

for (const file of files) {
  const source = await readFile(file, 'utf8')
  const lines = countLines(source)
  const kind = getBudgetKind(file, source)
  const budget = kind === 'logic' ? LOGIC_BUDGET : CLASS_OR_REACT_BUDGET

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
    const absolute = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      if (BUDGET_EXEMPT_DIRECTORIES.has(entry.name)) {
        continue
      }
      files.push(...await collectRuntimeCodeFiles(absolute))
      continue
    }

    if (
      entry.isFile() &&
      CODE_EXTENSIONS.has(path.extname(entry.name)) &&
      !isTestFile(entry.name)
    ) {
      files.push(absolute)
    }
  }

  return files
}

function getBudgetKind(file, source) {
  if (isReactComponentFile(file) || hasExportedClass(source, file)) {
    return 'class-or-react'
  }

  return 'logic'
}

function isTestFile(file) {
  return /\.(test|spec)\.tsx?$/.test(path.basename(file))
}

function isReactComponentFile(file) {
  return path.extname(file) === '.tsx'
}

function hasExportedClass(source, file) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.extname(file) === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

  return sourceFile.statements.some((statement) =>
    ts.isClassDeclaration(statement) && hasExportModifier(statement),
  )
}

function hasExportModifier(node) {
  return node.modifiers?.some((modifier) =>
    modifier.kind === ts.SyntaxKind.ExportKeyword ||
    modifier.kind === ts.SyntaxKind.DefaultKeyword,
  ) ?? false
}

function countLines(source) {
  if (source.length === 0) {
    return 0
  }

  return source.endsWith('\n')
    ? source.split('\n').length - 1
    : source.split('\n').length
}
