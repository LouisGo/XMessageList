# 术语与 Public API 命名

本文档是 next 重写的命名基准。后续代码、文档、测试和 demo 接入都必须使用这里的统一口径；旧实现里的名字只能出现在迁移说明、对照表或删除清单中，不能作为新实现的正向 API。

## 命名层级

| 层级 | 允许术语 | 使用范围 | 禁止误用 |
| --- | --- | --- | --- |
| 产品 / 包 | `MessageList` | package export、React component、public runtime facade、README 示例 | 不把公开组件命名为 `MessageViewport` |
| 数据语义 | `LoadedSegment`、`SegmentModifier`、`MessageIdentity`、`MessageRuntimeItemKey` | data runtime、host adapter、BFF response 转换 | 不再使用 `DataWindow` + `RenderWindow` 作为正向模型 |
| 视口运行时 | `ViewportRuntime`、`VisualAnchor`、`BottomAnchor`、`ScrollSource`、`EdgeState` | runtime 内部、diagnostics、事件中描述真实可视区域 | 不把 viewport 当成公开产品名 |
| 投影事务 | `ProjectionSnapshot`、`ProjectionCommitToken`、`ProjectionTransaction` | runtime 到 React adapter 的内部合同 | 不把 projection 暴露成业务接入概念 |
| React 适配 | `MessageList`、`MessageRow`、`MessageFlow`、`MessageScrollContainer` | React DOM skeleton、slots、hooks | 不出现 spacer / virtual range 组件名 |

判定规则：用户会 import、配置或在业务代码中直接看到的名字，优先用 `MessageList`；只有描述滚动容器、可视锚点、测量和事务时才使用 `Viewport`；只有描述 React commit 前后的 DOM 投影时才使用 `Projection`。

## Public Export

package 根出口只暴露 message-list 语义：

```ts
export {
  MessageList,
  createMessageListRuntime,
  useMessageListSnapshot,
  useMessageListSelector,
};
export type {
  MessageListProps,
  MessageListRuntime,
  MessageListRuntimeOptions,
  MessageListScrollOptions,
  MessageListScrollToMessageOptions,
  MessageListRestoreOptions,
  MessageListSnapshot,
  MessageListRuntimeEvent,
  MessageListRuntimeEventListener,
  MessageListCommands,
  DestinationSettledEvent,
  SegmentTrimPressureEvent,
  RuntimeObserverFactory,
  RuntimeScheduler,
  EdgeSlotInput,
  ScrollToLatestSlotInput,
  MessageListOverlayInput,
  ViewportAnchorChangedEvent,
  ViewportObservationChangedEvent,
  ViewportObservationListener,
  ViewportObservationReason,
  ViewportVisibleRange,
  ViewportObservedItem,
  ViewportScrollDirection,
  ViewportObservationActivity,
  ViewportDiagnosticEvent,
  ViewportDiagnosticRecord,
  ViewportEvidence,
  LoadedSegment,
  SegmentModifier,
  MessageDataItem,
  MessageIdentity,
  MessageIdentityAnchor,
  MessageRuntimeItemKey,
};
```

data runtime 通过子路径单独暴露，根出口保持干净：

```ts
import {
  createMessageListDataRuntime,
  type MessageListDataRuntime,
} from 'x-message-list/data';
```

不导出 implementation class、DOM registry、transaction controller、measurement engine、projection store 或 data merge internals。实现内部可以有 class，但公开创建入口统一是 `createMessageListRuntime(options)`。

## React 组件与 Hooks

Canonical names：

| 名称 | 类别 | 说明 |
| --- | --- | --- |
| `MessageList` | React component | 唯一公开组件名 |
| `MessageListProps` | React props | 组件 props 类型 |
| `MessageListCommands` | slot command object | 只暴露命名命令，不暴露 generic dispatch |
| `useMessageListSnapshot` | hook | 读取稳定 snapshot |
| `useMessageListSelector` | hook | 读取 snapshot 派生值 |
| `MessageScrollContainer` | internal component | 唯一 scroll container |
| `MessageFlow` | internal component | 正常文档流 rows / triggers / bottom marker |
| `MessageRow` | internal component | row wrapper 和 ref 注册 |
| `BeforeEdgeTrigger` / `AfterEdgeTrigger` | internal component | before / after 分页触发器 |
| `BottomMarker` | internal component | latest / bottom anchor 测量 marker |
| `MessageListScrollbarOverlay` | internal component | optional custom scrollbar mirror |

