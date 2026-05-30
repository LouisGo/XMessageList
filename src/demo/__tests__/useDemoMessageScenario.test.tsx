import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { MessageList } from '../../react/MessageList'
import type { DemoMessageScenario } from '../scenario/demoScenarioTypes'
import {
  createDemoFeedRuntimeCache,
  type DemoFeedRuntimeCache,
} from '../useDemoFeedRuntimeCache'
import { useDemoMessageScenario } from '../useDemoMessageScenario'

describe('useDemoMessageScenario feed switching', () => {
  let cache: DemoFeedRuntimeCache | null = null

  afterEach(() => {
    cache?.destroyAll()
    cache = null
  })

  it('consumes the first staged feed edge request instead of stranding loading', async () => {
    cache = createDemoFeedRuntimeCache()
    const host = document.createElement('div')
    const root = createRoot(host)
    let scenario: DemoMessageScenario | null = null

    function Harness() {
      const nextScenario = useDemoMessageScenario(cache as DemoFeedRuntimeCache)
      scenario = nextScenario

      return (
        <MessageList
          runtime={nextScenario.activeRuntime}
          renderRow={(item) => <span>{item.message?.id}</span>}
          renderBeforeEdge={() =>
            nextScenario.loadingBefore ? (
              <div data-testid="before-loading" />
            ) : null
          }
          renderAfterEdge={() =>
            nextScenario.loadingAfter ? (
              <div data-testid="after-loading" />
            ) : null
          }
        />
      )
    }

    await act(async () => {
      root.render(<Harness />)
    })
    await waitFor(() =>
      Boolean(scenario && !scenario.feedLoading && scenario.loadedMessageCount > 0)
    )

    await act(async () => {
      scenario?.deferNextEdgeResponse(500)
      scenario?.selectFeed('feed-design')
    })
    await waitFor(() =>
      Boolean(scenario && scenario.activeFeedId === 'feed-design' && !scenario.feedLoading)
    )

    const feedRuntime = cache.getRuntime('feed-design')
    await waitFor(() =>
      feedRuntime.getSnapshot().edgeState.before.status === 'loading'
    )

    expect(host.querySelector('[data-testid="before-loading"]')).toBeNull()
    expect(host.querySelector('[data-testid="after-loading"]')).toBeNull()

    await waitFor(() =>
      feedRuntime.getSnapshot().edgeState.before.status !== 'loading'
    )

    expect(feedRuntime.getSnapshot().edgeState.before.status).not.toBe('loading')

    await act(async () => {
      root.unmount()
    })
  })
})

async function waitFor(
  condition: () => boolean,
  timeoutMs = 3_000,
): Promise<void> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (condition()) {
      return
    }

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 25))
    })
  }

  expect(condition()).toBe(true)
}
