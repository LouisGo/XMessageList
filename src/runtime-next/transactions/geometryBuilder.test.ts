import { describe, expect, it } from 'vitest'
import type { MessageDataItem } from '../types'
import type { PhysicalSegment } from '../geometry/segment/physicalSegment.types'
import { buildGeometryPlan } from './geometryBuilder'
import { GeometryRelayoutBoundsError } from './geometryBuilderRelayout'

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

describe('runtime-next geometry builder', () => {
  it('keeps segmentRelayout render window inside current logical bounds', () => {
    const items = Array.from({ length: 10 }, (_, index) =>
      item(`m-${index + 1}`),
    )
    const currentSegment: PhysicalSegment = {
      segmentId: 'segment-history',
      segmentRevision: 1,
      logicalSegmentId: 'logical-history',
      logicalAnchorKey: items[3].key,
      logicalStartItemKey: items[2].key,
      logicalEndItemKey: items[4].key,
      renderWindowStartKey: items[2].key,
      renderWindowEndKey: items[4].key,
      logicalRole: 'history',
      estimatedRowsHeight: 192,
      physicalWindowHeight: 320,
      scrollHeightCap: 320,
      capMode: 'normal',
    }

    const plan = buildGeometryPlan({
      kind: 'segmentRelayout',
      data: {
        feedId: 'feed',
        generation: 1,
        revision: 2,
        items,
        hasMoreBefore: true,
        hasMoreAfter: true,
        change: {
          kind: 'patch',
          viewportModifier: 'items-change',
        },
      },
      viewportSize: {
        clientHeight: 320,
        clientWidth: 320,
      },
      currentScrollTop: 0,
      currentSegment,
    })
    const renderedIds = plan.renderWindow.itemKeys.map((key) =>
      key.kind === 'committed' ? key.messageId : key.clientMessageId,
    )

    expect(renderedIds.every((id) => ['m-3', 'm-4', 'm-5'].includes(id))).toBe(true)
    expect(plan.segment.logicalSegmentId).toBe(currentSegment.logicalSegmentId)
    expect(plan.segment.logicalStartItemKey).toEqual(currentSegment.logicalStartItemKey)
    expect(plan.segment.logicalEndItemKey).toEqual(currentSegment.logicalEndItemKey)
  })

  it('throws instead of publishing an empty relayout when logical bounds are missing', () => {
    const items = [item('new-1'), item('new-2')]
    const currentSegment: PhysicalSegment = {
      segmentId: 'segment-history',
      segmentRevision: 1,
      logicalSegmentId: 'logical-history',
      logicalAnchorKey: item('missing-anchor').key,
      logicalStartItemKey: item('missing-start').key,
      logicalEndItemKey: item('missing-end').key,
      renderWindowStartKey: item('missing-start').key,
      renderWindowEndKey: item('missing-end').key,
      logicalRole: 'history',
      estimatedRowsHeight: 192,
      physicalWindowHeight: 320,
      scrollHeightCap: 320,
      capMode: 'normal',
    }

    expect(() =>
      buildGeometryPlan({
        kind: 'segmentRelayout',
        data: {
          feedId: 'feed',
          generation: 1,
          revision: 2,
          items,
          hasMoreBefore: true,
          hasMoreAfter: true,
          change: {
            kind: 'patch',
            viewportModifier: 'items-change',
          },
        },
        viewportSize: {
          clientHeight: 320,
          clientWidth: 320,
        },
        currentScrollTop: 0,
        currentSegment,
      }),
    ).toThrow(GeometryRelayoutBoundsError)
  })
})
