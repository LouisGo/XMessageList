import { once } from 'node:events'
import { wait } from './processes.ts'

type CdpMessage = {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { message: string }
}

export class ChromePage {
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
      exceptionDetails?: {
        text: string
        exception?: {
          description?: string
          value?: unknown
        }
      }
      result: {
        value?: T
        description?: string
      }
    }

    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          String(result.exceptionDetails.exception?.value ?? result.exceptionDetails.text),
      )
    }

    return result.result.value as T
  }

  private command(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<unknown> {
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
