# XMessageList

XMessageList is the message list context for deterministic IM-style reading, paging, and live-message behavior.

## Language

### Public Session Surface

**Message List Session**:
A renderable and restorable message list instance identified by a `sessionId`. It is the public unit for lifecycle, commands, reading position, and retained reading context.
_Avoid_: feed, conversation, manager instance

**Message List Component**:
The React projection of an existing Message List Session. It renders session state and forwards user-facing viewport intents; it is not a raw row-array owner.
_Avoid_: data prop component, raw array virtual list, component-owned session lifecycle

**Session ID**:
The sole XMessageList identity for a message list session. It can represent feed-backed lists and more specialized scoped lists without exposing the host's data-source identity.
_Avoid_: id as session identity alias, feedId as public identity, conversationId as list identity

**Session Source**:
A host-provided object or value used to choose request, row, memory, and receipt behavior for a message list session. A simple integration may use the Session ID as a fallback source, but source identity is still distinct from session identity.
_Avoid_: Feed, getFeed, feed as public source name, treating source identity as always equal to session identity

**Session Static Semantics**:
The source, adapter, request route, anchor memory, read receipts, and retention meaning fixed for a message list session after creation. Changing them requires destroying and recreating the session.
_Avoid_: resolver refresh, updateOptions as semantic swap, mutating a session into a different list

**Session State**:
The stable read-only public state of a Message List Session, including loaded rows, edge status, overlay status, and viewport status. It is not the viewport runtime snapshot or DOM evidence.
_Avoid_: runtime snapshot as business state, DOM evidence as app state, loaded segment store exposure

### Host Boundary

**Host Feed Identifier**:
A host-owned data-source identifier used by integrations such as the demo when a session is backed by a feed. It is not part of XMessageList's own vocabulary.
_Avoid_: feedId in XMessageList contracts, feedId as registry key, feedId as component identity

**Host Message Event Store**:
The host-owned layer that receives SDK, main process, or bridge message callbacks and owns canonical message cache, dirty timestamps, unread state, and cross-list fanout. It translates active-session visual changes into Message List Session API calls.
_Avoid_: registry as event bus, SDK callbacks in React adapter, runtime-owned canonical cache

**Message List Request**:
A host-facing asynchronous page loading dependency used by a message list session to obtain rows around a reading position. It is not the loaded data store owned by XMessageList.
_Avoid_: data API, data source as adapter group name, public loaded data model

**Anchor Memory**:
A host-provided persistence capability for restoring and saving a message list session's reading anchor. The session decides when to load or save it; React does not persist anchors.
_Avoid_: generic memory cache, React-owned anchor persistence, raw scrollTop persistence

**Read Receipts**:
A host-provided capability for marking visible rows as read based on mounted viewport observation. Cached sessions without a mounted view do not produce read receipt work.
_Avoid_: SDK push-driven read receipts, cached-session mark read, React-owned read worker

### Row And Tail Semantics

**Edge Paging**:
A mounted viewport reading need that requests adjacent rows before or after the current loaded segment. It is not background synchronization for cached sessions.
_Avoid_: background pull, cached-session auto paging, global message sync

**Rows Mutation**:
A session entry for ordinary changes to rows that may already exist in the loaded segment, such as edits, deletes, reactions, read markers, media updates, or streaming patches. It does not mean a new tail message arrived.
_Avoid_: generic tail update, append as ordinary patch, using tail for edit/delete

**Session History Clear**:
A row-level session change that clears the current session's chat history while keeping the session usable for future sends and receives. It removes historical edges for that session and invalidates old persisted reading anchors; it is not session destruction.
_Avoid_: destroySession, account teardown, disabling future messages, load-more-history after clear, restoring old anchors after clear

**Local Tail**:
The optimistic tail path for send or retry work initiated by the current renderer. It carries send-style follow-bottom semantics.
_Avoid_: remote append, ordinary rows mutation, retry as in-place follow-bottom patch

**Remote Tail Append**:
The path for new tail messages arriving from a remote source such as the server, SDK, or main process. Its follow behavior is decided by host policy.
_Avoid_: rows patch, local send, forced follow-bottom for every incoming message

**Scroll-To-Latest Affordance**:
A host-rendered control that helps the reader return to the latest message context. XMessageList can provide scroll-side visibility signals for this control, but the host may combine them with host-owned signals such as unread count before deciding what to display.
_Avoid_: treating scroll distance as the complete display policy, runtime-owned unread badge, forcing the control to render only from scroll state

**Message Anchor ID**:
A message-level shortcut used by `MessageListAnchor.id` when the host can identify a message with one string. It is not a message list session identity.
_Avoid_: treating anchor id as sessionId, using anchor id as registry key

**Message List Retention**:
A host-facing tier that describes how much reading context a message list should preserve around the current reading position. It is not an exact row count or render-window size.
_Avoid_: maxItems, item budget, render count

**Session Retain Reason**:
A host-facing public reason for keeping a message list session alive while it is not mounted but still relevant to an app workflow. It is separate from React mounted retention.
_Avoid_: active-feed, conversation-active, feed retain reason

### Internal Layers

**Loaded Segment Store**:
The session-owned store for the currently loaded contiguous message segment. It is separate from the viewport runtime, which only consumes the published segment for projection and scroll correctness.
_Avoid_: Renderer Data Runtime, data runtime, runtime/data

**Viewport Runtime**:
The internal owner of scroll container attachment, DOM evidence, visual anchors, viewport transactions, and scroll correction. It consumes loaded segment projections but does not own message data.
_Avoid_: SDK event handler, business cache owner, React renderer

**React Adapter**:
The React projection layer for a Message List Session. It renders the DOM skeleton, registers row refs, projects slots, and sends commit acknowledgements without owning data merge or scroll truth.
_Avoid_: SDK callback handler, component-owned data store, component-owned scroll correction
