import {
  CORRECTNESS_SCENARIOS,
  PERF_SCENARIOS,
  type ScenarioSpec,
} from './scenarioSpecs.ts'
import type { E2ERunnerOptions } from './args.ts'

export function selectScenarios(options: E2ERunnerOptions): ScenarioSpec[] {
  const source = options.lane === 'perf' ? PERF_SCENARIOS : CORRECTNESS_SCENARIOS
  const selected = source.filter((scenario) => {
    if (options.scenarioId) {
      return scenario.id === options.scenarioId
    }
    if (options.priority === 'p0') {
      return scenario.priority === 'p0'
    }
    return true
  })

  if (selected.length === 0) {
    throw new Error('no e2e scenarios selected')
  }

  return selected
}
