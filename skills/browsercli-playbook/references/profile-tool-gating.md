# Profile 工具档位（Gating）

`JS_REVERSE_TOOL_PROFILE` 环境变量控制 browsercli 向 LLM 宿主暴露的工具集。**根据当前任务复杂度选择档位**，避免在上下文窗口里堆 141 个工具定义。

## 三档关系

```
search ⊂ workflow ⊂ full
```

| Profile | 工具数 | 暴露范围 | 适用场景 |
|---------|--------|----------|----------|
| `search` | 1 | 仅 `search_tools` | 上下文极紧的 LLM 宿主（7B/13B 模型、长上下文不可用），按需发现工具 |
| `workflow` | ~100 | search + 日常逆向（Observe / Capture / Network / Hook / Analyzer / WebSocket / Console / Stealth / Emulation / Site Experience / Workflow Advisor） | **默认推荐** — 浏览器自动化 + JS 逆向日常 |
| `full` | 141 | 全部（追加 Debugger / Wasm / Anti-Debug / Performance / Rebuild） | 调试器分析、Wasm 逆向、env rebuild 导出、perf 诊断 |

## 怎么设置

### 启动 Worker 时

```bash
JS_REVERSE_TOOL_PROFILE=workflow browsercli start
JS_REVERSE_TOOL_PROFILE=full     browsercli start
JS_REVERSE_TOOL_PROFILE=search   browsercli start   # 极少用
```

### CLI 单次调用

```bash
JS_REVERSE_TOOL_PROFILE=workflow browsercli call list-tools
```

### 编程式发现（推荐做法）

即便在 `search` profile 下，也能按需发现工具：

```bash
# 发现所有 wasm 工具
browsercli search-tools "wasm"

# 发现所有 hook 工具
browsercli search-tools "hook"

# 发现所有 debugger 工具（即使是 full-only）
browsercli search-tools "debugger breakpoint"
```

`search_tools` 返回的字段：

| 字段 | 含义 |
|------|------|
| `name` | 工具名 |
| `description` | 工具描述 |
| `domain` | 所属功能域 |
| `profile` | 所属 profile（`search` / `workflow` / `full`） |

## 切换决策

| 你要做的 | 推荐 profile |
|---------|------------|
| 排查页面 / 找签名 / 装 hook / 看网络 | `workflow`（默认） |
| 改 Wasm 模块 / 反编译 | `full` |
| 调试器内看闭包变量 | `full` |
| 跑 Performance trace | `full` |
| 导出 Node bundle | `full` |
| 一键反调试 | `full`（但有 `anti_anti_debug` 也可以在 workflow 中视配置而定） |
| 仅在受限 LLM 宿主运行 | `search` + 频繁 `search-tools` |

## 启动时检查

新会话开局第一件事是确认 profile 与可用工具：

```bash
# 1. 看当前暴露的工具数
browsercli list-tools --json | jq 'length'
# → 1 / ~100 / 141

# 2. 验证关键工具是否暴露
browsercli list-tools --json | jq -r '.[].name' | grep -E "^(hook_function|export_rebuild_bundle|wasm_decompile)$"
```

如果某个工具未暴露但你**确实需要它**，要么：

- 用 `search_tools` 查（如果它在 full 中）
- 切换 profile：`JS_REVERSE_TOOL_PROFILE=full browsercli restart`（或 `start` + `stop`）
- 不要伪造工具调用或绕过 profile

## 错误处理

调用一个不属于当前 profile 的工具，会返回：

```
Error: Tool "wasm_decompile" is not available in profile "workflow".
Available profiles: ["workflow", "full"].
Hint: set JS_REVERSE_TOOL_PROFILE=full and restart worker.
```

不要尝试通过别名 / 大小写 / 连字符变体绕过 — 都被识别为同一个工具。
