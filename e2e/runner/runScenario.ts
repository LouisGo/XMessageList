import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import {
  createE2EEvidenceJson,
  createE2EFailureReport,
  classifyE2EFailureOwner,
} from '../../src/e2e-app/e2eArtifacts.ts'
import type { E2EActionResult, E2EEvidence } from '../../src/e2e-app/e2eBridge.ts'
import {
  expectAnchorPreserved,
  expectBottomLocked,
  expectDetachAnchorCheckpoint,
  expectDiagnosticsBounded,
  expectEvidenceContract,
  expectLocalAlignWithoutAround,
  expectModifier,
  expectNeedEventCount,
  expectNoSpacerEvidence,
  expectNoViewportErrors,
  expectNoWhiteScreen,
  expectOverlayMirrorsNative,
  expectRuntimeIdle,
  expectScrollHeightIncreased,
  expectScrollTopIncreased,
  expectUnderflowSingleFlight,
  expectVisibleIdentity,
  type E2EOracleResult,
} from '../../src/e2e-app/e2eOracles.ts'

type Lane = 'correctness' | 'perf'
type ScenarioPriority = 'p0' | 'all'
type ScenarioContext = {
  results: E2EActionResult[]
  evidence: Map<string, E2EEvidence>
  finalEvidence: E2EEvidence
}
type ScenarioSpec = {
  id: string
  priority: 'p0' | 'p1' | 'p2' | 'p3' | 'p4' | 'perf'
  actions: Array<{
    id: string
    payload?: Record<string, unknown>
    saveAs?: string
  }>
  oracles: (context: ScenarioContext) => E2EOracleResult[]
}
type ScenarioRunResult = {
  scenario: ScenarioSpec
  results: E2EActionResult[]
  evidence: Map<string, E2EEvidence>
  finalEvidence?: E2EEvidence
  oracles: E2EOracleResult[]
  screenshotPath?: string
  failedAction?: E2EActionResult
}

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const CHROME_APP = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

async function main(): Promise<void> {
  const options = parseArgs()
  const artifactDir = await createArtifactDir(options.lane)

  if (options.build) {
    runChecked('npm', ['run', 'build:demo'])
  }

  const previewPort = await getFreePort()
  const chromePort = await getFreePort()
  const preview = startPreview(previewPort)
  const chromeUserDataDir = await mkdtemp(resolve(tmpdir(), 'x-message-list-e2e-'))
  const chrome = startChrome(chromePort, chromeUserDataDir)

  try {
    await waitForHttp(`http://127.0.0.1:${previewPort}/e2e`, 10_000)
    await waitForHttp(`http://127.0.0.1:${chromePort}/json/version`, 10_000)

    const page = await ChromePage.create(chromePort)
    const scenarios = selectScenarios(options)
    const runResults: ScenarioRunResult[] = []

    for (const scenario of scenarios) {
      const result = await runScenario({
        page,
        scenario,
        baseUrl: `http://127.0.0.1:${previewPort}`,
        artifactDir,
      })
      runResults.push(result)
      printScenarioResult(result)
    }

    await page.close()
    await writeSummary(artifactDir, runResults)

    if (runResults.some((result) => !isScenarioPassed(result))) {
      throw new Error(`e2e ${options.lane} lane failed`)
    }
  } finally {
    await stopChild(preview)
    await stopChild(chrome)
    await rm(chromeUserDataDir, {
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 100,
    })
  }
}

function parseArgs(): {
  lane: Lane
  priority: ScenarioPriority
  scenarioId?: string
  build: boolean
} {
  const args = process.argv.slice(2)
  const lane = readArg(args, '--lane') === 'perf' ? 'perf' : 'correctness'
  const priority = readArg(args, '--priority') === 'p0' ? 'p0' : 'all'
  const scenarioId = readArg(args, '--scenario')
  const build = !args.includes('--no-build')

  return { lane, priority, scenarioId, build }
}

function readArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)

  if (index < 0) {
    return undefined
  }

  return args[index + 1]
}

