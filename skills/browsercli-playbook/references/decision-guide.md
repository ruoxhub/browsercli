# 工具选择决策指南

按逆向场景推荐工具组合，**135 个工具太多，按场景走才能避免迷失**。

> **基础心法**：每条路径都遵循 `Observe → Capture → Rebuild → Patch → PureExtraction → Port`。
> 任何阶段如"找不到目标"，**回退**到上一阶段，而不是继续往后补。

---

## 场景 1：定位签名/加密参数

**目标**：找出某个请求的签名/加密参数是怎么生成的。

### 快速路径（一键）

```
analyze_target --url <url> --autoInjectHooks true
# 或更重的版本
analyze_pipeline --url <url> --deep true
```

### 手动路径（分步，更可控）

```
# 1) 优先收集（避免一次性收 1000 个脚本）
collect_code --url <url> --smartMode priority --includeExternal true

# 2) 锁定目标请求
list_network_requests --headerFilter "sign" --urlFilter "api.example.com"
get_network_request --reqid <id>            # 看完整 body + initiator

# 3) 反查 JS 调用栈
get_request_initiator --requestId <id>

# 4) Hook 关键 API
create_hook --type fetch   --params []  --description "fetch capture"  →  inject_hook
# 或 XHR：
create_hook --type xhr     --params []  --description "xhr capture"    →  inject_hook
# 或加密库：
hook_cryptojs    # 一次性 Hook 所有对称/hash 算法
hook_jsencrypt   # RSA
hook_smcrypto    # 国密

# 5) 定位函数（如果已知名字）
trace_function --target <funcName>           # 日志点（不暂停）
# 或：
hook_function --target <funcName>           # 函数级 Hook

# 6) 拿源码确认
list_scripts --filter <host>
get_script_source --scriptId <id> --startLine <n> --endLine <m>
search_in_sources --query "encrypt|sign|hash"
```

### Hook vs 断点决策（详细）

| 情况              | 推荐                                                      | 原因                     |
| ----------------- | --------------------------------------------------------- | ------------------------ |
| 只需要参数/返回值 | `hook_function` / `trace_function`                        | 不暂停，自动化友好       |
| 需要检查局部变量  | `set_breakpoint_on_text` + `inspect_locals`               | Hook 拿不到闭包变量      |
| 不知道函数名      | `create_hook --type fetch\|xhr` + `get_request_initiator` | 从网络层反查             |
| 首屏初始化        | `inject_preload_script`                                   | 脚本注册前采样           |
| 高频调用          | `create_hook` + `inject_hook --persistent true`           | 断点会被自动循环检测移除 |
| 加密库专项        | `hook_cryptojs` / `hook_jsencrypt` / `hook_smcrypto`      | 专项工具比通用 Hook 稳定 |
| 反调试绕过        | `anti_anti_debug` / `bypass_debugger`                     | 一键更可靠               |

---

## 场景 2：反调试对抗

**目标**：页面有反调试检测，需要先绕过再分析。

### 一键方案

```
anti_anti_debug
# 一次性：固定窗口/冻结时间/拦截跳转/屏蔽 webdriver
```

### 针对性方案

| 反调试手段                                   | 推荐工具                                                                       | 备注                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------- |
| 无限 `debugger`                              | `bypass_debugger`                                                              | 移除 eval/Function/constructor 里的 debugger 关键字 |
| 时间差检测（`Date.now` / `performance.now`） | `create_hook --type timer --params <fixedValue>`                               | 固定返回值                                          |
| `Math.random` 检测                           | 同上 timer 类型（random 也算 time 类副作用）                                   | 固定种子                                            |
| `console.clear` 清屏                         | `create_hook --type function --target console.clear`                           | 拦截清屏                                            |
| 窗口大小检测                                 | `create_hook --type property --target window.outerWidth`                       | 固定属性值                                          |
| 页面跳转                                     | `create_hook --type function --target history.go\|location.href\|window.close` | 拦截跳转                                            |
| webdriver / chrome.runtime                   | `inject_stealth --preset <name>`                                               | 先 `list_stealth_presets` 选                        |
| `console.table` 时间检测                     | `create_hook --type function --target console.table`                           | 中和                                                |
| Hook 检测（`Function.prototype.toString`）   | `create_hook --type function --target Function.prototype.toString`             | 替换为原生字符串                                    |

