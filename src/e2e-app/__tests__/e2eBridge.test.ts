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
        itemKind: 'committed',
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
      'start_prepend_history',
      'append_history',
      'start_append_history',
      'send_message',
      'retry_failed_send',
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

  it('records needMessagesAround events for destination-loading evidence', () => {
    const buffer = createE2EEventBuffer()

    recordE2ERuntimeEvent(buffer, {
      type: 'needMessagesAround',
      feedId: 'feed-runtime',
      generation: 1,
      reason: 'jump',
      target: {
        messageId: 'feed-runtime-m-32',
        position: 32,
      },
    })

    expect(buffer.needMessagesAround).toEqual([{
      reason: 'jump',
      messageId: 'feed-runtime-m-32',
      position: 32,
    }])
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

  it('does not treat an idle failed state as ready by default', async () => {
    const root = document.createElement('main')
    const scenario = createScenarioStub()
    const consoleBuffer = createE2EConsoleBuffer()
    const eventBuffer = createE2EEventBuffer()
    const diagnostic: ViewportDiagnosticRecord = {
      feedId: 'feed-runtime',
      generation: 2,
      channel: 'projection',
      severity: 'error',
      name: 'commit-timeout-bootstrap',
      timestamp: 1,
      details: {},
    }

    vi.mocked(scenario.activeRuntime.getDiagnosticRecords).mockReturnValue([
      diagnostic,
    ])

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
      actionId: 'wait_for_ready',
      payload: { timeoutMs: 1 },
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
      actionId: 'wait_for_ready',
      error: { code: 'wait_for_ready_timeout' },
    })
  })

  it('allows wait_for_ready to continue after an explicitly expected viewport error', async () => {
    const root = document.createElement('main')
    const scenario = createScenarioStub()
    const consoleBuffer = createE2EConsoleBuffer()
    const eventBuffer = createE2EEventBuffer()
    const diagnostics: ViewportDiagnosticRecord[] = [{
      feedId: 'feed-runtime',
      generation: 2,
      channel: 'recovery',
      severity: 'error',
      name: 'runtime.error',
      timestamp: 1,
      details: { code: 'commit-timeout-bootstrap' },
    }, {
      feedId: 'feed-runtime',
      generation: 2,
      channel: 'transaction',
      severity: 'error',
      name: 'transaction.error',
      timestamp: 2,
      details: {},
    }]

    vi.mocked(scenario.activeRuntime.getDiagnosticRecords).mockReturnValue(
      diagnostics,
    )
    recordE2ERuntimeEvent(eventBuffer, {
      type: 'viewportError',
      feedId: 'feed-runtime',
      generation: 2,
      code: 'commit-timeout-bootstrap',
    })

    const readEvidence = (checkpointId: string) =>
      collectE2EEvidence({
        scenarioId: 'recovery.bootstrap-commit-timeout',
        checkpointId,
        scenario,
        consoleBuffer,
        eventBuffer,
        root,
      })
    const result = await runE2EAction({
      actionId: 'wait_for_ready',
      payload: {
        allowViewportErrors: ['commit-timeout-bootstrap'],
        timeoutMs: 1,
      },
      scenarioId: 'recovery.bootstrap-commit-timeout',
      scenario,
      consoleBuffer,
      eventBuffer,
      root,
      readState: () =>
        collectE2EState({
          scenarioId: 'recovery.bootstrap-commit-timeout',
          scenario,
          consoleBuffer,
          root,
        }),
      readEvidence,
    })

    expect(result.ok).toBe(true)
  })

  it('completes long-running mock start actions without waiting for full UI idle', async () => {
    const root = document.createElement('main')
    const scenario = createScenarioStub()
    const consoleBuffer = createE2EConsoleBuffer()
    const eventBuffer = createE2EEventBuffer()

    scenario.toggleEventStorm = vi.fn(() => {
      scenario.eventStormRunning = true
      scenario.pendingOperation = 'mock.eventStorm'
    })

    const readEvidence = (checkpointId: string) =>
      collectE2EEvidence({
        scenarioId: 'storm.quote-jump-during-event-storm',
        checkpointId,
        scenario,
        consoleBuffer,
        eventBuffer,
        root,
      })
    const result = await runE2EAction({
      actionId: 'toggle_event_storm',
      scenarioId: 'storm.quote-jump-during-event-storm',
      scenario,
      consoleBuffer,
      eventBuffer,
      root,
      readState: () =>
        collectE2EState({
          scenarioId: 'storm.quote-jump-during-event-storm',
          scenario,
          consoleBuffer,
          root,
        }),
      readEvidence,
    })

    expect(result.ok).toBe(true)
    expect(scenario.toggleEventStorm).toHaveBeenCalledTimes(1)
    expect(result.after?.ui.pendingOperation).toBe('mock.eventStorm')
  })

  it('returns start_prepend_history while the prepend request is still pending', async () => {
    const root = document.createElement('main')
    const scenario = createScenarioStub()
    const consoleBuffer = createE2EConsoleBuffer()
    const eventBuffer = createE2EEventBuffer()

    scenario.loadHistoryBatch = vi.fn(() => {
      scenario.loadingBefore = true
      scenario.pendingOperation = 'history.prepend'
    })

    const readEvidence = (checkpointId: string) =>
      collectE2EEvidence({
        scenarioId: 'paging.prepend-slow-request-race',
        checkpointId,
        scenario,
        consoleBuffer,
        eventBuffer,
        root,
      })
    const result = await runE2EAction({
      actionId: 'start_prepend_history',
      scenarioId: 'paging.prepend-slow-request-race',
      scenario,
      consoleBuffer,
      eventBuffer,
      root,
      readState: () =>
        collectE2EState({
          scenarioId: 'paging.prepend-slow-request-race',
          scenario,
          consoleBuffer,
          root,
        }),
      readEvidence,
    })

    expect(result.ok).toBe(true)
    expect(scenario.loadHistoryBatch).toHaveBeenCalledTimes(1)
    expect(result.after?.ui.pendingOperation).toBe('history.prepend')
  })

  it('returns start_append_history while the append request is still pending', async () => {
    const root = document.createElement('main')
    const scenario = createScenarioStub()
    const consoleBuffer = createE2EConsoleBuffer()
    const eventBuffer = createE2EEventBuffer()

    scenario.loadFutureBatch = vi.fn(() => {
      scenario.loadingAfter = true
      scenario.pendingOperation = 'history.append'
    })

    const readEvidence = (checkpointId: string) =>
      collectE2EEvidence({
        scenarioId: 'paging.append-slow-request-race',
        checkpointId,
        scenario,
        consoleBuffer,
        eventBuffer,
        root,
      })
    const result = await runE2EAction({
      actionId: 'start_append_history',
      scenarioId: 'paging.append-slow-request-race',
      scenario,
      consoleBuffer,
      eventBuffer,
      root,
      readState: () =>
        collectE2EState({
          scenarioId: 'paging.append-slow-request-race',
          scenario,
          consoleBuffer,
          root,
        }),
      readEvidence,
    })

    expect(result.ok).toBe(true)
    expect(scenario.loadFutureBatch).toHaveBeenCalledTimes(1)
    expect(result.after?.ui.pendingOperation).toBe('history.append')
  })

  it('returns send_message(waitFor optimistic) before full runtime idle', async () => {
    const root = document.createElement('main')
    const container = document.createElement('div')
    const scenario = createScenarioStub()
    const consoleBuffer = createE2EConsoleBuffer()
    const eventBuffer = createE2EEventBuffer()

    container.dataset.testid = 'message-scroll-container'
    Object.defineProperties(container, {
      scrollTop: { value: 0, configurable: true },
      scrollHeight: { value: 120, configurable: true },
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
    root.append(container)

    scenario.sendMessage = vi.fn(() => {
      const row = document.createElement('div')

      row.dataset.messageRow = 'optimistic:client-e2e'
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
      scenario.pendingOperation = 'message.send'
      vi.mocked(scenario.activeRuntime.getSnapshot).mockReturnValue({
        ...createRuntimeSnapshot(),
        items: [{
          kind: 'optimistic',
          key: { kind: 'optimistic', clientMessageId: 'client-e2e' },
          draft: {},
          status: 'sending',
          version: 1,
        }],
      })
      return true
    })

    const readEvidence = (checkpointId: string) =>
      collectE2EEvidence({
        scenarioId: 'send.optimistic-ack-follow-bottom',
        checkpointId,
        scenario,
        consoleBuffer,
        eventBuffer,
        root,
      })
    const result = await runE2EAction({
      actionId: 'send_message',
      payload: {
        body: 'hello from e2e',
        waitFor: 'optimistic',
      },
      scenarioId: 'send.optimistic-ack-follow-bottom',
      scenario,
      consoleBuffer,
      eventBuffer,
      root,
      readState: () =>
        collectE2EState({
          scenarioId: 'send.optimistic-ack-follow-bottom',
          scenario,
          consoleBuffer,
          root,
        }),
      readEvidence,
    })

    expect(result.ok).toBe(true)
    expect(scenario.sendMessage).toHaveBeenCalledWith('hello from e2e')
    expect(result.after?.ui.pendingOperation).toBe('message.send')
    expect(result.after?.viewport.visibleRows[0]?.serializedKey).toBe(
      'optimistic:client-e2e',
    )
    expect(result.after?.viewport.visibleRows[0]?.optimisticStatus).toBe(
      'sending',
    )
  })

  it('returns send_message(waitFor failed) after the optimistic row fails', async () => {
    const root = document.createElement('main')
    const container = createVisibleContainer(root)
    const scenario = createScenarioStub()
    const consoleBuffer = createE2EConsoleBuffer()
    const eventBuffer = createE2EEventBuffer()

    scenario.sendMessage = vi.fn(() => {
      appendVisibleRow(container, 'optimistic:client-e2e')
      scenario.pendingOperation = 'idle'
      vi.mocked(scenario.activeRuntime.getSnapshot).mockReturnValue({
        ...createRuntimeSnapshot(),
        items: [{
          kind: 'optimistic',
          key: { kind: 'optimistic', clientMessageId: 'client-e2e' },
          draft: {},
          status: 'failed',
          version: 1,
        }],
      })
      return true
    })

    const readEvidence = (checkpointId: string) =>
      collectE2EEvidence({
        scenarioId: 'send.optimistic-fail-retry',
        checkpointId,
        scenario,
        consoleBuffer,
        eventBuffer,
        root,
      })
    const result = await runE2EAction({
      actionId: 'send_message',
      payload: {
        body: 'hello from e2e',
        waitFor: 'failed',
      },
      scenarioId: 'send.optimistic-fail-retry',
      scenario,
      consoleBuffer,
      eventBuffer,
      root,
      readState: () =>
        collectE2EState({
          scenarioId: 'send.optimistic-fail-retry',
          scenario,
          consoleBuffer,
          root,
        }),
      readEvidence,
    })

    expect(result.ok).toBe(true)
    expect(scenario.sendMessage).toHaveBeenCalledWith('hello from e2e')
    expect(result.after?.viewport.visibleRows[0]?.optimisticStatus).toBe(
      'failed',
    )
  })

  it('runs retry_failed_send and can return while retry send is pending', async () => {
    const root = document.createElement('main')
    const container = createVisibleContainer(root)
    const scenario = createScenarioStub()
    const consoleBuffer = createE2EConsoleBuffer()
    const eventBuffer = createE2EEventBuffer()

    scenario.retryFailedSend = vi.fn(() => {
      appendVisibleRow(container, 'optimistic:client-e2e')
      scenario.pendingOperation = 'message.send'
      vi.mocked(scenario.activeRuntime.getSnapshot).mockReturnValue({
        ...createRuntimeSnapshot(),
        items: [{
          kind: 'optimistic',
          key: { kind: 'optimistic', clientMessageId: 'client-e2e' },
          draft: {},
          status: 'sending',
          version: 1,
        }],
      })
      return true
    })

    const readEvidence = (checkpointId: string) =>
      collectE2EEvidence({
        scenarioId: 'send.optimistic-fail-retry',
        checkpointId,
        scenario,
        consoleBuffer,
        eventBuffer,
        root,
      })
    const result = await runE2EAction({
      actionId: 'retry_failed_send',
      payload: { waitFor: 'optimistic' },
      scenarioId: 'send.optimistic-fail-retry',
      scenario,
      consoleBuffer,
      eventBuffer,
      root,
      readState: () =>
        collectE2EState({
          scenarioId: 'send.optimistic-fail-retry',
          scenario,
          consoleBuffer,
          root,
        }),
      readEvidence,
    })

    expect(result.ok).toBe(true)
    expect(scenario.retryFailedSend).toHaveBeenCalledTimes(1)
    expect(result.after?.ui.pendingOperation).toBe('message.send')
    expect(result.after?.viewport.visibleRows[0]?.optimisticStatus).toBe(
      'sending',
    )
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
      getSnapshot: vi.fn(() => createRuntimeSnapshot()),
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
    loadFutureBatch: vi.fn(),
    appendMessage: vi.fn(),
    appendLongBurst: vi.fn(),
    toggleEventStorm: vi.fn(),
    toggleBotPush: vi.fn(),
    editMessage: vi.fn(),
    deleteMessage: vi.fn(),
    reactToMessage: vi.fn(),
    toggleDynamicHeight: vi.fn(),
    sendMessage: vi.fn(() => true),
    retryFailedSend: vi.fn(() => true),
    followBottom: vi.fn(),
    jumpToQuote: vi.fn(),
    clearFeed: vi.fn(),
    rememberRuntimeViewportAnchor: vi.fn(),
    ...overrides,
  }
}

function createRuntimeSnapshot() {
  return {
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
  } as ReturnType<DemoMessageScenario['activeRuntime']['getSnapshot']>
}

function createVisibleContainer(root: HTMLElement): HTMLElement {
  const container = document.createElement('div')

  container.dataset.testid = 'message-scroll-container'
  Object.defineProperties(container, {
    scrollTop: { value: 0, configurable: true },
    scrollHeight: { value: 120, configurable: true },
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
  root.append(container)

  return container
}

function appendVisibleRow(container: HTMLElement, serializedKey: string): void {
  const row = document.createElement('div')

  row.dataset.messageRow = serializedKey
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
}
