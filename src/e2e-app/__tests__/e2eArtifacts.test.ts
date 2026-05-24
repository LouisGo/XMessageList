import { describe, expect, it } from 'vitest'
import type { E2EActionResult, E2EEvidence } from '../e2eBridge'
import {
  classifyE2EFailureOwner,
  createE2EEvidenceJson,
  createE2EFailureReport,
} from '../e2eArtifacts'

describe('e2e artifacts', () => {
  it('serializes evidence as stable, readable JSON', () => {
    const evidence = createEvidence()
    const json = createE2EEvidenceJson(evidence)

    expect(json.endsWith('\n')).toBe(true)
    expect(JSON.parse(json)).toMatchObject({
      schemaVersion: 1,
      scenarioId: 'bootstrap.latest-bottom-lock',
    })
    expect(json).toContain('\n  "schemaVersion": 1,')
  })

  it('classifies pending demo work as the primary owner for idle timeouts', () => {
    const after = createEvidence({
      ui: {
        pendingOperation: 'demo.loadHistory',
      },
    })
    const result = createFailedResult(after, {
      code: 'wait_for_idle_timeout',
      reason: 'pending demo operation',
    })

    expect(classifyE2EFailureOwner(result, after)).toBe('demo')
    expect(createE2EFailureReport({ result })).toContain(
      '- Primary owner: `demo`',
    )
  })

  it('builds a deterministic report from runtime error evidence', () => {
    const after = createEvidence({
      events: {
        viewportErrors: ['commit-timeout-bootstrap'],
      },
      diagnostics: {
        recent: [{
          channel: 'runtime',
          severity: 'error',
          name: 'commit-timeout-bootstrap',
          details: {},
        }],
      },
    })
    const result = createFailedResult(after, {
      code: 'wait_for_ready_timeout',
      reason: 'runtime did not settle',
    })
    const report = createE2EFailureReport({ result })

    expect(classifyE2EFailureOwner(result, after)).toBe('runtime')
    expect(report).toContain('- Primary owner: `runtime`')
    expect(report).toContain('- Viewport errors: commit-timeout-bootstrap')
    expect(report).toContain('- Error diagnostics: commit-timeout-bootstrap')
    expect(report).toContain('- no current anchor captured')
  })
})

type EvidenceOverrides = Partial<
  Omit<E2EEvidence, 'runtime' | 'viewport' | 'ui' | 'events' | 'diagnostics'>
> & {
  runtime?: Partial<E2EEvidence['runtime']>
  viewport?: Partial<E2EEvidence['viewport']>
  ui?: Partial<E2EEvidence['ui']>
  events?: Partial<E2EEvidence['events']>
  diagnostics?: Partial<E2EEvidence['diagnostics']>
}

function createEvidence(overrides: EvidenceOverrides = {}): E2EEvidence {
  const base: E2EEvidence = {
    schemaVersion: 1,
    scenarioId: 'bootstrap.latest-bottom-lock',
    checkpointId: 'after:wait_for_idle',
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
      visibleRows: [{
        messageId: 'feed-runtime-m-80',
        serializedKey: 'committed:feed-runtime-m-80',
        top: 0,
        bottom: 40,
        height: 40,
      }],
    },
    anchors: {
      current: null,
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
    diagnostics: {
      ...base.diagnostics,
      ...overrides.diagnostics,
    },
  }
}

function createFailedResult(
  after: E2EEvidence,
  error: { code: string; reason: string },
): E2EActionResult {
  return {
    ok: false,
    actionId: 'wait_for_idle',
    message: error.reason,
    before: createEvidence({
      checkpointId: 'before:wait_for_idle',
    }),
    after,
    error: {
      code: error.code,
      details: {
        reason: error.reason,
      },
    },
  }
}
