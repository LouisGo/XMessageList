import { describe, expect, it } from 'vitest'
import { TransactionRunner } from '../transactions/transactionRunner'

describe('TransactionRunner', () => {
  it('reports no pending transaction to onComplete after the active task finishes', async () => {
    let pendingOnComplete = -1
    const runner = new TransactionRunner({
      onComplete: () => {
        pendingOnComplete = runner.getPendingCount()
      },
    })

    runner.enqueue('bootstrap', async () => undefined)
    await Promise.resolve()
    await Promise.resolve()

    expect(pendingOnComplete).toBe(0)
  })

  it('does not report idle between a completed task and a task enqueued by its completion callback', async () => {
    const events: string[] = []
    let enqueuedFollowUp = false
    const runner = new TransactionRunner({
      onStart: (kind) => {
        events.push(`start:${kind}`)
      },
      onComplete: () => {
        events.push('complete')

        if (!enqueuedFollowUp) {
          enqueuedFollowUp = true
          runner.enqueue('append', async () => undefined)
        }
      },
      onIdle: () => {
        events.push('idle')
      },
    })

    runner.enqueue('bootstrap', async () => undefined)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(events).toEqual([
      'start:bootstrap',
      'complete',
      'start:append',
      'complete',
      'idle',
    ])
  })
})
