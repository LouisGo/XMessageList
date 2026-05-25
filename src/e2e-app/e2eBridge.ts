import type { DemoMessageScenario } from '../demo/useDemoMessageScenario'
import {
  serializeRuntimeItemKey,
  type MessageViewportRuntimeEvent,
  type ViewportDiagnosticRecord,
} from '../runtime'

export type E2EScenarioStatus = 'booting' | 'ready' | 'running' | 'failed'

export type E2EState = {
  scenarioId: string
  scenarioStatus: E2EScenarioStatus
  feed: {
    activeFeedId: string
    generation: number
    revision: number
    title: string
  }
  runtime: {
    state: string
    readySubstate: string
    viewportPhase: string
    transactionState: string
    destinationState: string
    bottomLockState: string
    pendingCommands: number
    motionActive: boolean
    observedRows: number
    heightCacheSize: number
    lastScrollSource: string | null
  }
  viewport: {
    scrollTop: number
    scrollHeight: number
    clientHeight: number
    distanceToBottom: number
    topSpacer: number
    bottomSpacer: number
    visibleMessageIds: string[]
    firstVisibleMessageId: string | null
    lastVisibleMessageId: string | null
  }
  ui: {
    feedLoading: boolean
    loadingBefore: boolean
    loadingAfter: boolean
    eventStormRunning: boolean
    botPushActive: boolean
    dynamicHeightEnabled: boolean
    pendingOperation: string
    lastEvent: string
    followBottomVisible: boolean
    highlightedMessageId: string | null
  }
  safety: {
    consoleErrors: number
    consoleWarnings: number
    lastViewportError: string | null
  }
}

export type E2EActionDescriptor = {
  id: string
  label: string
  category:
    | 'bootstrap'
    | 'scroll'
    | 'paging'
    | 'message'
    | 'destination'
    | 'feed'
    | 'mock'
    | 'evidence'
  enabled: boolean
  reasonDisabled?: string
  payloadSchema?: Record<string, unknown>
}

export type E2EActionResult = {
  ok: boolean
  actionId: string
  message: string
  before?: E2EEvidence
  after?: E2EEvidence
  error?: {
    code: string
    details?: Record<string, unknown>
  }
}

export type XMessageListE2EBridge = {
  version: 1
  getState: () => E2EState
  listActions: () => E2EActionDescriptor[]
  runAction: (
    actionId: string,
    payload?: Record<string, unknown>,
  ) => Promise<E2EActionResult>
  getEvidence: () => E2EEvidence
  resetScenario: (scenarioId: string) => Promise<E2EActionResult>
}

export type E2EActionHooks = {
  reattachRuntime?: () => void | Promise<void>
}

export type E2EVisibleRow = {
  messageId: string
  serializedKey: string
  top: number
  bottom: number
  height: number
}

export type E2EEvidence = {
  schemaVersion: 1
  scenarioId: string
  checkpointId: string
  timestamp: number
  feed: {
    activeFeedId: string
    generation: number
    dataRevision: number
    projectionRevision: number
    messageCount: number
    loadedMessageCount: number
    hasMoreBefore: boolean
    hasMoreAfter: boolean
  }
  runtime: E2EState['runtime']
  viewport: {
    scrollTop: number
    scrollHeight: number
    clientHeight: number
    distanceToBottom: number
    topSpacer: number
    bottomSpacer: number
    renderedRows: number
    visibleRows: E2EVisibleRow[]
  }
  anchors: {
    current: {
      messageId: string
      serializedKey: string
      offsetWithinMessage: number
      top: number
    } | null
  }
  ui: E2EState['ui']
  events: E2EEventEvidence
  diagnostics: {
    recent: Array<{
      channel: string
      severity: string
      name: string
      correlationId?: string
      details: Record<string, unknown>
    }>
  }
  console: {
    errors: E2EConsoleRecord[]
    warnings: E2EConsoleRecord[]
  }
}

export type E2EEventEvidence = {
  viewportAnchorChanged: Array<{
    reason: string
    messageId: string | null
    offsetWithinMessage: number | null
  }>
  needMoreBefore: number
  needMoreAfter: number
  needMessagesAround: Array<{
    reason: string
    messageId: string
    position?: number
  }>
  destinationSettled: Array<{
    intent: string
    resolution?: string
    targetMessageId?: string
    resolvedMessageId?: string
  }>
  viewportErrors: string[]
}

export type E2EConsoleRecord = {
  text: string
}

export type E2EConsoleBuffer = {
  errors: E2EConsoleRecord[]
  warnings: E2EConsoleRecord[]
}

export type E2EEventBuffer = E2EEventEvidence

const E2E_CONSOLE_BUFFER_LIMIT = 80
const E2E_EVENT_BUFFER_LIMIT = 80
const E2E_DIAGNOSTIC_BUFFER_LIMIT = 80

const PRIORITY_DIAGNOSTIC_NAMES = new Set([
  'projection.publish',
  'transaction',
  'correction.anchorPreserved',
  'measurement.readiness',
  'destinationMotion.start',
  'destinationMotion.settle',
  'destinationMotion.cancel',
  'data.setSnapshot',
  'data.windowBudgetExceeded',
])
const PRIORITY_DIAGNOSTIC_PREFIXES = Array.from(PRIORITY_DIAGNOSTIC_NAMES)

declare global {
  interface Window {
    __X_MESSAGE_LIST_E2E__?: XMessageListE2EBridge
  }
}

export function createE2EConsoleBuffer(): E2EConsoleBuffer {
  return {
    errors: [],
    warnings: [],
  }
}

export function clearE2EConsoleBuffer(buffer: E2EConsoleBuffer): void {
  buffer.errors.length = 0
  buffer.warnings.length = 0
}

