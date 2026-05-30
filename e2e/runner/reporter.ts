import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { classifyE2EFailureOwner } from '../../src/e2e-app/bridge/e2eArtifacts.ts'
import type { ScenarioRunResult } from './scenarioRunner.ts'

export function printScenarioResult(result: ScenarioRunResult): void {
  const passed = isScenarioPassed(result)
  const completedActions = result.results.filter((action) => action.ok).length
  const passedOracles = result.oracles.filter((oracle) => oracle.ok).length
  const primaryOwner = result.failedAction
    ? classifyE2EFailureOwner(result.failedAction)
    : result.oracles.some((oracle) => !oracle.ok)
      ? 'runtime'
      : 'none'

  console.log(`${passed ? 'PASS' : 'FAIL'} ${result.scenario.id}`)
  console.log(`actions: ${completedActions}/${result.results.length}`)
  console.log(`oracles: ${passedOracles}/${result.oracles.length}`)
  console.log(`primary owner: ${primaryOwner}`)
  console.log(`evidence: ${result.finalEvidence ? 'saved' : 'unavailable'}`)
  const failedOracle = result.oracles.find((oracle) => !oracle.ok)
  const notes = result.failedAction?.message ??
    failedOracle?.message ??
    result.finalEvidence?.segment.modifier.type ??
    'ok'
  console.log(`notes: ${notes}`)
  if (result.screenshotPath) {
    console.log(`screenshot: ${result.screenshotPath}`)
  }
  console.log('')
}

export function isScenarioPassed(result: ScenarioRunResult): boolean {
  return !result.failedAction && result.oracles.every((oracle) => oracle.ok)
}

export async function writeSummary(
  artifactDir: string,
  results: ScenarioRunResult[],
): Promise<void> {
  const summary = results.map((result) => ({
    scenarioId: result.scenario.id,
    ok: isScenarioPassed(result),
    actions: {
      passed: result.results.filter((action) => action.ok).length,
      total: result.results.length,
    },
    oracles: result.oracles,
    screenshotPath: result.screenshotPath,
  }))
  await writeFile(
    resolve(artifactDir, 'summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  )
}
