# 虚拟列表与 IM Message List 技术调研报告

本报告以原 `docs/viewport-runtime/research-notes.md` 的外部调研结论为基准，并结合当前 `docs/research/telegram-web-a.md` 与 next 文档的 loaded segment / native scroll 方向扩展。

调研目标不是把 XMessageList 改造成一个通用虚拟列表库，而是弄清楚主流虚拟列表、移动端 recycler、IM message list 的底层原理，提炼哪些优化值得吸收，哪些心智会伤害 IM 阅读稳定性。

调研快照时间：2026-05-26。

## 0. 结论先行

虚拟列表的本质不是“少渲染 DOM”。少渲染只是结果。它真正做的是维护一套坐标系统：

```text
data index / item identity
-> estimated or measured item size
-> logical offset / native scroll range
-> currently rendered DOM projection
-> user-visible reading position
```

不同库的差异，核心就在于它们相信哪一层是真相。

| 家族 | 代表 | 真相来源 | 最强场景 | 对 IM 的风险 |
| --- | --- | --- | --- | --- |
| 确定尺寸 offset manager | react-virtualized, react-window, Angular CDK fixed strategy | index + size function / estimate | 表格、设置页、已知高度列表 | prepend、动态高度、消息流更新需要额外语义 |
| 动态测量 virtualizer | TanStack Virtual, virtua, React Virtuoso, rc-virtual-list, vue-virtual-scroller | estimate -> DOM measure -> cache correction | 高度不完全固定的 Web 列表 | 仍需业务说明“这次数据变化意味着什么” |
| recycler | React Native VirtualizedList, RecyclerListView, FlashList | render window + view/cell reuse | 移动端长 feed、高 churn 场景 | 复用 cell 会放大组件状态泄漏风险 |
| IM message list runtime | Virtuoso Message List, Stream Chat, Telegram Web A/K, XMessageList next | message identity + mutation semantics + visual anchor | 聊天、历史分页、追底、跳转 | 不能退化成 index scroll 思维 |

最重要的判断：

1. 通用虚拟列表解决的是“当前 scroll offset 应该投影哪些 items”。
2. IM 消息列表解决的是“数据变了以后，用户原来的阅读位置应该如何保持”。
3. 动态高度没有魔法。所有成熟实现都是 estimate -> measure -> compensate，只是缓存结构、时机和补偿策略不同。
4. ResizeObserver 不是 scroll correction owner。它最多是 dirty signal，真正的修正必须进入 transaction 或稳定化阶段。
5. XMessageList 当前 next 方向，真实 loaded segment + native scroll range + visual anchor correction，比全历史 spacer 更接近成熟 IM 的本质。

一句话：通用 virtualizer 管“少画什么”，IM runtime 管“变化之后别把用户眼睛里的那一行弄丢”。

## 1. 研究范围与校验方式

本轮主要覆盖有持续使用量、生态影响力，或对 XMessageList 有明确借鉴价值的实现：

| 实现 | 当前 npm 版本 | 核心定位 |
| --- | --- | --- |
| `react-virtualized` | 9.22.6 | 老牌 React 虚拟列表，CellMeasurer / Grid / WindowScroller 体系 |
| `react-window` | 2.2.7 | Brian Vaughn 后续的轻量列表与网格 |
| `@tanstack/virtual-core` | 3.16.0 | headless virtualizer，Web / framework agnostic |
| `virtua` | 0.49.1 | 零配置动态尺寸 virtualizer，支持多框架 |
| `rc-virtual-list` | 3.19.2 | Ant Design 生态底层虚拟列表 |
| `react-virtuoso` | 4.18.7 | 高度动态列表和 Message List 产品化能力 |
| `vue-virtual-scroller` | 3.0.4 | Vue 生态经典 RecycleScroller / DynamicScroller |
| `@angular/cdk` | 21.2.12 | Angular CDK scrolling，稳定工程组件 |
| `recyclerlistview` | 4.2.3 | RN/Web recycler，强 layout provider 心智 |
| `@shopify/flash-list` | 2.3.1 | React Native 高性能 recycler，v2 JS-only |

校验方式：

- 官方文档和 README 作为公开语义来源。
- npm 包源码作为实现细节来源。
- 对 IM 相关结论，优先比对 React Virtuoso Message List、Stream Chat、Telegram Web A/K，以及 XMessageList 当前 next 文档。
- 对 ChatScope、MUI X Chat、Sendbird UI、react-chat-elements 这类聊天 UI 套件，只把它们作为生态边界观察。它们更多是 message component / conversation UI，不是虚拟列表内核。

## 2. 一张生态地图

