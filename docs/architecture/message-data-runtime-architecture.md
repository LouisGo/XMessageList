# Message Data Runtime 架构

## 1. Scope

本文档定义：

```text
视图无关的消息数据运行时
```

它横跨：

- main process SDK / Bridge
- renderer data runtime

它不拥有：

- DOM Window
- spacer
- measurement
- scrollTop
- bottom lock
- React projection

其中 DOM Window、spacer、measurement、scrollTop、bottom lock 属于 viewport runtime。

React projection 属于 React。

---

# 2. System Model

系统本质上不是：

```text
MessageList data source
```

而是：

```text
Message Data Runtime
```

Data Runtime 维护的是：

```text
可被视口投影的消息数据窗口
```

而不是：

```text
用户当前看到的 DOM 视口
```

---

# 3. Core Principle

Data Runtime 只回答三个问题：

1. 以哪个 MessageIdentityAnchor 为中心读取。
2. 当前 feed 已知哪些有序消息 item。
3. 数据边界是否还能继续扩展。

它不回答：

- 当前 scrollTop 是多少
- 哪些 DOM 节点应该 mount
- topSpacer 多高
- resize 后怎么修正视口

---

# 4. Main Process Responsibilities

main process 负责：

| Responsibility | Description |
| --- | --- |
| SDK Adapter | 屏蔽 native SDK 形状 |
| Anchor Resolution | latest / index / legacy target 转 MessageIdentityAnchor |
| Around Query | 围绕 anchor 读取 before / after messages |
| Error Normalization | 将 SDK 异常转换成稳定 Bridge error |
| Response Validation | 校验 anchorStatus、message order、required fields |
| In-flight Dedup | 合并同 feed 同 anchor 的重复读取 |
| Raw Cache | 短生命周期缓存 SDK 原始响应 |

main process 禁止感知：

- viewport height
- scrollTop
- DOM mounted range
- measured message height
- React state

main process 输出的是：

```text
feed-scoped message data
```

不是：

```text
viewport instruction
```

---

# 5. Bridge Contract Shape

Bridge 合同应围绕：

```text
MessageIdentityAnchor
```

而不是：

```text
scroll position
```

典型响应：

```ts
type MessageAroundResult = {
  feedId: string;
  anchor: MessageIdentityAnchor;
  anchorStatus: 'normal' | 'deleted';
  messages: Message[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
};
```

合同必须稳定表达：

- 命中的 anchor
- anchor 是否可投影
- 消息有序集合
- 前后是否还有数据

合同禁止包含：

- topSpacer
- bottomSpacer
- offsetWithinMessage
- scrollTop
- DOM range

---

# 6. Renderer Data Runtime Responsibilities

renderer data runtime 负责：

| Responsibility        | Description                                          |
| --------------------- | ---------------------------------------------------- |
| Feed Cache            | 按 feed 隔离消息数据                                 |
| Ordered Merge         | 以 message identity 去重并维护顺序                   |
| Data Window           | 维护可供 viewport 消费的消息切片                     |
| Request Orchestration | latest / unread / restored / jump / prepend / append |
| Subscription          | 接收新消息、删除、编辑、reaction 等增量              |
| Optimistic Rebind     | 将本地 optimistic identity 绑定到 server identity    |
| Invalidation          | feed 切换、会话失效、权限变化后清理                  |
| Snapshot Publish      | 向 viewport runtime 发布稳定数据快照                 |

renderer data runtime 可以使用：

- react-query
- external store
- observable cache

但这些只是异步资源管理工具。

它仍然不能拥有：

```text
viewport timing
```

---

# 7. Data Item Model

DataWindow 承载的是：

```text
message runtime items
```

而不只是 server messages。

推荐模型：

```ts
type MessageDataItem =
  | {
      kind: 'committed';
      key: { kind: 'committed'; messageId: string };
      message: Message;
      version: number;
    }
  | {
      kind: 'optimistic';
      key: { kind: 'optimistic'; clientMessageId: string };
      draft: OptimisticMessage;
      status: 'sending' | 'failed';
    }
  | {
      kind: 'tombstone';
      key: { kind: 'committed'; messageId: string };
      reason: 'deleted' | 'unavailable';
    };
```

规则：

- committed item 按 server order 合并
- optimistic item 按 client order 附着在本地发送位置
- tombstone 保留 identity 和局部上下文
- optimistic -> committed 必须走 identity rebind

Data Runtime 不把 optimistic item 暴露成：

```text
MessageIdentityAnchor
```

---

# 8. Mutation Merge Semantics

增量事件必须显式表达 merge 语义。

推荐事件：

| Event | Data Behavior | Viewport Effect |
| --- | --- | --- |
| insert | 插入 committed item | possible-height-change |
| optimisticInsert | 插入 optimistic item | possible-height-change |
| identityRebind | optimistic key 绑定 committed key | identity-remap |
| replace | 替换整条消息 | possible-height-change |
| patch | 局部更新消息字段 | possible-height-change |
| delete | 转 tombstone 或移除 | anchor-risk |
| reactionPatch | 更新 reaction 子字段 | possible-height-change |
| invalidateRange | 丢弃局部窗口并重读 | full-reset |

