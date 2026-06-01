import type { DemoMessageScenario } from '../../demo/scenario/demoScenarioTypes'
import type {
  E2EEvidence,
  E2ERuntimeEventRecord,
} from '../bridge/e2eBridge'
import {
  clickScrollbarTrack,
  continueHeldScrollbarToTop,
  dragScrollbarToBottom,
  dragScrollbarToTop,
  E2EActionError,
  holdScrollbarAtTop,
  releaseHeldScrollbar,
  scrollContainer,
} from './e2eDomActions'

export type BridgeActionContext = {
  actionId: string
  payload: Record<string, unknown>
  root: HTMLElement | null
  scenario: DemoMessageScenario
  remountViewport: () => void
  readEvidence: (checkpointId: string) => E2EEvidence
  captureCheckpoint: (checkpointId: string) => E2EEvidence
}

export async function runBridgeAction({
  actionId,
  payload,
  root,
  scenario,
  remountViewport,
  readEvidence,
  captureCheckpoint,
}: BridgeActionContext): Promise<void> {
  switch (actionId) {
    case 'wait_for_ready':
    case 'wait_for_idle':
      await waitForRuntimeIdle(readEvidence, 3_000)
      return
    case 'collect_evidence':
      await waitForAnimationFrame()
      await waitForAnimationFrame()
      return
    case 'scroll_to_middle':
      await wait(240)
      scrollContainer(root, 'middle')
      await waitForRuntimeIdle(readEvidence, 1_500)
      return
    case 'scroll_to_history_top':
      await wait(240)
      scrollContainer(root, 'top')
      await wait(120)
      await waitForRuntimeIdle(readEvidence, 2_000)
      return
    case 'trigger_before_edge':
      await triggerBeforeEdge({ payload, root, scenario, readEvidence, captureCheckpoint })
      return
    case 'scroll_to_bottom':
    case 'trigger_after_edge':
      await wait(240)
      scrollContainer(root, 'bottom')
      await wait(120)
      await waitForRuntimeIdle(readEvidence, 2_000)
      return
    case 'append_message':
      scenario.appendMessage({
        follow: payload.follow === 'preserve' ? 'preserve' :
          payload.follow === 'follow' ? 'follow' : undefined,
      })
      await wait(120)
      await waitForRuntimeIdle(readEvidence, 1_500)
      return
    case 'append_many':
      await appendMany({ payload, scenario, readEvidence })
      return
    case 'prepend_history':
      scenario.loadHistoryBatch()
      await waitForRuntimeIdle(readEvidence, 1_500)
      return
    case 'follow_bottom':
      scenario.followBottom()
      await waitForRuntimeIdle(readEvidence, 2_000)
      return
    case 'jump_to_first_loaded':
      scenario.jumpToQuote()
      await waitForRuntimeIdle(readEvidence, 1_500)
      return
    case 'jump_to_identity':
      await jumpToIdentity({ payload, scenario, readEvidence })
      return
    case 'jump_to_oldest':
      scenario.activeSession.commands.scrollToMessage({
        feedId: scenario.activeFeedId,
        stableId: `${scenario.activeFeedId}-0001`,
        serverId: `${scenario.activeFeedId}-0001`,
      })
      await waitForRuntimeIdle(readEvidence, 2_000)
      return
    case 'toggle_dynamic_height':
      scenario.toggleDynamicHeight()
      await waitForRuntimeIdle(readEvidence, 1_500)
      return
    case 'stream_current_row':
      scenario.streamCurrentRow()
      await waitForRuntimeIdle(readEvidence, 1_500)
      return
    case 'send_message':
      scenario.sendMessage(String(payload.body ?? `E2E send ${Date.now()}`))
      await wait(180)
      await waitForRuntimeIdle(readEvidence, 2_000)
      return
    case 'retry_failed_send':
      scenario.retryFailedSend(
        typeof payload.messageId === 'string' ? payload.messageId : undefined,
      )
      await wait(180)
      await waitForRuntimeIdle(readEvidence, 2_000)
      return
    case 'send_optimistic_message':
      scenario.sendOptimisticMessage()
      await waitForRuntimeIdle(readEvidence, 1_500)
      return
    case 'resolve_optimistic_remap':
      scenario.resolveOptimisticRemap()
      await waitForRuntimeIdle(readEvidence, 1_500)
      return
    case 'optimistic_server_remap':
      await scenario.sendOptimisticAndRemap()
      await waitForRuntimeIdle(readEvidence, 1_500)
      return
    case 'switch_feed_roundtrip':
      await switchFeedRoundtrip({ scenario, readEvidence })
      return
    case 'remount_viewport':
      remountViewport()
      await waitForRuntimeIdle(readEvidence, 1_500)
      return
    case 'start_event_storm':
      scenario.toggleEventStorm()
      await waitForRuntimeIdle(readEvidence, 1_000)
      return
    case 'stop_event_storm':
      if (scenario.eventStormRunning) scenario.toggleEventStorm()
      await waitForRuntimeIdle(readEvidence, 1_000)
      return
    case 'start_bot_push':
      scenario.toggleBotPush()
      await waitForRuntimeIdle(readEvidence, 1_000)
      return
    case 'stop_bot_push':
      if (scenario.botPushActive) scenario.toggleBotPush()
      await waitForRuntimeIdle(readEvidence, 1_000)
      return
    case 'drag_scrollbar_to_top':
      await dragScrollbarEdge({ root, readEvidence, edge: 'before' })
      return
    case 'drag_scrollbar_to_bottom':
      await dragScrollbarEdge({ root, readEvidence, edge: 'after' })
      return
    case 'track_click_scrollbar':
      await wait(240)
      clickScrollbarTrack(root, Number(payload.ratio ?? 0.5))
      await waitForRuntimeIdle(readEvidence, 1_500)
      return
    case 'held_scrollbar_top_no_repeat':
      await heldScrollbarTopNoRepeat({ payload, root, scenario, readEvidence, captureCheckpoint })
      return
    case 'held_scrollbar_top_rebound':
      await heldScrollbarTopRebound({ payload, root, scenario, readEvidence, captureCheckpoint })
      return
    case 'switch_feed_slow_session_overlay':
      await switchFeedSessionOverlay({ payload, scenario, readEvidence, captureCheckpoint, slow: true })
      return
    case 'switch_feed_fast_session_overlay':
      await switchFeedSessionOverlay({ payload, scenario, readEvidence, captureCheckpoint, slow: false })
      return
    default:
      throw new E2EActionError('unknown_action', `unknown action ${actionId}`)
  }
}