`MessageListProps` 的 public surface 使用下列名字：

```ts
type MessageListProps<TMessage = unknown, TOptimistic = unknown> = {
  runtime: MessageListRuntime<TMessage, TOptimistic>;
  renderRow: (item: MessageDataItem<TMessage, TOptimistic>) => ReactNode;
  getRowRenderVersion?: (
    item: MessageDataItem<TMessage, TOptimistic>,
  ) => unknown;
  className?: string;
  style?: CSSProperties;
  renderBeforeEdge?: (input: EdgeSlotInput) => ReactNode;
  renderAfterEdge?: (input: EdgeSlotInput) => ReactNode;
  renderScrollToLatest?: (input: ScrollToLatestSlotInput) => ReactNode;
  renderOverlay?: (input: MessageListOverlayInput) => ReactNode;
  onViewportAnchorChange?: (event: ViewportAnchorChangedEvent) => void;
  onViewportObservationChange?: (event: ViewportObservationChangedEvent) => void;
  scrollbar?: 'native' | 'custom';
};
```

`renderOverlay(input)` 接收 `{ snapshot, observation, commands }`。`commands` 只允许 `scrollToLatest()` 和 `scrollToMessage(target, options?)`，不暴露 generic dispatch 或 adapter-private direct scroll。

命名取舍：

- 使用 `renderRow`，不沿用 `renderMessage`，因为 row 可以是 message、date separator、system、deleted placeholder 或 permission fallback。
- 使用 `renderScrollToLatest`，不把 public slot 命名为 `renderFollowBottom`；`bottom follow` 是内部状态机语义，用户看到的是“回到最新消息”。
- callback 使用 `onViewportAnchorChange` 和 `onViewportObservationChange`，因为事件内容描述的是可视区域，不是 data segment。

## Runtime Facade API

`MessageListRuntime` 是唯一 public runtime facade。方法名必须表达“谁在调用、作用于什么、是否会产生 DOM/scroll 副作用”。

```ts
type MessageListRuntime<TMessage = unknown, TOptimistic = unknown> = {
  attachScrollContainer(container: HTMLElement): void;
  detachScrollContainer(): void;
  destroy(): void;

  applyLoadedSegment(segment: LoadedSegment<TMessage, TOptimistic>): void;

  scrollToLatest(options?: MessageListScrollOptions): void;
  scrollToMessage(
    target: MessageIdentityAnchor,
    options?: MessageListScrollToMessageOptions,
  ): void;
  restoreToMessage(
    target: MessageIdentityAnchor,
    options?: MessageListRestoreOptions,
  ): void;
  reportEdgeRequestFailure(
    edge: 'before' | 'after',
    requestToken: string,
  ): void;

  getSnapshot(): MessageListSnapshot<TMessage, TOptimistic>;
  subscribeSnapshot(listener: MessageListSnapshotListener): () => void;
  subscribeRuntimeEvent(listener: MessageListRuntimeEventListener): () => void;
  subscribeViewportObservation(
    listener: ViewportObservationListener,
  ): () => void;

  getViewportAnchor(): MessageIdentityAnchor | null;
  getDiagnostics(): ViewportDiagnosticRecord[];
  getEvidence(): ViewportEvidence;
};
```

方法语义：

| 方法 | 精确定义 | 不允许 |
| --- | --- | --- |
| `attachScrollContainer` | 绑定唯一 native scroll container，并接管 scroll source 分类 | 模糊命名为 `attach` |
| `detachScrollContainer` | 解绑 DOM 前发出 detach anchor checkpoint；runtime 实例仍可复用 | 等同于 `destroy` |
| `applyLoadedSegment` | 消费 data runtime 已经合并好的 immutable segment，并启动 projection transaction | 在 viewport runtime 内合并、去重、排序 items |
| `scrollToLatest` | 用户意图：到 feed latest；若 `hasMoreAfter=true`，发 `needLatestMessages` | 直接把 current segment 的 after edge 当 latest |
| `scrollToMessage` | 用户意图：跳到目标消息；目标缺失时发 `needMessagesAround(reason: 'jump')` | 映射为全局百分比滚动 |
| `restoreToMessage` | 会话恢复意图：按 persisted identity anchor 恢复，不使用旧 `scrollTop` | 做 smooth jump 或复用历史 raw scrollTop |
| `reportEdgeRequestFailure` | host 对 runtime 的 edge request 失败 ack，仅能用匹配的 `requestToken` 释放到 error 状态 | host 自行清 latch 或 reset latest |
| `subscribeSnapshot` | 给 React external store 使用，只通知 snapshot 变化 | 用普通 event listener 代替 snapshot store |
| `subscribeRuntimeEvent` | 订阅 semantic need、anchor、diagnostics、ready/error | 让 host 监听 raw scroll |
| `getViewportAnchor` | 返回最新可持久化 `MessageIdentityAnchor`；DOM offset / visual anchor 不外露 | 返回 raw `scrollTop`、row rect 或 internal key |
| `getEvidence` | 给 E2E / debug 读取稳定证据结构 | 暴露 private registry 或 transaction object |