| 实现 | 底层模型 | 动态高度 | prepend / chat 语义 | 精华优化 | 不适合照搬的点 |
| --- | --- | --- | --- | --- | --- |
| react-virtualized | offset manager + cell cache | 通过 CellMeasurer | 无原生 IM 语义 | JIT offset, binary/exponential search, deferred measurement | API 重、index 心智强 |
| react-window | 轻量 bounds cache | v2 有 `useDynamicRowHeight` | 无 | 简化 API, average estimate | 需要调用方处理 message mutation |
| TanStack Virtual | headless measurement cache | 强 | 有 `anchorTo`, `followOnAppend`, chat guide | framework agnostic, snapshot, lane fast path | 仍是 virtualizer，不拥有数据层 transaction |
| virtua | offset cache + jump compensation | 强 | 支持 reverse / prepend 场景 | median estimate, pending jump, iOS 处理 | 零配置对 IM 业务边界不够显式 |
| React Virtuoso | measured list runtime | 强 | Message List scroll modifier | 数据变化语义化、follow bottom | scroll modifier 是组件 API，不是独立 runtime contract |
| rc-virtual-list | itemHeight fallback + DOM height cache | 中等 | 很弱 | 简洁、AntD 控件场景够用 | 线性扫描和控件假设不适合作 IM core |
| vue-virtual-scroller | recycler pool + dynamic item | 强 | 弱 | pool 复用、minItemSize、cache restore | Vue 组件复用约束较多 |
| Angular CDK | fixed strategy + buffer | 固定尺寸为主 | 弱 | min/max buffer px, template cache, zone 外 scroll | dynamic IM 需要另写 strategy |
| RN VirtualizedList | finite render window | 由 RN 布局和 props 调参 | 有 MVCP 等平台能力 | async low-pri fill, blank spacer | Web DOM IM 不应直接套 RN 心智 |
| RecyclerListView | deterministic layout + recycle pool | 可非确定，但鼓励确定 | 可做，但需应用层实现 | type-based pool, stable id, renderAhead | deterministic layout 要求对消息流偏硬 |
| FlashList | recycler + layout manager | 强 | `maintainVisibleContentPosition` 默认 | measurement target, type pool, first-visible correction | RN 优化强绑定，不等同 Web native scroll |
| Stream Chat | Virtuoso wrapper | 继承 Virtuoso | 是 | 把 message list 产品化到 SDK | 自身不是底层 engine |
| Telegram Web A/K | app-specific DOM flow + anchor correction | 真实 DOM 测量 | 是 | loaded segment, native scroll, before/after trigger | 业务和滚动逻辑耦合，不能照搬组织方式 |

## 3. 四种底层实现范式

### 3.1 Deterministic Offset Manager

代表：react-virtualized、react-window、Angular CDK fixed strategy。

基本模型：

```text
index -> size
prefix sum(size) -> offset
scrollTop -> visible index range
visible range + overscan -> render absolute-positioned rows
```

它的性能来自两个事实：

- 如果 size 已知，offset 可以懒计算并缓存。
- 从 scrollTop 找 index 可以用二分、指数搜索或简单除法。

react-virtualized 的 `CellSizeAndPositionManager` 是典型：按需计算 cell offset，未测量部分用 estimated size 拼接总高度。`Grid` 再根据 visible range 渲染 cell。`CellMeasurer` 负责把未知 DOM 尺寸写回 cache，并让父 Grid 重新计算。

这个模型的本质是“先相信数学坐标，再让 DOM 去追”。它适合表格、设置项、图片瀑布流里尺寸可预测的场景。

对 IM 的问题在于：prepend 不是一个 offset 问题，而是一个阅读位置连续性问题。如果只说“前面多了 30 行，所以 offset 变大”，还不够。runtime 必须知道旧的 visual anchor 是哪条消息、commit 前后 rect 怎么变、是否还在 DOM 中。

### 3.2 Measurement-Correction Virtualizer

代表：TanStack Virtual、virtua、React Virtuoso、rc-virtual-list、vue-virtual-scroller 的 DynamicScroller。

基本模型：

```text
unmeasured item -> estimate
mounted item -> measure DOM size
size cache changes -> recompute offsets / spacers
if change affects current viewport -> adjust scrollTop
```

这类库承认一个现实：Web 内容高度经常未知。Markdown、图片、字体、emoji、异步媒体都会让“先验高度”变成猜测。

优化重点通常是：

- item size cache：避免重复测量。
- dirty range：只重算受影响区域。
- ResizeObserver：监听已挂载元素尺寸变化。
- scroll delta compensation：如果上方元素变高，给 `scrollTop` 加同样的 delta。
- overscan：用一点额外渲染换滚动时的连续性。

这类实现比 deterministic manager 更接近聊天列表，但仍缺一个 IM 语义层：同样是数据数组变化，可能是 prepend history、append new message、streaming update、delete message、jump reset、trim far side。每一种变化的 scroll contract 都不同。

### 3.3 Recycler

代表：React Native VirtualizedList、RecyclerListView、FlashList、vue-virtual-scroller 的 pool。

