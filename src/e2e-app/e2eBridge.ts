import type { DemoMessageScenario } from '../demo/useDemoMessageScenario'

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
  before?: unknown
  after?: unknown
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
  getEvidence: () => unknown
  resetScenario: (scenarioId: string) => Promise<E2EActionResult>
}

export type E2EConsoleRecord = {
  text: string
}

export type E2EConsoleBuffer = {
  errors: E2EConsoleRecord[]
  warnings: E2EConsoleRecord[]
}

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

export function installE2EConsoleCapture(buffer: E2EConsoleBuffer): () => void {
  const originalError = window.console.error
  const originalWarn = window.console.warn

  const captureError = (...args: unknown[]) => {
    buffer.errors.push({ text: formatConsoleArgs(args) })
    originalError.apply(window.console, args)
  }

  const captureWarn = (...args: unknown[]) => {
    buffer.warnings.push({ text: formatConsoleArgs(args) })
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
    },
    safety: {
      consoleErrors: 0,
      consoleWarnings: 0,
      lastViewportError: null,
    },
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

function readViewportMetrics(root: ParentNode): E2EState['viewport'] {
  const container = root.querySelector<HTMLElement>(
    '[data-testid="message-scroll-container"]',
  )

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

  const visibleMessageIds = getVisibleMessageIds(root, container)

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

function getVisibleMessageIds(root: ParentNode, container: HTMLElement): string[] {
  const viewportRect = container.getBoundingClientRect()
  const rows = Array.from(
    root.querySelectorAll<HTMLElement>('[data-message-row]'),
  )

  return rows.flatMap((row) => {
    const rect = row.getBoundingClientRect()

    if (rect.bottom <= viewportRect.top || rect.top >= viewportRect.bottom) {
      return []
    }

    const messageId = row.dataset.messageId ?? parseCommittedMessageId(row)
    return messageId ? [messageId] : []
  })
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
