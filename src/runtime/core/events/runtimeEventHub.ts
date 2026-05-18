import type {
  AnchorState,
  MessageViewportRuntimeEvent,
  RuntimeEventListener,
  ViewportAnchorChangeReason,
} from '../../types'
import type { RuntimeDiagnosticInput } from '../../debug/diagnosticRecorder'

type RuntimeEventHubDeps = {
  eventListeners: Set<RuntimeEventListener>
  emitDiagnostic: (input: RuntimeDiagnosticInput) => void
  getCurrentToken: () => { feedId: string; generation: number }
  captureViewportAnchor: () => AnchorState | null
}

export class RuntimeEventHub {
  constructor(private readonly deps: RuntimeEventHubDeps) {}

  // event hub 只负责 runtime 事件分发和诊断镜像，不持有 viewport 状态；
  // 这样 controller 拆分后不会让事件订阅反向影响 transaction 流程。
  subscribeEvent(listener: RuntimeEventListener): () => void {
    this.deps.eventListeners.add(listener)
    return () => {
      this.deps.eventListeners.delete(listener)
    }
  }

  emitEvent(event: MessageViewportRuntimeEvent): void {
    if (event.type !== 'viewportDiagnostic') {
      this.emitEventDiagnostic(event)
    }

    for (const listener of this.deps.eventListeners) {
      listener(event)
    }
  }

  emitViewportAnchorChanged(
    reason: ViewportAnchorChangeReason,
    anchor?: AnchorState | null,
  ): void {
    const token = this.deps.getCurrentToken()
    this.emitEvent({
      type: 'viewportAnchorChanged',
      feedId: token.feedId,
      generation: token.generation,
      reason,
      anchor: anchor ?? this.deps.captureViewportAnchor(),
    })
  }

  emitError(code: string): void {
    const token = this.deps.getCurrentToken()
    this.deps.emitDiagnostic({
      channel: 'recovery',
      severity: 'error',
      name: 'runtime.error',
      details: () => ({
        code,
        token,
      }),
    })
    this.emitEvent({
      type: 'viewportError',
      feedId: token.feedId,
      generation: token.generation,
      code,
    })
  }

  private emitEventDiagnostic(event: MessageViewportRuntimeEvent): void {
    switch (event.type) {
      case 'needMoreBefore':
      case 'needMoreAfter':
      case 'needLatestMessages':
      case 'needMessagesAround':
        this.deps.emitDiagnostic({
          channel: 'edge',
          severity: 'info',
          name: `event.${event.type}`,
          details: () => ({
            event,
          }),
        })
        break
      case 'viewportReady':
      case 'destinationSettled':
        this.deps.emitDiagnostic({
          channel: 'lifecycle',
          severity: 'info',
          name: `event.${event.type}`,
          details: () => ({
            event,
          }),
        })
        break
      case 'viewportError':
      case 'viewportAnchorChanged':
      case 'viewportDiagnostic':
        break
    }
  }
}
