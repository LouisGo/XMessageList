import type { RuntimeScheduler } from './options'

let nextFallbackTimerId = 1
const fallbackTimers = new Map<number, ReturnType<typeof globalThis.setTimeout>>()

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
