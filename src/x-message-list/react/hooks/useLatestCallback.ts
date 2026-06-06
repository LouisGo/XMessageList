import { useCallback } from 'react'
import { useLatestRef } from './useLatestRef'

export function useLatestCallback<TArgs extends unknown[], TResult>(
  callback: (...args: TArgs) => TResult,
): (...args: TArgs) => TResult
export function useLatestCallback<TArgs extends unknown[], TResult>(
  callback: ((...args: TArgs) => TResult) | undefined,
): (...args: TArgs) => TResult | undefined
export function useLatestCallback<TArgs extends unknown[], TResult>(
  callback?: (...args: TArgs) => TResult,
): (...args: TArgs) => TResult | undefined {
  const callbackRef = useLatestRef(callback)

  return useCallback(
    (...args: TArgs) => callbackRef.current?.(...args),
    [callbackRef],
  )
}
