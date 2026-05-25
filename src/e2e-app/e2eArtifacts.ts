import type { E2EActionResult, E2EEvidence } from './e2eBridge'

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
  const owner = classifyE2EFailureOwner(input.result, evidence)
  const before = input.result.before
  const errorCode = input.result.error?.code ?? 'none'
  const errorReason = formatReason(input.result.error?.details?.reason)
  const lines = [
    '# XMessageList E2E Failure Report',
    '',
    `- Scenario: \`${evidence?.scenarioId ?? 'unknown'}\``,
    `- Action: \`${input.result.actionId}\``,
    `- Result: \`${input.result.ok ? 'passed' : 'failed'}\``,
    `- Primary owner: \`${owner}\``,
    `- Error code: \`${errorCode}\``,
    `- Error reason: ${errorReason}`,
    '',
    '## State Summary',
    '',
    '| Field | Before | After |',
    '| --- | --- | --- |',
    `| Runtime | ${formatRuntime(before)} | ${formatRuntime(evidence)} |`,
    `| Transaction | ${before?.runtime.transactionState ?? 'unknown'} | ${evidence?.runtime.transactionState ?? 'unknown'} |`,
    `| Destination | ${before?.runtime.destinationState ?? 'unknown'} | ${evidence?.runtime.destinationState ?? 'unknown'} |`,
    `| Bottom lock | ${before?.runtime.bottomLockState ?? 'unknown'} | ${evidence?.runtime.bottomLockState ?? 'unknown'} |`,
    `| Pending operation | ${before?.ui.pendingOperation ?? 'unknown'} | ${evidence?.ui.pendingOperation ?? 'unknown'} |`,
    `| Visible range | ${formatVisibleRange(before)} | ${formatVisibleRange(evidence)} |`,
    `| Distance to bottom | ${formatNumber(before?.viewport.distanceToBottom)} | ${formatNumber(evidence?.viewport.distanceToBottom)} |`,
    '',
    '## Evidence Signals',
    '',
    `- Console errors: ${evidence?.console.errors.length ?? 0}`,
    `- Console warnings: ${evidence?.console.warnings.length ?? 0}`,
    `- Viewport errors: ${formatList(evidence?.events.viewportErrors)}`,
    `- Need more before: ${evidence?.events.needMoreBefore ?? 0}`,
    `- Need more after: ${evidence?.events.needMoreAfter ?? 0}`,
    `- Destination settled events: ${evidence?.events.destinationSettled.length ?? 0}`,
    `- Error diagnostics: ${formatDiagnosticErrors(evidence)}`,
    `- Long tasks >=100ms: ${formatLongTaskCount(evidence, 100)}`,
    `- Max frame gap: ${formatNumber(evidence?.performance.frame.maxGapMs)}`,
    '',
    '## Evidence Gaps',
    '',
    ...collectEvidenceGaps(input.result, evidence).map((gap) => `- ${gap}`),
  ]

  return `${lines.join('\n')}\n`
}

export function classifyE2EFailureOwner(
  result: E2EActionResult,
  evidence?: E2EEvidence,
): E2EFailureOwner {
  const code = result.error?.code

  if (
    code === 'unknown_action' ||
    code === 'action_disabled' ||
    code === 'scenario_host_booting'
  ) {
    return 'harness'
  }

  if (code === 'missing_scroll_container') {
    return 'react'
  }

  if (code === 'direct_scroll_rejected') {
    return 'runtime'
  }

  if (hasRuntimeErrorEvidence(evidence)) {
    return 'runtime'
  }

  if (code?.endsWith('_timeout')) {
    if (hasPendingDemoOperation(evidence)) {
      return 'demo'
    }

    if (hasRuntimeBusyState(evidence)) {
      return 'runtime'
    }

    if (!evidence || evidence.viewport.renderedRows === 0) {
      return 'react'
    }

    return 'browser'
  }

  if ((evidence?.console.errors.length ?? 0) > 0) {
    return 'browser'
  }

  return 'unknown'
}

function hasPendingDemoOperation(evidence: E2EEvidence | undefined): boolean {
  return Boolean(
    evidence &&
      (evidence.ui.feedLoading ||
        evidence.ui.loadingBefore ||
        evidence.ui.loadingAfter ||
        evidence.ui.pendingOperation !== 'idle'),
  )
}

function hasRuntimeBusyState(evidence: E2EEvidence | undefined): boolean {
  return Boolean(
    evidence &&
      (evidence.runtime.transactionState !== 'idle' ||
        (evidence.runtime.destinationState !== 'idle' &&
          evidence.runtime.destinationState !== 'settled') ||
        evidence.runtime.motionActive ||
        evidence.runtime.pendingCommands > 0),
  )
}

function hasRuntimeErrorEvidence(evidence: E2EEvidence | undefined): boolean {
  return Boolean(
    evidence &&
      (evidence.events.viewportErrors.length > 0 ||
        evidence.diagnostics.recent.some(
          (record) => record.severity === 'error',
        )),
  )
}

function collectEvidenceGaps(
  result: E2EActionResult,
  evidence: E2EEvidence | undefined,
): string[] {
  const gaps: string[] = []

  if (!result.before) {
    gaps.push('missing before evidence')
  }

  if (!result.after) {
    gaps.push('missing after evidence')
  }

  if (!evidence) {
    gaps.push('missing evidence payload')
    return gaps
  }

  if (evidence.viewport.visibleRows.length === 0) {
    gaps.push('no visible row geometry captured')
  }

  if (!evidence.anchors.current) {
    gaps.push('no current anchor captured')
  }

  if (evidence.diagnostics.recent.length === 0) {
    gaps.push('no runtime diagnostics captured')
  }

  return gaps.length > 0 ? gaps : ['none']
}

function formatReason(reason: unknown): string {
  return typeof reason === 'string' && reason.length > 0
    ? reason
    : 'none'
}

function formatRuntime(evidence: E2EEvidence | undefined): string {
  if (!evidence) {
    return 'unknown'
  }

  return `${evidence.runtime.state}/${evidence.runtime.readySubstate}`
}

function formatVisibleRange(evidence: E2EEvidence | undefined): string {
  const rows = evidence?.viewport.visibleRows

  if (!rows || rows.length === 0) {
    return 'none'
  }

  return `${rows[0]?.messageId ?? 'unknown'}..${rows.at(-1)?.messageId ?? 'unknown'}`
}

function formatNumber(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(2)
    : 'unknown'
}

function formatList(values: string[] | undefined): string {
  return values && values.length > 0 ? values.join(', ') : 'none'
}

function formatDiagnosticErrors(evidence: E2EEvidence | undefined): string {
  const errors = evidence?.diagnostics.recent
    .filter((record) => record.severity === 'error')
    .map((record) => record.name)

  return errors && errors.length > 0 ? errors.join(', ') : 'none'
}

function formatLongTaskCount(
  evidence: E2EEvidence | undefined,
  thresholdMs: number,
): number {
  return evidence?.performance.longTasks.filter(
    (task) => task.durationMs >= thresholdMs,
  ).length ?? 0
}
