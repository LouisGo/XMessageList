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
When routing, permissions, or adapter behavior depend on host metadata, the source should be structured even if the Session ID itself is a single feed identifier.
_Avoid_: Feed, getFeed, feed as public source name, treating source identity as always equal to session identity

**Session Static Semantics**:
The source, adapter, request route, anchor memory, read receipts, and retention meaning fixed for a message list session after creation. Changing them requires destroying and recreating the session.
_Avoid_: resolver refresh, updateOptions as semantic swap, mutating a session into a different list

**Session State**:
The stable read-only public state of a Message List Session, including loaded rows, edge status, overlay status, destination status, and viewport status. It is not the viewport runtime snapshot or DOM evidence.
_Avoid_: runtime snapshot as business state, DOM evidence as app state, loaded segment store exposure

**Destination Command**:
A synchronous request to locate one message anchor inside one Message List Session. Acceptance returns a unique Destination ID; completion is observed through Session State. It may load an around window before a view mounts, but it never routes the host application to another session.
_Avoid_: completion Promise, cross-session router, reusing one ID for repeated targets

**Destination State**:
The public lifecycle of the most recently accepted Destination Command: pending, settled, cancelled, or failed. A fallback settlement is successful but remains distinguishable from an exact target settlement.
_Avoid_: URL position as completion state, hiding fallback as exact, request logs as destination state

**Destination ID**:
A session-local unique correlation ID generated for every accepted Destination Command, including repeated commands for the same target.
_Avoid_: message ID as command ID, target equality as command identity

### Host Boundary

**Host Feed Identifier**:
A host-owned data-source identifier used by integrations such as the demo when a session is backed by a feed. It is not part of XMessageList's own vocabulary.
When a host feed identifier is globally unique and one feed corresponds to one independent reading state, the host may map it directly to a Session ID.
_Avoid_: feedId in XMessageList contracts, feedId as registry key, feedId as component identity

**Host Message Event Store**:
The host-owned layer that receives SDK, main process, or bridge message callbacks and owns canonical message cache, dirty timestamps, unread state, and cross-list fanout. It translates active-session visual changes into Message List Session API calls.
It may be implemented as a composition of host message, conversation, and feed stores; the term names ownership, not a required class or package boundary.
_Avoid_: registry as event bus, SDK callbacks in React adapter, runtime-owned canonical cache

**Message List Request**:
A host-facing asynchronous page loading dependency used by a message list session to obtain rows around a reading position. It is not the loaded data store owned by XMessageList.
_Avoid_: data API, data source as adapter group name, public loaded data model

**Initial Window**:
The host's atomic result for entering a Message List Session. It is explicitly classified as either Latest Context or a restorable History Context with an anchor and pixel offset. When provided, it owns bootstrap classification and takes precedence over a separate Anchor Memory load.
_Avoid_: treating initial as a synonym for latest, inferring history from hasMoreAfter, issuing a second around request for the same feed entry

**Latest Window**:
A window explicitly requested from the newest message area. It must have no after-side data and must not carry historical restore metadata.
_Avoid_: accepting hasMoreAfter=true, silently discarding restore metadata, using latest to enter a persisted history position

**Request Trigger**:
The semantic source of a Message List Request, such as viewport need, user command, restore, or internal recovery. It is distinct from the request direction or target.
_Avoid_: free-form reason as trigger contract, inferring trigger from request kind alone, treating manual and viewport paging as equivalent

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

**Stable Row Key**:
A host-provided row identity that lets XMessageList preserve render, measurement, and anchor continuity across message updates such as local-to-server confirmation. It is not required to be the server message identifier.
_Avoid_: server id as mandatory row key, changing row key on every identity update, React key as message identity

**Session History Clear**:
A row-level session change that clears the current session's chat history while keeping the session usable for future sends and receives. It removes historical edges for that session and invalidates old persisted reading anchors; it is not session destruction.
_Avoid_: destroySession, account teardown, disabling future messages, load-more-history after clear, restoring old anchors after clear

**Local Tail**:
The optimistic tail path for send or retry work initiated by the current renderer. It carries send-style follow-bottom semantics.
_Avoid_: remote append, ordinary rows mutation, retry as in-place follow-bottom patch

**Remote Tail Append**:
The path for new tail messages arriving from a remote source such as the server, SDK, or main process. Its follow behavior is decided by host policy.
_Avoid_: rows patch, local send, forced follow-bottom for every incoming message

**Latest Context**:
A reading context whose loaded rows represent the newest message area of the source. It is distinct from bottom lock: the reader may scroll away from the bottom while the loaded rows still remain in latest context.
_Avoid_: latest as bottom lock, hasMoreAfter alone as latest context, treating every active session as latest context

**Loaded Context**:
The semantic context of the currently loaded rows, such as latest, history, or around-target reading. It tells the host whether tail append, scroll-to-latest, and downward paging should be interpreted as latest-message behavior or historical reading behavior.
_Avoid_: boolean latest flag, deriving context from scroll position alone, treating around-target and history as the same state

**Bottom Lock**:
A viewport state where the reader is attached to the bottom of the current latest message area so new latest messages can keep the viewport at the bottom. It is a scroll state, not the same thing as Latest Context.
_Avoid_: latest context as bottom lock, raw scrollTop equality as business state, host-owned unread policy as bottom lock

**Scroll-To-Latest Affordance**:
A host-rendered control that helps the reader return to the latest messages. XMessageList can provide scroll-side visibility signals for this control, but the host may combine them with host-owned signals such as unread count before deciding what to display.
_Avoid_: treating scroll distance as the complete display policy, runtime-owned unread badge, forcing the control to render only from scroll state

**Message Anchor ID**:
A message-level shortcut used by `MessageListAnchor.id` when the host can identify a message with one string. It is not a message list session identity.
_Avoid_: treating anchor id as sessionId, using anchor id as registry key

**Jump Target**:
A host-approved message anchor that can be used for destination navigation. A message that the host already knows is deleted is not a Jump Target.
_Avoid_: deleted message as jump target, request-first deleted target handling, system row as implicit jump target

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