基本模型：

```text
visible / engaged indices -> render stack
offscreen cell -> recycle pool
new visible item -> reuse same view key / native view
item type -> choose compatible pool
```

Recycler 优化的不是 DOM offset，而是 view allocation。移动端创建和销毁 native view 成本高，所以它宁愿让同一个 cell 被不同 item 重复使用。

Recycler 的精华是：

- 按 item type 分池，避免把完全不同结构的 cell 复用到一起。
- stable id 映射，降低数据变化时 key 乱跳。
- renderAhead / windowSize 控制提前渲染。
- maintain visible content position，数据插入时保住当前可见 item。

代价也明确：组件必须对“同一个实例展示不同 item”高度敏感。任何未跟随 item 更新的内部状态、动画状态、图片加载状态，都可能泄漏到下一条消息。

Web IM 是否要 recycler，需要非常谨慎。XMessageList 当前瓶颈更可能是 scroll/measurement/transaction 正确性，而不是 DOM node allocation。过早引入 recycler，会把 bug 从“滚动坐标”扩散到“组件状态复用”。

### 3.4 Message List Runtime

代表：React Virtuoso Message List、Stream Chat 的 VirtualizedMessageList、Telegram Web A/K、XMessageList next。

基本模型：

```text
message identity + loaded segment
-> semantic data mutation
-> capture visual anchor
-> render committed DOM
-> measure anchor delta
-> correct native scrollTop
-> settle bottom / edge / destination state
```

IM message list 和通用 virtualizer 的最大差别是：它不是只面对用户滚动，还面对连续的数据变更。

典型变化：

- before paging：顶部加载更旧消息，用户眼前的旧消息不能跳。
- after paging：底部加载更新消息，未锁底时不能抢走阅读位置。
- live append：锁底则追新，读历史则保持当前位置。
- streaming message：最后一条消息持续变高，锁底和非锁底策略不同。
- jump around：旧 segment 失效，新 segment 需要按 identity anchor 对齐。
- trim：裁掉远离 viewport 的 DOM，也必须是 transaction。

所以 IM runtime 的核心不是 “virtual range extractor”，而是 “mutation semantics + anchor correction”。

## 4. 重点库拆解

### 4.1 react-virtualized：经典 offset manager

react-virtualized 的核心价值在于它把虚拟列表的底层数学讲得很清楚。

`CellSizeAndPositionManager` 持有每个 cell 的 size / offset。已测量区间精确，未测量区间用 estimated size。给定 scroll offset 时，它用搜索找到最近 cell，再向前/向后扩出 visible range。

`CellMeasurer` 则负责动态高度：把 cell 临时渲染出来，读 DOM 的 `offsetHeight` / `offsetWidth`，写入 cache，再通知 Grid 重新布局。

精华优化：

- JIT offset：只计算走到的 index，不预先扫完整列表。
- estimated total size：未测量区域用估算补齐 scroll range。
- deferred measurement：Grid 在必要时扩大测量面，保证未知行列可被测到。

本质判断：react-virtualized 是“坐标系优先”的库。它非常适合作为虚拟列表入门模型，但不适合作为现代 IM runtime 的直接底座。IM 的核心问题已经从 “index 到 offset” 上升到 “message identity 在异步 DOM 变化前后如何连续”。

### 4.2 react-window：更少概念，更少承诺

react-window 是 react-virtualized 的轻量后继。它放弃了大量复杂组件，保留 List / Grid 等核心能力。

v2 已经支持动态 row height cache，`rowHeight` 可以是数字、百分比、函数，或 `useDynamicRowHeight` 返回的动态缓存。源码里通过 ResizeObserver 观察 row，维护 bounds cache，并用平均高度估算未知区。

精华优化：

- API 更小，调用方更难无意中踩进复杂组合。
- bounds cache 让已测区域稳定复用。
- 对动态高度给出能力，但文档仍提醒动态 row height 不如固定高度高效。

本质判断：react-window 的哲学是“把通用 virtualizer 做薄”。这对库作者很好，但对 IM 来说，它把 prepend、follow bottom、streaming resize、jump restore 等语义都留给接入方。XMessageList 不应把这些语义散落到 React adapter 或 demo host。

### 4.3 TanStack Virtual：headless virtualizer 的工程上限

TanStack Virtual 是这批 Web virtualizer 里最值得认真借鉴的 headless 设计。它把 DOM、framework、item 渲染都放在外面，核心只维护 virtualizer 状态。

核心机制：

- `estimateSize` 给未知 item 一个初始尺寸。
- `measureElement` 默认用 ResizeObserver / DOM 尺寸测量真实 item。
- `itemSizeCache` 按 key 存真实尺寸。
- `measurementsCache` 把 start / size / end 串成可搜索的 measurement 数组。
- `rangeExtractor` 决定最终渲染范围。
- `scrollMargin` 支持容器前方还有固定区域的布局偏移。
- `lanes` 支持多列场景，单 lane 有更快的扁平缓存路径。

