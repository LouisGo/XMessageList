import { parseArgs } from './args.ts'
import { ChromePage } from './chromePage.ts'
import {
  assertChromeAvailable,
  createArtifactDir,
  createChromeUserDataDir,
  getFreePort,
  removeChromeUserDataDir,
  runChecked,
  startChrome,
  startPreview,
  stopChild,
  waitForHttp,
} from './processes.ts'
import {
  isScenarioPassed,
  printScenarioResult,
  writeSummary,
} from './reporter.ts'
import { selectScenarios } from './scenarioRegistry.ts'
import { runScenario } from './scenarioRunner.ts'

async function main(): Promise<void> {
  const options = parseArgs()
  const artifactDir = await createArtifactDir(options.lane)

  if (options.build) {
    runChecked('npm', ['run', 'build:demo'])
  }

  assertChromeAvailable()

  const previewPort = await getFreePort()
  const chromePort = await getFreePort()
  const preview = startPreview(previewPort)
  const chromeUserDataDir = await createChromeUserDataDir()
  const chrome = startChrome(chromePort, chromeUserDataDir)

  try {
    await waitForHttp(`http://127.0.0.1:${previewPort}/e2e`, 10_000)
    await waitForHttp(`http://127.0.0.1:${chromePort}/json/version`, 10_000)

    const page = await ChromePage.create(chromePort)
    const scenarios = selectScenarios(options)
    const runResults = []

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
    await removeChromeUserDataDir(chromeUserDataDir)
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
