import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react'

export type TimeoutHandle = {
  set(callback: () => void, delayMs: number): void
  clear(): void
  isScheduled(): boolean
}

export function useTimeoutHandle(): TimeoutHandle {
  const timerRef = useRef<number | null>(null)

  const clear = useCallback(() => {
    if (timerRef.current === null) {
      return
    }

    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const set = useCallback((callback: () => void, delayMs: number) => {
    clear()
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      callback()
    }, delayMs)
  }, [clear])

  const isScheduled = useCallback(() => timerRef.current !== null, [])

  useLayoutEffect(() => clear, [clear])

  return useMemo(() => ({
    set,
    clear,
    isScheduled,
  }), [clear, isScheduled, set])
}
