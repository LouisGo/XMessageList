# 滚动条规格

## B1 Native Truth

Trigger：任何滚动或 DOM 高度变化。

Acceptance：

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

Acceptance：

- overlay 只读 native metrics。
- thumb length = `clientHeight / scrollHeight` 的视觉表达，可设最小可点尺寸。
- thumb position = `scrollTop / (scrollHeight - clientHeight)`。
- drag / track click 只能移动当前已加载内容范围内的真实滚动位置。

User-visible result：

- overlay 与 native scrollbar 行为一致。
- 数据加载后 thumb 自然回落，不贴边等待后续修正。

Forbidden：

- overlay 不能自行决定翻页、追底、裁剪或阅读位置修正。
- overlay 不能根据 `hasMoreBefore/After` 拉长或压缩滚动轨道。

## B3 Drag 到边缘

Trigger：用户拖动 thumb 到顶部或底部。

Acceptance：

- 拖到顶部且上方仍有历史时，触发一次 before loading。
- 拖到底部且下方仍有消息时，触发一次 after loading。
- loading 未完成时，即使用户继续按住 thumb、停在边缘或继续向边缘外拖动，也不能重复触发同一方向加载。
- loading 未完成时，thumb 可以停在边缘，但不能闪烁、抖动或在边缘附近来回跳。
- loading 完成前，用户仍然可以反向拖动或释放 thumb。

User-visible result：

- 拖到边缘可以加载更多。
- 网络请求慢时，滚动条停留在可理解的 loading 状态。
- 用户不会因为按住 thumb 而制造连续加载风暴。

Forbidden：

- 不允许使用“边缘压力”无限加速请求。
- 不允许在同一次未完成 loading 期间连续发送多次同方向请求。
- 不允许为了防止重复请求而阻塞用户继续拖动 thumb。
- 不允许 thumb 在边缘和回落位置之间高频闪动。

## B4 Edge Loading 完成后的回落

Trigger：用户拖动 thumb 到顶部或底部触发 loading，且该 loading 完成。

Acceptance：

- thumb 必须随新的真实滚动范围从边缘自然回落。
- 顶部 loading 完成后，thumb 的自然结果是从顶部向下回落。
- 底部 loading 完成后，thumb 的自然结果是从底部向上抬升。
- 回落或抬升后，thumb 必须进入一个稳定位置，不能只出现一帧就再次瞬移回边缘。
- 回落或抬升过程中，当前可见消息不能明显跳动。
- 如果用户仍按住 thumb 但没有产生新的同方向拖拽距离，不能立刻触发下一次同方向 loading。
- 下一次同方向 loading 必须发生在回落或抬升后的稳定位置之后，并且用户继续把 thumb 拖回边缘。

User-visible result：

- 用户看到 thumb 从顶部或底部离开，回到或抬升到轨道中一段合理位置。
- 用户继续向同方向拖动时，thumb 从回落或抬升后的当前位置继续移动，而不是瞬间吸回边缘。

Forbidden：

- 不允许 loading 完成后 thumb 仍被固定在边缘。
- 不允许出现“thumb 回落一帧后立刻回到顶部 / 底部”的闪烁循环。
- 不允许仅因为用户仍按住鼠标或触摸点在边缘位置，就立即触发下一页加载。
- 不允许把一次持续按住拖拽解释成多个连续边缘命中。

## B5 Active Drag 连续性

Trigger：用户按住 thumb 拖拽期间，触发了 before 或 after loading，且用户尚未释放鼠标或触摸点。

Acceptance：

- 当前拖拽手势必须保持连续。
- 边缘 loading 不能取消、重启、锁死或替换当前拖拽手势。
- 除了真实滚动范围变化带来的自然回落或自然抬升，thumb 不应出现额外跳动。
- loading 完成后，如果用户继续拖动，thumb 应从自然回落或自然抬升后的视觉位置继续移动。
- loading 完成后，如果用户没有继续产生拖拽位移，thumb 应停留在自然回落或自然抬升后的稳定位置。
- 同一次按住拖拽中，用户的后续位移应表现为正常拖动，而不是被解释成新的瞬时边缘命中。

User-visible result：

- 用户感觉自己始终在拖同一个滚动条。
- 触边加载只是让轨道长度发生变化，并带来 thumb 的自然回落或抬升。
- 手势不会因为加载完成而突然断开、吸附、重置或变成另一段拖拽。

Forbidden：

- 不允许 loading 完成时取消当前拖拽，再立刻创建一次新的拖拽效果。
- 不允许 thumb 因为鼠标或触摸点仍在边缘坐标而瞬间吸回边缘。
- 不允许在自然回落或抬升之外添加额外的自动滚动、跳动、锁定或回弹。
- 不允许用暂停拖拽响应、吞掉拖拽位移或强制等待释放来换取稳定。

## B6 连续按住拖拽加载

Trigger：用户持续按住 thumb，并持续向同一方向拖动，多次抵达顶部或底部。

Acceptance：

- 整个过程必须表现为明确的循环：触边 -> 一次 loading -> thumb 自然回落或抬升 -> 继续拖动 -> 再次触边。
- 每次 loading 之间必须有一次可观察的稳定回落或抬升。
- 每次新的 loading 都必须来自回落后的继续拖动，而不是来自上一轮未释放的边缘停留。
- 用户持续向上拖动时，可以连续加载更旧消息，但不能在同一回落周期内连发多页。
- 用户持续向下拖动时，可以连续加载更新消息，但不能在同一回落周期内连发多页。
- thumb 的移动应连续、可预测，不应在顶部 / 中间 / 顶部之间快速闪跳。

User-visible result：

- 手感接近自然拖动一个真实滚动条：每加载一页，轨道变长，thumb 自然回落或抬升，然后用户继续推动它靠近边缘。
- 连续加载时，用户看到的是平滑的触边、回落或抬升、继续拖动节奏，而不是请求风暴。

Forbidden：

- 不允许在一轮 loading 完成后，因为同一次按住动作还在边缘坐标上，就马上再次加载。
- 不允许出现“到顶 -> 回落 -> 下一帧又到顶 -> 再加载”的循环闪烁。
- 不允许 thumb 位置和消息内容稳定性互相打架：thumb 闪动时消息也跟着抖动。
- 不允许通过隐藏 thumb、暂停绘制或临时禁用拖拽来掩盖闪烁。

## B7 Drag 期间反向移动

Trigger：用户拖动 thumb 到边缘触发 loading 后，在 loading 未完成前反向移动 thumb。

Acceptance：

- thumb 应继续跟随用户手势移动。
- 当前 loading 可以继续完成，但不能强制用户停留在触发边缘。
- 如果用户离开边缘，loading 完成后的画面应保持用户当前阅读位置附近稳定。
- 反向移动到另一侧边缘时，只有在当前方向没有冲突 pending 状态时，才允许触发另一侧 loading。

User-visible result：

- 用户可以随时改变拖拽方向。
- 网络慢时，滚动条仍保持可控，不会卡在顶部或底部。

Forbidden：

- 不允许触边 loading 后锁死 thumb。
- 不允许用户反向拖动时继续按原方向连续加载。

## B8 Track Click

Trigger：用户点击 scrollbar track。

Acceptance：

- 不直接跳过未加载历史。
- 如果目标接近 edge，后续由 edge trigger 触发分页。
- track click 后，滚动位置移动到当前已加载内容范围内的对应位置。

User-visible result：

- 行为类似原生 scrollbar page jump。
- 不能一键跳到尚未加载的历史位置。

Forbidden：

- 不允许把 track click 映射到全历史百分比。
