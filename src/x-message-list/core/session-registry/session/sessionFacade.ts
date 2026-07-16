import type { MessageListSession } from '../contracts'
import {
  normalizeLocalTailStageInput,
  normalizeRemoteTailAppendInput,
} from '../tail/tailSemantics'
import type { ReloadMutationGuard } from './reloadCurrent'

export function createSessionCommands<Row>(input: {
  isDestroyed: () => boolean
  prepare: MessageListSession<Row>['commands']['prepare']
  scrollToLatest: () => void
  scrollToMessage: MessageListSession<Row>['commands']['scrollToMessage']
  cancelDestination: MessageListSession<Row>['commands']['cancelDestination']
  reloadLatest: MessageListSession<Row>['commands']['reloadLatest']
  reloadCurrent: MessageListSession<Row>['commands']['reloadCurrent']
  loadBefore: () => void
  loadAfter: () => void
}): MessageListSession<Row>['commands'] {
  return {
    prepare: (options) => input.isDestroyed()
      ? Promise.resolve({ status: 'stale', reason: 'session-destroyed' })
      : input.prepare(options),
    scrollToLatest: () => { if (!input.isDestroyed()) input.scrollToLatest() },
    // scrollToMessage 自身需要在销毁后返回显式 rejected，不能被通用 guard 吞掉。
    scrollToMessage: (target, options) => input.scrollToMessage(target, options),
    // cancelDestination 需要区分 destroyed 与 not-current，保留其显式结果。
    cancelDestination: (cancelInput) => input.cancelDestination(cancelInput),
    reloadLatest: ((options?: Parameters<
      MessageListSession<Row>['commands']['reloadLatest']
    >[0]) => {
      if (options) return input.reloadLatest(options)
      if (!input.isDestroyed()) input.reloadLatest()
    }) as MessageListSession<Row>['commands']['reloadLatest'],
    reloadCurrent: (options) => input.reloadCurrent(options),
    loadBefore: () => { if (!input.isDestroyed()) input.loadBefore() },
    loadAfter: () => { if (!input.isDestroyed()) input.loadAfter() },
  }
}

export function createGuardedSessionMutations<Row>(input: {
  isDestroyed: () => boolean
  rows: MessageListSession<Row>['rows']
  tail: MessageListSession<Row>['tail']
  reloadController: ReloadMutationGuard<Row>
}): Pick<MessageListSession<Row>, 'rows' | 'tail'> {
  return {
    rows: {
      patch: (rows) => {
        if (input.isDestroyed()) return
        input.reloadController.applyRowsPatch(
          rows,
          () => input.rows.patch(rows),
        )
      },
      mutate: (mutation) => {
        if (input.isDestroyed()) return
        input.reloadController.applyRowsMutation(
          mutation,
          () => input.rows.mutate(mutation),
        )
      },
      replace: (replace) => {
        if (input.isDestroyed()) return
        input.reloadController.applyTopologyMutation(
          () => input.rows.replace(replace),
        )
      },
      resetLatest: (page) => {
        if (input.isDestroyed()) return
        input.reloadController.applyTopologyMutation(
          () => input.rows.resetLatest(page),
        )
      },
      resetAround: (around) => {
        if (input.isDestroyed()) return
        input.reloadController.applyTopologyMutation(
          () => input.rows.resetAround(around),
        )
      },
      applyIdentityRemap: (remaps) => {
        if (input.isDestroyed()) return
        input.reloadController.applyIdentityRemap(
          remaps,
          () => input.rows.applyIdentityRemap(remaps),
        )
      },
      invalidateAfter: (invalidateInput) => {
        if (input.isDestroyed()) {
          return { status: 'rejected', reason: 'session-destroyed' }
        }
        return input.rows.invalidateAfter(invalidateInput)
      },
      clear: () => {
        if (input.isDestroyed()) return
        input.reloadController.applyTopologyMutation(input.rows.clear)
      },
    },
    tail: {
      local: {
        stage: (stageInput) => {
          if (input.isDestroyed()) return
          const stage = normalizeLocalTailStageInput(stageInput)
          if (stage.latest && stage.rows.length > 0) {
            input.reloadController.applyTopologyMutation(
              () => input.tail.local.stage(stage),
            )
            return
          }
          input.reloadController.applyTailAppend(
            stage.rows,
            stage.retireKeys,
            () => input.tail.local.stage(stage),
          )
        },
        patch: (rows) => {
          if (input.isDestroyed()) return
          input.reloadController.applyVisibleRowsPatch(
            rows,
            () => input.tail.local.patch(rows),
          )
        },
        applyIdentityRemap: (remaps) => {
          if (input.isDestroyed()) return
          input.reloadController.applyIdentityRemap(
            remaps,
            () => input.tail.local.applyIdentityRemap(remaps),
          )
        },
      },
      remote: {
        append: (appendInput) => {
          if (input.isDestroyed()) return
          const append = normalizeRemoteTailAppendInput(appendInput)
          input.reloadController.applyTailAppend(
            append.rows,
            undefined,
            () => input.tail.remote.append(append),
          )
        },
      },
    },
  }
}