function selectScenarios(options: {
  lane: Lane
  priority: ScenarioPriority
  scenarioId?: string
}): ScenarioSpec[] {
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

async function runScenario(input: {
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

function printScenarioResult(result: ScenarioRunResult): void {
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

function isScenarioPassed(result: ScenarioRunResult): boolean {
  return !result.failedAction && result.oracles.every((oracle) => oracle.ok)
}

async function writeSummary(
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

function mustEvidence(
  context: ScenarioContext,
  key: string,
): E2EEvidence {
  const evidence = context.evidence.get(key)

  if (!evidence) {
    throw new Error(`missing evidence ${key}`)
  }

  return evidence
}

const BASE_ORACLES = (evidence: E2EEvidence): E2EOracleResult[] => [
  expectRuntimeIdle(evidence),
  expectNoWhiteScreen(evidence),
  expectEvidenceContract(evidence),
  expectNoSpacerEvidence(evidence),
  expectNoViewportErrors(evidence),
]

const CORRECTNESS_SCENARIOS: ScenarioSpec[] = [
  {
    id: 'bootstrap.latest-native-bottom',
    priority: 'p0',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'collect_evidence', payload: { checkpointId: 'final' }, saveAs: 'final' },
    ],
    oracles: ({ finalEvidence }) => [
      ...BASE_ORACLES(finalEvidence),
      expectBottomLocked(finalEvidence, { thresholdPx: 2 }),
    ],
  },
  {
    id: 'paging.before-native-thumb-rebound',
    priority: 'p0',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'scroll_to_middle' },
      { id: 'collect_evidence', payload: { checkpointId: 'before' }, saveAs: 'before' },
      { id: 'prepend_history' },
      { id: 'collect_evidence', payload: { checkpointId: 'after' }, saveAs: 'after' },
    ],
    oracles: (context) => {
      const before = mustEvidence(context, 'before')
      const after = mustEvidence(context, 'after')
      return [
        ...BASE_ORACLES(after),
        expectAnchorPreserved(before, after, { tolerancePx: 1 }),
        expectScrollHeightIncreased(before, after),
        expectScrollTopIncreased(before, after),
      ]
    },
  },
  {
    id: 'paging.after-native-thumb-rebound',
    priority: 'p0',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'collect_evidence', payload: { checkpointId: 'before' }, saveAs: 'before' },
      { id: 'trigger_after_edge' },
      { id: 'collect_evidence', payload: { checkpointId: 'after' }, saveAs: 'after' },
    ],
    oracles: (context) => {
      const before = mustEvidence(context, 'before')
      const after = mustEvidence(context, 'after')
      return [
        ...BASE_ORACLES(after),
        expectNeedEventCount(after, 'needMoreAfter', 1),
        expectScrollHeightIncreased(before, after),
      ]
    },
  },
  {
    id: 'underflow.dual-edge-arbitration',
    priority: 'p0',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'collect_evidence', payload: { checkpointId: 'final' }, saveAs: 'final' },
    ],
    oracles: ({ finalEvidence }) => [
      ...BASE_ORACLES(finalEvidence),
      expectUnderflowSingleFlight(finalEvidence),
    ],
  },
  {
    id: 'identity.optimistic-server-remap',
    priority: 'p0',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'scroll_to_bottom' },
      { id: 'optimistic_server_remap' },
      { id: 'collect_evidence', payload: { checkpointId: 'after' }, saveAs: 'after' },
    ],
    oracles: ({ finalEvidence }) => [
      ...BASE_ORACLES(finalEvidence),
      expectModifier(finalEvidence, 'identity-remap'),
      expectVisibleIdentity(finalEvidence, finalEvidence.segment.lastKey ?? ''),
    ],
  },
  {
    id: 'dynamic-height.above-anchor-growth',
    priority: 'p1',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'scroll_to_middle' },
      { id: 'collect_evidence', payload: { checkpointId: 'before' }, saveAs: 'before' },
      { id: 'toggle_dynamic_height' },
      { id: 'collect_evidence', payload: { checkpointId: 'after' }, saveAs: 'after' },
    ],
    oracles: (context) => [
      ...BASE_ORACLES(context.finalEvidence),
      expectAnchorPreserved(
        mustEvidence(context, 'before'),
        mustEvidence(context, 'after'),
        { tolerancePx: 1 },
      ),
    ],
  },
  {
    id: 'dynamic-height.streaming-current-row',
    priority: 'p1',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'scroll_to_middle' },
      { id: 'collect_evidence', payload: { checkpointId: 'before' }, saveAs: 'before' },
      { id: 'stream_current_row' },
      { id: 'collect_evidence', payload: { checkpointId: 'after' }, saveAs: 'after' },
    ],
    oracles: (context) => [
      ...BASE_ORACLES(context.finalEvidence),
      expectAnchorPreserved(
        mustEvidence(context, 'before'),
        mustEvidence(context, 'after'),
        { tolerancePx: 1 },
      ),
    ],
  },
  {
    id: 'destination.jump-in-segment',
    priority: 'p2',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'collect_evidence', payload: { checkpointId: 'before' }, saveAs: 'before' },
      { id: 'jump_to_first_loaded' },
      { id: 'collect_evidence', payload: { checkpointId: 'after' }, saveAs: 'after' },
    ],
    oracles: (context) => [
      ...BASE_ORACLES(context.finalEvidence),
      expectLocalAlignWithoutAround(
        mustEvidence(context, 'before'),
        mustEvidence(context, 'after'),
      ),
      expectVisibleIdentity(context.finalEvidence, context.finalEvidence.segment.firstKey ?? ''),
    ],
  },
  {
    id: 'destination.jump-outside-segment',
    priority: 'p2',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'jump_to_oldest' },
      { id: 'collect_evidence', payload: { checkpointId: 'after' }, saveAs: 'after' },
    ],
    oracles: ({ finalEvidence }) => [
      ...BASE_ORACLES(finalEvidence),
      expectNeedEventCount(finalEvidence, 'needMessagesAround', 1),
      expectVisibleIdentity(finalEvidence, 'feed-runtime-0001'),
    ],
  },
  {
    id: 'follow-bottom.partial-segment',
    priority: 'p2',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'follow_bottom' },
      { id: 'collect_evidence', payload: { checkpointId: 'after' }, saveAs: 'after' },
    ],
    oracles: ({ finalEvidence }) => [
      ...BASE_ORACLES(finalEvidence),
      expectNeedEventCount(finalEvidence, 'needLatestMessages', 1),
      expectBottomLocked(finalEvidence, { thresholdPx: 2 }),
    ],
  },
  {
    id: 'feed-switch.detach-anchor-checkpoint',
    priority: 'p3',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'scroll_to_middle' },
      { id: 'switch_feed_roundtrip' },
      { id: 'collect_evidence', payload: { checkpointId: 'after' }, saveAs: 'after' },
    ],
    oracles: ({ finalEvidence }) => [
      ...BASE_ORACLES(finalEvidence),
      expectDetachAnchorCheckpoint(finalEvidence),
    ],
  },
  {
    id: 'strictmode.attach-detach-attach',
    priority: 'p3',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'remount_viewport' },
      { id: 'remount_viewport' },
      { id: 'collect_evidence', payload: { checkpointId: 'after' }, saveAs: 'after' },
    ],
    oracles: ({ finalEvidence }) => [
      ...BASE_ORACLES(finalEvidence),
      expectDiagnosticsBounded(finalEvidence),
    ],
  },
  {
    id: 'scrollbar.overlay-native-mirror',
    priority: 'p4',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'collect_evidence', payload: { checkpointId: 'final' }, saveAs: 'final' },
    ],
    oracles: ({ finalEvidence }) => [
      ...BASE_ORACLES(finalEvidence),
      expectOverlayMirrorsNative(finalEvidence, { tolerancePx: 2 }),
    ],
  },
  {
    id: 'scrollbar.drag-edge-before',
    priority: 'p4',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'drag_scrollbar_to_top' },
      { id: 'collect_evidence', payload: { checkpointId: 'after' }, saveAs: 'after' },
    ],
    oracles: ({ finalEvidence }) => [
      ...BASE_ORACLES(finalEvidence),
      expectNeedEventCount(finalEvidence, 'needMoreBefore', 1),
      expectOverlayMirrorsNative(finalEvidence, { tolerancePx: 2 }),
    ],
  },
  {
    id: 'scrollbar.track-click-no-global-jump',
    priority: 'p4',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'collect_evidence', payload: { checkpointId: 'before' }, saveAs: 'before' },
      { id: 'track_click_scrollbar', payload: { ratio: 0.35 } },
      { id: 'collect_evidence', payload: { checkpointId: 'after' }, saveAs: 'after' },
    ],
    oracles: (context) => [
      ...BASE_ORACLES(context.finalEvidence),
      expectNoViewportErrors(context.finalEvidence),
      expectOverlayMirrorsNative(context.finalEvidence, { tolerancePx: 2 }),
    ],
  },
]

