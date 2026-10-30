# 浏览器生命周期、导航与环境模拟参考文档 (Browser & Navigation Reference)

浏览器多标签页管理、URL 导航、iframe 切换、视口缩放、设备模拟与连接探活工具，以及 ego lite 浏览器接管。

## 概览 (Overview)

控制浏览器生命周期与上下文环境，在多 Tab 与嵌套 iframe 之间无缝切换。

| 工具名称               | 功能描述                                                         | 核心参数                                                    |
| :--------------------- | :--------------------------------------------------------------- | :---------------------------------------------------------- |
| `list_pages`           | 列出当前所有已打开的页面（包含索引 pageIdx、URL 与标题）         | 无                                                          |
| `select_page`          | 按索引或 ID 切换当前激活的页面上下文                             | `[--pageIdx <num>]`, `[--pageId <str>]`                     |
| `new_page`             | 创建新标签页并导航到指定 URL（支持前置预加载 Hook）              | `--url <str>`, `[--timeout <num>]`, `[--preloadHook <str>]` |
| `navigate_page`        | 控制当前页面导航（跳转、刷新、后退、前进）                       | `[--type <str>]`, `[--url <str>]`, `[--ignoreCache <bool>]` |
| `list_frames`          | 列出当前页面中的全部 Frame（含跨域 iframe 层级树）               | 无                                                          |
| `select_frame`         | 选择指定的 Frame（索引来自 list_frames）作为后续 JS/DOM 执行环境 | `--frameIdx <num>`                                          |
| `check_browser_health` | 检查浏览器连接健康状态与页面可用性                               | 无                                                          |
| `resize_page`          | 将页面视口尺寸调整为指定的宽度与高度                             | `--width <num>`, `--height <num>`                           |
| `emulate_mobile`       | 模拟移动设备视口、User-Agent 与 Touch 触摸事件，或恢复桌面模式   | `--enable <bool>`, `[--device <str>]`                       |
| `emulate_network`      | 通过 CDP 模拟弱网环境或离线断网（如 2G/3G/4G/Offline）           | `--throttlingOption <str>`                                  |
| `emulate_cpu`          | 通过 CDP 模拟 CPU 节流降速（如 4x/6x 慢速调试）                  | `--throttlingRate <num>`                                    |
| `open_devtools`        | 为当前选中页面打开 Chrome DevTools 独立调试标签页                | 无                                                          |
| `update_extensions`    | 触发 Chrome 扩展更新                                             | 无                                                          |

---

## 详细命令与示例

### 1. 标签页与导航管理

```bash
# 1. 检查浏览器中打开的全部标签页
browsercli call list_pages

# 2. 切换到索引为 1 的目标标签页
browsercli call select_page --pageIdx 1

# 3. 创建新标签页，并前置注入反调试防护脚本
browsercli call new_page --url "https://example.com" --preloadHook "console.clear = function(){};"

# 4. 强制无缓存刷新当前页面
browsercli call navigate_page --type reload --ignoreCache true
```

### 2. 多 Frame / iframe 穿透

当目标验证码滑块或登录表单嵌入在 iframe 中时：

```bash
# 1. 列出所有 Frame 获取 frameIdx
browsercli call list_frames

# 2. 切换执行上下文到目标 iframe
browsercli call select_frame --frameIdx 2

# 3. 后续的 evaluate_script、query_dom 将直接在该 iframe 中执行
```

### 3. 设备与网络环境模拟 (Emulation)

```bash
# 模拟 iPhone 14 移动端访问
browsercli call emulate_mobile --enable true --device "iPhone 14"

# 恢复默认桌面模式
browsercli call emulate_mobile --enable false

# 调整视口大小
browsercli call resize_page --width 1920 --height 1080

# 模拟 3G 网络与 CPU 4 倍降速（排查异步竞态与动态加载时序）
browsercli call emulate_network --throttlingOption "Regular3G"
browsercli call emulate_cpu --throttlingRate 4
```

### 4. 探活与开发辅助

```bash
# 浏览器健康度检查
browsercli call check_browser_health

# 在浏览器内部开一个 devtools:// 调试页辅助人工排查
browsercli call open_devtools
```

