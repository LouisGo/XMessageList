# E2E App

`src/e2e-app` 是 `e2e/runner` 使用的浏览器端 harness。通过 E2E 桥接暴露确定性动作、evidence 和 oracle。

## 目录规则

- `app/`：E2E React app 外壳。
- `actions/`：动作分发与 DOM 动作辅助。
- `bridge/`：浏览器桥接、evidence 序列化与失败产物。
- `oracles/`：evidence、runtime、滚动及浮层断言。

E2E app 可读取为测试创建的公开 evidence 和 DOM 属性，但不得触及 runtime 私有 controller 对象以通过 oracle。
