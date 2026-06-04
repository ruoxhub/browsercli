# 代码模板（Code Templates）

`list_code_templates` / `get_code_template` / `inject_code_template` 是把**预置反检测片段**、**Hook 脚本**、**常用 polyfill** 模板化复用的入口。

避免每次都从零写：比如 `navigator.webdriver` 屏蔽脚本、Canvas noise 生成器、proxy handler wrapper 等。

---

## 工作流

```
# 1. 列出所有模板
list_code_templates
# → [{name: "stealth-webdriver", description: "...", size: 234}, ...]

# 2. 读源码（避免在注入前猜语义）
get_code_template --templateName <name>
# → {name, description, source, size}

# 3. 注入到当前页面（执行 + 生效）
inject_code_template --templateName <name>
# 立即在当前 frame 执行

# 4. （可选）配合 inject_preload_script 在首屏前注册
# 注意：inject_code_template 是 runtime 注入；preload 是未来文档
```

---

## 典型使用场景

| 场景 | 模板名（典型） | 行为 |
|------|---------------|------|
| 屏蔽 webdriver | `stealth-webdriver` | `Object.defineProperty(navigator, 'webdriver', ...)` |
| Canvas 噪声 | `canvas-noise` | 改写 `HTMLCanvasElement.prototype.toDataURL` 加随机像素 |
| WebGL 指纹屏蔽 | `webgl-mask` | 锁定 `WebGLRenderingContext` 的几个关键参数 |
| 通用 Hook wrapper | `hook-wrapper` | 包装 `Function.prototype` 暴露 `window.__hooks` |
| 持久化 cookie helper | `cookie-helper` | 暴露 `window.__cookie` 读 / 写接口 |
| Fetch 拦截器 | `fetch-interceptor` | 全局 fetch 拦截（与 `create_hook --type fetch` 类似但更轻） |

> 实际模板名以 `list_code_templates` 输出为准。`get_code_template` 返回的 `description` 是最权威的语义说明。

---

## 何时用模板 vs `create_hook`

| 需求 | 选 | 原因 |
|------|----|------|
| 预置反检测片段 | `inject_code_template` | 模板化，命名稳定 |
| 自定义 Hook（参数动态、capture 配置） | `create_hook` | 完全自定义 |
| 一过性探测（看 navigator 当前值） | `evaluate_script` | 单次执行 |
| 跨 SPA 路由持续生效 | `inject_hook --persistent true` 或 `inject_preload_script` | 持久化路径 |

---

## 安全注意

- 模板**会立即在页面执行**（与 `evaluate_script` 等价）
- 不要在未读取 `get_code_template` 源码前注入陌生模板
- 模板不能撤销（要清效果只能 reload）
