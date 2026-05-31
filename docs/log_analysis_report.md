# JSReverser CLI 工具日志分析报告

本次分析共审计了 `342` 个工具调用日志文件。

## 1. 工具调用总体统计

| 工具名称                         | 调用次数 | 成功率     | 平均耗时 (ms) | 最大耗时 (ms) |
|:---------------------------- |:----:|:-------:|:---------:|:---------:|
| `get_script_source`          | 80   | 100.00% | 216.35    | 727       |
| `evaluate_script`            | 73   | 79.45%  | 1378.25   | 30009     |
| `search_in_sources`          | 30   | 100.00% | 761.80    | 2183      |
| `get_paused_info`            | 26   | 96.15%  | 0.54      | 1         |
| `list_network_requests`      | 19   | 94.74%  | 2.84      | 12        |
| `select_page`                | 19   | 78.95%  | 30.58     | 103       |
| `list_hooks`                 | 16   | 75.00%  | 8.88      | 31        |
| `list_pages`                 | 10   | 100.00% | 13.30     | 31        |
| `step_out`                   | 10   | 100.00% | 14.30     | 50        |
| `step_into`                  | 7    | 100.00% | 7.00      | 9         |
| `get_network_request`        | 5    | 100.00% | 3.60      | 5         |
| `click`                      | 5    | 60.00%  | 218132.40 | 1082342   |
| `find_in_script`             | 5    | 0.00%   | 245.60    | 307       |
| `type_text`                  | 4    | 75.00%  | 278535.00 | 1113759   |
| `resume`                     | 4    | 100.00% | 3.50      | 4         |
| `step_over`                  | 3    | 100.00% | 4.67      | 7         |
| `update_extensions`          | 3    | 0.00%   | 6676.00   | 10016     |
| `query_dom`                  | 2    | 100.00% | 11.50     | 12        |
| `inspect_locals`             | 2    | 100.00% | 7.00      | 10        |
| `evaluate_on_callframe`      | 2    | 0.00%   | 0.50      | 1         |
| `set_breakpoint`             | 2    | 100.00% | 7.00      | 8         |
| `remove_breakpoint`          | 2    | 100.00% | 2.00      | 3         |
| `take_screenshot`            | 2    | 0.00%   | 1.50      | 2         |
| `get_request_initiator`      | 1    | 0.00%   | 1.00      | 1         |
| `trace_signature_generation` | 1    | 100.00% | 4.00      | 4         |
| `xhr_to_js_breakpoint`       | 1    | 100.00% | 4.00      | 4         |
| `find_clickable_elements`    | 1    | 100.00% | 20.00     | 20        |
| `list_scripts`               | 1    | 100.00% | 1.00      | 1         |
| `set_breakpoint_on_text`     | 1    | 0.00%   | 427.00    | 427       |
| `hook_function`              | 1    | 0.00%   | 11.00     | 11        |
| `list_breakpoints`           | 1    | 100.00% | 2.00      | 2         |
| `remove_xhr_breakpoint`      | 1    | 100.00% | 2.00      | 2         |
| `collect_code`               | 1    | 100.00% | 5767.00   | 5767      |
| `new_page`                   | 1    | 100.00% | 862.00    | 862       |

## 2. 脚本获取去重分析 (Duplicate get_script_source)

在逆向过程中，频繁请求相同的 JS 脚本源文件会导致不必要的延迟和带宽消耗。以下为重复获取的脚本 ID：

| 脚本 ID  | 请求次数 | 关联文件日志范围                                                                                                     |
|:------:|:----:|:------------------------------------------------------------------------------------------------------------ |
| `1699` | 80   | `043_get_script_source_tr_mpot8fpr_y55pak.json` ~ `200_get_script_source_tr_mpotpyzb_3nf3kc.json` (共 80 个文件) |

## 3. 错误与异常调用明细

以下是所有执行失败的日志明细以及失败原因分类：

### `click` 失败统计 (2 次)

| 错误原因                                                                                                      | 频次  | 典型日志文件                                                                                                                         |
|:--------------------------------------------------------------------------------------------------------- |:---:|:------------------------------------------------------------------------------------------------------------------------------ |
| `page.click: Timeout 5000ms exceeded. Call log:  [2m  - waiting for locator('#chat-input-send-button'...` | 1   | [022_click_tr_mpot5sp1_6uqk3k.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/022_click_tr_mpot5sp1_6uqk3k.json) |
| `page.click: Timeout 5000ms exceeded. Call log:  [2m  - waiting for locator('#send-message-button') [...` | 1   | [203_click_tr_mpotn6s0_csdul5.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/203_click_tr_mpotn6s0_csdul5.json) |