export function createE2EEventBuffer(): E2EEventBuffer {
  return {
    viewportAnchorChanged: [],
    needMoreBefore: 0,
    needMoreAfter: 0,
    needMessagesAround: [],
    destinationSettled: [],
    viewportErrors: [],
  }
}

export function clearE2EEventBuffer(buffer: E2EEventBuffer): void {
  buffer.viewportAnchorChanged.length = 0
  buffer.needMoreBefore = 0
  buffer.needMoreAfter = 0
  buffer.needMessagesAround.length = 0
  buffer.destinationSettled.length = 0
  buffer.viewportErrors.length = 0
}

export function recordE2ERuntimeEvent(
  buffer: E2EEventBuffer,
  event: MessageViewportRuntimeEvent,
): void {
  if (event.type === 'viewportAnchorChanged') {
    const key = event.anchor?.key
    pushBounded(
      buffer.viewportAnchorChanged,
      {
        reason: event.reason,
        messageId: key?.kind === 'committed' ? key.messageId : null,
        offsetWithinMessage: event.anchor?.offsetWithinMessage ?? null,
      },
      E2E_EVENT_BUFFER_LIMIT,
    )
    return
  }

  if (event.type === 'needMoreBefore') {
    buffer.needMoreBefore += 1
    return
  }

  if (event.type === 'needMoreAfter') {
    buffer.needMoreAfter += 1
    return
  }

  if (event.type === 'needMessagesAround') {
    pushBounded(
      buffer.needMessagesAround,
      {
        reason: event.reason,
        messageId: event.target.messageId,
        position: event.target.position,
      },
      E2E_EVENT_BUFFER_LIMIT,
    )
    return
  }

  if (event.type === 'destinationSettled') {
    pushBounded(
      buffer.destinationSettled,
      {
        intent: event.intent,
        resolution: event.resolution,
        targetMessageId: event.target.messageId,
        resolvedMessageId: event.resolvedTarget?.messageId,
      },
      E2E_EVENT_BUFFER_LIMIT,
    )
    return
  }

  if (event.type === 'viewportError') {
    pushBounded(buffer.viewportErrors, event.code, E2E_EVENT_BUFFER_LIMIT)
  }
}

export function installE2EConsoleCapture(buffer: E2EConsoleBuffer): () => void {
  const originalError = window.console.error
  const originalWarn = window.console.warn

  const captureError = (...args: unknown[]) => {
    pushBounded(
      buffer.errors,
      { text: formatConsoleArgs(args) },
      E2E_CONSOLE_BUFFER_LIMIT,
    )
    originalError.apply(window.console, args)
  }

  const captureWarn = (...args: unknown[]) => {
    pushBounded(
      buffer.warnings,
      { text: formatConsoleArgs(args) },
      E2E_CONSOLE_BUFFER_LIMIT,
    )
    originalWarn.apply(window.console, args)
  }

  window.console.error = captureError
  window.console.warn = captureWarn

  return () => {
    if (window.console.error === captureError) {
      window.console.error = originalError
    }

    if (window.console.warn === captureWarn) {
      window.console.warn = originalWarn
    }
  }
}

export function collectE2EState(input: {
  scenarioId: string
  scenario: DemoMessageScenario
  consoleBuffer: E2EConsoleBuffer
  root?: ParentNode
}): E2EState {
  const snapshot = input.scenario.activeRuntime.getSnapshot()
  const debug = input.scenario.activeRuntime.getDebugSnapshot()
  const viewportMetrics = readViewportMetrics(input.root ?? document)
  const diagnostics = input.scenario.activeRuntime.getDiagnosticRecords()
  const lastViewportError =
    diagnostics.findLast((record) => record.severity === 'error')?.name ?? null

  const runtime = {
    state: debug.state,
    readySubstate: debug.readySubstate,
    viewportPhase: debug.viewportPhase,
    transactionState: debug.transactionState,
    destinationState: debug.destinationState,
    bottomLockState: snapshot.bottomLockState,
    pendingCommands: debug.pendingCommands,
    motionActive: debug.motionActive,
    observedRows: debug.observedRows,
    heightCacheSize: debug.heightCacheSize,
    lastScrollSource: debug.lastScrollSource,
  }

  const state: E2EState = {
    scenarioId: input.scenarioId,
    scenarioStatus: 'booting',
    feed: {
      activeFeedId: input.scenario.activeFeedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
      title: input.scenario.activeFeed.title,
    },
    runtime,
    viewport: {
      ...viewportMetrics,
      topSpacer: snapshot.topSpacer,
      bottomSpacer: snapshot.bottomSpacer,
    },
    ui: {
      feedLoading: input.scenario.feedLoading,
      loadingBefore: input.scenario.loadingBefore,
      loadingAfter: input.scenario.loadingAfter,
      eventStormRunning: input.scenario.eventStormRunning,
      botPushActive: input.scenario.botPushActive,
      dynamicHeightEnabled: isDynamicHeightEnabled(input.root ?? document),
      pendingOperation: input.scenario.pendingOperation,
      lastEvent: input.scenario.lastEvent,
      followBottomVisible: isFollowBottomVisible(input.root ?? document),
      highlightedMessageId: input.scenario.highlightedMessageId,
    },
    safety: {
      consoleErrors: input.consoleBuffer.errors.length,
      consoleWarnings: input.consoleBuffer.warnings.length,
      lastViewportError,
    },
  }

  return {
    ...state,
    scenarioStatus: resolveScenarioStatus(state),
  }
}

