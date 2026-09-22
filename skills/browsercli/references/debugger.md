# 调试器、断点与作用域检查参考文档 (Debugging Reference)

断点控制、单步步进、调用栈分析、局部作用域变量检查及条件日志点追踪工具。

## 概览 (Overview)

> **原则提示 (Breakpoint-last)**：断点会冻结浏览器主线程并可能引发心跳超时或反爬检测。优先使用 `hook_function` 或 `trace_function` 进行非阻塞监控；仅在需要深入分析压缩混淆代码的局部闭包变量、控制流分支时使用断点。

| 工具名称                               | 功能描述                                                                 | 核心参数                                                                           |
| :------------------------------------- | :----------------------------------------------------------------------- | :--------------------------------------------------------------------------------- |
| `set_breakpoint`                       | 按脚本 URL 或 scriptId 及行号设置 JS 断点（支持条件表达式）              | `--lineNumber <num>`, `[--url <str>]`, `[--scriptId <str>]`, `[--condition <str>]` |
| `set_breakpoint_on_text`               | 根据代码文本片段自动搜索并在精确定位处打断点                             | `--text <str>`, `[--urlFilter <str>]`, `[--condition <str>]`                       |
| `remove_breakpoint`                    | 移除指定 ID 的断点                                                       | `--breakpointId <str>`                                                             |
| `list_breakpoints`                     | 列出当前调试会话中所有活跃断点                                           | 无                                                                                 |
| `break_on_xhr`                         | 在 XHR/Fetch 请求 URL 包含指定子串时触发断点暂停                         | `--url <str>`                                                                      |
| `remove_xhr_breakpoint`                | 移除指定的 XHR/Fetch 断点                                                | `--url <str>`                                                                      |
| `xhr_to_js_breakpoint`                 | 设置 XHR 断点并在命中后联动定位到发起调用的 JS 源码行                    | `[--url <str>]`                                                                    |
| `step_into` / `step_over` / `step_out` | 单步进入 / 单步跳过 / 单步跳出函数（自动返回暂停后调用栈）               | `[--includeScopes <bool>]`                                                         |
| `resume` / `pause`                     | 恢复代码执行 / 强制暂停当前 JavaScript 运行                              | 无                                                                                 |
| `get_paused_info`                      | 断点命中时获取当前调用栈、源码位置与作用域变量                           | `[--includeScopes <bool>]`                                                         |
| `inspect_locals`                       | 检查当前暂停调用栈中所有栈帧的局部变量摘要                               | 无                                                                                 |
| `inspect_object`                       | 深度展开检查一个 JS 对象的属性、原型链与方法                             | `--expression <str>`, `[--depth <num>]`                                            |
| `evaluate_on_callframe`                | 在指定的暂停调用帧上下文中求值执行 JS 表达式                             | `--expression <str>`, `[--frameIndex <num>]`                                       |
| `evaluate_script`                      | 在页面上下文或内容脚本中直接执行 JS（无需处于暂停状态）                  | `--function <str>`, `[--context <str>]`, `[--filePath <str>]`                      |
| `trace_function`                       | 无需暂停，使用条件日志点（Logpoint）追踪记录指定名称函数的调用参数与结果 | `--target <str>`, `[--logArgs <bool>]`, `[--logResult <bool>]`                     |
| `monitor_events`                       | 监听指定 DOM 元素或 window 上的事件并将流输出到控制台                    | `[--selector <str>]`, `[--events <arr>]`, `[--monitorId <str>]`                    |
| `stop_monitor`                         | 停止指定的事件监控                                                       | `--monitorId <str>`                                                                |
| `get_ai_debug_status`                  | 查看当前调试器状态（是否暂停、活跃断点数、加载脚本数等）                 | 无                                                                                 |

---

## 详细命令与示例

### 1. 设置与管理断点

```bash
# 1. 在指定脚本第 150 行设置条件断点
browsercli call set_breakpoint --url "app.min.js" --lineNumber 150 --condition "token !== undefined"

# 2. 根据特征文本快速在压缩代码中下断
browsercli call set_breakpoint_on_text --text "encryptPassword(" --urlFilter "main.js"

# 3. 查看与清理断点
browsercli call list_breakpoints
browsercli call remove_breakpoint --breakpointId "1:150:0"
```

### 2. XHR / Fetch 断点拦截

```bash
# 拦截包含特定 API 路径的请求
browsercli call break_on_xhr --url "/api/v2/trade/submit"

# 拦截并自动定位到发起请求的业务 JS 调用栈
browsercli call xhr_to_js_breakpoint --url "/api/v2/trade/submit"
```

### 3. 断点暂停后的步进与状态检查

断点命中后，可使用单步控制并检查作用域内的混淆局部变量：

```bash
# 获取当前暂停栈和作用域信息
browsercli call get_paused_info --includeScopes true

# 一览各栈帧的局部变量
browsercli call inspect_locals

# 在栈顶帧求值混淆变量解密结果
browsercli call evaluate_on_callframe --expression "_0x2b4a('0x12')" --frameIndex 0

# 深度展开对象结构（包括原型链）
browsercli call inspect_object --expression "window.__INITIAL_STATE__" --depth 2

# 单步控制
browsercli call step_over
browsercli call step_into
browsercli call resume
```

### 4. 非阻塞日志点追踪 (`trace_function`)

在不中断运行的情况下动态打印参数：

```bash
browsercli call trace_function \
  --target "generateSignature" \
  --logArgs true \
  --logResult true \
  --logStack true
```

### 5. 页面脚本直接执行 (`evaluate_script`)

```bash
# 直接获取全局变量或执行解密逻辑
browsercli call evaluate_script --function "() => window.btoa(encodeURIComponent('test'))"

# 执行较长代码并将返回数据直接持久化到文件
browsercli call evaluate_script \
  --function "() => JSON.stringify(window.__CONFIG__)" \
  --filePath "artifacts/config.json"
```
