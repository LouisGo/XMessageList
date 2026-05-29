# Bottom Follow 与目的地规格

## D1 Follow Bottom 当前已是 latest

Trigger：用户点击 bottom-follow，且 `hasMoreAfter=false`。

Acceptance：

- 如果已经接近真实底部，列表进入追底状态。
- 如果尚未接近真实底部，列表移动到真实底部。
- 移动完成后，后续新消息保持追底。

User-visible result：

- 列表滚到真实最新消息。
- 后续新消息在 locked 状态下保持追底。

Forbidden：

- 不允许滚到空白区域，因为不存在 bottom spacer。

## D2 Follow Bottom 当前不是 latest

Trigger：用户点击 bottom-follow，且 `hasMoreAfter=true`。

Acceptance：

- 直接加载最新消息区域。
- pending 期间不通过普通 after 翻页逐页追底。
- 最新消息区域展示完成后，滚动到真实底部并进入追底状态。
- 如果最新消息区域加载失败，当前阅读位置保持不变，并展示可重试或错误状态。

User-visible result：

- 可以直接回到最新消息，不逐页补齐中间缺口。
- pending 期间用户向上滚动会取消 follow intent。

Forbidden：

- 不允许沿 after edge 连续请求直到 latest。

## D3 新消息 Append

Trigger：当前 segment 已是 latest，收到新消息。

Acceptance：

- 具体交互遵循 [实时事件交互规格](./live-events.md#l1-他人新消息到达用户处于追底) 和 [实时事件交互规格](./live-events.md#l2-他人新消息到达用户正在阅读历史)。

User-visible result：

- 追底时保持底部，非追底时保持当前阅读位置。

Forbidden：

- 不允许收到新消息后打断当前阅读或伪装成历史跳转。

## D4 任意位置发送消息

Trigger：用户在当前会话任意阅读位置发送消息。

Acceptance：

- 列表直接进入 latest 目标。
- 如果当前画面不是 latest，不能通过普通 after 翻页逐页追到 latest。
- 发送完成后，用户看到自己的消息和最新上下文。
- 如果发送前正在阅读历史、定位目标或等待边缘加载，发送行为优先于这些未完成状态。
- 发送后的稳定画面进入追底状态。

User-visible result：

- 发送后回到最新消息附近，并看到自己的消息和最新上下文。

Forbidden：

- 不允许发送后仍停留在历史阅读位置。
- 不允许通过连续 after paging 慢慢追到 latest。

## D5 Jump 到消息

Trigger：用户点击引用、搜索结果或外部定位。

Acceptance：

- 具体交互遵循 [目标消息定位规格](./destination-jumps.md)。

User-visible result：

- 目标消息进入可见区域。
- 远距离 jump 不经过虚假的全局 scroll range 动画。

Forbidden：

- 不允许把 jump 映射成百分比滚动。

## D6 Restore

Trigger：会话激活时存在已持久化阅读记忆。

Acceptance：

- 具体交互遵循 [会话激活与恢复规格](./activation-and-restore.md#a2-首次进入有阅读记忆) 和 [会话激活与恢复规格](./activation-and-restore.md#a3-阅读记忆目标不可用)。

User-visible result：

- 恢复到接近上次离开的阅读位置。

Forbidden：

- 不允许复用旧 `scrollTop` 作为跨 segment restore 依据。
