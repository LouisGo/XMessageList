import { describe, expect, it, vi } from 'vitest'
import type { MessageListRuntimeEvent } from '../../../runtime/index'
import { MessageListSessionDestinationController } from '../destinationController'

describe('MessageListSessionDestinationController', () => {
  it('cancels only the matching pending destination after its runtime work stops', () => {
    const observed: string[] = []
    const controller = new MessageListSessionDestinationController(
      'source-a',
      () => false,
      () => observed.push(controller.getState().status),
    )
    const accepted = controller.dispatch({ id: 'target' }, () => undefined)
    if (accepted.status !== 'accepted') throw new Error('expected accepted destination')

    expect(controller.cancelDestination({
      destinationId: 'source-a:destination:stale',
      reason: 'superseded',
    }, () => observed.push('stopped'))).toEqual({
      status: 'ignored',
      reason: 'not-current',
    })
    expect(controller.getState().status).toBe('pending')

    expect(controller.cancelDestination({
      destinationId: accepted.destinationId,
      reason: 'superseded',
    }, () => observed.push('stopped'))).toEqual({
      status: 'cancelled',
      destinationId: accepted.destinationId,
    })
    expect(controller.getState()).toMatchObject({
      status: 'cancelled',
      destinationId: accepted.destinationId,
      reason: 'superseded',
    })
    expect(observed).toEqual(['pending', 'stopped', 'cancelled'])
  })

  it('ignores explicit cancellation after the session is destroyed', () => {
    let destroyed = false
    const controller = new MessageListSessionDestinationController(
      'source-a', () => destroyed, () => undefined,
    )
    const accepted = controller.dispatch({ id: 'target' }, () => undefined)
    if (accepted.status !== 'accepted') throw new Error('expected accepted destination')
    destroyed = true

    expect(controller.cancelDestination({
      destinationId: accepted.destinationId,
      reason: 'superseded',
    }, () => undefined)).toEqual({
      status: 'ignored',
      reason: 'session-destroyed',
    })
  })

  it('maps the active destination projection timeout to a failed terminal state', () => {
    const notify = vi.fn()
    const controller = new MessageListSessionDestinationController(
      'source-a', () => false, notify,
    )
    controller.dispatch({ id: 'target' }, () => undefined)
    controller.handleRuntimeEvent(aroundEvent('source-a:around:1'))
    controller.handleRuntimeEvent(projectionTimeout(1, 1))
    expect(controller.getState()).toMatchObject({ status: 'pending' })
    controller.expectProjection('source-a:around:1', {
      generation: 2,
      segmentRevision: 1,
    })

    controller.handleRuntimeEvent(projectionTimeout(2, 1))

    expect(controller.getState()).toMatchObject({
      status: 'failed',
      destinationId: 'source-a:destination:1',
      reason: 'commit-timeout',
    })
    expect(notify).toHaveBeenCalledTimes(2)
  })

  it('ignores a stale request result after a newer destination is accepted', () => {
    const controller = new MessageListSessionDestinationController(
      'source-a', () => false, () => undefined,
    )
    controller.dispatch({ id: 'first' }, () => undefined)
    controller.handleRuntimeEvent(aroundEvent('source-a:around:1', 'first'))
    controller.dispatch({ id: 'second' }, () => undefined)
    controller.handleRuntimeEvent(aroundEvent('source-a:around:2', 'second'))

    controller.finishRequest('source-a:around:1', {
      sessionId: 'source-a',
      source: { id: 'source-a' },
      kind: 'around',
      trigger: 'command',
      status: 'failed',
      error: new Error('stale failure'),
    })

    expect(controller.getState()).toMatchObject({
      status: 'pending',
      destinationId: 'source-a:destination:2',
      target: { stableId: 'second' },
    })
  })
})

function projectionTimeout(
  generation: number,
  segmentRevision: number,
): MessageListRuntimeEvent {
  return {
    type: 'projectionSettled',
    sessionId: 'source-a',
    generation,
    segmentRevision,
    commitToken: {
      sessionId: 'source-a',
      generation,
      segmentRevision,
      projectionRevision: 1,
    },
    status: 'commit-timeout',
  }
}

function aroundEvent(
  requestToken: string,
  stableId = 'target',
): MessageListRuntimeEvent {
  return {
    type: 'needMessagesAround',
    sessionId: 'source-a',
    generation: 1,
    segmentRevision: 0,
    requestToken,
    reason: 'destination-missing',
    target: { sessionId: 'source-a', stableId },
  }
}