> 详细 hook 写法：`references/hook-patterns.md`。

---

## 场景 3：本地 Node 复现

**目标**：在 Node.js 里跑通加密/签名逻辑（不追求完全模拟浏览器）。

```
# 1) 观察 + 采样
observe_flow --url <url>
auto_hook   --url <url> --exportResults true

# 2) 记录证据
record_reverse_evidence \
  --taskId <id> --taskSlug <slug> \
  --targetUrl <url> --goal "实现 sign 参数本地复现" \
  --entry "[{step:1,action:'hook fetch',args:...}]"

# 3) 导出 Bundle
export_rebuild_bundle \
  --taskId <id> --taskSlug <slug> \
  --targetUrl <url> --goal "本地复现 sign" \
  --autoGenerate true

# 4) 本地跑（生成 env/entry.js env/env.js env/polyfills.js env/capture.json）
cd <taskDir> && node env/entry.js

# 5) 出错时
diff_env_requirements --runtimeError "<error msg>"  # 仅作辅助
# 真正要读：浏览器代理 env log + 当前 first divergence
```

### 迭代约束

- 一次只做一个**最小因果单元**补丁（值 / 函数壳 / 返回对象 / 最小对象契约）
- 补丁后立即复测
- 6 个补丁未收敛 → 回浏览器取证，**不要硬补**
- 完整流程：`references/local-rebuild.md` + `references/env-patching.md`

---

## 场景 4：代码去混淆

**目标**：还原被混淆的 JS 代码，**目标是"可读语义块"而非一次性还原**。

| 目标                     | 工具                                                                   | 说明                                  |
| ------------------------ | ---------------------------------------------------------------------- | ------------------------------------- |
| 字符串表 + `_0x***` 索引 | `deobfuscate_code --code <c> --aggressive true --renameVariables true` | AI 辅助批量替换                       |
| 控制流平坦化             | `deobfuscate_code` + 手动 pass（`references/ast-deobfuscation.md`）    | AST 4-pass：常量→字符串→控制流→死代码 |
| 理解业务逻辑             | `understand_code --code <c> --focus business`                          | AI + 静态分析                         |
| 理解安全/风控            | `understand_code --code <c> --focus security`                          | 同上，焦点切换                        |
| 文件/项目级摘要          | `summarize_code --mode project --code <path>` 或 `--url <repoUrl>`     | 项目级概览                            |
| 检测加密算法             | `detect_crypto --code <c> --useAI true`                                | 识别 CryptoJS / WebCrypto / 自实现    |
| 综合风险评分             | `risk_panel --code <c> --includeHookSignals true --hookId <id>`        | 把 Hook 数据也纳入风险面板            |

> AST pass 固定顺序：常量传播 → 字符串表替换 → 控制流还原 → 死代码清理。
> 每步后跑一次 I/O 对比（关键函数 + 关键请求），不一致回滚最近变换。

---

## 场景 5：WebSocket 协议逆向

**目标**：分析 WebSocket 通信协议（含二进制/protobuf）。

```
# 1) 列连接
list_websocket_connections

# 2) 必做：分析消息模式（先看分布，再下钻单条）
analyze_websocket_messages --wsid <id>

# 3) 按类型查看
get_websocket_messages --wsid <id> --groupId <g> --direction client→server
get_websocket_messages --wsid <id> --groupId <g> --direction server→client

# 4) 单条下钻
get_websocket_message --wsid <id> --frameIndex <idx>

# 5) 拦截发送（如需伪造心跳/重放）
create_hook --type websocket --description "WS capture"  →  inject_hook --persistent true
```

详见 `references/websocket-reverse.md`。

---

## 场景 6：Wasm 逆向

**目标**：分析 WebAssembly 模块。

