import { Buffer } from 'node:buffer'
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

type PersistedDemoFeed = {
  version: 1
  feedId: string
  revision: number
  hasMoreBefore?: boolean
  messages: unknown[]
  updatedAt: string
}

type DemoFeedDatabase = {
  version: 1
  feeds: Record<string, PersistedDemoFeed>
}

const API_PREFIX = '/__x-message-list-demo'
const DATABASE_FILE = 'demo-feed-db.json'

/**
 * Vite demo 插件是浏览器与本地文件系统之间唯一的写入边界。
 * React demo 只能发请求；日志 JSONL 和最小 feed DB 都由 Node dev server 落盘到 .logs/。
 */
export function demoLocalStorePlugin(): Plugin {
  let root = ''
  let paths = createStorePaths('')
  let writeQueue: Promise<void> = Promise.resolve()

  const enqueueWrite = async <T>(task: () => Promise<T>): Promise<T> => {
    const run = writeQueue.then(task, task)
    writeQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  return {
    name: 'x-message-list-demo-local-store',
    configResolved(config) {
      root = config.root
      paths = createStorePaths(root)
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost')

        if (!url.pathname.startsWith(API_PREFIX)) {
          next()
          return
        }

        try {
          if (request.method === 'GET' && url.pathname.startsWith(`${API_PREFIX}/feeds/`)) {
            const feedId = decodeURIComponent(
              url.pathname.slice(`${API_PREFIX}/feeds/`.length),
            )
            const database = await readDatabase(paths.databaseFile)

            sendJson(response, 200, { feed: database.feeds[feedId] ?? null })
            return
          }

          if (request.method === 'POST' && url.pathname.startsWith(`${API_PREFIX}/feeds/`)) {
            const feedId = decodeURIComponent(
              url.pathname.slice(`${API_PREFIX}/feeds/`.length),
            )
            const body = (await readJsonBody(request)) as { feed?: PersistedDemoFeed }
            const feed = normalizeFeedPayload(feedId, body.feed)

            await enqueueWrite(async () => {
              const database = await readDatabase(paths.databaseFile)
              database.feeds[feedId] = feed
              await writeJsonFile(paths.databaseFile, database)
            })

            sendJson(response, 200, { ok: true, feed })
            return
          }

          if (request.method === 'POST' && url.pathname === `${API_PREFIX}/logs`) {
            const body = (await readJsonBody(request)) as Record<string, unknown>
            const entry = {
              ...body,
              serverTime: new Date().toISOString(),
            }

            await enqueueWrite(async () => {
              await ensureLogsDir(paths.logsDir)
              await appendFile(
                paths.logFile,
                `${JSON.stringify(entry)}\n`,
                'utf8',
              )
            })

            sendJson(response, 200, { ok: true })
            return
          }

          sendJson(response, 404, { error: 'demo api route not found' })
        } catch (error) {
          sendJson(response, 500, {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })
    },
  }
}

function createStorePaths(root: string): {
  logsDir: string
  databaseFile: string
  logFile: string
} {
  const logsDir = resolve(root || '.', '.logs')
  const today = new Date().toISOString().slice(0, 10)

  return {
    logsDir,
    databaseFile: resolve(logsDir, DATABASE_FILE),
    logFile: resolve(logsDir, `demo-events-${today}.jsonl`),
  }
}

function normalizeFeedPayload(
  feedId: string,
  feed: PersistedDemoFeed | undefined,
): PersistedDemoFeed {
  if (!feed || !Array.isArray(feed.messages)) {
    throw new Error('invalid persisted feed payload')
  }

  return {
    version: 1,
    feedId,
    revision: Number.isFinite(feed.revision) ? feed.revision : 1,
    hasMoreBefore:
      typeof feed.hasMoreBefore === 'boolean'
        ? feed.hasMoreBefore
        : feed.messages.length > 0,
    messages: feed.messages,
    updatedAt: feed.updatedAt || new Date().toISOString(),
  }
}

async function readDatabase(databaseFile: string): Promise<DemoFeedDatabase> {
  try {
    const raw = await readFile(databaseFile, 'utf8')
    const parsed = JSON.parse(raw) as DemoFeedDatabase

    return {
      version: 1,
      feeds: parsed.feeds ?? {},
    }
  } catch {
    return {
      version: 1,
      feeds: {},
    }
  }
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await ensureLogsDir(dirname(path))

  const temporaryPath = `${path}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, path)
}

async function ensureLogsDir(logsDir: string): Promise<void> {
  await mkdir(logsDir, { recursive: true })
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = []

    request.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    })
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')

      if (!raw) {
        resolveBody({})
        return
      }

      try {
        resolveBody(JSON.parse(raw))
      } catch (error) {
        rejectBody(error)
      }
    })
    request.on('error', rejectBody)
  })
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  const body = JSON.stringify(payload)

  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Content-Length', Buffer.byteLength(body))
  response.end(body)
}
