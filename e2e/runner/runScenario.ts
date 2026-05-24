import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { E2EActionResult, E2EEvidence } from '../../src/e2e-app/e2eBridge.ts'
import {
  createE2EEvidenceJson,
  createE2EFailureReport,
} from '../../src/e2e-app/e2eArtifacts.ts'
import {
  E2E_P0_SCENARIO_DEFINITIONS,
  getE2EP0ScenarioDefinition,
  type E2EP0ScenarioDefinition,
} from '../../src/e2e-app/e2eP0Scenarios.ts'
import {
  E2E_P1_SCENARIO_DEFINITIONS,
  getE2EP1ScenarioDefinition,
  type E2EP1ScenarioDefinition,
} from '../../src/e2e-app/e2eP1Scenarios.ts'
import {
  E2E_P2_SCENARIO_DEFINITIONS,
  getE2EP2ScenarioDefinition,
  type E2EP2ScenarioDefinition,
} from '../../src/e2e-app/e2eP2Scenarios.ts'
import {
  expectAnchorPreserved,
  expectBottomLocked,
  expectDestinationSettledOnTarget,
  expectDiagnosticObserved,
  expectLatestMessageVisible,
  expectNeedMoreAfterWithin,
  expectNeedMoreBeforeWithin,
  expectNoFeedPollution,
  expectNoFollowWhenUserReading,
  expectRuntimeIdle,
  expectRuntimeAttachedOnce,
  expectViewportErrorObserved,
  type E2EOracleResult,
} from '../../src/e2e-app/e2eOracles.ts'

type RunnerOptions = {
  baseUrl: string
  cdpEndpoint: string
  outDir: string
  scenarioId?: string
  priority: 'P0' | 'P1' | 'P2' | 'all'
  timeoutMs: number
  help: boolean
}

type RuntimeEvaluateResult = {
  result?: {
    value?: unknown
  }
  exceptionDetails?: {
    text?: string
    exception?: {
      description?: string
      value?: unknown
    }
  }
}

type CdpTarget = {
  id: string
  webSocketDebuggerUrl: string
}

type ScenarioRunResult = {
  ok: boolean
  scenarioId: string
  actionResults: E2EActionResult[]
  oracleResults: E2EOracleResult[]
  artifactPaths: string[]
}

type EvidenceCheckpoints = Partial<Record<'before' | 'after' | 'final', E2EEvidence>>

type RunnableScenarioDefinition =
  | E2EP0ScenarioDefinition
  | E2EP1ScenarioDefinition
  | E2EP2ScenarioDefinition

const DEFAULT_OPTIONS: RunnerOptions = {
  baseUrl: 'http://127.0.0.1:5173',
  cdpEndpoint: 'http://127.0.0.1:9222',
  outDir: '.logs/e2e',
  priority: 'P0',
  timeoutMs: 30_000,
  help: false,
}

