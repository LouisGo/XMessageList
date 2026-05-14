# Runtime 容器内核架构

## 1. Scope

本文档定义滚动视图容器 runtime 的内部模块和公开 surface。

本文不讨论：

- 数据如何从 SDK 读取
- anchor 如何跨 main / renderer 传递
- message row 的视觉设计
- legacy 容器迁移方案

## 2. Runtime Shape

推荐核心对象：

```ts
class MessageViewportRuntime {
  attach(container: HTMLElement): void;
  detach(): void;
  destroy(): void;

  setDataSnapshot(snapshot: MessageDataSnapshot): void;
  dispatch(command: MessageRuntimeCommand): void;

  subscribe(listener: RuntimeListener): () => void;
  subscribeEvent(listener: RuntimeEventListener): () => void;
  getSnapshot(): MessageViewportSnapshot;
  getViewportAnchorState(): AnchorState | null;

  registerRow(key: MessageRuntimeItemKey, element: HTMLElement | null): void;
  registerTopSpacer(element: HTMLElement | null): void;
  registerBottomSpacer(element: HTMLElement | null): void;
  registerTopSentinel(element: HTMLElement | null): void;
  registerBottomSentinel(element: HTMLElement | null): void;

  notifyProjectionCommitted(commit: ProjectionCommit): void;
}
```

`register*` 是 React projection 和 runtime 的 DOM 桥。Runtime 不通过 React state 获取 DOM，也不要求 React 传业务 message 对象给 measurement。

说明：

- `getViewportAnchorState()` 是 renderer 本地恢复位点导出能力，只返回当前 viewport 的 `AnchorState`，不跨进程。
- 诊断辅助（例如 `getDebugSnapshot()`）不属于稳定合同，因此不在这里列为公开 surface。

## 3. Internal Modules

| Module | Responsibility | React 可见 |
| --- | --- | --- |
| ProjectionStore | 保存并发布 `MessageViewportSnapshot` | 通过 `getSnapshot` |
| DomRegistry | container、row、spacer、sentinel refs | 不可见 |
| RenderWindowEngine | 计算 mount item 范围和 trim 计划 | `renderWindow` |
| SpacerEngine | 估算并修正 spacer 高度 | `topSpacer` / `bottomSpacer` |
| MeasurementEngine | 同步测量、ResizeObserver、height cache | 不直接可见 |
| ScrollIntentEngine | 区分 user / programmatic / recovery / follow bottom | `bottomLockState` |
| TransactionRunner | 串行执行 bootstrap / prepend / append / jump / resize | 不直接可见 |
| LifecycleGuard | generation、destroy、detach、异步资源清理 | 不直接可见 |

## 4. Snapshot Boundary

只有 projection 必须渲染的字段进入 snapshot。

```ts
type MessageViewportSnapshot = {
  feedId: string;
  generation: number;
  revision: number;
  items: MessageDataItem[];
  renderWindow: RenderWindow;
  topSpacer: number;
  bottomSpacer: number;
  bottomLockState: BottomLockState;
  bootstrapState: BootstrapState;
  edgeState: ViewportEdgeState;
};
```

必须进入 snapshot：

- `items`
- `renderWindow`
- `topSpacer`
- `bottomSpacer`
- `bottomLockState`
- `bootstrapState`
- 边缘 loading / exhausted 状态

禁止进入 snapshot：

- `scrollTop`
- measured row rects
- ResizeObserver entries
- internal transaction object
- command queue
- height cache map
- raw DOM refs
- momentum / wheel event details

规则：

```text
会改变 React 要渲染什么，才进入 snapshot。
只影响 runtime 如何稳定视口，不进入 snapshot。
```

## 5. Snapshot Revision

Runtime snapshot revision 只在 projection 输出变化时递增：

- renderWindow item keys 变化
- spacer 高度变化
- bottom lock UI 状态变化
- bootstrap / edge 状态变化
- data item projection 版本变化

以下变化不递增 snapshot revision：

