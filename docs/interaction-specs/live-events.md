# 实时事件交互规格

本文件描述会话已经展示后，服务端推送、消息编辑、reaction、删除、批量变更和 event storm 到达时，消息列表必须满足的交互验收结果。

## L1 他人新消息到达，用户处于追底

Trigger：当前会话收到他人新消息，且用户正在最新消息底部区域。

Acceptance：

- 接入方通过 `session.incoming.append` 发布新消息，而不是普通 `rows.patch`。
- 新消息追加到 latest 列表底部。
- append 的 follow/preserve 决策可由接入方基于 `distanceToBottom`、
  `pageFocused`、未读策略等上下文给出；决定 follow 时应保留 bottom motion。
- 列表保持在真实底部。
- 如果连续收到多条消息，底部位置保持稳定跟随。
- 新消息插入不能造成底部空白、抖动或先离底再回底。

User-visible result：

- 用户持续看到最新消息。
- 消息像正常聊天一样从底部连续出现。

Forbidden：

- 不允许收到他人新消息后把用户拉到历史位置。
- 不允许出现一帧历史内容或空白再回到底部。

## L2 他人新消息到达，用户正在阅读历史

Trigger：当前会话收到他人新消息，且用户未处于追底状态。

Acceptance：

- 当前阅读位置保持稳定。
- 新消息不能强制把列表滚到底部。
- 可以更新“回到最新消息”或未读提示。
- 如果当前已加载消息段不是 latest，新消息不应被强行插入当前历史段造成上下文断裂。
- 如果策略因距离过大、页面失焦或业务未读策略选择 preserve，即便此前处于
  bottom lock，也要脱离 lock 并保留当前位置。

User-visible result：

- 用户继续阅读当前位置。
- 用户知道有新消息，但不会被打断。

Forbidden：

- 不允许非本人新消息打断历史阅读。
- 不允许为了显示新消息而重置当前会话到 latest。
- 不允许把最新消息插入到不连续的历史上下文里。

## L3 本人发送消息

Trigger：用户在当前会话发送消息。

Acceptance：

