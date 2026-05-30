import type { Lane, ScenarioPriority } from './scenarioSpecs.ts'

export type E2ERunnerOptions = {
  lane: Lane
  priority: ScenarioPriority
  scenarioId?: string
  build: boolean
}

export function parseArgs(): E2ERunnerOptions {
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