export function collectE2EEvidence(input: {
  scenarioId: string
  checkpointId: string
  scenario: DemoMessageScenario
  consoleBuffer: E2EConsoleBuffer
  eventBuffer: E2EEventBuffer
  root?: ParentNode
}): E2EEvidence {
  const root = input.root ?? document
  const snapshot = input.scenario.activeRuntime.getSnapshot()
  const state = collectE2EState({
    scenarioId: input.scenarioId,
    scenario: input.scenario,
    consoleBuffer: input.consoleBuffer,
    root,
  })
  const container = getScrollContainer(root)
  const visibleRows = container ? getVisibleRows(root, container) : []
  const currentAnchor = getCurrentAnchorEvidence(input.scenario, root, container)

  return {
    schemaVersion: 1,
    scenarioId: input.scenarioId,
    checkpointId: input.checkpointId,
    timestamp: Date.now(),
    feed: {
      activeFeedId: input.scenario.activeFeedId,
      generation: snapshot.generation,
      dataRevision: snapshot.revision,
      projectionRevision: snapshot.revision,
      messageCount: input.scenario.messageCount,
      loadedMessageCount: input.scenario.loadedMessageCount,
      hasMoreBefore: input.scenario.hasMoreBefore,
      hasMoreAfter: input.scenario.hasMoreAfter,
    },
    runtime: state.runtime,
    viewport: {
      scrollTop: state.viewport.scrollTop,
      scrollHeight: state.viewport.scrollHeight,
      clientHeight: state.viewport.clientHeight,
      distanceToBottom: state.viewport.distanceToBottom,
      topSpacer: snapshot.topSpacer,
      bottomSpacer: snapshot.bottomSpacer,
      renderedRows: root.querySelectorAll('[data-message-row]').length,
      visibleRows,
    },
    anchors: {
      current: currentAnchor,
    },
    ui: state.ui,
    events: {
      viewportAnchorChanged: [...input.eventBuffer.viewportAnchorChanged],
      needMoreBefore: input.eventBuffer.needMoreBefore,
      needMoreAfter: input.eventBuffer.needMoreAfter,
      needMessagesAround: [...input.eventBuffer.needMessagesAround],
      destinationSettled: [...input.eventBuffer.destinationSettled],
      viewportErrors: [...input.eventBuffer.viewportErrors],
    },
    diagnostics: {
      recent: normalizeDiagnosticRecords(
        input.scenario.activeRuntime.getDiagnosticRecords(),
      ),
    },
    console: {
      errors: [...input.consoleBuffer.errors],
      warnings: [...input.consoleBuffer.warnings],
    },
  }
}

export function createBootingE2EState(scenarioId: string): E2EState {
  return {
    scenarioId,
    scenarioStatus: 'booting',
    feed: {
      activeFeedId: '',
      generation: 0,
      revision: 0,
      title: '',
    },
    runtime: {
      state: 'INITIAL',
      readySubstate: 'READY_IDLE',
      viewportPhase: 'IDLE',
      transactionState: 'idle',
      destinationState: 'idle',
      bottomLockState: 'UNLOCKED',
      pendingCommands: 0,
      motionActive: false,
      observedRows: 0,
      heightCacheSize: 0,
      lastScrollSource: null,
    },
    viewport: {
      scrollTop: 0,
      scrollHeight: 0,
      clientHeight: 0,
      distanceToBottom: 0,
      topSpacer: 0,
      bottomSpacer: 0,
      visibleMessageIds: [],
      firstVisibleMessageId: null,
      lastVisibleMessageId: null,
    },
    ui: {
      feedLoading: true,
      loadingBefore: false,
      loadingAfter: false,
      eventStormRunning: false,
      botPushActive: false,
      dynamicHeightEnabled: false,
      pendingOperation: 'booting',
      lastEvent: 'booting e2e host',
      followBottomVisible: false,
      highlightedMessageId: null,
    },
    safety: {
      consoleErrors: 0,
      consoleWarnings: 0,
      lastViewportError: null,
    },
  }
}

