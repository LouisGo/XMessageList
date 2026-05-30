import type { E2EActionResult, E2EEvidence } from './e2eBridge.ts'

export type E2EFailureOwner =
  | 'demo'
  | 'react'
  | 'runtime'
  | 'browser'
  | 'harness'
  | 'unknown'

export type E2EFailureReportInput = {
  result: E2EActionResult
  evidence?: E2EEvidence
}

export function createE2EEvidenceJson(evidence: E2EEvidence): string {
  return `${JSON.stringify(evidence, null, 2)}\n`
}

export function createE2EFailureReport(
  input: E2EFailureReportInput,
): string {
  const evidence = input.result.after ?? input.evidence ?? input.result.before
  return [
    '# XMessageList E2E Failure Report',
    '',
    `- Scenario: \`${evidence?.scenarioId ?? 'unknown'}\``,
    `- Action: \`${input.result.actionId}\``,
    `- Result: \`${input.result.ok ? 'passed' : 'failed'}\``,
    `- Primary owner: \`${classifyE2EFailureOwner(input.result)}\``,
    `- Error code: \`${input.result.error?.code ?? 'none'}\``,
    `- Runtime phase: \`${evidence?.phase ?? 'unknown'}\``,
    `- Pending intent: \`${evidence?.pendingIntent ?? 'unknown'}\``,
    `- Segment modifier: \`${evidence?.segment.modifier.type ?? 'unknown'}\``,
    `- Viewport errors: \`${countViewportErrors(evidence)}\``,
    '',
  ].join('\n')
}

export function classifyE2EFailureOwner(
  result: E2EActionResult,
): E2EFailureOwner {
  if (result.error?.code === 'unknown_action') {
    return 'harness'
  }

  if (result.error?.code?.startsWith('missing_')) {
    return 'react'
  }

  if (result.error?.code === 'wait_timeout') {
    return 'runtime'
  }

  return result.ok ? 'unknown' : 'runtime'
}

function countViewportErrors(evidence: E2EEvidence | undefined): number {
  return evidence?.events.filter((event) => event.type === 'viewportError').length ?? 0
}