命令命名规则：

- `scrollTo*` 表示用户可见导航命令，可以触发数据请求和 motion。
- `restoreTo*` 表示会话恢复命令，不表达用户主动滚动，也不复用旧坐标。
- `apply*` 表示接受上游已完成的数据结果；它不是请求 API，也不是 merge API。
- `get*` 只读当前 runtime 状态或 host/BFF 数据，不应产生 scroll 副作用。
- 不公开 `dispatch({ type })`；内部 command router 可以存在，但不能成为 public API。

## Adapter-Private Runtime API

React adapter 和 optional scrollbar overlay 可以使用下列 adapter-private 方法。它们不从 package 根出口作为用户 API 宣传：

```ts
type MessageListAdapterRuntime = {
  registerMessageFlowElement(element: HTMLElement | null): void;
  registerBeforeTriggerElement(element: HTMLElement | null): void;
  registerAfterTriggerElement(element: HTMLElement | null): void;
  registerBottomMarkerElement(element: HTMLElement | null): void;
  registerRowElement(
    key: MessageRuntimeItemKey,
    element: HTMLElement | null,
  ): void;
  ackProjectionCommit(token: ProjectionCommitToken): void;
  retryEdgeRequest(edge: 'before' | 'after'): void;
  reportOverlayMetricMismatch(details: Record<string, unknown>): void;

  beginDirectScroll(): void;
  writeDirectScrollTop(scrollTop: number): boolean;
  endDirectScroll(): void;
};
```

`writeDirectScrollTop` 只能由 scrollbar overlay 的 drag / track click 调用；它仍然通过 runtime scroll writer 写入，不能被 app 或 slot 当成普通滚动工具使用。

## Snapshot 与核心类型

Canonical types：

| 名称 | 说明 |
| --- | --- |
| `MessageIdentity` | 跨 local/server/fallback 的业务身份 |
| `MessageIdentityAnchor` | 可进入 BFF / persistence 的身份锚点，不含 DOM offset |
| `MessageRuntimeItemKey` | React key 与 DOM ref key，不等于 array index |
| `MessageDataItem` | 当前 segment 的可渲染 row 数据 |
| `LoadedSegment` | data runtime 发布的连续短 segment |
| `SegmentModifier` | segment 变化原因和 transaction hint |
| `MessageListSnapshot` | React adapter 和 public slots 读取的稳定 snapshot |
| `ProjectionSnapshot` | runtime 内部投影事务快照；不是 public type |
| `ProjectionCommitToken` | React commit ack token |
| `VisualAnchor` | runtime 内部 DOM anchor |
| `BottomAnchor` | latest bottom lock 的测量语义 |
| `EdgeSnapshotState` | before / after trigger 状态 |

`MessageListSnapshot` 必须包含 `feedId`、`generation`、`segmentRevision`、`projectionRevision`、`commitToken`、`items`、`segmentMeta`、`edgeState`、`bottomLockState`、`pendingIntent`、`viewportPhase`。它不得包含 `renderWindow`、`topSpacer`、`bottomSpacer`、`estimatedTotalHeight`、`globalOffset` 或 raw `scrollTop`。

## Runtime Events

Runtime event type 使用 `MessageListRuntimeEvent`，事件名保持语义动作：

```ts
type MessageListRuntimeEvent =
  | NeedMoreBeforeEvent
  | NeedMoreAfterEvent
  | NeedLatestMessagesEvent
  | NeedMessagesAroundEvent
  | DestinationSettledEvent
  | SegmentTrimPressureEvent
  | ViewportAnchorChangedEvent
  | ViewportObservationChangedEvent
  | ViewportDiagnosticEvent
  | ViewportReadyEvent
  | ViewportErrorEvent;
```

