import { describe, expect, it } from 'vitest'

const runtimeNextSources = import.meta.glob<string>(
  '../runtime-next/**/*.{ts,tsx}',
  {
    eager: true,
    import: 'default',
    query: '?raw',
  },
)

const rootEntrySources = import.meta.glob<string>('../index.ts', {
  eager: true,
  import: 'default',
  query: '?raw',
})

const deprecatedRuntimeImportPattern =
  /\b(?:import|export)\b[\s\S]*?\bfrom\s+['"][^'"]*runtime\.deprecated[^'"]*['"]|import\s*\(\s*['"][^'"]*runtime\.deprecated[^'"]*['"]\s*\)/

const oldReactAdapterImportPattern =
  /\b(?:import|export)\b[\s\S]*?\bfrom\s+['"](?:\.\.?\/)+react(?:\/[^'"]*)?['"]|import\s*\(\s*['"](?:\.\.?\/)+react(?:\/[^'"]*)?['"]\s*\)/

describe('runtime-next import boundaries', () => {
  it('does not import runtime.deprecated', () => {
    const violations = Object.entries(runtimeNextSources)
      .filter(([, source]) => deprecatedRuntimeImportPattern.test(source))
      .map(([path]) => path)

    expect(violations).toEqual([])
  })

  it('does not import the old src/react adapter', () => {
    const violations = Object.entries(runtimeNextSources)
      .filter(([, source]) => oldReactAdapterImportPattern.test(source))
      .map(([path]) => path)

    expect(violations).toEqual([])
  })

  it('keeps runtime-next out of the root package entry', () => {
    const violations = Object.entries(rootEntrySources)
      .filter(([, source]) => /runtime-next/.test(source))
      .map(([path]) => path)

    expect(violations).toEqual([])
  })
})
