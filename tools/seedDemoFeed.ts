import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { createDemoMessages } from '../src/demo/demoData.ts'

type PersistedDemoFeed = {
  version: 1
  feedId: string
  revision: number
  hasMoreBefore?: boolean
  messages: ReturnType<typeof createDemoMessages>
  updatedAt: string
}

type DemoFeedDatabase = {
  version: 1
  feeds: Record<string, PersistedDemoFeed>
}

const LOGS_DIR = resolve(process.cwd(), '.logs')
const DATABASE_FILE = resolve(LOGS_DIR, 'demo-feed-db.json')
const LOG_FILE = resolve(
  LOGS_DIR,
  `demo-events-${new Date().toISOString().slice(0, 10)}.jsonl`,
)

/**
 * 这个脚本直接维护 demo 的最小本地数据库。
 * 它只负责生成并持久化某个 feed 的完整 mock 快照，不引入额外服务端或浏览器依赖。
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      feed: { type: 'string', default: 'feed-release' },
      count: { type: 'string', default: '300' },
    },
  })

  const feedId = values.feed
  const count = Number.parseInt(values.count, 10)

  if (!feedId) {
    throw new Error('missing --feed')
  }

  if (!Number.isFinite(count) || count <= 0) {
    throw new Error(`invalid --count: ${values.count}`)
  }

  const database = await readDatabase(DATABASE_FILE)
  const previousFeed = database.feeds[feedId]
  const messages = createDemoMessages(count, feedId)
  const revision = Math.max(previousFeed?.revision ?? 0, 0) + 1
  const updatedAt = new Date().toISOString()

  database.feeds[feedId] = {
    version: 1,
    feedId,
    revision,
    hasMoreBefore: count > 0,
    messages,
    updatedAt,
  }

  await writeJsonFile(DATABASE_FILE, database)
  await appendScriptLog({
    requestId: `feed.seed.script:${Date.now()}`,
    operation: 'feed.seed',
    phase: 'success',
    feedId,
    messageCount: count,
    details: {
      source: 'seedDemoFeed.ts',
      revision,
      firstMessageId: messages[0]?.id ?? null,
      lastMessageId: messages[messages.length - 1]?.id ?? null,
    },
  })

  console.log(
    JSON.stringify(
      {
        ok: true,
        feedId,
        revision,
        count,
        firstMessageId: messages[0]?.id ?? null,
        lastMessageId: messages[messages.length - 1]?.id ?? null,
        databaseFile: DATABASE_FILE,
      },
      null,
      2,
    ),
  )
}

async function readDatabase(path: string): Promise<DemoFeedDatabase> {
  try {
    const raw = await readFile(path, 'utf8')
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

/**
 * 先写临时文件再 rename，避免 demo 正在读数据库时读到半截 JSON。
 */
async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })

  const temporaryPath = `${path}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, path)
}

async function appendScriptLog(entry: Record<string, unknown>): Promise<void> {
  await mkdir(LOGS_DIR, { recursive: true })
  await appendFile(
    LOG_FILE,
    `${JSON.stringify({
      ...entry,
      serverTime: new Date().toISOString(),
    })}\n`,
    'utf8',
  )
}

void main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  )
  process.exitCode = 1
})
