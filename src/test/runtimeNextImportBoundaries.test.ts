import { describe, expect, it } from 'vitest'
import rootEntrySource from '../index.ts?raw'
import runtimeNextRuntimeSource from '../runtime-next/MessageViewportRuntime.ts?raw'
import runtimeNextContractTestSource from '../runtime-next/__tests__/contractBoundaries.test.ts?raw'
import runtimeNextSemanticContractTestSource from '../runtime-next/__tests__/semanticContracts.test.ts?raw'
import runtimeNextCommandTypesSource from '../runtime-next/commands/types.ts?raw'
import runtimeNextDataModifiersSource from '../runtime-next/data/modifiers.ts?raw'
import runtimeNextDataTypesSource from '../runtime-next/data/types.ts?raw'
import runtimeNextDiagnosticTypesSource from '../runtime-next/diagnostics/types.ts?raw'
import runtimeNextEventTypesSource from '../runtime-next/events/types.ts?raw'
import runtimeNextGeometryInitialMetricsSource from '../runtime-next/geometry/initialMetrics.ts?raw'
import runtimeNextGeometryPublicationTypesSource from '../runtime-next/geometry/publication.types.ts?raw'
import runtimeNextGeometryTypesSource from '../runtime-next/geometry/types.ts?raw'
import runtimeNextIdentityTypesSource from '../runtime-next/identity/types.ts?raw'
import runtimeNextIndexSource from '../runtime-next/index.ts?raw'
import runtimeNextModuleStatusTypesSource from '../runtime-next/moduleStatus.types.ts?raw'
import runtimeNextProjectionCommitTokenSource from '../runtime-next/projection/commitToken.ts?raw'
import runtimeNextProjectionInitialSnapshotSource from '../runtime-next/projection/initialSnapshot.ts?raw'
import runtimeNextProjectionTypesSource from '../runtime-next/projection/types.ts?raw'
import runtimeNextScrollTypesSource from '../runtime-next/scroll/types.ts?raw'
import runtimeNextTypesSource from '../runtime-next/types.ts?raw'

const runtimeNextSources: ReadonlyArray<readonly [string, string]> = [
  ['src/runtime-next/MessageViewportRuntime.ts', runtimeNextRuntimeSource],
  ['src/runtime-next/__tests__/contractBoundaries.test.ts', runtimeNextContractTestSource],
  ['src/runtime-next/__tests__/semanticContracts.test.ts', runtimeNextSemanticContractTestSource],
  ['src/runtime-next/commands/types.ts', runtimeNextCommandTypesSource],
  ['src/runtime-next/data/modifiers.ts', runtimeNextDataModifiersSource],
  ['src/runtime-next/data/types.ts', runtimeNextDataTypesSource],
  ['src/runtime-next/diagnostics/types.ts', runtimeNextDiagnosticTypesSource],
  ['src/runtime-next/events/types.ts', runtimeNextEventTypesSource],
  ['src/runtime-next/geometry/initialMetrics.ts', runtimeNextGeometryInitialMetricsSource],
  ['src/runtime-next/geometry/publication.types.ts', runtimeNextGeometryPublicationTypesSource],
  ['src/runtime-next/geometry/types.ts', runtimeNextGeometryTypesSource],
  ['src/runtime-next/identity/types.ts', runtimeNextIdentityTypesSource],
  ['src/runtime-next/index.ts', runtimeNextIndexSource],
  ['src/runtime-next/moduleStatus.types.ts', runtimeNextModuleStatusTypesSource],
  ['src/runtime-next/projection/commitToken.ts', runtimeNextProjectionCommitTokenSource],
  ['src/runtime-next/projection/initialSnapshot.ts', runtimeNextProjectionInitialSnapshotSource],
  ['src/runtime-next/projection/types.ts', runtimeNextProjectionTypesSource],
  ['src/runtime-next/scroll/types.ts', runtimeNextScrollTypesSource],
  ['src/runtime-next/types.ts', runtimeNextTypesSource],
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

describe('runtime-next import boundaries', () => {
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

  it('keeps runtime-next out of the root package entry', () => {
    const violations = rootEntrySources
      .filter(([, source]) => /runtime-next/.test(source))
      .map(([path]) => path)

    expect(violations).toEqual([])
  })

  it('does not import through the root entry or package self-reference', () => {
    const productionSources = runtimeNextSources.filter(
      ([path]) => !path.includes('/__tests__/'),
    )
    const violations = productionSources
      .filter(([, source]) => rootOrPackageSelfReferencePattern.test(source))
      .map(([path]) => path)

    expect(violations).toEqual([])
  })

  it('does not use dynamic import in runtime-next production code', () => {
    const productionSources = runtimeNextSources.filter(
      ([path]) => !path.includes('/__tests__/'),
    )
    const violations = productionSources
      .filter(([, source]) => productionDynamicImportPattern.test(source))
      .map(([path]) => path)

    expect(violations).toEqual([])
  })
})