export function listE2EActions(state: E2EState): E2EActionDescriptor[] {
  const pageReady =
    state.scenarioStatus === 'ready' ||
    (state.scenarioStatus === 'running' && isRuntimeStableForSemanticAction(state))
  const feedReady = !state.ui.feedLoading
  const canPageBefore = pageReady && state.feed.activeFeedId.length > 0
  const canInteractDuringPrepend =
    feedReady && hasPendingOperation(state, 'history.prepend')

  return [
    {
      id: 'wait_for_ready',
      label: 'Wait for ready',
      category: 'bootstrap',
      enabled: true,
    },
    {
      id: 'wait_for_idle',
      label: 'Wait for idle',
      category: 'bootstrap',
      enabled: true,
    },
    {
      id: 'collect_evidence',
      label: 'Collect evidence',
      category: 'evidence',
      enabled: true,
    },
    {
      id: 'scroll_to_middle',
      label: 'Scroll to middle',
      category: 'scroll',
      enabled: pageReady,
      reasonDisabled: pageReady ? undefined : 'scenario is not ready',
    },
    {
      id: 'scroll_to_history_top',
      label: 'Scroll to history top',
      category: 'scroll',
      enabled: canPageBefore || canInteractDuringPrepend,
      reasonDisabled: canPageBefore || canInteractDuringPrepend
        ? undefined
        : 'scenario is not ready',
    },
    {
      id: 'scroll_to_bottom',
      label: 'Scroll to bottom',
      category: 'scroll',
      enabled: pageReady,
      reasonDisabled: pageReady ? undefined : 'scenario is not ready',
    },
    {
      id: 'append_message',
      label: 'Append message',
      category: 'message',
      enabled: pageReady && feedReady,
      reasonDisabled: pageReady && feedReady ? undefined : 'feed is not ready',
    },
    {
      id: 'prepend_history',
      label: 'Prepend history',
      category: 'paging',
      enabled: (pageReady && feedReady) || canInteractDuringPrepend,
      reasonDisabled: (pageReady && feedReady) || canInteractDuringPrepend
        ? undefined
        : 'feed is not ready',
    },
    {
      id: 'start_prepend_history',
      label: 'Start prepend history',
      category: 'paging',
      enabled: pageReady && feedReady,
      reasonDisabled: pageReady && feedReady ? undefined : 'feed is not ready',
    },
    {
      id: 'send_message',
      label: 'Send message',
      category: 'message',
      enabled: pageReady && feedReady,
      reasonDisabled: pageReady && feedReady ? undefined : 'feed is not ready',
      payloadSchema: {
        body: 'string',
        waitFor: ['optimistic', 'idle'],
      },
    },
    {
      id: 'follow_bottom',
      label: 'Follow bottom',
      category: 'destination',
      enabled: pageReady && feedReady,
      reasonDisabled: pageReady && feedReady ? undefined : 'feed is not ready',
    },
    {
      id: 'jump_to_quoted_message',
      label: 'Jump to quoted message',
      category: 'destination',
      enabled: pageReady && feedReady,
      reasonDisabled: pageReady && feedReady ? undefined : 'feed is not ready',
    },
    {
      id: 'switch_feed',
      label: 'Switch feed',
      category: 'feed',
      enabled: pageReady,
      reasonDisabled: pageReady ? undefined : 'scenario is not ready',
      payloadSchema: {
        feedId: 'string',
      },
    },
    {
      id: 'toggle_dynamic_height',
      label: 'Toggle dynamic height',
      category: 'mock',
      enabled: pageReady && feedReady,
      reasonDisabled: pageReady && feedReady ? undefined : 'feed is not ready',
    },
    {
      id: 'drag_scrollbar_to_top',
      label: 'Drag scrollbar to top',
      category: 'scroll',
      enabled: pageReady,
      reasonDisabled: pageReady ? undefined : 'scenario is not ready',
    },
    {
      id: 'drag_scrollbar_to_bottom',
      label: 'Drag scrollbar to bottom',
      category: 'scroll',
      enabled: pageReady,
      reasonDisabled: pageReady ? undefined : 'scenario is not ready',
    },
    {
      id: 'reattach_runtime',
      label: 'Detach and attach runtime',
      category: 'mock',
      enabled: pageReady,
      reasonDisabled: pageReady ? undefined : 'scenario is not ready',
    },
    {
      id: 'toggle_event_storm',
      label: 'Toggle event storm',
      category: 'mock',
      enabled: pageReady && feedReady,
      reasonDisabled: pageReady && feedReady ? undefined : 'feed is not ready',
    },
    {
      id: 'toggle_bot_push',
      label: 'Toggle bot push',
      category: 'mock',
      enabled: pageReady && feedReady,
      reasonDisabled: pageReady && feedReady ? undefined : 'feed is not ready',
    },
  ]
}

