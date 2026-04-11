# SERVICES LAYER KNOWLEDGE BASE

## OVERVIEW

业务服务层 — 提供 LLM 调用抽象、多 Provider 适配、数据库连接及站点经验持久化的可复用逻辑。

## WHERE TO LOOK

| Domain         | Files                      | Notes                                     |
| -------------- | -------------------------- | ----------------------------------------- |
| AI 抽象层      | `AIService.ts`             | `AIProvider` 接口、`AIService` 重试封装   |
| OpenAI 适配    | `OpenAIProvider.ts`        | `gpt-4o` 默认模型，支持视觉分析           |
| Anthropic 适配 | `AnthropicProvider.ts`     | Claude API 接入                           |
| Gemini 适配    | `GeminiProvider.ts`        | 支持 API 模式与 CLI 模式双路              |
| LLM 门面       | `LLMService.ts`            | 统一 `chat()` 入口 + 逆向专用 prompt 生成 |
| 数据库连接     | `DatabaseService.ts`       | Drizzle ORM + pg 连接池，单例 `dbService` |
| 站点经验 CRUD  | `SiteExperienceService.ts` | 按域名/名称检索逆向经验，单例导出         |
| Barrel 导出    | `index.ts`                 | 统一对外导出所有服务与类型                |

## CONVENTIONS

- **Provider 模式**: 所有 LLM 厂商实现 `AIProvider` 接口 (`chat` + `analyzeImage`)
- **重试策略**: `AIService` 内置指数退避重试 (默认 3 次)，仅重试网络错误/429/5xx
- **单例导出**: `DatabaseService` 和 `SiteExperienceService` 均导出小写单例 (`dbService`, `siteExperienceService`)
- **Drizzle ORM**: 数据库查询使用 Drizzle 类型安全 API，schema 定义在 `../database/schema.js`
- **Prompt 集中**: `LLMService` 封装所有逆向场景 prompt 模板 (代码分析、加密检测、去混淆、污点分析)
- **错误透传**: Provider 层 `handleError` 保留原始 status code 供上层重试逻辑判断

## ANTI-PATTERNS

- **NEVER** 直接在工具层实例化 LLM Provider — 必须通过 `LLMService.chat()` 统一入口
- **NEVER** 绕过 `AIService` 重试直接调用 Provider — 网络抖动会导致偶发失败
- **DON'T** 在 Service 中硬编码 API key — 全部由 `config.ts` 从环境变量读取