export async function waitForRuntimeIdle(
  readEvidence: (checkpointId: string) => E2EEvidence,
  timeoutMs: number,
): Promise<void> {
  const start = performance.now()

  while (performance.now() - start < timeoutMs) {
    const evidence = readEvidence('wait')
    const edgeIdle = evidence.edgeState.before.status !== 'loading' &&
      evidence.edgeState.after.status !== 'loading'

    if (
      evidence.phase === 'IDLE' &&
      edgeIdle &&
      evidence.pendingIntent === null &&
      evidence.visibleRows.length > 0
    ) {
      await waitForAnimationFrame()
      return
    }

    await wait(25)
  }

  throw new E2EActionError('wait_timeout', 'runtime did not become idle')
}

async function triggerBeforeEdge(input: {
  payload: Record<string, unknown>
  root: HTMLElement | null
  scenario: DemoMessageScenario
  readEvidence: (checkpointId: string) => E2EEvidence
  captureCheckpoint: (checkpointId: string) => E2EEvidence
}): Promise<void> {
  const { payload, root, scenario, readEvidence, captureCheckpoint } = input

  await wait(240)
  const beforeCount = countRuntimeEvents(readEvidence('before-edge-trigger'), 'needMoreBefore')
  const beforeCheckpointId = typeof payload.beforeCheckpointId === 'string'
    ? payload.beforeCheckpointId
    : null
  const responseDelayMs = Number.isFinite(Number(payload.responseDelayMs))
    ? Math.max(0, Number(payload.responseDelayMs))
    : beforeCheckpointId
      ? 120
      : 0
  if (responseDelayMs > 0) scenario.deferNextEdgeResponse(responseDelayMs)
  scrollContainer(root, 'top')
  if (beforeCheckpointId) {
    await waitForRuntimeEventCount(
      readEvidence,
      'needMoreBefore',
      beforeCount + 1,
      Math.max(600, responseDelayMs),
    )
    await waitForAnimationFrame()
    captureCheckpoint(beforeCheckpointId)
  }
  await wait(120)
  await waitForRuntimeIdle(readEvidence, 2_000)
}

