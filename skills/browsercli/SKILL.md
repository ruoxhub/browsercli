---
name: browsercli
description: 当需要通过 browsercli CLI 控制浏览器自动化、抓取与重放 HTTP/WebSocket 网络请求、追踪请求发起者调用栈、动态注入 JavaScript Hook 与加密拦截、安装 JSVMP 运行时探针、捕获与追踪 WebAssembly、设置断点与单步调试、绕过无限 debugger 与反反调试、模拟真实 DOM 拟人化交互、提取 Cookie/Storage 快照、沉淀逆向证据、安装与管理未打包扩展（Chrome Extension 插件调试与热重载）时使用。只要用户提到“浏览器逆向”、“抓包分析”、“Hook 加密”、“查找签名”、“调试混淆代码”、“浏览器插件”、“Chrome扩展”或“browsercli”均应使用。
---

# BrowserCLI 逆向工程与浏览器自动化技能

`browsercli` 是用于浏览器自动化、客户端 JavaScript/WebAssembly 逆向与流量拦截的命令行工具。CLI 通过本地命名管道（POSIX 为 Unix Socket）与后台常驻 Daemon 通信，Daemon 持有浏览器连接，**状态（选中页面、Hook、断点、网络缓存）在多次命令间持续保留**。

## 命令约定

```bash
browsercli [-s <session>] <tool> [positionals] [--flags]
```

- 必填参数按位置传入，可选参数用 `--flag`；不确定时先跑 `browsercli <tool> --help`（命令列表：`browsercli --help`）。
- 工具名支持下划线与连字符两种写法（`list_pages` ≡ `list-pages`），部分工具有 chrome-devtools 风格别名（如 `debugger_set_breakpoint` → `set_breakpoint`）。
- 多标签页：所有页面级工具都接受 `--pageId <id>`（来自 `list_pages`），可在**不切换全局选中页**的情况下定位指定标签页；省略时作用于当前选中页。
- 输出格式默认 `toon`（紧凑）；`--output-format md` 为紧凑 Markdown，`--json` 为原始结构（脚本/`jq` 解析时使用）。也可用环境变量 `BROWSERCLI_OUTPUT_FORMAT` 设默认值。
- 复杂参数（数组/对象）可用 `--data '<json>'`、`--file params.json` 或 `--stdin` 直接以 JSON 传入；`--watch` 实时流式打印执行期间事件。
- 会话隔离：`-s <name>` 或环境变量 `BROWSERCLI_SESSION`（默认 `default`），不同会话各自拥有独立 Daemon 与浏览器。
- Windows Git Bash 提示：`--urlFilter`、`--waitForRequest`、`break_on_xhr` 等参数均为**大小写不敏感子串匹配（非正则）**；在 Git Bash 下避免传入以 `/` 开头的裸参数（如 `/api/` 会被 MSYS2 改写为 `C:/Program Files/Git/api/`），请用 `api` 或 `api/login`（或设置 `MSYS_NO_PATHCONV=1`）。
- 落盘路径：`--filePath` / `--saveTo` / `--outputPath` 等参数指向的产物，按仓库规则统一写入 `project/<os>/<workpath>/artifacts/` 下。

## AI 工作流

1. **连接**：Daemon 在首次调用工具时**懒启动**，无需每次先跑 `start`/`status`。只有需要指定连接方式（接管已有 Chrome、无头、Cloak 等）或排障时才显式 `start`。
2. **定位页面**：`browsercli list_pages` 获取 `pageId`，再 `select_page <pageId>` 或在后续命令带 `--pageId`。
3. **观察**：`browsercli take_snapshot` 获取元素 `uid`（如 `1_4`）；网络/脚本层面用 `list_network_requests`、`list_scripts`、`search_in_sources`。
4. **行动**：`click 1_4`、`fill 1_4 "text"` 等；uid 优先，其次用定位器（CSS / `role=` / `text=` / `xpath=`，多匹配追加 `>> nth=N`）。
5. **取证**：Hook / 断点 / 发起者调用栈拿到真实入参与中间值后，再进入算法还原。

快照示例：

```text
uid=1_0 RootWebArea "Example Domain" url="https://example.com/"
  uid=1_1 heading "Example Domain" level="1"
  uid=1_2 link "More information..."
```

## 服务与会话管理