- 用户滚动但 window 未滑动
- height cache 更新但 spacer 不变
- ResizeObserver 回调被合并但无需 projection
- runtime 内部 command queue 变化

React adapter 依赖 revision 做 commit 回执，但不能把 revision 当作业务数据版本。

## 6. DOM Contract

推荐 DOM 结构：

```html
<div data-message-viewport>
  <div data-top-sentinel></div>
  <div data-top-spacer style="height: ...px"></div>
  <div data-message-window>
    <div data-message-row="..."></div>
  </div>
  <div data-bottom-spacer style="height: ...px"></div>
  <div data-bottom-sentinel></div>
</div>
```

约束：

- row 必须处于正常文档流。
- spacer 也是正常文档流元素。
- container 是唯一 scroll container。
- `overflow-anchor: none` 放在 scroll container 或 message window 根节点。
- row key 必须使用 `MessageRuntimeItemKey`，不能使用 render index。

## 7. Runtime State Machine

```ts
type RuntimeState =
  | 'INITIAL'
  | 'ATTACHED'
  | 'BOOTSTRAPPING'
  | 'READY'
  | 'TRANSACTING'
  | 'DETACHED'
  | 'DESTROYED';
```

转移规则：

| From | Event | To |
| --- | --- | --- |
| INITIAL | attach | ATTACHED |
| ATTACHED | bootstrap command + data ready | BOOTSTRAPPING |
| BOOTSTRAPPING | settle | READY |
| READY | transaction start | TRANSACTING |
| TRANSACTING | transaction commit | READY |
| ATTACHED / READY / TRANSACTING | detach | DETACHED |
| DETACHED | attach | ATTACHED |
| any non-destroyed | destroy | DESTROYED |

`detach` 不等同于 `destroy`。React StrictMode 下允许 `attach -> detach -> attach`，runtime 必须保持幂等。

## 8. Public Events

Runtime 可以向外发出 view-level 事件：

```ts
type MessageViewportRuntimeEvent =
  | {
      type: 'needMoreBefore';
      feedId: string;
      generation: number;
      reason: 'near-top' | 'prepend-recovery';
    }
  | {
      type: 'needMoreAfter';
      feedId: string;
      generation: number;
      reason: 'near-bottom' | 'bottom-follow';
    }
  | {
      type: 'viewportAnchorChanged';
      feedId: string;
      generation: number;
      reason: 'scroll-idle' | 'transaction-settle';
      anchor: AnchorState | null;
    }
  | { type: 'viewportReady'; feedId: string; generation: number }
  | { type: 'viewportError'; feedId: string; generation: number; code: string };
```

这些事件只能表达 viewport 需求，不携带 SDK query 细节。

当前实现会在用户接近 after edge 时发出 `reason: 'near-bottom'`，
也会在外部显式 `followBottom` 但当前 DataWindow 仍有 `hasMoreAfter=true`
时发出 `reason: 'bottom-follow'`。接入方必须先加载 newer page，直到
`hasMoreAfter=false` 后再让 runtime 进入真正的 BottomLocked。

React/demo 层不得用 raw `scrollTop` / `scrollHeight` 自行重建向下分页判断；
否则会绕过 runtime 的 scroll source classification、edge latch 和 transaction
时序，导致吸底与向下分页相互打架。

React/demo 层也不得 query projection DOM 或注册 raw scroll listener 来保存
恢复位点。Runtime 在 scroll rAF / transaction settle 后发出
`viewportAnchorChanged`，React adapter 把它透传给接入方；是否持久化、持久化到
哪里属于 data/demo/app 层。

## 9. Implementation Order

推荐顺序：

1. ProjectionStore + `useSyncExternalStore` adapter。
2. DomRegistry + commit 回执。
3. latest bootstrap 到 bottom locked。
4. prepend transaction。
5. dynamic height stabilization。
6. RenderWindow sliding 和 trim。
7. jump / restore。
8. feed teardown 和 StrictMode 压测。