---

## ego lite 浏览器接管（默认浏览器来源）

### 5. 连接正在运行的 ego lite

ego lite 是 **browsercli 的默认浏览器来源**：不带任何目标参数的 `browsercli browser connect` 就连 ego，`--ego` 只是把这个默认值显式写出来。ego 不启动新浏览器，而是通过本地 CDP 桥接接管**正在运行的 ego lite**，直接复用其中已登录的真实会话。建页发生在独立的 Agent 任务空间（TaskSpace）里，与用户私人标签页物理隔离。

```bash
# 无参 connect = 连接 ego（默认）
browsercli browser connect

# 显式写法，两者等价；脚本里建议写明以便自证意图
browsercli browser connect --ego

# 显式关闭 ego，改走远程 CDP 或本地启动
browsercli browser connect --ego=false --browser-url "http://127.0.0.1:9222"

# 连接时保留分析现场，断开后标签页交还用户（本次新建的空间默认会关闭）
browsercli browser connect --keep-page

# 指定新任务空间使用的 Profile（仅在新建空间时生效）
browsercli browser connect --profile "Profile 1"

# 确认已进入 ego 模式（期望 Mode=ego）
browsercli browser status
```

默认值只在**完全没得选**时生效：显式 `--ego=false`、`BROWSER_EGO=false`、任一目标参数（`--browser-url` / `--ws-endpoint` / `--channel` / `--executable-path`），或 `--cloak`，都会让默认值让位。未安装 ego lite 时无参 `connect` 直接报错并提示设置 `EGO_BROWSER_CLI`，**不会**静默降级成本地 Chromium。

### 6. 任务空间与 Profile 管理

```bash
# 列出 ego 任务空间归属与全部可用 Profile（无需已连接浏览器）
browsercli browser space list

# 扁平 k:v 输出，便于脚本解析（无表格边框）
browsercli browser space list --json
```

输出字段 `spaces` 给出各任务空间的 `id` / `name` / `ownership`（`agent` 或 `user`）/ `profileId`；`profiles` 给出全部可指定 Profile，`defaultProfileId` 是不指定 `--profile` 时的取值。复用已有空间会保留其原 Profile 并在诊断日志中提示，不会静默切换。

### 7. ego 模式的参数约束

| 情形                                                                                                                                                   | 结果                                             |
| :----------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------- |
| `--cloak` / `--headless` / `--user-data-dir` / `--isolated` / `--minimal-stealth` / `--full-stealth-args` / `--js-stealth` / `--accept-insecure-certs` | 被拒绝（ego 不本地启动浏览器，这些参数永不生效） |
| `--browser-url` / `--ws-endpoint` / `--channel` / `--executable-path`                                                                                  | 被拒绝（ego 与连接目标互斥，不附连指定端点）     |

```bash
# ❌ 两类组合都会被 VALIDATION_ERROR 拒绝
browsercli browser connect --ego --cloak
browsercli browser connect --ego --browser-url http://127.0.0.1:9222
```

### 8. 已知能力边界

| 限制                | 表现                                                                             | 应对                                                                                                                                                  |
| :------------------ | :------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- |
| ego 无 `Storage` 域 | `get_storage --type cookies` 报 `'Storage.getCookies' wasn't found`              | `localStorage` / `sessionStorage` 正常，Cookie 改用页面内 `document.cookie` 或既有会话                                                                |
| 窗口最小化          | `take_screenshot` 报 `Cannot capture a screenshot while the window is minimized` | 恢复 ego 窗口后重试                                                                                                                                   |
| 任务空间被外部关闭  | 工具报 `Task space N does not exist`                                             | ego 的 selected task space 是进程级全局状态，其他 ego 客户端可将其切走；执行 `browsercli browser disconnect && browsercli browser connect --ego` 恢复 |
| 任务空间默认不保留  | `disconnect` 后 agent 标签页消失                                                 | 需保留现场时连接时加 `--keep-page`；注意仅「本次新建」的空间会被关闭，复用的空间一律保留                                                              |