export async function runE2EAction(input: {
  actionId: string
  payload?: Record<string, unknown>
  scenarioId: string
  scenario: DemoMessageScenario
  consoleBuffer: E2EConsoleBuffer
  eventBuffer: E2EEventBuffer
  actionHooks?: E2EActionHooks
  root?: ParentNode
  readState: () => E2EState
  readEvidence: (checkpointId: string) => E2EEvidence
}): Promise<E2EActionResult> {
  const checkpointId = getPayloadString(input.payload, 'checkpointId')
  const before = input.readEvidence(`before:${input.actionId}`)
  const descriptor = listE2EActions(input.readState()).find(
    (action) => action.id === input.actionId,
  )

  if (!descriptor) {
    return {
      ok: false,
      actionId: input.actionId,
      message: `unknown e2e action ${input.actionId}`,
      before,
      error: {
        code: 'unknown_action',
        details: { actionId: input.actionId },
      },
    }
  }

  if (!descriptor.enabled) {
    return {
      ok: false,
      actionId: input.actionId,
      message: descriptor.reasonDisabled ?? `${input.actionId} is disabled`,
      before,
      error: {
        code: 'action_disabled',
        details: {
          actionId: input.actionId,
          reason: descriptor.reasonDisabled,
        },
      },
    }
  }

  try {
    switch (input.actionId) {
      case 'wait_for_ready':
        await waitForCondition(
          input.readState,
          (state) =>
            isReadyForAction(state, {
              allowedViewportErrors: getPayloadStringArray(
                input.payload,
                'allowViewportErrors',
              ),
              observedViewportErrors: input.eventBuffer.viewportErrors,
            }),
          {
            timeoutMs: getPayloadNumber(input.payload, 'timeoutMs') ?? 5_000,
            failureCode: 'wait_for_ready_timeout',
          },
        )
        break
      case 'wait_for_idle':
        await waitForCondition(input.readState, isRuntimeIdleForAction, {
          timeoutMs: getPayloadNumber(input.payload, 'timeoutMs') ?? 5_000,
          failureCode: 'wait_for_idle_timeout',
        })
        break
      case 'collect_evidence':
        break
      case 'scroll_to_middle':
        scrollToViewportRatio(input.scenario, input.root ?? document, 0.5)
        await waitForActionPublication()
        await waitForCondition(input.readState, isRuntimeStableForSemanticAction, {
          timeoutMs: getPayloadNumber(input.payload, 'timeoutMs') ?? 5_000,
          failureCode: 'scroll_to_middle_timeout',
        })
        break
      case 'scroll_to_history_top':
        scrollToViewportTop(input.scenario, input.root ?? document)
        await waitForActionPublication()
        await waitForCondition(input.readState, isRuntimeIdleForAction, {
          timeoutMs: getPayloadNumber(input.payload, 'timeoutMs') ?? 7_000,
          failureCode: 'scroll_to_history_top_timeout',
        })
        break
      case 'scroll_to_bottom':
        scrollToViewportBottom(input.scenario, input.root ?? document)
        await waitForActionPublication()
        await waitForCondition(input.readState, isRuntimeStableForSemanticAction, {
          timeoutMs: getPayloadNumber(input.payload, 'timeoutMs') ?? 5_000,
          failureCode: 'scroll_to_bottom_timeout',
        })
        break
      case 'append_message':
        input.scenario.appendMessage()
        await waitForActionPublication()
        await waitForCondition(input.readState, isRuntimeIdleForAction, {
          timeoutMs: getPayloadNumber(input.payload, 'timeoutMs') ?? 7_000,
          failureCode: 'append_message_timeout',
        })
        break
      case 'prepend_history':
        input.scenario.loadHistoryBatch('manual')
        await waitForActionPublication()
        await waitForCondition(input.readState, isRuntimeIdleForAction, {
          timeoutMs: getPayloadNumber(input.payload, 'timeoutMs') ?? 7_000,
          failureCode: 'prepend_history_timeout',
        })
        break
      case 'start_prepend_history':
        input.scenario.loadHistoryBatch('manual')
        await waitForActionPublication()
        await waitForCondition(input.readState, isHistoryPrependPendingForAction, {
          timeoutMs: getPayloadNumber(input.payload, 'timeoutMs') ?? 2_000,
          failureCode: 'start_prepend_history_timeout',
        })
        break
      case 'send_message': {
        const body = getPayloadString(input.payload, 'body')

        if (!body) {
          throw new E2EActionError(
            'missing_send_body',
            'send_message requires a non-empty body payload',
          )
        }

        const accepted = input.scenario.sendMessage(body)

        if (!accepted) {
          throw new E2EActionError(
            'send_message_rejected',
            'scenario rejected the send_message payload',
          )
        }

        await waitForActionPublication()

        if (getPayloadString(input.payload, 'waitFor') === 'optimistic') {
          await waitForEvidence(
            input.readEvidence,
            (evidence) =>
              hasVisibleOptimisticRow(evidence) &&
              hasPendingOperationEvidence(evidence, 'message.send'),
            {
              checkpointId: checkpointId ?? `after:${input.actionId}`,
              timeoutMs: getPayloadNumber(input.payload, 'timeoutMs') ?? 5_000,
              failureCode: 'send_message_optimistic_timeout',
            },
          )
          break
        }

        await waitForCondition(input.readState, isRuntimeIdleForAction, {
          timeoutMs: getPayloadNumber(input.payload, 'timeoutMs') ?? 7_000,
          failureCode: 'send_message_timeout',
        })
        break
      }
      case 'follow_bottom':
        input.scenario.followBottom('floating')
        await waitForActionPublication()
        await waitForCondition(input.readState, isRuntimeStableForSemanticAction, {
          timeoutMs: getPayloadNumber(input.payload, 'timeoutMs') ?? 7_000,
          failureCode: 'follow_bottom_timeout',
        })
        break
      case 'jump_to_quoted_message':
        clickVisibleQuote(input.root ?? document)
        await waitForActionPublication()
        await waitForCondition(input.readState, isRuntimeStableForSemanticAction, {
          timeoutMs: getPayloadNumber(input.payload, 'timeoutMs') ?? 7_000,
          failureCode: 'jump_to_quoted_message_timeout',
        })
        break
      case 'switch_feed':
        input.scenario.selectFeed(
          getPayloadString(input.payload, 'feedId') ??
            getNextFeedId(input.scenario),
        )
        await waitForActionPublication()
        await waitForCondition(input.readState, isRuntimeIdleForAction, {
          timeoutMs: getPayloadNumber(input.payload, 'timeoutMs') ?? 10_000,
          failureCode: 'switch_feed_timeout',
        })
        break
      case 'toggle_dynamic_height':
        input.scenario.toggleDynamicHeight()
        await waitForActionPublication()
        await waitForCondition(input.readState, isRuntimeIdleForAction, {
          timeoutMs: getPayloadNumber(input.payload, 'timeoutMs') ?? 7_000,
          failureCode: 'toggle_dynamic_height_timeout',
        })
        break
      case 'drag_scrollbar_to_top':
        dragScrollbarToTop(input.scenario, input.root ?? document)
        await waitForActionPublication()
        await waitForCondition(input.readState, isRuntimeStableForSemanticAction, {
          timeoutMs: getPayloadNumber(input.payload, 'timeoutMs') ?? 7_000,
          failureCode: 'drag_scrollbar_to_top_timeout',
        })
        break
      case 'drag_scrollbar_to_bottom':
        dragScrollbarToBottom(input.scenario, input.root ?? document)
        await waitForActionPublication()
        await waitForCondition(input.readState, isRuntimeStableForSemanticAction, {
          timeoutMs: getPayloadNumber(input.payload, 'timeoutMs') ?? 7_000,
          failureCode: 'drag_scrollbar_to_bottom_timeout',
        })
        break
      case 'reattach_runtime':
        if (input.actionHooks?.reattachRuntime) {
          await input.actionHooks.reattachRuntime()
        } else {
          reattachRuntime(input.scenario, input.root ?? document)
        }
        await waitForActionPublication()
        await waitForCondition(input.readState, isRuntimeReattachedForAction, {
          timeoutMs: getPayloadNumber(input.payload, 'timeoutMs') ?? 7_000,
          failureCode: 'reattach_runtime_timeout',
        })
        break
      case 'toggle_event_storm': {
        const wasEventStormRunning = input.readState().ui.eventStormRunning
        input.scenario.toggleEventStorm()
        await waitForActionPublication()
        await waitForCondition(
          input.readState,
          wasEventStormRunning
            ? isRuntimeIdleForAction
            : isEventStormActiveForAction,
          {
            timeoutMs: getPayloadNumber(input.payload, 'timeoutMs') ?? 7_000,
            failureCode: 'toggle_event_storm_timeout',
          },
        )
        break
      }
      case 'toggle_bot_push': {
        const wasBotPushActive = input.readState().ui.botPushActive
        input.scenario.toggleBotPush()
        await waitForActionPublication()
        await waitForCondition(
          input.readState,
          wasBotPushActive ? isRuntimeIdleForAction : isBotPushActiveForAction,
          {
            timeoutMs: getPayloadNumber(input.payload, 'timeoutMs') ?? 7_000,
            failureCode: 'toggle_bot_push_timeout',
          },
        )
        break
      }
    }

    return {
      ok: true,
      actionId: input.actionId,
      message: `completed ${input.actionId}`,
      before,
      after: input.readEvidence(checkpointId ?? `after:${input.actionId}`),
    }
  } catch (error) {
    return {
      ok: false,
      actionId: input.actionId,
      message: error instanceof E2EActionError
        ? error.message
        : `failed ${input.actionId}`,
      before,
      after: input.readEvidence(`error:${input.actionId}`),
      error: {
        code: error instanceof E2EActionError ? error.code : 'action_failed',
        details: {
          reason: error instanceof Error ? error.message : String(error),
        },
      },
    }
  }
}

