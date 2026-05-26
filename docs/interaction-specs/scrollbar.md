# 滚动条规格

## B1 Native Truth

Trigger：任何滚动或 DOM 高度变化。

Runtime behavior：

- 滚动条比例以浏览器 native metrics 为准：
  - `scrollTop`
  - `clientHeight`
  - `scrollHeight`
- `scrollHeight` 只能来自当前 loaded segment 的真实 DOM。

User-visible result：

- 加载 before 后，顶部新增真实 DOM，thumb 自然从顶部回落。
- 加载 after 后，底部新增真实 DOM，thumb 自然从底部上移。
- 动态高度变化会产生细微但真实的 thumb 比例变化。

Forbidden：

- 不允许用 cached total height、virtual travel 或 unloaded estimate 重新映射 thumb。

## B2 Optional Overlay

Trigger：产品选择隐藏 native scrollbar 并绘制自定义 thumb。

Runtime behavior：

- overlay 只读 native metrics。
- thumb length = `clientHeight / scrollHeight` 的视觉表达，可设最小可点尺寸。
- thumb position = `scrollTop / (scrollHeight - clientHeight)`。
- drag / track click 只能通过 runtime direct-scroll API 写 native `scrollTop`。

User-visible result：

- overlay 与 native scrollbar 行为一致。
- 数据加载后 thumb 自然回落，不贴边等待虚拟算法修正。

Forbidden：

- overlay 不能拥有 edge paging、bottom lock、segment trim、anchor correction。
- overlay 不能根据 `hasMoreBefore/After` 拉长或压缩滚动轨道。

## B3 Drag 到边缘

Trigger：用户拖动 thumb 到顶部或底部。

Runtime behavior：

- drag source 视为 user direct manipulation。
- 到 before edge 且 `hasMoreBefore=true` 时触发 before need。
- 到 after edge 且 `hasMoreAfter=true` 且无 pending follow bottom 时触发 after need。
- 数据到达后仍按 anchor correction 保持抓取点附近的内容稳定。

User-visible result：

- 拖到边缘可以加载更多。
- 加载后 thumb 不永远贴边，而是随真实 scroll range 回落。

Forbidden：

- 不允许使用“边缘压力”无限加速请求。
- 不允许 drag 期间吞掉 segment commit 后的 geometry 更新。

## B4 Track Click

Trigger：用户点击 scrollbar track。

Runtime behavior：

- 计算目标 native `scrollTop`，交给 runtime scroll writer。
- 不直接跳过未加载历史。
- 如果目标接近 edge，后续由 edge trigger 触发分页。

User-visible result：

- 行为类似原生 scrollbar page jump。
- 不能一键跳到尚未加载的历史位置。

Forbidden：

- 不允许把 track click 映射到全历史百分比。
