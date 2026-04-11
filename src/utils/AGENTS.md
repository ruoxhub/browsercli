# src/utils/ — AGENTS.md

## OVERVIEW

Cross-cutting utility modules imported by tools, daemon, services, and commands. No barrel `index.ts` — import files directly.

## WHERE TO LOOK

| Task                  | File                                          | Notes                                                                                            |
| --------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Logging (all layers)  | `logger.ts`                                   | Singleton, outputs to `stderr` to avoid MCP stdout pollution. Controlled by `LOG_LEVEL` env.     |
| Safe JSON ops         | `safeJson.ts`                                 | `safeStringify` / `safeParse` — handles circular refs, BigInt, Functions, Symbols, depth limits. |
| Error formatting      | `errors.ts`                                   | `ErrorResponse` interface, `ErrorCodes` const, `formatError()` helper.                           |
| Path resolution       | `projectPaths.ts`                             | `resolvePackageRoot()`, resolves artifacts/cache/.env dirs relative to package root.             |
| Output path security  | `fsSafe.ts`                                   | `validateOutputPath()` — prevents directory traversal, respects `JSREVERSER_OUTPUT_DIR`.         |
| Config & AI providers | `config.ts`                                   | Env-driven AI/browser config, `createAIService()` factory, validation.                           |
| Token budget          | `TokenBudgetManager.ts`                       | Session-level token tracking with 80/90/95% warning thresholds.                                  |
| Data serialization    | `AdaptiveDataSerializer.ts`                   | Type-aware serialization with smart truncation for large payloads.                               |
| Detail data cache     | `detailedDataManager.ts`                      | Summary + token pattern for large data — cache locally, fetch on demand.                         |
| Cache coordination    | `UnifiedCacheManager.ts` + `CacheAdapters.ts` | Orchestrates DetailedDataManager, CodeCache, CodeCompressor with cleanup strategies.             |
| Pagination            | `pagination.ts` + `types.ts`                  | Generic `paginate<T>()` with page index validation.                                              |
| Keyboard parsing      | `keyboard.ts`                                 | Validates and parses key combinations (e.g. `Control+A`) for Puppeteer.                          |
| Write scheduling      | `ToolExecutionScheduler.ts`                   | Read-write mutex for concurrent tool execution safety.                                           |

## CONVENTIONS

- **No barrel export**: Each file imports directly (e.g. `import {logger} from './logger.js'`), not via `index.ts`.
- **Singletons**: `logger`, `TokenBudgetManager`, `UnifiedCacheManager` are singleton instances — do not instantiate duplicates.
- **Cross-dependencies allowed**: Utils may import from other utils (e.g. `logger.ts` → `safeJson.ts`, `config.ts` → `projectPaths.ts`).
- **Service imports OK**: `config.ts` imports from `../services/` to create AI service factories — this is the only utils file that reaches into services.
- **All exports use `function` or `class`**: No default exports. Named exports only.
