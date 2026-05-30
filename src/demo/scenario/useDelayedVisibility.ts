import { useCallback, useEffect, useRef, useState } from 'react'

export function useDelayedVisibility(
  active: boolean,
  delayMs: number,
): readonly [boolean, () => void] {
  const [delayElapsed, setDelayElapsed] = useState(false)
  const timerRef = useRef<number | null>(null)
  const reset = useCallback(() => setDelayElapsed(false), [])

  useEffect(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }

    if (!active) {
      return undefined
    }

    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      setDelayElapsed(true)
    }, delayMs)

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [active, delayMs])

  return [active && delayElapsed, reset]
}