它对聊天也有明确支持：chat guide 强调正常 DOM 顺序、`anchorTo: 'end'`、`initialOffset`，以及 prepend 时“render、measure、prepend 要原子化”。最新 core 还提供 `followOnAppend`、`anchorTo`、`takeSnapshot` 等能力。

精华优化：

- headless：核心不依赖 React，和 XMessageList runtime 边界相似。
- anchor/end 语义：承认 bottom-oriented list 是独立问题。
- snapshot：把测量缓存拿出来恢复，适合 feed restore / route restore。
- lanes fast path：常见单列列表可走更紧凑的数据结构。

本质判断：TanStack Virtual 已经接近“可被 IM runtime 借用的 engine”。但它仍是 virtualizer，不是完整 IM runtime。它可以告诉你哪段 range 该 render，不能替 data runtime 决定一次数据变化是 before extend、after extend、trim，还是 reset around。

### 4.4 virtua：零配置动态尺寸的激进派

virtua 的定位很鲜明：尽量少配置，默认处理动态高度、reverse scrolling、iOS 等麻烦情况。

源码中的核心结构可以概括为：

- size array：每个 item 的尺寸，未知时使用默认或自动估算值。
- offset cache：按需计算累计 offset，并记录 dirty 起点。
- `findIndex` / `computeRange`：从 scroll offset 反查 range。
- median estimate：未提供 item size hint 时，从已测 item 推断默认尺寸。
- resize observer：观察 viewport 和 item，把尺寸变化送回 store。
- `jump` / `pendingJump`：当尺寸或数据变化会推走当前视图时，通过延迟补偿维持视觉位置。

精华优化：

- 自动估算默认 item size，不要求调用方一开始就猜对。
- 对 reverse / prepend 场景内建 scroll position adjustment。
- 同步处理 resize 后的状态，尽量减少用户可见闪动。

本质判断：virtua 的强项是“把动态高度 virtualizer 做得像普通列表一样好用”。但 IM 工程里，零配置本身也可能是风险：用户读历史、锁底、跳转、删除 anchor、分页去重，这些不应该靠库的默认猜测决定。XMessageList 可以借它的 measurement cache / median estimate / jump compensation 思路，但仍要显式拥有 transaction 语义。

### 4.5 React Virtuoso 与 Virtuoso Message List：把数据变化说出来

React Virtuoso 是 Web 动态高度虚拟列表里最接近 IM 产品需求的一类实现。它不仅测量动态高度，还把“数据变化后的滚动策略”显式建模。

对 IM 最关键的是 Message List 的 scroll modifier：

- prepend：历史消息插到前面，旧列表头部必须连续，才能保持 scroll position。
- append / auto-scroll-to-bottom：新消息到达时是否追底。
- item-location：跳到某个 item 位置。
- remove-from-start：裁掉前面的 items 时补偿位置。

Virtuoso 的 `followOutput` / `atBottomThreshold` 也说明追底不是 append 的自然结果，而是一种状态机：用户接近底部时才跟随，用户读历史时不能抢视图。

精华优化：

- 把数据变化语义化，而不是让 effect 猜。
- 内置 bottom follow / threshold。
- 面向 message list 提供 imperative data methods，降低 SDK 封装成本。

本质判断：这是原 `research-notes.md` 里最值得吸收的一点。XMessageList 应该继续保留这种语义，但不要把它暴露成 React prop。更合适的形态是 data runtime 发布 `SegmentExtendBefore` / `SegmentExtendAfter` / `SegmentReset` / `SegmentTrim` 等 modifier，viewport runtime 串行执行 transaction。

### 4.6 rc-virtual-list 与 Ant Design：控件场景的务实方案

Ant Design 的 Select 等控件默认开启虚拟滚动，底层生态里 `rc-virtual-list` 是关键组件。

rc-virtual-list 的实现非常务实：

- `itemHeight` 作为快速估算。
- 通过 key 注册 DOM ref。
- `useHeights` 读取 `offsetHeight` 和 margin，写入 height cache。
- range 计算用数据扫描叠加高度，找出 visible start/end。
- 额外渲染一个 item，降低边界空白概率。
- 当首个 visible item 首次获得真实高度时，用高度 diff 调整 `scrollTop`，避免视图跳动。

精华优化：

- 很少抽象，成本低，适合下拉框、树、列表控件。
- 对 Firefox Map 性能等细节有工程性处理。
- 自定义 scrollbar 与虚拟列表配合成熟，适合设计系统控件。

本质判断：rc-virtual-list 解决的是“组件库控件里放很多 option”。这个场景的 mutation 远比 IM 简单，通常没有双向历史分页、streaming message、锁底状态、删除 anchor 恢复。它值得借鉴简洁性，不适合作 XMessageList core。