### `evaluate_on_callframe` 失败统计 (2 次)

| 错误原因                                                                | 频次  | 典型日志文件                                                                                                                                                         |
|:------------------------------------------------------------------- |:---:|:-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `执行失败: Cannot read properties of undefined (reading 'callFrameId')` | 2   | [033_evaluate_on_callframe_tr_mpot7bcd_atfxt0.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/033_evaluate_on_callframe_tr_mpot7bcd_atfxt0.json) |

### `evaluate_script` 失败统计 (15 次)

| 错误原因                                                                                                    | 频次  | 典型日志文件                                                                                                                                             |
|:------------------------------------------------------------------------------------------------------- |:---:|:-------------------------------------------------------------------------------------------------------------------------------------------------- |
| `脚本执行失败：Script execution timed out`                                                                     | 3   | [071_evaluate_script_tr_mpotdp53_nsnbd3.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/071_evaluate_script_tr_mpotdp53_nsnbd3.json) |
| `执行失败：目标对象可能位于扩展 content script 隔离上下文，页面主上下文无法直接访问；请改用 --context content-script 或先分析扩展源码`               | 2   | [213_evaluate_script_tr_mpoubs41_qp9eq8.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/213_evaluate_script_tr_mpoubs41_qp9eq8.json) |
| `脚本未送入页面执行：function 定义不完整：缺少 2 个 ')'。请先补全 function 体后再调用 evaluate_script，不要逐字符重试。`                      | 2   | [336_evaluate_script_tr_mppf5iro_h9m9cx.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/336_evaluate_script_tr_mppf5iro_h9m9cx.json) |
| `脚本执行失败：存在 12 个 content-script 执行上下文，无法自动映射 to 唯一目标...`                                                 | 1   | [214_evaluate_script_tr_mpoubw97_avnrgg.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/214_evaluate_script_tr_mpoubw97_avnrgg.json) |
| `脚本执行失败：TypeError: Cannot read properties of undefined (reading 'showCaptchaModal')`                    | 1   | [215_evaluate_script_tr_mpouc0kt_n8zs4h.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/215_evaluate_script_tr_mpouc0kt_n8zs4h.json) |
| `脚本执行失败：TypeError: (intermediate value)(intermediate value)(intermediate value)(intermediate value)...` | 1   | [235_evaluate_script_tr_mpowh267_jdy15n.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/235_evaluate_script_tr_mpowh267_jdy15n.json) |
| `脚本执行失败：存在 2 个 page 执行上下文，无法自动映射 to 唯一目标...`                                                            | 1   | [240_evaluate_script_tr_mpowiiqt_y9v48g.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/240_evaluate_script_tr_mpowiiqt_y9v48g.json) |
| `脚本执行失败：cdpSession.send: Protocol error (Runtime.evaluate): Inspected target navigated or closed`       | 1   | [301_evaluate_script_tr_mpp3df1v_240g2n.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/301_evaluate_script_tr_mpp3df1v_240g2n.json) |
| `脚本执行失败：TypeError: location.reload(...) is not a function`                                              | 1   | [333_evaluate_script_tr_mppf492o_9weh58.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/333_evaluate_script_tr_mppf492o_9weh58.json) |
| `脚本执行失败：TypeError: window.location.href is not a function`                                              | 1   | [334_evaluate_script_tr_mppf4f0d_uywazl.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/334_evaluate_script_tr_mppf4f0d_uywazl.json) |
| `脚本执行失败：ReferenceError: BaseClient is not defined`                                                      | 1   | [342_evaluate_script_tr_mppf6cdh_2ibrao.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/342_evaluate_script_tr_mppf6cdh_2ibrao.json) |

### `find_in_script` 失败统计 (5 次)

