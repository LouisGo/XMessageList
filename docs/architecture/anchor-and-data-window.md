# Anchor 与 Loaded Segment

## Identity 与 Row Key

IM 里不能把“消息 id”简化成一个字符串。发送中、本地回显、服务端确认、撤回、权限 fallback、系统行和日期分组都会改变可渲染行与业务消息之间的关系。

```ts
type MessageIdentity = {
  sessionId: string;
  stableId: string;
  serverId?: string;
  localId?: string;
  version: number;
};

type MessageIdentityAnchor = {
  sessionId: string;
  stableId: string;
  serverId?: string;
  localId?: string;
  fallbackStableId?: string;
  fallbackReason?: 'deleted' | 'unavailable' | 'permission';
};

type MessageRuntimeItemKey = string;

type MessageDataItem = {
  key: MessageRuntimeItemKey;
  rowKind:
    | 'message'
    | 'date-separator'
    | 'system'
    | 'deleted-placeholder'
    | 'permission-fallback';
  identity?: MessageIdentity;
  renderVersion: number;
};
```

约束：

- `MessageIdentity.stableId` 是跨 local/server remap 的逻辑身份；同一条本地发送消息被服务端确认后，优先保持同一个 stableId。
- `MessageRuntimeItemKey` 是 React key 与 DOM ref key；它不能用 array index，也不能直接等同于 server id。
- 普通消息 row 必须有 `identity`；日期、系统、权限 fallback 等非消息 row 可以只有 runtime key。
- edited / streaming / markdown lazy patch 更新 `renderVersion`，不更换 runtime key。
- deleted message 若仍需要占位，loaded segment store 产出 `deleted-placeholder`；若 anchor 消息不可见，必须同时给出 fallback。
- duplicate server message、local->server remap、system row 插入都由 loaded segment store 归并成新的 immutable segment；viewport runtime 不做业务去重。

## 三类 anchor

### Identity Anchor

跨层稳定身份：

```ts
type PersistedMessageAnchor = MessageIdentityAnchor;
```

它用于 restore、jump、around query、feed persistence。它不携带 DOM offset，也不承诺当前 segment 已包含目标消息。

### Visual Anchor

Viewport runtime 内部 anchor：

```ts
type VisualAnchor = {
  key: MessageRuntimeItemKey;
  identity?: MessageIdentity;
  offsetWithinMessage: number;
  rectTopBeforeCommit: number;
};
```

它只在当前 DOM 生命周期内有效。Segment extend / reset / trim 前捕获，commit 后用同一 row 的新 rect top 修正 `scrollTop`。

### Bottom Anchor

不是某条消息，而是 `hasMoreAfter=false` 且 bottom marker / latest row 位于底部阈值内的状态。Bottom follow 不能把 partial segment 的 after edge 当作 feed latest。

## Loaded Segment

Loaded segment 是当前 feed 已加载、按消息顺序连续的一段数据：

```ts
type SegmentModifier =
  | { type: 'bootstrap' }
  | { type: 'extend-before'; requestToken: string }
  | { type: 'extend-after'; requestToken: string }
  | { type: 'reset-around'; target: MessageIdentityAnchor }
  | { type: 'reset-latest' }
  | { type: 'trim-before'; trimToken: string }
  | { type: 'trim-after'; trimToken: string }
  | { type: 'patch'; changedKeys: MessageRuntimeItemKey[] }
  | {
      type: 'append';
      changedKeys: MessageRuntimeItemKey[];
      follow: 'follow' | 'preserve';
      retireKeys?: MessageRuntimeItemKey[];
    }
  | {
      type: 'identity-remap';
      remaps: Array<{
        from: MessageIdentityAnchor;
        to: MessageIdentityAnchor;
        previousKey?: MessageRuntimeItemKey;
        nextKey: MessageRuntimeItemKey;
      }>;
    };

type LoadedSegment = {
  sessionId: string;
  generation: number;
  segmentRevision: number;
  items: MessageDataItem[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  anchor?: MessageIdentityAnchor;
  anchorStatus?: 'normal' | 'deleted' | 'unavailable' | 'permission';
  modifier: SegmentModifier;
};
```

