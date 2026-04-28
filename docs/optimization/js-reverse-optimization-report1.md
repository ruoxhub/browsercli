# js-reverse 工具问题分析与优化建议

> 基于 DeepSeek Chat 接口逆向实战的体验总结  
> 日期：2026-04-27  
> 工具版本：当前运行版本（146 个工具）

---

## 一、目标与边界

本文档只记录本次实战中实际遇到、可复现或可验证的问题，并给出最小优化建议。

**不做假设**：

- 不假设所有站点都会遇到相同问题。
- 不把一次 DeepSeek Chat 实战直接推导为通用产品路线。
- 不建议新增大功能，除非它能修复当前链路中的明确断点。

**成功标准**：

1. 核心工具失败时能返回可诊断错误，或提供可用降级路径。
2. 调试链路从请求断点命中到变量检查可以连续完成。
3. 大文件脚本可以按需读取、搜索和定位。
4. Windows 用户不需要依赖 Unix 命令完成基础操作。

---

## 二、P0：核心工具稳定性

### 2.1 `collect_code` 崩溃

**现象**：

```text
代码收集失败：Cannot read properties of undefined (reading 'collect')
```

**影响**：无法收集页面代码，核心功能不可用。多次重试均失败。

**最小修复建议**：

- 修复 `collect` 对象初始化或注入时序。
- 在调用前检查依赖对象是否存在。
- 返回结构化错误，说明缺失组件和建议重试动作。

**验收标准**：

- 当页面脚本收集器未初始化时，工具不抛原始 JS 异常。
- 错误信息能指出缺失的内部组件。
- 正常页面上 `collect_code` 至少能返回脚本列表或明确的空结果原因。

### 2.2 `search_in_scripts` 崩溃

**现象**：

```text
搜索失败：Cannot read properties of undefined (reading 'getFilesByPattern')
```

**影响**：无法在页面脚本中搜索关键词，阻断签名逻辑定位。

**最小修复建议**：

- 修复脚本索引对象初始化时序。
- 当索引不可用时，降级为遍历已知脚本内容搜索。
- 搜索超时时返回已找到的部分结果和超时标记。

**验收标准**：

- 索引未就绪时不崩溃。
- 对同一关键词，索引搜索与降级搜索至少能返回一致的命中文件集合。
- 超时结果包含 `partial: true` 或等价字段。

---

## 三、P0：参数文档与错误提示

### 3.1 当前问题

| 工具 | 报错信息 | 使用障碍 |
| --- | --- | --- |
| `search_in_sources` | `query 参数不能为空` | 不确定参数名是 `query` 还是 `pattern` |
| `trace_function` | `target 参数不能为空` | 不确定参数名是 `target` 还是 `functionName` |
| `hook_function` | `requires a "target" string parameter` | 参数格式不明确 |
| `evaluate_on_callframe` | `Invalid parameters` | `callFrameId` 格式不清楚 |
| `set_breakpoint` | `url 参数不能为空` | 必填参数不清楚 |

### 3.2 最小修复建议

优先改错误信息，其次再补完整帮助系统。错误信息是用户已经失败时最需要的反馈，收益更直接。

**示例**：

```text
query 参数不能为空。
正确用法: js-reverse call search_in_sources --query "sign" --scriptId "23"
```

**建议补充 `list-tools` 参数签名**：

```text
search_in_sources --query <str> [--scriptId <id>]
trace_function    --target <str> [--captureArgs]
hook_function     --target <str> [--captureArgs]
```

**验收标准**：

- 每个必填参数错误都给出参数名、类型和最短可运行示例。
- `list-tools` 能显示核心工具的参数签名。
- 文档示例与实际 MCP schema 保持一致。

---

## 四、P1：调试链路断裂

### 4.1 当前链路

| 步骤 | 状态 | 结果 |
| --- | --- | --- |
| `xhr_to_js_breakpoint` 命中断点 | 成功 | 暂停在 `/api/v0/chat/completion` |
| `get_paused_info` 获取调用栈 | 成功 | 返回 4 个 call frame |
| `evaluate_on_callframe` 查看变量 | 失败 | `Invalid parameters` |

### 4.2 最小修复建议

- 保证 `get_paused_info` 返回的 `callFrameId` 可直接传给 `evaluate_on_callframe`。
- 在 `evaluate_on_callframe` 参数错误时输出实际期望格式。
- 增加一个只读快捷命令 `inspect_locals`，用于验证断点上下文是否可读。

**验收标准**：

- 用户复制 `get_paused_info` 的 `callFrameId` 后可以直接执行表达式。
- 参数错误时不只返回 `Invalid parameters`。
- `inspect_locals` 能列出当前暂停栈中至少 frame 名称、scriptId 和局部变量摘要。

---

## 五、P1：大文件脚本处理

### 5.1 当前问题

