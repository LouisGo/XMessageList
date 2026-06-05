import { describe, expect, it, vi } from 'vitest'
import {
  createMessageListRuntime,
  type LoadedSegment,
  type MessageDataItem,
  type MessageListRuntimeEvent,
} from '../index'
import {
  getMessageListAdapterRuntime,
  getMessageListSessionRegistryRuntime,
  type MessageListAdapterRuntime,
} from '../internal'
import type { MessageIdentityAnchor } from '../contracts/identity'
import type { MessageListRuntime } from '../controller/runtime'
import { measureRuntimeDom } from '../dom/measurement'
import { RuntimeRowMetricCache } from '../dom/rowMetricCache'
import { FakeScheduler, createContainer, createFakeObservers, setElementMetrics } from '../../../../test/fakes'

describe('MessageList viewport motion', () => {
  it('animates local jump destinations and settles the destination after motion', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ sessionId: 'feed-a', scheduler })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = createRows(6, 50)
    const events: MessageListRuntimeEvent[] = []
    const target = anchor('row-1')

    mountRows(runtime, adapter, container, rows)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment(itemsFromRows(rows), 1, 1, {
      modifier: { type: 'reset-latest' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    container.scrollTop = 200
    positionRows(rows, 200)

    runtime.scrollToMessage(target, {
      align: 'start',
      motion: { direction: 'before' },
    })

    expect(runtime.getSnapshot().viewportPhase).toBe('MOTION')
    expect(events.some((event) => event.type === 'destinationSettled')).toBe(false)
    expect(runtime.getDiagnostics()).toContainEqual(expect.objectContaining({
      name: 'destinationMotion.start',
      details: expect.objectContaining({
        source: 'jump',
        directionHint: 'before',
      }),
    }))

    scheduler.flushFrames(40)

    expect(container.scrollTop).toBe(0)
    expect(runtime.getSnapshot().viewportPhase).toBe('IDLE')
    expect(events).toContainEqual(expect.objectContaining({
      type: 'destinationSettled',
      intent: 'jump',
      target,
      resolvedTarget: target,
    }))
  })

  it('keeps follow-bottom semantically locked during motion and after settle', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ sessionId: 'feed-a', scheduler })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = createRows(6, 50)

    mountRows(runtime, adapter, container, rows)
    runtime.applyLoadedSegment(segment(itemsFromRows(rows), 1, 1, {
      modifier: { type: 'reset-latest' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    container.scrollTop = 0
    positionRows(rows, 0)

    runtime.scrollToLatest()

    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'MOTION',
      bottomLockState: 'LOCKED',
    })
    expect(container.scrollTop).toBe(0)

    scheduler.flushFrames(40)

    expect(container.scrollTop).toBe(200)
    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'IDLE',
      bottomLockState: 'LOCKED',
    })
  })

  it('settles disabled motion synchronously while preserving follow-bottom and destination semantics', () => {
    const runtime = createMessageListRuntime<string>({
      sessionId: 'feed-a',
      scrollMotion: { enabled: false },
    })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = createRows(6, 50)
    const events: MessageListRuntimeEvent[] = []
    const target = anchor('row-1')

    mountRows(runtime, adapter, container, rows)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment(itemsFromRows(rows), 1, 1, {
      modifier: { type: 'reset-latest' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    runtime.scrollToLatest()

    expect(container.scrollTop).toBe(200)
    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'IDLE',
      bottomLockState: 'LOCKED',
      pendingIntent: null,
    })

    positionRows(rows, 200)
    runtime.scrollToMessage(target, { align: 'start' })

    expect(container.scrollTop).toBe(0)
    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'IDLE',
      bottomLockState: 'UNLOCKED',
      pendingIntent: null,
    })
    expect(events).toContainEqual(expect.objectContaining({
      type: 'destinationSettled',
      intent: 'jump',
      target,
      resolvedTarget: target,
    }))
  })

  it('continues bottom motion when append supersedes follow-bottom motion', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ sessionId: 'feed-a', scheduler })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = createRows(8, 50)

    mountRows(runtime, adapter, container, rows.slice(0, 6))
    runtime.applyLoadedSegment(segment(itemsFromRows(rows.slice(0, 6)), 1, 1, {
      modifier: { type: 'reset-latest' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    container.scrollTop = 0
    runtime.scrollToLatest()
    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'MOTION',
      bottomLockState: 'LOCKED',
    })

    container.append(rows[6], rows[7])
    adapter.registerRowElement('row-7', rows[6])
    adapter.registerRowElement('row-8', rows[7])
    runtime.applyLoadedSegment(segment(itemsFromRows(rows), 1, 2, {
      modifier: { type: 'append', changedKeys: ['row-7', 'row-8'], follow: 'follow' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'MOTION',
      bottomLockState: 'LOCKED',
    })
    expect(container.scrollTop).toBe(0)

    scheduler.flushFrames(40)

    expect(container.scrollTop).toBe(300)
    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'IDLE',
      bottomLockState: 'LOCKED',
    })
  })

  it('uses bottom motion for received appends while already locked', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ sessionId: 'feed-a', scheduler })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = createRows(8, 50)

    mountRows(runtime, adapter, container, rows.slice(0, 6))
    runtime.applyLoadedSegment(segment(itemsFromRows(rows.slice(0, 6)), 1, 1, {
      modifier: { type: 'reset-latest' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    container.scrollTop = 200
    runtime.scrollToLatest()
    scheduler.flushFrames(40)
    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'IDLE',
      bottomLockState: 'LOCKED',
    })

    container.append(rows[6], rows[7])
    adapter.registerRowElement('row-7', rows[6])
    adapter.registerRowElement('row-8', rows[7])
    runtime.applyLoadedSegment(segment(itemsFromRows(rows), 1, 2, {
      modifier: { type: 'append', changedKeys: ['row-7', 'row-8'], follow: 'follow' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'MOTION',
      bottomLockState: 'LOCKED',
    })
    expect(container.scrollTop).toBe(200)

    scheduler.flushFrames(40)

    expect(container.scrollTop).toBe(300)
    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'IDLE',
      bottomLockState: 'LOCKED',
    })
  })

  it('does not preposition away from bottom when a retry append retires a visible placeholder', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ sessionId: 'feed-a', scheduler })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = createRows(7, 50)

    mountRows(runtime, adapter, container, rows.slice(0, 6))
    runtime.applyLoadedSegment(segment(itemsFromRows(rows.slice(0, 6)), 1, 1, {
      modifier: { type: 'reset-latest' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    container.scrollTop = 200
    runtime.scrollToLatest()
    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'IDLE',
      bottomLockState: 'LOCKED',
    })

    rows[5].remove()
    adapter.registerRowElement('row-6', null)
    container.append(rows[6])
    adapter.registerRowElement('row-7', rows[6])
    runtime.applyLoadedSegment(segment(itemsFromRows([
      ...rows.slice(0, 5),
      rows[6],
    ]), 1, 2, {
      modifier: {
        type: 'append',
        changedKeys: ['row-6', 'row-7'],
        follow: 'follow',
        retireKeys: ['row-6'],
      },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(container.scrollTop).toBe(200)
    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'IDLE',
      bottomLockState: 'LOCKED',
    })
    expect(runtime.getDiagnostics()).toContainEqual(expect.objectContaining({
      name: 'scrollMotion.decision',
      details: expect.objectContaining({
        decision: 'epsilon-settle',
        enforceDirectionHint: false,
      }),
    }))
  })

  it('keeps retry loading patches from replaying semantic bottom motion while locked', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ sessionId: 'feed-a', scheduler })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = createRows(6, 50)

    mountRows(runtime, adapter, container, rows)
    runtime.applyLoadedSegment(segment(itemsFromRows(rows), 1, 1, {
      modifier: { type: 'reset-latest' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    runtime.scrollToLatest()
    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'IDLE',
      bottomLockState: 'LOCKED',
    })
    expect(container.scrollTop).toBe(200)

    const diagnosticsBefore = runtime.getDiagnostics().length
    runtime.applyLoadedSegment(segment(itemsFromRows(rows), 1, 2, {
      modifier: { type: 'patch', changedKeys: ['row-6'] },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(container.scrollTop).toBe(200)
    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'IDLE',
      bottomLockState: 'LOCKED',
    })
    expect(runtime.getDiagnostics().slice(diagnosticsBefore)).toContainEqual(
      expect.objectContaining({
        name: 'scrollMotion.decision',
        details: expect.objectContaining({
          decision: 'epsilon-settle',
          enforceDirectionHint: false,
        }),
      }),
    )
    expect(runtime.getDiagnostics().slice(diagnosticsBefore)).not.toContainEqual(
      expect.objectContaining({
        name: 'scrollMotion.decision',
        details: expect.objectContaining({
          decision: 'bounded-animate',
          semanticPrepositionTop: expect.any(Number),
        }),
      }),
    )
  })

  it('lets incoming append policy preserve position and unlock bottom', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ sessionId: 'feed-a', scheduler })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = createRows(8, 50)

    mountRows(runtime, adapter, container, rows.slice(0, 6))
    runtime.applyLoadedSegment(segment(itemsFromRows(rows.slice(0, 6)), 1, 1, {
      modifier: { type: 'reset-latest' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    container.scrollTop = 200
    runtime.scrollToLatest()
    scheduler.flushFrames(40)
    expect(runtime.getSnapshot().bottomLockState).toBe('LOCKED')

    container.append(rows[6], rows[7])
    adapter.registerRowElement('row-7', rows[6])
    adapter.registerRowElement('row-8', rows[7])
    runtime.applyLoadedSegment(segment(itemsFromRows(rows), 1, 2, {
      modifier: { type: 'append', changedKeys: ['row-7', 'row-8'], follow: 'preserve' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'IDLE',
      bottomLockState: 'UNLOCKED',
    })
    expect(container.scrollTop).toBe(200)
  })

  it('lets an explicit bottom command override a later preserve append', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ sessionId: 'feed-a', scheduler })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = createRows(7, 50)

    mountRows(runtime, adapter, container, rows.slice(0, 6))
    runtime.applyLoadedSegment(segment(itemsFromRows(rows.slice(0, 6)), 1, 1, {
      modifier: { type: 'reset-latest' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    container.scrollTop = 0
    container.dispatchEvent(new Event('scroll'))
    scheduler.flushFrame()
    expect(runtime.getSnapshot().bottomLockState).toBe('UNLOCKED')

    runtime.scrollToLatest()
    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'MOTION',
      bottomLockState: 'LOCKED',
    })

    container.append(rows[6])
    adapter.registerRowElement('row-7', rows[6])
    runtime.applyLoadedSegment(segment(itemsFromRows(rows), 1, 2, {
      modifier: { type: 'append', changedKeys: ['row-7'], follow: 'preserve' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'MOTION',
      bottomLockState: 'LOCKED',
    })

    scheduler.flushFrames(40)

    expect(container.scrollTop).toBe(250)
    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'IDLE',
      bottomLockState: 'LOCKED',
    })
  })

  it('cancels active motion on explicit user scroll input', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({
      sessionId: 'feed-a',
      scheduler,
      observers: null,
    })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = createRows(6, 50)

    mountRows(runtime, adapter, container, rows)
    runtime.applyLoadedSegment(segment(itemsFromRows(rows), 1, 1, {
      modifier: { type: 'reset-latest' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    container.scrollTop = 200
    positionRows(rows, 200)
    runtime.scrollToMessage(anchor('row-1'), { align: 'start' })
    expect(runtime.getSnapshot().viewportPhase).toBe('MOTION')

    container.scrollTop = 160
    container.dispatchEvent(new Event('wheel'))
    scheduler.flushFrame()
    scheduler.flushFrames(40)

    expect(container.scrollTop).toBe(160)
    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'IDLE',
      bottomLockState: 'UNLOCKED',
    })
    expect(runtime.getDiagnostics()).toContainEqual(expect.objectContaining({
      name: 'destinationMotion.cancel',
      details: expect.objectContaining({ reason: 'user-interrupt' }),
    }))
  })

  it('retargets active destination motion when resize changes the target geometry', () => {
    const scheduler = new FakeScheduler()
    const observers = createFakeObservers()
    const runtime = createMessageListRuntime<string>({
      sessionId: 'feed-a',
      scheduler,
      observers,
    })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = createRows(6, 50)

    mountRows(runtime, adapter, container, rows)
    runtime.applyLoadedSegment(segment(itemsFromRows(rows), 1, 1, {
      modifier: { type: 'reset-latest' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    container.scrollTop = 0
    positionRows(rows, 0)

    runtime.scrollToMessage(anchor('row-5'), { align: 'start' })
    scheduler.flushFrame()

    const currentTop = container.scrollTop
    positionRowsWithHeights(rows, [90, 50, 50, 50, 50, 50], currentTop)
    observers.resizeObservers[0]?.trigger(rows[0], 90)
    scheduler.flushFrame()

    expect(runtime.getDiagnostics()).toContainEqual(expect.objectContaining({
      name: 'scrollMotion.retarget',
      details: expect.objectContaining({
        decision: 'retarget-animate',
        targetTop: 240,
      }),
    }))

    scheduler.flushFrames(60)

    expect(container.scrollTop).toBe(240)
    expect(runtime.getSnapshot().viewportPhase).toBe('IDLE')
  })

  it('cancels active destination motion when resize loses the target row', () => {
    const scheduler = new FakeScheduler()
    const observers = createFakeObservers()
    const runtime = createMessageListRuntime<string>({
      sessionId: 'feed-a',
      scheduler,
      observers,
    })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = createRows(6, 50)
    const events: MessageListRuntimeEvent[] = []

    mountRows(runtime, adapter, container, rows)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment(itemsFromRows(rows), 1, 1, {
      modifier: { type: 'reset-latest' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    container.scrollTop = 0
    positionRows(rows, 0)
    runtime.scrollToMessage(anchor('row-5'), { align: 'start' })

    rows[4].remove()
    adapter.registerRowElement('row-5', null)
    observers.resizeObservers[0]?.trigger(rows[3], 50)
    scheduler.flushFrame()
    scheduler.flushFrames(20)

    expect(runtime.getSnapshot().viewportPhase).toBe('IDLE')
    expect(runtime.getDiagnostics()).toContainEqual(expect.objectContaining({
      name: 'destinationMotion.cancel',
      details: expect.objectContaining({ reason: 'target-missing' }),
    }))
    expect(events).not.toContainEqual(expect.objectContaining({
      type: 'destinationSettled',
      target: anchor('row-5'),
    }))
  })

  it('reuses measured row rects when recording row metrics', () => {
    const scheduler = new FakeScheduler()
    const container = createContainer({ height: 100 })
    const rows = createRows(6, 50)
    container.append(...rows)
    const counter = countRowRectReads(rows)
    const snapshot = {
      scrollContainer: container,
      messageFlow: null,
      beforeTrigger: null,
      afterTrigger: null,
      bottomMarker: null,
      rows: new Map(rows.map((row) => [
        row.dataset.runtimeKey as string,
        row,
      ])),
    }
    const measurement = measureRuntimeDom(snapshot)
    const rowMetrics = new RuntimeRowMetricCache({
      scheduler,
      onDiagnostic: () => {},
    })

    counter.reset()

    rowMetrics.record(snapshot, measurement)

    expect(counter.reads()).toBe(0)
  })

  it('lets a new transaction supersede motion without publishing a cancelled destination settle', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ sessionId: 'feed-a', scheduler })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = createRows(6, 50)
    const events: MessageListRuntimeEvent[] = []
    const phases: string[] = []
    const target = anchor('row-1')

    mountRows(runtime, adapter, container, rows)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.subscribeSnapshot(() => { phases.push(runtime.getSnapshot().viewportPhase) })
    runtime.applyLoadedSegment(segment(itemsFromRows(rows), 1, 1, {
      modifier: { type: 'reset-latest' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    container.scrollTop = 200
    positionRows(rows, 200)
    runtime.scrollToMessage(target, { align: 'start' })
    const phaseCountBeforeSupersede = phases.length

    runtime.applyLoadedSegment(segment(itemsFromRows(rows), 2, 1, {
      hasMoreAfter: true,
      modifier: { type: 'reset-latest' },
    }))

    expect(phases.slice(phaseCountBeforeSupersede)).toEqual(['PROJECTING'])
    expect(runtime.getSnapshot().viewportPhase).toBe('PROJECTING')
    expect(events.some((event) =>
      event.type === 'destinationSettled' && event.target.stableId === 'row-1'
    )).toBe(false)

    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    scheduler.flushFrames(40)

    expect(runtime.getSnapshot().viewportPhase).toBe('IDLE')
    expect(events.some((event) =>
      event.type === 'destinationSettled' && event.target.stableId === 'row-1'
    )).toBe(false)
  })

  it('cancels active motion before opening a remote destination intent', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ sessionId: 'feed-a', scheduler })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = createRows(6, 50)
    const remoteRows = createRows(8, 50)
    const events: MessageListRuntimeEvent[] = []
    const localTarget = anchor('row-1')
    const remoteTarget = anchor('row-7')

    mountRows(runtime, adapter, container, rows)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment(itemsFromRows(rows), 1, 1, {
      modifier: { type: 'reset-latest' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    container.scrollTop = 200
    positionRows(rows, 200)
    runtime.scrollToMessage(localTarget, { align: 'start' })
    expect(runtime.getSnapshot().viewportPhase).toBe('MOTION')

    runtime.scrollToMessage(remoteTarget, { align: 'start' })
    scheduler.flushFrames(40)

    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'IDLE',
      pendingIntent: 'destination',
    })
    expect(events.some((event) =>
      event.type === 'destinationSettled' && event.target.stableId === 'row-1'
    )).toBe(false)
    expect(runtime.getDiagnostics()).toContainEqual(expect.objectContaining({
      name: 'destinationMotion.cancel',
      details: expect.objectContaining({ reason: 'command-supersede' }),
    }))

    replaceRows(adapter, container, remoteRows)
    runtime.applyLoadedSegment(segment(itemsFromRows(remoteRows), 2, 1, {
      hasMoreBefore: true,
      hasMoreAfter: true,
      modifier: { type: 'reset-around', target: remoteTarget },
      anchor: remoteTarget,
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    expect(runtime.getSnapshot().viewportPhase).toBe('MOTION')
    scheduler.flushFrames(40)

    expect(events).toContainEqual(expect.objectContaining({
      type: 'destinationSettled',
      target: remoteTarget,
      resolvedTarget: remoteTarget,
    }))
  })

  it('cancels active motion before opening a remote follow-bottom intent', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ sessionId: 'feed-a', scheduler })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = createRows(6, 50)
    const latestRows = createRows(8, 50)

    mountRows(runtime, adapter, container, rows)
    runtime.applyLoadedSegment(segment(itemsFromRows(rows), 1, 1, {
      hasMoreAfter: true,
      modifier: { type: 'reset-latest' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    container.scrollTop = 200
    positionRows(rows, 200)
    runtime.scrollToMessage(anchor('row-1'), { align: 'start' })
    expect(runtime.getSnapshot().viewportPhase).toBe('MOTION')

    runtime.scrollToLatest()
    scheduler.flushFrames(40)

    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'IDLE',
      pendingIntent: 'follow-bottom',
      bottomLockState: 'UNLOCKED',
    })

    replaceRows(adapter, container, latestRows)
    runtime.applyLoadedSegment(segment(itemsFromRows(latestRows), 2, 1, {
      hasMoreBefore: true,
      hasMoreAfter: false,
      modifier: { type: 'reset-latest' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'MOTION',
      bottomLockState: 'LOCKED',
    })
    scheduler.flushFrames(40)

    expect(runtime.getSnapshot().bottomLockState).toBe('LOCKED')
    expect(container.scrollTop).toBe(300)
  })

  it('starts queued transactions before opening a post-commit motion opportunity', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ sessionId: 'feed-a', scheduler })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = createRows(7, 50)
    const phases: string[] = []

    mountRows(runtime, adapter, container, rows.slice(0, 5))
    runtime.subscribeSnapshot(() => { phases.push(runtime.getSnapshot().viewportPhase) })
    runtime.applyLoadedSegment(segment(itemsFromRows(rows.slice(0, 5)), 1, 1, {
      modifier: { type: 'reset-latest' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    runtime.scrollToLatest()
    expect(runtime.getSnapshot().bottomLockState).toBe('LOCKED')

    container.append(rows[5], rows[6])
    adapter.registerRowElement('row-6', rows[5])
    adapter.registerRowElement('row-7', rows[6])
    runtime.applyLoadedSegment(segment(itemsFromRows(rows.slice(0, 6)), 1, 2, {
      modifier: { type: 'append', changedKeys: ['row-6'], follow: 'follow' },
    }))
    const firstToken = runtime.getSnapshot().commitToken
    runtime.applyLoadedSegment(segment(itemsFromRows(rows), 1, 3, {
      modifier: { type: 'append', changedKeys: ['row-7'], follow: 'follow' },
    }))
    const phaseCountBeforeAck = phases.length

    adapter.ackProjectionCommit(firstToken)

    expect(runtime.getSnapshot()).toMatchObject({
      segmentRevision: 3,
      viewportPhase: 'PROJECTING',
    })
    expect(phases.slice(phaseCountBeforeAck)).not.toContain('MOTION')

    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    expect(runtime.getSnapshot()).toMatchObject({
      segmentRevision: 3,
      viewportPhase: 'MOTION',
    })
    scheduler.flushFrames(40)
    expect(runtime.getSnapshot()).toMatchObject({
      segmentRevision: 3,
      viewportPhase: 'IDLE',
      bottomLockState: 'LOCKED',
    })
    expect(container.scrollTop).toBe(250)
  })

  it('does not project stale queued revisions after a newer same-generation segment', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ sessionId: 'feed-a', scheduler })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = createRows(6, 50)

    mountRows(runtime, adapter, container, rows.slice(1, 5))
    runtime.applyLoadedSegment(segment(itemsFromRows(rows.slice(1, 5)), 1, 1, {
      modifier: { type: 'reset-latest' },
    }))
    const initialToken = runtime.getSnapshot().commitToken

    container.prepend(rows[0])
    container.append(rows[5])
    adapter.registerRowElement('row-1', rows[0])
    adapter.registerRowElement('row-6', rows[5])
    runtime.applyLoadedSegment(segment(itemsFromRows(rows.slice(0, 5)), 1, 2, {
      modifier: { type: 'extend-before', requestToken: 'before:1' },
    }))
    runtime.applyLoadedSegment(segment(itemsFromRows(rows), 1, 3, {
      modifier: { type: 'append', changedKeys: ['row-6'], follow: 'follow' },
    }))

    adapter.ackProjectionCommit(initialToken)
    expect(runtime.getSnapshot()).toMatchObject({
      segmentRevision: 3,
      viewportPhase: 'PROJECTING',
    })

    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    expect(runtime.getSnapshot()).toMatchObject({
      segmentRevision: 3,
      viewportPhase: 'MOTION',
    })

    scheduler.flushFrames(40)

    expect(runtime.getSnapshot()).toMatchObject({
      segmentRevision: 3,
      viewportPhase: 'IDLE',
      bottomLockState: 'LOCKED',
    })
    expect(runtime.getSnapshot().items.map((item) => item.key)).toEqual([
      'row-1',
      'row-2',
      'row-3',
      'row-4',
      'row-5',
      'row-6',
    ])
  })

  it('carries destination motion until queued transactions drain', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ sessionId: 'feed-a', scheduler })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const initialRows = createRows(1, 50)
    const targetRows = createRows(5, 50)
    const events: MessageListRuntimeEvent[] = []
    const target = anchor('row-4')

    mountRows(runtime, adapter, container, initialRows)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment(itemsFromRows(initialRows), 1, 1))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    runtime.scrollToMessage(target, { align: 'start' })

    replaceRows(adapter, container, targetRows)
    runtime.applyLoadedSegment(segment(itemsFromRows(targetRows), 2, 1, {
      hasMoreBefore: true,
      hasMoreAfter: true,
      modifier: { type: 'reset-around', target },
      anchor: target,
    }))
    const resetToken = runtime.getSnapshot().commitToken
    runtime.applyLoadedSegment(segment(itemsFromRows(targetRows), 2, 2, {
      hasMoreBefore: true,
      hasMoreAfter: true,
      modifier: { type: 'patch', changedKeys: ['row-2'] },
      anchor: target,
    }))

    adapter.ackProjectionCommit(resetToken)
    expect(runtime.getSnapshot()).toMatchObject({
      segmentRevision: 2,
      viewportPhase: 'PROJECTING',
    })
    expect(events.some((event) => event.type === 'destinationSettled')).toBe(false)

    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    expect(runtime.getSnapshot().viewportPhase).toBe('MOTION')
    scheduler.flushFrames(40)

    expect(container.scrollTop).toBe(150)
    expect(events).toContainEqual(expect.objectContaining({
      type: 'destinationSettled',
      target,
      resolvedTarget: target,
    }))
  })

  it('carries destination motion through a queued transaction timeout', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({
      sessionId: 'feed-a',
      scheduler,
      commitTimeoutMs: 5,
    })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const initialRows = createRows(1, 50)
    const targetRows = createRows(5, 50)
    const events: MessageListRuntimeEvent[] = []
    const target = anchor('row-4')

    mountRows(runtime, adapter, container, initialRows)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment(itemsFromRows(initialRows), 1, 1))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    runtime.scrollToMessage(target, { align: 'start' })

    replaceRows(adapter, container, targetRows)
    runtime.applyLoadedSegment(segment(itemsFromRows(targetRows), 2, 1, {
      hasMoreBefore: true,
      hasMoreAfter: true,
      modifier: { type: 'reset-around', target },
      anchor: target,
    }))
    const resetToken = runtime.getSnapshot().commitToken
    runtime.applyLoadedSegment(segment(itemsFromRows(targetRows), 2, 2, {
      hasMoreBefore: true,
      hasMoreAfter: true,
      modifier: { type: 'patch', changedKeys: ['row-2'] },
      anchor: target,
    }))

    adapter.ackProjectionCommit(resetToken)
    scheduler.flushTimers()

    expect(runtime.getSnapshot().viewportPhase).toBe('MOTION')
    expect(events).toContainEqual(expect.objectContaining({
      type: 'viewportError',
      code: 'commit-timeout',
    }))

    scheduler.flushFrames(40)

    expect(container.scrollTop).toBe(150)
    expect(events).toContainEqual(expect.objectContaining({
      type: 'destinationSettled',
      target,
      resolvedTarget: target,
    }))
  })

  it('uses follow-bottom motion for send-style latest rebuilds', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ sessionId: 'feed-a', scheduler })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const previousRows = createRows(2, 50)
    const latestRows = createRows(7, 50)

    mountRows(runtime, adapter, container, previousRows)
    runtime.applyLoadedSegment(segment(itemsFromRows(previousRows), 1, 1, {
      hasMoreAfter: true,
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    runtime.scrollToLatest()
    expect(runtime.getSnapshot()).toMatchObject({
      pendingIntent: 'follow-bottom',
      bottomLockState: 'UNLOCKED',
    })

    replaceRows(adapter, container, latestRows)
    runtime.applyLoadedSegment(segment(itemsFromRows(latestRows), 2, 1, {
      hasMoreBefore: true,
      hasMoreAfter: false,
      modifier: { type: 'reset-latest' },
    }))
    container.scrollTop = 250
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'MOTION',
      pendingIntent: null,
      bottomLockState: 'LOCKED',
    })
    expect(container.scrollTop).toBeLessThan(250)

    scheduler.flushFrames(40)

    expect(container.scrollTop).toBe(250)
    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'IDLE',
      bottomLockState: 'LOCKED',
    })
  })

  it('uses requestless follow-bottom motion for local latest rebuilds', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ sessionId: 'feed-a', scheduler })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const previousRows = createRows(2, 50)
    const latestRows = createRows(7, 50)
    const events: string[] = []

    runtime.subscribeRuntimeEvent((event) => {
      events.push(event.type)
    })

    mountRows(runtime, adapter, container, previousRows)
    runtime.applyLoadedSegment(segment(itemsFromRows(previousRows), 1, 1, {
      hasMoreAfter: true,
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    getMessageListSessionRegistryRuntime(runtime).prepareFollowBottomForLocalReset()
    expect(runtime.getSnapshot()).toMatchObject({
      pendingIntent: 'follow-bottom',
      bottomLockState: 'UNLOCKED',
    })
    expect(events).not.toContain('needLatestMessages')

    replaceRows(adapter, container, latestRows)
    runtime.applyLoadedSegment(segment(itemsFromRows(latestRows), 2, 1, {
      hasMoreBefore: true,
      hasMoreAfter: false,
      modifier: { type: 'reset-latest' },
    }))
    container.scrollTop = 250
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'MOTION',
      pendingIntent: null,
      bottomLockState: 'LOCKED',
    })

    scheduler.flushFrames(40)

    expect(container.scrollTop).toBe(250)
    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'IDLE',
      bottomLockState: 'LOCKED',
    })
  })

  it('does not apply direction hints or far preposition for cross-feed jumps', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({
      sessionId: 'feed-a',
      scheduler,
      scrollMotion: { maxDistancePx: 80 },
    })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const initialRows = createRows(2, 50)
    const targetRows = createRows(24, 50)
    const target = anchor('row-22')

    mountRows(runtime, adapter, container, initialRows)
    runtime.applyLoadedSegment(segment(itemsFromRows(initialRows), 1, 1))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    runtime.scrollToMessage(target, {
      align: 'start',
      motion: { crossFeed: true },
    })

    replaceRows(adapter, container, targetRows)
    runtime.applyLoadedSegment(segment(itemsFromRows(targetRows), 2, 1, {
      hasMoreBefore: true,
      hasMoreAfter: true,
      modifier: { type: 'reset-around', target },
      anchor: target,
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(runtime.getSnapshot().viewportPhase).toBe('MOTION')
    expect(container.scrollTop).toBe(0)
    expect(runtime.getDiagnostics()).toContainEqual(expect.objectContaining({
      name: 'destinationMotion.start',
      details: expect.objectContaining({
        source: 'jump',
        directionHint: null,
      }),
    }))
    expect(runtime.getDiagnostics()).toContainEqual(expect.objectContaining({
      name: 'scrollMotion.decision',
      details: expect.objectContaining({
        decision: 'bounded-animate',
        prepositionTop: null,
      }),
    }))

    scheduler.flushFrames(40)

    expect(container.scrollTop).toBe(1_050)
    expect(runtime.getSnapshot().viewportPhase).toBe('IDLE')
  })

  it('re-reads the motion toggle at each motion start', () => {
    const scheduler = new FakeScheduler()
    let motionEnabled = true
    const resolveMotionEnabled = vi.fn(() => motionEnabled)
    const runtime = createMessageListRuntime<string>({
      sessionId: 'feed-a',
      scheduler,
      scrollMotion: {
        enabled: resolveMotionEnabled,
      },
    })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = createRows(6, 50)

    mountRows(runtime, adapter, container, rows)
    runtime.applyLoadedSegment(segment(itemsFromRows(rows), 1, 1, {
      modifier: { type: 'reset-latest' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    container.scrollTop = 200
    positionRows(rows, 200)

    runtime.scrollToMessage(anchor('row-1'), { align: 'start' })

    expect(resolveMotionEnabled).toHaveBeenCalledTimes(1)
    expect(runtime.getSnapshot().viewportPhase).toBe('MOTION')

    scheduler.flushFrames(40)

    expect(container.scrollTop).toBe(0)
    expect(runtime.getSnapshot().viewportPhase).toBe('IDLE')

    motionEnabled = false
    positionRows(rows, 0)
    runtime.scrollToLatest()

    expect(resolveMotionEnabled).toHaveBeenCalledTimes(2)
    expect(container.scrollTop).toBe(200)
    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'IDLE',
      bottomLockState: 'LOCKED',
    })
  })

  it('does not cancel an in-flight motion when the toggle flips off mid-animation', () => {
    const scheduler = new FakeScheduler()
    let motionEnabled = true
    const resolveMotionEnabled = vi.fn(() => motionEnabled)
    const runtime = createMessageListRuntime<string>({
      sessionId: 'feed-a',
      scheduler,
      scrollMotion: {
        enabled: resolveMotionEnabled,
      },
    })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = createRows(6, 50)

    mountRows(runtime, adapter, container, rows)
    runtime.applyLoadedSegment(segment(itemsFromRows(rows), 1, 1, {
      modifier: { type: 'reset-latest' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    container.scrollTop = 0
    positionRows(rows, 0)

    runtime.scrollToLatest()

    expect(resolveMotionEnabled).toHaveBeenCalledTimes(1)
    expect(runtime.getSnapshot().viewportPhase).toBe('MOTION')

    motionEnabled = false
    scheduler.flushFrame()

    expect(runtime.getSnapshot().viewportPhase).toBe('MOTION')

    scheduler.flushFrames(40)

    expect(container.scrollTop).toBe(200)
    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'IDLE',
      bottomLockState: 'LOCKED',
    })
    expect(runtime.getDiagnostics()).not.toContainEqual(expect.objectContaining({
      name: 'destinationMotion.cancel',
    }))
  })
})

function mountRows(
  runtime: MessageListRuntime<string>,
  adapter: MessageListAdapterRuntime<string>,
  container: HTMLElement,
  rows: HTMLDivElement[],
): void {
  container.append(...rows)
  runtime.attachScrollContainer(container)
  for (const row of rows) {
    adapter.registerRowElement(row.dataset.runtimeKey as string, row)
  }
}

function replaceRows(adapter: MessageListAdapterRuntime<string>, container: HTMLElement, rows: HTMLDivElement[]): void {
  container.replaceChildren(...rows)
  for (const row of rows) adapter.registerRowElement(row.dataset.runtimeKey as string, row)
}

function createRows(count: number, height: number): HTMLDivElement[] {
  return Array.from({ length: count }, (_, index) => {
    const key = `row-${index + 1}`
    const row = document.createElement('div')
    row.dataset.runtimeKey = key
    row.dataset.rowKind = 'message'
    row.dataset.messageStableId = key
    row.dataset.messageServerId = key
    setElementMetrics(row, { top: index * height, height })
    return row
  })
}

function positionRows(rows: HTMLDivElement[], scrollTop: number): void {
  rows.forEach((row, index) => {
    setElementMetrics(row, { top: index * 50 - scrollTop, height: 50 })
  })
}

function positionRowsWithHeights(
  rows: HTMLDivElement[],
  heights: number[],
  scrollTop: number,
): void {
  let top = -scrollTop
  rows.forEach((row, index) => {
    const height = heights[index] ?? 50
    setElementMetrics(row, { top, height })
    top += height
  })
}

function countRowRectReads(rows: HTMLDivElement[]): {
  reads: () => number
  reset: () => void
} {
  let reads = 0
  for (const row of rows) {
    const readRect = row.getBoundingClientRect.bind(row)
    row.getBoundingClientRect = () => {
      reads += 1
      return readRect()
    }
  }

  return {
    reads: () => reads,
    reset: () => { reads = 0 },
  }
}

function itemsFromRows(rows: HTMLDivElement[]): MessageDataItem<string>[] {
  return rows.map((row) => item(row.dataset.runtimeKey as string))
}

function item(key: string): MessageDataItem<string> {
  return {
    key,
    rowKind: 'message',
    renderVersion: 1,
    message: key,
    identity: {
      sessionId: 'feed-a',
      stableId: key,
      serverId: key,
      version: 1,
    },
  }
}

function anchor(key: string): MessageIdentityAnchor {
  return {
    sessionId: 'feed-a',
    stableId: key,
    serverId: key,
  }
}

function segment(
  items: MessageDataItem<string>[],
  generation: number,
  segmentRevision: number,
  overrides: Partial<LoadedSegment<string>> = {},
): LoadedSegment<string> {
  return {
    sessionId: 'feed-a',
    generation,
    segmentRevision,
    items,
    hasMoreBefore: false,
    hasMoreAfter: false,
    modifier: { type: 'bootstrap' },
    ...overrides,
  }
}