```bash
browsercli status                                   # 当前会话 Daemon 与浏览器连接状态（--json 可用）
browsercli start                                    # 启动或重启 Daemon（本地拉起浏览器）
browsercli start --browserUrl http://127.0.0.1:9222 # 接管已开启远程调试端口的 Chrome（-u 简写）
browsercli start --wsEndpoint "ws://127.0.0.1:9222/devtools/browser/<id>"  # 按 WS 端点接管（-w）
browsercli start --autoConnect                      # 自动连接本机运行中的 Chrome（Chrome 144+）
browsercli start --headless --isolated              # 无头 + 临时 user-data-dir（退出即清理）
browsercli start --channel canary --viewport 1280x720
browsercli start --cloak                            # CloakBrowser 源码级反检测二进制
browsercli start --minimalStealth                   # 最小反检测启动参数（另有 --fullStealthArgs / --jsStealth）
browsercli start --proxyServer http://127.0.0.1:8080 --acceptInsecureCerts  # 配合 proxycli/mitmproxy 抓包
browsercli start --experimentalVision               # 启用坐标类视觉工具
browsercli start --force                            # 强制重新连接浏览器
browsercli -s task_01 start                         # 多会话隔离
browsercli stop                                     # 停止当前会话
browsercli stop --all                               # 强杀全部 Daemon 并清理残余会话
browsercli check_browser_health                     # 浏览器连接与页面可用性检查
browsercli diagnose_environment                     # Node 版本、构建产物、artifacts 目录自检
```

