# 领域文档（Domain Docs）

工程 skill 在探索代码库时，应当如何消费本仓库的领域文档。

## 探索之前，先读这些

- 仓库根目录的 **`GLOSSARY.md`**，或
- 仓库根目录的 **`GLOSSARY-MAP.md`**（如果存在）：它指向每个上下文一个 `GLOSSARY.md`。读取与主题相关的每一个。
- **`docs/adr/`**：读取触及你即将工作区域的 ADR。在多上下文仓库中，还要检查 `src/<context>/docs/adr/` 里的上下文范围决策。

如果这些文件中有任何不存在，**静默继续**。不要标记它们的缺失；不要建议预先创建它们。`/domain-modeling` skill（通过 `/grill-with-docs` 和 `/improve-codebase-architecture` 抵达）会在术语或决策真正被解决时惰性创建它们。

## 文件结构

单上下文仓库（大多数仓库）：

```
/
├── GLOSSARY.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

多上下文仓库（根目录存在 `GLOSSARY-MAP.md`）：

```
/
├── GLOSSARY-MAP.md
├── docs/adr/                          ← 系统级决策
└── src/
    ├── ordering/
    │   ├── GLOSSARY.md
    │   └── docs/adr/                  ← 特定上下文的决策
    └── billing/
        ├── GLOSSARY.md
        └── docs/adr/
```

## 使用 glossary 的词汇

当你的输出点名某个领域概念时（在 issue 标题、重构提案、假设、测试名称里），使用 `GLOSSARY.md` 中定义的术语。不要漂移到 glossary 明确避免的同义词。

如果你需要的概念还不在 glossary 里，那是一个信号：要么你在发明项目不使用的语言（重新考虑），要么存在一个真实的缺口（为 `/domain-modeling` 记下来）。

## 标记 ADR 冲突

如果你的输出与某个既有 ADR 矛盾，明确地揭示它，而不是默默覆盖：

> _与 ADR-0007（事件溯源订单）冲突，但值得重新讨论，因为……_
