import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MessageListRuntimeEvent, MessageListSnapshot } from '../../x-message-list/core/runtime/index'
import { DemoMessageListContent } from '../../demo/components/DemoMessageList'
import type { DemoMessage } from '../../demo/data/demoData'
import { getDemoSessionRuntime } from '../../demo/scenario/demoE2EHarnessInternals'
import { useDemoMessageScenario } from '../../demo/scenario/useDemoMessageScenario'
import {
  createE2EState,
  type E2EActionDescriptor,
  type E2EActionResult,
  type E2EEvidence,
  type E2EOverlayEvidence,
  type E2ERuntimeEventRecord,
  type E2ESegmentEvidence,
  type XMessageListE2EBridge,
} from '../bridge/e2eBridge'
import {
  runBridgeAction,
  waitForRuntimeIdle,
} from '../actions/e2eActions'
import { E2EActionError } from '../actions/e2eDomActions'

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
  { id: 'append_many', label: 'Append many', enabled: true },
  { id: 'prepend_history', label: 'Prepend history', enabled: true },
  { id: 'follow_bottom', label: 'Follow bottom', enabled: true },
  { id: 'jump_to_first_loaded', label: 'Jump loaded', enabled: true },
  { id: 'jump_to_identity', label: 'Jump identity', enabled: true },
  { id: 'jump_to_oldest', label: 'Jump oldest', enabled: true },
  { id: 'toggle_dynamic_height', label: 'Dynamic height', enabled: true },
  { id: 'stream_current_row', label: 'Stream row', enabled: true },
  { id: 'send_message', label: 'Send message', enabled: true },
  { id: 'retry_failed_send', label: 'Retry send', enabled: true },
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
  { id: 'drag_scrollbar_to_bottom', label: 'Drag bottom', enabled: true },
  { id: 'track_click_scrollbar', label: 'Track click', enabled: true },
  { id: 'held_scrollbar_top_no_repeat', label: 'Hold top once', enabled: true },
  { id: 'held_scrollbar_top_rebound', label: 'Hold top rebound', enabled: true },
  { id: 'switch_feed_slow_session_overlay', label: 'Slow feed overlay', enabled: true },
  { id: 'switch_feed_fast_session_overlay', label: 'Fast feed overlay', enabled: true },
]

export function E2EMessageListApp() {
  const scenario = useDemoMessageScenario()
  const scenarioRef = useRef(scenario)
  const rootRef = useRef<HTMLElement | null>(null)
  const eventLogRef = useRef<E2ERuntimeEventRecord[]>([])
  const [viewportRemountKey, setViewportRemountKey] = useState(0)
  const scenarioId = getScenarioId()

  useEffect(() => {
    scenarioRef.current = scenario
  }, [scenario])

  const recordEvent = useCallback((event: MessageListRuntimeEvent) => {
    eventLogRef.current = [
      ...eventLogRef.current,
      toEventRecord(event),
    ].slice(-200)
  }, [])

  useEffect(() => {
    const runtime = getDemoSessionRuntime(scenario.activeSession)

    return runtime.subscribeRuntimeEvent(recordEvent)
  }, [
    recordEvent,
    scenario.activeSession,
  ])

  const readEvidence = useCallback((checkpointId: string): E2EEvidence => {
    const currentScenario = scenarioRef.current
    const runtime = getDemoSessionRuntime(currentScenario.activeSession)
    const snapshot = runtime.getSnapshot()
    return {
      ...runtime.getEvidence(),
      schemaVersion: 2,
      scenarioId,
      checkpointId,
      timestamp: Date.now(),
      scrollContainerTop: readScrollContainerTop(rootRef.current),
      segment: createSegmentEvidence(snapshot),
      events: [...eventLogRef.current],
      diagnostics: [...runtime.getDiagnostics()],
      overlay: readOverlayEvidence(rootRef.current, runtime.getEvidence()),
      sessionOverlay: readSessionOverlayEvidence(rootRef.current),
    }
  }, [scenarioId])

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
        scenario: scenarioRef.current,
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
  }, [readEvidence])

  const bridge = useMemo<XMessageListE2EBridge>(() => ({
    version: 1,
    getState: () => createE2EState(scenarioId, readEvidence('state')),
    listActions: () => E2E_ACTIONS,
    runAction,
    getEvidence: () => readEvidence('manual'),
    resetScenario: async (nextScenarioId): Promise<E2EActionResult> => {
      eventLogRef.current = []
      await scenarioRef.current.resetE2EScenario(nextScenarioId)
      await waitForRuntimeIdle(() => readEvidence('reset'), 2_000)
      return {
        ok: true,
        actionId: 'resetScenario',
        message: `reset ${nextScenarioId}`,
        after: readEvidence('reset'),
      }
    },
  }), [readEvidence, runAction, scenarioId])

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
      sessionId: event.sessionId,
      timestamp: Date.now(),
      error: {
        code: event.code,
        message: event.message,
      },
    }
  }

  return {
    type: event.type,
    sessionId: 'sessionId' in event ? event.sessionId : undefined,
    timestamp: Date.now(),
    generation: 'generation' in event ? event.generation : undefined,
    segmentRevision: 'segmentRevision' in event ? event.segmentRevision : undefined,
    requestToken: 'requestToken' in event ? event.requestToken : undefined,
    reason: 'reason' in event ? event.reason : undefined,
    edge: 'edge' in event ? event.edge : undefined,
    anchor: 'anchor' in event ? event.anchor : undefined,
  }
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

function readSessionOverlayEvidence(
  root: HTMLElement | null,
): E2EEvidence['sessionOverlay'] {
  const overlay = root?.querySelector<HTMLElement>('[data-testid="session-loading-overlay"]')
  const container = root?.querySelector<HTMLElement>('[data-message-scroll-container]')

  return {
    visible: Boolean(overlay),
    inScrollContainer: Boolean(overlay && container?.contains(overlay)),
  }
}

function readScrollContainerTop(root: HTMLElement | null): number {
  return root
    ?.querySelector<HTMLElement>('[data-message-scroll-container]')
    ?.getBoundingClientRect().top ?? 0
}