删除策略：

```text
anchor 附近优先 tombstone
```

```text
远离 viewport 可以移除
```

原因：

```text
删除可能影响 AnchorState 和局部视觉连续性
```

Data Runtime 只标注 Viewport Effect。

实际 scroll correction 仍由 viewport runtime 决定。

---

# 9. Data Window vs Render Window

必须区分：

| Window       | Owner            | Meaning                            |
| ------------ | ---------------- | ---------------------------------- |
| DataWindow   | data runtime     | 当前 feed 已加载的有序 item 范围   |
| RenderWindow | viewport runtime | 当前需要 mount 到 DOM 的 item 范围 |

DataWindow 可以大于 RenderWindow。

DataWindow 用于：

- request continuation
- message merge
- edge detection
- cache reuse

RenderWindow 用于：

- DOM mount
- spacer estimation
- measurement
- trim

禁止：

```text
DataWindow 直接推导 scroll geometry
```

---

# 10. Entry Protocols

---

## 10.1 Latest

目标：

```text
读取最新消息附近的数据
```

流程：

```text
resolve latest MessageIdentityAnchor
-> load around latest
-> publish DataWindow
-> viewport performs Latest Bootstrap
```

Data Runtime 不执行：

```text
scrollToBottom()
```

---

## 10.2 Unread

目标：

```text
读取未读位置附近的数据
```

流程：

```text
resolve unread MessageIdentityAnchor
-> load around unread
-> publish DataWindow
-> viewport positions unread marker
```

Unread marker 是 projection 语义。

Unread bootstrap timing 属于 viewport runtime。

---

## 10.3 Restored

目标：

```text
恢复历史会话位置
```

流程：

```text
load around restored MessageIdentityAnchor
-> allow nearest-neighbor fallback
-> publish DataWindow with anchorStatus
-> viewport restores after mount
```

如果 restore 输入包含 `offsetWithinMessage`，Data Runtime 只消费：

```text
identity part
```

Data Runtime 不要求：

```text
exact anchor message exists
```

---

## 10.4 Jump

目标：

```text
定位指定消息
```

流程：

```text
jump target
-> load around target
-> replace or extend DataWindow
-> viewport performs jump pipeline
```

Data Runtime 不写：

```text
scrollTop
```

---

## 10.5 Prepend / Append

目标：

```text
扩展当前数据窗口
```

prepend 使用：

```text
top edge MessageIdentityAnchor
```

append 使用：

```text
bottom edge MessageIdentityAnchor
```

数据扩展完成后只发布：

```text
new DataWindow snapshot
```

anchor recovery 属于 viewport runtime。

---

# 11. Data Invariants

Data Runtime 必须保证：

- feed scoped
- message item identity 去重
- stable ordering
- append / prepend merge 幂等
- optimistic rebind 原子化
- mutation effect 显式
- anchorStatus 显式
- partial response 可表达
- request failure 可重试

Data Runtime 不保证：

- 全量消息存在
- 所有消息高度已知
- index 永久稳定
- anchor message 永远可投影
- optimistic item 永远成功提交

---

# 12. Output To Viewport Runtime

推荐输出：

```ts
type MessageDataSnapshot = {
  feedId: string;
  items: MessageDataItem[];
  anchor?: MessageIdentityAnchor;
  anchorStatus?: 'normal' | 'deleted';
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  revision: number;
  change: MessageDataSnapshotChange;
};

type MessageDataSnapshotChange = {
  kind:
    | 'initial'
    | 'append'
    | 'prepend'
    | 'patch'
    | 'delete'
    | 'identityRebind'
    | 'reset';
  viewportEffect:
    | 'none'
    | 'possible-height-change'
    | 'identity-remap'
    | 'anchor-risk'
    | 'full-reset';
};
```

`revision` 用于表达：

```text
DataSnapshot identity 已变化
```

不是：

```text
viewport 必须滚动
```

revision 必须在以下情况递增：

- items 顺序变化
- item 内容版本变化
- optimistic identity rebind
- tombstone / delete 变化
- data window 边界变化
- feed reset

revision 不因为以下情况递增：

- viewport scroll
- measurement delta
- bottom lock state
- React local state

viewport runtime 根据 semantic operation 决定：

- bootstrap
- prepend recovery
- append follow
- jump
- restore

---

# 13. Error And Retry Boundary

Data Runtime 负责：

- SDK timeout retry
- request cancellation
- stale response discard
- merge conflict normalization
- reset snapshot publish

Data Runtime 不负责：

```text
viewport emergency recovery
```

当数据层无法给出连续窗口时，必须发布：

```text
reset / full-reset
```

让 viewport runtime 执行重新 bootstrap。

---

# 14. Non-goals

Data Runtime 不追求：

- viewport stability
- DOM memory reclamation
- scroll intent classification
- bottom lock hysteresis
- dynamic height correction
- React component ownership

核心原则：

```text
Data Runtime owns message availability
```

```text
Viewport Runtime owns viewport stability
```
