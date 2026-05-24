import { describe, expect, it } from 'vitest'
import { createE2EDemoStore } from '../e2eDemoStore'
import { getDefaultE2EScenarioDefinition } from '../e2eScenarioRegistry'

describe('createE2EDemoStore', () => {
  it('resets to the fixed Phase 1 seed without using the regular demo store', async () => {
    const scenario = getDefaultE2EScenarioDefinition()
    const store = createE2EDemoStore(scenario)

    await store.storage.savePersistedDemoFeed({
      version: 1,
      feedId: scenario.feedId,
      revision: 99,
      hasMoreBefore: false,
      lastViewportAnchor: undefined,
      messages: [],
      updatedAt: '2099-01-01T00:00:00.000Z',
    })

    store.resetScenario(scenario)

    const latest = await store.api.getLatestMessages({
      feedId: scenario.feedId,
      count: 20,
    })

    expect(latest.ok).toBe(true)

    if (!latest.ok) {
      return
    }

    expect(latest.total).toBe(scenario.seedCount)
    expect(latest.messages).toHaveLength(20)
    expect(latest.messages.at(-1)?.id).toBe(
      `${scenario.feedId}-m-${scenario.seedCount}`,
    )
  })
})
