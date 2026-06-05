# 分页加载规格

## Edge Activation Margin

加载点只表示“接近可加载边缘”，不能直接等同于可以立即重复请求。

默认 edge activation margin：

```text
edgeActivationMarginPx = clamp(clientHeight * 0.25, 64, 240)
underflowTolerancePx = 2
```

Acceptance：

- `scrollHeight <= clientHeight + underflowTolerancePx` 时视为短 segment underflow。
- before 和 after 加载点同时可见时，不能同时加载两侧。
- 加载提前量只能提前暴露 loading 时机，不能造成重复 loading。
- 同一边缘、同一稳定画面最多出现一次未完成 loading。

## P0 Segment Underflow Auto-fill

Trigger：首次进入、恢复、回到底部、裁剪或尺寸变化完成后，当前已加载消息不足一屏，且至少一侧仍可加载。

Preconditions：

- 列表已完成当前会话展示。
- 当前没有正在改变消息集合的 loading。
- `scrollHeight <= clientHeight + underflowTolerancePx`，或 before / after 加载点在同一稳定画面内同时可见。
- 上方或下方仍有更多消息。

Acceptance：

- 暂停普通 before / after 触边 loading，直到短列表补齐完成。
- 每一轮只允许选择一侧补齐。
- latest / 追底意图下：只允许向上补更旧消息。
- 如果用户意图是回到最新但当前短列表不包含最新消息，应先展示 latest，而不是把当前短列表当作普通 after 补齐。
- restore / jump：优先补目标消息保护区较薄的一侧；并列时使用目标方向；仍并列时选 before。
- 普通中间态：从当前阅读位置两侧交替补齐，但一轮只请求一侧。
- 每次补齐完成且画面稳定后，才能重新判断是否继续补齐。

Settle conditions：

- `scrollHeight > clientHeight + edgeActivationMarginPx`。
- 当前可请求边都已到达边界。
- 用户主动滚动或切换目标位置，使补齐状态取消。

Forbidden：

- 不允许 before / after 在同一稳定画面内同时请求。
- 不允许靠模拟滚动触发短列表补齐。
- 不允许用 spacer 或 placeholder 撑出滚动范围。

## P1 Before Trigger

Trigger：顶部加载点进入可触发范围。

Preconditions：

- `hasMoreBefore=true`。
- 列表处于稳定可滚动状态。
- 滚动来自用户操作或用户操作后的惯性。
- 顶部边缘当前没有未完成 loading。

Acceptance：

- 顶部出现 before loading 状态。
- 请求更旧消息。
- 更旧消息到达后插入当前消息上方。

User-visible result：

- 顶部 loading 可出现但不能挤压当前阅读位置。
- 新旧消息接在一起。
- 用户原本看到的消息保持在同一屏幕位置。
- 原生 thumb 从顶部自然回落。
- 如果用户继续向上滚动，加载完成并稳定后可以继续触发下一页。

Forbidden：

- 不允许因为保持画面稳定产生的位置调整或非用户动作造成的滚动产生 before paging。
- 不允许用 top spacer 扩大顶部可滚动区域。
- 不允许 loading slot 造成当前阅读消息被推离原位置。

## P2 After Trigger

Trigger：底部加载点进入可触发范围。

Preconditions：

- `hasMoreAfter=true`。
- 没有正在进行的回到最新消息意图。
- 列表处于稳定可滚动状态。
- 滚动来自用户操作或用户操作后的惯性。

Acceptance：

- 底部出现 after loading 状态。
- 请求更新方向的消息。
- 新消息到达后插入当前消息下方。

User-visible result：

- 用户向下浏览时可以逐批看到更新消息。
- 如果不是 latest，bottom follow UI 仍可表示“还有更新”。
- thumb 因真实 DOM 增长自然离开底部。
- 如果用户继续向下滚动，加载完成并稳定后可以继续触发下一页。

Forbidden：

- 不允许把 after edge 当作 session latest bottom。
- 不允许 pending follow bottom 期间发普通 after paging。

## P3 Edge Loading 去重

Trigger：同一边缘在请求未完成或用户停留边缘时反复进入可触发范围。

Acceptance：

- 同一边缘在当前 loading 未完成前最多出现一次 loading。
- 用户一直停留在边缘时，不能持续刷新 loading 或重复请求。
- 用户明确离开边缘并再次进入，或当前 loading 完成且画面稳定后，才允许再次触发。

User-visible result：

- 网络慢时不会连发同一页请求。
- 用户停在边缘不会造成加载风暴。

Forbidden：

- 不允许用户持续停留边缘时按固定时间间隔反复进入 loading。

## P4 Paging Error

Trigger：before / after 请求失败。

Acceptance：

- 对应边缘显示 error 或 retry 状态。
- 当前消息画面保持不变。
- 阅读位置保持不变。
- 用户再次离开并进入边缘，或点击 retry，才会重试。

User-visible result：

- 阅读位置保持。
- 可以看到边缘错误或重试 affordance。

Forbidden：

- 不允许失败后 reset 到 latest。
- 不允许吞掉错误让 edge 永久 loading。

## P5 Segment Budget Trim

Trigger：segment item count、DOM cost 或 memory 超过预算。

Acceptance：

- 超过预算时，可以裁剪远离当前阅读位置的一侧。
- 正在向上连续加载时，优先裁剪底部远离阅读位置的内容。
- 正在向下连续加载时，优先裁剪顶部远离阅读位置的内容。
- 裁剪完成后，当前可见阅读位置保持稳定。

User-visible result：

- 当前阅读位置不变。
- scroll range 变短是允许的，但不能让用户看到跳动。
- 用户连续向上加载时，底部远离阅读位置的数据可以消失，但当前画面保持稳定。
- 用户连续向下加载时，顶部远离阅读位置的数据可以消失，但当前画面保持稳定。

Forbidden：

- 不允许通过 spacer 保留被 trim 区域的估算高度。
- 不允许裁掉当前可见阅读位置附近的消息导致视图跳变。

## P6 连续边缘加载

Trigger：用户持续向同一方向滚动，多次抵达 before 或 after 加载点。

Acceptance：

- 每次触边最多产生一个对应方向 loading。
- 当前 loading 未完成前，同一方向不能重复进入 loading。
- 当前 loading 完成、列表稳定、用户继续沿同一方向滚动后，可以触发下一次 loading。
- 每次加载完成后，当前可见阅读位置保持稳定。
- 滚动条随真实内容高度变化自然回落，不停留在边缘等待下一页。

User-visible result：

- 用户可以连续向上或向下浏览历史，过程连贯。
- 网络请求慢时，列表不抖动、不连发、不阻塞普通滚动。

Forbidden：

- 不允许把连续滚动解释成未完成 loading 期间的多次边缘命中。
- 不允许同一页 loading 还未完成就连续发出多次同方向请求。
- 不允许为了避免重复请求而吞掉用户滚动输入。
