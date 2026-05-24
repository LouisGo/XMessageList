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

const PHASE_1_SCENARIOS: E2EScenarioDefinition[] = [
  {
    id: DEFAULT_E2E_SCENARIO_ID,
    title: 'Bootstrap latest bottom lock',
    feedId: DEFAULT_FEED.id,
    seedCount: DEFAULT_FEED.seedCount,
    seedLabel: 'phase1-bootstrap-latest-bottom-lock-v1',
  },
]

export function getE2EScenarioDefinition(
  scenarioId: string,
): E2EScenarioDefinition | null {
  return PHASE_1_SCENARIOS.find((scenario) => scenario.id === scenarioId) ?? null
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
