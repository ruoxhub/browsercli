# SourceMap 工具

SourceMap 工具仅在 `full` profile 中可用。除 `sourcemap_reconstruct_tree` 外均为只读操作。

## 推荐流程

1. `sourcemap_discover` 读取已经存在的 Debugger 脚本元数据；它不会激活新的 CDP 域。
2. `sourcemap_parse` 从 `scriptId`、`mapUrl`、`mapContent` 三者之一生成进程内 `mapId`。
3. `sourcemap_lookup` 使用 line 1-based、column 0-based 坐标双向查询。
4. `sourcemap_diff` 比较两个 `mapId`，明细有界但总数完整。
5. `sourcemap_reconstruct_tree` 显式写入任务目录或安全 `outputDir`。

## 安全边界

- 跨源默认拒绝，必须显式 `allowCrossOrigin=true`。
- 跨源仍拒绝私网、loopback、非法协议、URL credentials、危险重定向和超限响应。
- 缺失 `sourcesContent` 只记录，不继续联网补源。
- `mapId` 在 worker 重启、TTL 或 LRU 淘汰后失效。
