# Message Anchor 心智模型

## 1. Anchor 不是位置

Anchor 不是：

- 当前滚动 offset。
- 当前列表 index。
- 全局像素坐标。

Anchor 是：

```text
消息流中的稳定语义坐标
```

原因：

- 滚动 offset 是视口当前物理结果，会受设备尺寸、字体、媒体加载和布局变化影响。
- index 会因 prepend、delete、retention、合并策略变化而变化。
- 全局像素坐标依赖全量精确测量，IM 消息流通常不具备这个前提。

## 2. 三类 Anchor

系统必须区分三类 anchor。

### 2.1 MessageIdentityAnchor

跨 SDK、data runtime、viewport runtime 传递的消息身份坐标。

```text
MessageIdentityAnchor {
  messageId
  position?
}
```

语义是在某个 feed 内定位一条已提交消息。feed 作用域由外层请求承载。

允许用于：

- SDK request / response。
- data runtime cache key。
- latest、unread、restored、jump、quote locate 的目标。
- deleted / retention 后的 nearest-neighbor fallback。

禁止承载：

- 本地视口 offset。
- 已测量高度。
- materialized row index。
- projection 层局部状态。

### 2.2 AnchorState

viewport runtime 本地的视口坐标。

```text
AnchorState {
  key: MessageRuntimeItemKey
  offsetWithinItem
}
```

语义是当前视口顶部落在哪个 runtime item 的哪个局部偏移。

它用于：

- prepend recovery。
- resize stabilization。
- trim continuity。
- restored position after layout。

`AnchorState` 不进入 SDK 合同。它依赖本地布局结果，只能由 viewport runtime 捕获、
保存和解释。如果需要持久化会话位置，可以保存 identity 部分加 `offsetWithinItem`，
恢复时仍必须先用 identity 部分读取 around 数据，再由 viewport runtime 解释 offset。

`AnchorState` 只适用于同一个 live runtime generation 内的恢复，例如 feed 临时
detach 后又 attach。跨进程重启、runtime 被 LRU 淘汰、feed generation reset 后，
不能直接复用旧 `AnchorState`。这类冷恢复只能使用 persisted identity anchor 加
本地 offset hint，先由 data runtime 读取 around window，再由新的 viewport runtime
在 layout 后解释 offset。

### 2.3 BottomAnchor

bottom locked 状态下，底部本身就是 anchor。

它不是某条消息的 top，也不是最后一条消息的固定 offset。它表达的是：

```text
用户正在跟随 feed latest bottom
```

BottomAnchor 只有在 `hasMoreAfter == false` 时成立。如果 `hasMoreAfter == true`，
当前已加载数据的底部只是 DataWindow 的 after edge，不是 feed 最新底部。

此时：

- 用户继续向下浏览可以触发 `needMoreAfter`。
- 显式 follow bottom 必须触发 `needLatestMessages`。
- runtime 不得把当前物理底部解释为 bottom locked。

## 3. Position 语义

`position` 是消息身份的排序辅助信息。

它可用于：

- SDK around query。
- anchor disambiguation。
- nearest-neighbor fallback。
- retention 后的邻近恢复。

它不是：

- render index。
- materialized row index。
- message top offset。

当 `messageId` 和 `position` 不一致时，`messageId` 优先表达身份，
`position` 只用于排序、邻近关系和异常诊断。

## 4. Runtime Item Identity

跨层定位只能使用已提交消息身份，但本地消息流还会出现 optimistic item。

推荐模型：

```text
MessageRuntimeItemKey =
  committed(messageId)
  optimistic(clientMessageId)
```

规则：

- `MessageIdentityAnchor` 用于跨层定位。
- `MessageRuntimeItemKey` 用于 viewport runtime 和 projection shell。
- optimistic item 可以参与本地投影，但不能成为 durable navigation anchor。
- optimistic -> committed 必须做 identity rebind，而不是 delete + insert。

identity rebind 后必须迁移：

- selection identity。
- measured height cache。
- runtime anchor。
- materialized row key。

## 5. Fallback 语义

Anchor message 可能不存在。

原因包括：

- deleted。
- retention。
- local cache missing。
- SDK partial response。

允许 nearest-neighbor fallback，但必须显式表达 `anchorStatus`：

| Status | Meaning |
| --- | --- |
| `normal` | 命中请求 anchor |
| `deleted` | 原 anchor 不可投影，但已恢复到邻近位置 |
| `unavailable` | 当前数据层无法给出可恢复邻近位置 |

实现不能要求 exact anchor message 永远存在。

`unavailable` 不是普通 fallback 成功状态。它不能直接进入 jump / restore
transaction；上层必须把它当作 data unavailable 处理，例如展示错误/空态、回退
latest bootstrap，或等待用户重新发起定位。

## 6. 最终规则

```text
MessageIdentityAnchor 是跨层坐标。
AnchorState 是 viewport runtime 本地坐标。
BottomAnchor 是 latest bottom 跟随状态。
滚动 offset 永远只是结果。
```
