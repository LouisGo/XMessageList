# 分页加载规格

## Edge Activation Margin

所有 trigger 观察必须先进入 runtime arbiter，不能由 IntersectionObserver callback 直接发请求。

默认 edge activation margin：

```text
edgeActivationMarginPx = clamp(clientHeight * 0.25, 64, 240)
underflowTolerancePx = 2
```

规则：

- `scrollHeight <= clientHeight + underflowTolerancePx` 时视为短 segment underflow。
- before 和 after trigger 同时 intersect 时，不能同时发两个 edge need。
- root margin 只能扩大“观察”，不能绕过 generation、revision、source、pending intent 和 edge latch。
- 每个 need event 必须带 feedId、generation、segmentRevision、edge、reason、requestToken。

## P0 Segment Underflow Auto-fill

Trigger：bootstrap、reset-around、reset-latest、trim 或 resize settle 后，当前 segment 不足一屏，且至少一侧仍可加载。

Preconditions：

- runtime READY + IDLE。
- 无 active transaction。
- `scrollHeight <= clientHeight + underflowTolerancePx`，或 before / after trigger 在同一 revision 内同时 intersect。
- `hasMoreBefore=true` 或 `hasMoreAfter=true`。

Runtime behavior：

- 进入 `pendingIntent='underflow-fill'`。
- 暂停普通 before / after edge need，直到 underflow fill settle。
- 每个 segmentRevision 只选择一个 edge 发请求，并 latch 对应 requestToken。
- latest bootstrap / locked bottom / follow bottom：只允许请求 before；如果 `hasMoreAfter=true`，先走 latest reset，不做普通 after fill。
- around restore / jump：优先补 anchor 保护区较薄的一侧；并列时使用 destination direction；仍并列时选 before。
- 普通中间态：从 anchor 两侧交替补齐，但一轮只请求一侧。
- 每次 data runtime 返回 next segment 并完成 correction settle 后，再重新评估 underflow。

Settle conditions：

- `scrollHeight > clientHeight + edgeActivationMarginPx`。
- 当前可请求边都 exhausted。
- 用户主动滚动或切换 destination，使 pending intent 被取消。

Forbidden：

- 不允许 before / after 在同一 revision 同时请求。
- 不允许靠 synthetic scroll event 触发 underflow fill。
- 不允许用 spacer 或 placeholder 撑出滚动范围。

## P1 Before Trigger

Trigger：`before-trigger` 进入 scroll container root margin。

Preconditions：

- `hasMoreBefore=true`。
- runtime READY + IDLE。
- scroll source 是 user 或 momentum。
- before edge 当前未 latch。

Runtime behavior：

- 发出 `needMoreBefore({ reason: 'near-before' })`。
- 设置 before edge loading/latch。
- host/data 请求更旧消息。
- data 返回后执行 `extend-before` transaction。

User-visible result：

- 顶部 loading 可出现但不能挤压 anchor。
- 新旧消息接在一起。
- 用户原本看到的消息保持在同一屏幕位置。
- 原生 thumb 从顶部自然回落。

Forbidden：

- 不允许因为 recovery/programmatic scroll 触发 before paging。
- 不允许用 top spacer 扩大顶部可滚动区域。

## P2 After Trigger

Trigger：`after-trigger` 进入 scroll container root margin。

Preconditions：

- `hasMoreAfter=true`。
- 无 pending follow bottom。
- runtime READY + IDLE。
- scroll source 是 user 或 momentum。

Runtime behavior：

- 发出 `needMoreAfter({ reason: 'near-after' })`。
- 设置 after edge loading/latch。
- host/data 请求更新消息。
- data 返回后执行 `extend-after` transaction。

User-visible result：

- 用户向下浏览时可以逐批看到更新消息。
- 如果不是 latest，bottom follow UI 仍可表示“还有更新”。
- thumb 因真实 DOM 增长自然离开底部。

Forbidden：

- 不允许把 after edge 当作 feed latest bottom。
- 不允许 pending follow bottom 期间发普通 after paging。

## P3 Edge Latch

Trigger：同一 edge 在请求未完成或用户停留边缘时反复 intersect。

Runtime behavior：

- 同一 segment revision 对同一 edge 最多发一次 need。
- 用户明确离开 release threshold 后才能释放 latch。
- 对应 transaction settle 后按新 revision 重新允许触发。

User-visible result：

- 网络慢时不会连发同一页请求。
- 用户停在边缘不会造成加载风暴。

Forbidden：

- 不允许用 debounce 代替 revision latch。debounce 只能减少噪声，不能定义正确性。

## P4 Paging Error

Trigger：before / after 请求失败。

Runtime behavior：

- edge state 进入 error。
- 不改变当前 segment。
- 不写 `scrollTop`。
- 用户再次离开再进入 edge，或点击 retry slot，才能重试。

User-visible result：

- 阅读位置保持。
- 可以看到边缘错误或重试 affordance。

Forbidden：

- 不允许失败后 reset 到 latest。
- 不允许吞掉错误让 edge 永久 loading。

## P5 Segment Budget Trim

Trigger：segment item count、DOM cost 或 memory 超过预算。

Runtime behavior：

- viewport runtime 上报 trim pressure 和当前 visual anchor 保护区。
- data runtime 选择远离 visual anchor 的一侧，发布 trim 后的 next segment。
- viewport runtime trim 前捕获 visual anchor，commit 后 measurement + correction。
- data runtime 更新 `hasMoreBefore/After` 与已知边界，不伪造缺口。

User-visible result：

- 当前阅读位置不变。
- scroll range 变短是允许的，但不能让用户看到跳动。

Forbidden：

- 不允许通过 spacer 保留被 trim 区域的估算高度。
