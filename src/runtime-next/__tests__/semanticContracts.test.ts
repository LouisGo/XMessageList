import { describe, expect, it } from 'vitest'
import implementationContractSource from '../../../docs/viewport-runtime/message-runtime-implementation-contract.md?raw'
import {
  type MessageDataSnapshot,
  type MessageRuntimeCommand,
  type RuntimeEventListener,
  type RuntimeListener,
  type ViewportDiagnosticRecord,
} from '../types'
import commandTypesSource from '../commands/types.ts?raw'
import componentReadmeSource from '../components/README.md?raw'
import dataModifiersSource from '../data/modifiers.ts?raw'
import dataTypesSource from '../data/types.ts?raw'

const forbiddenCommandKeys = [
  'topSpacer',
  'bottomSpacer',
  'naturalBlankHeight',
  'physicalWindowHeight',
  'segmentRevision',
  'renderRows',
  'scrollTop',
]

const nonGeometryOwnerSources: ReadonlyArray<readonly [string, string]> = [
  ['src/runtime-next/commands/types.ts', commandTypesSource],
  ['src/runtime-next/components/README.md', componentReadmeSource],
  ['src/runtime-next/data/modifiers.ts', dataModifiersSource],
  ['src/runtime-next/data/types.ts', dataTypesSource],
]

const geometryMutationFieldPattern =
  /\b(topSpacer|bottomSpacer|naturalBlankHeight|physicalWindowHeight|segmentRevision|renderRows|PhysicalScrollMetrics)\b/

describe('runtime-next P2 semantic contracts', () => {
  it('keeps command and data contracts semantic-only', () => {
    const command: MessageRuntimeCommand = {
      type: 'jump',
      target: {
        messageId: 'm-1',
      },
      origin: {
        messageId: 'm-0',
      },
    }
    const snapshot: MessageDataSnapshot<{ text: string }> = {
      feedId: 'feed',
      generation: 1,
      revision: 1,
      items: [
        {
          kind: 'committed',
          key: {
            kind: 'committed',
            messageId: 'm-1',
          },
          message: { text: 'hello' },
          version: 1,
          estimatedHeight: 48,
        },
      ],
      hasMoreBefore: false,
      hasMoreAfter: true,
      change: {
        kind: 'append',
        viewportModifier: 'append',
      },
    }

    expect(Object.keys(command)).not.toEqual(
      expect.arrayContaining(forbiddenCommandKeys),
    )
    expect(Object.keys(snapshot)).not.toEqual(
      expect.arrayContaining(forbiddenCommandKeys),
    )
    expect(implementationContractSource).toContain(
      "mode: 'latest' | 'unread' | 'restored'",
    )
    expect(implementationContractSource).toContain('origin?: MessageIdentityAnchor')
    expect(implementationContractSource).toContain('change.viewportModifier')
  })

  it('exports public contract type names used by the implementation contract', () => {
    const listener: RuntimeListener = () => undefined
    const eventListener: RuntimeEventListener = () => undefined
    const diagnostic: ViewportDiagnosticRecord = {
      id: 'diagnostic-1',
      severity: 'error',
      kind: 'geometry-owner-violation',
      message: 'geometry write surface is not owned by geometry',
    }

    eventListener({
      type: 'viewportReady',
      feedId: 'feed',
      generation: 1,
    })

    expect(listener()).toBeUndefined()
    expect(diagnostic.kind).toBe('geometry-owner-violation')
    expect(implementationContractSource).toContain('RuntimeListener')
    expect(implementationContractSource).toContain('RuntimeEventListener')
    expect(implementationContractSource).toContain('ViewportDiagnosticRecord')
    expect(implementationContractSource).toContain('MessageRuntimeCommand')
    expect(implementationContractSource).toContain('MessageDataSnapshot')
  })

  it('does not let non-geometry domains publish geometry mutation fields', () => {
    const violations = nonGeometryOwnerSources
      .filter(([, source]) => geometryMutationFieldPattern.test(source))
      .map(([path]) => path)

    expect(violations).toEqual([])
  })
})
