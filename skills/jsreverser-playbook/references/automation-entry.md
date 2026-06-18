> **工作流映射**：本文件是 [6 阶段逆向工作流](../../docs/reference/reverse-workflow.md) 的自动化简化版。
> 3 阶段映射：观察 = Phase 1 Observe，采样 = Phase 2 Capture，补环境 = Phase 3-4 Rebuild+Patch。
> PureExtraction 和 Port 阶段不在自动化入口覆盖。

# 自动化入口剧本

默认按三段式执行：

1. 页面观察
2. 运行时采样
3. 本地补环境

标准入口：

1. `check_browser_health`
2. `new_page` 或 `select_page`
3. `analyze_target`
4. `search_in_scripts`
5. `list_network_requests` + `get_request_initiator`
6. 如果目标涉及首屏初始化、首个请求前参数生成、页面首次执行逻辑：先 `inject_preload_script`
7. `record_reverse_evidence`
8. `create_hook` + `inject_hook`
9. 触发动作
10. `get_hook_data(summary)`
11. 命中后 `get_hook_data(raw)` + `record_reverse_evidence`
12. `export_rebuild_bundle`
13. 本地补环境复现

重试上限：2 次。

只有在 Hook 无法解释关键上下文时才进入断点路径。
如果问题出在首屏初始化，就优先走 preload 采样，不要等页面脚本跑完后再补 hook。