class CdpClient {
  private nextId = 1

  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
    }
  >()

  private readonly eventWaiters = new Map<string, Array<(params: unknown) => void>>()

  private readonly socket: WebSocket

  private constructor(socket: WebSocket) {
    this.socket = socket
    this.socket.addEventListener('message', this.handleMessage)
  }

  static connect(webSocketUrl: string, timeoutMs: number): Promise<CdpClient> {
    return new Promise((resolve, reject) => {
      const socket = new globalThis.WebSocket(webSocketUrl)
      const timeoutId = setTimeout(() => {
        socket.close()
        reject(new Error(`timed out connecting to CDP target ${webSocketUrl}`))
      }, timeoutMs)

      socket.addEventListener('open', () => {
        clearTimeout(timeoutId)
        resolve(new CdpClient(socket))
      }, { once: true })

      socket.addEventListener('error', () => {
        clearTimeout(timeoutId)
        reject(new Error(`failed connecting to CDP target ${webSocketUrl}`))
      }, { once: true })
    })
  }

  call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.socket.readyState !== globalThis.WebSocket.OPEN) {
      return Promise.reject(new Error('CDP socket is not open'))
    }

    const id = this.nextId
    this.nextId += 1

    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      })
    })

    this.socket.send(JSON.stringify({ id, method, params }))
    return promise
  }

  waitForEvent(method: string, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`timed out waiting for CDP event ${method}`))
      }, timeoutMs)
      const waiters = this.eventWaiters.get(method) ?? []

      waiters.push((params) => {
        clearTimeout(timeoutId)
        resolve(params)
      })
      this.eventWaiters.set(method, waiters)
    })
  }

  close(): void {
    this.socket.close()
  }

  private readonly handleMessage = (event: MessageEvent): void => {
    const message = JSON.parse(readMessageText(event.data)) as {
      id?: number
      result?: unknown
      error?: { message?: string }
      method?: string
      params?: unknown
    }

    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)

      if (!pending) {
        return
      }

      this.pending.delete(message.id)

      if (message.error) {
        pending.reject(new Error(message.error.message ?? 'CDP command failed'))
        return
      }

      pending.resolve(message.result)
      return
    }

    if (message.method) {
      const waiters = this.eventWaiters.get(message.method)
      const waiter = waiters?.shift()

      if (waiter) {
        waiter(message.params)
      }
    }
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))

  if (options.help) {
    console.log(helpText())
    return
  }

  const definitions = resolveScenarioDefinitions(options)
  const target = await createCdpTarget(options.cdpEndpoint, 'about:blank')
  const client = await CdpClient.connect(target.webSocketDebuggerUrl, options.timeoutMs)
  const results: ScenarioRunResult[] = []

  try {
    await client.call('Page.enable')
    await client.call('Runtime.enable')

    for (const definition of definitions) {
      results.push(await runScenario(client, definition, options))
    }
  } finally {
    client.close()
  }

  for (const result of results) {
    const status = result.ok ? 'PASS' : 'FAIL'
    console.log(`${status} ${result.scenarioId}`)

    for (const artifactPath of result.artifactPaths) {
      console.log(`  artifact: ${artifactPath}`)
    }
  }

  if (results.some((result) => !result.ok)) {
    process.exitCode = 1
  }
}

async function runScenario(
  client: CdpClient,
  definition: RunnableScenarioDefinition,
  options: RunnerOptions,
): Promise<ScenarioRunResult> {
  const actionResults: E2EActionResult[] = []
  const checkpoints: EvidenceCheckpoints = {}
  const scenarioUrl = new URL('/e2e', options.baseUrl)

  scenarioUrl.searchParams.set('scenario', definition.id)
  await navigate(client, scenarioUrl.toString(), options.timeoutMs)
  await waitForBridge(client, options.timeoutMs)

  for (const step of definition.actionSteps) {
    if (step.kind === 'reset') {
      const result = await resetScenario(client, step.scenarioId)

      actionResults.push(result)

      if (!result.ok) {
        return writeScenarioArtifacts({
          options,
          definition,
          actionResults,
          oracleResults: [],
          checkpoints,
          failureResult: result,
        })
      }

      continue
    }

    const result = await runBridgeAction(client, step.actionId, step.payload)

    actionResults.push(result)

    if (step.checkpointAlias && result.after) {
      checkpoints[step.checkpointAlias] = result.after
    }

    if (!result.ok) {
      return writeScenarioArtifacts({
        options,
        definition,
        actionResults,
        oracleResults: [],
        checkpoints,
        failureResult: result,
      })
    }
  }

  const finalEvidence = checkpoints.after ??
    checkpoints.final ??
    actionResults.findLast((result) => result.after)?.after ??
    await getEvidence(client)
  const oracleResults = evaluateScenarioOracles(
    definition,
    checkpoints,
    finalEvidence,
  )
  const failedOracle = oracleResults.find((result) => !result.ok)
  const failureResult = failedOracle
    ? createOracleFailureResult(failedOracle, checkpoints, finalEvidence)
    : undefined

  return writeScenarioArtifacts({
    options,
    definition,
    actionResults,
    oracleResults,
    checkpoints: {
      ...checkpoints,
      final: checkpoints.final ?? finalEvidence,
    },
    failureResult,
  })
}