事件命名：

| Event `type` | Owner | 用途 |
| --- | --- | --- |
| `needMoreBefore` | viewport runtime -> host | before edge / underflow 需要更旧消息 |
| `needMoreAfter` | viewport runtime -> host | after edge / underflow 需要更新消息 |
| `needLatestMessages` | viewport runtime -> host | `scrollToLatest` 需要 latest window |
| `needMessagesAround` | viewport runtime -> host | jump / restore 需要 around window |
| `destinationSettled` | viewport runtime -> host / overlay | jump / restore 目标或 fallback 已完成 settle |
| `segmentTrimPressure` | viewport runtime -> host / data runtime | 当前 segment 可触发 host 按 budget trim，事件携带保护 anchor 和建议方向 |
| `viewportAnchorChanged` | viewport runtime -> host | 持久化当前阅读 anchor |
| `viewportObservationChanged` | viewport runtime -> host / overlay | 可见范围、阅读回执、浮层状态 |
| `viewportDiagnostic` | viewport runtime -> diagnostics | transaction、measurement、correction 诊断 |
| `viewportReady` | viewport runtime -> host | 当前 feed 首次 ready |
| `viewportError` | viewport runtime -> host | commit timeout、anchor missing 等错误 |

所有 need events 必须带 `feedId`、`generation`、`segmentRevision`、`requestToken` 和 `reason`。host 只能响应这些 semantic events，不能监听 raw scroll 来补分页。

`viewportObservationChanged` 必须携带 `feedId`、`generation`、`segmentRevision`、`reason`、`scrollSource`、`direction`、`activity`、`anchor`、`visibleRange`、`visibleItems[{ key, visibleRatio }]` 和兼容用的 `visibleKeys`。读回执、sticky time、pinned preview、analytics 都应基于该 observation 和 overlay commands 组合，不进入 core 业务状态。

`destinationSettled` 只在真实目标或 fallback 完成 settle 后发出；被新 generation / timeout / cancellation 打断的 destination motion 不发 settled。`resolution` 为 `target` 或 `fallback`，fallback 场景可携带 `resolvedTarget`。

`segmentTrimPressure` 不包含 budget；budget 属于 `MessageListDataRuntimeOptions.itemBudget`。host 收到 pressure 后决定是否调用 data runtime 的 `trimToBudget(protectKey)` 并把返回的 `trim-before` / `trim-after` segment 交回 viewport runtime。

`MessageListRuntimeOptions` 可以调整 `edgeActivationMarginPx` 和 `underflowTolerancePx`；默认值仍按 interaction specs 使用。data budget 不放入 viewport runtime options。

## Data Runtime 子路径 API

`x-message-list/data` 暴露 data runtime 接入合同：

```ts
export {
  createMessageListDataRuntime,
  MessageListDataRuntime,
};
export type {
  MessageListDataRuntimeOptions,
  DataRuntimeRequestKind,
  DataRuntimeRequestToken,
  DataRuntimeApplyResult,
  ResetSegmentInput,
  ExtendSegmentInput,
  ReplaceSegmentInput,
  IdentityRemapInput,
};
```

合同规则：

- `resetLatest` / `resetAround` 开新 generation，并清理旧 request token。
- `createRequestToken(kind)` 和 `adoptRequestToken(request)` 是 stale response guard；`extendBefore` / `extendAfter` 只接受当前 generation 的 token。
- `patchItems` / `replaceItems` / `applyIdentityRemap` 只产出语义 segment，不触碰 DOM 或 scroll。
- `trimToBudget(protectKey)` 只根据 data runtime 的 `itemBudget` 产出 `trim-before` 或 `trim-after`；viewport runtime 负责 trim 后 anchor correction。

## Host / BFF Request API

demo、E2E 和真实接入层保留下列请求形态：

```ts
getLatestMessages(req: GetLatestMessagesReq): Promise<GetLatestMessagesResp>;
getMessagesAround(req: GetMessagesAroundReq): Promise<GetMessagesAroundResp>;
```

命名边界：

