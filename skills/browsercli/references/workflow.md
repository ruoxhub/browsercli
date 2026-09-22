# 自动化逆向工作流参考 (Workflow Reference)

> **注意 (Deprecation Notice)**: 原实验性内置工具 `observe_flow` 已被精简移除。
>
> - **手动编排工作流**：推荐遵循四大经典流程：
>   1. **嗅探流量**：`list_network_requests` + `get_request_initiator`
>   2. **定位源码**：`get_script_source` + `search_in_sources`
>   3. **动态监控**：`hook_function` + `get_hook_data`
>   4. **沉淀证据**：结论写入 `artifacts/tasks/<task-id>/`（证据落盘工具已随 `src/tools/analyzer` 下线）
