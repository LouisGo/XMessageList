import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as demoMessageApi from '../data/demoMessageApi'
import { useDemoLongRunningMocks } from '../scenario/useDemoLongRunningMocks'

describe('useDemoLongRunningMocks', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('keeps bot push scheduled after a transient tick failure', async () => {
    vi.useFakeTimers()
    const loadFeed = vi.spyOn(demoMessageApi, 'loadDemoFeedMessages')
      .mockRejectedValueOnce(new Error('transient read failure'))
      .mockResolvedValue([])
    const host = document.createElement('div')
    const root = createRoot(host)
    let toggleBotPush: (() => void) | null = null

    function Harness() {
      const mocks = useDemoLongRunningMocks({
        activeFeedId: 'feed-runtime',
        getHasMoreAfter: () => false,
        getLoadedMessages: () => [],
        applyAdvancedMockResult: async () => {},
        setLastEvent: () => {},
      })
      toggleBotPush = mocks.toggleBotPush
      return null
    }

    await act(async () => {
      root.render(<Harness />)
    })
    act(() => {
      toggleBotPush?.()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_600)
    })

    expect(loadFeed.mock.calls.length).toBeGreaterThanOrEqual(2)

    await act(async () => {
      root.unmount()
    })
  })

  it('keeps event storm scheduled after a transient tick failure', async () => {
    vi.useFakeTimers()
    const loadFeed = vi.spyOn(demoMessageApi, 'loadDemoFeedMessages')
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('transient read failure'))
      .mockResolvedValue([])
    const host = document.createElement('div')
    const root = createRoot(host)
    let toggleEventStorm: (() => void) | null = null

    function Harness() {
      const mocks = useDemoLongRunningMocks({
        activeFeedId: 'feed-runtime',
        getHasMoreAfter: () => false,
        getLoadedMessages: () => [],
        applyAdvancedMockResult: async () => {},
        setLastEvent: () => {},
      })
      toggleEventStorm = mocks.toggleEventStorm
      return null
    }

    await act(async () => {
      root.render(<Harness />)
    })
    await act(async () => {
      toggleEventStorm?.()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(loadFeed.mock.calls.length).toBeGreaterThanOrEqual(3)

    await act(async () => {
      root.unmount()
    })
  })
})