function evaluateScenarioOracles(
  definition: RunnableScenarioDefinition,
  checkpoints: EvidenceCheckpoints,
  finalEvidence: E2EEvidence,
): E2EOracleResult[] {
  if (definition.id === 'bootstrap.latest-bottom-lock') {
    return [
      expectRuntimeIdle(finalEvidence),
      expectBottomLocked(finalEvidence, { thresholdPx: 1 }),
    ]
  }

  if (definition.id === 'paging.prepend-anchor-preservation') {
    const before = checkpoints.before
    const after = checkpoints.after ?? finalEvidence

    if (!before) {
      return [missingEvidenceOracle('expectAnchorPreserved', 'before')]
    }

    return [
      expectRuntimeIdle(after),
      expectAnchorPreserved(before, after, { tolerancePx: 1 }),
    ]
  }

  if (definition.id === 'bottom.user-scroll-up-append-no-follow') {
    const before = checkpoints.before
    const after = checkpoints.after ?? finalEvidence

    if (!before) {
      return [missingEvidenceOracle('expectNoFollowWhenUserReading', 'before')]
    }

    return [
      expectRuntimeIdle(after),
      expectNoFollowWhenUserReading(before, after),
    ]
  }

  if (definition.id === 'bottom.locked-append-follow') {
    const after = checkpoints.after ?? finalEvidence

    return [
      expectRuntimeIdle(after),
      expectBottomLocked(after, { thresholdPx: 1 }),
      expectLatestMessageVisible(after),
    ]
  }

  if (definition.id === 'destination.quote-jump-visible-target') {
    const after = checkpoints.after ?? finalEvidence

    return [
      expectRuntimeIdle(after),
      expectDestinationSettledOnTarget(after),
    ]
  }

  if (definition.id === 'dynamic-height.anchor-above-growth') {
    const before = checkpoints.before
    const after = checkpoints.after ?? finalEvidence

    if (!before) {
      return [missingEvidenceOracle('expectAnchorPreserved', 'before')]
    }

    return [
      expectRuntimeIdle(after),
      expectAnchorPreserved(before, after, { tolerancePx: 1 }),
      expectDiagnosticObserved(after, 'correction.anchorPreserved'),
    ]
  }

  if (definition.id === 'session.switch-restore-runtime-cache') {
    const before = checkpoints.before
    const after = checkpoints.after ?? finalEvidence

    if (!before) {
      return [missingEvidenceOracle('expectNoFeedPollution', 'before')]
    }

    return [
      expectRuntimeIdle(after),
      expectNoFeedPollution(before, after),
      expectAnchorPreserved(before, after, { tolerancePx: 1 }),
    ]
  }

  if (definition.id === 'edge.custom-scrollbar-drag-top') {
    const after = checkpoints.after ?? finalEvidence

    return [
      expectRuntimeIdle(after),
      expectNeedMoreBeforeWithin(after, 1),
    ]
  }

  if (definition.id === 'edge.custom-scrollbar-drag-bottom') {
    const after = checkpoints.after ?? finalEvidence

    return [
      expectRuntimeIdle(after),
      expectNeedMoreAfterWithin(after, 1),
    ]
  }

  if (definition.id === 'lifecycle.strictmode-attach-detach-attach') {
    const after = checkpoints.after ?? finalEvidence

    return [
      expectRuntimeIdle(after),
      expectRuntimeAttachedOnce(after),
    ]
  }

  if (definition.id === 'recovery.bootstrap-commit-timeout') {
    const after = checkpoints.after ?? finalEvidence

    return [
      expectRuntimeIdle(after),
      expectViewportErrorObserved(after, 'commit-timeout-bootstrap'),
    ]
  }

  return [missingEvidenceOracle('unknownScenario', definition.id)]
}