function resolveScenarioStatus(state: E2EState): E2EScenarioStatus {
  if (state.safety.consoleErrors > 0 || state.safety.lastViewportError) {
    return 'failed'
  }

  if (
    state.ui.feedLoading ||
    (state.runtime.state !== 'READY' &&
      state.runtime.state !== 'READY_EMPTY' &&
      state.feed.revision === 0)
  ) {
    return 'booting'
  }

  if (
    state.ui.pendingOperation !== 'idle' ||
    state.runtime.transactionState === 'active' ||
    state.runtime.transactionState === 'settling' ||
    state.runtime.motionActive ||
    state.ui.loadingBefore ||
    state.ui.loadingAfter
  ) {
    return 'running'
  }

  return 'ready'
}

class E2EActionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function isReadyForAction(state: E2EState, options: {
  allowedViewportErrors?: string[]
  observedViewportErrors?: string[]
} = {}): boolean {
  if (state.scenarioStatus === 'ready') {
    return true
  }

  const allowedViewportErrors = options.allowedViewportErrors ?? []

  return (
    hasOnlyExpectedViewportErrors(
      allowedViewportErrors,
      options.observedViewportErrors ?? [],
      state.safety.lastViewportError,
    ) &&
    state.safety.consoleErrors === 0 &&
    isRuntimeIdleForAction(state)
  )
}

function hasOnlyExpectedViewportErrors(
  allowedViewportErrors: string[],
  observedViewportErrors: string[],
  fallbackLastViewportError: string | null,
): boolean {
  if (allowedViewportErrors.length === 0) {
    return false
  }

  if (observedViewportErrors.length > 0) {
    return observedViewportErrors.every((error) =>
      allowedViewportErrors.includes(error),
    )
  }

  return Boolean(
    fallbackLastViewportError &&
      allowedViewportErrors.includes(fallbackLastViewportError),
  )
}

function isRuntimeIdleForAction(state: E2EState): boolean {
  return isRuntimeStable(state) && state.ui.pendingOperation === 'idle'
}

function isRuntimeStableForSemanticAction(state: E2EState): boolean {
  return isRuntimeStable(state) && hasOnlyLongRunningMockOperations(state)
}

function isRuntimeReattachedForAction(state: E2EState): boolean {
  return isRuntimeIdleForAction(state) && state.runtime.observedRows > 0
}

function isHistoryPrependPendingForAction(state: E2EState): boolean {
  return state.ui.loadingBefore || hasPendingOperation(state, 'history.prepend')
}

function isEventStormActiveForAction(state: E2EState): boolean {
  return (
    isRuntimeStableForSemanticAction(state) &&
    state.ui.eventStormRunning &&
    hasPendingOperation(state, 'mock.eventStorm')
  )
}

function isBotPushActiveForAction(state: E2EState): boolean {
  return (
    isRuntimeStableForSemanticAction(state) &&
    state.ui.botPushActive &&
    hasPendingOperation(state, 'mock.botPush')
  )
}

function isRuntimeStable(state: E2EState): boolean {
  return (
    (state.runtime.state === 'READY' || state.runtime.state === 'READY_EMPTY') &&
    state.runtime.transactionState === 'idle' &&
    (state.runtime.destinationState === 'idle' ||
      state.runtime.destinationState === 'settled') &&
    state.runtime.pendingCommands === 0 &&
    !state.runtime.motionActive &&
    !state.ui.feedLoading &&
    !state.ui.loadingBefore &&
    !state.ui.loadingAfter
  )
}

function hasOnlyLongRunningMockOperations(state: E2EState): boolean {
  const operations = parsePendingOperations(state.ui.pendingOperation)

  return operations.every(
    (operation) =>
      operation === 'mock.eventStorm' || operation === 'mock.botPush',
  )
}

function hasPendingOperation(state: E2EState, operation: string): boolean {
  return parsePendingOperations(state.ui.pendingOperation).includes(operation)
}

function parsePendingOperations(pendingOperation: string): string[] {
  if (pendingOperation === 'idle') {
    return []
  }

  return pendingOperation
    .split('+')
    .map((operation) => operation.trim())
    .filter((operation) => operation.length > 0)
}

function hasPendingOperationEvidence(
  evidence: E2EEvidence,
  operation: string,
): boolean {
  return parsePendingOperations(evidence.ui.pendingOperation).includes(operation)
}

function hasVisibleOptimisticRow(evidence: E2EEvidence): boolean {
  return evidence.viewport.visibleRows.some((row) =>
    row.serializedKey.startsWith('optimistic:'),
  )
}

