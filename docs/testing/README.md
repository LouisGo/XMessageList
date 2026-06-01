# 测试与验收

本目录定义当前实现的浏览器验收方式。旧报告不作为目标事实；场景清单以
`e2e/runner/scenarioSpecs.ts` 的当前 runner 为准。

## 文件职责

| 文档 | 内容 |
| --- | --- |
| [e2e-scenarios.md](./e2e-scenarios.md) | 当前 runner 场景清单 |
| [oracles.md](./oracles.md) | 判定滚动稳定、分页、滚动条和 overlay 是否正确的证据 |

## 验收原则

- 先验证用户可见行为，再验证内部 diagnostics。
- 不能用绿色单测证明架构正确。
- 所有 scroll specs 都需要真实浏览器证据。
- `scrollHeight` 必须在证据中证明只来自当前 DOM segment。
- correctness lane: `npm run e2e:correctness`
- perf lane: `npm run e2e:perf`
