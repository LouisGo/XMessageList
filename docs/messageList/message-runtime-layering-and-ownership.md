# Message Runtime 分层与职责归属

## 1. Scope

本文档只回答：

```text
一段逻辑应该属于哪一层
```

不重复定义：

- anchor 语义
- data request protocol
- viewport stabilization pipeline
- 迁移步骤

---

# 2. Layer Model

新消息架构分为五层。

```text
Shared Bridge Contracts
  -> Main Message Data Service
  -> Renderer Message Data Runtime
  -> Renderer Viewport Runtime
  -> React Projection
```

旁路入口：

```text
@actions
```

只表达用户命令。

不拥有数据或视口。

---

# 3. Ownership Table

| Capability                   | Owner                         |
| ---------------------------- | ----------------------------- |
| Bridge type contract         | Shared contracts              |
| SDK call                     | Main Message Data Service     |
| latest anchor resolution     | Main Message Data Service     |
| around message read          | Main Message Data Service     |
| message cache / merge        | Renderer Message Data Runtime |
| data subscription            | Renderer Message Data Runtime |
| DataWindow                   | Renderer Message Data Runtime |
| RenderWindow                 | Renderer Viewport Runtime     |
| ViewportAnchor / AnchorState | Renderer Viewport Runtime     |
| BottomLockState              | Renderer Viewport Runtime     |
| spacer                       | Renderer Viewport Runtime     |
| measurement                  | Renderer Viewport Runtime     |
| scrollTop writes             | Renderer Viewport Runtime     |
| feed teardown                | Layer owner                   |
| command queue                | Renderer Viewport Runtime     |
| message row rendering        | React Projection              |
| toolbar / menu command       | `@actions`                    |

---

# 4. Shared Bridge Contracts

Shared contracts 负责：

- MessageIdentityAnchor type
- request / response shape
- anchorStatus enum
- normalized error code
- feed scoped payload

禁止包含：

- DOM offset
- measured height
- scrollTop
- React component state

合同语言必须保持：

```text
view-agnostic
```

---

# 5. Main Message Data Service

main 层负责：

```text
把 SDK 世界转成稳定 Bridge 世界
```

允许：

- 调 SDK
- 解析 latest anchor
- 读取 around messages
- 校验 SDK payload
- 缓存短生命周期 raw response
- 归一化错误

禁止：

- 判断 bottom lock
- 计算 RenderWindow
- 估算 spacer
- 存储 ViewportAnchor / AnchorState
- 感知 React lifecycle

---

# 6. Renderer Message Data Runtime

renderer data 层负责：

```text
把 Bridge 数据转成可订阅的数据快照
```

允许：

- 请求 latest / unread / restored / jump 数据
- 合并 prepend / append 结果
- 维护 feed scoped DataWindow
- 处理消息增量事件
- 发布 MessageDataSnapshot

禁止：

- 写 scrollTop
- capture ViewportAnchor / AnchorState
- 处理 ResizeObserver delta
- 根据 DOM 高度修正数据窗口
- 用 React state 驱动 viewport recovery

---

# 7. Renderer Viewport Runtime

viewport runtime 负责：

```text
维持用户正在观察的消息视口
```

允许：

- 计算 RenderWindow
- 决定 DOM window mount / trim
- 维护 spacer
- capture ViewportAnchor / AnchorState
- 分类 scroll intent
- 维护 BottomLockState
- 处理 measurement delta
- 执行 scrollTop correction

禁止：

- 调 SDK
- 解释业务权限
- 长期持有业务数据缓存
- 渲染具体 message content

viewport runtime 可以消费：

```text
MessageDataSnapshot
```

但不拥有：

```text
MessageDataRuntime
```

---

# 8. React Projection

React 负责：

```text
把 runtime projection 渲染成 UI
```

允许：

- render message row
- render unread divider
- render bottom indicator
- render selection UI
- 处理局部交互态

禁止：

- 拥有 RenderWindow 状态机
- 用 useState 驱动 scroll recovery
- 直接写 scrollTop
- 在 effect 中重建 viewport timing
- 直接发起 SDK message range 读取

React 接收：

```text
projection snapshot
```

而不是拥有：

```text
viewport runtime
```

---

# 9. Actions Boundary

`@actions` 负责：

```text
用户命令入口
```

例如：

- jumpToMessage
- jumpToChat
- reply locate
- unread locate

action 可以发出：

```text
semantic command
```

例如：

```ts
type MessageRuntimeCommand =
  | { type: 'jump'; target: MessageIdentityAnchor }
  | { type: 'restore'; target: AnchorState | MessageIdentityAnchor }
  | { type: 'followBottom' };
```

其中 `restore` 更常见的输入是 renderer 本地保存的 `AnchorState`；
如果只拿到 `MessageIdentityAnchor`，则说明数据层已经先完成了 around-anchor 读取与 fallback。

action 禁止：

- 直接操作 scrollTop
- 计算 DOM window
- 合并 message cache
- 读取 measured height

---

# 10. Synchronization Direction

正确方向：

```text
Main Data Service
-> Renderer Data Runtime
-> Viewport Runtime
-> React Projection
```

交互回流：

```text
User Event
-> React handler
-> @actions or runtime semantic command
```

禁止方向：

```text
React state
-> scroll recovery
```

```text
Data cache
-> spacer mutation
```

```text
Main process
-> viewport instruction
```

---

# 11. Feed Lifecycle

Feed 切换必须显式 teardown。

按层清理：

| Layer | Teardown |
| --- | --- |
| Main Message Data Service | cancel in-flight / release raw cache |
| Renderer Message Data Runtime | unsubscribe / clear DataWindow / bump reset revision |
| Renderer Viewport Runtime | reset AnchorState / BottomLockState / transactions / height cache |
| React Projection | unmount old projection |

禁止：

```text
旧 feed transaction 继续提交到新 feed
```

所有异步回包必须带：

```text
feedId + generation
```

generation 不匹配：

```text
discard
```

---

# 12. Error Boundary

Data 错误归 Data Runtime。

Viewport 错误归 Viewport Runtime。

React render 错误归 React Projection。

错误可以升级为：

```text
reset command
```

但不能跨层接管 ownership。

---

# 13. Ownership Rules

判断不清时使用以下规则：

| Question                         | Owner                 |
| -------------------------------- | --------------------- |
| 需要 SDK / Electron 能力？       | main                  |
| 需要缓存异步消息资源？           | renderer data runtime |
| 需要知道 DOM 高度？              | viewport runtime      |
| 需要写 scrollTop？               | viewport runtime      |
| 需要渲染消息内容？               | React projection      |
| 需要从按钮 / 菜单 / 快捷键触发？ | `@actions`            |

最终规则：

```text
数据可用性归 data runtime
```

```text
视口稳定性归 viewport runtime
```

```text
视觉表达归 React
```

```text
命令入口归 actions
```
