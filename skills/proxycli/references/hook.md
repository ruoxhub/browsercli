# 动态 Hook 与加解密拦截参考文档 (Dynamic Hooking Reference)

非阻塞运行时参数拦截、标准加密库预设拦截、JSVMP 虚拟机探针与 Hook 生命周期管理工具。

## 概览 (Overview)

Hook 技术相比断点最大的优势是**非阻塞**：拦截参数与返回值的同时不会暂停页面执行，不会破坏页面的时钟和长连接状态，是逆向工程自动化分析的首选手段。

| 工具名称                 | 功能描述                                                                           | 核心参数                                                                                                  |
| :----------------------- | :--------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------- |
| `create_hook`            | 创建 Hook 定义（支持 function/fetch/xhr/property/cookie/websocket/eval/timer）     | `--type <str>`, `[--hookId <str>]`, `[--capture <arr>]`, `[--action <str>]`                               |
| `inject_hook`            | 将 Hook 注入到页面中（支持 persistent 跨导航与 world 隔离）                        | `--hookId <str>`, `[--script <str>]`, `[--persistent <bool>]`, `[--world <str>]`                          |
| `get_hook_data`          | 获取 Hook 拦截到的运行时数据（支持 raw/summary/detail 视图与多字段过滤）           | `[--hookId <str>]`, `[--view <str>]`, `[--maxRecords <num>]`, `[--event <str>]`                           |
| `list_hooks`             | 列出当前页面上所有已安装的函数 Hook                                                | 无                                                                                                        |
| `list_created_hooks`     | 列出 HookManager 中所有已创建的 Hook 定义及统计记录数                              | `[--hookId <str>]`, `[--syncFromBrowser <bool>]`                                                          |
| `list_persistent_hooks`  | 列出跨导航持久生效的 Hook                                                          | 无                                                                                                        |
| `remove_hook`            | 移除指定 Hook，并可选清理浏览器端存储的抓取数据                                    | `--hookId <str>`, `[--cleanBrowser <bool>]`                                                               |
| `hook_function`          | 便捷 Hook 指定全局或对象路径函数（记录参数、返回值与调用栈，不暂停）               | `--target <str>`, `[--hookId <str>]`, `[--logArgs <bool>]`, `[--logResult <bool>]`, `[--logStack <bool>]` |
| `unhook_function`        | 移除通过 hook_function 安装的函数 Hook                                             | `--hookId <str>`                                                                                          |
| `hook_cryptojs`          | 一键拦截 CryptoJS 常见加密库（AES、DES、MD5、SHA、HMAC 等）                        | `[--algorithms <arr>]`, `[--logFormat <str>]`                                                             |
| `hook_jsencrypt`         | 一键拦截 JSEncrypt RSA 非对称加密库（拦截公钥、明文、密文）                        | `[--logFormat <str>]`                                                                                     |
| `hook_smcrypto`          | 一键拦截 SM-crypto 国密库（SM2、SM3、SM4）                                         | `[--algorithms <arr>]`, `[--logFormat <str>]`                                                             |
| `hook_jsvmp_interpreter` | 安装 JSVMP 虚拟机探针（transparent 无痕模式 / proxy 代理模式，跟踪调用与属性）     | `[--mode <str>]`, `[--track_calls <bool>]`, `[--track_props <bool>]`, `[--proxy_objects <arr>]`           |
| `compare_env`            | 采集当前 Frame 的浏览器环境基准（属性路径、原型特征），用于与 Node.js 离线环境比对 | `[--properties <arr>]`                                                                                    |

---

## 详细命令与示例

### 1. 通用 Hook 创建与注入 (`create_hook` & `inject_hook`)

```bash
# 创建一个针对 window.calcToken 函数的 Hook 定义
proxycli call create_hook \
  --type function \
  --hookId "token_hook" \
  --description "拦截计算 Token 参数与返回值" \
  --capture '["args", "result"]'

# 注入 Hook 到页面（设置 persistent=true 使其在页面刷新/跳转后依然生效）
proxycli call inject_hook --hookId "token_hook" --persistent true
```

### 2. 便捷函数 Hook (`hook_function` & `unhook_function`)

无需编写复杂脚本，直接指定挂载路径即可记录调用信息：

```bash
# 拦截全局加密入口并打印调用栈
proxycli call hook_function \
  --target "window.securityService.encryptPayload" \
  --hookId "sec_hook" \
  --logArgs true \
  --logResult true \
  --logStack true

# 移除 Hook
proxycli call unhook_function --hookId "sec_hook"
```

### 3. 读取 Hook 采集数据 (`get_hook_data`)

```bash
# 查看所有已捕获数据的摘要统计
proxycli call get_hook_data --view summary

# 获取指定 Hook 最近 20 条详细调用日志（含入参及返回）
proxycli call get_hook_data --hookId "token_hook" --view detail --maxRecords 20
```

### 4. 常见加密库预设一键 Hook

页面如果使用了开源成熟加密库，直接调用预设即可全局捕获密钥与明文：

```bash
# 拦截 CryptoJS AES 与 MD5
proxycli call hook_cryptojs --algorithms '["AES", "MD5"]'

# 拦截 RSA 加密
proxycli call hook_jsencrypt --logFormat json

# 拦截国密 SM2/SM3/SM4
proxycli call hook_smcrypto --algorithms '["sm2", "sm4"]'
```

### 5. JSVMP 运行时虚拟机探针 (`hook_jsvmp_interpreter`)

针对控制流平坦化、字节码解释执行的 JSVMP 保护算法（需在目标 SDK 执行前注入）：

```bash
# transparent 无痕模式：替换原型 getter，痕迹极小
proxycli call hook_jsvmp_interpreter --mode transparent --track_calls true

# proxy 模式：全面代理指令调用与 Reflect 运算
proxycli call hook_jsvmp_interpreter --mode proxy --track_props true --max_entries 500
```

### 6. 浏览器环境基准采集与对比 (`compare_env`)

```bash
# 提取 navigator、screen、document 等关键属性指纹
proxycli call compare_env --properties '["navigator.userAgent", "navigator.plugins.length", "screen.availWidth"]'
```
