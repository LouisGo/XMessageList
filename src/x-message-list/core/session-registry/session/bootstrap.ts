import type { MessageIdentityAnchor } from '../../runtime/index'
import { normalizeMessageListAnchor } from '../adapters/rowAdapter'
import type {
  MessageListAnchorMemoryValue,
  MessageListSessionContext,
  MessageListSessionId,
} from '../contracts'
import type { AroundRequestOptions } from './helpers'

type BootstrapOverlayOptions = {
  overlayRequestId: number
  requestEpoch: number
}

export type MessageListSessionBootstrapController = {
  ensureStarted(): void
  restart(): void
  markStarted(): void
}

export function createMessageListSessionBootstrapController<Source>(
  input: {
    sessionId: MessageListSessionId
    context: MessageListSessionContext<Source>
    isDestroyed: () => boolean
    loadAnchorMemory: () => Promise<MessageListAnchorMemoryValue | null | undefined> |
      MessageListAnchorMemoryValue |
      null |
      undefined
    startOverlayRequest: () => number
    getRequestEpoch: () => number
    isStaleOverlayRequest: (overlayRequestId: number) => boolean
    isStaleRequestEpoch: (requestEpoch: number) => boolean
    loadAround: (
      target: MessageIdentityAnchor,
      options: AroundRequestOptions & BootstrapOverlayOptions,
    ) => Promise<void>
    loadLatest: (options: BootstrapOverlayOptions) => Promise<void>
    finishFailure: (error: unknown, overlayRequestId: number) => void
  },
): MessageListSessionBootstrapController {
  let started = false

  const bootstrap = async (): Promise<void> => {
    const requestEpoch = input.getRequestEpoch()
    const overlayRequestId = input.startOverlayRequest()

    try {
      const memoryValue = await input.loadAnchorMemory()

      if (
        input.isStaleOverlayRequest(overlayRequestId) ||
        input.isStaleRequestEpoch(requestEpoch)
      ) {
        return
      }

      const runtimeAnchor = memoryValue
        ? normalizeMessageListAnchor(input.sessionId, memoryValue.anchor)
        : null

      if (runtimeAnchor) {
        await input.loadAround(runtimeAnchor, {
          align: 'start',
          offsetWithinMessage: memoryValue?.offsetWithinMessage,
          overlayRequestId,
          requestEpoch,
        })
        return
      }

      await input.loadLatest({ overlayRequestId, requestEpoch })
    } catch (error) {
      if (
        !input.isStaleOverlayRequest(overlayRequestId) &&
        !input.isStaleRequestEpoch(requestEpoch)
      ) {
        input.finishFailure(error, overlayRequestId)
      }
    }
  }

  return {
    ensureStarted: () => {
      if (started || input.isDestroyed()) {
        return
      }

      started = true
      void bootstrap()
    },
    restart: () => {
      if (input.isDestroyed()) {
        return
      }

      started = true
      void bootstrap()
    },
    markStarted: () => {
      started = true
    },
  }
}
