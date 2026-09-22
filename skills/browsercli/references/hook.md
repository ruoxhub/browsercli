# 动态 Hook 与加解密拦截参考文档 (Dynamic Hooking Reference)

非阻塞运行时参数拦截、Hook 生命周期管理，以及加密库 / JSVMP 专用拦截脚本的生成与注入。

## 概览 (Overview)

Hook 技术相比断点最大的优势是**非阻塞**：拦截参数与返回值的同时不会暂停页面执行，不会破坏页面的时钟和长连接状态，是逆向工程自动化分析的首选手段。

| 工具名称                | 功能描述                                                                       | 核心参数                                                                                                  |
| :---------------------- | :----------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------- |
| `create_hook`           | 创建 Hook 定义（支持 function/fetch/xhr/property/cookie/websocket/eval/timer） | `--type <str>`, `[--hookId <str>]`, `[--capture <arr>]`, `[--action <str>]`                               |
| `inject_hook`           | 将 Hook 注入到页面中（支持 persistent 跨导航与 world 隔离）                    | `--hookId <str>`, `[--script <str>]`, `[--persistent <bool>]`, `[--world <str>]`                          |
| `get_hook_data`         | 获取 Hook 拦截到的运行时数据（支持 raw/summary/detail 视图与多字段过滤）       | `[--hookId <str>]`, `[--view <str>]`, `[--maxRecords <num>]`, `[--event <str>]`                           |
| `list_hooks`            | 列出当前页面上所有已安装的函数 Hook                                            | 无                                                                                                        |
| `list_created_hooks`    | 列出 HookManager 中所有已创建的 Hook 定义及统计记录数                          | `[--hookId <str>]`, `[--syncFromBrowser <bool>]`                                                          |
| `list_persistent_hooks` | 列出跨导航持久生效的 Hook                                                      | 无                                                                                                        |
| `remove_hook`           | 移除指定 Hook，并可选清理浏览器端存储的抓取数据                                | `--hookId <str>`, `[--cleanBrowser <bool>]`                                                               |
| `hook_function`         | 便捷 Hook 指定全局或对象路径函数（记录参数、返回值与调用栈，不暂停）           | `--target <str>`, `[--hookId <str>]`, `[--logArgs <bool>]`, `[--logResult <bool>]`, `[--logStack <bool>]` |
| `unhook_function`       | 移除通过 hook_function 安装的函数 Hook                                         | `--hookId <str>`                                                                                          |

> 加密库（CryptoJS / JSEncrypt / SM-crypto）与 JSVMP 探针不再是工具，改为 `skills/web-reverse-hook` 生成脚本 + `evaluate_script` / `inject_hook` 注入，见下方第 4 节。

---

## 详细命令与示例

### 1. 通用 Hook 创建与注入 (`create_hook` & `inject_hook`)

```bash
# 创建一个针对 window.calcToken 函数的 Hook 定义
browsercli call create_hook \
  --type function \
  --hookId "token_hook" \
  --description "拦截计算 Token 参数与返回值" \
  --capture '["args", "result"]'

# 注入 Hook 到页面（设置 persistent=true 使其在页面刷新/跳转后依然生效）
browsercli call inject_hook --hookId "token_hook" --persistent true
```

### 2. 便捷函数 Hook (`hook_function` & `unhook_function`)

无需编写复杂脚本，直接指定挂载路径即可记录调用信息：

```bash
# 拦截全局加密入口并打印调用栈
browsercli call hook_function \
  --target "window.securityService.encryptPayload" \
  --hookId "sec_hook" \
  --logArgs true \
  --logResult true \
  --logStack true

# 移除 Hook
browsercli call unhook_function --hookId "sec_hook"
```

### 3. 读取 Hook 采集数据 (`get_hook_data`)

```bash
# 查看所有已捕获数据的摘要统计
browsercli call get_hook_data --view summary

# 获取指定 Hook 最近 20 条详细调用日志（含入参及返回）
browsercli call get_hook_data --hookId "token_hook" --view detail --maxRecords 20
```

### 4. 加密库 / JSVMP 专用拦截脚本

加密库预设（CryptoJS、JSEncrypt、SM-crypto）与 JSVMP 运行时探针已从工具层下移到 `skills/web-reverse-hook`，改为生成脚本 + 通用注入两步：

```bash
# 生成脚本
node skills/web-reverse-hook/scripts/build-hook.js cryptojs --algorithms AES,MD5 --out hook.js
node skills/web-reverse-hook/scripts/build-hook.js jsvmp-transparent --script-url app.js --out hook.js

# 注入（一次性 / 跨导航持久）
browsercli call evaluate_script --file hook.js
browsercli call inject_hook --hookId hook_cryptojs --script "$(cat hook.js)" --persistent true

# 读取：加密库 hook 输出到 console（attach 模式下需先装 console 缓冲，见 skills/web-reverse-hook/SKILL.md），
# JSVMP 探针写入 window.__mcp_jsvmp_log
browsercli call list_console_messages --pageSize 100
```

参数、注入时机与检测面取舍见 `skills/web-reverse-hook/SKILL.md`。

### 5. 浏览器环境基准采集与对比

`compare_env` 工具已下线，改为生成采集脚本后用 `evaluate_script` 执行：

```bash
node skills/web-reverse-env/scripts/compare-env.js \
  --properties navigator.userAgent,navigator.plugins.length,screen.availWidth --out env.js
browsercli call evaluate_script --file env.js
```