| 错误原因                                    | 频次  | 典型日志文件                                                                                                                                           |
|:--------------------------------------- |:---:|:------------------------------------------------------------------------------------------------------------------------------------------------ |
| `"captcha_verify_param" 未在脚本 1699 中找到。` | 1   | [030_find_in_script_tr_mpot6x3v_rlxq55.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/030_find_in_script_tr_mpot6x3v_rlxq55.json) |
| `"const NM" 未在脚本 1699 中找到。`             | 1   | [047_find_in_script_tr_mpota1gn_7ubmod.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/047_find_in_script_tr_mpota1gn_7ubmod.json) |
| `"NM =" 未在脚本 1699 中找到。`                 | 1   | [048_find_in_script_tr_mpota5nf_omi3z5.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/048_find_in_script_tr_mpota5nf_omi3z5.json) |
| `"function NM" 未在脚本 1699 中找到。`          | 1   | [049_find_in_script_tr_mpotab4u_ut0wjo.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/049_find_in_script_tr_mpotab4u_ut0wjo.json) |
| `"NM" 未在脚本 1699 中找到。`                   | 1   | [050_find_in_script_tr_mpotafdp_xy63zf.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/050_find_in_script_tr_mpotafdp_xy63zf.json) |

### `get_paused_info` 失败统计 (1 次)

| 错误原因     | 频次  | 典型日志文件                                                                                                                                             |
|:-------- |:---:|:-------------------------------------------------------------------------------------------------------------------------------------------------- |
| `执行未暂停。` | 1   | [023_get_paused_info_tr_mpot5yov_6hkjqt.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/023_get_paused_info_tr_mpot5yov_6hkjqt.json) |

### `get_request_initiator` 失败统计 (1 次)

| 错误原因               | 频次  | 典型日志文件                                                                                                                                                         |
|:------------------ |:---:|:-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `未找到请求 39 的发起者信息。` | 1   | [014_get_request_initiator_tr_mpot4f2u_fdllzw.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/014_get_request_initiator_tr_mpot4f2u_fdllzw.json) |

### `hook_function` 失败统计 (1 次)

| 错误原因                                           | 频次  | 典型日志文件                                                                                                                                         |
|:---------------------------------------------- |:---:|:---------------------------------------------------------------------------------------------------------------------------------------------- |
| `错误：Error: Cannot find function: NM on window` | 1   | [145_hook_function_tr_mpotm2cn_cy78kg.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/145_hook_function_tr_mpotm2cn_cy78kg.json) |

### `list_hooks` 失败统计 (4 次)

| 错误原因                                                                               | 频次  | 典型日志文件                                                                                                                                   |
|:---------------------------------------------------------------------------------- |:---:|:---------------------------------------------------------------------------------------------------------------------------------------- |
| `错误：browserContext.newCDPSession: Target page, context or browser has been closed` | 4   | [001_list_hooks_tr_mpormfjw_pr362e.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/001_list_hooks_tr_mpormfjw_pr362e.json) |

### `list_network_requests` 失败统计 (1 次)

| 错误原因                                          | 频次  | 典型日志文件                                                                                                                                                         |
|:--------------------------------------------- |:---:|:-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `当前无活跃页面，请先通过 new_page 或 select_page 创建/选择页面` | 1   | [006_list_network_requests_tr_mposfktk_29clmx.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/006_list_network_requests_tr_mposfktk_29clmx.json) |

### `select_page` 失败统计 (4 次)

| 错误原因              | 频次  | 典型日志文件                                                                                                                                     |
|:----------------- |:---:|:------------------------------------------------------------------------------------------------------------------------------------------ |
| `Unknown failure` | 4   | [250_select_page_tr_mpox061f_5v3z7o.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/250_select_page_tr_mpox061f_5v3z7o.json) |

### `set_breakpoint_on_text` 失败统计 (1 次)

| 错误原因                                                           | 频次  | 典型日志文件                                                                                                                                                           |
|:-------------------------------------------------------------- |:---:|:---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `错误: Cannot read properties of undefined (reading 'scriptId')` | 1   | [093_set_breakpoint_on_text_tr_mpotgt5h_w5qszr.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/093_set_breakpoint_on_text_tr_mpotgt5h_w5qszr.json) |

### `take_screenshot` 失败统计 (2 次)

| 错误原因                                            | 频次  | 典型日志文件                                                                                                                                             |
|:----------------------------------------------- |:---:|:-------------------------------------------------------------------------------------------------------------------------------------------------- |
| `截图失败: runtime.getActivePage is not a function` | 2   | [220_take_screenshot_tr_mpoud6be_i6y8fn.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/220_take_screenshot_tr_mpoud6be_i6y8fn.json) |

### `type_text` 失败统计 (1 次)