async function waitForCondition(
  readState: () => E2EState,
  predicate: (state: E2EState) => boolean,
  input: {
    timeoutMs: number
    failureCode: string
  },
): Promise<void> {
  const startedAt = performance.now()
  let lastState = readState()

  while (performance.now() - startedAt <= input.timeoutMs) {
    lastState = readState()

    if (predicate(lastState)) {
      return
    }

    await delay(50)
  }

  throw new E2EActionError(
    input.failureCode,
    `${input.failureCode}: runtime=${lastState.runtime.state}/${lastState.runtime.transactionState}, pending=${lastState.ui.pendingOperation}`,
  )
}

async function waitForEvidence(
  readEvidence: (checkpointId: string) => E2EEvidence,
  predicate: (evidence: E2EEvidence) => boolean,
  input: {
    checkpointId: string
    timeoutMs: number
    failureCode: string
  },
): Promise<void> {
  const startedAt = performance.now()
  let lastEvidence = readEvidence(input.checkpointId)

  while (performance.now() - startedAt <= input.timeoutMs) {
    lastEvidence = readEvidence(input.checkpointId)

    if (predicate(lastEvidence)) {
      return
    }

    await delay(50)
  }

  throw new E2EActionError(
    input.failureCode,
    `${input.failureCode}: visible=${lastEvidence.viewport.visibleRows
      .map((row) => row.serializedKey)
      .join(',')}, pending=${lastEvidence.ui.pendingOperation}`,
  )
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, timeoutMs)
  })
}

async function waitForActionPublication(): Promise<void> {
  await delay(0)

  if (typeof window.requestAnimationFrame !== 'function') {
    await delay(0)
    return
  }

  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve())
  })
}

function scrollToViewportRatio(
  scenario: DemoMessageScenario,
  root: ParentNode,
  ratio: number,
): void {
  const container = assertScrollContainer(root)
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
  writeScrollTop(scenario, maxScrollTop * ratio)
}

function scrollToViewportTop(
  scenario: DemoMessageScenario,
  root: ParentNode,
): void {
  assertScrollContainer(root)
  writeScrollTop(scenario, 0)
}

function scrollToViewportBottom(
  scenario: DemoMessageScenario,
  root: ParentNode,
): void {
  const container = assertScrollContainer(root)
  writeScrollTop(scenario, container.scrollHeight - container.clientHeight)
}

function dragScrollbarToTop(
  scenario: DemoMessageScenario,
  root: ParentNode,
): void {
  assertScrollContainer(root)
  writeScrollTop(scenario, 0, 'custom-scrollbar-drag')
}

function dragScrollbarToBottom(
  scenario: DemoMessageScenario,
  root: ParentNode,
): void {
  const container = assertScrollContainer(root)
  writeScrollTop(
    scenario,
    container.scrollHeight - container.clientHeight,
    'custom-scrollbar-drag',
  )
}

function reattachRuntime(
  scenario: DemoMessageScenario,
  root: ParentNode,
): void {
  const container = assertScrollContainer(root)

  scenario.activeRuntime.detach()
  scenario.activeRuntime.attach(container)
}

function assertScrollContainer(root: ParentNode): HTMLElement {
  const container = getScrollContainer(root)

  if (!container) {
    throw new E2EActionError(
      'missing_scroll_container',
      'message scroll container is not mounted',
    )
  }

  return container
}

function writeScrollTop(
  scenario: DemoMessageScenario,
  scrollTop: number,
  source: 'custom-scrollbar-track' | 'custom-scrollbar-drag' =
    'custom-scrollbar-track',
): void {
  const nextScrollTop = Math.max(0, scrollTop)
  const input = { source }

  scenario.activeRuntime.beginDirectScroll(input)
  const committed = scenario.activeRuntime.writeDirectScrollTop(nextScrollTop, input)
  scenario.activeRuntime.endDirectScroll(input)

  if (!committed) {
    throw new E2EActionError(
      'direct_scroll_rejected',
      'runtime rejected direct scroll input',
    )
  }
}

function clickVisibleQuote(root: ParentNode): void {
  const container = assertScrollContainer(root)
  const viewportRect = container.getBoundingClientRect()
  const quote = Array.from(
    root.querySelectorAll<HTMLElement>('[data-ai-action="jump-to-quote"]'),
  ).find((candidate) => {
    const row = candidate.closest<HTMLElement>('[data-message-row]')
    const rect = (row ?? candidate).getBoundingClientRect()

    return rect.bottom > viewportRect.top && rect.top < viewportRect.bottom
  })

  if (!quote) {
    throw new E2EActionError(
      'missing_visible_quote',
      'no visible quote action is available',
    )
  }

  quote.click()
}

function getNextFeedId(scenario: DemoMessageScenario): string {
  const nextFeed = scenario.feeds.find((feed) => feed.id !== scenario.activeFeedId)

  if (!nextFeed) {
    throw new E2EActionError(
      'missing_alternate_feed',
      'no alternate feed is available',
    )
  }

  return nextFeed.id
}

