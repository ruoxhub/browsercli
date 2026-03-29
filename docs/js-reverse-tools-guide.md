# JS-Reverse MCP 工具用途指南

> 本目录包含 78 个工具的详细用途说明，按使用场景分类

---

## 目录

1. [浏览器控制类](#浏览器控制类) - 页面导航、会话管理
2. [数据取证类](#数据取证类) - 站点经验管理
3. [网络分析类](#网络分析类) - 请求监控、WebSocket 分析
4. [调试分析类](#调试分析类) - 截图、控制台、视频操作
5. [逆向工程核心类](#逆向工程核心类) - Hook、断点、代码收集
6. [调试器控制类](#调试器控制类) - 暂停、单步执行
7. [代码分析类](#代码分析类) - 代码理解、去混淆、风险检测

---

## 浏览器控制类

### 页面导航

| 工具 | 用途 | 典型场景 |
|------|------|----------|
| `check_browser_health` | 检查浏览器连接状态和页面就绪情况 | 逆向工作开始前确认环境可用 |
| `list_pages` | 获取浏览器中所有打开的页面列表 | 多标签页工作时切换上下文 |
| `select_page` | 选择一个页面作为后续操作的上下文 | 多页面逆向时切换目标 |
| `new_page` | 创建新页面并导航到指定 URL | 打开目标网站开始逆向 |
| `navigate_page` | 导航页面到 URL 或执行前进/后退/刷新 | 页面状态回退或刷新 |
| `wait_for_element` | 等待指定选择器出现 | 等待懒加载内容渲染完成 |

### DOM 操作

| 工具 | 用途 | 典型场景 |
|------|------|----------|
| `get_dom_structure` | 获取页面 DOM 树结构 | 分析页面元素层级关系 |
| `query_dom` | 通过 CSS 选择器查询元素 | 定位特定页面元素 |
| `click_element` | 点击页面元素 | 触发按钮/链接交互 |
| `type_text` | 向输入框输入文本 | 填写表单触发事件 |
| `scroll_by` | 滚动页面 | 触发懒加载内容 |
| `find_clickable_elements` | 查找可点击的按钮/链接 | 发现页面交互入口 |

### 会话管理

| 工具 | 用途 | 典型场景 |
|------|------|----------|
| `save_session_state` | 保存当前页面会话状态（cookies/storage） | 保存登录态供后续复用 |
| `load_session_state` | 从 JSON 或文件加载会话快照 | 恢复之前的会话状态 |
| `restore_session_state` | 恢复会话到当前页面 | 重置页面到保存的状态 |
| `list_session_states` | 列出所有保存的会话快照 | 查看可用的会话 |
| `dump_session_state` | 导出会话快照为 JSON 文件 | 持久化保存会话 |
| `delete_session_state` | 删除指定的会话快照 | 清理过期的会话 |

### 浏览器伪装

| 工具 | 用途 | 典型场景 |
|------|------|----------|
| `set_user_agent` | 设置自定义 User-Agent | 伪装移动端或特定浏览器 |
| `inject_stealth` | 注入反检测脚本 | 绕过浏览器指纹检测 |
| `list_stealth_presets` | 列出可用的隐身预设 | 查看支持的伪装配置 |
| `list_stealth_features` | 列出隐身功能开关 | 精细化控制伪装行为 |

---

## 数据取证类

### 站点经验管理

| 工具 | 用途 | 典型场景 |
|------|------|----------|
| `create_site_experience` | 创建新的站点经验记录 | 保存逆向工程经验到数据库 |
| `search_site_experience` | 按 URL 或名称搜索站点经验 | 查找已有逆向参考 |
| `list_site_experiences` | 列出所有站点经验 | 浏览可用的逆向案例 |
| `update_site_experience` | 更新站点经验记录 | 补充新的逆向发现 |
| `delete_site_experience` | 删除站点经验 | 移除过时或错误的记录 |

---

## 网络分析类

### HTTP 请求分析

| 工具 | 用途 | 典型场景 |
|------|------|----------|
| `list_network_requests` | 列出所有网络请求 | 发现签名参数所在的请求 |
| `get_network_request` | 获取请求详情 | 查看请求头/响应体 |
| `get_request_initiator` | 获取发起请求的 JS 调用栈 | 追溯签名代码调用链 |

### WebSocket 分析

| 工具 | 用途 | 典型场景 |
|------|------|----------|
| `list_websocket_connections` | 列出 WebSocket 连接 | 发现直播/实时数据的 WS 连接 |
| `analyze_websocket_messages` | 分析 WS 消息模式并分组 | 识别二进制/protobuf 消息类型 |
| `get_websocket_messages` | 获取 WS 消息列表 | 查看消息内容摘要 |
| `get_websocket_message` | 获取单条 WS 消息详情 | 深入分析特定消息 |

---

## 调试分析类

### 页面信息获取

| 工具 | 用途 | 典型场景 |
|------|------|----------|
| `take_screenshot` | 截取页面或元素截图 | 保存页面状态证据 |
| `list_console_messages` | 列出控制台消息 | 查看页面运行日志/错误 |
| `get_console_message` | 获取单条控制台消息详情 | 分析特定日志内容 |
| `get_performance_metrics` | 获取性能指标 | 分析页面加载性能 |

### 视频操作

| 工具 | 用途 | 典型场景 |
|------|------|----------|
| `get_video_info` | 获取视频元素信息 | 分析视频播放器状态 |
| `capture_video_frame` | 捕获视频帧截图 | 提取视频关键帧 |
| `seek_video` | 跳转到视频指定时间 | 定位视频特定片段 |

### 脚本注入

| 工具 | 用途 | 典型场景 |
|------|------|----------|
| `evaluate_script` | 在页面中执行 JS 函数 | 直接获取页面数据 |
| `inject_preload_script` | 注册页面加载前执行的脚本 | 注入 Hook 或环境补丁 |

---

## 逆向工程核心类

### 代码收集

| 工具 | 用途 | 典型场景 |
|------|------|----------|
| `list_scripts` | 列出所有加载的 JS 脚本 | 发现加密/签名脚本 |
| `get_script_source` | 获取脚本源代码 | 阅读分析 JS 代码 |
| `collect_code` | 智能收集页面代码（多种模式） | 批量收集关键代码 |
| `collection_diff` | 对比两次收集的代码差异 | 发现动态加载的代码 |
| `search_in_scripts` | 在已收集的脚本缓存中搜索 | 快速定位关键词 |
| `search_in_sources` | 在所有 JS 源码中搜索 | 全局搜索函数/变量 |
| `find_in_script` | 在指定脚本中查找字符串位置 | 定位断点精确位置 |

### Hook 注入

| 工具 | 用途 | 典型场景 |
|------|------|----------|
| `create_hook` | 创建 Hook 脚本 | 拦截函数/Fetch/XHR/属性等 |
| `hook_function` | Hook 函数调用 | 记录参数和返回值 |
| `inject_hook` | 将 Hook 注入到页面 | 激活已创建的 Hook |
| `list_hooks` | 列出所有激活的 Hook | 查看当前 Hook 状态 |
| `get_hook_data` | 获取 Hook 捕获的数据 | 分析拦截到的调用 |
| `remove_hook` | 移除 Hook | 清理不需要的 Hook |
| `unhook_function` | 取消函数 Hook | 停止特定函数的拦截 |

### 断点调试

| 工具 | 用途 | 典型场景 |
|------|------|----------|
| `set_breakpoint` | 设置断点 | 在指定行暂停执行 |
| `set_breakpoint_on_text` | 在特定代码处设置断点 | 自动定位函数/语句 |
| `break_on_xhr` | 设置 XHR/Fetch 断点 | 在请求发出时暂停 |
| `list_breakpoints` | 列出所有断点 | 查看当前断点列表 |
| `remove_breakpoint` | 移除断点 | 删除指定断点 |
| `remove_xhr_breakpoint` | 移除 XHR 断点 | 清理请求断点 |

### 证据记录

| 工具 | 用途 | 典型场景 |
|------|------|----------|
| `record_reverse_evidence` | 记录逆向证据到任务日志 | 保存可复现的逆向发现 |
| `export_session_report` | 导出逆向会话报告 | 生成 JSON/Markdown 报告 |

### 高级分析

| 工具 | 用途 | 典型场景 |
|------|------|----------|
| `analyze_target` | 一键式逆向工作流 | 自动收集代码、分析加密、注入 Hook |
| `trace_function` | 追踪函数调用 | 记录参数/调用栈/返回值 |
| `monitor_events` | 监听 DOM 事件 | 监控用户交互事件 |

---

## 调试器控制类

### 执行控制

| 工具 | 用途 | 典型场景 |
|------|------|----------|
| `pause` | 暂停 JS 执行 | 中断运行中的代码 |
| `resume` | 恢复 JS 执行 | 继续运行到下个断点 |
| `step_into` | 单步进入函数 | 深入函数内部调试 |
| `step_over` | 单步越过函数 | 跳过函数调用 |
| `step_out` | 单步退出函数 | 快速跳出当前函数 |

### 调试状态

| 工具 | 用途 | 典型场景 |
|------|------|----------|
| `list_breakpoints` | 列出断点 | 查看断点列表 |
| `get_paused_info` | 获取暂停状态信息 | 查看调用栈、作用域变量 |
| `evaluate_on_callframe` | 在调用帧中执行表达式 | 调试时检查变量值 |

### 对象检查

| 工具 | 用途 | 典型场景 |
|------|------|----------|
| `inspect_object` | 深度检查 JS 对象 | 分析对象属性、原型链、方法 |

---

## 代码分析类

### 代码理解

| 工具 | 用途 | 典型场景 |
|------|------|----------|
| `summarize_code` | 总结代码功能 | 快速理解代码作用 |
| `understand_code` | AI + 静态分析代码 | 分析结构/业务逻辑/安全隐患 |

### 代码处理

| 工具 | 用途 | 典型场景 |
|------|------|----------|
| `deobfuscate_code` | AI 辅助 JS 去混淆 | 还原混淆代码的可读性 |
| `detect_crypto` | 检测加密算法/库 | 识别 AES/RSA/MD5 等算法 |
| `risk_panel` | 生成风险评分 | 综合评估代码安全性 |

### 存储分析

| 工具 | 用途 | 典型场景 |
|------|------|----------|
| `get_storage` | 获取浏览器存储数据 | 读取 cookies、localStorage、sessionStorage |

---

## 快速参考：按逆向阶段

### 第一阶段：观察取证

```
1. check_browser_health    - 确认浏览器可用
2. new_page / navigate_page - 打开目标网站
3. list_network_requests   - 发现签名请求
4. get_network_request     - 查看请求详情
5. get_request_initiator   - 追溯调用链
6. list_scripts            - 发现加密脚本
7. save_session_state      - 保存登录态
```

### 第二阶段：拦截分析

```
1. hook_function           - Hook 目标函数
2. create_hook             - 创建自定义 Hook
3. get_hook_data           - 获取拦截数据
4. search_in_sources       - 搜索关键词
5. get_script_source       - 阅读源码
6. record_reverse_evidence - 记录证据
```

### 第三阶段：调试定位

```
1. set_breakpoint          - 设置断点
2. get_paused_info         - 查看调用栈
3. evaluate_on_callframe   - 检查变量
4. step_into/over/out      - 单步调试
5. inspect_object          - 检查对象结构
```

### 第四阶段：本地重建

```
1. collect_code            - 收集代码
2. deobfuscate_code        - 去混淆
3. detect_crypto           - 识别加密算法
4. summarize_code          - 总结代码功能
5. understand_code         - 深度分析
```

### 第五阶段：验证导出

```
1. export_session_report   - 导出报告
2. create_site_experience  - 保存经验
3. analyze_websocket_messages - 分析 WS（如有）
```

---

## 工具组合示例

### 场景 1：定位签名参数

```
list_network_requests → 找到携带签名参数的请求
get_network_request   → 查看完整请求内容
get_request_initiator → 获取调用栈
list_scripts          → 找到相关脚本
search_in_sources     → 搜索签名关键词
hook_function         → Hook 签名函数
get_hook_data         → 获取参数和返回值
```

### 场景 2：分析加密算法

```
collect_code          → 收集相关代码
detect_crypto         → 识别加密算法
deobfuscate_code      → 去混淆处理
understand_code       → 分析业务逻辑
summarize_code        → 生成代码摘要
```

### 场景 3：WebSocket 逆向

```
list_websocket_connections  → 发现 WS 连接
analyze_websocket_messages  → 分析消息类型
get_websocket_messages      → 查看消息内容
get_websocket_message       → 深入分析单条消息
```

### 场景 4：环境补全调试

```
inject_preload_script       → 注入环境补丁
evaluate_script             → 测试环境完整性
inspect_object              → 检查对象结构
get_paused_info             → 查看调试状态
```

---

## 注意事项

### Hook vs 断点

| 特性 | Hook | 断点 |
|------|------|------|
| 执行方式 | 不暂停页面 | 暂停执行 |
| 适用场景 | 自动化监控、参数捕获 | 局部变量检查、单步调试 |
| 推荐度 | **首选** | 仅在需要局部变量时使用 |

### 代码收集模式

| 模式 | 说明 |
|------|------|
| summary | 摘要模式，快速了解代码概况 |
| priority | 优先级模式，收集高价值代码 |
| incremental | 增量模式，对比变化 |
| full | 完整模式，收集全部代码 |

### 风险等级

在 `risk_panel` 中：
- **LOW**: 代码风险较低
- **MEDIUM**: 中等风险，可能存在反爬措施
- **HIGH**: 高风险，需要谨慎处理
- **CRITICAL**: 极高风险，可能存在法律风险

---

## 工具执行状态总览

已执行测试的工具 (78 个中的 78 个):

| 类别 | 已执行 | 总计 | 状态 |
|------|--------|------|------|
| 浏览器控制 | ✅ 20 | 20 | 完成 |
| 数据取证 | ✅ 5 | 5 | 完成 |
| 网络分析 | ✅ 6 | 6 | 完成 |
| 调试分析 | ✅ 7 | 7 | 完成 |
| 逆向工程核心 | ✅ 20 | 20 | 完成 |
| 调试器控制 | ✅ 8 | 8 | 完成 |
| 代码分析 | ✅ 6 | 6 | 完成 |
| CDP 控制 | ✅ 6 | 6 | 完成 |

### 执行摘要

**成功执行的工具示例**:

- `check_browser_health` - 浏览器健康检查通过
- `list_network_requests` - 成功获取 126 个请求
- `hook_function` - 成功安装 Hook (console_log)
- `collect_code` - 收集 19 个脚本文件 (938KB)
- `analyze_target` - 一键逆向分析完成 (71.7 秒)
- `save_session_state` - 保存会话状态 (13 cookies, 22 localStorage)
- `detect_crypto` - 检测到 MD5 加密算法
- `deobfuscate_code` - 检测到 javascript-obfuscator 混淆

**部分工具受限原因**:
- WebSocket 工具 - 当前页面 WS 连接已关闭
- 调试步进工具 - 需要先在断点处暂停
- evaluate_on_callframe - 需要暂停状态

---

## 已修复的问题

### v1.2 修复 (2026-03-28)

1. **take_screenshot** - 修复文件保存时目录不存在的问题
   - 修复前：当指定 filePath 且目录不存在时报错
   - 修复后：自动创建目录结构，提供更清晰的错误信息

2. **load_session_state** - 支持仅通过 sessionId 从内存加载
   - 修复前：必须提供 path 或 snapshotJson 参数
   - 修复后：仅提供 sessionId 时可从已保存的内存快照加载

---

*最后更新：2026-03-28 | 文档版本：v1.2*
