import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MessageListRuntimeEvent, MessageListSnapshot } from '../runtime'
import { DemoMessageListContent } from '../demo/DemoMessageList'
import type { DemoMessage } from '../demo/demoData'
import { useDemoFeedRuntimeCache } from '../demo/useDemoFeedRuntimeCache'
import { useDemoMessageScenario } from '../demo/useDemoMessageScenario'
import {
  createE2EState,
  type E2EActionDescriptor,
  type E2EActionResult,
  type E2EEvidence,
  type E2EOverlayEvidence,
  type E2ERuntimeEventRecord,
  type E2ESegmentEvidence,
  type XMessageListE2EBridge,
} from './e2eBridge'

const E2E_ACTIONS: E2EActionDescriptor[] = [
  { id: 'wait_for_ready', label: 'Wait ready', enabled: true },
  { id: 'wait_for_idle', label: 'Wait idle', enabled: true },
  { id: 'collect_evidence', label: 'Collect evidence', enabled: true },
  { id: 'scroll_to_middle', label: 'Scroll middle', enabled: true },
  { id: 'scroll_to_history_top', label: 'Scroll history top', enabled: true },
  { id: 'scroll_to_bottom', label: 'Scroll bottom', enabled: true },
  { id: 'trigger_before_edge', label: 'Trigger before', enabled: true },
  { id: 'trigger_after_edge', label: 'Trigger after', enabled: true },
  { id: 'append_message', label: 'Append', enabled: true },
  { id: 'prepend_history', label: 'Prepend history', enabled: true },
  { id: 'follow_bottom', label: 'Follow bottom', enabled: true },
  { id: 'jump_to_first_loaded', label: 'Jump loaded', enabled: true },
  { id: 'jump_to_oldest', label: 'Jump oldest', enabled: true },
  { id: 'toggle_dynamic_height', label: 'Dynamic height', enabled: true },
  { id: 'stream_current_row', label: 'Stream row', enabled: true },
  { id: 'send_optimistic_message', label: 'Send optimistic', enabled: true },
  { id: 'resolve_optimistic_remap', label: 'Resolve remap', enabled: true },
  { id: 'optimistic_server_remap', label: 'Remap optimistic', enabled: true },
  { id: 'switch_feed_roundtrip', label: 'Feed roundtrip', enabled: true },
  { id: 'remount_viewport', label: 'Remount viewport', enabled: true },
  { id: 'start_event_storm', label: 'Start storm', enabled: true },
  { id: 'stop_event_storm', label: 'Stop storm', enabled: true },
  { id: 'start_bot_push', label: 'Start bot', enabled: true },
  { id: 'stop_bot_push', label: 'Stop bot', enabled: true },
  { id: 'drag_scrollbar_to_top', label: 'Drag top', enabled: true },
  { id: 'track_click_scrollbar', label: 'Track click', enabled: true },
]

