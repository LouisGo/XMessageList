# Message List 迁移边界

## 1. Scope

本文档只定义：

```text
迁移期 message list 容器与新 runtime 架构的边界
```

不把现有容器实现作为设计来源。

新架构准绳仍然是：

- Message Identity Anchor
- View-agnostic Data Runtime
- Deterministic Viewport Runtime
- React Projection

---

# 2. Current Role

迁移期 `@messageList` 只能被视为：

```text
integration boundary
```

而不是：

```text
architecture pattern
```

它可以暂时承接：

- 旧入口接入
- feature flag 分流
- UI 挂载点
- runtime adapter
- 行为兼容层

它不应该继续沉淀：

- 新数据读取模型
- 新滚动状态机
- 新 anchor 语义
- 新 Bridge 合同

---

# 3. Naming Boundary

新架构命名使用：

- message anchor
- message data runtime
- message viewport runtime
- projection

`message list` 只用于：

```text
legacy / transition boundary
```

原因：

```text
list 暗示组件和集合
```

而新架构核心是：

```text
viewport stability runtime
```

---

# 4. Compatibility Surface

迁移期必须保持用户可见行为：

- latest 进入底部
- unread 进入未读上下文
- restored 恢复历史位置
- jump 定位目标消息
- prepend 不跳动
- dynamic height 不漂移
- bottom locked 时新消息追底

但内部实现必须逐步迁移到：

```text
semantic command
-> data runtime
-> viewport runtime
-> React projection
```

而不是继续扩大：

```text
component-owned scroll logic
```

---

# 5. Adapter Rule

旧入口如果仍然存在，必须被转换成 runtime command。

例如：

```text
legacy jump event
-> { type: 'jump', target: MessageIdentityAnchor }
```

```text
legacy scroll to bottom
-> { type: 'followBottom' }
```

adapter 可以翻译事件。

adapter 不可以拥有：

- anchor lifecycle
- measurement cache
- bottom lock state
- DataWindow merge
- scroll correction

---

# 6. Isolation Rules

迁移期间禁止新增：

- 直接面向 `@messageList` 的 main Bridge 合同
- 以 DOM index 为语义的 restore 协议
- React state 驱动的 scroll recovery
- component 内部的 around data cache
- component 内部的 optimistic merge 协议
- 分散的 `scrollTop` 写入点

迁移期间允许：

- 用 facade 包装旧调用
- 用 feature flag 控制入口
- 用 adapter 转换旧事件
- 用 adapter 兼容旧 optimistic 状态
- 用测试锁住用户可见行为

---

# 7. Extraction Order

推荐顺序：

```text
① Anchor language
```

```text
② Data runtime boundary
```

```text
③ Viewport runtime ownership
```

```text
④ React projection slimming
```

```text
⑤ Legacy adapter deletion
```

不要先做：

```text
component tree rewrite
```

原因：

```text
组件形状不是架构核心
```

---

# 8. Done Criteria

迁移完成的判断不是：

```text
目录名消失
```

而是：

| Criterion | Meaning                               |
| --------- | ------------------------------------- |
| Anchor    | 跨层只传 MessageIdentityAnchor        |
| Data      | main / renderer 数据层不感知 DOM      |
| Viewport  | scrollTop 写入只属于 viewport runtime |
| React     | React 只做 projection                 |
| Actions   | 用户入口只发 semantic command         |
| Legacy    | legacy adapter 不再拥有状态机         |

---

# 9. Non-goals

本文档不记录：

- 旧组件树细节
- 历史 bug 列表
- 具体文件搬迁计划
- 临时实现技巧

核心原则：

```text
兼容行为
```

不是：

```text
继承旧心智
```