const PERF_SCENARIOS: ScenarioSpec[] = [
  {
    id: 'perf.scroll-observation-budget',
    priority: 'perf',
    actions: [
      { id: 'wait_for_ready' },
      { id: 'start_event_storm' },
      { id: 'wait_for_idle' },
      { id: 'stop_event_storm' },
      { id: 'start_bot_push' },
      { id: 'wait_for_idle' },
      { id: 'stop_bot_push' },
      { id: 'scroll_to_middle' },
      { id: 'scroll_to_bottom' },
      { id: 'scroll_to_middle' },
      { id: 'collect_evidence', payload: { checkpointId: 'final' }, saveAs: 'final' },
    ],
    oracles: ({ finalEvidence }) => [
      ...BASE_ORACLES(finalEvidence),
      expectDiagnosticsBounded(finalEvidence),
    ],
  },
]

async function createArtifactDir(lane: Lane): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const artifactDir = resolve(ROOT, '.logs', 'e2e', `${timestamp}-${lane}`)
  await mkdir(artifactDir, { recursive: true })
  return artifactDir
}

function runChecked(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed`)
  }
}

function startPreview(port: number): ChildProcess {
  const child = spawn('npm', [
    'run',
    'preview:demo',
    '--',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
  ], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', (chunk) => process.stdout.write(chunk))
  child.stderr?.on('data', (chunk) => process.stderr.write(chunk))
  return child
}

function startChrome(port: number, userDataDir: string): ChildProcess {
  return spawn(CHROME_APP, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ], {
    stdio: ['ignore', 'ignore', 'ignore'],
  })
}

async function getFreePort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  server.close()
  await once(server, 'close')
  return port
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok || response.status < 500) {
        return
      }
    } catch {
      await wait(100)
    }
  }

  throw new Error(`timed out waiting for ${url}`)
}

function wait(ms: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms))
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }

  child.kill('SIGTERM')
  await Promise.race([
    once(child, 'exit'),
    wait(1_500).then(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
      }
    }),
  ])
}

type CdpMessage = {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { message: string }
}

class ChromePage {
  private nextId = 1
  private readonly socket: WebSocket
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void
      reject: (reason: unknown) => void
    }
  >()
  private loadResolvers: Array<() => void> = []

  private constructor(socket: WebSocket) {
    this.socket = socket
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage

      if (message.id) {
        const pending = this.pending.get(message.id)
        if (!pending) {
          return
        }
        this.pending.delete(message.id)
        if (message.error) {
          pending.reject(new Error(message.error.message))
          return
        }
        pending.resolve(message.result)
        return
      }

      if (message.method === 'Page.loadEventFired') {
        const resolvers = this.loadResolvers
        this.loadResolvers = []
        for (const resolveLoad of resolvers) {
          resolveLoad()
        }
      }
    })
  }

  static async create(chromePort: number): Promise<ChromePage> {
    const target = await fetch(
      `http://127.0.0.1:${chromePort}/json/new?about:blank`,
      { method: 'PUT' },
    ).then((response) => response.json()) as { webSocketDebuggerUrl: string }
    const socket = new WebSocket(target.webSocketDebuggerUrl)
    await once(socket as unknown as NodeJS.EventEmitter, 'open')
    const page = new ChromePage(socket)
    await page.command('Page.enable')
    await page.command('Runtime.enable')
    return page
  }

  async navigate(url: string): Promise<void> {
    const load = this.waitForLoad()
    await this.command('Page.navigate', { url })
    await load
  }

  async waitForBridge(): Promise<void> {
    const start = Date.now()

    while (Date.now() - start < 5_000) {
      const ready = await this.evaluate<boolean>(
        'Boolean(window.__X_MESSAGE_LIST_E2E__ && window.__X_MESSAGE_LIST_E2E__.version === 1)',
      )
      if (ready) {
        return
      }
      await wait(50)
    }

    throw new Error('timed out waiting for e2e bridge')
  }

  async callBridge<T>(expression: string): Promise<T> {
    return this.evaluate<T>(expression)
  }

  async captureScreenshot(): Promise<string> {
    const result = await this.command('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
    }) as { data: string }
    return result.data
  }

  async close(): Promise<void> {
    this.socket.close()
  }

  private waitForLoad(): Promise<void> {
    return new Promise((resolveLoad) => {
      this.loadResolvers.push(resolveLoad)
    })
  }

  private async evaluate<T>(expression: string): Promise<T> {
    const result = await this.command('Runtime.evaluate', {
      awaitPromise: true,
      expression,
      returnByValue: true,
    }) as {
      exceptionDetails?: { text: string }
      result: {
        value?: T
        description?: string
      }
    }

    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text)
    }

    return result.result.value as T
  }

  private command(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.nextId
    this.nextId += 1
    this.socket.send(JSON.stringify({ id, method, params }))
    return new Promise((resolveCommand, rejectCommand) => {
      this.pending.set(id, {
        resolve: resolveCommand,
        reject: rejectCommand,
      })
    })
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
