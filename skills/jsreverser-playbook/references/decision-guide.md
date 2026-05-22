# 工具选择决策指南

按逆向场景推荐工具组合，避免在 156 个工具中迷失。

## 场景 1：定位签名/加密参数

**目标**：找出某个请求的签名/加密参数是怎么生成的。

### 快速路径（一键）

```
analyze_target --url <url> --autoInjectHooks true
```

### 手动路径（分步）

1. **收集代码**：`collect_code --url <url> --smartMode priority`
2. **识别请求**：`list_network_requests --headerFilter "sign"` → `get_network_request`
3. **追踪发起者**：`get_request_initiator --requestId <id>`
4. **Hook 关键 API**：
   - XHR/Fetch：`hook_fetch` / `hook_xhr_open` / `hook_xhr_set_request_header`
   - 加密库：`hook_cryptojs` / `hook_jsencrypt` / `hook_smcrypto`
5. **定位函数**：`trace_function --target <funcName>` 或 `hook_function --target <funcName>`
6. **查看源码**：`list_scripts` → `get_script_source` / `search_in_sources`

### 选择 Hook 还是断点

| 情况 | 推荐 | 原因 |
|------|------|------|
| 只需要参数/返回值 | `hook_function` / `trace_function` | 不暂停执行，自动化友好 |
| 需要检查局部变量 | `set_breakpoint_on_text` / `set_breakpoint` | 可以 inspect_locals |
| 不知道函数名 | `hook_fetch` / `hook_xhr_open` + `get_request_initiator` | 先从网络层拦截 |

## 场景 2：反调试对抗

**目标**：页面有反调试检测，需要先绕过再分析。

### 一键方案

```
anti_anti_debug
```

### 针对性方案

| 反调试手段 | 推荐工具 |
|-----------|---------|
| 无限 debugger | `bypass_debugger` |
| 时间差检测 | `hook_date_now` / `hook_performance_now`（fixedValue 固定返回值） |
| console 清屏 | `hook_console_clear` + `hook_console_protect` |
| 窗口大小检测 | `fixed_window_size` |
| 页面跳转 | `hook_history_go` + `hook_location_href` + `hook_close` |
| webdriver 检测 | `inject_stealth` |
| console.table 时间检测 | `hook_console_table` |
| Hook 检测 | `anti_anti_hook` |
| 随机数检测 | `hook_random` |

## 场景 3：本地复现签名算法

**目标**：在 Node.js 里跑通加密/签名逻辑。

1. **收集证据**：`observe_flow --url <url>` → `auto_hook --url <url>`
2. **记录证据**：`record_reverse_evidence --taskId <id> --taskSlug <slug> --targetUrl <url> --goal <goal>`
3. **导出 Bundle**：`export_rebuild_bundle --taskId <id> --taskSlug <slug> --targetUrl <url> --goal <goal>`
4. **本地运行**：在 Node.js 中执行，遇到错误时用 `diff_env_requirements --runtimeError <error>`
5. **迭代补环境**：根据代理日志 + `first divergence` 驱动，每补一个立即验证

## 场景 4：代码去混淆

**目标**：还原被混淆的 JS 代码。

| 混淆类型 | 推荐工具 | 说明 |
|---------|---------|------|
| sojson / ob / jsfuck | `deobfuscate_code_vj --code <code> --mode <type>` | AST 转换 |
| 通用混淆 | `deobfuscate_code --code <code>` | AI 辅助 |
| 需要理解逻辑 | `understand_code --code <code>` | AI + 静态分析 |
| 压缩代码 | `minify_code --code <code> --action format` | 格式化 |
| 加密检测 | `detect_crypto --code <code>` | 识别加密算法 |

## 场景 5：WebSocket 协议逆向

**目标**：分析 WebSocket 通信协议。

1. **列出连接**：`list_websocket_connections`
2. **分析消息模式**：`analyze_websocket_messages --wsid <id>`（**必须先做**，尤其是二进制/protobuf）
3. **按类型查看**：`get_websocket_messages --wsid <id> --groupId <group>`
4. **查看单条**：`get_websocket_message --wsid <id> --frameIndex <idx>`

## 场景 6：Wasm 逆向

**目标**：分析 WebAssembly 模块。

1. **检测工具链**：`wasm_capabilities`
2. **导出模块**：`wasm_dump`
3. **检查段信息**：`wasm_inspect_sections --inputPath <path>`
4. **反编译**：`wasm_decompile --inputPath <path>`（含函数摘要和可疑模式检测）
5. **或反汇编**：`wasm_disassemble --inputPath <path>`（WAT 格式）
6. **离线执行**：`wasm_offline_run --inputPath <path> --functionName <name>`
7. **内存检查**：`wasm_memory_inspect`
8. **运行时追踪**：`wasm_vmp_trace`

## 通用原则

- **先 Hook 后断点**：`hook_function` / `trace_function` 优先于 `set_breakpoint`
- **先 observe 后 act**：`collect_code` / `list_network_requests` 先于 `auto_hook`
- **先 summary 后 raw**：`get_hook_data` 先看 summary 视图，按需切 raw
- **先全局后聚焦**：`analyze_target` 一键扫描 → 针对性 Hook → 断点精确定位
