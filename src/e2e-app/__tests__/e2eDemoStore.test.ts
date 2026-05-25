import { describe, expect, it } from 'vitest'
import { createE2EDemoStore } from '../e2eDemoStore'
import {
  getDefaultE2EScenarioDefinition,
  getE2EScenarioDefinition,
} from '../e2eScenarioRegistry'

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

  it('seeds deterministic visible quote candidates for quote-jump scenarios', async () => {
    const scenario = getE2EScenarioDefinition(
      'destination.quote-jump-visible-target',
    )

    expect(scenario).not.toBeNull()

    if (!scenario) {
      return
    }

    const store = createE2EDemoStore(scenario)
    const latest = await store.api.getLatestMessages({
      feedId: scenario.feedId,
      count: 20,
    })

    expect(latest.ok).toBe(true)

    if (!latest.ok) {
      return
    }

    const latestIds = new Set(latest.messages.map((message) => message.id))
    const quotedRows = latest.messages.filter((message) => message.quote)

    expect(quotedRows.length).toBeGreaterThan(0)
    expect(
      quotedRows.every((message) =>
        latestIds.has(message.quote?.messageId ?? ''),
      ),
    ).toBe(true)
  })
})
