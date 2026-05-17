# Message Runtime 实现合同

## 1. Scope

本文档定义：

```text
从零实现 runtime 时必须固定的外部合同
```

不重复定义：

- anchor 语义
- data merge 规则
- viewport 架构原则
- legacy 迁移边界

---

# 2. Runtime Public API

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

  notifyProjectionCommitted(commit: ProjectionCommit): void;
}
```

Runtime 必须：

- 脱离 React
- 命令式
- 可销毁
- feed scoped
- generation scoped

---

# 3. Snapshot Contract

Runtime 发布给 React 的是：

```text
projection snapshot
```

而不是 internal state。

推荐模型：

```ts
type MessageViewportSnapshot = {
  feedId: string;
  generation: number;
  revision: number;
  renderWindow: RenderWindow;
  items: MessageDataItem[];
  topSpacer: number;
  bottomSpacer: number;
  bottomLockState: BottomLockState;
  bootstrapState: BootstrapState;
};
```

React 只订阅：

```text
snapshot
```

不读取 runtime 内部字段。

---

# 4. React Commit Contract

Runtime 发布 projection 后，必须等待 React commit 回执。

推荐回执：

```ts
type ProjectionCommit = {
  feedId: string;
  generation: number;
  revision: number;
};
```

正确时序：

```text
runtime publishes projection
-> React renders
-> layout effect / ref callback
-> notifyProjectionCommitted
-> runtime measures
-> runtime stabilizes
```

禁止：

```text
publish projection
-> immediately measure
```

因为 React 18 不保证同步 commit。

---

# 5. Transaction Model

所有 viewport mutation 必须进入 transaction。

```ts
type ViewportTransaction =
  | 'bootstrap'
  | 'prepend'
  | 'append'
  | 'jump'
  | 'restore'
  | 'resize'
  | 'identityRebind'
  | 'reset';
```

Transaction 负责：

- freeze scroll intent
- publish projection
- wait commit
- measure
- correct scrollTop
- update spacer
- commit AnchorState
- release scroll intent

Transaction 不是：

```text
React render transaction
```

它是 viewport runtime 的原子语义单元。

---

# 6. Command Queue

命令必须串行化。

推荐命令：

```ts
type MessageRuntimeCommand =
  | {
      type: 'bootstrap';
      mode: 'latest' | 'unread' | 'restored';
      target?: AnchorState | MessageIdentityAnchor;
    }
  | { type: 'jump'; target: MessageIdentityAnchor; origin?: MessageIdentityAnchor }
  | { type: 'restore'; target: AnchorState | MessageIdentityAnchor }
  | { type: 'followBottom' }
  | { type: 'reset'; reason: string };
```

规则：

| Runtime State | Command Behavior                                  |
| ------------- | ------------------------------------------------- |
| INITIAL       | only bootstrap accepted                           |
| BOOTSTRAPPING | latest bootstrap wins, jump replaces pending jump |
| READY         | commands execute sequentially                     |
| DESTROYED     | command rejected                                  |

Supersede 规则：

- later jump cancels earlier pending jump
- reset cancels all pending commands
- feed generation change cancels all old commands
- followBottom is ignored when not READY

当前 prototype 状态：

- `bootstrap(latest)`、`bootstrap(restored)`、`restore` 已落地。
- `bootstrap(unread)` 仍保留在合同中，但当前实现会显式返回 `not-implemented`，不能当作已完成能力依赖。

---

# 7. Data Revision Handling

Runtime 不能只看 `revision` 数字。

必须同时读取：

```text
snapshot.change.viewportEffect
```

建议策略：

| Viewport Effect        | Runtime Response                    |
| ---------------------- | ----------------------------------- |
| none                   | update projection only              |
| possible-height-change | observe + coalesce stabilization    |
| identity-remap         | rebind keys / anchor / height cache |
| anchor-risk            | verify anchor, fallback if missing  |
| full-reset             | run reset bootstrap                 |

---

# 8. FlushSync Policy

默认不使用：

```text
flushSync
```

允许使用的场景：

- transaction 已冻结 scroll intent
- 必须在用户可见前完成 projection commit
- 范围局限于 message viewport projection
- 有测试覆盖

禁止把 flushSync 作为：

```text
常规 React 同步方案
```

primary contract 仍然是：

```text
publish -> commit callback -> measure -> correct
```

---

# 9. Performance Budgets

预算用于验证，不用于改变架构。

建议目标：

| Scenario                        | Budget                  |
| ------------------------------- | ----------------------- |
| Bootstrap first stable viewport | <= 300ms                |
| Jump target visible             | <= 150ms                |
| Prepend visible drift           | 0 frame observable jump |
| Bottom follow after append      | <= 1 frame after commit |
| Resize stabilization            | coalesced per frame     |

超过预算时：

```text
先找 transaction / measurement / commit 问题
```

不要引入：

```text
global exact offsets
```

---

# 10. Test Contract

最小测试矩阵：

- latest bootstrap enters bottom locked
- unread bootstrap keeps context around marker
- restored missing anchor uses nearest neighbor
- prepend keeps AnchorState visual position
- delete anchor falls back deterministically
- optimistic rebind preserves item continuity
- reaction height change stabilizes
- bottom lock uses dual threshold hysteresis
- later jump supersedes pending jump
- feed generation discards stale commit
- React commit callback gates measurement

测试必须断言：

```text
observable viewport behavior
```

而不是：

```text
private implementation fields
```
