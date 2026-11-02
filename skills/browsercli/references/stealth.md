# 反检测与反反调试参考文档 (Anti-Detection & Stealth Reference)

无限 debugger 绕过与定时器/视口防封锁工具。

## 概览 (Overview)

现代防爬网关与前端加固通常会植入定时器死循环 `debugger`、检测 `navigator.webdriver` 自动化标识、监听窗口尺寸变化防开控制台等。本组工具用于清除这些干扰。

### 核心反检测分层规范 (Stealth Philosophy)

1. **协议层 (Patchright)**：始终启用，绝不在启动时预先调用 `Runtime.enable`，保持 CDP 域纯净。
2. **源码层 (CloakBrowser 二进制)**：使用 `browsercli browser connect --cloak` 启用，49 个 C++ patch，profile 物理隔离。
3. **启动参数**：默认采用最小集 `MINIMAL_STEALTH_ARGS`，不滥用已被指纹库标记的特征 flag。

| 工具名称          | 功能描述                                                                           | 核心参数 |
| :---------------- | :--------------------------------------------------------------------------------- | :------- |
| `bypass_debugger` | 动态移除 eval/Function/constructor 中的 debugger 关键字，彻底绕过死循环            | 无       |
| `anti_anti_debug` | 反反调试综合工具集：固定窗口尺寸、冻结时间、阻止关闭、阻止历史刷新、隐藏 webdriver | 无       |

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
browsercli call bypass_debugger
```

工具将 hook 原型构造器，自动将包含 `debugger` 的动态求值函数剥离为空函数。

### 2. 启用反反调试防护罩 (`anti_anti_debug`)

防范因窗口尺寸变化（打开 DevTools）、定时器校准偏差而导致的页面白屏或重定向：

```bash
browsercli call anti_anti_debug
```
