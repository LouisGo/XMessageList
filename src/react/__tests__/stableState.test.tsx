import { act, useLayoutEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  useElementRef,
  useStableCallback,
  useStableOptionalCallback,
} from '../hooks/stableState'

describe('stable adapter state hooks', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps callback identity stable while invoking the latest implementation', async () => {
    let callStable: (() => string) | null = null
    let setValue: ((value: string) => void) | null = null
    const identities: Array<() => string> = []
    const host = document.createElement('div')
    const root = createRoot(host)

    function Harness() {
      const [value, updateValue] = useState('first')
      const stable = useStableCallback(() => value)

      useLayoutEffect(() => {
        callStable = stable
        setValue = updateValue
        identities.push(stable)
      }, [stable, updateValue, value])

      return null
    }

    await act(async () => {
      root.render(<Harness />)
    })

    expect(callStable?.()).toBe('first')

    await act(async () => {
      setValue?.('second')
    })

    expect(identities.length).toBeGreaterThanOrEqual(2)
    expect(identities.at(0)).toBe(identities.at(-1))
    expect(callStable?.()).toBe('second')

    await act(async () => {
      root.unmount()
    })
  })

  it('keeps optional callbacks stable and disables them when the source is absent', async () => {
    const firstHandler = vi.fn()
    const secondHandler = vi.fn()
    let callStable: ((value: string) => void) | undefined
    let setHandler:
      | ((
          handler:
            | ((value: string) => void)
            | undefined,
        ) => void)
      | null = null
    const identities: Array<((value: string) => void) | undefined> = []
    const host = document.createElement('div')
    const root = createRoot(host)

    function Harness() {
      const [handler, updateHandler] = useState<
        ((value: string) => void) | undefined
      >(() => firstHandler)
      const stable = useStableOptionalCallback(handler)

      useLayoutEffect(() => {
        callStable = stable
        setHandler = (nextHandler) => {
          updateHandler(() => nextHandler)
        }
        identities.push(stable)
      }, [handler, stable, updateHandler])

      return null
    }

    await act(async () => {
      root.render(<Harness />)
    })

    callStable?.('first')
    expect(firstHandler).toHaveBeenCalledWith('first')

    await act(async () => {
      setHandler?.(secondHandler)
    })

    expect(identities.at(0)).toBe(identities.at(-1))
    callStable?.('second')
    expect(firstHandler).toHaveBeenCalledTimes(1)
    expect(secondHandler).toHaveBeenCalledWith('second')

    await act(async () => {
      setHandler?.(undefined)
    })

    expect(callStable).toBeUndefined()

    await act(async () => {
      root.unmount()
    })
  })

  it('keeps element ref callbacks stable while exposing the latest element', async () => {
    let observedElement: HTMLDivElement | null = null
    const identities: Array<(element: HTMLDivElement | null) => void> = []
    const host = document.createElement('div')
    const root = createRoot(host)

    function Harness({ label }: { label: string }) {
      const [, element, setElementRef] = useElementRef<HTMLDivElement>()

      useLayoutEffect(() => {
        observedElement = element
        identities.push(setElementRef)
      }, [element, setElementRef])

      return <div ref={setElementRef}>{label}</div>
    }

    await act(async () => {
      root.render(<Harness label="first" />)
    })

    expect(observedElement?.textContent).toBe('first')

    await act(async () => {
      root.render(<Harness label="second" />)
    })

    expect(observedElement?.textContent).toBe('second')
    expect(identities.at(0)).toBe(identities.at(-1))

    await act(async () => {
      root.unmount()
    })
  })
})