### 4.7 vue-virtual-scroller：pool 与 dynamic item 的组合

vue-virtual-scroller 的两个核心组件很有代表性：

- `RecycleScroller`：适合固定或可预知尺寸，通过 pool 复用 view。
- `DynamicScroller`：适合未知高度，要求提供 `minItemSize`，通过 `DynamicScrollerItem` 测量。

它反复提醒一个问题：复用组件时，子组件必须正确响应 item prop 变化，不能把 hover、内部状态、异步资源隐含地绑在旧 item 上。

精华优化：

- pool 复用减少组件创建销毁。
- `minItemSize` 给动态测量一个安全起点。
- cache snapshot / restore 思路适合路由恢复。

本质判断：它展示了 Web 端 recycler 的双刃剑。复用很省，但要求组件写法非常纪律化。对消息列表这种富内容 row，复用风险要比收益更早出现。

### 4.8 Angular CDK scrolling：稳定的 fixed strategy

Angular CDK 的 virtual scrolling 是企业应用里非常常见的基座。它最成熟的是 fixed size strategy：

```text
totalSize = dataLength * itemSize
firstVisible = scrollOffset / itemSize
bufferPx < minBufferPx -> expand range to maxBufferPx
content wrapper 用 transform / offset 放到正确位置
```

工程亮点：

- `minBufferPx` / `maxBufferPx` 比单纯 overscan count 更贴近滚动体验。
- `templateCacheSize` 控制 Angular embedded view 复用。
- scroll 监听在 Angular zone 外处理，减少 change detection 压力。
- `appendOnly` 支持只追加不移除的特殊场景。

本质判断：Angular CDK 是“固定高度企业列表”的典型好答案。它的 buffer 策略和 view cache 值得借鉴，但 IM 动态高度与历史分页不应建立在 fixed strategy 上。

### 4.9 React Native VirtualizedList：窗口化是平台原语

React Native 的 VirtualizedList / FlatList 把 virtualization 做成平台常用原语。它维护 finite render window，把窗口外内容用 blank space 替代，并且可以用低优先级异步渲染远离 viewport 的 items。

精华优化：

- windowSize / maxToRenderPerBatch / updateCellsBatchingPeriod 等调参，显式平衡 fill rate 与响应性。
- offscreen low-pri rendering，避免抢占交互。
- `maintainVisibleContentPosition` 等平台能力适合聊天。

本质判断：RN 的经验提醒我们，列表性能不是单一指标。blank area、fill rate、JS responsiveness、mount cost 都要分开看。XMessageList 的 E2E 也应该区分正确性 lane 和性能 lane，不要用“能翻页”掩盖 action latency 或 frame gap。

### 4.10 RecyclerListView：确定 layout 与 recycle pool

RecyclerListView 的思路非常硬核：让调用方提供 `DataProvider` 和 `LayoutProvider`。

- `DataProvider` 负责 row diff 和 stable id。
- `LayoutProvider` 负责 index -> type -> dimensions。
- `VirtualRenderer` 维护 render stack。
- `RecycleItemPool` 按 type 保存可复用 render key。
- `renderAheadOffset` 控制提前渲染范围。

它也支持 `forceNonDeterministicRendering`，允许尺寸不完全确定，但库的最佳路径仍然是 deterministic layout。

精华优化：

- stable id 与 recycle key 分离，避免数据变化时 key 崩坏。
- 按 type 复用，避免结构差异导致错复用。
- context preservation，支持列表恢复。

本质判断：RecyclerListView 告诉我们，recycler 要想可靠，必须把 layout 和 identity 讲清楚。XMessageList 的 message identity anchor 可以借鉴 stable id 的纪律，但不应为了 recycler 牺牲 loaded segment/native scroll 的简单真相。

### 4.11 FlashList v2：RN recycler 的现代产品化

FlashList v2 的定位是高性能 React Native 列表。v2 文档强调：为 RN 新架构重写、JS-only、无需 estimates，同时支持 view recycling 和动态尺寸。

关键机制：

- `renderItem` target 区分 `Cell`、`Measurement`、`StickyHeader`。
- `getItemType` 用来建立更准确的 recycle pool。
- `maxItemsInRecyclePool` 控制池大小，也可以设为 0 禁用复用。
- `maintainVisibleContentPosition` 默认开启，带 top/bottom threshold、startRenderingFromBottom、auto-scroll-to-bottom 等配置。
- 内部 `RenderStackManager` 维护 key map、stable id map、recycle key pools。
- 数据变化时根据 first visible item key / layout 找回当前位置，并应用 offset diff。

精华优化：

- measurement render target：测量和真实展示可以区分。
- maintain visible content position 默认化，承认 feed/chat 这是核心能力。
- recycle pool 可控，不把复用当成不可关闭的黑箱。

