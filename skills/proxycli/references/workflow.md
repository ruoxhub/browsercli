# 自动化逆向工作流参考 (Workflow Reference)

> **注意 (Deprecation Notice)**: 原实验性内置工具 `observe_flow` 已被精简移除。
>
> - **标准化流水线**：请使用 `analyze_pipeline`（代码采集 → 并行加密/混淆探测 → 报告输出），详见 [`references/evidence.md`](./evidence.md)。
> - **手动编排工作流**：推荐遵循四大经典流程：
>   1. **嗅探流量**：`list_network_requests` + `get_request_initiator`
>   2. **定位源码**：`get_script_source` + `search_in_sources`
>   3. **动态监控**：`hook_function` + `get_hook_data`
>   4. **沉淀证据**：`record_reverse_evidence` + `export_session_report`