- 具体交互以 [D4 任意位置发送消息](./bottom-follow-and-destination.md#d4-任意位置发送消息) 为准。
- Composer / 业务发送逻辑通过 `session.outgoing.stage` 发布 optimistic row；
  send 请求、失败原因、重试队列和业务状态字段仍由接入方维护。
- retry 若作为重新发送处理，应先原地展示 retrying/loading，异步成功后再发布新的
  outgoing row，并用 `retireKeys` 原子移除旧占位；默认按 send 语义进入
  follow-bottom。
- retry 成功如果使用 `outgoing.stage({ rows, latest, retireKeys })`，`latest`
  是业务方提供的完整 latest window，组件库只做本地 rebuild 和 follow-bottom
  继承；旧 failed/retrying row 必须在 rebuild 中被 `retireKeys` 原子移除，不能
  再额外请求 latest 后二次合并。
- 当前 latest 下 retry 成功只允许 append follow 启动一次 bottom motion；`scrollToLatest`
  只负责打开/确认 follow-bottom intent，不能在已经位于 bottom target 时先播放一次
  本地 bottom motion 再被 append follow 打断。异步失败则回到 failed，不抢滚动。
- retry 点击后的 retrying/loading 属于旧 row 的状态 patch，只保持当前位置或当前
  bottom lock，不允许继承 send/append 的 after 语义 motion；只有异步成功后的新
  outgoing row append 才进入 send-style motion。

User-visible result：

- 无论发送前在什么阅读位置，发送后都会回到底部附近。

Forbidden：

- 不允许本人发送后仍停留在历史阅读位置。
- 不允许通过逐页 after loading 慢慢追到 latest。

## L4 Bot Push / 连续服务端追加

Trigger：Bot、系统服务或服务端连续推送多条新消息。

Acceptance：

- 用户处于追底时，多条消息连续追加并保持底部稳定。
- 用户不处于追底时，当前阅读位置保持稳定。
- 用户显式点击 bottom 后，本次 follow-bottom intent 优先级高于此前或并发计算出的
  `append(preserve)`；pending preserve append 不能把 bottom 点击覆盖掉。
- Bot push 属于 receive append；纯尾部新消息使用 `incoming.append`，混合
  edit/reaction/delete/read/media loaded 等 passive update 事件优先归一化为
  `rows.mutate({ patches, removeKeys, invalidateKeys, reason })`；需要重建整个
  loaded window 时才使用 `rows.replace`。
- 多条 push 可以合并呈现，但最终消息顺序必须正确。
- push 期间不能出现消息重复、临时乱序、先显示后撤回式闪烁。

User-visible result：

- 追底时，Bot 或服务端消息自然连续出现。
- 阅读历史时，push 不打断当前阅读。

Forbidden：

- 不允许每条 push 都造成一次可见滚动跳动。
- 不允许 push storm 让列表在底部和历史位置之间来回切换。

## L5 Emoji Reaction 更新

Trigger：当前会话内某条消息的 emoji reaction 增加、取消或计数变化。

Acceptance：

- 如果 reaction 所属消息可见，reaction 区域就地更新。
- 如果 reaction 所属消息不可见，当前画面不应发生可见跳动。
- reaction 更新导致行高变化时，当前阅读位置保持稳定。
- 多个 reaction 连续变化时，可以合并成稳定结果展示。

User-visible result：

- 用户看到 reaction 状态变化，但不会因此丢失阅读位置。

Forbidden：

- 不允许 reaction 更新触发整段消息列表重置。
- 不允许 reaction 更新让当前阅读消息跳动。
- 不允许不可见消息的 reaction 更新造成当前画面闪烁。

## L6 消息编辑

Trigger：当前会话内某条消息被编辑。

Acceptance：

- 如果被编辑消息可见，文本、附件状态或 edited 标识就地更新。
- 如果编辑导致消息高度变化，当前阅读位置保持稳定。
- 如果被编辑消息不可见，当前画面不应发生可见跳动。
- 编辑事件不能改变消息在会话中的相对顺序。

User-visible result：

- 用户看到该消息内容被更新。
- 用户不会因为编辑事件被拉到底部或跳到该消息。

Forbidden：

- 不允许编辑事件触发 latest reset。
- 不允许把编辑事件表现成删除再插入造成闪烁。
- 不允许不可见消息编辑打断当前阅读。

## L7 Streaming / 渐进式内容更新

Trigger：Bot 回复、AI streaming、长消息渲染或附件状态持续更新同一条消息。

Acceptance：

- 用户处于追底时，streaming 内容增长后列表保持跟随底部。
- 用户正在阅读该 streaming 消息时，阅读的相对段落位置保持稳定。
- 用户阅读位置在 streaming 消息上方时，当前画面不应被拉动。
- 用户阅读位置在 streaming 消息下方时，增长造成的高度变化不应让当前阅读消息跳动。

User-visible result：

- streaming 内容像同一条消息持续增长，而不是列表反复重置。

Forbidden：

- 不允许每个 streaming token 都造成明显滚动抖动。
- 不允许把 streaming 更新表现成多条重复消息闪烁。

## L8 可见区域内单条消息删除

Trigger：当前可见区域内的一条消息被删除、撤回或变为不可访问。

Acceptance：

- 被删除消息消失或变成明确的占位 / fallback 行。
- 删除后，当前阅读位置附近的上下文保持稳定。
- 如果被删除消息不是当前阅读目标，当前阅读消息不能明显跳动。
- 如果被删除消息正是当前阅读目标，列表应稳定落到相邻的确定消息或 fallback 行。
- 删除不能把列表自动带到底部。

User-visible result：

- 用户看到该消息被删除或不可访问。
- 周围消息自然靠拢，当前阅读上下文不丢失。

Forbidden：

- 不允许删除可见消息后出现空洞、白屏或整段重载闪烁。
- 不允许删除中间消息导致列表跳到底部。
- 不允许目标消息删除后在相邻消息之间来回跳。

## L9 当前不可见但已加载区域内消息删除

Trigger：当前已加载消息段中、但不在可见区域内的消息被删除。

Acceptance：

- 当前可见阅读位置保持稳定。
- 如果删除发生在当前阅读位置上方，列表应吸收高度变化，避免当前阅读消息被拉动。
- 如果删除发生在当前阅读位置下方，当前画面不应发生可见跳动。
- 滚动条比例可以随真实内容高度变化自然变化。

User-visible result：

- 用户大多不会感知不可见消息删除。
- 滚动条可能出现细微、真实的比例变化。

Forbidden：

- 不允许不可见消息删除导致当前阅读位置明显跳动。
- 不允许用空白占位维持被删除内容的估算高度，除非该占位是产品明确可见的 deleted placeholder。

## L10 未加载区域内消息删除

Trigger：当前未加载历史或未加载最新区域内的消息被删除。

Acceptance：

- 当前画面不发生可见变化。
- 当前滚动位置不变化。
- 后续用户加载到该区域时，不应看到已删除消息作为正常消息出现。
- 如果删除影响未读数、最新提示或会话摘要，可以更新这些外围状态，但不能移动列表。

User-visible result：

- 用户当前阅读不受影响。
- 将来进入相关区域时，看到的是删除后的正确上下文。

Forbidden：

- 不允许未加载区域删除事件触发当前列表重置。
- 不允许为了处理未加载删除而改变当前 scroll range。

## L11 批量删除，包含非连续消息

Trigger：当前会话发生批量删除，删除目标可能是非连续、多选、随机分布的消息。

Acceptance：

- 所有被删除消息最终都应消失或变成明确的占位 / fallback 行。
- 当前阅读位置保持稳定。
- 可见区域内的多处删除可以合并成一次稳定画面变化。
- 可见区域外的删除不能造成当前画面明显跳动。
- 删除集合中如果包含当前阅读目标，应稳定落到相邻的确定消息或 fallback 行。

User-visible result：

- 用户看到一组消息被删除后的稳定结果。
- 列表不会因多处删除而多次抖动。

Forbidden：

- 不允许非连续删除按每条消息逐帧播放导致列表连续跳动。
- 不允许部分删除成功、部分旧消息短暂复活造成闪烁。
- 不允许批量删除后把用户带到底部或切换会话。

## L12 混合事件风暴

Trigger：短时间内连续收到 append、edit、reaction、delete、identity remap、Bot push 等混合事件。

Acceptance：

- 最终画面必须与事件顺序和服务端最终状态一致。
- 当前阅读位置保持稳定，除非用户本人发送消息或主动回到最新消息。
- 可见区域内事件可以合并呈现，但不能出现可见乱序、重复、短暂复活或空白。
- 不可见区域事件不能打断当前阅读。
- 事件风暴期间，滚动条只随真实内容高度变化自然变化。

User-visible result：

- 用户看到稳定收敛后的消息列表。
- 高频事件不会让列表闪烁、抖动或来回跳转。

Forbidden：

- 不允许 event storm 触发加载风暴、重置风暴或滚动风暴。
- 不允许同一消息在编辑、删除、reaction 之间反复闪现不同旧状态。
- 不允许为了处理事件风暴而冻结用户滚动、吞掉用户拖拽或隐藏滚动条。
