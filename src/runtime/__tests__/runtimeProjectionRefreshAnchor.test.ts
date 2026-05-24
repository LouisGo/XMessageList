import { describe, expect, it } from 'vitest'
import { serializeRuntimeItemKey } from '..'
import {
  createContainer,
  createRuntime,
  createSnapshot,
  flushBootstrap,
  mountProjection,
} from './runtimeTestUtils'

describe('MessageViewportRuntime projection refresh anchor settling', () => {
  it('recaptures current anchor when refresh cannot measure the previous anchor DOM', async () => {
    const { runtime, scheduler } = createRuntime({
      debug: {
        diagnostics: { enabled: true, emitEvents: false },
      },
    })
    const container = createContainer({ height: 300 })
    const settledAnchorKeys: Array<string | null> = []

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({
      count: 30,
      revision: 1,
      effect: 'reset',
      hasMoreAfter: true,
    }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)
    container.scrollTop = runtime.getSnapshot().topSpacer + 100
    mountProjection(runtime, container, runtime.getSnapshot(), -container.scrollTop)

    const previousAnchor = runtime.getViewportAnchorState()
    expect(previousAnchor).not.toBeNull()

    if (!previousAnchor) {
      throw new Error('expected previous anchor')
    }

    const previousAnchorKey = serializeRuntimeItemKey(previousAnchor.key)

    runtime.subscribeEvent((event) => {
      if (
        event.type === 'viewportAnchorChanged' &&
        event.reason === 'transaction-settle'
      ) {
        settledAnchorKeys.push(
          event.anchor ? serializeRuntimeItemKey(event.anchor.key) : null,
        )
      }
    })

    runtime.setDataSnapshot(createSnapshot({
      count: 30,
      revision: 2,
      effect: 'items-change',
      hasMoreAfter: true,
    }))
    await Promise.resolve()
    const snapshot = runtime.getSnapshot()
    mountProjection(runtime, container, snapshot, -container.scrollTop + 40)
    runtime.registerRow(previousAnchor.key, null)

    const expectedRecapturedAnchor = runtime.getViewportAnchorState()
    expect(expectedRecapturedAnchor).not.toBeNull()

    if (!expectedRecapturedAnchor) {
      throw new Error('expected recaptured anchor')
    }

    const expectedRecapturedKey = serializeRuntimeItemKey(
      expectedRecapturedAnchor.key,
    )
    expect(expectedRecapturedKey).not.toBe(previousAnchorKey)

    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
    await Promise.resolve()
    await Promise.resolve()

    const correction = runtime
      .getDiagnosticRecords()
      .find((record) => record.name === 'correction.anchorPreserved')

    expect(correction?.details.status).toBe('measured-only')
    expect(settledAnchorKeys).toEqual([expectedRecapturedKey])
  })
})
