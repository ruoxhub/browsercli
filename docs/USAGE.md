# JSReverser-MCP 使用文档

> 完整的 CLI 命令、MCP 工具和技能使用指南

---

## 目录

- [快速开始](#快速开始)
- [CLI 命令](#cli-命令)
- [MCP 工具](#mcp-工具)
- [内置技能](#内置技能)
- [REPL 模式](#repl-模式)
- [常见问题](#常见问题)

---

## 快速开始

```bash
# 安装依赖
npm ci

# 构建项目
npm run build

# 启动守护进程
js-reverse start --browserUrl http://127.0.0.1:9222

# 查看守护进程状态
js-reverse status

# 列出可用技能
js-reverse list-skills

# 列出可用工具
js-reverse list-tools

# 停止守护进程
js-reverse stop
```

---

## CLI 命令

### start - 启动守护进程

启动后台服务，连接到 Chrome DevTools 实例。

```bash
js-reverse start --browserUrl http://127.0.0.1:9222
```

| 参数                      | 说明                     | 默认值 |
| ------------------------- | ------------------------ | ------ |
| `--browserUrl <url>`      | 连接到已有的 Chrome 实例 | -      |
| `--wsEndpoint <endpoint>` | 通过 WebSocket 端点连接  | -      |
| `--headless`              | 无头模式运行             | false  |
| `--executablePath <path>` | 自定义 Chrome/Edge 路径  | -      |
| `--http`                  | 启用 HTTP 服务器模式     | false  |
| `--port <port>`           | HTTP 服务器端口          | 3000   |
| `--wait-for-browser`      | 等待浏览器可达后再返回   | false  |

**示例：**

```bash
# 连接本地 Chrome Debug 端口
js-reverse start --browserUrl http://127.0.0.1:9222

# 无头模式 + HTTP 服务器
js-reverse start --headless --http --port 8080

# 自定义浏览器路径
js-reverse start --executablePath "/usr/bin/google-chrome"
```

### stop - 停止守护进程

```bash
js-reverse stop
```

### status - 检查守护进程状态

```bash
js-reverse status
```

### call-skill - 执行技能

```bash
js-reverse call-skill <skill-name> [options]
```

| 参数            | 说明                                                    |
| --------------- | ------------------------------------------------------- |
| `<skill-name>`  | 技能名称：`observe-flow`、`auto-hook`、`rebuild-bundle` |
| `--url <url>`   | 目标网页 URL                                            |
| `--data <json>` | 额外的 JSON 数据                                        |

**示例：**

```bash
# 执行观察流技能
js-reverse call-skill observe-flow --url https://example.com

# 执行自动 Hook 技能
js-reverse call-skill auto-hook --url https://example.com

# 执行重建包技能
js-reverse call-skill rebuild-bundle --url https://example.com
```

### list-skills - 列出可用技能

```bash
js-reverse list-skills        # 表格输出
js-reverse list-skills --json # JSON 输出
```

### list-tools - 列出可用工具

```bash
js-reverse list-tools         # 表格输出
js-reverse list-tools --json  # JSON 输出
```

### call - 调用特定工具

```bash
js-reverse call <tool-name> [--param value]
```

**示例：**

```bash
# 截图
js-reverse call screenshot

# 列出网络请求
js-reverse call list-network-requests

# 查询 DOM
js-reverse call query-dom --selector "div.container"
```

### repl - 交互式 REPL 模式

```bash
js-reverse repl
```

进入 REPL 后可使用以下子命令：

| 子命令                   | 说明             |
| ------------------------ | ---------------- |
| `skill <name> [args...]` | 调用技能         |
| `tool <name> [args...]`  | 调用工具         |
| `status`                 | 检查守护进程状态 |
| `list-skills`            | 列出技能         |
| `list-tools`             | 列出工具         |
| `help`                   | 显示帮助         |
| `exit` / `quit`          | 退出 REPL        |

### scaffold - 创建新任务脚手架

```bash
js-reverse scaffold --name <task-name> [--desc <desc>] [--url <url>]
```

**示例：**

```bash
js-reverse scaffold --name jd-h5st --desc "JD H5ST 签名" --url https://m.jd.com
```

---

## MCP 工具

### DOM 操作

| 工具名                    | 说明           | 示例                                                                |
| ------------------------- | -------------- | ------------------------------------------------------------------- |
| `query-dom`               | 查询 DOM 元素  | `js-reverse call query-dom --selector "#container"`                 |
| `get-dom-structure`       | 获取 DOM 结构  | `js-reverse call get-dom-structure --maxDepth 3 --includeText true` |
| `find-clickable-elements` | 查找可点击元素 | `js-reverse call find-clickable-elements --filterText "提交"`       |

**示例：**

```bash
# 查询单个元素
js-reverse call query-dom --selector "div.container"

# 查询所有匹配元素（最多10个）
js-reverse call query-dom --selector "a.link" --all true --limit 10

# 获取完整 DOM 树（深度3层）
js-reverse call get-dom-structure --maxDepth 3

# 查找包含"登录"的按钮
js-reverse call find-clickable-elements --filterText "登录"
```

### 网络请求

| 工具名                  | 说明                 | 示例                                              |
| ----------------------- | -------------------- | ------------------------------------------------- |
| `list-network-requests` | 列出所有网络请求     | `js-reverse call list-network-requests`           |
| `get-network-request`   | 获取指定网络请求详情 | `js-reverse call get-network-request --reqid 123` |

**示例：**

```bash
# 列出所有请求（默认返回所有）
js-reverse call list-network-requests

# 分页获取（每页20条）
js-reverse call list-network-requests --pageSize 20 --pageIdx 0

# 只获取 XHR 和 Fetch 类型
js-reverse call list-network-requests --resourceTypes '["xhr","fetch"]'

# 获取当前选中的请求详情
js-reverse call get-network-request

# 获取指定请求ID的详情
js-reverse call get-network-request --reqid 456
```

### 控制台消息

| 工具名                  | 说明               | 示例                                            |
| ----------------------- | ------------------ | ----------------------------------------------- |
| `list-console-messages` | 列出控制台消息     | `js-reverse call list-console-messages`         |
| `get-console-message`   | 获取指定控制台消息 | `js-reverse call get-console-message --msgid 1` |

**示例：**

```bash
# 列出所有控制台消息
js-reverse call list-console-messages

# 只看错误和警告
js-reverse call list-console-messages --types '["error","warning"]'

# 获取第5条消息详情
js-reverse call get-console-message --msgid 5
```

### WebSocket

| 工具名                       | 说明                    | 示例                                                            |
| ---------------------------- | ----------------------- | --------------------------------------------------------------- |
| `list-websocket-connections` | 列出 WebSocket 连接     | `js-reverse call list-websocket-connections`                    |
| `get-websocket-messages`     | 获取 WebSocket 消息列表 | `js-reverse call get-websocket-messages --wsid 1`               |
| `get-websocket-message`      | 获取单条 WebSocket 消息 | `js-reverse call get-websocket-message --wsid 1 --frameIndex 0` |
| `analyze-websocket-messages` | 分析 WebSocket 消息     | `js-reverse call analyze-websocket-messages --wsid 1`           |

**示例：**

```bash
# 列出所有 WebSocket 连接
js-reverse call list-websocket-connections

# 获取连接的消息（先分析了解消息类型）
js-reverse call analyze-websocket-messages --wsid 1

# 获取指定分组的消息
js-reverse call get-websocket-messages --wsid 1 --groupId "binary" --pageSize 50

# 获取单条消息详情
js-reverse call get-websocket-message --wsid 1 --frameIndex 10
```

### 输入自动化

| 工具名        | 说明                   | 示例                                                                             |
| ------------- | ---------------------- | -------------------------------------------------------------------------------- |
| `click`       | 点击元素               | `js-reverse call click --selector "#btn"`                                        |
| `click-at`    | 按坐标点击（真实鼠标） | `js-reverse call click-at --selector "#file-input"`                              |
| `press-key`   | 按键操作               | `js-reverse call press-key --key "Enter"`                                        |
| `fill-form`   | 批量填写表单           | `js-reverse call fill-form --elements '[{"selector":"#name","value":"John"}]'`   |
| `fill`        | 填充输入框             | `js-reverse call fill --selector "#search" --value "关键词"`                     |
| `upload-file` | 上传文件               | `js-reverse call upload-file --selector "#file" --filePath "/tmp/test.png"`      |
| `hover`       | 鼠标悬停               | `js-reverse call hover --selector "#dropdown"`                                   |
| `drag`        | 拖拽操作               | `js-reverse call drag --fromSelector "#src" --toSelector "#target"`              |
| `set-files`   | 绕过对话框设置文件     | `js-reverse call set-files --selector "#file" --filePaths '["/a.png","/b.png"]'` |

**示例：**

```bash
# 点击按钮
js-reverse call click --selector "#submit-btn"

# 双击
js-reverse call click --selector "#dbl-btn" --dblClick true

# 真实鼠标点击（可触发文件对话框）
js-reverse call click-at --selector "#upload-trigger"

# 填写表单
js-reverse call fill --selector "#username" --value "user@example.com"
js-reverse call fill --selector "#password" --value "password123"

# 批量填充表单
js-reverse call fill-form --elements '[{"selector":"#name","value":"张三"},{"selector":"#email","value":"zhang@example.com"}]'

# 键盘快捷键
js-reverse call press-key --key "Control+A"
js-reverse call press-key --key "Control+Shift+R"
js-reverse call press-key --key "Escape"

# 文件上传
js-reverse call upload-file --selector "#file-input" --filePath "/path/to/file.pdf"

# 直接设置文件（绕过文件选择对话框）
js-reverse call set-files --selector "#file-input" --filePaths '["/path/to/image.png"]'

# 悬停和拖拽
js-reverse call hover --selector "#dropdown-menu"
js-reverse call drag --fromSelector "#draggable" --toSelector "#dropzone"
```

### 页面操作

| 工具名             | 说明               | 示例                                                                      |
| ------------------ | ------------------ | ------------------------------------------------------------------------- |
| `click-element`    | 点击页面元素       | `js-reverse call click-element --selector "button.submit"`                |
| `type-text`        | 输入文本（带延迟） | `js-reverse call type-text --selector "#input" --text "Hello" --delay 50` |
| `wait-for-element` | 等待元素出现       | `js-reverse call wait-for-element --selector ".loaded" --timeout 5000`    |
| `scroll-by`        | 滚动页面           | `js-reverse call scroll-by --direction "down"`                            |

**示例：**

```bash
# 点击元素
js-reverse call click-element --selector ".btn-primary"

# 模拟打字（每字符50ms延迟）
js-reverse call type-text --selector "#search" --text "要搜索的内容" --delay 50

# 等待元素出现
js-reverse call wait-for-element --selector "#modal" --timeout 10000

# 滚动
js-reverse call scroll-by --direction "down" --pixels 500
js-reverse call scroll-by --direction "bottom"
js-reverse call scroll-by --direction "top"
```

### 页面管理

| 工具名          | 说明         | 示例                                                                          |
| --------------- | ------------ | ----------------------------------------------------------------------------- |
| `list-pages`    | 列出所有页面 | `js-reverse call list-pages`                                                  |
| `select-page`   | 选择页面     | `js-reverse call select-page --pageIdx 1`                                     |
| `new-page`      | 新建页面     | `js-reverse call new-page --url "https://example.com"`                        |
| `navigate-page` | 导航页面     | `js-reverse call navigate-page --type "navigate" --url "https://example.com"` |

**示例：**

```bash
# 列出所有页面
js-reverse call list-pages

# 选择页面
js-reverse call select-page --pageIdx 1

# 打开新页面
js-reverse call new-page --url "https://example.com"

# 导航操作
js-reverse call navigate-page --type "navigate" --url "https://example.com"
js-reverse call navigate-page --type "back"
js-reverse call navigate-page --type "forward"
js-reverse call navigate-page --type "reload"
```

### 截图与视频

| 工具名                | 说明         | 示例                                                      |
| --------------------- | ------------ | --------------------------------------------------------- |
| `screenshot`          | 页面截图     | `js-reverse call screenshot`                              |
| `capture-video-frame` | 捕获视频帧   | `js-reverse call capture-video-frame --selector "video"`  |
| `get-video-info`      | 获取视频信息 | `js-reverse call get-video-info --selector "video"`       |
| `seek-video`          | 视频跳转     | `js-reverse call seek-video --selector "video" --time 30` |

**示例：**

```bash
# 普通截图
js-reverse call screenshot

# 截图格式和质量
js-reverse call screenshot --format "jpeg" --quality 85

# 全页面截图
js-reverse call screenshot --fullPage true

# 保存到文件
js-reverse call screenshot --filePath "/tmp/page.png"

# 获取视频信息
js-reverse call get-video-info --selector "video.player"

# 跳转到指定时间
js-reverse call seek-video --selector "video" --time 60

# 捕获视频帧
js-reverse call capture-video-frame --selector "video" --format "png"
js-reverse call capture-video-frame --selector "video" --seekTime 30 --outputPath "/tmp/frame.png"
```

### 模拟

| 工具名            | 说明          | 示例                                                     |
| ----------------- | ------------- | -------------------------------------------------------- |
| `emulate-mobile`  | 模拟移动设备  | `js-reverse call emulate-mobile --device "iPhone 14"`    |
| `emulate-network` | 模拟网络条件  | `js-reverse call emulate-network --preset "Slow 3G"`     |
| `emulate-cpu`     | 模拟 CPU 节流 | `js-reverse call emulate-cpu --rate 4`                   |
| `resize-page`     | 调整页面尺寸  | `js-reverse call resize-page --width 1920 --height 1080` |

**示例：**

```bash
# 模拟 iPhone
js-reverse call emulate-mobile --device "iPhone 14"
js-reverse call emulate-mobile --device "iPad"

# 模拟网络
js-reverse call emulate-network --preset "Offline"
js-reverse call emulate-network --preset "Slow 3G"
js-reverse call emulate-network --preset "Fast 4G"

# CPU 节流（4x 降速）
js-reverse call emulate-cpu --rate 4

# 自定义窗口大小
js-reverse call resize-page --width 375 --height 812
```

### 隐身

| 工具名                  | 说明            | 示例                                                          |
| ----------------------- | --------------- | ------------------------------------------------------------- |
| `inject-stealth`        | 注入隐身脚本    | `js-reverse call inject-stealth`                              |
| `list-stealth-features` | 列出隐身功能    | `js-reverse call list-stealth-features`                       |
| `list-stealth-presets`  | 列出隐身预设    | `js-reverse call list-stealth-presets`                        |
| `set-user-agent`        | 设置 User-Agent | `js-reverse call set-user-agent --userAgent "Mozilla/5.0..."` |

**示例：**

```bash
# 注入隐身脚本
js-reverse call inject-stealth

# 列出可用功能
js-reverse call list-stealth-features

# 列出预设
js-reverse call list-stealth-presets

# 设置自定义 User-Agent
js-reverse call set-user-agent --userAgent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
```

### 性能分析

| 工具名                        | 说明         | 示例                                                       |
| ----------------------------- | ------------ | ---------------------------------------------------------- |
| `start-performance-trace`     | 开始性能追踪 | `js-reverse call start-performance-trace`                  |
| `stop-performance-trace`      | 停止性能追踪 | `js-reverse call stop-performance-trace`                   |
| `get-performance-metrics`     | 获取性能指标 | `js-reverse call get-performance-metrics`                  |
| `performance-analyze-insight` | 分析性能洞察 | `js-reverse call performance-analyze-insight --type "LCP"` |

**示例：**

```bash
# 开始追踪
js-reverse call start-performance-trace

# 执行操作后停止并获取报告
js-reverse call stop-performance-trace

# 获取性能指标
js-reverse call get-performance-metrics

# 获取特定洞察
js-reverse call performance-analyze-insight --type "CLS"
js-reverse call performance-analyze-insight --type "LCP"
```

### 调试器

| 工具名                  | 说明          | 示例                                                            |
| ----------------------- | ------------- | --------------------------------------------------------------- |
| `set-breakpoint`        | 设置断点      | `js-reverse call set-breakpoint --url "app.js" --lineNumber 10` |
| `remove-breakpoint`     | 移除断点      | `js-reverse call remove-breakpoint --breakpointId "bp1"`        |
| `list-breakpoints`      | 列出断点      | `js-reverse call list-breakpoints`                              |
| `step-into`             | 单步进入      | `js-reverse call step-into`                                     |
| `step-over`             | 单步跳过      | `js-reverse call step-over`                                     |
| `step-out`              | 单步跳出      | `js-reverse call step-out`                                      |
| `resume`                | 继续执行      | `js-reverse call resume`                                        |
| `pause`                 | 暂停执行      | `js-reverse call pause`                                         |
| `list-scripts`          | 列出脚本      | `js-reverse call list-scripts`                                  |
| `get-script-source`     | 获取脚本源码  | `js-reverse call get-script-source --scriptId "3"`              |
| `search-in-sources`     | 搜索源码      | `js-reverse call search-in-sources --query "encrypt"`           |
| `get-storage`           | 获取存储数据  | `js-reverse call get-storage`                                   |
| `break-on-xhr`          | XHR 断点      | `js-reverse call break-on-xhr --url "/api"`                     |
| `remove-xhr-breakpoint` | 移除 XHR 断点 | `js-reverse call remove-xhr-breakpoint --url "/api"`            |
| `monitor-events`        | 监控事件      | `js-reverse call monitor-events --events '["click","input"]'`   |
| `stop-monitor`          | 停止监控      | `js-reverse call stop-monitor --monitorId "m1"`                 |
| `trace-function`        | 追踪函数      | `js-reverse call trace-function --functionName "encrypt"`       |
| `hook-function`         | Hook 函数     | `js-reverse call hook-function --target "window.encrypt"`       |
| `unhook-function`       | 取消 Hook     | `js-reverse call unhook-function --hookId "hk1"`                |
| `inspect-object`        | 检查对象      | `js-reverse call inspect-object --expression "window.crypto"`   |

**示例：**

```bash
# 列出所有已加载脚本
js-reverse call list-scripts

# 搜索包含关键词的脚本
js-reverse call list-scripts --filter "main.js"

# 获取脚本源码
js-reverse call get-script-source --scriptId "3"
js-reverse call get-script-source --scriptId "3" --startLine 1 --endLine 50

# 设置断点
js-reverse call set-breakpoint --url "app.js" --lineNumber 10

# 按文本设置断点（第1个匹配项）
js-reverse call set-breakpoint-on-text --text "encrypt(" --urlFilter "app.js"

# 条件断点
js-reverse call set-breakpoint --url "app.js" --lineNumber 10 --condition "x > 0"

# 单步调试
js-reverse call step-into
js-reverse call step-over
js-reverse call step-out
js-reverse call resume
js-reverse call pause

# 列出所有断点
js-reverse call list-breakpoints

# 移除断点
js-reverse call remove-breakpoint --breakpointId "bp:app.js:10"

# XHR 断点
js-reverse call break-on-xhr --url "/api/sign"
js-reverse call remove-xhr-breakpoint --url "/api/sign"

# 监控事件
js-reverse call monitor-events --selector "#btn" --events '["click","input"]'
js-reverse call stop-monitor --monitorId "evt1"

# 函数追踪
js-reverse call trace-function --functionName "encrypt" --urlFilter "main.js"
js-reverse call trace-function --functionName "encrypt" --logArgs true --logResult true

# 函数 Hook
js-reverse call hook-function --target "window.encrypt" --logArgs true --logResult true
js-reverse call unhook-function --hookId "hk:window.encrypt"

# 对象检查
js-reverse call inspect-object --expression "document.body"
js-reverse call inspect-object --expression "window.localStorage" --depth 3

# 获取存储数据
js-reverse call get-storage
js-reverse call get-storage --type "cookies"
js-reverse call get-storage --type "localStorage" --filter "token"

# 搜索源码
js-reverse call search-in-sources --query "encrypt"
js-reverse call search-in-sources --query "token" --caseSensitive false
js-reverse call search-in-sources --query "\\d{32}" --isRegex true
```

### Hook 系统

#### 通用 Hook

| 工具名               | 说明            | 示例                                           |
| -------------------- | --------------- | ---------------------------------------------- |
| `create-hook`        | 创建 Hook       | `js-reverse call create-hook --type fetch`     |
| `inject-hook`        | 注入 Hook       | `js-reverse call inject-hook --hookId "hk1"`   |
| `list-created-hooks` | 列出已创建 Hook | `js-reverse call list-created-hooks`           |
| `get-hook-data`      | 获取 Hook 数据  | `js-reverse call get-hook-data --hookId "hk1"` |
| `remove-hook`        | 移除 Hook       | `js-reverse call remove-hook --hookId "hk1"`   |

**示例：**

```bash
# 创建 Fetch Hook
js-reverse call create-hook --type fetch --action log

# 创建带参数的 Hook
js-reverse call create-hook --type xhr --params '{"filterUrls":["/api"]}'

# 注入 Hook
js-reverse call inject-hook --hookId "hk123"

# 获取 Hook 数据
js-reverse call get-hook-data --hookId "hk123"
js-reverse call get-hook-data --hookId "hk123" --view summary --maxRecords 50

# 列出所有 Hook
js-reverse call list-created-hooks
js-reverse call list-created-hooks --verbose true

# 移除 Hook
js-reverse call remove-hook --hookId "hk123"
```

#### 专用 Hook

| 工具名                        | 说明                      | 示例                                                                    |
| ----------------------------- | ------------------------- | ----------------------------------------------------------------------- |
| `hook-console-log`            | Hook console.log          | `js-reverse call hook-console-log`                                      |
| `hook-console-table`          | Hook console.table        | `js-reverse call hook-console-table`                                    |
| `hook-console-protect`        | Hook console 保护         | `js-reverse call hook-console-protect`                                  |
| `hook-console-clear`          | Hook console 清空         | `js-reverse call hook-console-clear`                                    |
| `hook-location-href`          | Hook location.href        | `js-reverse call hook-location-href`                                    |
| `hook-cookie`                 | Hook Cookie               | `js-reverse call hook-cookie`                                           |
| `hook-xhr-open`               | Hook XHR open             | `js-reverse call hook-xhr-open`                                         |
| `hook-xhr-set-request-header` | Hook XHR setRequestHeader | `js-reverse call hook-xhr-set-request-header`                           |
| `hook-fetch`                  | Hook Fetch                | `js-reverse call hook-fetch`                                            |
| `hook-json-parse`             | Hook JSON.parse           | `js-reverse call hook-json-parse`                                       |
| `hook-json-stringify`         | Hook JSON.stringify       | `js-reverse call hook-json-stringify`                                   |
| `hook-promise`                | Hook Promise              | `js-reverse call hook-promise`                                          |
| `hook-random`                 | Hook Random               | `js-reverse call hook-random --fixedValue 0.5`                          |
| `hook-local-storage`          | Hook localStorage         | `js-reverse call hook-local-storage`                                    |
| `hook-session-storage`        | Hook sessionStorage       | `js-reverse call hook-session-storage`                                  |
| `hook-web-socket`             | Hook WebSocket            | `js-reverse call hook-web-socket`                                       |
| `hook-history`                | Hook History              | `js-reverse call hook-history`                                          |
| `hook-history-go`             | Hook history.go           | `js-reverse call hook-history-go`                                       |
| `hook-performance-now`        | Hook performance.now      | `js-reverse call hook-performance-now`                                  |
| `hook-date-now`               | Hook Date.now             | `js-reverse call hook-date-now --fixedValue 1700000000000`              |
| `hook-close`                  | Hook close                | `js-reverse call hook-close`                                            |
| `fixed-window-size`           | 固定窗口大小              | `js-reverse call fixed-window-size --innerWidth 1366 --innerHeight 768` |
| `anti-anti-hook`              | 反反 Hook                 | `js-reverse call anti-anti-hook`                                        |

**示例：**

```bash
# Console Hook
js-reverse call hook-console-log --mode proxy
js-reverse call hook-console-log --showStack true
js-reverse call hook-console-table
js-reverse call hook-console-protect
js-reverse call hook-console-clear

# 网络 Hook
js-reverse call hook-fetch --showStack true
js-reverse call hook-xhr-open --filterUrls '["/api/","/sign/"]' --showStack true
js-reverse call hook-xhr-set-request-header --filterKeys '["Authorization","X-Token"]'

# 数据解析 Hook
js-reverse call hook-json-parse
js-reverse call hook-json-parse --filterKeys '["token","sign"]'
js-reverse call hook-json-stringify

# 存储 Hook
js-reverse call hook-cookie --filterKeys '["session_id","token"]'
js-reverse call hook-local-storage --actions '["setItem","getItem"]' --filterKeys '["user"]'
js-reverse call hook-session-storage

# 定时器/随机 Hook
js-reverse call hook-random --fixedValue 0.5
js-reverse call hook-date-now --fixedValue 1700000000000
js-reverse call hook-performance-now --fixedValue 1000

# 页面导航 Hook
js-reverse call hook-location-href --showStack true
js-reverse call hook-history --filterUrls '["redirect","/goto"]'
js-reverse call hook-history-go

# WebSocket Hook
js-reverse call hook-web-socket --filterUrls '["wss://api."]'

# Promise Hook
js-reverse call hook-promise

# 窗口尺寸固定
js-reverse call fixed-window-size --innerWidth 1920 --innerHeight 1080

# 反反调试
js-reverse call anti-anti-hook
js-reverse call hook-close
```

### 对话框

| 工具名          | 说明       | 示例                                                                    |
| --------------- | ---------- | ----------------------------------------------------------------------- |
| `handle-dialog` | 处理对话框 | `js-reverse call handle-dialog --action accept --promptText "输入内容"` |

**示例：**

```bash
# 接受确认对话框
js-reverse call handle-dialog --action accept

# 拒绝确认对话框
js-reverse call handle-dialog --action dismiss

# 输入文本到提示框
js-reverse call handle-dialog --action accept --promptText "用户名"
```

### 框架

| 工具名         | 说明        | 示例                                        |
| -------------- | ----------- | ------------------------------------------- |
| `list-frames`  | 列出 iframe | `js-reverse call list-frames`               |
| `select-frame` | 选择 iframe | `js-reverse call select-frame --frameIdx 1` |

**示例：**

```bash
# 列出所有 iframe
js-reverse call list-frames

# 切换到 iframe
js-reverse call select-frame --frameIdx 1
```

### 脚本执行

| 工具名                  | 说明           | 示例                                                                      |
| ----------------------- | -------------- | ------------------------------------------------------------------------- |
| `evaluate-script`       | 执行脚本       | `js-reverse call evaluate-script --function "() => document.title"`       |
| `inject-preload-script` | 注入预加载脚本 | `js-reverse call inject-preload-script --script "console.log('preload')"` |

**示例：**

```bash
# 执行脚本
js-reverse call evaluate-script --function "() => document.title"
js-reverse call evaluate-script --function "() => window.innerWidth"

# 注入预加载脚本（每次页面加载前执行）
js-reverse call inject-preload-script --script "(() => { window.preloadData = 'test'; })()"
```

### 站点经验

| 工具名                   | 说明         | 示例                                                                               |
| ------------------------ | ------------ | ---------------------------------------------------------------------------------- |
| `search-site-experience` | 搜索站点经验 | `js-reverse call search-site-experience --url "https://example.com"`               |
| `list-site-experiences`  | 列出站点经验 | `js-reverse call list-site-experiences`                                            |
| `create-site-experience` | 创建站点经验 | `js-reverse call create-site-experience --name "my-site"`                          |
| `update-site-experience` | 更新站点经验 | `js-reverse call update-site-experience --name "my-site" --data '{"key":"value"}'` |
| `delete-site-experience` | 删除站点经验 | `js-reverse call delete-site-experience --name "my-site"`                          |

### 扩展

| 工具名              | 说明     | 示例                                |
| ------------------- | -------- | ----------------------------------- |
| `update-extensions` | 更新扩展 | `js-reverse call update-extensions` |

### 分析器

| 工具名                    | 说明         | 示例                                                                      |
| ------------------------- | ------------ | ------------------------------------------------------------------------- |
| `deobfuscate-code`        | 去混淆代码   | `js-reverse call deobfuscate-code --code "obfuscated..."`                 |
| `understand-code`         | 理解代码     | `js-reverse call understand-code --code "function(){}"`                   |
| `summarize-code`          | 总结代码     | `js-reverse call summarize-code --mode single --code "..."`               |
| `detect-crypto`           | 检测加密算法 | `js-reverse call detect-crypto --code "..."`                              |
| `record-reverse-evidence` | 记录逆向证据 | `js-reverse call record-reverse-evidence --taskId "t1" --goal "获取签名"` |
| `analyze-target`          | 分析目标     | `js-reverse call analyze-target --url "https://example.com"`              |
| `risk-panel`              | 风险面板     | `js-reverse call risk-panel --code "..."`                                 |
| `export-session-report`   | 导出会话报告 | `js-reverse call export-session-report --format "markdown"`               |

**示例：**

```bash
# 代码去混淆
js-reverse call deobfuscate-code --code "(function(){...})()"
js-reverse call deobfuscate-code --code "..." --aggressive true --renameVariables true

# 理解代码结构
js-reverse call understand-code --code "function encrypt(data) {...}"
js-reverse call understand-code --code "..." --focus security

# 总结代码
js-reverse call summarize-code --mode single --code "..."
js-reverse call summarize-code --mode batch --files '[{"url":"a.js","content":"...","size":1000,"type":"external"}]'

# 检测加密算法
js-reverse call detect-crypto --code "..."
js-reverse call detect-crypto --code "..." --useAI true

# 记录逆向证据
js-reverse call record-reverse-evidence --taskId "jd-h5st" --taskSlug "jd-h5st" --goal "逆向h5st签名" --targetUrl "https://m.jd.com"

# 一站式目标分析
js-reverse call analyze-target --url "https://m.jd.com" --topN 5 --useAI true

# 风险评估
js-reverse call risk-panel --code "..."
js-reverse call risk-panel --code "..." --useAI true --includeHookSignals true

# 导出报告
js-reverse call export-session-report --format markdown
js-reverse call export-session-report --format json --includeHookData true
```

### 代码收集器

| 工具名              | 说明             | 示例                                                                   |
| ------------------- | ---------------- | ---------------------------------------------------------------------- |
| `collect-code`      | 收集代码         | `js-reverse call collect-code`                                         |
| `collection-diff`   | 收集差异对比     | `js-reverse call collection-diff --previous "snap1" --current "snap2"` |
| `search-in-scripts` | 搜索脚本中的内容 | `js-reverse call search-in-scripts --pattern "encrypt"`                |

**示例：**

```bash
# 收集页面代码
js-reverse call collect-code

# 智能模式收集
js-reverse call collect-code --smartMode priority --maxTotalSize 1048576

# 指定模式
js-reverse call collect-code --smartMode incremental --pattern "*.js"

# 代码差异对比
js-reverse call collection-diff --previous "before" --current "after"

# 搜索脚本内容
js-reverse call search-in-scripts --pattern "encrypt"
js-reverse call search-in-scripts --pattern "token" --caseSensitive false
```

### 重建包

| 工具名                  | 说明         | 示例                                                                                           |
| ----------------------- | ------------ | ---------------------------------------------------------------------------------------------- |
| `export-rebuild-bundle` | 导出重建包   | `js-reverse call export-rebuild-bundle --taskSlug "task1"`                                     |
| `diff-env-requirements` | 对比环境需求 | `js-reverse call diff-env-requirements --runtimeError "ReferenceError: window is not defined"` |

**示例：**

```bash
# 导出本地复现 bundle
js-reverse call export-rebuild-bundle --taskSlug "jd-h5st" --goal "逆向签名" --autoGenerate true

# 指定目标
js-reverse call export-rebuild-bundle --taskSlug "task1" --targetKeywords '["sign","encrypt"]' --targetUrlPatterns '["/api/*"]'

# 对比环境需求
js-reverse call diff-env-requirements --runtimeError "ReferenceError: fetch is not defined" --observedCapabilities "xhr"
```

### 反反调试

| 工具名            | 说明           | 示例                                                              |
| ----------------- | -------------- | ----------------------------------------------------------------- |
| `anti-anti-debug` | 反反调试       | `js-reverse call anti-anti-debug`                                 |
| `bypass-debugger` | 绕过调试器检测 | `js-reverse call bypass-debugger --targets '["eval","Function"]'` |

**示例：**

```bash
# 反反调试
js-reverse call anti-anti-debug

# 绕过无限 debugger
js-reverse call bypass-debugger --targets '["eval","Function","constructor"]'
```

### 加密 Hook

| 工具名            | 说明              | 示例                              |
| ----------------- | ----------------- | --------------------------------- |
| `hook-crypto-js`  | Hook CryptoJS 库  | `js-reverse call hook-crypto-js`  |
| `hook-js-encrypt` | Hook JSEncrypt 库 | `js-reverse call hook-js-encrypt` |
| `hook-sm-crypto`  | Hook SM-Crypto 库 | `js-reverse call hook-sm-crypto`  |

**示例：**

```bash
# Hook 所有 CryptoJS 算法
js-reverse call hook-crypto-js

# 指定算法
js-reverse call hook-crypto-js --algorithms '["AES","MD5","SHA"]'

# 日志格式
js-reverse call hook-crypto-js --logFormat json
js-reverse call hook-crypto-js --logFormat compact

# Hook JSEncrypt (RSA)
js-reverse call hook-js-encrypt
js-reverse call hook-js-encrypt --logFormat json

# Hook 国密算法
js-reverse call hook-sm-crypto
js-reverse call hook-sm-crypto --algorithms '["SM2","SM4"]'
```

### Vue DevTools

| 工具名                  | 说明              | 示例                                    |
| ----------------------- | ----------------- | --------------------------------------- |
| `activate-vue-devtools` | 激活 Vue DevTools | `js-reverse call activate-vue-devtools` |
| `clear-vue-guards`      | 清除 Vue 路由守卫 | `js-reverse call clear-vue-guards`      |
| `get-vue-routes`        | 获取 Vue 路由信息 | `js-reverse call get-vue-routes`        |

**示例：**

```bash
# 激活 Vue DevTools
js-reverse call activate-vue-devtools

# 清除路由守卫
js-reverse call clear-vue-guards

# 获取路由信息
js-reverse call get-vue-routes
```

### 会话状态

| 工具名                  | 说明               | 示例                                                                             |
| ----------------------- | ------------------ | -------------------------------------------------------------------------------- |
| `save-session-state`    | 保存会话状态       | `js-reverse call save-session-state --sessionId "s1"`                            |
| `restore-session-state` | 恢复会话状态       | `js-reverse call restore-session-state --sessionId "s1"`                         |
| `list-session-states`   | 列出会话状态       | `js-reverse call list-session-states`                                            |
| `delete-session-state`  | 删除会话状态       | `js-reverse call delete-session-state --sessionId "s1"`                          |
| `dump-session-state`    | 导出会话状态       | `js-reverse call dump-session-state --sessionId "s1" --path "/tmp/session.json"` |
| `load-session-state`    | 加载会话状态       | `js-reverse call load-session-state --path "/tmp/session.json"`                  |
| `check-browser-health`  | 检查浏览器健康状态 | `js-reverse call check-browser-health`                                           |

**示例：**

```bash
# 保存当前会话
js-reverse call save-session-state --sessionId "login-state"
js-reverse call save-session-state --sessionId "s1" --includeCookies true --includeLocalStorage true

# 恢复会话
js-reverse call restore-session-state --sessionId "login-state"
js-reverse call restore-session-state --sessionId "s1" --clearStorageBeforeRestore true

# 列出所有保存的会话
js-reverse call list-session-states

# 导出会话到文件
js-reverse call dump-session-state --sessionId "s1" --path "/tmp/session.json"
js-reverse call dump-session-state --sessionId "s1" --path "/tmp/session.json" --pretty true

# 从文件加载会话
js-reverse call load-session-state --path "/tmp/session.json"

# 检查浏览器状态
js-reverse call check-browser-health

# 删除会话
js-reverse call delete-session-state --sessionId "s1"
```

### v_jstools 工具集

| 工具名                | 说明                   | 示例                                                    |
| --------------------- | ---------------------- | ------------------------------------------------------- |
| `deobfuscate-code-vj` | 去混淆代码 (v_jstools) | `js-reverse call deobfuscate-code-vj --code "..."`      |
| `minify-code`         | 压缩/格式化代码        | `js-reverse call minify-code --code "..."`              |
| `transpile-code`      | 转译代码               | `js-reverse call transpile-code --code "..."`           |
| `analyze-ast`         | 分析 AST               | `js-reverse call analyze-ast --code "..."`              |
| `diff-code`           | 差异代码对比           | `js-reverse call diff-code --text1 "..." --text2 "..."` |

**示例：**

```bash
# 代码去混淆
js-reverse call deobfuscate-code-vj --code "obfuscated code..."
js-reverse call deobfuscate-code-vj --code "..." --mode auto
js-reverse call deobfuscate-code-vj --code "..." --mode sojson
js-reverse call deobfuscate-code-vj --code "..." --mode ob
js-reverse call deobfuscate-code-vj --code "..." --clearExtra true --clearUnused true

# 代码压缩/格式化
js-reverse call minify-code --code "function test() {...}"
js-reverse call minify-code --code "function test() {...}" --action format
js-reverse call minify-code --code "function test() {...}" --action minify

# 代码转译
js-reverse call transpile-code --code "const x = () => {}"
js-reverse call transpile-code --code "..." --presets '["env","typescript"]'

# AST 分析
js-reverse call analyze-ast --code "function test() { return 1; }"
js-reverse call analyze-ast --code "..." --detail full
js-reverse call analyze-ast --code "..." --filterType "FunctionDeclaration"

# 代码对比
js-reverse call diff-code --text1 "function a() {}" --text2 "function b() {}"
js-reverse call diff-code --text1 "..." --text2 "..." --mode context
```

### 代码模板

| 工具名                | 说明         | 示例                                                    |
| --------------------- | ------------ | ------------------------------------------------------- |
| `get-code-template`   | 获取代码模板 | `js-reverse call get-code-template --name "fetch-hook"` |
| `list-code-templates` | 列出代码模板 | `js-reverse call list-code-templates`                   |

**示例：**

```bash
# 列出所有模板
js-reverse call list-code-templates

# 获取指定模板
js-reverse call get-code-template --name "fetch-hook"
js-reverse call get-code-template --name "xhr-intercept"
```

### 技能系统

| 工具名         | 说明           | 示例                                                      |
| -------------- | -------------- | --------------------------------------------------------- |
| `invoke-skill` | 调用已注册技能 | `js-reverse call invoke-skill --skillName "observe-flow"` |
| `list-skills`  | 列出可用技能   | `js-reverse call list-skills`                             |

**示例：**

```bash
# 列出所有技能
js-reverse call list-skills

# 调用技能
js-reverse call invoke-skill --skillName "observe-flow" --url "https://example.com"
js-reverse call invoke-skill --skillName "auto-hook" --url "https://example.com"
```

---

## 内置技能

### observe-flow - 观察流

**类别：** observe

**描述：** 观察模式——收集和分析页面脚本，识别加密和混淆，生成安全风险评估报告。

**使用方法：**

```bash
js-reverse call-skill observe-flow --url https://example.com
```

**选项：**

| 选项                   | 类型    | 说明                                                  |
| ---------------------- | ------- | ----------------------------------------------------- |
| `includeDynamic`       | boolean | 包含动态脚本                                          |
| `includeExternal`      | boolean | 包含外部脚本                                          |
| `includeInline`        | boolean | 包含内联脚本                                          |
| `includeServiceWorker` | boolean | 包含 Service Worker                                   |
| `includeWebWorker`     | boolean | 包含 Web Worker                                       |
| `maxFileSize`          | number  | 最大文件大小                                          |
| `maxTotalSize`         | number  | 最大总大小                                            |
| `mode`                 | string  | 模式：`summary` / `priority` / `incremental` / `full` |
| `smartMode`            | boolean | 智能模式                                              |
| `dynamicWaitMs`        | number  | 动态等待时间（毫秒）                                  |
| `priorities`           | array   | 优先级列表                                            |
| `compress`             | boolean | 压缩输出                                              |
| `timeout`              | number  | 超时时间（毫秒）                                      |

**典型工作流：**

1. 启动守护进程并连接浏览器
2. 导航到目标网页
3. 执行 `observe-flow` 收集页面脚本
4. 分析报告中的加密检测和混淆识别结果
5. 根据风险评估制定逆向策略

### auto-hook - 自动 Hook

**类别：** hook

**描述：** 自动注入调试 Hook 和加密库 Hook，辅助逆向分析。

**使用方法：**

```bash
js-reverse call-skill auto-hook --url https://example.com
```

**预设模式：**

| 预设名          | 包含的 Hook                                          | 适用场景     |
| --------------- | ---------------------------------------------------- | ------------ |
| `none`          | 最小化 Hook                                          | 轻量调试     |
| `api-signature` | hookFetch, hookXhr, hookCookie                       | API 签名分析 |
| `network-core`  | hookFetch, hookXhr, hookTimers, hookEval, hookCookie | 网络核心分析 |

**选项：**

| 选项              | 类型    | 默认值 | 说明            |
| ----------------- | ------- | ------ | --------------- |
| `preset`          | string  | `none` | 预设模式        |
| `autoInject`      | boolean | true   | 自动注入        |
| `waitAfterHookMs` | number  | -      | Hook 后等待时间 |
| `useAI`           | boolean | -      | 使用 AI 辅助    |
| `hookCrypto`      | boolean | -      | Hook 加密库     |
| `hookRsa`         | boolean | -      | Hook RSA 加密   |
| `hookSmCrypto`    | boolean | -      | Hook 国密算法   |
| `hookTimers`      | boolean | -      | Hook 定时器     |
| `hookEval`        | boolean | -      | Hook eval       |
| `hookCookie`      | boolean | -      | Hook Cookie     |
| `hookXhr`         | boolean | -      | Hook XHR        |
| `hookFetch`       | boolean | -      | Hook Fetch      |

**典型工作流：**

1. 启动守护进程并导航到目标网页
2. 执行 `auto-hook` 注入调试 Hook
3. 观察网络请求和加密过程
4. 分析 Hook 捕获的数据

### rebuild-bundle - 重建包

**类别：** rebuild

**描述：** 本地复现——构建 Node.js 环境来复现目标代码，支持参数提取。

**使用方法：**

```bash
js-reverse call-skill rebuild-bundle --url https://example.com
```

**选项：**

| 选项                  | 类型     | 说明             |
| --------------------- | -------- | ---------------- |
| `targetUrl`           | string   | 目标 URL         |
| `targetFunctionNames` | string[] | 目标函数名列表   |
| `targetKeywords`      | string[] | 目标关键词       |
| `targetUrlPatterns`   | string[] | 目标 URL 模式    |
| `goal`                | string   | 逆向目标描述     |
| `autoGenerate`        | boolean  | 自动生成环境文件 |
| `maxEvidenceItems`    | number   | 最大证据项数量   |
| `taskId`              | string   | 任务 ID          |
| `taskSlug`            | string   | 任务标识         |

**生成的文件：**

- `env.js` - 浏览器环境模拟
- `polyfills.js` - 缺失 API 的 polyfill
- `entry.js` - 入口文件，包含目标函数调用

**典型工作流：**

1. 使用 `observe-flow` 收集页面脚本
2. 使用 `auto-hook` 捕获运行时数据
3. 执行 `rebuild-bundle` 生成本地复现环境
4. 在 Node.js 中运行生成的文件，验证签名逻辑

---

## REPL 模式

REPL 提供了一个交互式命令行界面，可以直接调用工具和技能。

### 启动

```bash
js-reverse repl
```

### 可用命令

```
> skill observe-flow --url https://example.com    # 调用技能
> tool screenshot                                  # 调用工具
> status                                           # 检查守护进程状态
> list-skills                                      # 列出技能
> list-tools                                       # 列出工具
> help                                             # 显示帮助
> exit                                             # 退出
```

---

## 常见问题

### 如何启动 Chrome Debug 模式？

**macOS：**

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

**Linux：**

```bash
google-chrome --remote-debugging-port=9222
```

**Windows：**

```cmd
chrome.exe --remote-debugging-port=9222
```

### 如何查看所有可用工具？

```bash
js-reverse list-tools
```

### 如何查看所有可用技能？

```bash
js-reverse list-skills
```

### 如何使用 JSON 格式输出？

```bash
js-reverse list-tools --json
js-reverse list-skills --json
```

### 工具总数

本项目共提供 **120+** 个 MCP 工具，覆盖以下领域：

- DOM 操作与页面交互
- 网络请求与 WebSocket 监控
- 调试器控制（断点、单步、源码查看）
- Hook 注入（网络、加密、存储、定时器等）
- 代码分析与去混淆
- 本地环境复现
- 反反调试与隐身
- CDP 代理与多页面管理
- 性能分析与截图
- 会话状态持久化