| 错误原因                                          | 频次  | 典型日志文件                                                                                                                                 |
|:--------------------------------------------- |:---:|:-------------------------------------------------------------------------------------------------------------------------------------- |
| `输入文本失败: page.type: Timeout 5000ms exceeded.` | 1   | [204_type_text_tr_mpotmijm_1e71eb.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/204_type_text_tr_mpotmijm_1e71eb.json) |

### `update_extensions` 失败统计 (3 次)

| 错误原因                                                        | 频次  | 典型日志文件                                                                                                                                                 |
|:----------------------------------------------------------- |:---:|:------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Error: frame.evaluate() 超时 (10000ms)，可能调试器已暂停`             | 2   | [201_update_extensions_tr_mpoua1ri_fstfvh.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/201_update_extensions_tr_mpoua1ri_fstfvh.json) |
| `Failed to update extensions: extensions-manager not found` | 1   | [210_update_extensions_tr_mpoube8r_tz1qoq.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/210_update_extensions_tr_mpoube8r_tz1qoq.json) |

---

## 4. 优化建议清单

基于对上述日志的详细审计，提出以下五大核心优化建议：

### 建议一：引入 `get_script_source` 客户端缓存机制

- **现象描述**：脚本 `1699` 被重复请求了 `80` 次（从日志 `043` 持续到 `200`）。这说明工具链或 Agent 在执行查找/Hook时，没有对已获取的脚本内容进行本地缓存，导致大量重复网络 I/O，总等待时间超过了 17 秒。
- **优化方案**：在客户端 MCP 工具实现中，引入以 `scriptId` 为键的 LRU 缓存。若脚本内容未发生变化，直接从缓存返回，避免重复调用 CDP `Debugger.getScriptSource`。

### 建议二：规避多执行上下文时的 `evaluate_script` 错误

- **现象描述**：部分 `evaluate_script` 因为“存在多于一个的 page 执行上下文，无法自动映射到唯一目标”而失败（如 [240_evaluate_script_tr_mpowiiqt_y9v48g.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/240_evaluate_script_tr_mpowiiqt_y9v48g.json)）。
- **优化方案**：对于多 Frame、多扩展或含有 content-script 的页面，工具应在探测到多个上下文时，能自动回退到主 execution context，或者提示 Agent 在调用时必须携带特定的 `--frameId` 或 `--allowAnyFrame` 参数。同时，Agent 在编写逆向自动化脚本时，应在初始化阶段通过 `list_pages` 确定当前 target 唯一的 frameId。

### 建议三：优化 content script 的环境隔离评估

- **现象描述**：出现类似 `目标对象可能位于扩展 content script 隔离上下文，页面主上下文无法直接访问；请改用 --context content-script` 的失败提示（如 [213_evaluate_script_tr_mpoubs41_qp9eq8.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/213_evaluate_script_tr_mpoubs41_qp9eq8.json)）。
- **优化方案**：在 `evaluate_script` 前，工具进行自适应探测。如果发现抛出 `ReferenceError` 且探测到有 content-script 注入，可自动尝试在 `content-script` 上下文中运行，或者在报错中给 Agent 提供更加智能的参数推荐机制。

### 建议四：减少残缺/不完整代码的重复重试

- **现象描述**：部分日志（如 [336_evaluate_script_tr_mppf5iro_h9m9cx.json](file:///D:/ai-llm/cli/JSReverser-CLI/artifacts/tool-results/2026-05-28/336_evaluate_script_tr_mppf5iro_h9m9cx.json)）因为“function 定义不完整：缺少 2 个 ')'”而失败，说明 Agent 存在由于流式传输或代码组装问题导致发送了残缺脚本到浏览器执行的情况。
- **优化方案**：在 MCP 工具的输入验证层，对 JS 代码做简单的 AST 语法合法性校验。如果不合法，直接在客户端拦截并报错“语法不完整”，避免无效的网络往返和 CDP 报错。

### 建议五：合并单步调试与暂停信息拉取 (RTT 优化)

- **现象描述**：有大量的连续 `step_out`/`step_into`/`step_over` + `get_paused_info` 调用（例如从 `061` 到 `092`）。每一轮单步都会触发一次 `get_paused_info`，这在 RTT 较高的网络环境下体验极差。
- **优化方案**：建议将 `step_xxx` 工具与 `get_paused_info` 合并。让 `step_xxx` 工具在完成单步后，**自动**在返回结果中包含当前暂停位置的 `pausedInfo`，这样可以减少一半的 MCP 工具交互 RTT，成倍提升调试流畅度。
