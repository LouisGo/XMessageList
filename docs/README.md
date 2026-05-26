# XMessageList 文档入口

本目录是 next 分支的开工依据。所有文档统一转向 **Telegram Web A 风格的 loaded segment native scroll**：

- scroll container 的 `scrollHeight` 只表达当前已加载、已挂载 segment 的真实 DOM 高度。
- 不再用 top spacer / bottom spacer 伪造未加载历史高度。
- 上下分页由正常文档流中的 before / after trigger 触发。
- 视觉稳定依赖 message anchor 的 DOM rect 差值补偿。
- 滚动条表现必须来自真实 native scroll range；自定义 overlay 只能镜像，不能发明虚拟滚动范围。

## 文档地图

| 目录 | 职责 | 先读 |
| --- | --- | --- |
| [architecture](./architecture/README.md) | 模型、所有权、状态边界、术语和 public API | [principles.md](./architecture/principles.md) |
| [interaction-specs](./interaction-specs/README.md) | 用户可观察的滚动、滚动条、分页、跳转规格 | [scrolling.md](./interaction-specs/scrolling.md) |
| [implementation](./implementation/README.md) | DOM、transaction、measurement、React adapter、性能施工图 | [dom-layout.md](./implementation/dom-layout.md) |
| [testing](./testing/README.md) | E2E 场景、oracle、证据结构 | [oracles.md](./testing/oracles.md) |
| [research](./research/telegram-web-a.md) | Telegram Web A 调研与取舍 | [telegram-web-a.md](./research/telegram-web-a.md) |
| [migration](./migration/README.md) | 从旧 spacer 文档/实现切换到新基座 | [README.md](./migration/README.md) |
| [roadmap.md](./roadmap.md) | 文档后的实施阶段和退出标准 | [roadmap.md](./roadmap.md) |

## 推荐阅读顺序

1. [architecture/principles.md](./architecture/principles.md)
2. [architecture/naming-and-api.md](./architecture/naming-and-api.md)
3. [architecture/layering-and-ownership.md](./architecture/layering-and-ownership.md)
4. [architecture/anchor-and-data-window.md](./architecture/anchor-and-data-window.md)
5. [interaction-specs/scrolling.md](./interaction-specs/scrolling.md)
6. [interaction-specs/paging.md](./interaction-specs/paging.md)
7. [interaction-specs/scrollbar.md](./interaction-specs/scrollbar.md)
8. [implementation/dom-layout.md](./implementation/dom-layout.md)
9. [implementation/transactions-and-measurement.md](./implementation/transactions-and-measurement.md)
10. [testing/oracles.md](./testing/oracles.md)
11. [roadmap.md](./roadmap.md)

## 统一口径

- 对外组件、hooks、runtime facade 和 package export 统一使用 `MessageList` 命名。
- `Viewport` 只用于描述可视区域、滚动容器、anchor、measurement 和 runtime 内部事件。
- `Projection` 只用于 runtime 到 React adapter 的 commit / snapshot / transaction 合同。
- 旧 `MessageViewport*`、`renderWindow`、spacer、`viewportEffect` 只能出现在迁移对照或删除清单里。

## 非目标

- 不把 XMessageList 改成通用虚拟列表。
- 不复制 Telegram Web A 的业务耦合、Teact hooks 或全局 store 组织。
- 不用自定义滚动条算法模拟“无限历史”的高度。
- 不让 React、demo 或接入层读写 raw `scrollTop` 来补救 runtime 设计缺陷。
