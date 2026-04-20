# PROJECT KNOWLEDGE BASE — JSReverser-MCP

**Generated:** 2026-04-11
**Commit:** 7b57023 — test: 跳过需要 Chrome 的 daemon 集成测试并修复 utils 测试
**Branch:** axi-mode

## OVERVIEW

JS逆向工程MCP服务 — 标准化前端JavaScript逆向流程。通过Puppeteer接管Chrome，提供页面观察、Hook采样、断点调试、网络分析、补环境复现等能力。CLI + Daemon双进程架构，通过Unix Socket通信。

## STRUCTURE

```
JSReverser-MCP/
├── src/              # 核心源码 (SWC编译 → build/)
│   ├── bin/          # CLI可执行入口 (js-reverse, js-reverse-mcp)
│   ├── cli/          # CLI层 (axi-sdk-js, 9命令 + 80+工具调度)
│   ├── daemon/       # 后台守护进程 (Unix Socket服务端)
│   ├── tools/        # MCP工具实现 (60+工具)
│   │   └── hook/     # Hook系统 (注入、采样、追踪)
│   ├── skills/       # 逆向工程技能 (observe-flow, auto-hook, rebuild-bundle)
│   ├── services/     # 业务服务层
│   ├── modules/      # 功能模块 (debugger, collector)
│   ├── database/     # 数据持久化层
│   ├── types/        # TypeScript类型定义
│   └── utils/        # 跨层工具函数
├── tests/            # 测试 (Node.js原生test runner)
├── scripts/          # 构建/CI/自动化脚本
├── docs/             # 文档 (reference, guides)
├── artifacts/        # 任务产物 (默认.gitignore, 仅_TEMPLATE提交)
└── build/            # 编译输出 (SWC, 勿手动编辑)
```

## WHERE TO LOOK

| Task        | Location                                      | Notes                                   |
| ----------- | --------------------------------------------- | --------------------------------------- |
| 启动MCP服务 | `src/index.ts` → `src/daemon/daemon.ts`       | `npm start` 直连daemon                  |
| CLI命令     | `src/bin/js-reverse.ts` → `src/cli/commands/` | axi-sdk-js定义                          |
| 添加工具    | `src/tools/` + 注册到index                    | 改工具后跑 `npm run docs`               |
| Hook逻辑    | `src/tools/hook/`                             | 注入、采样、函数追踪                    |
| 技能系统    | `src/skills/`                                 | observe-flow, auto-hook, rebuild-bundle |
| 补环境      | `artifacts/tasks/<id>/env/`                   | env.js → polyfills.js → entry.js        |
| 案例沉淀    | `scripts/cases/`                              | 抽象方法论，非敏感参数                  |
| 文档生成    | `scripts/generate-docs.ts`                    | `npm run docs` 触发                     |
| 构建后处理  | `scripts/post-build.ts`                       | 生成mock、修补第三方                    |

## CODE MAP

| Symbol                    | Type     | Location                    | Role                                |
| ------------------------- | -------- | --------------------------- | ----------------------------------- |
| `handleRequest`           | Function | `src/daemon/daemon.ts:156`  | MCP请求路由分发，60+工具调度中枢    |
| `startSocketServer`       | Function | `src/daemon/daemon.ts:455`  | Unix Socket服务端启动               |
| `ensureBrowserConnection` | Function | `src/daemon/daemon.ts:133`  | 浏览器连接懒初始化                  |
| `ensureToolsLoaded`       | Function | `src/daemon/daemon.ts:97`   | 工具注册懒加载                      |
| `parseDaemonArgs`         | Function | `src/daemon/daemon.ts:57`   | CLI参数解析 (browserUrl/wsEndpoint) |
| `runAxiCli`               | Function | `src/bin/js-reverse.ts`     | axi-sdk-js CLI入口                  |

## CONVENTIONS

- **Compiler**: SWC (非tsc产出)，`npm run build`
- **Module**: ESM (`"type": "module"`)，import用 `.js` 后缀
- **Types**: `interface` 非 `type` (eslint: consistent-type-definitions)
- **Arrays**: 简单用 `T[]`，复杂泛型用 `Array<T>`
- **Imports**: 组间空行分隔，组内升序，禁止循环依赖，Node内置必须 `node:` 协议
- **Quotes**: 单引号，`bracketSpacing: false`，尾随逗号all，arrowParens avoid
- **License**: 每个源文件需含年度license header (自定义ESLint规则检查)
- **Commits**: Conventional Commits格式
- **Barrel exports**: 大量使用 `index.ts` 聚合模块导出