本质判断：FlashList 对 XMessageList 的最大启发不是“我们也要 recycler”，而是“可观测性能指标和 visible-content-position 要成为一等公民”。Web IM 同样需要 blank area / frame gap / scroll correction delta / transaction latency 这类指标。

### 4.12 Stream Chat：产品 SDK 选择 Virtuoso 的信号

Stream Chat React 的 `VirtualizedMessageList` 使用 `react-virtuoso` 渲染 messages，并把 `defaultItemHeight` 明确暴露出来。它的文档提醒：默认 item height 如果偏离真实消息高度，会影响 scrollbar thumb size 和滚动行为。

这说明成熟 chat SDK 在工程上也不把虚拟列表当成透明细节。即使使用 Virtuoso，message list 仍需要 SDK 层表达：

- message grouping。
- new message behavior。
- loading state。
- default item height。
- message actions / reactions / attachments。

本质判断：Stream Chat 是一个很好的生态证据：IM SDK 会选择强动态高度 virtualizer 作为底座，但仍需要自己的 message-list component 来承接产品语义。XMessageList 也应该保持 runtime + adapter + host 的分层，而不是暴露一个裸 virtualizer。

### 4.13 Telegram Web A/K：真实 IM 工程的反虚拟列表提醒

Telegram Web A 的实现与通用 virtualizer 最大不同，是它不试图把未加载历史伪造成一个完整全局 scroll range。它维护短 `viewportIds` / loaded segment，DOM 正常文档流，上下用 trigger 触发加载，数据变更前后用 anchor rect diff 修正 scrollTop。

这和当前 XMessageList next 文档高度一致：

- scroll container 是真实 native scroll。
- `scrollHeight` 表达当前已加载 segment 的真实 DOM 高度。
- before / after trigger 只是分页入口，不拥有坐标。
- 触顶加载后，真实 DOM 高度增加，anchor correction 后 thumb 自然离开顶部。

Telegram Web K 也体现了相同现实：成熟聊天 bubbles 实现直接面对 DOM、滚动容器、批量插入、清理和异步状态，不会把它抽象成普通列表。

精华优化：

- loaded segment 作为 DOM truth。
- visual anchor rect correction。
- edge observer 只发 signal，不拥有 scroll correction。
- 远距离跳转通过 around/latest reset，而不是虚构全局百分比。

本质判断：Telegram 路线不是“低技术”，而是把正确性建立在浏览器 native scroll 事实之上。通用 virtualizer 的 spacer 心智很聪明，但在 IM 里会让 scrollHeight 表达估算历史，而不是当前真实阅读区域。next 方向放弃全历史 spacer，是一个正确的产品工程取舍。

## 5. 精华优化手段

### 5.1 Prefix Offset + Lazy Measurement Cache

出处：react-virtualized、react-window、TanStack Virtual、virtua。

技术要点：

- 已测 item 存真实 size。
- 未测 item 用 estimate。
- offset 不必全量预计算，可以从 dirty index 开始懒更新。
- scrollTop -> index 用二分/指数搜索/扁平数组加速。

本质：把 O(n) 的“每次滚动都扫列表”变成“只在尺寸信息变更时维护坐标表”。

XMessageList 可吸收：对 loaded segment 内的 row height cache 做 generation / width bucket / content version 分层，避免 resize 或 feed 切换污染缓存。

### 5.2 ResizeObserver Dirty Signal + Transaction Correction

出处：TanStack Virtual、virtua、react-window、rc-virtual-list、XMessageList 现有文档。

技术要点：

- ResizeObserver callback 只记录 dirty item。
- correction 放到 layout effect 后的 transaction，或 rAF stabilization。
- 如果 dirty area 在 visual anchor 上方，`scrollTop += delta`。
- 如果 bottom locked，则 scroll to native bottom。

本质：ResizeObserver 只告诉你“高度变了”，不告诉你“用户希望怎么补偿”。补偿必须依赖当前 scroll intent / anchor / bottom lock。

XMessageList 可吸收：继续禁止 RO callback 直接写 `scrollTop`，把 media decode、markdown lazy render、container resize 都归入 stabilization。

### 5.3 Explicit Mutation Modifier

出处：React Virtuoso Message List、TanStack Chat guide、FlashList MVCP、XMessageList transaction 文档。

技术要点：

```text
prepend history != append live message
append unlocked != append locked
trim before != reset around
streaming growth != static row resize
```

本质：同样是 data array 变了，scroll contract 完全不同。没有 modifier，就只能在 React effect 里猜。

XMessageList 可吸收：把 modifier 内化为 data runtime -> viewport runtime 的 semantic event，而不是交给 React props。

### 5.4 Bottom / End Anchoring

