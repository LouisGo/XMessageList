import { describe, expect, it } from 'vitest'
import type { E2EEvidence } from '../e2eBridge'
import {
  E2E_P0_SCENARIO_DEFINITIONS,
  getE2EP0ScenarioDefinition,
} from '../e2eP0Scenarios'
import {
  expectAnchorPreserved,
  expectBottomLocked,
  expectNoFollowWhenUserReading,
  expectRuntimeIdle,
} from '../e2eOracles'
import { getE2EScenarioDefinition } from '../e2eScenarioRegistry'

describe('e2e deterministic oracles', () => {
  it('checks runtime idle from evidence only', () => {
    expect(expectRuntimeIdle(createEvidence()).ok).toBe(true)

    const result = expectRuntimeIdle(createEvidence({
      runtime: {
        transactionState: 'active',
      },
    }))

    expect(result).toMatchObject({
      ok: false,
      oracleId: 'expectRuntimeIdle',
    })
    expect(result.details?.failures).toContain('transaction state is active')
  })

  it('checks bottom lock without visual guessing', () => {
    expect(expectBottomLocked(createEvidence()).ok).toBe(true)

    const result = expectBottomLocked(createEvidence({
      runtime: {
        bottomLockState: 'UNLOCKED',
      },
      viewport: {
        distanceToBottom: 24,
      },
      ui: {
        followBottomVisible: true,
      },
    }))

    expect(result.ok).toBe(false)
    expect(result.details?.failures).toEqual([
      'bottom lock is UNLOCKED',
      'distance to bottom 24 exceeds 1',
      'follow bottom affordance is visible',
    ])
  })

  it('checks anchor preservation with a pixel tolerance', () => {
    const before = createEvidence({
      anchors: {
        current: createAnchor('feed-runtime-m-42', 12),
      },
    })
    const after = createEvidence({
      anchors: {
        current: createAnchor('feed-runtime-m-42', 12.5),
      },
    })

    expect(expectAnchorPreserved(before, after, { tolerancePx: 1 }).ok).toBe(true)

    const failed = expectAnchorPreserved(before, createEvidence({
      anchors: {
        current: createAnchor('feed-runtime-m-42', 20),
      },
    }))

    expect(failed.ok).toBe(false)
    expect(failed.details?.deltaPx).toBe(8)
  })

  it('checks that append does not steal a user reading position', () => {
    const before = createEvidence({
      runtime: {
        bottomLockState: 'UNLOCKED',
      },
      anchors: {
        current: createAnchor('feed-runtime-m-42', 12),
      },
      viewport: {
        distanceToBottom: 300,
      },
    })
    const after = createEvidence({
      runtime: {
        bottomLockState: 'UNLOCKED',
      },
      anchors: {
        current: createAnchor('feed-runtime-m-42', 12),
      },
      viewport: {
        distanceToBottom: 320,
        visibleRows: [
          createVisibleRow('feed-runtime-m-42'),
          createVisibleRow('feed-runtime-m-43'),
        ],
      },
    })

    expect(expectNoFollowWhenUserReading(before, after).ok).toBe(true)

    const failed = expectNoFollowWhenUserReading(before, createEvidence({
      runtime: {
        bottomLockState: 'LOCKED',
      },
      viewport: {
        distanceToBottom: 0,
        visibleRows: [createVisibleRow('feed-runtime-m-80')],
      },
    }))

    expect(failed.ok).toBe(false)
    expect(failed.details?.failures).toContain('bottom lock is LOCKED')
  })
})

describe('P0 e2e scenario definitions', () => {
  it('defines only registered P0 host scenarios', () => {
    expect(E2E_P0_SCENARIO_DEFINITIONS.map((scenario) => scenario.id)).toEqual([
      'bootstrap.latest-bottom-lock',
      'paging.prepend-anchor-preservation',
      'bottom.user-scroll-up-append-no-follow',
    ])

    for (const scenario of E2E_P0_SCENARIO_DEFINITIONS) {
      expect(getE2EScenarioDefinition(scenario.id)).not.toBeNull()
      expect(getE2EP0ScenarioDefinition(scenario.id)).toBe(scenario)
      expect(scenario.priority).toBe('P0')
      expect(scenario.actionSteps[0]).toEqual({
        kind: 'reset',
        scenarioId: scenario.id,
      })
    }
  })
})

type EvidenceOverrides = Partial<
  Omit<E2EEvidence, 'runtime' | 'viewport' | 'ui' | 'events' | 'anchors'>
> & {
  runtime?: Partial<E2EEvidence['runtime']>
  viewport?: Partial<E2EEvidence['viewport']>
  ui?: Partial<E2EEvidence['ui']>
  events?: Partial<E2EEvidence['events']>
  anchors?: Partial<E2EEvidence['anchors']>
}

function createEvidence(overrides: EvidenceOverrides = {}): E2EEvidence {
  const base: E2EEvidence = {
    schemaVersion: 1,
    scenarioId: 'bootstrap.latest-bottom-lock',
    checkpointId: 'checkpoint',
    timestamp: 1,
    feed: {
      activeFeedId: 'feed-runtime',
      generation: 1,
      dataRevision: 2,
      projectionRevision: 2,
      messageCount: 80,
      loadedMessageCount: 20,
      hasMoreBefore: true,
      hasMoreAfter: false,
    },
    runtime: {
      state: 'READY',
      readySubstate: 'READY_IDLE',
      viewportPhase: 'IDLE',
      transactionState: 'idle',
      destinationState: 'idle',
      bottomLockState: 'LOCKED',
      pendingCommands: 0,
      motionActive: false,
      observedRows: 20,
      heightCacheSize: 20,
      lastScrollSource: null,
    },
    viewport: {
      scrollTop: 100,
      scrollHeight: 400,
      clientHeight: 300,
      distanceToBottom: 0,
      topSpacer: 10,
      bottomSpacer: 20,
      renderedRows: 1,
      visibleRows: [createVisibleRow('feed-runtime-m-80')],
    },
    anchors: {
      current: createAnchor('feed-runtime-m-80', 0),
    },
    ui: {
      feedLoading: false,
      loadingBefore: false,
      loadingAfter: false,
      eventStormRunning: false,
      botPushActive: false,
      dynamicHeightEnabled: false,
      pendingOperation: 'idle',
      lastEvent: 'idle',
      followBottomVisible: false,
    },
    events: {
      viewportAnchorChanged: [],
      needMoreBefore: 0,
      needMoreAfter: 0,
      destinationSettled: [],
      viewportErrors: [],
    },
    diagnostics: {
      recent: [],
    },
    console: {
      errors: [],
      warnings: [],
    },
  }

  return {
    ...base,
    ...overrides,
    runtime: {
      ...base.runtime,
      ...overrides.runtime,
    },
    viewport: {
      ...base.viewport,
      ...overrides.viewport,
    },
    ui: {
      ...base.ui,
      ...overrides.ui,
    },
    events: {
      ...base.events,
      ...overrides.events,
    },
    anchors: {
      ...base.anchors,
      ...overrides.anchors,
    },
  }
}

function createAnchor(messageId: string, top: number): NonNullable<
  E2EEvidence['anchors']['current']
> {
  return {
    messageId,
    serializedKey: `committed:${messageId}`,
    offsetWithinMessage: 0,
    top,
  }
}

function createVisibleRow(messageId: string): E2EEvidence['viewport']['visibleRows'][number] {
  return {
    messageId,
    serializedKey: `committed:${messageId}`,
    top: 0,
    bottom: 40,
    height: 40,
  }
}