## ANTI-PATTERNS (THIS PROJECT)

- **NEVER** 改函数/类/方法前不跑 `gitnexus_impact` 分析影响面
- **NEVER** 忽略HIGH/CRITICAL风险警告
- **NEVER** 用find-and-replace重命名符号 — 用 `gitnexus_rename`
- **NEVER** 不跑 `gitnexus_detect_changes()` 就提交
- **DON'T** 跳过页面证据直接猜环境 (逆向方法论)
- **DON'T** 一次性全量模拟浏览器 (逆向方法论)
- **DON'T** 提交真实任务目录到Git (仅 `_TEMPLATE/`)
- **DON'T** 手动编辑 `build/` 目录 (SWC编译产物)
- **DON'T** 手动编辑 `docs/reference/tool-reference.md` (自动生成，跑 `npm run docs`)

## UNIQUE STYLES

- **axi-sdk-js CLI**: 入口使用 `runAxiCli()`，命令遵循 `AxiCliCommand<DaemonContext>` 签名，TOON格式输出
- **懒加载贯穿全局**: 所有command handler用 `async () => { const {x} = await import('./x.js'); }` 模式
- **双重MCP架构**: `js-reverse-mcp` fork `src/index.ts` 作为子进程，形成三层: CLI → MCP-Daemon → MCP-Server
- **Daemon与CLI解耦**: 两个独立进程通过Unix Socket通信 (Windows用named pipe)
- **逆向方法论沉淀**: Observe-first → Hook-preferred → Breakpoint-last → Rebuild-oriented → Evidence-first → Pure-extraction-after-pass
- **任务脚手架**: `artifacts/tasks/<task-id>/` 标准结构 (task.json, runtime-evidence.jsonl, env/, entry.js, run/, report.md)

## COMMANDS

```bash
# 安装 & 构建
npm install
npm run build              # SWC编译 + post-build处理

# 测试
npm test                   # 全量测试
npm run test:unit          # 单元测试
npm run test:property      # 属性测试
npm run test:only          # 仅运行 marked { only: true } 的测试
npm run test:update-snapshots
npm run coverage:full
npm run coverage:core      # 核心7文件覆盖率

# 类型 & 质量
npm run typecheck          # tsc --noEmit (不参与build)
npm run format             # Prettier格式化
npm run lint               # ESLint检查

# 文档
npm run docs               # 从源码生成工具文档

# CLI
js-reverse start --browserUrl http://127.0.0.1:9222
js-reverse stop
js-reverse status
js-reverse list-skills
js-reverse list-tools
js-reverse call list_scripts
js-reverse call-skill observe-flow --url https://example.com
js-reverse repl
js-reverse scaffold --name my-task --desc "Task" --url https://example.com
```

## NOTES

- **Node版本**: v22 (见.nvmrc)，引擎要求 `^20.19.0 || ^22.12.0 || >=23`
- **运行时flag**: `--experimental-strip-types` 用于直接跑TS脚本
- **tsconfig双配置**: 主配置宽松(strict:false)，scripts/子配置严格(strict:true)
- **类型错误不阻止构建**: typecheck是独立script，未集成到build流程
- **Rollup配置缺失**: `npm run bundle` 引用 `rollup.config.mjs` 但该文件不存在
- **无CI/CD配置**: 文档提到CI流水线，但实际无 `.github/workflows/`
- **许可证头争议**: 源文件标注 "Copyright 2025 Google LLC"，但项目实际作者zhizhuodemao，License Apache-2.0
- **FIXME**: `src/browser.ts:321` 日志订阅时机可能过晚 (浏览器启动后才订阅)
- **TODO**: `src/skills/observe-flow.ts:265` 技能系统需浏览器上下文功能未完全实现
- **CDP Proxy**: 固定端口3456，提供HTTP API操控Chrome DevTools Protocol
- **外部AI**: 支持OpenAI/Anthropic/Gemini作为分析增强层，通过环境变量配置

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
