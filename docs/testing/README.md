# 测试与验收

本目录定义 next 分支文档对应的验收方式。旧 E2E 报告不再作为目标事实；后续实现必须用这里的 scenarios 和 oracles 重建测试矩阵。

## 文件职责

| 文档 | 内容 |
| --- | --- |
| [oracles.md](./oracles.md) | 判定滚动稳定、分页、滚动条是否正确的证据 |
| [e2e-scenarios.md](./e2e-scenarios.md) | 必须覆盖的浏览器场景 |

## 验收原则

- 先验证用户可见行为，再验证内部 diagnostics。
- 不能用绿色单测证明架构正确。
- 所有 scroll specs 都需要真实浏览器证据。
- `scrollHeight` 必须在证据中证明只来自当前 DOM segment。