出处：React Virtuoso `followOutput`、TanStack `anchorTo: 'end'` / `followOnAppend`、FlashList `maintainVisibleContentPosition`、RN chat 场景。

技术要点：

- bottom lock 是状态，不是每次 append 的副作用。
- 要有 threshold / hysteresis，避免用户在底部附近被反复抢滚动。
- streaming last message 增高时，locked 和 unlocked 行为不同。

本质：聊天列表的“底部”是一个语义位置，不只是 `scrollTop = scrollHeight - clientHeight` 的瞬时计算。

XMessageList 可吸收：保持 bottom marker + native bottom 检测，但状态机必须由 viewport runtime 拥有。

### 5.5 Recycle Pool by Type

出处：RecyclerListView、FlashList、vue-virtual-scroller。

技术要点：

- offscreen view 进入 pool。
- 新 item 优先拿同 type view。
- stable id 与 render key 分离。
- pool size 可控。

本质：减少 mount/unmount 成本，但把状态正确性的压力转移给 row component。

XMessageList 当前建议：暂不作为 core 方向。只有当 profile 明确证明 DOM allocation 是主要瓶颈，且 row component 状态纪律可控时，再考虑局部 recycler。

### 5.6 Buffer / Overscan / RenderAhead

出处：Angular CDK、RN VirtualizedList、RecyclerListView、TanStack Virtual。

技术要点：

- count-based overscan 简单，但忽略像素速度。
- px-based buffer 更贴近视觉空白风险。
- renderAhead 在移动端常用于平衡 fill rate。
- 滚动方向可影响 overscan 分配。

本质：overscan 是用内存和提前 render 购买“下一帧不空白”的保险。

XMessageList 可吸收：在性能 E2E 中分别记录 blank area、frame gap、transaction latency，避免用单一 overscan 参数掩盖问题。

### 5.7 Measurement Snapshot Restore

出处：TanStack `takeSnapshot`、vue-virtual-scroller cache restore、RecyclerListView context preservation。

技术要点：

- 离开 feed 时保存已测 item size / anchor / scroll context。
- 回来时先用 cache 恢复近似布局。
- commit 后再根据真实 DOM 修正。

本质：restore 不是记一个 `scrollTop`，而是恢复一组足够重建视觉位置的上下文。

XMessageList 可吸收：feed runtime cache 已经是好方向，可进一步把 measured segment snapshot 做成明确诊断对象。

### 5.8 Blank Area / Fill Rate Telemetry

出处：RN VirtualizedList、FlashList。

技术要点：

- 空白区域和 action latency 是独立指标。
- mount 成本、measurement 成本、scroll correction delta 要分开看。
- 性能测试不要和正确性测试混成一个“通过/失败”。

本质：虚拟列表性能不是“快不快”，而是“哪一类预算被打爆”。

XMessageList 可吸收：继续把 correctness lane 与 perf lane 分开，特别是 paging continues、thumb natural edge motion、action latency、long task、frame gap 分别建 oracle。

## 6. 对 XMessageList 的借鉴清单

### 6.1 应该吸收

1. Virtuoso 的 modifier 思想：把每次数据变化的滚动语义说清楚。
2. TanStack 的 headless 边界：runtime core 不依赖 React，React 只投影。
3. virtua 的自动估算和 jump compensation：对动态高度友好，但要纳入 transaction。
4. FlashList 的 visible-content-position 一等公民意识：把可见锚点稳定作为核心能力。
5. RN / FlashList 的性能观测方式：blank area、fill rate、layout commit、scroll correction delta 都应可诊断。
6. Telegram 的 loaded segment + native scroll truth：不要用未加载历史高度伪造滚动范围。

### 6.2 谨慎吸收

1. TanStack 的 `anchorTo: 'end'` / `followOnAppend`：概念可借鉴，但应映射成 XMessageList bottom lock 状态机。
2. vue / RecyclerListView 的 recycle pool：除非 profile 证明必要，否则不要引入 core。
3. Angular CDK 的 buffer px：可以借鉴参数思想，但不能回到 fixed item size 假设。
4. rc-virtual-list 的简洁线性扫描：适合小控件，不适合 IM runtime 的长期复杂性。

### 6.3 不应吸收

1. 不应把全历史高度估算注入 native scroll range，next 文档已明确拒绝 spacer 作为基础坐标。
2. 不应让 React adapter 通过 effect 猜测 scroll correction。
3. 不应把 edge trigger 的 IntersectionObserver callback 变成数据 mutation 和 scrollTop correction owner。
4. 不应把“库能虚拟很多行”误当成“库能保证 IM 阅读位置稳定”。
5. 不应把 recycler 当成免费性能，消息 row 的局部状态和异步媒体会让复用成本变高。

## 7. 一个更本质的分类法

可以用两个问题判断一个库是否适合 IM core：

### 7.1 它的 anchor 是 index 还是 identity？