function getPayloadString(
  payload: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = payload?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function getPayloadNumber(
  payload: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = payload?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function getPayloadStringArray(
  payload: Record<string, unknown> | undefined,
  key: string,
): string[] {
  const value = payload?.[key]

  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(
    (item): item is string => typeof item === 'string' && item.length > 0,
  )
}

function readViewportMetrics(root: ParentNode): E2EState['viewport'] {
  const container = getScrollContainer(root)

  if (!container) {
    return {
      scrollTop: 0,
      scrollHeight: 0,
      clientHeight: 0,
      distanceToBottom: 0,
      topSpacer: 0,
      bottomSpacer: 0,
      visibleMessageIds: [],
      firstVisibleMessageId: null,
      lastVisibleMessageId: null,
    }
  }

  const visibleMessageIds = getVisibleRows(root, container).map(
    (row) => row.messageId,
  )

  return {
    scrollTop: container.scrollTop,
    scrollHeight: container.scrollHeight,
    clientHeight: container.clientHeight,
    distanceToBottom: Math.max(
      0,
      container.scrollHeight - container.scrollTop - container.clientHeight,
    ),
    topSpacer: 0,
    bottomSpacer: 0,
    visibleMessageIds,
    firstVisibleMessageId: visibleMessageIds[0] ?? null,
    lastVisibleMessageId: visibleMessageIds.at(-1) ?? null,
  }
}

function getScrollContainer(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>(
    '[data-testid="message-scroll-container"]',
  )
}

function getVisibleRows(root: ParentNode, container: HTMLElement): E2EVisibleRow[] {
  const viewportRect = container.getBoundingClientRect()
  const rows = Array.from(
    root.querySelectorAll<HTMLElement>('[data-message-row]'),
  )

  return rows.flatMap((row) => {
    const rect = row.getBoundingClientRect()

    if (rect.bottom <= viewportRect.top || rect.top >= viewportRect.bottom) {
      return []
    }

    const serializedKey = row.dataset.messageRow
    const messageId =
      row.dataset.messageId ?? parseCommittedMessageId(row) ?? serializedKey

    return messageId && serializedKey
      ? [{
          messageId,
          serializedKey,
          top: rect.top - viewportRect.top,
          bottom: rect.bottom - viewportRect.top,
          height: rect.height,
        }]
      : []
  })
}

function getCurrentAnchorEvidence(
  scenario: DemoMessageScenario,
  root: ParentNode,
  container: HTMLElement | null,
): E2EEvidence['anchors']['current'] {
  const anchor = scenario.activeRuntime.getViewportAnchorState()

  if (!anchor || anchor.key.kind !== 'committed') {
    return null
  }

  const serializedKey = serializeRuntimeItemKey(anchor.key)
  const row = findMessageRowBySerializedKey(root, serializedKey)

  if (!row) {
    return null
  }

  const viewportTop = container?.getBoundingClientRect().top ?? 0
  const rect = row.getBoundingClientRect()

  return {
    messageId: anchor.key.messageId,
    serializedKey,
    offsetWithinMessage: anchor.offsetWithinMessage,
    top: rect.top - viewportTop,
  }
}

function findMessageRowBySerializedKey(
  root: ParentNode,
  serializedKey: string,
): HTMLElement | null {
  const rows = Array.from(
    root.querySelectorAll<HTMLElement>('[data-message-row]'),
  )

  return rows.find((row) => row.dataset.messageRow === serializedKey) ?? null
}

function normalizeDiagnosticRecords(
  records: ViewportDiagnosticRecord[],
): E2EEvidence['diagnostics']['recent'] {
  const selectedIndexes = new Set<number>()

  for (
    let index = records.length - 1;
    index >= 0 && selectedIndexes.size < E2E_DIAGNOSTIC_BUFFER_LIMIT;
    index -= 1
  ) {
    const record = records[index]

    if (record && isPriorityDiagnostic(record)) {
      selectedIndexes.add(index)
    }
  }

  for (
    let index = records.length - 1;
    index >= 0 && selectedIndexes.size < E2E_DIAGNOSTIC_BUFFER_LIMIT;
    index -= 1
  ) {
    selectedIndexes.add(index)
  }

  return Array.from(selectedIndexes)
    .sort((left, right) => left - right)
    .map((index) => records[index])
    .filter((record): record is ViewportDiagnosticRecord => Boolean(record))
    .map((record) => ({
      channel: record.channel,
      severity: record.severity,
      name: record.name,
      correlationId: record.correlationId,
      details: record.details,
    }))
}

function isPriorityDiagnostic(record: ViewportDiagnosticRecord): boolean {
  return (
    PRIORITY_DIAGNOSTIC_NAMES.has(record.name) ||
    PRIORITY_DIAGNOSTIC_PREFIXES.some((name) =>
      record.name.startsWith(`${name}.`),
    )
  )
}

function pushBounded<T>(target: T[], value: T, limit: number): void {
  target.push(value)

  if (target.length > limit) {
    target.splice(0, target.length - limit)
  }
}

function parseCommittedMessageId(row: HTMLElement): string | null {
  const serializedKey = row.dataset.messageRow
  const prefix = 'committed:'

  if (!serializedKey?.startsWith(prefix)) {
    return null
  }

  return serializedKey.slice(prefix.length)
}

function isDynamicHeightEnabled(root: ParentNode): boolean {
  return root.querySelector('.message-attachment') !== null
}

function isFollowBottomVisible(root: ParentNode): boolean {
  const button = root.querySelector<HTMLElement>(
    '[data-ai-action="follow-bottom"], [aria-label="Follow latest messages"]',
  )

  if (!button) {
    return false
  }

  const ownerWindow = button.ownerDocument.defaultView
  const style = ownerWindow?.getComputedStyle(button)

  if (
    style &&
    (style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0')
  ) {
    return false
  }

  const rects = Array.from(button.getClientRects())

  if (rects.length === 0) {
    return button.offsetParent !== null
  }

  return rects.some((rect) => rect.width > 0 && rect.height > 0)
}

function formatConsoleArgs(args: unknown[]): string {
  return args.map(formatConsoleArg).join(' ')
}

function formatConsoleArg(arg: unknown): string {
  if (typeof arg === 'string') {
    return arg
  }

  if (arg instanceof Error) {
    return arg.stack ?? arg.message
  }

  try {
    return JSON.stringify(arg)
  } catch {
    return String(arg)
  }
}
