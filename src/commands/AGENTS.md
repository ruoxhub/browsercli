# COMMANDS LAYER — src/commands/

## OVERVIEW

Commander.js CLI 命令定义中心，负责注册所有 `js-reverse` 子命令，通过 Unix Socket 与 daemon 进程通信，提供纯命令行方式的逆向工程能力调用。

## WHERE TO LOOK

| Task         | Location                                  | Notes                                                                      |
| ------------ | ----------------------------------------- | -------------------------------------------------------------------------- |
| 命令注册入口 | `index.ts:createCli()`                    | 定义所有静态命令 + 调用 `generateToolCommands()` 注入动态工具命令          |
| 启动 daemon  | `start.ts:startCommand()`                 | 通过 `daemon/client.js` 的 `startDaemon()` fork 子进程，可选启 HTTP server |
| 停止 daemon  | `stop.ts:stopCommand()`                   | 发送停止信号给 daemon 进程                                                 |
| 状态查询     | `status.ts:statusCommand()`               | 检查 daemon 进程存活状态                                                   |
| 技能调用     | `call-skill.ts:callSkillCommand()`        | 通过 socket 调用技能 (observe-flow, auto-hook, rebuild-bundle)             |
| 列表命令     | `list-skills.ts`, `list-tools.ts`         | 列出可用技能/工具，支持 `--json` 输出                                      |
| REPL 交互    | `repl.ts:replCommand()`                   | 基于 Node.js readline 的交互式命令行                                       |
| 任务脚手架   | `scaffold.ts:scaffoldCommand()`           | 生成 `artifacts/tasks/<name>/` 标准结构                                    |
| 动态工具命令 | `tool-commands.ts:generateToolCommands()` | 扫描已注册 MCP 工具，为每个生成 `js-reverse call <tool>` 子命令            |

## CONVENTIONS

- **Lazy imports**: 所有 `.action()` 内使用 `await import('./xxx.js')` 模式，禁止顶层 import 命令实现
- **Command naming**: kebab-case (如 `list-skills`, `call-skill`)
- **Options**: 使用 Commander `.option()` / `.requiredOption()` 定义，类型校验在命令 handler 内完成
- **Process exit**: 命令失败时用 `process.exit(1)` + `console.error()`，成功时自然返回
- **Daemon communication**: 通过 `../daemon/client.js` 的 `startDaemon()` / `sendToDaemon()` 通信，不直接操作 socket
- **Auto-generated file**: `cliDefinitions.ts` 由 `npm run cli:generate` 生成，**禁止手动编辑**
- **Export pattern**: 每个命令文件 export 单一 async 函数 (`xxxCommand`)，不 export class 或默认导出
- **Error handling**: 命令内捕获 socket 错误并转为友好的 CLI 错误信息，不暴露原始异常堆栈
- **Socket path**: Unix socket 路径由 `../daemon/utils.js` 的 `getSocketPath()` 统一计算，Windows 下自动切换为 named pipe