export function E2EMessageListApp() {
  const runtimeCache = useDemoFeedRuntimeCache()
  const scenario = useDemoMessageScenario(runtimeCache)
  const rootRef = useRef<HTMLElement | null>(null)
  const eventLogRef = useRef<E2ERuntimeEventRecord[]>([])
  const [viewportRemountKey, setViewportRemountKey] = useState(0)
  const scenarioId = getScenarioId()

  const recordEvent = useCallback((event: MessageListRuntimeEvent) => {
    eventLogRef.current = [
      ...eventLogRef.current,
      toEventRecord(event),
    ].slice(-200)
  }, [])

  useEffect(() => scenario.activeRuntime.subscribeRuntimeEvent(recordEvent), [
    recordEvent,
    scenario.activeRuntime,
  ])

  const readEvidence = useCallback((checkpointId: string): E2EEvidence => {
    const snapshot = scenario.activeRuntime.getSnapshot()
    return {
      ...scenario.activeRuntime.getEvidence(),
      schemaVersion: 2,
      scenarioId,
      checkpointId,
      timestamp: Date.now(),
      segment: createSegmentEvidence(snapshot),
      events: [...eventLogRef.current],
      diagnostics: [...scenario.activeRuntime.getDiagnostics()],
      overlay: readOverlayEvidence(rootRef.current, scenario.activeRuntime.getEvidence()),
    }
  }, [scenario.activeRuntime, scenarioId])

  const runAction = useCallback(async (
    actionId: string,
    payload: Record<string, unknown> = {},
  ): Promise<E2EActionResult> => {
    const before = readEvidence('before')
    const checkpoints: Record<string, E2EEvidence> = {}
    const captureCheckpoint = (checkpointId: string): E2EEvidence => {
      const evidence = readEvidence(checkpointId)
      checkpoints[checkpointId] = evidence
      return evidence
    }

    try {
      await runBridgeAction({
        actionId,
        payload,
        root: rootRef.current,
        scenario,
        remountViewport: () => setViewportRemountKey((key) => key + 1),
        readEvidence,
        captureCheckpoint,
      })
      const checkpointId = typeof payload.checkpointId === 'string'
        ? payload.checkpointId
        : 'after'
      const after = readEvidence(checkpointId)

      return {
        ok: true,
        actionId,
        message: `${actionId} ok`,
        before,
        after,
        checkpoints: Object.keys(checkpoints).length > 0 ? checkpoints : undefined,
      }
    } catch (error) {
      return {
        ok: false,
        actionId,
        message: error instanceof Error ? error.message : String(error),
        before,
        after: readEvidence('error'),
        checkpoints: Object.keys(checkpoints).length > 0 ? checkpoints : undefined,
        error: {
          code: error instanceof E2EActionError ? error.code : 'action_failed',
          details: {
            message: error instanceof Error ? error.message : String(error),
          },
        },
      }
    }
  }, [readEvidence, scenario])

  const bridge = useMemo<XMessageListE2EBridge>(() => ({
    version: 1,
    getState: () => createE2EState(scenarioId, readEvidence('state')),
    listActions: () => E2E_ACTIONS,
    runAction,
    getEvidence: () => readEvidence('manual'),
    resetScenario: async (nextScenarioId): Promise<E2EActionResult> => {
      eventLogRef.current = []
      await scenario.resetE2EScenario(nextScenarioId)
      await waitForRuntimeIdle(() => readEvidence('reset'), 2_000)
      return {
        ok: true,
        actionId: 'resetScenario',
        message: `reset ${nextScenarioId}`,
        after: readEvidence('reset'),
      }
    },
  }), [readEvidence, runAction, scenario, scenarioId])

  useEffect(() => {
    window.__X_MESSAGE_LIST_E2E__ = bridge
    return () => {
      if (window.__X_MESSAGE_LIST_E2E__ === bridge) {
        delete window.__X_MESSAGE_LIST_E2E__
      }
    }
  }, [bridge])

  return (
    <DemoMessageListContent
      rootRef={rootRef}
      scenario={scenario}
      e2e={{
        statusRegion: (
          <section className="e2e-ai-status">
            <strong>{scenarioId}</strong>
            <span>{scenario.lastEvent}</span>
          </section>
        ),
        onResetScenario: () => {
          void bridge.resetScenario(scenarioId)
        },
        viewportRemountKey,
      }}
    />
  )
}

type BridgeActionContext = {
  actionId: string
  payload: Record<string, unknown>
  root: HTMLElement | null
  scenario: ReturnType<typeof useDemoMessageScenario>
  remountViewport: () => void
  readEvidence: (checkpointId: string) => E2EEvidence
  captureCheckpoint: (checkpointId: string) => E2EEvidence
}

