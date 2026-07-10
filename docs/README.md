# XMessageList 文档入口

本目录记录当前 XMessageList 的实现、接入、测试与研究依据。所有现行文档统一以
**Telegram Web A 风格的 loaded segment native scroll** 为正向模型：

- scroll container 的 `scrollHeight` 只表达当前已加载、已挂载 segment 的真实 DOM 高度。
- 不再用 top spacer / bottom spacer 伪造未加载历史高度。
- 上下分页由正常文档流中的 before / after trigger 触发。
- 视觉稳定依赖 message anchor 的 DOM rect 差值补偿。
- 滚动条表现必须来自真实 native scroll range；自定义 overlay 只能镜像，不能发明虚拟滚动范围。

## 文档地图

| 目录 | 职责 | 先读 |
| --- | --- | --- |
| [architecture](./architecture/README.md) | 模型、所有权、状态边界、术语和 public API | [module-map.md](./architecture/module-map.md) |
| [implementation](./implementation/README.md) | DOM、transaction、measurement、React adapter、性能施工图 | [dom-layout.md](./implementation/dom-layout.md) |
| [interaction-specs](./interaction-specs/README.md) | 用户可观察的滚动、滚动条、分页、跳转规格 | [README.md](./interaction-specs/README.md) |
| [testing](./testing/README.md) | E2E 场景、oracle、证据结构 | [e2e-scenarios.md](./testing/e2e-scenarios.md) |
| [graph](./graph/README.md) | Mermaid 图形式的跨模块关系和时序 | [module-boundaries.md](./graph/module-boundaries.md) |
| [research](./research/telegram-web-a.md) | 研究快照与架构取舍来源 | [telegram-web-a.md](./research/telegram-web-a.md) |
| [adr](./adr/0001-host-message-event-store-boundary.md) | 难回退的边界与架构决策记录 | [0001-host-message-event-store-boundary.md](./adr/0001-host-message-event-store-boundary.md)、[0003-structural-reload-and-remove-transactions.md](./adr/0003-structural-reload-and-remove-transactions.md) |

## 推荐阅读顺序

1. [architecture/module-map.md](./architecture/module-map.md)
2. [architecture/layering-and-ownership.md](./architecture/layering-and-ownership.md)
3. [architecture/naming-and-api.md](./architecture/naming-and-api.md)
4. [architecture/session-registry-target-api.md](./architecture/session-registry-target-api.md)
5. [implementation/dom-layout.md](./implementation/dom-layout.md)
6. [implementation/transactions-and-measurement.md](./implementation/transactions-and-measurement.md)
7. [interaction-specs/README.md](./interaction-specs/README.md)
8. [interaction-specs/scrolling.md](./interaction-specs/scrolling.md)
9. [interaction-specs/paging.md](./interaction-specs/paging.md)
10. [interaction-specs/scrollbar.md](./interaction-specs/scrollbar.md)
11. [testing/e2e-scenarios.md](./testing/e2e-scenarios.md)
12. [testing/oracles.md](./testing/oracles.md)
13. [graph/README.md](./graph/README.md)
14. [adr/0001-host-message-event-store-boundary.md](./adr/0001-host-message-event-store-boundary.md)

## 统一口径

- 对外组件、hooks、runtime facade 和 package export 统一使用 `MessageList` 命名。
- `Viewport` 只用于描述可视区域、滚动容器、anchor、measurement 和 runtime 内部事件。
- `Projection` 只用于 runtime 到 React adapter 的 commit / snapshot / transaction 合同。
- 旧滚动模型只能出现在研究材料或明确禁止事项里，不能作为当前实现依据。

## 非目标

- 不把 XMessageList 改成通用虚拟列表。
- 不复制 Telegram Web A 的业务耦合、Teact hooks 或全局 store 组织。
- 不用自定义滚动条算法模拟“无限历史”的高度。
- 不让 React、demo 或接入层读写 raw `scrollTop` 来补救 runtime 设计缺陷。
