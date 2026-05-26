# Bottom Follow 与目的地规格

## D1 Follow Bottom 当前已是 latest

Trigger：用户点击 bottom-follow，且 `hasMoreAfter=false`。

Runtime behavior：

- 如果 bottom marker 已在阈值内，进入 LOCKED。
- 否则启动 bounded motion 到 native bottom。
- motion settle 后发 `viewportAnchorChanged(transaction-settle)`。

User-visible result：

- 列表滚到真实最新消息。
- 后续新消息在 locked 状态下保持追底。

Forbidden：

- 不允许滚到空白区域，因为不存在 bottom spacer。

## D2 Follow Bottom 当前不是 latest

Trigger：用户点击 bottom-follow，且 `hasMoreAfter=true`。

Runtime behavior：

- 发 `needLatestMessages(reason: 'bottom-follow')`。
- pending 期间禁用普通 after edge。
- data runtime 返回 `reset-latest` segment，且 `hasMoreAfter=false`。
- commit 后滚到底并进入 LOCKED；若返回仍是 partial segment，保持 UNLOCKED 并继续 pending/error 处理。

User-visible result：

- 可以直接回到最新消息，不逐页补齐中间缺口。
- pending 期间用户向上滚动会取消 follow intent。

Forbidden：

- 不允许沿 after edge 连续请求直到 latest。

## D3 新消息 Append

Trigger：当前 segment 已是 latest，收到新消息。

Runtime behavior：

- LOCKED：extend after 或 patch 后滚到底。
- UNLOCKED：保留 visual anchor，不自动追底。
- 如果新消息来自本地发送，可显式建立 follow intent。

User-visible result：

- 正在读旧消息时不会被拉走。
- 自己发送或主动 follow 时才追到底部。

Forbidden：

- 不允许只因为 DOM bottom 可见就认为 feed latest locked。

## D4 Jump 到消息

Trigger：用户点击引用、搜索结果或外部定位。

Runtime behavior：

- 若目标在当前 segment，执行 local align / bounded motion。
- 若目标不在当前 segment，发 `needMessagesAround(reason: 'jump')`。
- around segment commit 后对齐目标或 deleted fallback。

User-visible result：

- 目标消息进入可见区域。
- 远距离 jump 不经过虚假的全局 scroll range 动画。

Forbidden：

- 不允许把 jump 映射成百分比滚动。

## D5 Restore

Trigger：feed 激活时存在已持久化 identity anchor。

Runtime behavior：

- 请求 around segment。
- commit 后按 stored identity 解析 visual target。
- 如果目标删除，使用 data 层 fallback。

User-visible result：

- 恢复到接近上次离开的阅读位置。

Forbidden：

- 不允许复用旧 `scrollTop` 作为跨 segment restore 依据。
