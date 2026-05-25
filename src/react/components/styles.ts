import type { CSSProperties } from 'react'

export const baseViewportStyle: CSSProperties = {
  overflow: 'hidden',
  position: 'relative',
}

export const scrollContainerStyle: CSSProperties = {
  height: '100%',
  overflowY: 'auto',
  overflowAnchor: 'none',
  position: 'relative',
}

export const messageWindowStyle: CSSProperties = {
  display: 'block',
}

export const normalFlowRowStyle: CSSProperties = {
  display: 'block',
  position: 'static',
}