async function appendMany(input: {
  payload: Record<string, unknown>
  scenario: DemoMessageScenario
  readEvidence: (checkpointId: string) => E2EEvidence
}): Promise<void> {
  const count = Math.min(Math.max(1, Number(input.payload.count ?? 1)), 160)
  const beforeCount = input.readEvidence('append-before').segment.itemCount

  input.scenario.appendMessages(count)
  await waitForEvidence(
    input.readEvidence,
    (evidence) => evidence.segment.modifier.type === 'trim-before' ||
      evidence.segment.itemCount > beforeCount,
    3_000,
  )
  await waitForRuntimeIdle(input.readEvidence, 3_000)
}

async function jumpToIdentity(input: {
  payload: Record<string, unknown>
  scenario: DemoMessageScenario
  readEvidence: (checkpointId: string) => E2EEvidence
}): Promise<void> {
  const stableId = typeof input.payload.stableId === 'string'
    ? input.payload.stableId
    : null

  if (!stableId) {
    throw new E2EActionError('missing_target_identity', 'jump target stableId missing')
  }

  input.scenario.activeSession.commands.scrollToMessage({
    feedId: input.scenario.activeFeedId,
    stableId,
    serverId: stableId,
  })
  await waitForRuntimeIdle(input.readEvidence, 2_000)
}

async function switchFeedRoundtrip(input: {
  scenario: DemoMessageScenario
  readEvidence: (checkpointId: string) => E2EEvidence
}): Promise<void> {
  input.scenario.selectFeed('feed-design')
  await wait(120)
  await waitForAnimationFrame()
  input.scenario.selectFeed('feed-runtime')
  await wait(120)
  await waitForAnimationFrame()
  await waitForEvidence(
    input.readEvidence,
    (evidence) => evidence.segment.modifier.type === 'reset-around' ||
      evidence.events.some((event) => event.type === 'destinationSettled'),
    2_000,
  )
  await waitForRuntimeIdle(input.readEvidence, 2_000)
}

async function dragScrollbarEdge(input: {
  root: HTMLElement | null
  readEvidence: (checkpointId: string) => E2EEvidence
  edge: 'before' | 'after'
}): Promise<void> {
  await wait(240)
  const type = input.edge === 'before' ? 'needMoreBefore' : 'needMoreAfter'
  const beforeCount = countRuntimeEvents(
    input.readEvidence(input.edge === 'before' ? 'drag-before' : 'drag-after'),
    type,
  )

  if (input.edge === 'before') {
    dragScrollbarToTop(input.root)
  } else {
    dragScrollbarToBottom(input.root)
  }
  await waitForRuntimeEventCount(input.readEvidence, type, beforeCount + 1, 1_000)
  await waitForRuntimeIdle(input.readEvidence, 2_000)
}

async function heldScrollbarTopNoRepeat(input: {
  payload: Record<string, unknown>
  root: HTMLElement | null
  scenario: DemoMessageScenario
  readEvidence: (checkpointId: string) => E2EEvidence
  captureCheckpoint: (checkpointId: string) => E2EEvidence
}): Promise<void> {
  await wait(240)
  const responseDelayMs = Number.isFinite(Number(input.payload.responseDelayMs))
    ? Math.max(0, Number(input.payload.responseDelayMs))
    : 420
  const beforeCount = countRuntimeEvents(input.readEvidence('held-before'), 'needMoreBefore')

  input.scenario.deferNextEdgeResponse(responseDelayMs)
  try {
    holdScrollbarAtTop(input.root)
    await waitForRuntimeEventCount(input.readEvidence, 'needMoreBefore', beforeCount + 1, 1_000)
    input.captureCheckpoint('pending')
    await wait(Math.min(180, responseDelayMs))
    input.captureCheckpoint('still-pending')
  } finally {
    releaseHeldScrollbar()
  }
  await waitForRuntimeIdle(input.readEvidence, 2_000)
}

