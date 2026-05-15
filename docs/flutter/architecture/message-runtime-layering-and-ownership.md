# Message Runtime 分层与职责归属

## 1. Layer Model

Flutter 消息运行时分为五层：

```text
App Session Host
  -> SDK Adapter
  -> Message Data Runtime
  -> Message Viewport Runtime
  -> Flutter Projection Shell
```

旁路入口：

```text
User Action Boundary
```

它只表达用户命令，不拥有数据或视口。

## 2. Ownership Table

| Capability | Owner |
| --- | --- |
| SDK call | SDK Adapter |
| latest messages request | Message Data Runtime |
| around messages request | Message Data Runtime |
| message cache / merge | Message Data Runtime |
| DataWindow | Message Data Runtime |
| MaterializedWindow | Message Viewport Runtime |
| AnchorState | Message Viewport Runtime |
| BottomLockState | Message Viewport Runtime |
| before / after extent | Message Viewport Runtime |
| row measurement | Message Viewport Runtime |
| scroll offset writes | Message Viewport Runtime |
| active feed selection | App Session Host |
| runtime cache policy | App Session Host |
| message row rendering | Flutter Projection Shell |
| toolbar / menu command | User Action Boundary |

## 3. App Session Host

Session host 负责 app policy：

- 当前 active feed。
- feed scoped data runtime / viewport runtime cache。
- runtime cache capacity。
- feed switching staged activation。
- 页面最终销毁。

允许：

- 按 `feedId` 创建或复用 runtime。
- 切走 feed 时 detach projection，保留该 feed 的本地 session state。
- cache miss 切 feed 时先准备目标数据窗口，再切换 active projection。
- LRU 淘汰或关闭会话时 destroy runtime。

禁止：

- 计算 MaterializedWindow。
- 监听平台滚动事件代替 runtime edge event。
- 读取投影层结构来持久化 anchor。
- 把 app cache policy 下沉到 viewport runtime core。

## 4. SDK Adapter

SDK adapter 负责把 native SDK 形状转成稳定合同：

- 调用 `getLatestMessages`。
- 调用 `getMessagesAround`。
- 归一化错误。
- 校验消息顺序和必需字段。
- 处理 SDK payload 兼容性。

禁止：

- 判断 bottom lock。
- 计算 materialized rows。
- 估算 extent。
- 存储 `AnchorState`。
- 感知 projection lifecycle。

## 5. Message Data Runtime

Data runtime 负责：

- 请求 latest / around / before / after 数据。
- 合并增量事件。
- 维护 feed scoped DataWindow。
- 处理 optimistic rebind。
- 发布 `MessageDataSnapshot`。

禁止：

- 写 scroll offset。
- capture `AnchorState`。
- 根据 row size 修正数据窗口。
- 用 projection state 驱动 viewport recovery。

## 6. Message Viewport Runtime

Viewport runtime 负责维持用户正在观察的消息视口。

允许：

- 计算 MaterializedWindow。
- 维护 before / after extent。
- capture `AnchorState`。
- 分类 scroll intent。
- 维护 `BottomLockState`。
- 处理 row measurement delta。
- 执行 anchor correction。
- 发出数据需求事件。

禁止：

- 直接调用 SDK。
- 解释业务权限。
- 长期持有完整业务消息缓存。
- 渲染具体 message content。

## 7. Flutter Projection Shell

Projection shell 负责把 runtime snapshot 投影为可见 UI。

允许：

- render message row。
- render unread divider。
- render edge loading / exhausted indicator。
- render bottom follow affordance。
- 将按钮、手势和菜单转为 semantic command。
- 回传 layout committed ack。
- 回传 materialized row measurement handle。
- 处理 selection、context menu 等局部交互。

禁止：

- 拥有 MaterializedWindow 状态机。
- 自己维护 before / after extent。
- 直接根据滚动 offset 触发分页。
- 自己修正滚动 offset。
- 把 measured height 放进 UI state 后再驱动 recovery。
- query projection structure 来持久化 anchor。

## 8. User Action Boundary

用户命令入口包括：

- jump to message。
- quote locate。
- search locate。
- unread locate。
- follow bottom。
- restore session position。

Action 输出 semantic command：

```text
MessageRuntimeCommand =
  bootstrap(latest/unread/restored)
  jump(target MessageIdentityAnchor)
  restore(target AnchorState or MessageIdentityAnchor)
  followBottom
  reset(reason)
```

`restore(AnchorState)` 只适用于同一个 live runtime generation。跨重启、LRU 淘汰或
generation reset 后，action 只能提交 persisted identity anchor；data runtime 先
通过 `getMessagesAround` 重建窗口，viewport runtime 再在 layout 后解释 offset。

Action 禁止：

- 直接操作滚动 offset。
- 计算 MaterializedWindow。
- 合并 message cache。
- 读取 measured height。

## 9. Synchronization Direction

正确方向：

```text
SDK Adapter
-> Message Data Runtime
-> Message Viewport Runtime
-> Flutter Projection Shell
```

交互回流：

```text
User gesture
-> Projection Shell
-> User Action Boundary or runtime semantic command
```

禁止方向：

```text
Projection state -> scroll recovery
Data cache -> extent mutation
SDK Adapter -> viewport instruction
```

## 10. Final Rule

```text
数据可用性归 data runtime。
视口稳定性归 viewport runtime。
视觉表达归 projection shell。
命令入口归 action boundary。
会话生命周期归 session host。
```
