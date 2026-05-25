import { describe, expect, it, vi } from 'vitest'
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

  it('seeds latest visible quote origins whose targets are outside the latest window', async () => {
    const scenario = getE2EScenarioDefinition(
      'destination.quote-jump-unloaded-target',
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
        !latestIds.has(message.quote?.messageId ?? ''),
      ),
    ).toBe(true)
  })

  it('delays only history prepend requests when the scenario fault is active', async () => {
    vi.useFakeTimers()

    try {
      const baseScenario = getDefaultE2EScenarioDefinition()
      const store = createE2EDemoStore({
        ...baseScenario,
        faults: {
          historyPrependDelayMs: 100,
        },
      })
      let prependSettled = false

      const prepend = store.api.getMessagesAround({
        feedId: baseScenario.feedId,
        anchor: { messageId: `${baseScenario.feedId}-m-61` },
        before: 20,
        after: 0,
      }).then((resp) => {
        prependSettled = true
        return resp
      })
      const append = store.api.getMessagesAround({
        feedId: baseScenario.feedId,
        anchor: { messageId: `${baseScenario.feedId}-m-61` },
        before: 0,
        after: 20,
      })

      await expect(append).resolves.toMatchObject({ ok: true })
      await vi.advanceTimersByTimeAsync(99)
      expect(prependSettled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await expect(prepend).resolves.toMatchObject({ ok: true })
    } finally {
      vi.useRealTimers()
    }
  })
})
