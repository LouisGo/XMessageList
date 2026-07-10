import {
  readDemoFeedMessages,
  replaceDemoFeedMessages,
} from '../../demo/data/demoMessageApi'
import type { DemoMessageScenario } from '../../demo/scenario/demoScenarioTypes'
import type { E2EEvidence, E2EProbeValue } from '../bridge/e2eBridge'
import { E2EActionError, scrollContainerAsUser } from './e2eDomActions'

type ReadEvidence = (checkpointId: string) => E2EEvidence
type RecordProbe = (key: string, value: E2EProbeValue) => void
type WaitForIdle = (readEvidence: ReadEvidence, timeoutMs: number) => Promise<void>

/**
 * Reload E2E cases deliberately use only the public session API and the demo
 * response fixture. This keeps their assertions independent of runtime internals.
 */
export async function reloadCurrentUserInterrupt(input: {
  root: HTMLElement | null
  scenario: DemoMessageScenario
  readEvidence: ReadEvidence
  recordProbe: RecordProbe
  wait: (ms: number) => Promise<void>
  waitForRuntimeIdle: WaitForIdle
}): Promise<void> {
  const before = input.readEvidence('reload-interrupt-before')
  input.scenario.deferNextSessionResponse(360)
  const pending = input.scenario.activeSession.commands.reloadCurrent({
    reason: 'structural',
  })
  await input.wait(50)
  scrollContainerAsUser(input.root, 'middle')
  await input.wait(50)
  const afterScroll = input.readEvidence('reload-interrupt-after-scroll')
  const result = await pending
  // Let the deliberately delayed response return after cancellation before sampling.
  await input.wait(420)
  await input.waitForRuntimeIdle(input.readEvidence, 2_000)
  const afterResponse = input.readEvidence('reload-interrupt-after-response')
  input.recordProbe('reloadInterruptedStatus', result.status)
  input.recordProbe('reloadInterruptedReason', result.status === 'stale'
    ? result.staleReason
    : null)
  input.recordProbe(
    'reloadInterruptedSegmentUnchanged',
    before.generation === afterResponse.generation &&
      before.segmentRevision === afterResponse.segmentRevision,
  )
  input.recordProbe(
    'reloadInterruptedScrollTopUnchangedAfterResponse',
    Math.abs(afterScroll.scrollTop - afterResponse.scrollTop) <= 1,
  )
}

export async function reloadJournalOmittedPatch(input: {
  scenario: DemoMessageScenario
  readEvidence: ReadEvidence
  recordProbe: RecordProbe
  wait: (ms: number) => Promise<void>
  waitForRuntimeIdle: WaitForIdle
}): Promise<void> {
  const session = input.scenario.activeSession
  const rows = session.getState().loaded.rows
  const targetRow = rows[Math.floor(rows.length / 2)]
  if (!targetRow) {
    throw new E2EActionError('missing_journal_patch_row', 'reload journal needs a loaded row')
  }

  input.scenario.deferNextSessionResponse(360)
  const pending = session.commands.reloadCurrent({ reason: 'structural' })
  await input.wait(50)
  session.rows.patch([{
    ...targetRow,
    body: `E2E local patch ${Date.now()}`,
  }])
  replaceDemoFeedMessages(
    input.scenario.activeFeedId,
    readDemoFeedMessages(input.scenario.activeFeedId).filter((row) =>
      row.id !== targetRow.id,
    ),
  )
  const result = await pending
  await input.waitForRuntimeIdle(input.readEvidence, 2_000)
  const state = session.getState()
  input.recordProbe('reloadJournalResult', result.status)
  input.recordProbe('reloadJournalPatchedKey', targetRow.id)
  input.recordProbe(
    'reloadJournalPatchedKeyPresent',
    state.loaded.keys.includes(targetRow.id),
  )
}