async function runBridgeAction({
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
    case 'trigger_before_edge': {
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
      if (responseDelayMs > 0) {
        scenario.deferNextEdgeResponse(responseDelayMs)
      }
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
      return
    }
    case 'scroll_to_bottom':
    case 'trigger_after_edge':
      await wait(240)
      scrollContainer(root, 'bottom')
      await wait(120)
      await waitForRuntimeIdle(readEvidence, 2_000)
      return
    case 'append_message':
      scenario.appendMessage()
      await waitForRuntimeIdle(readEvidence, 1_500)
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
    case 'jump_to_oldest':
      scenario.activeRuntime.scrollToMessage({
        feedId: scenario.activeFeedId,
        stableId: `${scenario.activeFeedId}-0001`,
        serverId: `${scenario.activeFeedId}-0001`,
      }, { align: 'start' })
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
    case 'send_optimistic_message':
      scenario.sendOptimisticMessage()
      await waitForRuntimeIdle(readEvidence, 1_500)
      scenario.alignPendingOptimisticAtStart()
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
      scenario.selectFeed('feed-design')
      await wait(120)
      await waitForAnimationFrame()
      scenario.selectFeed('feed-runtime')
      await wait(120)
      await waitForAnimationFrame()
      await waitForRuntimeIdle(readEvidence, 2_000)
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
      if (scenario.eventStormRunning) {
        scenario.toggleEventStorm()
      }
      await waitForRuntimeIdle(readEvidence, 1_000)
      return
    case 'start_bot_push':
      scenario.toggleBotPush()
      await waitForRuntimeIdle(readEvidence, 1_000)
      return
    case 'stop_bot_push':
      if (scenario.botPushActive) {
        scenario.toggleBotPush()
      }
      await waitForRuntimeIdle(readEvidence, 1_000)
      return
    case 'drag_scrollbar_to_top':
      await wait(240)
      dragScrollbarToTop(root)
      await waitForRuntimeIdle(readEvidence, 2_000)
      return
    case 'track_click_scrollbar':
      await wait(240)
      clickScrollbarTrack(root, Number(payload.ratio ?? 0.5))
      await waitForRuntimeIdle(readEvidence, 1_500)
      return
    default:
      throw new E2EActionError('unknown_action', `unknown action ${actionId}`)
  }
}

function getScenarioId(): string {
  return new URL(window.location.href).searchParams.get('scenario') ??
    'bootstrap.latest-native-bottom'
}

function createSegmentEvidence(
  snapshot: MessageListSnapshot<DemoMessage>,
): E2ESegmentEvidence {
  const first = snapshot.items[0]
  const last = snapshot.items.at(-1)

  return {
    itemCount: snapshot.items.length,
    firstKey: first?.key ?? null,
    lastKey: last?.key ?? null,
    firstIdentity: first?.identity ? {
      stableId: first.identity.stableId,
      serverId: first.identity.serverId,
      localId: first.identity.localId,
    } : null,
    lastIdentity: last?.identity ? {
      stableId: last.identity.stableId,
      serverId: last.identity.serverId,
      localId: last.identity.localId,
    } : null,
    modifier: snapshot.segmentMeta.modifier,
  }
}

function toEventRecord(event: MessageListRuntimeEvent): E2ERuntimeEventRecord {
  if (event.type === 'viewportDiagnostic') {
    return {
      type: event.type,
      timestamp: event.record.timestamp,
      diagnostic: event.record,
    }
  }

  if (event.type === 'viewportError') {
    return {
      type: event.type,
      feedId: event.feedId,
      timestamp: Date.now(),
      error: {
        code: event.code,
        message: event.message,
      },
    }
  }

  return {
    type: event.type,
    feedId: 'feedId' in event ? event.feedId : undefined,
    timestamp: Date.now(),
    generation: 'generation' in event ? event.generation : undefined,
    segmentRevision: 'segmentRevision' in event ? event.segmentRevision : undefined,
    requestToken: 'requestToken' in event ? event.requestToken : undefined,
    reason: 'reason' in event ? event.reason : undefined,
    edge: 'edge' in event ? event.edge : undefined,
    anchor: 'anchor' in event ? event.anchor : undefined,
  }
}

function findScrollContainer(root: HTMLElement | null): HTMLElement {
  const container = root?.querySelector<HTMLElement>('[data-message-scroll-container]')

  if (!container) {
    throw new E2EActionError('missing_scroll_container', 'scroll container not found')
  }

  return container
}

