# 离线环境重构与证据沉淀说明 (Rebuild & Evidence)

> **注意 (Deprecation Notice)**: 原实验性内置工具 `rebuild_bundle` 与 `trace_signature_generation` 已从 MCP 工具面下线并解耦。
>
> - **证据持久化与报告**：证据落盘工具已随 `src/tools/analyzer` 下线，结论直接写入 `artifacts/tasks/<task-id>/`；环境自检见 [`references/evidence.md`](./evidence.md)。
> - **签名链路追踪**：请查阅 [`references/network.md`](./network.md)，使用 `get_request_initiator` 配合 [`references/hook.md`](./hook.md) 的非阻塞 Hook。
> - **离线 Node.js 算法还原与补环境**：请调用专用技能：
>   - `skills/web-reverse-algorithm`: 纯算法提取与 AST 精简
>   - `skills/web-reverse-env`: Node.js 浏览器环境补齐与 Mock
>   - `skills/web-js-env-patcher`: 动态环境补丁与验证
