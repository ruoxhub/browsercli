# 反检测与反反调试参考文档 (Anti-Detection & Stealth Reference)

无限 debugger 绕过、定时器/视口防封锁、自定义 User-Agent 及反爬隐身预设工具。

## 概览 (Overview)

现代防爬网关与前端加固通常会植入定时器死循环 `debugger`、检测 `navigator.webdriver` 自动化标识、监听窗口尺寸变化防开控制台等。本组工具用于清除这些干扰。

### 核心反检测分层规范 (Stealth Philosophy)

1. **协议层 (Patchright)**：始终启用，绝不在启动时预先调用 `Runtime.enable`，保持 CDP 域纯净。
2. **源码层 (CloakBrowser 二进制)**：使用 `proxycli browser connect --cloak` 启用，49 个 C++ patch，profile 物理隔离。
3. **启动参数**：默认采用最小集 `MINIMAL_STEALTH_ARGS`，不滥用已被指纹库标记的特征 flag。
4. **JS 注入层 (`inject_stealth`)**：**默认不隐式注入**，需要用户或场景显式选择 opt-in，避免暴露 `Object.defineProperty` 的原型检测面。

| 工具名称                | 功能描述                                                                           | 核心参数            |
| :---------------------- | :--------------------------------------------------------------------------------- | :------------------ |
| `bypass_debugger`       | 动态移除 eval/Function/constructor 中的 debugger 关键字，彻底绕过死循环            | 无                  |
| `anti_anti_debug`       | 反反调试综合工具集：固定窗口尺寸、冻结时间、阻止关闭、阻止历史刷新、隐藏 webdriver | 无                  |
| `set_user_agent`        | 通过 CDP 为当前页面覆盖自定义 User-Agent 请求头及 `navigator.userAgent` 属性       | `--userAgent <str>` |
| `inject_stealth`        | 按需注入反检测隐身脚本（伪装 chrome 对象、WebGL 噪点、Canvas 指纹等）              | `[--preset <str>]`  |
| `list_stealth_features` | 列出当前支持的所有细粒度隐身特性开关                                               | 无                  |
| `list_stealth_presets`  | 列出可用的隐身配置预设（如 default, strong 等）                                    | 无                  |

---

## 详细命令与示例

### 1. 绕过无限 debugger 陷阱 (`bypass_debugger`)

当遇到如下反调试手段时：

```js
setInterval(() => {
  (function () {})['constructor']('debugger')();
}, 50);
```

执行：

```bash
proxycli call bypass_debugger
```

工具将 hook 原型构造器，自动将包含 `debugger` 的动态求值函数剥离为空函数。

### 2. 启用反反调试防护罩 (`anti_anti_debug`)

防范因窗口尺寸变化（打开 DevTools）、定时器校准偏差而导致的页面白屏或重定向：

```bash
proxycli call anti_anti_debug
```

### 3. 自定义 User-Agent 与按需隐身注入

```bash
# 设置最新版桌面端 Chrome User-Agent
proxycli call set_user_agent --userAgent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"

# 遇到特定高强度风控站点（如 Cloudflare Turnstile / CreepJS）时，按需注入伪装脚本
proxycli call inject_stealth --preset "standard"
```