function scrollContainer(root: HTMLElement | null, target: 'top' | 'middle' | 'bottom'): void {
  const container = findScrollContainer(root)
  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight)
  const nextTop = target === 'top'
    ? 0
    : target === 'bottom'
      ? maxTop
      : maxTop / 2

  container.scrollTop = nextTop
  container.dispatchEvent(new Event('scroll', { bubbles: true }))
}

function dragScrollbarToTop(root: HTMLElement | null): void {
  const thumb = root?.querySelector<HTMLElement>('[data-message-scrollbar-thumb]')

  if (!thumb) {
    throw new E2EActionError('missing_scrollbar_thumb', 'scrollbar thumb not found')
  }

  const rect = thumb.getBoundingClientRect()
  dispatchPointer(thumb, 'pointerdown', rect.left + rect.width / 2, rect.top + rect.height / 2)
  dispatchPointer(thumb, 'pointermove', rect.left + rect.width / 2, 0)
  dispatchPointer(thumb, 'pointerup', rect.left + rect.width / 2, 0)
}

function clickScrollbarTrack(root: HTMLElement | null, ratio: number): void {
  const track = root?.querySelector<HTMLElement>('[data-message-scrollbar-track]')

  if (!track) {
    throw new E2EActionError('missing_scrollbar_track', 'scrollbar track not found')
  }

  const rect = track.getBoundingClientRect()
  dispatchPointer(
    track,
    'pointerdown',
    rect.left + rect.width / 2,
    rect.top + rect.height * Math.min(Math.max(ratio, 0), 1),
  )
}

function dispatchPointer(
  target: HTMLElement,
  type: string,
  clientX: number,
  clientY: number,
): void {
  target.dispatchEvent(new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    pointerId: 1,
    pointerType: 'mouse',
  }))
}

function readOverlayEvidence(
  root: HTMLElement | null,
  evidence: Pick<E2EEvidence, 'scrollTop' | 'clientHeight' | 'scrollHeight'>,
): E2EOverlayEvidence | null {
  const overlay = root?.querySelector<HTMLElement>('[data-message-scrollbar-overlay]')
  const thumb = root?.querySelector<HTMLElement>('[data-message-scrollbar-thumb]')
  const track = root?.querySelector<HTMLElement>('[data-message-scrollbar-track]')

  if (!overlay || !thumb || !track) {
    return null
  }

  const trackRect = track.getBoundingClientRect()
  const thumbRect = thumb.getBoundingClientRect()
  const maxScrollTop = Math.max(0, evidence.scrollHeight - evidence.clientHeight)
  const minThumbHeight = 28
  const rawThumbHeight = evidence.scrollHeight > 0
    ? (evidence.clientHeight / evidence.scrollHeight) * trackRect.height
    : trackRect.height
  const expectedThumbHeight = maxScrollTop > 1
    ? Math.min(trackRect.height, Math.max(minThumbHeight, rawThumbHeight))
    : trackRect.height
  const expectedThumbTop = maxScrollTop > 0
    ? (evidence.scrollTop / maxScrollTop) *
      Math.max(0, trackRect.height - expectedThumbHeight)
    : 0

  return {
    visible: overlay.dataset.visible === 'true',
    thumbTop: thumbRect.top - trackRect.top,
    thumbHeight: thumbRect.height,
    expectedThumbTop,
    expectedThumbHeight,
    trackHeight: trackRect.height,
  }
}

async function waitForRuntimeIdle(
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

async function waitForRuntimeEventCount(
  readEvidence: (checkpointId: string) => E2EEvidence,
  type: E2ERuntimeEventRecord['type'],
  minCount: number,
  timeoutMs: number,
): Promise<void> {
  const start = performance.now()

  while (performance.now() - start < timeoutMs) {
    const evidence = readEvidence('event-wait')
    const count = countRuntimeEvents(evidence, type)

    if (count >= minCount) {
      return
    }

    await wait(10)
  }

  throw new E2EActionError('wait_event_timeout', `runtime event ${type} did not reach ${minCount}`)
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

class E2EActionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}