async function writeScenarioArtifacts(input: {
  options: RunnerOptions
  definition: RunnableScenarioDefinition
  actionResults: E2EActionResult[]
  oracleResults: E2EOracleResult[]
  checkpoints: EvidenceCheckpoints
  failureResult?: E2EActionResult
}): Promise<ScenarioRunResult> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const scenarioDir = join(input.options.outDir, input.definition.id)
  const artifactPaths: string[] = []
  const finalEvidence = input.checkpoints.final ??
    input.checkpoints.after ??
    input.actionResults.findLast((result) => result.after)?.after
  const ok = input.actionResults.every((result) => result.ok) &&
    input.oracleResults.every((result) => result.ok)
  const runArtifact = {
    schemaVersion: 1,
    scenarioId: input.definition.id,
    generatedAt: timestamp,
    actionResults: input.actionResults,
    oracleResults: input.oracleResults,
    checkpoints: input.checkpoints,
  }

  await mkdir(scenarioDir, { recursive: true })

  const runPath = join(scenarioDir, `${timestamp}.run.json`)

  await writeFile(runPath, `${JSON.stringify(runArtifact, null, 2)}\n`)
  artifactPaths.push(runPath)

  if (finalEvidence) {
    const evidencePath = join(scenarioDir, `${timestamp}.evidence.json`)

    await writeFile(evidencePath, createE2EEvidenceJson(finalEvidence))
    artifactPaths.push(evidencePath)
  }

  if (input.failureResult) {
    const reportPath = join(scenarioDir, `${timestamp}.failure.md`)

    await writeFile(reportPath, createE2EFailureReport({
      result: input.failureResult,
    }))
    artifactPaths.push(reportPath)
  }

  return {
    ok,
    scenarioId: input.definition.id,
    actionResults: input.actionResults,
    oracleResults: input.oracleResults,
    artifactPaths,
  }
}

async function navigate(
  client: CdpClient,
  url: string,
  timeoutMs: number,
): Promise<void> {
  const loadEvent = client.waitForEvent('Page.loadEventFired', timeoutMs)
    .catch(() => undefined)

  await client.call('Page.navigate', { url })
  await loadEvent
}

async function waitForBridge(
  client: CdpClient,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now()

  while (Date.now() - startedAt <= timeoutMs) {
    const ready = await evaluate<boolean>(
      client,
      'Boolean(window.__X_MESSAGE_LIST_E2E__ && window.__X_MESSAGE_LIST_E2E__.version === 1)',
    )

    if (ready) {
      return
    }

    await delay(100)
  }

  throw new Error('timed out waiting for window.__X_MESSAGE_LIST_E2E__')
}

async function resetScenario(
  client: CdpClient,
  scenarioId: string,
): Promise<E2EActionResult> {
  return evaluate<E2EActionResult>(
    client,
    `window.__X_MESSAGE_LIST_E2E__.resetScenario(${JSON.stringify(scenarioId)})`,
  )
}

async function runBridgeAction(
  client: CdpClient,
  actionId: string,
  payload?: Record<string, unknown>,
): Promise<E2EActionResult> {
  const payloadExpression = payload ? JSON.stringify(payload) : 'undefined'

  return evaluate<E2EActionResult>(
    client,
    `window.__X_MESSAGE_LIST_E2E__.runAction(${JSON.stringify(actionId)}, ${payloadExpression})`,
  )
}

async function getEvidence(client: CdpClient): Promise<E2EEvidence> {
  return evaluate<E2EEvidence>(
    client,
    'window.__X_MESSAGE_LIST_E2E__.getEvidence()',
  )
}

