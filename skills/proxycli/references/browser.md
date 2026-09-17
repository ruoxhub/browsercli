# 浏览器生命周期、导航与环境模拟参考文档 (Browser & Navigation Reference)

浏览器多标签页管理、URL 导航、iframe 切换、视口缩放、设备模拟与连接探活工具。

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
proxycli call list_pages

# 2. 切换到索引为 1 的目标标签页
proxycli call select_page --pageIdx 1

# 3. 创建新标签页，并前置注入反调试防护脚本
proxycli call new_page --url "https://example.com" --preloadHook "console.clear = function(){};"

# 4. 强制无缓存刷新当前页面
proxycli call navigate_page --type reload --ignoreCache true
```

### 2. 多 Frame / iframe 穿透

当目标验证码滑块或登录表单嵌入在 iframe 中时：

```bash
# 1. 列出所有 Frame 获取 frameIdx
proxycli call list_frames

# 2. 切换执行上下文到目标 iframe
proxycli call select_frame --frameIdx 2

# 3. 后续的 evaluate_script、query_dom 将直接在该 iframe 中执行
```

### 3. 设备与网络环境模拟 (Emulation)

```bash
# 模拟 iPhone 14 移动端访问
proxycli call emulate_mobile --enable true --device "iPhone 14"

# 恢复默认桌面模式
proxycli call emulate_mobile --enable false

# 调整视口大小
proxycli call resize_page --width 1920 --height 1080

# 模拟 3G 网络与 CPU 4 倍降速（排查异步竞态与动态加载时序）
proxycli call emulate_network --throttlingOption "Regular3G"
proxycli call emulate_cpu --throttlingRate 4
```

### 4. 探活与开发辅助

```bash
# 浏览器健康度检查
proxycli call check_browser_health

# 在浏览器内部开一个 devtools:// 调试页辅助人工排查
proxycli call open_devtools
```
