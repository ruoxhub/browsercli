# 离线环境重构与证据沉淀说明 (Rebuild & Evidence)

> **注意 (Deprecation Notice)**: 原实验性内置工具 `rebuild_bundle` 与 `trace_signature_generation` 已从工具面下线并解耦。
>
> - **证据持久化与报告**：证据落盘工具已随 `src/tools/analyzer` 下线，结论直接写入 `artifacts/tasks/<task-id>/`；环境自检见 [`references/evidence.md`](./evidence.md)。
> - **签名链路追踪**：请查阅 [`references/network.md`](./network.md)，使用 `get_request_initiator` 配合 [`references/hook.md`](./hook.md) 的非阻塞 Hook。
> - **离线 Node.js 算法还原与补环境**：本仓库不提供专用技能，需由调用方 Agent 自行完成——
>   - 用 `collect_code` / `get_script_source` / `search_in_scripts` 取得目标代码切片
>   - 用 `create_hook` + `inject_hook` + `get_hook_data` 采样运行时输入输出作为对照基准
>   - 用 `evaluate_script` 在页面里验证候选实现
>   - 在本地工程中逐项补齐缺失的宿主能力，以 `first divergence` 定位最早分叉点
