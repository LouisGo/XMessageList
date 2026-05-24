import {
  useCallback,
  useRef,
  useState,
  type MutableRefObject,
  type RefCallback,
} from 'react'

export function useLatestRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value)
  // Adapter-local useEvent cell: the write is deterministic and keeps stable
  // callbacks fresh before child layout effects or render-time selectors run.
  // eslint-disable-next-line react-hooks/refs
  ref.current = value

  return ref
}

export function useStableCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  const callbackRef = useLatestRef(callback)

  return useCallback(
    (...args: Args) => callbackRef.current(...args),
    [callbackRef],
  )
}

export function useStableOptionalCallback<Args extends unknown[], Result>(
  callback: ((...args: Args) => Result) | undefined,
): ((...args: Args) => Result) | undefined {
  const callbackRef = useLatestRef(callback)
  const stableCallback = useCallback(
    (...args: Args): Result => {
      const current = callbackRef.current

      if (!current) {
        return undefined as Result
      }

      return current(...args)
    },
    [callbackRef],
  )

  return callback ? stableCallback : undefined
}

export function useElementRef<T extends Element>(): readonly [
  MutableRefObject<T | null>,
  T | null,
  RefCallback<T>,
] {
  const ref = useRef<T | null>(null)
  const [element, setElement] = useState<T | null>(null)
  const setRef = useCallback((nextElement: T | null) => {
    ref.current = nextElement
    setElement((currentElement) =>
      Object.is(currentElement, nextElement) ? currentElement : nextElement,
    )
  }, [])

  return [ref, element, setRef]
}
