# Case Index

仓库内公开的参数 / 链路沉淀入口统一放在 `scripts/cases/`。

这里仅保留抽象 case、方法论和验收口径，不放可直接复用的完整实现代码。

## 已公开链路

### MCP 通用工作流

- Case: [scripts/cases/mcp-reverse-pure-node-workflow.mjs](mcp-reverse-pure-node-workflow.mjs)
- Category: 工作流
- Status: abstract-case
- Runtime: pure-node
- Notes: 先看工具顺序、每步产物和下一步判定，再映射到具体站点 case

### 高密度抽象骨架模板

- Case: [scripts/cases/abstract-case-template.mjs](abstract-case-template.mjs)
- Category: 模板
- Status: abstract-case
- Runtime: pure-node
- Notes: 新增站点 case 时先从这份高密度抽象骨架开始，补齐关键字段、hook 点、断点提示、pure extraction 关键点


### 某东 `h5st` 参数

- Case: [scripts/cases/jd-h5st-pure-node.mjs](jd-h5st-pure-node.mjs)
- Category: 参数签名
- Status: abstract-case
- Runtime: pure-node
- Notes: 已覆盖从 Node 补环境、portable runtime 到 pure extraction / Python port 的抽象流程

### 某手 `falcon` 风控参数

- Case: [scripts/cases/ks-hxfalcon-pure-node.mjs](ks-hxfalcon-pure-node.mjs)
- Category: 风控参数
- Status: abstract-case
- Runtime: pure-node
- Notes: 风控链路定位与 local rebuild 抽象 case

### 某音 `a-bogus` 参数

- Case: [scripts/cases/douyin-a-bogus-pure-node.mjs](douyin-a-bogus-pure-node.mjs)
- Category: 参数签名
- Status: abstract-case
- Runtime: pure-node
- Notes: 参数链路定位、工具顺序映射、纯 Node 复现与 pure extraction 后置阶段抽象 case

## 字段规范

- `Case`: 仓库内公开的抽象 case 文件路径
- `Category`: 参数签名、风控参数、设备指纹、工作流等分类
- `Status`: 当前沉淀状态，例如 `abstract-case`
- `Runtime`: 当前主要复现运行时，例如 `pure-node`
- `Notes`: 一句话说明这个 case 覆盖的目标和边界

## 使用约束

- 新会话先读：`docs/reference/reverse-bootstrap.md`
- 读取优先级：先读本地 `artifacts/tasks/<task-id>/`，再读这里的抽象 case
- 如果新增公开参数 / 链路入口，统一更新本文件
- 推荐顺序：先看通用 workflow case，再看目标站点 case
- 真实 page/api host 不直写；统一用 Base64 文本保存，推荐字段名为 `entry_url_b64` 或 `api_host_b64`，并在使用前先解码
- 可执行脚本和真实任务产物默认保留在本地 `artifacts/tasks/<task-id>/`
- 仓库内不提交真实 Cookie、Storage、可直接复用的生产参数组合

更多工具入口请看：

- [docs/reference/reverse-bootstrap.md](../../docs/reference/reverse-bootstrap.md)
- [docs/reference/reverse-task-index.md](../../docs/reference/reverse-task-index.md)
- [docs/reference/tool-reference.md](../../docs/reference/tool-reference.md)
- [docs/reference/case-safety-policy.md](../../docs/reference/case-safety-policy.md)
