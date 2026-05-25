import { describe, expect, it } from 'vitest'
import type { E2EEvidence } from '../e2eBridge'
import {
  E2E_P0_SCENARIO_DEFINITIONS,
  getE2EP0ScenarioDefinition,
} from '../e2eP0Scenarios'
import {
  E2E_P1_SCENARIO_DEFINITIONS,
  getE2EP1ScenarioDefinition,
} from '../e2eP1Scenarios'
import {
  E2E_P2_SCENARIO_DEFINITIONS,
  getE2EP2ScenarioDefinition,
} from '../e2eP2Scenarios'
import {
  E2E_P3_SCENARIO_DEFINITIONS,
  getE2EP3ScenarioDefinition,
} from '../e2eP3Scenarios'
import {
  expectAnchorPreserved,
  expectActiveFeed,
  expectActionDurationWithin,
  expectBottomLocked,
  expectDestinationFallbackDeleted,
  expectDestinationSettledOnTarget,
  expectDestinationOutcomeRecorded,
  expectDiagnosticObserved,
  expectLatestMessageVisible,
  expectLoadedMessageCountDelta,
  expectFrameGapWithin,
  expectNeedMoreAfterWithin,
  expectNeedMoreBeforeWithin,
  expectNeedMessagesAroundObserved,
  expectNoCommittedRowsBeyondFeedMessageCount,
  expectNoFeedPollution,
  expectNoFollowWhenUserReading,
  expectNoLongTasks,
  expectNoOptimisticRows,
  expectNoUnexpectedErrors,
  expectNoWhiteScreen,
  expectRuntimeIdle,
  expectRuntimeAttachedOnce,
  expectSameVisibleOptimisticKey,
  expectVisibleOptimisticRow,
  expectVisibleRowsBelongToActiveFeed,
  expectViewportErrorObserved,
} from '../e2eOracles'
import {
  E2E_PERFORMANCE_SCENARIO_DEFINITIONS,
  getE2EPerformanceScenarioDefinition,
} from '../e2ePerformanceScenarios'
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

  it('checks unexpected console and viewport errors with an explicit allowlist', () => {
    expect(expectNoUnexpectedErrors(createEvidence()).ok).toBe(true)
    expect(
      expectNoUnexpectedErrors(
        createEvidence({
          events: {
            viewportErrors: ['commit-timeout-bootstrap'],
          },
        }),
        { allowedViewportErrors: ['commit-timeout-bootstrap'] },
      ).ok,
    ).toBe(true)

    const failed = expectNoUnexpectedErrors(createEvidence({
      console: {
        errors: [{ text: 'boom' }],
        warnings: [],
      },
      events: {
        viewportErrors: ['unexpected-runtime-error'],
      },
    }))

    expect(failed.ok).toBe(false)
    expect(failed.details?.failures).toEqual([
      'console errors is 1',
      'viewport errors: unexpected-runtime-error',
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

  it('checks P1 destination and feed-pollution helpers', () => {
    const destinationEvidence = createEvidence({
      runtime: {
        destinationState: 'settled',
      },
      ui: {
        highlightedMessageId: 'feed-runtime-m-80',
      },
      events: {
        destinationSettled: [{
          intent: 'jump',
          targetMessageId: 'feed-runtime-m-80',
          resolvedMessageId: 'feed-runtime-m-80',
          resolution: 'target',
        }],
      },
    })

    expect(expectLatestMessageVisible(createEvidence()).ok).toBe(true)
    expect(expectDestinationSettledOnTarget(destinationEvidence).ok).toBe(true)
    expect(
      expectDiagnosticObserved(
        createEvidence({
          diagnostics: {
            recent: [{
              channel: 'measurement',
              severity: 'debug',
              name: 'correction.anchorPreserved',
              details: {},
            }],
          },
        }),
        'correction.anchorPreserved',
      ).ok,
    ).toBe(true)
    expect(
      expectNoFeedPollution(
        createEvidence(),
        createEvidence({
          viewport: {
            visibleRows: [createVisibleRow('feed-runtime-m-80')],
          },
        }),
      ).ok,
    ).toBe(true)
  })

  it('checks P2 edge and lifecycle helpers', () => {
    expect(
      expectNeedMoreBeforeWithin(createEvidence({
        events: { needMoreBefore: 1 },
      }), 1).ok,
    ).toBe(true)
    expect(
      expectNeedMoreAfterWithin(createEvidence({
        events: { needMoreAfter: 2 },
      }), 1).ok,
    ).toBe(false)
    expect(expectRuntimeAttachedOnce(createEvidence()).ok).toBe(true)
    expect(
      expectViewportErrorObserved(
        createEvidence({
          events: {
            viewportErrors: ['commit-timeout-bootstrap'],
          },
        }),
        'commit-timeout-bootstrap',
      ).ok,
    ).toBe(true)
  })

  it('checks IM-specific event and optimistic row helpers', () => {
    const duringSend = createEvidence({
      viewport: {
        visibleRows: [
          createVisibleRow('feed-runtime-m-80'),
          createVisibleRow('optimistic:client-1', 'optimistic:client-1', {
            itemKind: 'optimistic',
            optimisticStatus: 'sending',
          }),
        ],
      },
      events: {
        needMessagesAround: [{
          reason: 'jump',
          messageId: 'feed-runtime-m-32',
          position: 32,
        }],
      },
    })

    expect(expectVisibleOptimisticRow(duringSend).ok).toBe(true)
    expect(expectVisibleOptimisticRow(duringSend, { status: 'sending' }).ok).toBe(true)
    expect(expectNoOptimisticRows(duringSend).ok).toBe(false)
    expect(
      expectNeedMessagesAroundObserved(duringSend, {
        reason: 'jump',
        messageId: 'feed-runtime-m-32',
      }).ok,
    ).toBe(true)
    expect(
      expectLoadedMessageCountDelta(
        createEvidence({ feed: { loadedMessageCount: 20 } }),
        createEvidence({ feed: { loadedMessageCount: 40 } }),
        20,
      ).ok,
    ).toBe(true)
  })

  it('checks performance budget helpers', () => {
    const evidence = createEvidence({
      performance: {
        actionMeasures: [{
          actionId: 'send_message',
          checkpointId: 'during',
          durationMs: 80,
          ok: true,
          startedAt: 10,
          endedAt: 90,
        }],
        longTasks: [{
          name: 'self',
          entryType: 'longtask',
          startTime: 20,
          durationMs: 72,
        }],
        frame: {
          sampleCount: 3,
          maxGapMs: 42,
          gapsOver50Ms: 0,
          gapsOver100Ms: 0,
        },
      },
    })

    expect(expectNoLongTasks(evidence, { thresholdMs: 100, maxCount: 0 }).ok)
      .toBe(true)
    expect(expectActionDurationWithin(evidence, 'send_message', 100).ok)
      .toBe(true)
    expect(expectFrameGapWithin(evidence, 100).ok).toBe(true)
    expect(expectNoLongTasks(evidence, { thresholdMs: 50, maxCount: 0 }).ok)
      .toBe(false)
    expect(expectActionDurationWithin(evidence, 'send_message', 50).ok)
      .toBe(false)
    expect(expectFrameGapWithin(evidence, 30).ok).toBe(false)
  })

  it('checks retry and deleted quote fallback correctness helpers', () => {
    const failed = createEvidence({
      viewport: {
        visibleRows: [
          createVisibleRow('feed-runtime-m-80'),
          createVisibleRow('optimistic:client-1', 'optimistic:client-1', {
            itemKind: 'optimistic',
            optimisticStatus: 'failed',
          }),
        ],
      },
    })
    const retrying = createEvidence({
      viewport: {
        visibleRows: [
          createVisibleRow('feed-runtime-m-80'),
          createVisibleRow('optimistic:client-1', 'optimistic:client-1', {
            itemKind: 'optimistic',
            optimisticStatus: 'sending',
          }),
        ],
      },
    })
    const fallback = createEvidence({
      runtime: {
        destinationState: 'settled',
      },
      events: {
        destinationSettled: [{
          intent: 'jump',
          targetMessageId: 'feed-runtime-m-32',
          resolvedMessageId: 'feed-runtime-m-33',
          resolution: 'fallback-deleted',
        }],
      },
      viewport: {
        visibleRows: [createVisibleRow('feed-runtime-m-33')],
      },
    })

    expect(expectVisibleOptimisticRow(failed, { status: 'failed' }).ok).toBe(true)
    expect(expectSameVisibleOptimisticKey(failed, retrying).ok).toBe(true)
    expect(expectNoCommittedRowsBeyondFeedMessageCount(failed).ok).toBe(true)
    expect(expectNoCommittedRowsBeyondFeedMessageCount(createEvidence({
      viewport: {
        visibleRows: [createVisibleRow('feed-runtime-m-81')],
      },
    })).ok).toBe(false)
    expect(expectDestinationFallbackDeleted(fallback).ok).toBe(true)
  })

  it('checks active feed and stale row pollution after switching sessions', () => {
    const releaseEvidence = createEvidence({
      feed: {
        activeFeedId: 'feed-release',
      },
      viewport: {
        visibleRows: [createVisibleRow('feed-release-m-80')],
      },
    })

    expect(expectActiveFeed(releaseEvidence, 'feed-release').ok).toBe(true)
    expect(expectVisibleRowsBelongToActiveFeed(releaseEvidence).ok).toBe(true)
    expect(expectVisibleRowsBelongToActiveFeed(createEvidence({
      feed: {
        activeFeedId: 'feed-release',
      },
      viewport: {
        visibleRows: [createVisibleRow('feed-runtime-m-80')],
      },
    })).ok).toBe(false)
  })

  it('checks P3 stress helpers without promoting them to gates', () => {
    expect(expectNoWhiteScreen(createEvidence()).ok).toBe(true)
    expect(
      expectDestinationOutcomeRecorded(createEvidence({
        events: {
          destinationSettled: [{
            intent: 'jump',
            targetMessageId: 'feed-runtime-m-80',
            resolvedMessageId: 'feed-runtime-m-80',
            resolution: 'target',
          }],
        },
      })).ok,
    ).toBe(true)
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

describe('P1 e2e scenario definitions', () => {
  it('defines registered P1 host scenarios with oracle coverage', () => {
    expect(E2E_P1_SCENARIO_DEFINITIONS.map((scenario) => scenario.id)).toEqual([
      'bottom.locked-append-follow',
      'destination.quote-jump-visible-target',
      'destination.quote-jump-unloaded-target',
      'send.optimistic-ack-follow-bottom',
      'send.optimistic-fail-retry',
      'dynamic-height.anchor-above-growth',
      'session.switch-restore-runtime-cache',
    ])

    for (const scenario of E2E_P1_SCENARIO_DEFINITIONS) {
      expect(getE2EScenarioDefinition(scenario.id)).not.toBeNull()
      expect(getE2EP1ScenarioDefinition(scenario.id)).toBe(scenario)
      expect(scenario.priority).toBe('P1')
      expect(scenario.oracleIds.length).toBeGreaterThan(0)
    }
  })
})

describe('P2 e2e scenario definitions', () => {
  it('defines registered P2 host scenarios with oracle coverage', () => {
    expect(E2E_P2_SCENARIO_DEFINITIONS.map((scenario) => scenario.id)).toEqual([
      'edge.custom-scrollbar-drag-top',
      'edge.custom-scrollbar-drag-bottom',
      'paging.prepend-slow-request-race',
      'paging.append-slow-request-race',
      'destination.quote-jump-deleted-target',
      'session.switch-during-pending-prepend',
      'lifecycle.strictmode-attach-detach-attach',
      'recovery.bootstrap-commit-timeout',
    ])

    for (const scenario of E2E_P2_SCENARIO_DEFINITIONS) {
      expect(getE2EScenarioDefinition(scenario.id)).not.toBeNull()
      expect(getE2EP2ScenarioDefinition(scenario.id)).toBe(scenario)
      expect(scenario.priority).toBe('P2')
      expect(scenario.oracleIds.length).toBeGreaterThan(0)
    }
  })
})

describe('P3 e2e scenario definitions', () => {
  it('defines registered exploratory P3 scenarios', () => {
    expect(E2E_P3_SCENARIO_DEFINITIONS.map((scenario) => scenario.id)).toEqual([
      'storm.quote-jump-during-event-storm',
      'storm.follow-bottom-with-bot-push',
      'storm.dynamic-height-session-switch',
    ])

    for (const scenario of E2E_P3_SCENARIO_DEFINITIONS) {
      expect(getE2EScenarioDefinition(scenario.id)).not.toBeNull()
      expect(getE2EP3ScenarioDefinition(scenario.id)).toBe(scenario)
      expect(scenario.priority).toBe('P3')
      expect(scenario.gate).toBe('exploratory')
      expect(scenario.oracleIds.length).toBeGreaterThan(0)
    }
  })
})

describe('performance e2e scenario definitions', () => {
  it('defines registered performance scenarios separately from correctness all', () => {
    expect(E2E_PERFORMANCE_SCENARIO_DEFINITIONS.map((scenario) => scenario.id))
      .toEqual([
        'perf.bootstrap-latest-budget',
        'perf.send-ack-latency-budget',
        'perf.prepend-latency-budget',
      ])

    for (const scenario of E2E_PERFORMANCE_SCENARIO_DEFINITIONS) {
      expect(getE2EScenarioDefinition(scenario.id)).not.toBeNull()
      expect(getE2EPerformanceScenarioDefinition(scenario.id)).toBe(scenario)
      expect(scenario.priority).toBe('PERF')
      expect(scenario.gate).toBe('performance')
      expect(scenario.oracleIds.length).toBeGreaterThan(0)
    }
  })
})

type EvidenceOverrides = Partial<
  Omit<
    E2EEvidence,
    'feed' | 'runtime' | 'viewport' | 'ui' | 'events' | 'anchors' | 'performance'
  >
> & {
  feed?: Partial<E2EEvidence['feed']>
  runtime?: Partial<E2EEvidence['runtime']>
  viewport?: Partial<E2EEvidence['viewport']>
  ui?: Partial<E2EEvidence['ui']>
  events?: Partial<E2EEvidence['events']>
  anchors?: Partial<E2EEvidence['anchors']>
  performance?: Partial<E2EEvidence['performance']>
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
      highlightedMessageId: null,
    },
    events: {
      viewportAnchorChanged: [],
      needMoreBefore: 0,
      needMoreAfter: 0,
      needMessagesAround: [],
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
    performance: {
      actionMeasures: [],
      longTasks: [],
      frame: {
        sampleCount: 1,
        maxGapMs: 16,
        gapsOver50Ms: 0,
        gapsOver100Ms: 0,
      },
    },
  }

  return {
    ...base,
    ...overrides,
    feed: {
      ...base.feed,
      ...overrides.feed,
    },
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
    performance: {
      ...base.performance,
      ...overrides.performance,
      frame: {
        ...base.performance.frame,
        ...overrides.performance?.frame,
      },
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

function createVisibleRow(
  messageId: string,
  serializedKey = `committed:${messageId}`,
  overrides: Partial<E2EEvidence['viewport']['visibleRows'][number]> = {},
): E2EEvidence['viewport']['visibleRows'][number] {
  return {
    messageId,
    serializedKey,
    itemKind: 'committed',
    top: 0,
    bottom: 40,
    height: 40,
    ...overrides,
  }
}
