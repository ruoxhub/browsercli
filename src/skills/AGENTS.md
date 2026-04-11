# DOMAIN KNOWLEDGE BASE — Skills

**Scope:** `src/skills/`
**Domain:** 逆向工程技能系统 (高层工作流编排)

## OVERVIEW

三套高阶逆向技能，通过 `SkillRunner` 编排多工具调用，形成 observe → hook → rebuild 的标准工作流。

## WHERE TO LOOK

| Task           | Location            | Notes                                                                                    |
| -------------- | ------------------- | ---------------------------------------------------------------------------------------- |
| 技能注册与调度 | `SkillRunner.ts`    | `SkillRegistry`(单例) + `SkillRunner.run()`                                              |
| 页面观察       | `observe-flow.ts`   | 脚本采集、加密/混淆检测、依赖分析、风险评估                                              |
| 自动 Hook      | `auto-hook.ts`      | 预设配置(none/api-signature/network-core)、加密库 Hook、Fetch/XHR/Cookie/Timer/Eval 注入 |
| 本地复现       | `rebuild-bundle.ts` | 生成 env.js/polyfills.js/entry.js、缺失能力推断                                          |
| 类型导出       | `index.ts`          | barrel export，`getBuiltInSkillDefinitions()`                                            |

## FILE MAP

| Symbol               | Type     | Location                | Role                                   |
| -------------------- | -------- | ----------------------- | -------------------------------------- |
| `observeFlowSkill`   | Function | `observe-flow.ts:136`   | 主技能入口：收集→分析→检测→评估        |
| `autoHookSkill`      | Function | `auto-hook.ts:637`      | 主技能入口：预设合并→按需注入→报告     |
| `rebuildBundleSkill` | Function | `rebuild-bundle.ts:280` | 主技能入口：证据收集→环境构建→入口生成 |
| `SkillRegistry`      | Class    | `SkillRunner.ts:50`     | 技能注册表单例                         |
| `SkillRunner`        | Class    | `SkillRunner.ts:90`     | 技能执行器                             |
| `PRESET_CONFIGS`     | Constant | `auto-hook.ts:93`       | 三种 Hook 预设映射表                   |

## CONVENTIONS

- **技能 vs 工具**: 技能是多工具组合的高阶工作流，单个工具通过 MCP 直接调用
- **注册模式**: 每个技能文件导出 `registerXxxSkill()`，由 `index.ts` 的 `registerBuiltInSkills()` 统一注册
- **选项合并**: `auto-hook.ts` 使用 `mergePresetConfig()` 将预设与用户选项合并，用户选项优先
- **代码生成**: `auto-hook.ts` 通过 `_generateXxxHookScript()` 系列函数生成注入浏览器的 JS 代码
- **环境 Shim**: `rebuild-bundle.ts` 通过 `buildDefaultEnvCode()` / `buildStorageShimCode()` 生成 Node.js 垫片代码
- **CLI 调用**: `js-reverse call-skill <name> --url <url>`

## KNOWN GAPS

- `observe-flow.ts:265` — `collectScripts()` 为简化实现，缺少实际 Puppeteer 导航和脚本采集逻辑，需浏览器上下文配合
- `rebuild-bundle.ts` — `pickTargetScript()` 接收空数组，实际依赖外部数据源注入脚本内容
- 技能执行结果中的 `data.bundlePath` 等路径字段为空字符串，需与文件系统操作层对接
