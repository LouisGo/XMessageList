import type {
  MessageIdentityAnchor,
  MessageListRuntimeEvent,
} from '../../runtime/index'
import type { MessageListAnchorMemoryValue } from '../contracts'

export function createSessionRuntimeEventRouter(input: {
  isCurrent: (generation: number, segmentRevision: number) => boolean
  onNavigation: () => void
  onDestinationCancelled: (requestToken: string) => void
  saveAnchor: (value: MessageListAnchorMemoryValue) => void
  onObservation: (
    event: Extract<MessageListRuntimeEvent, { type: 'viewportObservationChanged' }>,
  ) => void
  loadEdge: (
    event: Extract<MessageListRuntimeEvent, { type: 'needMoreBefore' | 'needMoreAfter' }>,
  ) => void
  loadLatest: (
    event: Extract<MessageListRuntimeEvent, { type: 'needLatestMessages' }>,
  ) => void
  loadAround: (
    target: MessageIdentityAnchor,
    event: Extract<MessageListRuntimeEvent, { type: 'needMessagesAround' }>,
  ) => void
}): (event: MessageListRuntimeEvent) => void {
  return (event) => {
    if (event.type === 'viewportNavigationIntent') {
      input.onNavigation()
      return
    }
    if (event.type === 'destinationCancelled') {
      input.onDestinationCancelled(event.requestToken)
      return
    }
    if (event.type === 'viewportAnchorChanged' && event.anchor) {
      if (!input.isCurrent(event.generation, event.segmentRevision)) return
      input.saveAnchor({
        anchor: event.anchor,
        offsetWithinMessage: event.offsetWithinMessage,
      })
      return
    }
    if (event.type === 'viewportObservationChanged') {
      if (
        event.activity === 'scrolling' &&
        (event.scrollSource === 'user' || event.scrollSource === 'momentum')
      ) {
        input.onNavigation()
      }
      input.onObservation(event)
      return
    }
    if (event.type === 'needMoreBefore' || event.type === 'needMoreAfter') {
      input.loadEdge(event)
      return
    }
    if (event.type === 'needLatestMessages') {
      input.loadLatest(event)
      return
    }
    if (event.type === 'needMessagesAround') {
      input.loadAround(event.target, event)
    }
  }
}