`items` 就是 React 要投影的真实 rows。当前基础假设是：一个 loaded segment
足够短，可以全部挂载；超过预算时先通过 loaded segment store 产生 trim modifier，
再由 viewport runtime 在 transaction 中修正视觉位置。

## Segment 操作

### Extend Before

用途：用户滚到 before trigger 附近，请求更旧消息。

要求：

- 新 segment 必须保留旧 segment 中的 visual anchor row。
- 新消息插到旧 segment 前方这件事由 loaded segment store 完成；viewport runtime 只消费 next immutable segment。
- commit 后按 visual anchor 修正 `scrollTop`。
- correction source 标记为 recovery，不能触发第二次 edge need。

### Extend After

用途：用户滚到 after trigger 附近，请求更新但不是 latest follow。

要求：

- 新消息插到旧 segment 后方这件事由 loaded segment store 完成；viewport runtime 只消费 next immutable segment。
- 未锁底时保持当前 visual anchor。
- 如果用户正在自然下滑，新增 DOM 让 scroll range 真实变大，浏览器可以继续消费惯性。
- 如果后续确认 `hasMoreAfter=false` 且用户处在 bottom follow intent，才进入 latest bottom lock。

### Reset Around

用途：jump / restore / viewport budget rebuild。

要求：

- loaded segment store 返回围绕目标的短 segment。
- runtime 对齐目标 visual position。
- reset 期间禁用 edge need，直到 commit + correction settle。

### Reset Latest

用途：显式 follow bottom 或首次 latest bootstrap。

要求：

- 必须返回包含 feed latest 的 segment。
- `hasMoreAfter=false` 后才能锁底。
- 若旧 segment 与 latest 中间缺口很大，不做逐页补齐动画。

### Identity Remap

用途：本地 optimistic 消息获得 server id、服务端去重、权限 fallback 或业务身份迁移。

要求：

- loaded segment store 必须在 `identity-remap` modifier 中提供 old identity 到 new identity 的映射。
- 同一逻辑消息优先保持 `MessageRuntimeItemKey` 不变；确实必须换 key 时，modifier 必须提供 `previousKey -> nextKey`。
- viewport runtime 在 commit 前用旧 key 捕获 visual anchor，commit 后先通过 remap 表解析新 key，再测量修正。
- persisted anchor 必须更新为 remap 后的 identity；不能继续持久化 local-only id。
- React adapter 不能自己把 local id 和 server id 拼接成 key。

### Segment Trim

用途：控制 DOM 和内存预算。

要求：

- loaded segment store 只能发布裁掉远离当前 visual anchor 一侧的 next segment。
- viewport runtime 在 trim 前捕获 visual anchor，trim 后修正 `scrollTop`。
- trim 后 `scrollHeight` 减少是允许的，但 anchor 屏幕位置不能跳。
- trim 不能发生在 active wheel / touch correction 同一帧内；需要进入 transaction 队列。

## Missing Anchor

如果 identity anchor 对应消息已删除、不可见或因权限不可访问：

- loaded segment store 必须返回 `anchorStatus: 'deleted' | 'unavailable' | 'permission'` 和 deterministic fallback segment。
- viewport runtime 只消费 fallback，不继续要求原 message row 存在。
- 视觉恢复目标是 fallback row，而不是 deleted id。

## Persistence

Host 持久化时优先保存 committed identity anchor：

- `viewportAnchorChanged(reason: 'scroll-idle')` 用于普通滚动保存。
- `viewportAnchorChanged(reason: 'transaction-settle')` 用于分页、trim、jump 后保存。
- `viewportAnchorChanged(reason: 'detach')` 用于 feed 切换和 unmount checkpoint。

不持久化 raw `scrollTop` 作为跨 session 恢复依据。`scrollTop` 只对当前 loaded segment 有意义。
