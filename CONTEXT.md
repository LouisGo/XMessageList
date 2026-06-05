# XMessageList

XMessageList is the message list context for deterministic IM-style reading, paging, and live-message behavior.

## Language

**Message List Session**:
A renderable and restorable message list instance identified by a `sessionId`. It is the public unit for lifecycle, commands, reading position, and retained reading context.
_Avoid_: feed, conversation, manager instance

**Session ID**:
The sole XMessageList identity for a message list session. It can represent feed-backed lists and more specialized scoped lists without exposing the host's data-source identity.
_Avoid_: feedId as public identity, conversationId as list identity

**Host Feed Identifier**:
A host-owned data-source identifier used by integrations such as the demo when a session is backed by a feed. It is not part of XMessageList's own vocabulary.
_Avoid_: feedId in XMessageList contracts, feedId as registry key, feedId as component identity

**Message List Retention**:
A host-facing description of how much reading context a message list should preserve around the current reading position. It is not an exact row count or render-window size.
_Avoid_: maxItems, item budget, render count

**Session Retain Reason**:
A public reason for keeping a message list session alive while it is not mounted or while the host still considers it relevant.
_Avoid_: active-feed, feed retain reason

**Loaded Segment Store**:
The session-owned store for the currently loaded contiguous message segment. It is separate from the viewport runtime, which only consumes the published segment for projection and scroll correctness.
_Avoid_: Renderer Data Runtime, data runtime, runtime/data
