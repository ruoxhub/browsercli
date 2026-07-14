# Hook 模式手册（create_hook + inject_hook）

`create_hook` + `inject_hook` 是 v2 之后唯一一等的 Hook 创建路径。v1 的 `hook_fetch` / `hook_xhr_open` / `hook_date_now` / `fixed_window_size` 等**已下线**，统一通过 `create_hook --type <t>` 实现。

本文档按 `type` 维度给出用法和反调试场景的对应推荐。

---

## 工作流

```
# 1. 创建 Hook（声明式）
create_hook --type <type> [--params <json>] [--capture <arr>] [--condition <arr>] [--action <json>]
  → 返回 {hookId, script}

# 2. 注入到页面
inject_hook --hookId <id> --script <script>
  → 立即生效（仅当前页面）

# 3. （可选）持久化（跨导航）
inject_hook --hookId <id> --script <script> --persistent true
  → 通过 Page.addScriptToEvaluateOnNewDocument 注册

# 4. 触发动作（点击 / 滚动 / 输入）

# 5. 查看捕获数据
get_hook_data [--hookId <id>] [--view summary|raw|detail] [--maxRecords <n>] \
              [--type <t>] [--event <name>] [--phase before|after]
```

---

## type 完整清单

> 下表是 v2 当前支持的 `type`，以 `create_hook --help` 输出为准。脚本示例用伪代码，需按目标站真实情况调整 `condition`。

### `function` — 任意函数 Hook

```js
// 脚本片段：拦截指定函数
(function () {
  const orig = window.targetFunc;
  window.targetFunc = function (...args) {
    window.__hookCapture = window.__hookCapture || [];
    window.__hookCapture.push({
      type: 'function',
      target: 'targetFunc',
      args: args,
      stack: new Error().stack,
    });
    const ret = orig.apply(this, args);
    window.__hookCapture[window.__hookCapture.length - 1].ret = ret;
    return ret;
  };
})();
```

**适用**：已知函数名（全局 / 闭包外）。可配合 `trace_function` 找函数名。

### `fetch` — fetch 拦截

```js
(function () {
  const orig = window.fetch;
  window.fetch = function (url, init) {
    window.__hookFetch = window.__hookFetch || [];
    window.__hookFetch.push({
      url: String(url),
      method: (init && init.method) || 'GET',
      body: init && init.body,
      time: Date.now(),
    });
    return orig.apply(this, arguments).then(r => {
      const last = window.__hookFetch[window.__hookFetch.length - 1];
      last.status = r.status;
      return r;
    });
  };
})();
```

**适用**：现代请求拦截（fetch）。配合 `condition: ["urlContains('api.example.com')"]` 过滤。

### `xhr` — XMLHttpRequest 拦截

```js
(function () {
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__xhrMeta = {method, url: String(url), time: Date.now()};
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    window.__hookXhr = window.__hookXhr || [];
    window.__hookXhr.push({...this.__xhrMeta, body});
    return origSend.apply(this, arguments);
  };
})();
```

**适用**：传统 AJAX。

### `property` — 属性读写拦截

```js
// 拦截 navigator.webdriver 读取
Object.defineProperty(navigator, 'webdriver', {
  get: () => undefined,
  configurable: true,
});
```

**适用**：window.navigator._ / window.chrome._ 等存在性/描述符探针。

### `cookie` — cookie 读写拦截

```js
const origDesc =
  Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') ||
  Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');
// 包装 getter/setter，记录每次读写
```

**适用**：风控读 cookie 行为（高频采样）。

### `websocket` — WebSocket 拦截

```js
const OrigWS = window.WebSocket;
window.WebSocket = function (url, protocols) {
  const ws = protocols ? new OrigWS(url, protocols) : new OrigWS(url);
  window.__hookWs = window.__hookWs || [];
  window.__hookWs.push({url: String(url), time: Date.now()});
  const origSend = ws.send.bind(ws);
  ws.send = function (data) {
    window.__hookWs.push({dir: 'send', data, time: Date.now()});
    return origSend(data);
  };
  ws.addEventListener('message', e => {
    window.__hookWs.push({dir: 'recv', data: e.data, time: Date.now()});
  });
  return ws;
};
```

