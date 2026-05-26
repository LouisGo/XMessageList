# 滚动交互规格

## S1 普通滚动

Trigger：用户使用 wheel、touch、trackpad 或 native scrollbar 在 loaded segment 内滚动。

Preconditions：

- runtime lifecycle 为 READY。
- 无 active segment transaction。
- 当前 DOM rows 与 snapshot revision 已 commit。

Runtime behavior：

- 读取 native `scrollTop/clientHeight/scrollHeight`。
- 更新 scroll direction、activity、visible range 和 visual anchor。
- 只在 rAF 中合并 observation，不在每个 scroll event 发布 React snapshot。
- 不写 `scrollTop`。

User-visible result：

- 内容跟随浏览器原生滚动。
- 滚动条比例只反映当前 loaded segment 的真实 DOM 高度。

Forbidden：

- 不允许用未加载消息估算高度改变 scroll range。
- 不允许 React 层监听 raw scroll 后自行触发分页。

## S2 短列表吸底

Trigger：当前 segment 总高度小于 viewport 高度。

Runtime behavior：

- DOM container 仍是正常滚动容器。
- message container 使用 snapshot 的 `shortSegmentAlignment` 决定短内容布局：latest / locked bottom 用 `end`，around restore / jump 可用 `center` 或 `start`。
- `scrollHeight` 不通过 bottom placeholder 扩大。
- 如果短 segment 仍有可加载边，进入 paging 的 underflow auto-fill，而不是等待用户制造不存在的 scroll range。

User-visible result：

- 最新消息贴近输入区或底部 marker。
- 如果后续消息增多超过 viewport，浏览器自然出现可滚动范围。

Forbidden：

- 不允许放一个 bottom spacer 来假装可以滚动。
- 不允许把所有短 segment 都强行吸底，尤其是 around restore / jump 目标。

## S3 动态高度增长

Trigger：图片 decode、markdown 渲染、代码块折行、AI streaming 或字体变化导致 row 高度改变。

Preconditions：

- runtime 能判断 dirty row 位于 visual anchor 上方、内部或下方。

Runtime behavior：

- ResizeObserver 只记录 dirty signal。
- 稳定 rAF 中读取 affected rect。
- 如果变化发生在 visual anchor 上方，写 `scrollTop += delta` 保持 anchor。
- 如果变化发生在 anchor 内部，按 offsetWithinMessage 保持阅读位置。
- 如果变化在 anchor 下方，只更新 measurement cache 和 observation。

User-visible result：

- 用户正在读的消息不跳。
- 滚动条因真实 DOM 高度变化产生自然比例变化。

Forbidden：

- ResizeObserver callback 不能直接写 `scrollTop`。
- 不能把动态高度修正转成 segment reset。

## S4 惯性连续

Trigger：用户快速滚向 before / after edge，浏览器仍有 wheel / touch momentum。

Runtime behavior：

- edge need 发出后 latch 当前 edge。
- 请求未完成时不阻止原生滚动，不反复发同一请求。
- 数据 commit 后执行 anchor correction，source 标记为 recovery。
- correction 后如果仍有新的用户 / momentum scroll frame，允许继续触发下一次 edge need。

User-visible result：

- 触边加载后内容扩展，thumb 自然离开边缘。
- 用户不用重新滚动也能继续沿惯性方向浏览。

Forbidden：

- 不允许在 edge pending 期间用 synthetic scroll loop 模拟惯性。
- 不允许 correction scroll event 触发下一页请求。

## S5 Feed 切换恢复

Trigger：用户从 feed A 切到 feed B，再切回 A。

Runtime behavior：

- detach A 前发 `viewportAnchorChanged(reason: 'detach')`。
- host 保存 A 的 identity anchor。
- 切回 A 时，data runtime 返回围绕 anchor 的 segment。
- runtime reset around 并按 visual target 对齐。

User-visible result：

- 回到接近离开前的阅读位置。
- 不依赖旧 `scrollTop` 在新 segment 中复用。

Forbidden：

- 不允许把旧 feed 的 scroll event 或 edge latch 带到新 feed。
