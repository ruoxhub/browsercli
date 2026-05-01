# call_tool 案例脚本

该目录为每个 MCP 工具提供一个独立的 JS 调用案例脚本。

目标：

- 每个工具一个脚本，方便快速试调用
- 统一复用一个公共 HTTP 调用 helper
- 工具清单变化后可重新生成，避免手写 100+ 份脚本

## 使用方式

```bash
# 调用某个工具案例
node scripts/call_tool/query_dom.js

# 覆盖默认 group / rpcHost / timeout
node scripts/call_tool/query_dom.js --group default --rpcHost ws://127.0.0.1:5612 --timeout 30000

# 覆盖脚本内示例参数
node scripts/call_tool/query_dom.js --params '{"selector":"#app","all":true}'
```

## 约定

- 每个案例脚本都会打印：
  - 工具名
  - 工具说明
  - 默认示例参数
  - 最终调用结果
- 示例参数基于 `src/cli/tools-meta.ts` 的 schema 自动生成，只保证“结构示例”合理，不保证在任意页面都能成功执行。
- 需要页面上下文、选中页面、断点状态或特定站点数据的工具，仍需你先准备运行环境。

## 再生成

当 `src/cli/tools-meta.ts` 有新增或删改时，重新执行：

```bash
node scripts/call_tool/_generate-call-tool-scripts.mjs
```