**适用**：拦截 WS 客户端行为（含心跳伪造、重放）。`inject_hook --persistent true` 跨页面生效。

### `eval` — eval/Function 拦截

```js
const origEval = window.eval;
window.eval = function (code) {
  window.__hookEval = window.__hookEval || [];
  window.__hookEval.push({
    code: String(code),
    stack: new Error().stack,
    time: Date.now(),
  });
  return origEval.call(this, code);
};
```

**适用**：动态执行点定位。注意：vmp 脚本可能产生大量 `eval`，加 `condition: ["code.length < 5000"]` 限流。

### `timer` — Date.now / performance.now / setTimeout 拦截

```js
// 固定时间戳
const fixedNow = 1700000000000;
const OrigDateNow = Date.now;
Date.now = function () {
  return fixedNow;
};
performance.now = function () {
  return 0;
};
// 固定 setTimeout 间隔（如有需要）
```

**适用**：时间差检测反调试。

---

## 反调试场景的 type 映射

| 反调试手段                                                  | type       | 目标                                              |
| ----------------------------------------------------------- | ---------- | ------------------------------------------------- |
| 时间差（`Date.now` / `performance.now`）                    | `timer`    | 全局时间戳固定                                    |
| `Math.random` 确定性                                        | `timer`    | 固定返回                                          |
| `console.clear` 清屏                                        | `function` | `console.clear` → noop                            |
| `console.table` 时间检测                                    | `function` | `console.table` → noop                            |
| 窗口大小检测                                                | `property` | `window.outerWidth/Height/innerWidth/Height` 固定 |
| 页面跳转（`history.go` / `location.href` / `window.close`） | `function` | 拦截 + noop                                       |
| `Function.prototype.toString` 检测                          | `function` | 替换为 native toString                            |
| 描述符探针                                                  | `property` | 锁定描述符                                        |
| 原型链探针                                                  | `property` | 锁定 `constructor.name` / `Symbol.toStringTag`    |
| Cookie 探针                                                 | `cookie`   | 记录读写                                          |

---

## 持久化 vs 单次

| 模式                            | 适用                                                                                                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 普通 `inject_hook`              | 当前页面的当前生命周期（适合已知目标已加载）                                                                   |
| `inject_hook --persistent true` | 通过 `Page.addScriptToEvaluateOnNewDocument` 注册，跨 SPA 路由跳转仍生效（适合 hook 在脚本加载**前**就要生效） |

首屏初始化的目标，**必须**用 persistent 模式。

---

## 数据回传视图

```
get_hook_data --view summary    # 默认，按 hookId 分组 + 调用次数 + 最近时间
get_hook_data --view raw        # 原始捕获（看真实 payload）
get_hook_data --view detail     # 含 stack 的全量
```

按 `phase` 过滤 `before` / `after`（部分 type 暴露）。按 `type` 过滤 `function` / `xhr` / `fetch` 等。

---

## 常见错误

| 错误                           | 原因                                              | 解决                                                           |
| ------------------------------ | ------------------------------------------------- | -------------------------------------------------------------- |
| `Hook script must be a string` | `--script` 传了对象                               | 脚本作为字符串传（PowerShell 用 `--file params.json`）         |
| `hookId not found`             | inject 前没保存 hookId                            | 用 `list_created_hooks` 找回                                   |
| 命中后 `get_hook_data` 为空    | 没触发动作                                        | 显式 `click` / 触发；或在 `condition` 里去掉过滤               |
| 大量噪音                       | 没加 condition                                    | `condition: ["urlContains('target.com')"]` / `code.length < N` |
| 反调试被检测                   | 用了 function 类型的 hook，被 `toString` 探针抓到 | 用 `property` 或先 `inject_stealth`                            |