async function evaluate<T>(client: CdpClient, expression: string): Promise<T> {
  const result = await client.call<RuntimeEvaluateResult>('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })

  if (result.exceptionDetails) {
    throw new Error(formatRuntimeException(result.exceptionDetails))
  }

  return result.result?.value as T
}

async function createCdpTarget(
  cdpEndpoint: string,
  url: string,
): Promise<CdpTarget> {
  const endpoint = trimTrailingSlash(cdpEndpoint)
  const targetUrl = `${endpoint}/json/new?${encodeURIComponent(url)}`
  let response = await fetch(targetUrl, { method: 'PUT' })

  if (!response.ok) {
    response = await fetch(targetUrl)
  }

  if (!response.ok) {
    throw new Error(
      `failed to create CDP target: ${response.status} ${response.statusText}`,
    )
  }

  const target = await response.json() as Partial<CdpTarget>

  if (!target.id || !target.webSocketDebuggerUrl) {
    throw new Error('CDP target response did not include a websocket URL')
  }

  return target as CdpTarget
}

function createOracleFailureResult(
  oracle: E2EOracleResult,
  checkpoints: EvidenceCheckpoints,
  finalEvidence: E2EEvidence,
): E2EActionResult {
  return {
    ok: false,
    actionId: `oracle:${oracle.oracleId}`,
    message: oracle.message,
    before: checkpoints.before,
    after: checkpoints.after ?? checkpoints.final ?? finalEvidence,
    error: {
      code: 'oracle_failed',
      details: {
        reason: oracle.message,
        oracleId: oracle.oracleId,
        details: oracle.details,
      },
    },
  }
}

function missingEvidenceOracle(
  oracleId: string,
  checkpointId: string,
): E2EOracleResult {
  return {
    ok: false,
    oracleId,
    message: `missing ${checkpointId} evidence`,
    details: {
      checkpointId,
    },
  }
}

function resolveScenarioDefinitions(
  options: RunnerOptions,
): RunnableScenarioDefinition[] {
  if (!options.scenarioId) {
    if (options.priority === 'P0') {
      return E2E_P0_SCENARIO_DEFINITIONS
    }

    if (options.priority === 'P1') {
      return E2E_P1_SCENARIO_DEFINITIONS
    }

    if (options.priority === 'P2') {
      return E2E_P2_SCENARIO_DEFINITIONS
    }

    return [
      ...E2E_P0_SCENARIO_DEFINITIONS,
      ...E2E_P1_SCENARIO_DEFINITIONS,
      ...E2E_P2_SCENARIO_DEFINITIONS,
    ]
  }

  const definition = getE2EP0ScenarioDefinition(options.scenarioId) ??
    getE2EP1ScenarioDefinition(options.scenarioId) ??
    getE2EP2ScenarioDefinition(options.scenarioId)

  if (!definition) {
    throw new Error(`unknown e2e scenario ${options.scenarioId}`)
  }

  return [definition]
}

function parseArgs(argv: string[]): RunnerOptions {
  const options: RunnerOptions = { ...DEFAULT_OPTIONS }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }

    if (arg === '--scenario') {
      options.scenarioId = readArgValue(argv, index, arg)
      index += 1
      continue
    }

    if (arg === '--base-url') {
      options.baseUrl = readArgValue(argv, index, arg)
      index += 1
      continue
    }

    if (arg === '--cdp') {
      options.cdpEndpoint = readArgValue(argv, index, arg)
      index += 1
      continue
    }

    if (arg === '--out') {
      options.outDir = readArgValue(argv, index, arg)
      index += 1
      continue
    }

    if (arg === '--priority') {
      options.priority = parsePriority(readArgValue(argv, index, arg))
      index += 1
      continue
    }

    if (arg === '--timeout-ms') {
      options.timeoutMs = Number(readArgValue(argv, index, arg))
      index += 1
      continue
    }

    throw new Error(`unknown argument ${arg}`)
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive number')
  }

  return options
}

function parsePriority(value: string): RunnerOptions['priority'] {
  if (value === 'P0' || value === 'P1' || value === 'P2' || value === 'all') {
    return value
  }

  throw new Error('--priority must be P0, P1, P2, or all')
}

function readArgValue(argv: string[], index: number, arg: string): string {
  const value = argv[index + 1]

  if (!value) {
    throw new Error(`${arg} requires a value`)
  }

  return value
}

function readMessageText(data: unknown): string {
  if (typeof data === 'string') {
    return data
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8')
  }

  return String(data)
}

function formatRuntimeException(
  exception: NonNullable<RuntimeEvaluateResult['exceptionDetails']>,
): string {
  return exception.exception?.description ??
    String(exception.exception?.value ?? exception.text ?? 'runtime exception')
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs)
  })
}

function helpText(): string {
  return [
    'Usage: npm run e2e:p0 -- [options]',
    '',
    'Options:',
    '  --scenario <id>       Run one scenario instead of a priority batch.',
    '  --base-url <url>      E2E host base URL. Default: http://127.0.0.1:5173',
    '  --cdp <url>           Chrome DevTools endpoint. Default: http://127.0.0.1:9222',
    '  --out <dir>           Artifact directory. Default: .logs/e2e',
    '  --priority <value>    P0, P1, P2, or all. Default: P0',
    '  --timeout-ms <ms>     Per-step timeout. Default: 30000',
    '',
    'Chrome must be running with --remote-debugging-port=9222, and the Vite dev server must already serve /e2e.',
  ].join('\n')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
