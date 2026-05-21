import { describe, expect, it } from 'vitest'
import rootEntrySource from '../index.ts?raw'

const runtimeNextSourceModules = import.meta.glob<string>(
  '../runtime-next/**/*.{ts,tsx}',
  {
    eager: true,
    import: 'default',
    query: '?raw',
  },
)

const runtimeNextSources: ReadonlyArray<readonly [string, string]> = [
  ...Object.entries(runtimeNextSourceModules)
    .map(([path, source]) => [
      path.replace('../runtime-next/', 'src/runtime-next/'),
      source,
    ] as const)
    .sort(([left], [right]) => compareSourcePaths(left, right)),
]

const rootEntrySources: ReadonlyArray<readonly [string, string]> = [
  ['src/index.ts', rootEntrySource],
]

const deprecatedRuntimeImportPattern =
  /\b(?:import|export)\b[\s\S]*?\bfrom\s+['"][^'"]*runtime\.deprecated[^'"]*['"]|import\s*\(\s*['"][^'"]*runtime\.deprecated[^'"]*['"]\s*\)/

const oldReactAdapterImportPattern =
  /\b(?:import|export)\b[\s\S]*?\bfrom\s+['"](?:\.\.?\/)+react(?:\/[^'"]*)?['"]|import\s*\(\s*['"](?:\.\.?\/)+react(?:\/[^'"]*)?['"]\s*\)/

const rootOrPackageSelfReferencePattern =
  /\b(?:import|export)\b[\s\S]*?\bfrom\s+['"](?:x-message-list(?:\/.*)?|\.\.|\.\.\/index|\.\.\/\.\.|\.\.\/\.\.\/index)['"]|import\s*\(\s*['"](?:x-message-list(?:\/.*)?|\.\.|\.\.\/index|\.\.\/\.\.|\.\.\/\.\.\/index)['"]\s*\)/

const productionDynamicImportPattern = /\bimport\s*\(|\bimport\.meta\b/

function isRuntimeNextProductionPath(path: string): boolean {
  return !path.includes('/__tests__/') && !path.endsWith('.test.ts')
}

function compareSourcePaths(left: string, right: string): number {
  return left.localeCompare(right)
}

describe('runtime-next import boundaries', () => {
  it('automatically covers every runtime-next TypeScript source', () => {
    const paths = runtimeNextSources.map(([path]) => path)

    expect(paths).toEqual([...paths].sort(compareSourcePaths))
    expect(paths.length).toBeGreaterThan(40)
    expect(paths).toEqual(
      expect.arrayContaining([
        'src/runtime-next/geometry/budget/heightBudget.ts',
        'src/runtime-next/geometry/measurement/measurementCorrection.ts',
        'src/runtime-next/geometry/segment/segmentRevision.ts',
        'src/runtime-next/geometry/window/rowSelection.ts',
        'src/runtime-next/geometry/window/rowSelectionRange.ts',
      ]),
    )
  })

  it('does not import runtime.deprecated', () => {
    const violations = runtimeNextSources
      .filter(([, source]) => deprecatedRuntimeImportPattern.test(source))
      .map(([path]) => path)

    expect(violations).toEqual([])
  })

  it('does not import the old src/react adapter', () => {
    const violations = runtimeNextSources
      .filter(([, source]) => oldReactAdapterImportPattern.test(source))
      .map(([path]) => path)

    expect(violations).toEqual([])
  })

  it('uses runtime-next as the root package entry', () => {
    expect(rootEntrySources[0]?.[1]).toContain(
      "export * from './runtime-next/index'",
    )
    expect(rootEntrySources[0]?.[1]).toContain('RuntimeNextMessageViewport')
  })

  it('does not import through the root entry or package self-reference', () => {
    const productionSources = runtimeNextSources.filter(([path]) =>
      isRuntimeNextProductionPath(path),
    )
    const violations = productionSources
      .filter(([, source]) => rootOrPackageSelfReferencePattern.test(source))
      .map(([path]) => path)

    expect(violations).toEqual([])
  })

  it('does not use dynamic import in runtime-next production code', () => {
    const productionSources = runtimeNextSources.filter(([path]) =>
      isRuntimeNextProductionPath(path),
    )
    const violations = productionSources
      .filter(([, source]) => productionDynamicImportPattern.test(source))
      .map(([path]) => path)

    expect(violations).toEqual([])
  })
})
