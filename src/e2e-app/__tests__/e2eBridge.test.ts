import { describe, expect, it, vi } from 'vitest'
import type { DemoMessageScenario } from '../../demo/useDemoMessageScenario'
import type { ViewportDiagnosticRecord } from '../../runtime'
import {
  collectE2EEvidence,
  collectE2EState,
  createE2EConsoleBuffer,
  createE2EEventBuffer,
  listE2EActions,
  recordE2ERuntimeEvent,
  runE2EAction,
} from '../e2eBridge'

describe('collectE2EState', () => {
  it('summarizes runtime, viewport, UI, and safety fields for the AI bridge', () => {
    const root = document.createElement('main')
    const container = document.createElement('div')
    const row = document.createElement('div')

    container.dataset.testid = 'message-scroll-container'
    Object.defineProperties(container, {
      scrollTop: { value: 24, configurable: true },
      scrollHeight: { value: 240, configurable: true },
      clientHeight: { value: 120, configurable: true },
    })
    container.getBoundingClientRect = () => ({
      top: 0,
      bottom: 120,
      left: 0,
      right: 320,
      width: 320,
      height: 120,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    row.dataset.messageRow = 'committed:feed-runtime-m-80'
    row.dataset.messageId = 'feed-runtime-m-80'
    row.getBoundingClientRect = () => ({
      top: 12,
      bottom: 52,
      left: 0,
      right: 320,
      width: 320,
      height: 40,
      x: 0,
      y: 12,
      toJSON: () => ({}),
    })

    container.append(row)
    root.append(container)

    const scenario = createScenarioStub()
    const consoleBuffer = createE2EConsoleBuffer()
    const state = collectE2EState({
      scenarioId: 'bootstrap.latest-bottom-lock',
      scenario,
      consoleBuffer,
      root,
    })

    expect(state.scenarioStatus).toBe('ready')
    expect(state.feed).toEqual({
      activeFeedId: 'feed-runtime',
      generation: 2,
      revision: 7,
      title: 'Runtime Lab',
    })
    expect(state.runtime.bottomLockState).toBe('LOCKED')
    expect(state.viewport.visibleMessageIds).toEqual(['feed-runtime-m-80'])
    expect(state.viewport.distanceToBottom).toBe(96)
    expect(state.ui.pendingOperation).toBe('idle')
    expect(state.safety.consoleErrors).toBe(0)
  })

  it('collects visible row geometry and feed evidence for deterministic oracles', () => {
    const root = document.createElement('main')
    const container = document.createElement('div')
    const row = document.createElement('div')

    container.dataset.testid = 'message-scroll-container'
    Object.defineProperties(container, {
      scrollTop: { value: 24, configurable: true },
      scrollHeight: { value: 240, configurable: true },
      clientHeight: { value: 120, configurable: true },
    })
    container.getBoundingClientRect = () => ({
      top: 10,
      bottom: 130,
      left: 0,
      right: 320,
      width: 320,
      height: 120,
      x: 0,
      y: 10,
      toJSON: () => ({}),
    })

    row.dataset.messageRow = 'committed:feed-runtime-m-80'
    row.dataset.messageId = 'feed-runtime-m-80'
    row.getBoundingClientRect = () => ({
      top: 22,
      bottom: 62,
      left: 0,
      right: 320,
      width: 320,
      height: 40,
      x: 0,
      y: 22,
      toJSON: () => ({}),
    })

    container.append(row)
    root.append(container)

    const evidence = collectE2EEvidence({
      scenarioId: 'bootstrap.latest-bottom-lock',
      checkpointId: 'after_ready',
      scenario: createScenarioStub(),
      consoleBuffer: createE2EConsoleBuffer(),
      eventBuffer: createE2EEventBuffer(),
      root,
    })

    expect(evidence.schemaVersion).toBe(1)
    expect(evidence.feed).toMatchObject({
      activeFeedId: 'feed-runtime',
      hasMoreBefore: true,
      hasMoreAfter: false,
      loadedMessageCount: 20,
      messageCount: 80,
    })
    expect(evidence.viewport.visibleRows).toEqual([
      {
        messageId: 'feed-runtime-m-80',
        serializedKey: 'committed:feed-runtime-m-80',
        top: 12,
        bottom: 52,
        height: 40,
      },
    ])
    expect(evidence.anchors.current).toMatchObject({
      messageId: 'feed-runtime-m-80',
      top: 12,
    })
  })

  it('lists enabled Phase 2A actions when the scenario is ready', () => {
    const actions = listE2EActions(
      collectE2EState({
        scenarioId: 'bootstrap.latest-bottom-lock',
        scenario: createScenarioStub(),
        consoleBuffer: createE2EConsoleBuffer(),
        root: document.createElement('main'),
      }),
    )

    expect(actions.map((action) => action.id)).toEqual([
      'wait_for_ready',
      'wait_for_idle',
      'collect_evidence',
      'scroll_to_middle',
      'scroll_to_history_top',
      'scroll_to_bottom',
      'append_message',
      'prepend_history',
      'follow_bottom',
      'jump_to_quoted_message',
      'switch_feed',
      'toggle_dynamic_height',
      'drag_scrollbar_to_top',
      'drag_scrollbar_to_bottom',
      'reattach_runtime',
      'toggle_event_storm',
      'toggle_bot_push',
    ])
    expect(actions.every((action) => action.enabled)).toBe(true)
  })

  it('runs collect_evidence with structured before and after evidence', async () => {
    const root = document.createElement('main')
    const scenario = createScenarioStub()
    const consoleBuffer = createE2EConsoleBuffer()
    const eventBuffer = createE2EEventBuffer()
    const readEvidence = (checkpointId: string) =>
      collectE2EEvidence({
        scenarioId: 'bootstrap.latest-bottom-lock',
        checkpointId,
        scenario,
        consoleBuffer,
        eventBuffer,
        root,
      })
    const result = await runE2EAction({
      actionId: 'collect_evidence',
      payload: { checkpointId: 'manual_checkpoint' },
      scenarioId: 'bootstrap.latest-bottom-lock',
      scenario,
      consoleBuffer,
      eventBuffer,
      root,
      readState: () =>
        collectE2EState({
          scenarioId: 'bootstrap.latest-bottom-lock',
          scenario,
          consoleBuffer,
          root,
        }),
      readEvidence,
    })

    expect(result.ok).toBe(true)
    expect(result.before?.checkpointId).toBe('before:collect_evidence')
    expect(result.after?.checkpointId).toBe('manual_checkpoint')
  })

  it('keeps viewport event evidence bounded', () => {
    const buffer = createE2EEventBuffer()

    for (let index = 0; index < 85; index += 1) {
      recordE2ERuntimeEvent(buffer, {
        type: 'viewportAnchorChanged',
        feedId: 'feed-runtime',
        generation: 1,
        reason: 'scroll-idle',
        anchor: {
          key: { kind: 'committed', messageId: `m-${index}` },
          offsetWithinMessage: index,
        },
      })
    }

    expect(buffer.viewportAnchorChanged).toHaveLength(80)
    expect(buffer.viewportAnchorChanged[0]?.messageId).toBe('m-5')
    expect(buffer.viewportAnchorChanged.at(-1)?.messageId).toBe('m-84')
  })

  it('keeps priority diagnostics when the runtime diagnostic buffer is noisy', () => {
    const root = document.createElement('main')
    const scenario = createScenarioStub()
    const records: ViewportDiagnosticRecord[] = Array.from(
      { length: 90 },
      (_, index) => ({
        feedId: 'feed-runtime',
        generation: 1,
        channel: 'scroll',
        severity: 'debug',
        name: `scroll.noise.${index}`,
        timestamp: index,
        details: {},
      }),
    )
    records.unshift({
      feedId: 'feed-runtime',
      generation: 1,
      channel: 'projection',
      severity: 'debug',
      name: 'projection.publish',
      timestamp: -1,
      details: {},
    })
    vi.mocked(scenario.activeRuntime.getDiagnosticRecords).mockReturnValue(records)

    const evidence = collectE2EEvidence({
      scenarioId: 'bootstrap.latest-bottom-lock',
      checkpointId: 'manual',
      scenario,
      consoleBuffer: createE2EConsoleBuffer(),
      eventBuffer: createE2EEventBuffer(),
      root,
    })

    expect(evidence.diagnostics.recent).toHaveLength(80)
    expect(evidence.diagnostics.recent.map((record) => record.name)).toContain(
      'projection.publish',
    )
  })

  it('rejects disabled actions before mutating the scenario', async () => {
    const root = document.createElement('main')
    const scenario = createScenarioStub({ feedLoading: true })
    const consoleBuffer = createE2EConsoleBuffer()
    const eventBuffer = createE2EEventBuffer()
    const readEvidence = (checkpointId: string) =>
      collectE2EEvidence({
        scenarioId: 'bootstrap.latest-bottom-lock',
        checkpointId,
        scenario,
        consoleBuffer,
        eventBuffer,
        root,
      })
    const result = await runE2EAction({
      actionId: 'append_message',
      scenarioId: 'bootstrap.latest-bottom-lock',
      scenario,
      consoleBuffer,
      eventBuffer,
      root,
      readState: () =>
        collectE2EState({
          scenarioId: 'bootstrap.latest-bottom-lock',
          scenario,
          consoleBuffer,
          root,
        }),
      readEvidence,
    })

    expect(result).toMatchObject({
      ok: false,
      actionId: 'append_message',
      error: { code: 'action_disabled' },
    })
    expect(scenario.appendMessage).not.toHaveBeenCalled()
  })
})

function createScenarioStub(
  overrides: Partial<DemoMessageScenario> = {},
): DemoMessageScenario {
  return {
    feeds: [],
    activeFeedId: 'feed-runtime',
    selectedFeedId: 'feed-runtime',
    pendingFeedId: null,
    activeFeed: {
      id: 'feed-runtime',
      title: 'Runtime Lab',
      subtitle: 'Anchor / spacer debugging',
      seedCount: 80,
      unread: 0,
    },
    activeRuntime: {
      getSnapshot: vi.fn(() => ({
        feedId: 'feed-runtime',
        generation: 2,
        revision: 7,
        items: [],
        renderWindow: { startIndex: 0, endIndex: -1, itemKeys: [] },
        topSpacer: 10,
        bottomSpacer: 20,
        bottomLockState: 'LOCKED',
        bootstrapState: 'READY',
        viewportPhase: 'IDLE',
        edgeState: { before: 'idle', after: 'idle' },
      })),
      getDebugSnapshot: vi.fn(() => ({
        state: 'READY',
        readySubstate: 'READY_IDLE',
        viewportPhase: 'IDLE',
        transactionState: 'idle',
        destinationState: 'idle',
        pendingCommands: 0,
        motionActive: false,
        observedRows: 1,
        heightCacheSize: 1,
        lastScrollSource: null,
      })),
      getViewportAnchorState: vi.fn(() => ({
        key: { kind: 'committed', messageId: 'feed-runtime-m-80' },
        offsetWithinMessage: 4,
      })),
      getDiagnosticRecords: vi.fn(() => []),
    } as unknown as DemoMessageScenario['activeRuntime'],
    messageCount: 80,
    loadedMessageCount: 20,
    hasMoreBefore: true,
    hasMoreAfter: false,
    loadingBefore: false,
    loadingAfter: false,
    feedLoading: false,
    eventStormRunning: false,
    botPushActive: false,
    highlightedMessageId: null,
    highlightToken: 0,
    pendingOperation: 'idle',
    lastEvent: 'loaded Runtime Lab',
    selectFeed: vi.fn(),
    loadHistoryBatch: vi.fn(),
    appendMessage: vi.fn(),
    appendLongBurst: vi.fn(),
    toggleEventStorm: vi.fn(),
    toggleBotPush: vi.fn(),
    editMessage: vi.fn(),
    deleteMessage: vi.fn(),
    reactToMessage: vi.fn(),
    toggleDynamicHeight: vi.fn(),
    sendMessage: vi.fn(() => true),
    followBottom: vi.fn(),
    jumpToQuote: vi.fn(),
    clearFeed: vi.fn(),
    rememberRuntimeViewportAnchor: vi.fn(),
    ...overrides,
  }
}
