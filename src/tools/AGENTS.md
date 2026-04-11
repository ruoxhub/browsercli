# DIRECTORY KNOWLEDGE BASE — src/tools/

**Generated:** 2026-04-11
**Complexity Score:** 130 (highest in project)

## OVERVIEW

All 60+ MCP tool implementations live here. Each tool exports a definition + handler, registered via barrel export in `index.ts`.

## STRUCTURE

```
src/tools/
├── index.ts                 # Barrel export + ToolRegistry 注册
├── ToolDefinition.ts        # 工具定义类型
├── ToolRegistry.ts          # 工具注册表 (registerMany, autoGenerateKebabAliases)
├── categories.ts            # 工具分类元数据
├── analyzer.ts              # 代码分析、去混淆、加密检测、风险评估
├── collector.ts             # 代码采集与脚本搜索
├── debugger.ts              # 断点、单步、XHR中断、函数追踪 (最大单文件)
├── hook.ts                  # Hook 创建、注入、数据读取
├── hook/                    # 专项 Hook (25+): cookie, fetch, xhr, storage, history...
├── crypto/                  # 加密库 Hook: CryptoJS, JSEncrypt, sm-crypto
├── vue/                     # Vue 工具: devtools, routes, guards
├── anti-debug/              # 反调试对抗: antiAntiDebug, bypassDebugger
├── page.ts / pages.ts       # 页面状态、会话管理、多页面
├── network.ts / websocket.ts# 网络请求与 WS 消息分析
├── input.ts / dom.ts        # 输入操作与 DOM 查询
├── emulation.ts / stealth.ts# 设备模拟与反检测
├── cdp-proxy.ts             # CDP HTTP API 代理 (:3456)
├── performance.ts           # 性能追踪 (Core Web Vitals)
├── rebuild.ts               # 本地复现 bundle 导出
├── skill.ts                 # 技能系统调用
├── siteExperience.ts        # 站点经验数据库
├── code-templates.ts        # 代码模板
└── v-jstools.ts             # v_jstools 迁移 (AST/去混淆/转译)
```

## WHERE TO LOOK

| Task                   | Location                             | Notes                                     |
| ---------------------- | ------------------------------------ | ----------------------------------------- |
| 添加新工具             | 新建 `.ts` → 注册到 `index.ts`       | 注册后必须跑 `npm run docs`               |
| 修改现有工具           | 对应 `.ts` 文件                      | 改后跑 `gitnexus_impact` + `npm run docs` |
| 新增专项 Hook          | `src/tools/hook/`                    | 命名: `hook<CamelCase>.ts`                |
| 新增加密库/框架/反调试 | `crypto/`, `vue/`, `anti-debug/`     |                                           |
| 工具 IO 契约           | `docs/reference/tool-io-contract.md` |                                           |
| 完整工具文档           | `docs/reference/tool-reference.md`   | 自动生成，勿手动编辑                      |

## CONVENTIONS

- **注册**: 新工具必须在 `index.ts` 的 `registry.registerMany([...])` 中注册
- **别名**: kebab-case 别名由 `autoGenerateKebabAliases()` 自动生成
- **分组**: `registerMany` 中按功能域分组注释 (网络工具、调试工具、Hook 工具等)
- **Hook 命名**: `hook/` 下统一 `hook<PascalCase>.ts` 格式

## ANTI-PATTERNS

- **NEVER** 添加工具后不跑 `npm run docs`
- **NEVER** 手动编辑 `docs/reference/tool-reference.md`
- **NEVER** 跳过 `gitnexus_impact` 就改已有工具 — 60+ 工具存在调用链依赖
- **NEVER** 在 `index.ts` 外单独注册工具 — 必须走 barrel export 统一注册
- **DON'T** 在工具文件中硬编码 API key 或敏感参数
