# browsercli HTTP 签名逆向避坑记录

## 郑和数据签名逆向复盘

按致命程度排序，browsercli 在本次逆向中遇到以下问题。

### 会导致整页失效

1. `auto_hook` 的 JSEncrypt 钩子爆栈，拖垮整页 JavaScript。
   启用 `--hookRsa true` 后，注入钩子破坏了 `Function.prototype.apply` 并触发栈溢出，导致 `get_hook_data`、`list_network_requests`、`get_dom_structure` 均返回 0。目标站并未使用 JSEncrypt，应关闭 `--hookRsa`，或放弃 JavaScript 钩子，改用 CDP 网络层抓包。
2. 刷新后 CDP 网络监控断连。
   `navigate_page --type reload` 会使当前 target 的网络监听失效，静态资源也无法捕获，`waitForRequest` 超时。应使用 `new_page --url ...` 创建全新标签页，让新 target 建立完整网络监控；本次由此捕获到 98 个请求。

### 反调试与环境问题

3. 页面包含 `debugger` 反调试语句。
   加载时调试器暂停，DOM 与网络均不可读。处理顺序为 `resume` → `bypass_debugger` → `anti_anti_debug`。
4. 启动阶段命令路径解析异常。
   `browsercli` 不在 PATH 中，skill 命令将模块路径错误解析为 `c:\d\...` 前缀。可直接使用 Node 和 CLI 入口的绝对路径：`node "D:/nvm/nodejs/node_modules/browsercli/build/bin/browsercli.js" <cmd>`。

### 工具行为与规避方式

5. `search_in_sources` 默认跳过压缩文件，返回 `skippedMinified: 1`，导致主 bundle 中的 `x-sign` 无法命中。应传入 `--excludeMinified false`。
6. 搜索或读取偶发 `fetch failed`，属于瞬时故障，重试通常可恢复。
7. `get_script_source` 不支持按行号读取。需要拉取完整 bundle 到本地缓存，再用文本搜索定位 `x-` 请求头拼接和 `.MD5(` 调用点。
8. 参数名或返回模式可能不匹配。`collect_code --returnMode paths` 不受支持，应使用 `summary`；`list_network_requests` 的输出结构也应先查看原始结果，再编写过滤逻辑。
9. 字面量由动态拼接生成时，直接搜索 `x-sign` 不可靠。源码可能使用 `'x-' + e` 或 camelCase `xSign`，应改搜 `MD5(` 调用点和 `x-` 请求头拼接逻辑。

## 推荐工作流

优先采用非侵入式 CDP 抓包：新建标签页，调用 `list_network_requests` 与 `get_network_request` 获取请求头；随后在 bundle 中搜索 `MD5(` 和 `x-` 拼接逻辑，最后用 Python 还原并验证签名。尽量避免 JavaScript 注入钩子，尤其是 RSA 钩子。

这些经验已沉淀为用户级 skill：`reverse-http-signature-browsercli`。
