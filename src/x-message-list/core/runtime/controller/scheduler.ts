import type { RuntimeScheduler } from '../contracts/options'

let nextFallbackTimerId = 1
const fallbackTimers = new Map<number, ReturnType<typeof globalThis.setTimeout>>()

// scheduler 抽象让 runtime tests 可控；浏览器缺 RAF 时用 timeout 近似一帧。
export function createDefaultScheduler(): RuntimeScheduler {
  return {
    requestAnimationFrame: (callback) => {
      if (typeof globalThis.requestAnimationFrame === 'function') {
        return globalThis.requestAnimationFrame(callback)
      }

      return setFallbackTimeout(() => callback(readNow()), 16)
    },
    cancelAnimationFrame: (handle) => {
      if (typeof globalThis.cancelAnimationFrame === 'function') {
        globalThis.cancelAnimationFrame(handle)
        return
      }

      clearFallbackTimeout(handle)
    },
    setTimeout: setFallbackTimeout,
    clearTimeout: clearFallbackTimeout,
    now: readNow,
  }
}

type ScheduledTask = {
  cancel?: () => void
}

/**
 * Normalize an injected scheduler into a progress-safe runtime boundary.
 *
 * Browser host functions can reject an unexpected receiver, while test or host
 * schedulers can throw synchronously. Runtime state machines must never retain
 * frame/timer ownership unless a callback (or a cancellable handle) actually
 * exists, so every scheduling method falls back without leaking the failure
 * into projection, motion, or DOM-interaction latches.
 */
export function createResilientScheduler(
  source: RuntimeScheduler = createDefaultScheduler(),
): RuntimeScheduler {
  let nextTaskId = 1
  const tasks = new Map<number, ScheduledTask>()

  const allocateTask = (): { id: number; task: ScheduledTask } => {
    const id = nextTaskId
    nextTaskId += 1
    const task: ScheduledTask = {}
    tasks.set(id, task)
    return { id, task }
  }

  const complete = (id: number, callback: () => void): void => {
    if (!tasks.delete(id)) return
    callback()
  }

  const scheduleHostTimeout = (
    id: number,
    task: ScheduledTask,
    callback: () => void,
    timeoutMs: number,
  ): void => {
    try {
      const handle = globalThis.setTimeout(
        () => complete(id, callback),
        timeoutMs,
      )
      task.cancel = () => globalThis.clearTimeout(handle)
    } catch {
      // Promise jobs are the final receiver-independent progress guarantee.
      void Promise.resolve().then(() => complete(id, callback))
    }
  }

  const scheduleSourceTimeout = (
    id: number,
    task: ScheduledTask,
    callback: () => void,
    timeoutMs: number,
  ): void => {
    try {
      const handle = source.setTimeout(
        () => complete(id, callback),
        timeoutMs,
      )
      task.cancel = () => source.clearTimeout(handle)
    } catch {
      scheduleHostTimeout(id, task, callback, timeoutMs)
    }
  }

  const cancel = (id: number): void => {
    const task = tasks.get(id)
    if (!task) return
    tasks.delete(id)
    try {
      task.cancel?.()
    } catch {
      // The ownership is already released locally. A stale host callback is
      // guarded by `complete` and therefore cannot re-enter the runtime.
    }
  }

  const now = (): number => {
    try {
      return source.now()
    } catch {
      return readNow()
    }
  }

  return {
    requestAnimationFrame: (callback) => {
      const { id, task } = allocateTask()
      try {
        const handle = source.requestAnimationFrame((time) =>
          complete(id, () => callback(time))
        )
        task.cancel = () => source.cancelAnimationFrame(handle)
      } catch {
        scheduleSourceTimeout(
          id,
          task,
          () => callback(now()),
          16,
        )
      }
      return id
    },
    cancelAnimationFrame: cancel,
    setTimeout: (callback, timeoutMs) => {
      const { id, task } = allocateTask()
      scheduleSourceTimeout(id, task, callback, timeoutMs)
      return id
    },
    clearTimeout: cancel,
    now,
  }
}

function readNow(): number {
  return globalThis.performance?.now() ?? Date.now()
}

function setFallbackTimeout(callback: () => void, timeoutMs: number): number {
  const id = nextFallbackTimerId
  nextFallbackTimerId += 1
  const handle = globalThis.setTimeout(() => {
    fallbackTimers.delete(id)
    callback()
  }, timeoutMs)

  fallbackTimers.set(id, handle)
  return id
}

function clearFallbackTimeout(id: number): void {
  const handle = fallbackTimers.get(id)

  if (!handle) {
    return
  }

  fallbackTimers.delete(id)
  globalThis.clearTimeout(handle)
}
