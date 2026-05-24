import { DEMO_FEEDS, getDemoFeedDefinition } from '../demo/demoFeeds'

export const DEFAULT_E2E_SCENARIO_ID = 'bootstrap.latest-bottom-lock'

export type E2EScenarioDefinition = {
  id: string
  title: string
  feedId: string
  seedCount: number
  seedLabel: string
}

const DEFAULT_FEED = getDemoFeedDefinition(DEMO_FEEDS[0]?.id ?? 'feed-runtime')

const P0_SCENARIOS: E2EScenarioDefinition[] = [
  {
    id: DEFAULT_E2E_SCENARIO_ID,
    title: 'Bootstrap latest bottom lock',
    feedId: DEFAULT_FEED.id,
    seedCount: DEFAULT_FEED.seedCount,
    seedLabel: 'p0-bootstrap-latest-bottom-lock-v1',
  },
  {
    id: 'paging.prepend-anchor-preservation',
    title: 'Prepend anchor preservation',
    feedId: DEFAULT_FEED.id,
    seedCount: DEFAULT_FEED.seedCount,
    seedLabel: 'p0-prepend-anchor-preservation-v1',
  },
  {
    id: 'bottom.user-scroll-up-append-no-follow',
    title: 'User scroll up append no follow',
    feedId: DEFAULT_FEED.id,
    seedCount: DEFAULT_FEED.seedCount,
    seedLabel: 'p0-user-scroll-up-append-no-follow-v1',
  },
  {
    id: 'bottom.locked-append-follow',
    title: 'Locked bottom append follows latest',
    feedId: DEFAULT_FEED.id,
    seedCount: DEFAULT_FEED.seedCount,
    seedLabel: 'p1-locked-append-follow-v1',
  },
  {
    id: 'destination.quote-jump-visible-target',
    title: 'Quote jump visible target',
    feedId: DEFAULT_FEED.id,
    seedCount: DEFAULT_FEED.seedCount,
    seedLabel: 'p1-quote-jump-visible-target-v1',
  },
  {
    id: 'dynamic-height.anchor-above-growth',
    title: 'Dynamic height anchor preservation',
    feedId: DEFAULT_FEED.id,
    seedCount: DEFAULT_FEED.seedCount,
    seedLabel: 'p1-dynamic-height-anchor-v1',
  },
  {
    id: 'session.switch-restore-runtime-cache',
    title: 'Session switch restore runtime cache',
    feedId: DEFAULT_FEED.id,
    seedCount: DEFAULT_FEED.seedCount,
    seedLabel: 'p1-session-switch-restore-v1',
  },
  {
    id: 'edge.custom-scrollbar-drag-top',
    title: 'Custom scrollbar drag top edge',
    feedId: DEFAULT_FEED.id,
    seedCount: DEFAULT_FEED.seedCount,
    seedLabel: 'p2-scrollbar-drag-top-v1',
  },
  {
    id: 'edge.custom-scrollbar-drag-bottom',
    title: 'Custom scrollbar drag bottom edge',
    feedId: DEFAULT_FEED.id,
    seedCount: DEFAULT_FEED.seedCount,
    seedLabel: 'p2-scrollbar-drag-bottom-v1',
  },
  {
    id: 'lifecycle.strictmode-attach-detach-attach',
    title: 'StrictMode attach detach attach',
    feedId: DEFAULT_FEED.id,
    seedCount: DEFAULT_FEED.seedCount,
    seedLabel: 'p2-strictmode-attach-detach-v1',
  },
  {
    id: 'recovery.bootstrap-commit-timeout',
    title: 'Bootstrap commit timeout recovery',
    feedId: DEFAULT_FEED.id,
    seedCount: DEFAULT_FEED.seedCount,
    seedLabel: 'p2-bootstrap-commit-timeout-v1',
  },
]

export function getE2EScenarioDefinition(
  scenarioId: string,
): E2EScenarioDefinition | null {
  return P0_SCENARIOS.find((scenario) => scenario.id === scenarioId) ?? null
}

export function getDefaultE2EScenarioDefinition(): E2EScenarioDefinition {
  const scenario = getE2EScenarioDefinition(DEFAULT_E2E_SCENARIO_ID)

  if (!scenario) {
    throw new Error(`missing default e2e scenario ${DEFAULT_E2E_SCENARIO_ID}`)
  }

  return scenario
}

export function resolveInitialE2EScenarioId(search: string): string {
  const params = new URLSearchParams(search)
  const scenarioId = params.get('scenario') ?? DEFAULT_E2E_SCENARIO_ID

  return getE2EScenarioDefinition(scenarioId)?.id ?? DEFAULT_E2E_SCENARIO_ID
}
