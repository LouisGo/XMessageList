import type { MessageIdentityAnchor } from '../contracts/identity'
import type { MessageListSnapshot } from '../contracts/snapshot'
import type { ViewAttachmentToken } from '../internal'
import type { RuntimeDomInteractions } from '../dom/domInteractions'
import type { RuntimeDomRegistry } from '../dom/domRegistry'
import { measureRuntimeDom, type RuntimeMeasurement } from '../dom/measurement'
import { createMeasurementCacheContext } from './controllerMeasurement'

/** Owns the independent attach revision and its identity-based settle transaction. */
export class ControllerViewAttachment<TMessage, TOptimistic> {
  private revision = 0
  private pending: ViewAttachmentToken | null = null
  private acknowledged: ViewAttachmentToken | null = null
  private hasSettledProjection = false

  constructor(
    private readonly sessionId: string,
    private readonly registry: RuntimeDomRegistry,
    private readonly domInteractions: RuntimeDomInteractions<TMessage, TOptimistic>,
    private readonly getSnapshot: () => MessageListSnapshot<TMessage, TOptimistic>,
    private readonly getRestoreAnchor: () => {
      anchor: MessageIdentityAnchor | null
      offsetWithinMessage?: number
    },
    private readonly isRuntimeBusy: () => boolean,
    private readonly publishMeasurement: (measurement: RuntimeMeasurement) => void,
    private readonly publishActiveMeasurement: (measurement: RuntimeMeasurement) => void,
    private readonly publishSettled: (
      attachmentRevision: number,
      status: 'applied' | 'anchor-unavailable',
    ) => void,
  ) {}

  begin(): ViewAttachmentToken {
    const token = {
      sessionId: this.sessionId,
      attachmentRevision: ++this.revision,
    }
    this.pending = token
    this.acknowledged = null
    return token
  }

  detach(): void {
    this.pending = null
    this.acknowledged = null
  }
  markProjectionSettled(): void {
    this.hasSettledProjection = true
    this.settleIfReady()
  }
  publishActiveObservation(): void {
    this.publishActiveMeasurement(measureRuntimeDom(this.registry.snapshot()))
  }

  ack(token: ViewAttachmentToken): void {
    if (!isSameAttachment(this.pending, token)) return
    this.acknowledged = token
    this.settleIfReady()
  }

  settleIfReady(): void {
    if (!isSameAttachment(this.pending, this.acknowledged)) return
    if (!this.hasSettledProjection || this.isRuntimeBusy()) return

    const token = this.pending
    this.pending = null
    this.acknowledged = null
    const snapshot = this.getSnapshot()
    const restore = this.getRestoreAnchor()
    const restored = snapshot.items.length === 0 || (
      restore.anchor !== null && this.domInteractions.alignToMessage(
        snapshot,
        restore.anchor,
        'start',
        restore.offsetWithinMessage,
        'recovery',
      )
    )
    if (!restored) {
      this.publishSettled(token.attachmentRevision, 'anchor-unavailable')
      return
    }

    const measurement = measureRuntimeDom(this.registry.snapshot())
    this.domInteractions.recordRowMetrics(
      measurement,
      createMeasurementCacheContext(snapshot, 'transaction'),
    )
    this.publishMeasurement(measurement)
    this.publishSettled(token.attachmentRevision, 'applied')
  }
}

function isSameAttachment(
  pending: ViewAttachmentToken | null,
  token: ViewAttachmentToken | null,
): boolean {
  return pending !== null && token !== null &&
    pending.sessionId === token.sessionId &&
    pending.attachmentRevision === token.attachmentRevision
}