- `getLatestMessages` 表达“取 feed latest window”，不等同于 `scrollToLatest`。
- `getMessagesAround` 表达“围绕 identity anchor 取窗口”，可服务 jump、restore、before / after 补齐策略。
- before / after / latest / around 是请求语义；merge、trim、identity-remap 必须由 data runtime 转成 `LoadedSegment` 后再交给 viewport runtime。

## Main 分支 API 对照

main 分支的 `MessageViewport` API 能力较全，但命名混合了 public product、viewport internals 和 adapter-private 方法。next 重写按下表迁移：

| main 名称 | next canonical 名称 | 决策 |
| --- | --- | --- |
| `MessageViewport` | `MessageList` | 改名；公开组件不使用 viewport |
| `MessageViewportRuntime` | `MessageListRuntime` | 改名；viewport 作为内部 runtime 术语保留 |
| `new MessageViewportRuntime(options)` | `createMessageListRuntime(options)` | 改为 factory，避免暴露实现 class |
| `MessageViewportProps` | `MessageListProps` | 改名 |
| `MessageViewportSnapshot` | `MessageListSnapshot` | 改名；内部可用 `ProjectionSnapshot` |
| `useMessageViewportSnapshot` | `useMessageListSnapshot` | 改名 |
| `useMessageViewportSelector` | `useMessageListSelector` | 改名 |
| `renderMessage` | `renderRow` | 改名；row 不一定是普通 message |
| `renderFollowBottom` | `renderScrollToLatest` | 改名；public UI 语义是 latest |
| `renderViewportOverlay` | `renderOverlay` | 改名；props 作用域已在 `MessageList` 内 |
| `onViewportAnchorChanged` | `onViewportAnchorChange` | 改为 React callback 语态 |
| `onViewportObservation` | `onViewportObservationChange` | 改为 React callback 语态 |
| `attach` | `attachScrollContainer` | 改名；明确绑定 DOM 对象 |
| `detach` | `detachScrollContainer` | 改名；区别于 destroy |
| `destroy` | `destroy` | 保留 |
| `setDataSnapshot` | `applyLoadedSegment` | 改名；viewport runtime 只消费 data runtime 输出 |
| `dispatch({ type: 'followBottom' })` | `scrollToLatest()` | 改名；不公开 generic dispatch |
| `dispatch({ type: 'jump' })` | `scrollToMessage(target)` | 改名 |
| `dispatch({ type: 'restore' })` | `restoreToMessage(target)` | 改名 |
| `subscribe` | `subscribeSnapshot` | 改名；明确用于 external store |
| `subscribeEvent` | `subscribeRuntimeEvent` | 改名 |
| `subscribeViewportObservation` | `subscribeViewportObservation` | 保留；术语准确 |
| `getSnapshot` | `getSnapshot` | 保留 |
| `getViewportAnchorState` | `getViewportAnchor` | 简化；返回当前可持久化 `MessageIdentityAnchor`，不外露 visual anchor |
| `getDiagnosticRecords` | `getDiagnostics` | 简化 |
| `getDebugSnapshot` | `getEvidence` / `getDiagnostics` | 拆分；E2E 证据和诊断分别稳定 |
| `registerRow` | `registerRowElement` | adapter-private，改名 |
| `registerTopSpacer` / `registerBottomSpacer` | 删除 | next 没有 spacer |
| `registerTopSentinel` / `registerBottomSentinel` | `registerBeforeTriggerElement` / `registerAfterTriggerElement` | 改名；trigger 在正常文档流 |
| `notifyProjectionCommitted` | `ackProjectionCommit` | 改名；ack 语义更直接 |
| `beginDirectScroll` / `writeDirectScrollTop` / `endDirectScroll` | 同名 adapter-private | 保留；只给 scrollbar overlay 使用 |

## 禁止词与别名

新实现和新文档的正向描述中禁止使用：

- `MessageViewport` 作为 public component。
- `MessageViewportRuntime` 作为 public runtime facade。
- `MessageViewportSnapshot` 作为 public snapshot。
- `renderWindow`、`topSpacer`、`bottomSpacer`、`spacerEngine`、`virtualRange`、`estimatedTotalHeight`、`globalOffset`。
- `viewportEffect`；统一使用 `SegmentModifier`。
- `dispatch({ type })` 作为 public command API。
- `registerTopSpacer`、`registerBottomSpacer`、`registerTopSentinel`、`registerBottomSentinel`。

如果必须在迁移文档中引用旧词，必须同时标注对应的 next canonical 名称和删除原因。
