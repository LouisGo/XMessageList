# 滚动交互规格

## S1 普通滚动

Trigger：用户使用 wheel、touch、trackpad 或 native scrollbar 在 loaded segment 内滚动。

Preconditions：

- 消息列表已完成当前会话的首屏展示。
- 当前没有正在改变消息集合的 loading 或切换过程。

Acceptance：

- 内容必须直接跟随用户的 wheel、touch、trackpad 或 scrollbar 操作移动。
- 普通滚动期间，列表不能主动拉回、跳转或改写用户滚动方向。
- 当前可见阅读位置必须随用户滚动自然变化。

User-visible result：

- 内容跟随浏览器原生滚动。
- 滚动条比例只反映当前 loaded segment 的真实 DOM 高度。

Forbidden：

- 不允许用未加载消息估算高度改变 scroll range。
- 不允许把非用户操作或非用户惯性造成的位置变化当作普通分页触发。

## S2 短列表吸底

Trigger：当前 segment 总高度小于 viewport 高度。

Acceptance：

- latest / 追底状态下，短列表内容贴近底部。
- restore / jump 状态下，目标消息按目标位置展示，不能被强制贴底。
- 短列表不能出现为了制造滚动范围而加入的空白底部区域。
- 如果短列表仍有可加载历史，列表可以继续自动补足上下文，直到形成合理阅读区域或达到边界。

User-visible result：

- 最新消息贴近输入区或底部 marker。
- 如果后续消息增多超过 viewport，浏览器自然出现可滚动范围。

Forbidden：

- 不允许放一个 bottom spacer 来假装可以滚动。
- 不允许把所有短 segment 都强行吸底，尤其是 around restore / jump 目标。

## S3 动态高度增长

Trigger：图片 decode、markdown 渲染、代码块折行、AI streaming 或字体变化导致 row 高度改变。

Preconditions：

- 用户正在阅读的消息或其附近消息可见。

Acceptance：

- 当前阅读位置上方的内容变高或变矮时，用户正在看的消息应保持在原屏幕位置附近。
- 当前阅读消息自身变高或变矮时，用户正在看的相对段落位置应保持稳定。
- 当前阅读位置下方的内容变化时，用户正在看的消息不能被拉动。
- 滚动条比例可以随真实内容高度变化产生自然变化。

User-visible result：

- 用户正在读的消息不跳。
- 滚动条因真实 DOM 高度变化产生自然比例变化。

Forbidden：

- 不能把动态高度修正转成 segment reset。
- 不允许图片、代码块或 streaming 内容加载后造成当前阅读消息明显跳动。

## S4 惯性连续

Trigger：用户快速滚向 before / after edge，浏览器仍有 wheel / touch momentum。

Acceptance：

- 触边 loading 出现后，用户的惯性滚动不能被硬性中断。
- 当前 loading 未完成前，同一方向不能重复 loading。
- loading 完成后，如果浏览器惯性仍在继续，列表可以继续沿原方向滚动并再次抵达加载点。
- 每次加载完成后，当前阅读位置保持稳定。

User-visible result：

- 触边加载后内容扩展，thumb 自然离开边缘。
- 用户不用重新滚动也能继续沿惯性方向浏览。

Forbidden：

- 不允许在 edge pending 期间用自动反复滚动伪装成用户惯性。
- 不允许加载完成后为保持画面稳定产生的位置调整，立刻表现为下一页加载。

## S5 会话离开时的阅读位置

Trigger：用户离开当前会话、切换会话或关闭消息列表。

Acceptance：

- 离开前应记录当前稳定阅读位置。
- 记录目标必须能在下次进入时恢复到同一消息附近。
- 如果当前画面处于稳定状态，记录位置应来自当前可见阅读区域。
- 如果正在分页、修正、跳转或切换中，最终记录位置应来自完成后的稳定画面。

User-visible result：

- 用户切回会话时，能回到接近离开前的阅读位置。
- 用户不会因为离开时正在加载而丢失阅读上下文。

Forbidden：

- 不允许保存空白区域、loading slot 或不可恢复的瞬时位置作为阅读记忆。
- 不允许把旧会话的原始滚动距离作为另一个会话的初始位置。
