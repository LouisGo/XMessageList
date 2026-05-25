import { DEMO_FEEDS, getDemoFeedDefinition } from '../demo/demoFeeds'

export const DEFAULT_E2E_SCENARIO_ID = 'bootstrap.latest-bottom-lock'

export type E2EScenarioDefinition = {
  id: string
  title: string
  feedId: string
  seedCount: number
  seedLabel: string
  faults?: {
    bootstrapCommitTimeout?: 'drop-first-commit-and-retry'
    historyPrependDelayMs?: number
    historyAppendDelayMs?: number
    sendFailureMode?: 'fail-first-and-retry-succeeds'
  }
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
    id: 'destination.quote-jump-unloaded-target',
    title: 'Quote jump unloaded target',
    feedId: DEFAULT_FEED.id,
    seedCount: DEFAULT_FEED.seedCount,
    seedLabel: 'p1-quote-jump-unloaded-target-v1',
  },
  {
    id: 'send.optimistic-ack-follow-bottom',
    title: 'Optimistic send ack follows bottom',
    feedId: DEFAULT_FEED.id,
    seedCount: DEFAULT_FEED.seedCount,
    seedLabel: 'p1-send-optimistic-ack-v1',
  },
  {
    id: 'send.optimistic-fail-retry',
    title: 'Optimistic send failure retry',
    feedId: DEFAULT_FEED.id,
    seedCount: DEFAULT_FEED.seedCount,
    seedLabel: 'p1-send-optimistic-fail-retry-v1',
    faults: {
      sendFailureMode: 'fail-first-and-retry-succeeds',
    },
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
    id: 'paging.prepend-slow-request-race',
    title: 'Slow prepend request race',
    feedId: DEFAULT_FEED.id,
    seedCount: DEFAULT_FEED.seedCount,
    seedLabel: 'p2-prepend-slow-request-race-v1',
    faults: {
      historyPrependDelayMs: 400,
    },
  },
  {
    id: 'paging.append-slow-request-race',
    title: 'Slow append request race',
    feedId: DEFAULT_FEED.id,
    seedCount: DEFAULT_FEED.seedCount,
    seedLabel: 'p2-append-slow-request-race-v1',
    faults: {
      historyAppendDelayMs: 400,
    },
  },
  {
    id: 'destination.quote-jump-deleted-target',
    title: 'Quote jump deleted target fallback',
    feedId: DEFAULT_FEED.id,
    seedCount: DEFAULT_FEED.seedCount,
    seedLabel: 'p2-quote-jump-deleted-target-v1',
  },
  {
    id: 'session.switch-during-pending-prepend',
    title: 'Session switch during pending prepend',
    feedId: DEFAULT_FEED.id,
    seedCount: DEFAULT_FEED.seedCount,
    seedLabel: 'p2-switch-during-pending-prepend-v1',
    faults: {
      historyPrependDelayMs: 400,
    },
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
    faults: {
      bootstrapCommitTimeout: 'drop-first-commit-and-retry',
    },
  },
  {
    id: 'storm.quote-jump-during-event-storm',
    title: 'Quote jump during event storm',
    feedId: DEFAULT_FEED.id,
    seedCount: DEFAULT_FEED.seedCount,
    seedLabel: 'p3-quote-jump-event-storm-v1',
  },
  {
    id: 'storm.follow-bottom-with-bot-push',
    title: 'Follow bottom with bot push',
    feedId: DEFAULT_FEED.id,
    seedCount: DEFAULT_FEED.seedCount,
    seedLabel: 'p3-follow-bottom-bot-push-v1',
  },
  {
    id: 'storm.dynamic-height-session-switch',
    title: 'Dynamic height session switch storm',
    feedId: DEFAULT_FEED.id,
    seedCount: DEFAULT_FEED.seedCount,
    seedLabel: 'p3-dynamic-height-session-switch-v1',
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
