import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import type { Lane } from './scenarioSpecs.ts'

export const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
export const CHROME_APP = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

export function assertChromeAvailable(): void {
  if (!existsSync(CHROME_APP)) {
    throw new Error(`Chrome executable not found at ${CHROME_APP}`)
  }
}

export async function createArtifactDir(lane: Lane): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const artifactDir = resolve(ROOT, '.logs', 'e2e', `${timestamp}-${lane}`)
  await mkdir(artifactDir, { recursive: true })
  return artifactDir
}

export async function createChromeUserDataDir(): Promise<string> {
  return mkdtemp(resolve(tmpdir(), 'x-message-list-e2e-'))
}

export async function removeChromeUserDataDir(directory: string): Promise<void> {
  await rm(directory, {
    force: true,
    maxRetries: 5,
    recursive: true,
    retryDelay: 100,
  })
}

export function runChecked(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed`)
  }
}

export function startPreview(port: number): ChildProcess {
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

export function startChrome(port: number, userDataDir: string): ChildProcess {
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

export async function getFreePort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  server.close()
  await once(server, 'close')
  return port
}

export async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
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

export function wait(ms: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms))
}

export async function stopChild(child: ChildProcess): Promise<void> {
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
