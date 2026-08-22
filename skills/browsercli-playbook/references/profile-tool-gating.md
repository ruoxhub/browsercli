# Profile 工具档位（Gating）

`JS_REVERSE_TOOL_PROFILE` 环境变量控制 browsercli 向 LLM 宿主暴露的工具集。**根据当前任务复杂度选择档位**，避免在上下文窗口里堆全量工具定义。

## 两档关系

```
workflow ⊂ full
```

| Profile    | 工具数 | 暴露范围                                                                                                                                   | 适用场景                                           |
| ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `workflow` | ~110   | 日常逆向（Observe / Capture / Network / Hook / Analyzer / WebSocket / Console / Stealth / Emulation / Site Experience / Workflow Advisor） | **默认推荐** — 浏览器自动化 + JS 逆向日常          |
| `full`     | 141    | 全部（追加 Debugger / Wasm / Anti-Debug / Performance / Rebuild）                                                                          | 调试器分析、Wasm 逆向、env rebuild 导出、perf 诊断 |

## 怎么设置

### 启动 Worker 时

```bash
JS_REVERSE_TOOL_PROFILE=workflow browsercli start
JS_REVERSE_TOOL_PROFILE=full     browsercli start
```

### CLI 单次调用

```bash
JS_REVERSE_TOOL_PROFILE=workflow browsercli list-tools
```

## 切换决策

| 你要做的                             | 推荐 profile                                                    |
| ------------------------------------ | --------------------------------------------------------------- |
| 排查页面 / 找签名 / 装 hook / 看网络 | `workflow`（默认）                                              |
| 改 Wasm 模块 / 反编译                | `full`                                                          |
| 调试器内看闭包变量                   | `full`                                                          |
| 跑 Performance trace                 | `full`                                                          |
| 导出 Node bundle                     | `full`                                                          |
| 一键反调试                           | `full`（但有 `anti_anti_debug` 也可以在 workflow 中视配置而定） |

## 启动时检查

新会话开局第一件事是确认 profile 与可用工具：

```bash
# 1. 看当前暴露的工具数
browsercli list-tools --json | jq 'length'
# → ~110 / 141

# 2. 验证关键工具是否暴露
browsercli list-tools --json | jq -r '.[].name' | grep -E "^(hook_function|export_rebuild_bundle|wasm_decompile)$"
```

如果某个工具未暴露但你**确实需要它**，要么：

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
