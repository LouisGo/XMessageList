# Message Anchor 心智模型

## 1. Scope

本文档只定义：

```text
消息锚点的语义坐标系
```

不定义：

- 数据读取协议
- DOM Window
- scroll correction pipeline
- React projection
- legacy message list 迁移方案

这些分别属于其他文档。

---

# 2. Anchor Is Not Position

Anchor 不是：

```text
scrollTop
```

也不是：

```text
array index
```

更不是：

```text
global pixel offset
```

Anchor 是：

```text
消息流中的稳定语义坐标
```

原因：

- scrollTop 是 viewport 的物理结果
- index 会随 prepend / delete / retention 改变
- global offset 依赖全量精确测量

这些都不是 IM 场景里的稳定坐标。

---

# 3. Anchor Types

系统必须区分三类 anchor。

---

## 3.1 Message Identity Anchor

跨 main / renderer 数据层传递的 anchor。

```ts
type MessageIdentityAnchor = {
  messageId: string;
  position?: number;
};
```

语义：

```text
在某个 feed 内定位一条消息
```

feed 作用域由外层请求承载：

```ts
type FeedScopedAnchor = {
  feedId: string;
  anchor: MessageIdentityAnchor;
};
```

允许：

- Bridge request / response
- data runtime cache key
- latest / unread / restored / jump target
- nearest-neighbor fallback

禁止承载：

- offsetWithinMessage
- scrollTop
- measured height
- DOM index

---

## 3.2 Viewport Anchor

renderer viewport runtime 内部 anchor。

也就是 viewport runtime 的：

```text
AnchorState
```

```ts
type AnchorState = {
  messageId: string;
  offsetWithinMessage: number;
};
```

语义：

```text
当前视口顶部位于哪条消息的哪个局部偏移
```

它服务于：

- prepend recovery
- resize stabilization
- trim continuity
- history restore after mount

它不能作为 main 进程合同。

原因：

```text
offsetWithinMessage 依赖 DOM layout
```

main 进程没有 DOM，也不拥有 layout timing。

如果需要持久化恢复位置，也只能由 renderer 保存和解释。

Data Runtime 只消费其中的 identity 部分。

---

## 3.3 Bottom Anchor

BottomLocked 状态下：

```text
底部本身就是 anchor
```

它不是某条消息的 top offset。

因此：

- 新消息 append
- 图片高度增长
- reaction expand

都应该维持：

```text
distanceToBottom within bottom lock threshold
```

而不是维持某个 top ViewportAnchor。

Bottom Anchor 只属于：

```text
renderer viewport runtime
```

---

# 4. Coordinate Boundaries

| Coordinate | Owner | Scope | Cross Process | Pixel Based |
| --- | --- | --- | --- | --- |
| MessageIdentityAnchor | data runtime | feed data | yes | no |
| ViewportAnchor / AnchorState | viewport runtime | renderer restore | no | local offset |
| BottomAnchor | viewport runtime | runtime state | no | threshold only |
| scrollTop | browser result | physical viewport | no | yes |

规则：

```text
跨层传递 identity anchor
```

```text
视口稳定使用 viewport anchor
```

```text
底部连续使用 bottom anchor
```

不要混用。

---

# 5. Position Semantics

`position` 是：

```text
消息身份的排序辅助信息
```

用于：

- SDK around query
- anchor disambiguation
- nearest-neighbor fallback
- retention 后的邻近恢复

它不是：

```text
render index
```

也不是：

```text
message top offset
```

当 `messageId` 和 `position` 不一致时：

```text
messageId 优先表达身份
```

```text
position 用于判断邻近关系和异常
```

---

# 6. Runtime Item Identity

MessageIdentityAnchor 只表达：

```text
已提交消息的身份
```

但 IM 数据流还存在：

```text
optimistic message
```

例如：

- sending
- failed
- server identity not returned yet

因此 renderer projection 需要独立 item key。

推荐模型：

```ts
type MessageRuntimeItemKey =
  | { kind: 'committed'; messageId: string }
  | { kind: 'optimistic'; clientMessageId: string };
```

规则：

```text
MessageIdentityAnchor 用于跨层定位
```

```text
MessageRuntimeItemKey 用于 renderer 内部投影
```

不要混用。

---

## 6.1 Optimistic Identity

Optimistic item 允许出现在：

- DataWindow
- RenderWindow
- React projection

但禁止作为：

- Bridge around anchor
- latest anchor
- restored anchor
- cross-process restore contract

原因：

```text
server message identity 尚未稳定
```

---

## 6.2 Identity Rebinding

当 optimistic message 变成 committed message，系统必须执行：

```text
identity rebind
```

而不是：

```text
delete optimistic + insert committed
```

语义：

```ts
type IdentityRebind = {
  from: { kind: 'optimistic'; clientMessageId: string };
  to: { kind: 'committed'; messageId: string };
};
```

rebind 后：

- selection identity 迁移
- height cache 可以迁移
- React projection key 应稳定过渡
- 如果 runtime 内部 anchor 指向该 item，必须重绑定 anchor

---

## 6.3 Anchor Eligibility

只有 committed item 可以成为：

```text
MessageIdentityAnchor
```

Optimistic item 可以成为：

```text
temporary viewport item
```

但不能成为：

```text
durable navigation anchor
```

---

# 7. Anchor Lifecycle

---

## 7.1 Bootstrap

首次进入会话时没有 ViewportAnchor / AnchorState。

入口只能先产生：

```text
MessageIdentityAnchor target
```

例如：

- Latest
- Unread
- Restored

等 DOM mount、layout、measurement 完成后，viewport runtime 才能 capture：

```text
ViewportAnchor / AnchorState
```

或进入：

```text
BottomLocked
```

---

## 7.2 Jump

历史跳转输入是：

```text
MessageIdentityAnchor
```

流程是：

```text
identity target
-> data window
-> mount target window
-> scroll semantic operation
-> capture viewport anchor
```

禁止：

```text
identity target -> scrollTop
```

因为中间缺少 DOM layout。

---

## 7.3 Prepend

prepend 之前 capture：

```text
ViewportAnchor / AnchorState
```

数据请求使用：

```text
edge MessageIdentityAnchor
```

如果窗口边缘是 optimistic item，必须向内寻找最近的 committed edge anchor。

prepend 之后恢复：

```text
same ViewportAnchor / AnchorState visual position
```

这两个 anchor 属于不同层。

---

## 7.4 Dynamic Height

Anchored 模式：

```text
mutation above ViewportAnchor / AnchorState
-> scrollTop += deltaHeight
```

BottomLocked 模式：

```text
any bottom-affecting mutation
-> coalesced scrollToBottom()
```

这两个模式不能合并。

---

# 8. Fallback Semantics

Anchor message 可能不存在。

原因：

- deleted
- retention
- local cache missing
- SDK partial response

允许：

```text
nearest-neighbor fallback
```

不允许：

```text
exact message existence required
```

fallback 之后必须显式表达：

```text
anchorStatus
```

例如：

| Status  | Meaning                              |
| ------- | ------------------------------------ |
| normal  | 命中请求 anchor                      |
| deleted | 原 anchor 不可投影，但可恢复邻近位置 |

---

# 9. Non-goals

本文件不追求：

- 全局消息坐标
- 精确 cumulative offsets
- index-based restore
- DOM measurement contract
- React state anchor ownership

核心原则：

```text
Message identity 是跨层坐标
```

```text
Viewport offset 是 runtime 内部坐标
```

```text
scrollTop 永远只是结果
```
