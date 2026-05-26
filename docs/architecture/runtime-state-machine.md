# Runtime 状态模型

Runtime 是多条状态轴，不是一个大 enum。任何实现都不能用单一 `state === READY` 推断滚动、分页和跳转都已安全。

## Lifecycle

```text
INITIAL -> ATTACHED -> BOOTSTRAPPING -> READY
READY -> DETACHED -> ATTACHED
any -> DESTROYED
```

规则：

- `detach` 不是 `destroy`，StrictMode 下 attach / detach / attach 必须幂等。
- detach 清 DOM refs 前必须发出最后一次 `viewportAnchorChanged(reason: 'detach')`。
- generation 变化会取消当前 transaction、edge latch、pending intent、motion。

## Transaction State

```text
idle -> queued -> active -> measuring -> correcting -> settling -> idle
```

所有会改变 DOM segment 或写 `scrollTop` 的操作必须进入 transaction：

- bootstrap
- extend before
- extend after
- reset around
- reset latest
- trim before / after
- resize stabilization
- identity remap
- patch above anchor

同一时刻只能有一个 transaction 拥有 DOM measurement 和 `scrollTop` correction。

每个 projection transaction 都必须带完整 token：

```ts
type ProjectionCommitToken = {
  feedId: string;
  generation: number;
  segmentRevision: number;
  projectionRevision: number;
};
```

token 不匹配时，commit ack、observer entry、edge need 和 diagnostics 都必须被丢弃或标记 stale，不能被当前 feed 消费。

## Viewport Phase

Viewport phase 是给 React / diagnostics / tests 的可观察视觉阶段：

| Phase | 含义 |
| --- | --- |
| `IDLE` | 无 projection / correction 正在进行 |
| `PROJECTING` | 已发布 snapshot，等待 React commit |
| `MEASURING` | commit 后读取 DOM rect / height |
| `CORRECTING` | 正在写 anchor correction |
| `MOTION` | 目的地动画拥有 scroll writer |

Phase 不决定业务状态，只用于防止 edge need、observation 和 tests 抢时序。

## Pending Intents

### Pending Edge

before / after trigger 进入 viewport 后，runtime 发出 edge need 并 latch 当前 revision。

释放条件：

- 用户明确离开该 edge。
- 对应请求完成并进入 matching segment transaction。
- feed generation 变化。
- reset / jump / restore 取消当前边缘语义。

### Pending Underflow Fill

bootstrap、reset-around、reset-latest、trim 或 resize settle 后，如果当前真实 `scrollHeight` 无法形成可滚动范围，同时 `hasMoreBefore` 或 `hasMoreAfter` 仍为 true，runtime 进入 underflow fill。

规则：

- underflow fill 是独立 pending intent，不是 user/momentum edge need。
- underflow 期间普通 before / after IntersectionObserver need 被暂停。
- 同一个 segmentRevision 只允许一个 fill request；请求必须携带 generation、segmentRevision 和 requestToken。
- 每次只请求一个 edge，commit settle 后重新评估是否继续。
- 两边都 exhausted 或达到最小滚动范围后，underflow fill settle。

### Pending Follow Bottom

显式 follow bottom 若当前 `hasMoreAfter=true`：

- 发 `needLatestMessages(reason: 'bottom-follow')`。
- 等待 `reset-latest` snapshot。
- pending 期间不发普通 after edge need。
- 用户主动向上滚动取消。

### Pending Destination

jump / restore 目标不在当前 segment：

- 发 `needMessagesAround(reason: 'jump' | 'restore')`。
- 等待 `reset-around` snapshot。
- 普通 patch / extend 不消费 pending destination。

## Scroll Source

Runtime 至少区分：

| Source | 可触发 edge need | 说明 |
| --- | --- | --- |
| `user` | yes | wheel / touch / scrollbar direct drag 的当前激活输入 |
| `momentum` | yes | 用户输入后的惯性延续 |
| `recovery` | no | anchor correction |
| `programmatic` | no | attach restore / reset align |
| `followBottom` | no | bottom follow motion |
| `jump` | no | jump motion |
| `underflowFill` | no | 短 segment 自动补齐请求，不来自滚动输入 |

分类必须有时效。旧 feed 的输入、attach 产生的 scroll event、recovery 写入都不能被解释成新的用户分页意图。