```
# 1) 工具链探测
wasm_capabilities

# 2) 导出模块
wasm_dump --moduleIndex 0 --outputPath ./target.wasm

# 3) 段信息 + 字符串扫描
wasm_inspect_sections --inputPath ./target.wasm \
  --includeFunctionSignatures true --includeStringScan true \
  --maskSensitiveStrings true

# 4) 反编译（推荐，函数摘要 + 可疑模式）
wasm_decompile --inputPath ./target.wasm --inlineExport true
# 或反汇编（看原始 WAT）
wasm_disassemble --inputPath ./target.wasm --foldExprs true

# 5) 离线执行
wasm_offline_run --inputPath ./target.wasm --functionName <name> --args <json>

# 6) 内存检查 / 运行时追踪
wasm_memory_inspect --offset 0 --length 1024 --format hex
wasm_vmp_trace --maxEvents 100
```

详见 `references/wasm-reverse.md`。

---

## 场景 7：反检测 / 设备模拟

**目标**：隐藏自动化痕迹 / 复现特定设备环境。

| 目标                         | 工具                                                          |
| ---------------------------- | ------------------------------------------------------------- |
| 隐藏 webdriver / canvas 噪声 | `inject_stealth --preset <name>`（先 `list_stealth_presets`） |
| 自定义 UA                    | `set_user_agent --userAgent <ua>`                             |
| 移动端 UA + 视口 + 触摸      | `emulate_mobile --enable true --device "iPhone 14"`           |
| 网络限速 / 离线              | `emulate_network --throttlingOption "Slow 3G"`                |
| CPU 节流（复现弱机）         | `emulate_cpu --throttlingRate 4`                              |
| 自定义视口                   | `resize_page --width 375 --height 812`                        |
| 哪些隐身项被启用             | `list_stealth_features`                                       |

详见 `references/stealth-emulation.md`。

---

## 场景 8：Console 日志取证

**目标**：用页面 console 日志作为额外取证维度（错误堆栈、显式打印）。

```
list_console_messages --type error --pageSize 100
get_console_message --msgid <id>
list_console_messages --includePreservedMessages true   # 翻页前
```

常用于：

- `error` 堆栈 → 间接定位混淆函数入口
- 找 `console.log('sign:', ...)` 显式打印
- 在断点循环时验证 `resume` 是否真的执行（应有新 error 出现）

---

## 场景 9：复用代码模板

**目标**：复用预置的反检测/Hook 代码片段，避免每次手写。

```
list_code_templates                          # 列模板
get_code_template --templateName <name>      # 看源码
inject_code_template --templateName <name>   # 注入到当前页面
```

详见 `references/code-templates.md`。

---

## Hook vs 断点：何时切到断点

**默认 Hook 优先**。以下 4 种情况**才**用断点：

1. 必须看闭包内的局部变量（Hook 拿不到）
2. 断点本身就是反调试检测点（`Function.prototype.toString`）需要确认
3. 复杂异步链路，需要在 await 前/后分别暂停看中间值
4. 已知行号，单点采样一次即可（如初始化阶段的一次性逻辑）

切到断点时用 `set_breakpoint_on_text --text "目标语句" --urlFilter <pattern>`，配合 `--condition <expr>` 减少误命中。

---

## 通用原则

- **先 Hook 后断点**：`hook_function` / `trace_function` 优先于 `set_breakpoint*`
- **先 observe 后 act**：`collect_code` / `list_network_requests` 先于 `auto_hook`
- **先 summary 后 raw**：`get_hook_data --view summary`，按需切 raw
- **先全局后聚焦**：`analyze_target` 一键 → 针对性 Hook → 断点精确定位
- **Profile 优先**：`workflow` 是日常档；`full` 包含 debugger/wasm/anti-debug/perf/rebuild。详见 `references/profile-tool-gating.md`

---

## 阶段切换红线

| 红线                                        | 后果                                        |
| ------------------------------------------- | ------------------------------------------- |
| 没做 Observe 就开始 Patch                   | 盲补环境，越补越乱                          |
| 没有 `first divergence` 就连补多个对象      | 不知道补丁是否生效                          |
| env rebuild 没通过就进 PureExtraction       | 算法提纯跑在错误环境上                      |
| Node pure 没稳定就写 Python pure            | 跨语言环境问题叠加                          |
| 真实 cookie / token / storage 写进仓库 case | 违反 `docs/reference/case-safety-policy.md` |

完整协议：`docs/reference/reverse-workflow.md`。
