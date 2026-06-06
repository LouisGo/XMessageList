import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react'
import { useLatestCallback } from './useLatestCallback'

export type RafCallbackHandle = {
  schedule(): void
  cancel(): void
  isScheduled(): boolean
}

export function useRafCallback(callback: () => void): RafCallbackHandle {
  const runLatest = useLatestCallback(callback)
  const frameRef = useRef<number | null>(null)

  const cancel = useCallback(() => {
    if (frameRef.current === null) {
      return
    }

    window.cancelAnimationFrame(frameRef.current)
    frameRef.current = null
  }, [])

  const schedule = useCallback(() => {
    if (frameRef.current !== null) {
      return
    }

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      runLatest()
    })
  }, [runLatest])

  const isScheduled = useCallback(() => frameRef.current !== null, [])

  useLayoutEffect(() => cancel, [cancel])

  return useMemo(() => ({
    schedule,
    cancel,
    isScheduled,
  }), [cancel, isScheduled, schedule])
}