async function heldScrollbarTopRebound(input: {
  payload: Record<string, unknown>
  root: HTMLElement | null
  scenario: DemoMessageScenario
  readEvidence: (checkpointId: string) => E2EEvidence
  captureCheckpoint: (checkpointId: string) => E2EEvidence
}): Promise<void> {
  await wait(240)
  const responseDelayMs = Number.isFinite(Number(input.payload.responseDelayMs))
    ? Math.max(0, Number(input.payload.responseDelayMs))
    : 180
  const beforeCount = countRuntimeEvents(input.readEvidence('held-rebound-before'), 'needMoreBefore')

  input.scenario.deferNextEdgeResponse(responseDelayMs)
  try {
    holdScrollbarAtTop(input.root)
    await waitForRuntimeEventCount(input.readEvidence, 'needMoreBefore', beforeCount + 1, 1_000)
    input.captureCheckpoint('pending')
    await waitForRuntimeIdle(input.readEvidence, 2_000)
    input.captureCheckpoint('rebound')
    await wait(160)
    input.captureCheckpoint('rebound-stable')
    continueHeldScrollbarToTop(input.root)
    await waitForRuntimeEventCount(input.readEvidence, 'needMoreBefore', beforeCount + 2, 1_000)
    input.captureCheckpoint('second-pending')
  } finally {
    releaseHeldScrollbar()
  }
  await waitForRuntimeIdle(input.readEvidence, 2_000)
}

async function switchFeedSessionOverlay(input: {
  payload: Record<string, unknown>
  scenario: DemoMessageScenario
  readEvidence: (checkpointId: string) => E2EEvidence
  captureCheckpoint: (checkpointId: string) => E2EEvidence
  slow: boolean
}): Promise<void> {
  const feedId = typeof input.payload.feedId === 'string'
    ? input.payload.feedId
    : 'feed-design'

  if (input.slow) {
    const responseDelayMs = Number.isFinite(Number(input.payload.responseDelayMs))
      ? Math.max(0, Number(input.payload.responseDelayMs))
      : 340
    input.scenario.deferNextSessionResponse(responseDelayMs)
  }

  input.scenario.selectFeed(feedId)
  if (input.slow) {
    await wait(80)
    input.captureCheckpoint('pre-overlay')
    await wait(170)
    input.captureCheckpoint('overlay-visible')
  }
  await waitForRuntimeIdle(input.readEvidence, 2_000)
  if (!input.slow) {
    await wait(240)
    input.captureCheckpoint('overlay-final')
  }
}

async function waitForRuntimeEventCount(
  readEvidence: (checkpointId: string) => E2EEvidence,
  type: E2ERuntimeEventRecord['type'],
  minCount: number,
  timeoutMs: number,
): Promise<void> {
  const start = performance.now()

  while (performance.now() - start < timeoutMs) {
    const evidence = readEvidence('event-wait')
    if (countRuntimeEvents(evidence, type) >= minCount) return
    await wait(10)
  }

  throw new E2EActionError('wait_event_timeout', `runtime event ${type} did not reach ${minCount}`)
}

async function waitForEvidence(
  readEvidence: (checkpointId: string) => E2EEvidence,
  predicate: (evidence: E2EEvidence) => boolean,
  timeoutMs: number,
): Promise<void> {
  const start = performance.now()

  while (performance.now() - start < timeoutMs) {
    const evidence = readEvidence('evidence-wait')
    if (predicate(evidence)) return
    await wait(25)
  }

  throw new E2EActionError('wait_evidence_timeout', 'evidence predicate timed out')
}

function countRuntimeEvents(
  evidence: E2EEvidence,
  type: E2ERuntimeEventRecord['type'],
): number {
  return evidence.events.filter((event) => event.type === type).length
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function waitForAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()))
}