| 问题 | 现象 |
| --- | --- |
| `get_script_source` 超时 | 1.17MB 的压缩 JS 无法获取 |
| 单行压缩输出 | 搜索命中后难以定位上下文 |
| 无分片读取 | 不能只读取目标区域 |

### 5.2 最小修复建议

先实现分片读取，再考虑流式输出或自动格式化。分片读取能直接解决超时、内存和定位问题。

```bash
js-reverse call get_script_source --scriptId "23" --offset 0 --limit 102400
```

搜索工具可以返回命中位置附近的窗口内容：

```bash
js-reverse call search_in_sources --query "powSolver" --scriptId "23" --contextChars 300
```

**验收标准**：

- 1MB 以上脚本可按 `offset` / `limit` 稳定读取。
- 搜索结果包含字符偏移和上下文片段。
- 单个大脚本读取失败不影响其他脚本搜索。

---

## 六、P1：Hook 注入时机

### 6.1 当前问题

| 问题 | 现象 |
| --- | --- |
| `hook_fetch` 无数据 | Hook 注入晚于页面初始化 |
| `auto_hook` 返回 0 | `totalHooks: 0` |
| `observe_flow` 返回 0 脚本 | 页面已加载但 `scriptCount: 0` |

### 6.2 最小修复建议

- 给 preload 注入增加验证结果，确认脚本是否真的在页面加载前运行。
- 统一返回 Hook 状态：已注入、已命中、命中数量、失败原因。
- 对新 frame 或新脚本加载做一次补注入。

**验收标准**：

- Hook 命令返回激活状态，而不是只返回“调用成功”。
- 未捕获请求时能区分“未注入”“注入过晚”“已注入但未命中”。
- 页面刷新后 preload Hook 能稳定早于业务请求执行。

---

## 七、P2：Windows 兼容性

### 7.1 当前问题

| 问题 | 说明 |
| --- | --- |
| `head` 不存在 | PowerShell 不支持常见 Unix 管道命令 |
| 输出编码不稳定 | 中文输出偶现乱码 |
| 路径处理不一致 | 部分工具对 Windows 路径分隔符不兼容 |

### 7.2 最小修复建议

- 工具本身提供 `--limit` / `--offset`，避免依赖系统管道。
- CLI 输出固定为 UTF-8。
- 文档中的示例同时给出 PowerShell 写法。

**验收标准**：

- README 或工具帮助中不要求 Windows 用户使用 `head`、`grep` 等 Unix 命令完成基础流程。
- 中文错误信息在 PowerShell 下显示正常。
- 文件路径输入支持 Windows 反斜杠和 POSIX 斜杠。

---

## 八、P2/P3：功能补齐候选

这些能力有价值，但不是当前链路的第一阻塞点。建议在 P0/P1 完成后再评估。

| 优先级 | 能力 | 价值 | 风险 |
| --- | --- | --- | --- |
| P2 | 请求响应体捕获 | 减少手动抓包 | 需要处理体积、脱敏和隐私边界 |
| P3 | WASM 模块检查 | 支持高级逆向场景 | 实现复杂，使用频率较低 |
| P3 | 闭包变量检查 | 有助于定位私有状态 | 可能依赖 V8/Chrome 内部细节 |
| P3 | 批量 Hook/断点配置 | 提升专家效率 | 容易扩大配置复杂度 |
| P3 | 断点 REPL | 提升调试体验 | 需要清晰的暂停态生命周期管理 |

---

## 九、建议执行顺序

| 顺序 | 优化项 | 理由 |
| --- | --- | --- |
| 1 | 修复 `collect_code` / `search_in_scripts` 崩溃 | 核心功能不可用 |
| 2 | 改善必填参数错误提示 | 最小改动，直接降低试错成本 |
| 3 | 修复 `evaluate_on_callframe` 参数链路 | 断点命中后才能继续分析 |
| 4 | 支持大文件分片读取和搜索上下文 | 现代前端脚本常见问题 |
| 5 | 增加 Hook 注入状态与 preload 验证 | 明确捕获失败原因 |
| 6 | 补 Windows 适配文档与编码处理 | 提升基础可用性 |
| 7 | 评估响应体、WASM、闭包、批量配置、REPL | 高级能力，后置 |

---

## 十、总结

本次实战暴露出的主要问题不是工具数量不足，而是关键链路不够连续：

1. 代码收集和脚本搜索会崩溃。
2. 参数错误缺少可执行示例。
3. 断点命中后无法稳定读取变量。
4. 大文件脚本缺少分片和上下文定位能力。
5. Hook 成功与否缺少可观察状态。

建议先修复 P0/P1 项，目标是让一次标准逆向流程可以从页面观察、脚本搜索、断点命中、变量检查到证据沉淀连续完成。高级能力应在核心链路稳定后再逐步加入。
