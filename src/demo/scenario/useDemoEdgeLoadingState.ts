import { useCallback, useRef, useState } from 'react'

type RuntimeEdge = 'before' | 'after'

export function useDemoEdgeLoadingState(): {
  loadingBefore: boolean
  loadingAfter: boolean
  setEdgeLoading: (edge: RuntimeEdge, loading: boolean) => void
} {
  const [loadingBefore, setLoadingBefore] = useState(false)
  const [loadingAfter, setLoadingAfter] = useState(false)
  const edgeLoadingRef = useRef({ before: false, after: false })

  const setEdgeLoading = useCallback((edge: RuntimeEdge, loading: boolean) => {
    edgeLoadingRef.current = { ...edgeLoadingRef.current, [edge]: loading }
    if (edge === 'before') {
      setLoadingBefore(loading)
    } else {
      setLoadingAfter(loading)
    }
  }, [])

  return { loadingBefore, loadingAfter, setEdgeLoading }
}
