import { describe, expect, it } from 'vitest'
import classifierSource from './classifier.ts?raw'
import classifierTypesSource from './classifier.types.ts?raw'
import { classifyDataArrival } from './classifier'
import type { MessageDataSnapshot } from './types'
import type { MessageDataItem } from '../projection/types'

function item(messageId: string): MessageDataItem<{ text: string }> {
  return {
    kind: 'committed',
    key: {
      kind: 'committed',
      messageId,
    },
    message: {
      text: messageId,
    },
    version: 1,
    estimatedHeight: 64,
  }
}

function snapshot(
  items: readonly MessageDataItem<{ text: string }>[],
): MessageDataSnapshot<{ text: string }> {
  return {
    feedId: 'feed',
    generation: 1,
    revision: 1,
    items,
    hasMoreBefore: false,
    hasMoreAfter: false,
    change: {
      kind: 'patch',
      viewportModifier: 'items-change',
    },
  }
}

describe('runtime-next data arrival classifier', () => {
  it('does not import geometry builders or solvers', () => {
    const combinedSource = `${classifierSource}\n${classifierTypesSource}`

    expect(combinedSource).not.toMatch(
      /rowSelection|spacerSolver|heightBudget|geometryBuilder/,
    )
  })

  it('emits only intent when active projection is still addressable', () => {
    const m1 = item('m-1')

    expect(
      classifyDataArrival({
        snapshot: snapshot([m1]),
        activeProjection: {
          renderWindow: {
            startIndex: 0,
            endIndex: 0,
            itemKeys: [m1.key],
          },
          logicalStartItemKey: m1.key,
          logicalEndItemKey: m1.key,
        },
        pendingIntent: null,
      }).intent,
    ).toEqual({
      kind: 'projectionRefresh',
    })
  })

  it('resolves pending follow-bottom only when latest data is present', () => {
    const m1 = item('m-1')
    const missingLatest = {
      ...snapshot([m1]),
      hasMoreAfter: true,
    }

    expect(
      classifyDataArrival({
        snapshot: missingLatest,
        activeProjection: null,
        pendingIntent: {
          kind: 'followBottom',
        },
      }).intent,
    ).toEqual({
      kind: 'no-op',
      reason: 'latest-data-still-missing',
    })
    expect(
      classifyDataArrival({
        snapshot: snapshot([m1]),
        activeProjection: null,
        pendingIntent: {
          kind: 'followBottom',
        },
      }).intent,
    ).toEqual({
      kind: 'followBottom',
    })
  })

  it('turns auto-scroll-to-bottom data into follow-bottom semantics', () => {
    const m1 = item('m-1')

    expect(
      classifyDataArrival({
        snapshot: {
          ...snapshot([m1]),
          change: {
            kind: 'append',
            viewportModifier: 'auto-scroll-to-bottom',
          },
        },
        activeProjection: null,
        pendingIntent: null,
      }).intent,
    ).toEqual({
      kind: 'followBottom',
    })
    expect(
      classifyDataArrival({
        snapshot: {
          ...snapshot([m1]),
          hasMoreAfter: true,
          change: {
            kind: 'append',
            viewportModifier: 'auto-scroll-to-bottom',
          },
        },
        activeProjection: null,
        pendingIntent: null,
      }).intent,
    ).toEqual({
      kind: 'no-op',
      reason: 'latest-data-still-missing',
    })
  })

  it('resolves pending segmentShift only when adjacent data exists', () => {
    const m1 = item('m-1')
    const m2 = item('m-2')
    const m3 = item('m-3')

    expect(
      classifyDataArrival({
        snapshot: snapshot([m1, m2]),
        activeProjection: {
          renderWindow: {
            startIndex: 0,
            endIndex: 0,
            itemKeys: [m1.key],
          },
          logicalStartItemKey: m1.key,
          logicalEndItemKey: m1.key,
        },
        pendingIntent: {
          kind: 'segmentShift',
          direction: 'before',
        },
      }).intent,
    ).toEqual({
      kind: 'no-op',
      reason: 'pending-shift-missing-data',
    })
    expect(
      classifyDataArrival({
        snapshot: snapshot([m1, m2, m3]),
        activeProjection: {
          renderWindow: {
            startIndex: 1,
            endIndex: 1,
            itemKeys: [m2.key],
          },
          logicalStartItemKey: m2.key,
          logicalEndItemKey: m2.key,
        },
        pendingIntent: {
          kind: 'segmentShift',
          direction: 'before',
        },
      }).intent,
    ).toEqual({
      kind: 'segmentShift',
      direction: 'before',
    })
  })

  it('does not map prepend or append directly without pending intent', () => {
    const m1 = item('m-1')
    const data = {
      ...snapshot([m1]),
      change: {
        kind: 'append' as const,
        viewportModifier: 'append' as const,
      },
    }

    expect(
      classifyDataArrival({
        snapshot: data,
        activeProjection: null,
        pendingIntent: null,
      }).intent,
    ).toEqual({
      kind: 'no-op',
      reason: 'no-active-segment',
    })
  })
})