接管已有浏览器时，需先以非默认 user-data-dir 开启远程调试端口（默认用户目录下 Chrome 会忽略该参数）：

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" --remote-debugging-port=9222 --user-data-dir="$TEMP/chrome-profile-debug"
```

用户指定了端口时，连接失败应视为“浏览器未以该端口启动”，不要静默换端口。

全局配置（`~/.browsercli/config.json`）：

```bash
browsercli config --list            # 配置文件路径与相关环境变量
browsercli config get               # 查看全部配置
browsercli config set cloak=true    # 设置配置项
browsercli config --unset cloak     # 删除配置项
browsercli config --init            # 初始化配置文件
```

## 页面导航与 Frame

```bash
browsercli list_pages                                         # 列出页面及稳定 pageId
browsercli select_page 2 --bringToFront                       # 设为当前页并带到前台
browsercli new_page "https://example.com"                     # 新建页面
browsercli new_page "https://example.com" --background --isolatedContext ctxA  # 后台 + 独立 Cookie/Storage
browsercli new_page "https://example.com" --preloadPreset capture-all-requests # 加载前注入预设 Hook
browsercli navigate_page "https://example.com" --timeout 15000
browsercli navigate_page reload --ignoreCache
browsercli navigate_page back --initScript "window.__probe=1" # 导航并在文档执行前注入脚本
browsercli navigate_page reload --handleBeforeUnload accept
browsercli close_page 2
browsercli list_frames                                        # Frame 树
browsercli select_frame 1                                     # 切入 iframe（0 = 主 frame）
browsercli wait_for "登录成功" "欢迎" --timeout 10000          # 任一文本出现即返回
browsercli wait_for_element "#app .loaded" --timeout 30000
browsercli scroll_by down --pixels 800
```

`--preloadPreset` 可选：`capture-all-fetch`、`capture-all-xhr`、`capture-all-requests`、`log-cookies`。

## 仿真

```bash
browsercli emulate --userAgent "Mozilla/5.0 (iPhone; ...)" --viewport "390x844x3,mobile,touch"
browsercli emulate --networkConditions "Slow 3G" --cpuThrottlingRate 4
browsercli emulate --geolocation "31.23,121.47" --colorScheme dark
browsercli emulate --extraHttpHeaders '{"X-Debug":"1"}'
browsercli resize_page 1920 1080
```

## DOM 观察与交互（uid 来自 take_snapshot）

```bash
browsercli take_snapshot                                  # 无障碍语义快照，拿 uid
browsercli take_snapshot --mode vom                       # 视口遮挡剪枝，只保留可见交互层
browsercli take_snapshot --verbose --filePath artifacts/snap.txt
browsercli query_dom "role=button[name=\"提交\"]" --all --limit 20
browsercli get_dom_structure --maxDepth 4
browsercli find_clickable_elements --filterText 登录
browsercli reveal_in_devtools "#captcha" --durationMs 3000  # 高亮元素
browsercli click 1_4                                      # 单击
browsercli click 1_4 --dblClick --includeSnapshot         # 双击并返回新快照
browsercli click "text=登录"                              # 定位器点击
browsercli click_at 320 480                               # CDP 坐标点击（适用于 Canvas / 拦截场景）
browsercli hover 1_4
browsercli fill 1_5 "user@example.com"                    # 输入框/下拉框；复选框传 "true"/"false"
browsercli fill_form '[{"uid":"1_5","value":"alice"},{"uid":"1_6","value":"secret"}]'
browsercli press_key Enter
browsercli press_key "Control+A" --includeSnapshot
browsercli drag 1_7 1_9                                   # 拖拽（亦可 --fromSelector/--toSelector）
browsercli upload_file 1_8 ./a.png ./b.png
browsercli handle_dialog accept --promptText "hi"
browsercli handle_dialog dismiss
browsercli get_css_styles 1_4 --pageSize 20 --pageIdx 0   # 匹配规则与层叠
browsercli monitor_events --selector "#btn" --events click --events keydown --monitorId m1
browsercli stop_monitor m1
browsercli take_screenshot                                # 视口截图
browsercli take_screenshot --fullPage --format jpeg --quality 80 --filePath artifacts/full.jpg
browsercli take_screenshot --uid 1_4 --filePath artifacts/el.png
```

## 网络嗅探、发起者与 Mock

```bash
browsercli list_network_requests                                   # 自上次导航以来的请求
browsercli list_network_requests --urlFilter api --pageSize 50 --pageIdx 0  # 子串匹配（大小写不敏感，非正则）
browsercli list_network_requests --headerFilter x-sign --includeSignatureEvidence  # 签名参数线索
browsercli list_network_requests --waitForRequest api/login --waitTimeoutMs 15000  # 等待目标请求出现
browsercli list_network_requests --includePreservedRequests        # 含最近 3 次导航保留的请求
browsercli get_network_request 12                                  # 请求详情（响应体默认截断 300 字符）
browsercli get_network_request 12 --fullBody
browsercli get_network_request 12 --requestFilePath artifacts/req.bin --responseFilePath artifacts/res.json
browsercli get_request_initiator 12                                # ★ 发起者 JS 调用栈：定位签名生成代码
browsercli clear_network_requests
browsercli mock_network "https://example.com/app.js*" --body ./patched/app.js     # 用本地文件替换响应
browsercli mock_network "https://example.com/app.js*" --upstream https://example.com/dev.js
browsercli mock_network "*://*:*/track*" --abort                   # 拦截请求
browsercli mock_network                                            # 查看全部 mock
browsercli remove_network_mock "https://example.com/app.js*"
browsercli remove_network_mock                                     # 清空全部 mock
```

## WebSocket

```bash
browsercli list_websocket_connections --urlFilter wss://
browsercli analyze_websocket_messages 1                     # 先聚类分组（A/B/C…）
browsercli get_websocket_messages 1 --groupId A --direction received --pageSize 20
browsercli get_websocket_messages 1 --show_content          # 完整负载（二进制慎用）
browsercli get_websocket_message 1 5 --decode protobuf      # 单帧解码：auto/protobuf/json/raw
```

## 脚本收集与源码定位

```bash
browsercli list_scripts --filter app.js                     # scriptId / URL / SourceMap
browsercli search_in_sources "x-sign"                       # 全局搜索 → scriptId + 行号 + 缓存路径
browsercli search_in_sources "sign\\(.*?\\)" --isRegex --urlFilter app --maxResults 50
browsercli search_in_sources "encrypt" --scriptId 42 --occurrence 2 --contextChars 200  # 压缩单行文件精确列号
browsercli search_in_sources "token" --filePath artifacts/scripts   # 命中脚本全部落盘
browsercli get_script_source 42                             # 返回源码缓存路径，再用文件工具读取
browsercli get_script_source 42 --startLine 1 --endLine 80
browsercli get_script_source 42 --filePath artifacts/app.js
browsercli get_script_source --locator "<locator>"          # 刷新后 scriptId 失效时按 locator 找回
browsercli collect_code "https://example.com" --smartMode priority --topN 10
browsercli collection_diff                                  # 对比上次与本次收集摘要
browsercli list_targets                                     # Worker / iframe 等 Target
browsercli dump_target_scripts <targetId>
```

## 动态 Hook 与加密拦截

Hook 默认非阻塞、记录到 HookManager，用 `get_hook_data` 读取。内置 Hook 类型：`function`、`fetch`、`xhr`、`websocket`、`property`、`event`、`timer`、`localstorage`、`cookie`、`eval`、`object-method`、`custom`（加密库 / JSVMP 自定义探针可通过 `inject_hook` 注入）。

```bash
browsercli create_hook fetch --inject                                   # 创建并立即注入当前 Frame
browsercli create_hook xhr --inject --persistent                        # 注册为 BrowserContext 级持久 Hook（跨导航）
browsercli create_hook function --params '{"target":"window.encrypt"}' --inject --hookId enc
browsercli create_hook cookie --inject                                  # document.cookie 读写
browsercli create_hook localstorage --inject
browsercli create_hook websocket --inject
browsercli create_hook eval --inject                                    # 亦支持 property / event / timer / object-method / custom
browsercli create_hook function --params '{"target":"window.fetch"}' --action block --inject
browsercli inject_hook custom1 --script "$(cat hooks/probe.js)" --persistent  # 注入自定义脚本
browsercli get_hook_data --view summary                                 # 去重摘要
browsercli get_hook_data --hookId enc --view detail --maxRecords 50
browsercli list_created_hooks --syncFromBrowser
browsercli list_persistent_hooks
browsercli remove_hook enc                                              # 同时还原页面端原函数
```

## 调试器与断点

自动化流程优先用 `trace_function` / 日志点 / Hook（不暂停页面）；确需暂停时再用断点。

```bash
browsercli trace_function sign --urlFilter app --logStack       # 日志点追踪函数入参/返回值，不暂停
browsercli set_logpoints "app.js:42 'total:', cart.total"       # 设置完整日志点集合（传空数组清除）
browsercli set_breakpoint 120 --scriptId 42 --columnNumber 3051 # 1-based 行 + 0-based 列
browsercli set_breakpoint 120 --url app.js --condition "args.length > 2"
browsercli set_breakpoint_on_text "function encrypt" --urlFilter app
browsercli break_on_xhr api/login                               # URL 子串命中即断
browsercli remove_xhr_breakpoint api/login
browsercli list_breakpoints
browsercli remove_breakpoint <breakpointId>
browsercli debugger_wait_for_paused --timeout 10000             # 不占页面队列等待下一次暂停
browsercli get_paused_info --scopeFrames all                    # 调用栈 + 作用域变量
browsercli evaluate_on_callframe "JSON.stringify(data)" --frameIndex 0
browsercli debugger_step over                                   # into / over / out
browsercli inspect_object "window.app" --depth 3
browsercli pause
browsercli resume
browsercli debugger_disable                                     # 恢复页面并清理全部断点与监听
```

## 脚本执行、控制台与存储

```bash
browsercli evaluate_script "document.title"
browsercli evaluate_script "async (el) => el.innerText" --args 1_4
browsercli evaluate_script --sourcePath ./probe.js --format script
browsercli evaluate_script "() => window.__data" --frameId <frameId> --filePath artifacts/data.json
browsercli list_console_messages --pageSize 20 --includeStackTraces
browsercli get_console_message 3
browsercli get_storage                                          # 含 HttpOnly Cookie、可复制的 Cookie 头、local/sessionStorage
browsercli get_storage --type cookies --filter token
```

## 反反调试

```bash
browsercli bypass_debugger      # 去除 eval/Function/constructor 中的 debugger，破无限 debugger
browsercli anti_anti_debug      # 固定窗口尺寸、冻结时间、阻止关闭/历史导航/console.clear、隐藏 webdriver
browsercli detect_captcha                              # 只读评估是否存在验证码/人机挑战
browsercli detect_captcha --action wait_for_clear      # 等待用户在可见窗口中手动完成挑战
```

遇到验证码或人机挑战时只做检测并交由用户手动处理，不尝试自动求解或绕过。

## WebAssembly

```bash
browsercli collect_wasm "https://example.com" --waitAfterLoadMs 3000 --clearPrevious
browsercli wasm_dump 0 --outputPath artifacts/wasm/mod0.wasm
browsercli wasm_vmp_trace --filterModule <moduleId> --maxEvents 2000
```

线性内存检查直接用 `evaluate_script` 读取导出的 `memory.buffer`。

## 证据录制

```bash
browsercli record_start                                         # 录制用户交互轨迹（点击/输入）
browsercli record_stop                                          # 导出步骤并关联网络请求
browsercli screencast_start --filePath artifacts/recordings/demo.mp4 --maxDurationMs 60000 --fps 15
browsercli screencast_stop
```

## 未打包扩展

```bash
browsercli list_extensions
browsercli install_extension "D:/work/my-ext"       # 绝对路径
browsercli reload_extension <id>                    # 热重载
browsercli trigger_extension_action <id>            # 触发默认 Action（弹出 popup）
browsercli uninstall_extension <id>
```

## 典型逆向链路：定位请求签名

```bash
browsercli new_page "https://target.example.com"
browsercli list_network_requests --urlFilter api --includeSignatureEvidence
browsercli get_request_initiator <reqid>                        # 拿到发起栈中的 scriptId / 行列号
browsercli search_in_sources "x-sign" --scriptId <scriptId>     # 精确列号
browsercli trace_function <fnName> --logStack                   # 或 set_breakpoint + get_paused_info
browsercli get_hook_data --view summary                         # 对照入参与输出，进入纯算还原
```
