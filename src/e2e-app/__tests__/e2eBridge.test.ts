import { describe, expect, it, vi } from 'vitest'
import type { DemoMessageScenario } from '../../demo/useDemoMessageScenario'
import { collectE2EState, createE2EConsoleBuffer } from '../e2eBridge'

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
})

function createScenarioStub(): DemoMessageScenario {
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
      getDiagnosticRecords: vi.fn(() => []),
    } as unknown as DemoMessageScenario['activeRuntime'],
    messageCount: 80,
    loadedMessageCount: 20,
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
  }
}
