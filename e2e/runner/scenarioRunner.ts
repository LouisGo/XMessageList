import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  createE2EEvidenceJson,
  createE2EFailureReport,
} from '../../src/e2e-app/bridge/e2eArtifacts.ts'
import type {
  E2EActionResult,
  E2EEvidence,
} from '../../src/e2e-app/bridge/e2eBridge.ts'
import type { E2EOracleResult, ScenarioSpec } from './scenarioSpecs.ts'
import { ChromePage } from './chromePage.ts'

export type ScenarioRunResult = {
  scenario: ScenarioSpec
  results: E2EActionResult[]
  evidence: Map<string, E2EEvidence>
  finalEvidence?: E2EEvidence
  oracles: E2EOracleResult[]
  screenshotPath?: string
  failedAction?: E2EActionResult
}

export async function runScenario(input: {
  page: ChromePage
  scenario: ScenarioSpec
  baseUrl: string
  artifactDir: string
}): Promise<ScenarioRunResult> {
  const { page, scenario, baseUrl, artifactDir } = input
  const results: E2EActionResult[] = []
  const evidence = new Map<string, E2EEvidence>()
  let failedAction: E2EActionResult | undefined
  let screenshotPath: string | undefined

  await page.navigate(`${baseUrl}/e2e?scenario=${encodeURIComponent(scenario.id)}`)
  await page.waitForBridge()

  const reset = await page.callBridge<E2EActionResult>(
    `window.__X_MESSAGE_LIST_E2E__.resetScenario(${JSON.stringify(scenario.id)})`,
  )
  results.push(reset)
  if (reset.after) {
    evidence.set('reset', reset.after)
  }
  if (!reset.ok) {
    failedAction = reset
  }

  for (const action of scenario.actions) {
    if (failedAction) {
      break
    }

    const result = await page.callBridge<E2EActionResult>(
      `window.__X_MESSAGE_LIST_E2E__.runAction(${JSON.stringify(action.id)}, ${JSON.stringify(action.payload ?? {})})`,
    )
    results.push(result)

    if (action.saveAs && result.after) {
      evidence.set(action.saveAs, result.after)
    }
    if (result.checkpoints) {
      for (const [checkpointId, checkpoint] of Object.entries(result.checkpoints)) {
        evidence.set(checkpointId, checkpoint)
      }
    }
    if (result.after?.checkpointId) {
      evidence.set(result.after.checkpointId, result.after)
    }
    if (!result.ok) {
      failedAction = result
    }
  }

  const finalEvidence = await page.callBridge<E2EEvidence>(
    'window.__X_MESSAGE_LIST_E2E__.getEvidence()',
  )
  evidence.set('final', finalEvidence)
  await writeFile(
    resolve(artifactDir, `${scenario.id}.evidence.json`),
    createE2EEvidenceJson(finalEvidence),
    'utf8',
  )
  await writeEvidenceCheckpoints({
    artifactDir,
    scenarioId: scenario.id,
    evidence,
  })

  const context = { results, evidence, finalEvidence }
  const oracles = failedAction ? [] : scenario.oracles(context)

  if (failedAction || oracles.some((oracle) => !oracle.ok)) {
    screenshotPath = resolve(artifactDir, `${scenario.id}.png`)
    await writeFile(screenshotPath, await page.captureScreenshot(), 'base64')
    const report = createE2EFailureReport({
      result: failedAction ?? {
        ok: false,
        actionId: 'oracle',
        message: 'oracle failed',
        after: finalEvidence,
        error: { code: 'oracle_failed' },
      },
      evidence: finalEvidence,
    })
    await writeFile(resolve(artifactDir, `${scenario.id}.failure.md`), report, 'utf8')
  }

  return {
    scenario,
    results,
    evidence,
    finalEvidence,
    oracles,
    screenshotPath,
    failedAction,
  }
}

async function writeEvidenceCheckpoints(input: {
  artifactDir: string
  scenarioId: string
  evidence: Map<string, E2EEvidence>
}): Promise<void> {
  const { artifactDir, evidence, scenarioId } = input

  for (const [checkpointId, checkpoint] of evidence) {
    if (checkpointId === 'final') {
      continue
    }

    await writeFile(
      resolve(
        artifactDir,
        `${scenarioId}.${sanitizeArtifactPart(checkpointId)}.evidence.json`,
      ),
      createE2EEvidenceJson(checkpoint),
      'utf8',
    )
  }
}

function sanitizeArtifactPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}
