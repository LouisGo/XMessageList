# Projection Adapter 合同

## 1. Scope

本文定义 Flutter projection shell 如何连接 viewport runtime。

目标：

```text
Projection shell 负责视觉投影。
Viewport runtime 负责视口稳定。
```

Projection shell 不拥有滚动恢复、measurement state machine、window state machine。

## 2. Adapter Responsibilities

Projection shell 必须提供：

- 订阅 runtime snapshot。
- 根据 snapshot 渲染 materialized items。
- 渲染 before / after extent 占位。
- 渲染 edge loading / exhausted 状态。
- 渲染 bottom follow affordance。
- 将 bottom follow 点击转为 `followBottom` command。
- 注册 materialized row measurement handle。
- 在本轮 projection layout 完成后调用 `notifyProjectionCommitted`。
- 透传 `viewportAnchorChanged` 给 app 层做持久化策略。

Projection shell 不得：

- 自己计算 MaterializedWindow。
- 自己维护 before / after extent。
- 直接根据 scroll metrics 发起分页。
- 直接修正滚动 offset。
- 把 measured height 作为 UI state 驱动 recovery。
- 读取投影树结构来保存 anchor。

## 3. Snapshot Subscription

Projection shell 应把 runtime snapshot 当作单一外部状态源。

不要拆成多份不一致的 UI state：

```text
items state
beforeExtent state
afterExtent state
window state
```

原因是 `items + materializedWindow + beforeExtent + afterExtent` 必须来自同一个
runtime revision。拆开后容易出现 visible rows 与 extent 不匹配。

## 4. Row Registration

每个 materialized row 必须以 `MessageRuntimeItemKey` 注册给 runtime。

注册只做两件事：

- row materialized 时提供 measurement handle。
- row unmounted 时注销 handle。

注册过程禁止：

- 读取 row size 并写 UI state。
- dispatch runtime command。
- 修正滚动 offset。

Optimistic item rebind 后，projection key 必须遵守 runtime 发布的 identity remap
语义，避免把同一条本地消息表现为删除加插入。

## 5. Projection Commit Ack

`notifyProjectionCommitted` 表示：

```text
当前 runtime snapshot 对应的 projection 已完成本轮 layout，
runtime 可以读取本轮 materialized row 的测量结果。
```

这不是“收到 snapshot”或“完成 build”。Projection shell 只能在该 revision 的
materialized rows 已经进入本轮 layout、measurement handle 能返回有效 viewport
坐标和 size 后发送 ack。若当前 revision 尚未产生可测量 layout，必须延后 ack 或让
runtime 等待下一次 commit retry。

它不表示：

- 图片已经解码。
- 所有异步内容高度稳定。
- 用户没有继续滚动。
- 后续没有新的数据快照。

Commit 必须带：

```text
feedId + generation + revision
```

Runtime 必须丢弃 stale commit ack。

## 6. Event Flow

用户点击、手势、菜单：

```text
projection event
-> action boundary or runtime.dispatch(command)
-> runtime transaction
-> snapshot publish
```

滚动事件：

```text
platform scroll signal
-> runtime scroll handler
-> optional snapshot publish
-> optional viewportAnchorChanged event
```

Projection shell 不转发 raw scroll signal 给 data runtime，也不据此直接分页。
Projection shell 必须透传完整 `viewportAnchorChanged` event；feed 切换或卸载时
旧 runtime 的 `detach` checkpoint 需要带着原始 `feedId/generation` 回到 host，
不能被 active feed 状态重写。

## 7. Error Boundary

如果 projection render 抛错：

- projection error boundary 展示错误 UI。
- runtime 不尝试修复 render error。
- generation 不应被错误 UI 自动复用到新 feed。

如果 runtime transaction 抛错：

- runtime 发布 `viewportError`。
- projection 可以展示恢复按钮。
- 恢复按钮只发 `reset` 或 `bootstrap` semantic command。
