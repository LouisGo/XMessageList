import type { MessageListSession } from '../../index'
import { getMessageListSessionInternals } from '../../x-message-list/core/manager/internal'
import type {
  MessageListRuntime,
  MessageListSnapshot,
} from '../../x-message-list/core/runtime/index'
import type { DemoMessage } from '../data/demoData'

export type DemoE2ERuntime = MessageListRuntime<DemoMessage>

export function getDemoSessionRuntime(
  session: MessageListSession<DemoMessage>,
): DemoE2ERuntime {
  return getMessageListSessionInternals(session).runtime
}

export function getDemoSessionSnapshot(
  session: MessageListSession<DemoMessage>,
): MessageListSnapshot<DemoMessage> {
  return getMessageListSessionInternals(session).getSnapshot()
}

export function getDemoSessionLoadedMessages(
  session: MessageListSession<DemoMessage>,
): DemoMessage[] {
  return getDemoSessionSnapshot(session).items
    .map((item) => item.message)
    .filter((message): message is DemoMessage => Boolean(message))
}