普通虚拟列表常以 index 为核心。index 在 append-only feed 中没问题，但在 before paging、delete、around reset 后会漂移。

IM runtime 必须以 message identity 为核心，index 只能是当前 segment 内的派生值。

### 7.2 它的 scrollHeight 是估算全局历史，还是当前 DOM truth？

通用 virtualizer 倾向于构造一个很大的 estimated total size，让 scrollbar 表达“全量数据空间”。

IM loaded segment 模型则让 `scrollHeight` 只表达当前已加载 DOM。未加载历史不是 scroll range，而是 edge trigger 后的数据请求。

这两个选择会决定滚动条是不是自然、分页后 thumb 是否回落、惯性滚动会不会被 spacer correction 打断。

## 8. 推荐给 XMessageList next 的技术路线

保持当前方向：

```text
loaded segment native scroll
+ visual anchor correction
+ semantic data mutation
+ transaction after React commit ack
+ ResizeObserver dirty batching
+ runtime-owned scroll writer
+ React projection adapter
```

在这个路线下，外部库的精华应被吸收为内部机制，而不是替换核心架构：

| 外部经验 | XMessageList 内部形态 |
| --- | --- |
| Virtuoso scroll modifier | data runtime 发布 segment effect，viewport runtime 执行 transaction |
| TanStack measurement cache | loaded segment row height cache + snapshot restore |
| virtua pending jump | transaction 内的 anchor delta compensation |
| FlashList MVCP | visual anchor / bottom marker 的一等状态 |
| Angular buffer px | edge prefetch / overscan budget 的诊断参数 |
| Recycler pool | 暂作未来 profile-driven 优化，不进入当前 core |
| Telegram triggers | before / after trigger 只发 semantic need，不拥有 correction |

如果要用一句架构原则收束：

```text
让浏览器负责真实 native scroll range，
让 runtime 负责 mutation 后的视觉连续性，
让 React 只负责把当前 segment 投影成 DOM。
```

## 9. 正确性边界

本报告的结论有几个明确边界：

- 版本快照截至 2026-05-26，后续库 API 可能变化。
- 对源码细节的描述只引用关键机制，不逐行复刻实现。
- Chat UI kit 如果没有自己的 virtualization engine，只作为生态边界，不纳入重点拆解。
- “适合 IM”不等于“可以直接替换 XMessageList runtime”。IM 的数据层、bridge、anchor identity、edge request、diagnostics 都是系统问题。
- 动态高度不可能被完全消灭，只能被估算、测量、补偿、诊断。

## 10. Sources

官方文档与仓库：

- [React Virtuoso](https://virtuoso.dev/)
- [Virtuoso Message List scroll modifier](https://virtuoso.dev/virtuoso-message-list/scroll-modifier/)
- [Virtuoso Message List DataMethods](https://virtuoso.dev/virtuoso-message-list-api/interfaces/DataMethods/)
- [TanStack Virtual API](https://tanstack.com/virtual/latest/docs/api/virtualizer)
- [TanStack Virtual Chat guide](https://tanstack.com/virtual/latest/docs/chat)
- [react-window](https://github.com/bvaughn/react-window)
- [react-window docs](https://react-window.vercel.app/)
- [react-virtualized](https://github.com/bvaughn/react-virtualized)
- [virtua](https://github.com/inokawa/virtua)
- [rc-virtual-list](https://github.com/react-component/virtual-list)
- [Ant Design Select virtualization docs](https://ant.design/components/select/)
- [vue-virtual-scroller](https://github.com/Akryum/vue-virtual-scroller)
- [Angular CDK scrolling](https://github.com/angular/components/tree/main/src/cdk/scrolling)
- [React Native VirtualizedList](https://reactnative.dev/docs/virtualizedlist)
- [FlashList](https://shopify.github.io/flash-list/docs/)
- [FlashList usage](https://shopify.github.io/flash-list/docs/usage)
- [FlashList recycling](https://shopify.github.io/flash-list/docs/recycling)
- [RecyclerListView](https://github.com/Flipkart/recyclerlistview)
- [Stream Chat React VirtualizedMessageList](https://getstream.io/chat/docs/sdk/react/components/core-components/virtualized_list/)
- [MDN ResizeObserver](https://developer.mozilla.org/en-US/docs/Web/API/Resize_Observer_API)
- [Telegram Web A research in this repo](./telegram-web-a.md)

源码快照：

- `react-window@2.2.7`
- `react-virtualized@9.22.6`
- `@tanstack/virtual-core@3.16.0`
- `virtua@0.49.1`
- `rc-virtual-list@3.19.2`
- `react-virtuoso@4.18.7`
- `vue-virtual-scroller@3.0.4`
- `@angular/cdk@21.2.12`
- `recyclerlistview@4.2.3`
- `@shopify/flash-list@2.3.1`
