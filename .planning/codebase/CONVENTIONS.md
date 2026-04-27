# Coding Conventions

**Analysis Date:** 2026-04-27

## Naming Patterns

**Files:**
- Use TypeScript source files under `src/` and mirror source paths in tests under `tests/unit/`; examples include `src/services/OpenAIProvider.ts` and `tests/unit/services/OpenAIProvider.mocked.test.ts`.
- Use lower camelCase for single-purpose tool function files such as `src/tools/navigation/navigatePage.ts`, `src/tools/crypto/hookCryptoJS.ts`, and `src/cli/args-parser.ts`.
- Use PascalCase for class/module files such as `src/services/AIService.ts`, `src/utils/TokenBudgetManager.ts`, `src/modules/hook/HookManager.ts`, and `src/browser/SessionManager.ts`.
- Use `index.ts` as a local barrel inside feature folders such as `src/tools/crypto/index.ts`, `src/modules/stealth/index.ts`, and `src/third_party/index.ts`.
- Use `.test.ts` for normal tests, `.integration.test.ts` for integration tests, `.property.test.ts` for property tests, and performance-oriented names under `tests/performance/`; examples include `tests/unit/utils/errors.test.ts`, `tests/integration/gemini-cli.integration.test.ts`, `tests/property/AIService.property.test.ts`, and `tests/performance/baseline.test.ts`.

**Functions:**
- Use lower camelCase for functions and exported helpers, as in `parseArgs`, `getFlag`, `hasFlag`, and `getBoolFlag` from `src/cli/args-parser.ts`.
- Use verb-first names for tool actions and handlers, as in `navigatePage` from `src/tools/navigation/navigatePage.ts`, `hookCryptoJS` from `src/tools/crypto/hookCryptoJS.ts`, and `formatError` from `src/utils/errors.ts`.
- Use factory-style names beginning with `create` for test harnesses and adapters, as in `createPage` and `createNavigationRuntime` from `tests/unit/tools/navigation/navigatePage.test.ts`.
- Keep private class methods lower camelCase and behavior-focused, as in `AIService.withRetry`, `AIService.isRetryableError`, and `AIService.sleep` in `src/services/AIService.ts`.

**Variables:**
- Use lower camelCase for local variables and parameters, as in `rawArgs`, `positionals`, `defaultValue`, and `eqIndex` in `src/cli/args-parser.ts`.
- Use `const` for immutable objects and generated data in tests, as in `runPerf` and `timings` in `tests/performance/baseline.test.ts`.
- Prefix intentionally unused parameters or variables with `_`; `eslint.config.mjs` configures `@typescript-eslint/no-unused-vars` with `argsIgnorePattern: '^_'` and `varsIgnorePattern: '^_'`.
- Use uppercase constants for module-level defaults, as in `DEFAULT_RETRY_CONFIG` in `src/services/AIService.ts` and `DEFAULT_SEKIRO_HOST` in `src/config.ts`.
- Use env var names in uppercase snake case only, such as `OPENAI_API_KEY`, `DEFAULT_LLM_PROVIDER`, `RUN_PERF_TESTS`, and `RUN_E2E_TESTS` in `src/config.ts`, `tests/setup.ts`, and `tests/performance/baseline.test.ts`.

**Types:**
- Prefer `interface` for object shapes; `eslint.config.mjs` enforces `@typescript-eslint/consistent-type-definitions: ['error', 'interface']`.
- Use PascalCase for interfaces and classes, as in `AIProvider`, `AIResponse`, `AIConfig`, and `AIService` in `src/services/AIService.ts`.
- Use type-only imports/exports for types; `eslint.config.mjs` enforces `@typescript-eslint/consistent-type-imports` and `@typescript-eslint/consistent-type-exports`, and `src/tools/crypto/index.ts` uses `export type`.
- Use union literal aliases for narrow value sets when needed, as in `MessageRole` in `src/services/AIService.ts` and `LogLevel` in `src/utils/logger.ts`.
- Use `as const` for constant maps intended to produce literal types, as in `ErrorCodes` in `src/utils/errors.ts`.

## Code Style

**Formatting:**
- Use Prettier 3 via `.prettierrc.cjs`; key settings are `singleQuote: true`, `trailingComma: 'all'`, `arrowParens: 'avoid'`, `bracketSpacing: false`, `singleAttributePerLine: true`, `htmlWhitespaceSensitivity: 'strict'`, and `endOfLine: 'lf'`.
- Run `npm run format` to apply ESLint fixes to `src/` and `scripts/` and Prettier to `src/` and `scripts/`; the command is defined in `package.json`.
- Run `npm run check-format` before handoff; `package.json` runs `eslint --cache .` and `prettier --check --cache .`.
- Keep generated build output in `build/` out of manual edits; ESLint ignores `**/build/` in `eslint.config.mjs`.
- Do not format `CHANGELOG.md` with Prettier; `.prettierignore` excludes `CHANGELOG.md`.

**Linting:**
- Use ESLint 9 flat config from `eslint.config.mjs` with `@eslint/js`, `typescript-eslint`, `eslint-plugin-import`, `@stylistic/eslint-plugin`, and the local plugin in `scripts/eslint_rules/local-plugin.js`.
- Include the license header on TypeScript and JavaScript files; `scripts/eslint_rules/check-license-rule.js` enforces a top-of-file `@license` block.
- Use `node:` protocol for Node built-ins; `eslint.config.mjs` enforces `import/enforce-node-protocol-usage: ['error', 'always']`, and examples include `node:assert`, `node:test`, and `node:fs` in test files.
- Avoid circular imports; `eslint.config.mjs` enforces `import/no-cycle` with `maxDepth: Infinity`.
- Avoid `any`; `eslint.config.mjs` sets `@typescript-eslint/no-explicit-any` to `error`, with rest args ignored. Existing files such as `src/services/AIService.ts` use a file-level disable only for legacy or boundary code.
- Await or explicitly handle promises in production code; `eslint.config.mjs` enforces `@typescript-eslint/no-floating-promises` outside test files.
- Restrict `chrome-devtools-frontend` imports to `node_modules/chrome-devtools-frontend/mcp/mcp.js`; `eslint.config.mjs` defines `no-restricted-imports` for this boundary.

## Import Organization

**Order:**
1. Node built-ins first with `node:` protocol, as in `tests/unit/logger/root-logger.test.ts`.
2. External packages next, as in `openai` in `tests/unit/services/OpenAIProvider.mocked.test.ts` and `fast-check` in `tests/property/ToolRegistry.property.test.ts`.
3. Internal value imports from `src/` paths with `.js` extensions, as in `tests/unit/utils/errors.test.ts`.
4. Internal type imports using `import type`, as in `src/tools/crypto/hookCryptoJS.ts` and `tests/unit/tools/navigation/navigatePage.test.ts`.

**Path Aliases:**
- No TypeScript path aliases are configured in `tsconfig.json`; import internal files with relative paths.
- Use `.js` extensions in TypeScript ESM imports that target TypeScript source, as in `src/services/AIService.ts`, `src/config.ts`, and `tests/unit/utils/errors.test.ts`.
- `tsconfig.json` uses `moduleResolution: 'bundler'`, `module: 'esnext'`, and `target: 'es2023'`; keep new imports compatible with this ESM setup.

## Error Handling

**Patterns:**
- Normalize public error payloads with `formatError` and `ErrorCodes` from `src/utils/errors.ts` when returning structured errors.
- Throw `Error` with actionable messages for invalid input and unrecoverable paths, as in `src/cli.ts`, `src/cli/args-parser.ts`, and `src/worker/ToolContextProvider.ts`.
- For tool-style APIs that return user-facing outcomes, return `{success: false, message: ...}` rather than throwing when the failure is an expected runtime condition; `src/tools/crypto/hookCryptoJS.ts` and `src/tools/navigation/navigatePage.ts` follow this pattern.
- Preserve unknown error information safely with `error instanceof Error ? error.message : String(error)`, as in `src/tools/crypto/hookCryptoJS.ts` and `src/utils/errors.ts`.
- Retry transient external provider failures through service boundaries rather than at call sites; `AIService.withRetry` in `src/services/AIService.ts` retries network codes, rate limits, and server errors.
- In tests, assert failures with `assert.throws` and `assert.rejects`, as in `tests/unit/utils/errors.test.ts`, `tests/unit/tools/navigation/navigatePage.test.ts`, and `tests/unit/services/OpenAIProvider.mocked.test.ts`.

## Logging

**Framework:** Custom `logger` wrapper plus occasional `console` at process boundaries.

**Patterns:**
- Use `logger` from `src/utils/logger.ts` for application/module logging; it supports `debug`, `info`, `warn`, `error`, `success`, and `saveLogsToFile`.
- Configure runtime log level through `LOG_LEVEL`; `src/utils/logger.ts` calls `getEnvValue('LOG_LEVEL')` from `src/config.ts`.
- Write operational logs to `console.error` from `src/utils/logger.ts` so normal MCP/stdout channels remain less noisy.
- Use direct `console.error` only at entry-point or shutdown boundaries such as `src/index.ts`; prefer `logger` inside modules such as `src/utils/UnifiedCacheManager.ts` and `src/modules/analyzer/CodeAnalyzer.ts`.
- Tests silence `console.log`, `console.debug`, `console.info`, and `console.warn` unless `DEBUG` is set; this behavior lives in `tests/setup.ts`.

## Comments

**When to Comment:**
- Use short comments to explain non-obvious compatibility, boundary, or parsing decisions, as in `src/cli/args-parser.ts` and `src/config.ts`.
- Document public functions with JSDoc when parameters and return shapes are meaningful to tool consumers, as in `hookCryptoJS` in `src/tools/crypto/hookCryptoJS.ts`.
- Keep comments tied to behavior or constraints; avoid restating simple assignments. `src/services/AIService.ts` uses mostly code structure instead of explanatory comments.
- For tests, comments may link cases to requirements, as in `tests/integration/gemini-cli.integration.test.ts` and `tests/property/AIService.property.test.ts`.

**JSDoc/TSDoc:**
- Use `/** ... */` comments for module-level context and public API docs in files such as `src/config.ts`, `src/tools/crypto/hookCryptoJS.ts`, and `tests/integration/gemini-cli.integration.test.ts`.
- Keep license headers as the first block comment except where a shebang is needed; `scripts/eslint_rules/check-license-rule.js` inserts after shebang comments.
- Do not include secret values or production session details in comments; configuration docs should name keys such as `OPENAI_API_KEY` without values.

## Function Design

**Size:** Prefer focused exported functions for tool actions and utilities, as in `src/tools/navigation/navigatePage.ts`, `src/tools/crypto/hookCryptoJS.ts`, and `src/cli/args-parser.ts`. Large orchestrators exist in analyzer modules such as `src/modules/analyzer/CodeAnalyzer.ts`; new logic should be factored into focused helpers when touching these areas.

**Parameters:** Use typed object parameters or small primitive lists depending on local style. Tool/runtime services use typed interfaces such as `NavigationRuntimeServices` in `src/tools/navigation/types.ts`; utility functions such as `getFlag` in `src/cli/args-parser.ts` use explicit primitive parameters with defaults.

**Return Values:** Use explicit return types on exported functions and public methods, as in `parseArgs(rawArgs: string[]): ParsedArgs`, `formatError(...): ErrorResponse`, and `hookCryptoJS(...): Promise<HookResult>`. Use structured result objects for tool outcomes and service responses.

## Module Design

**Exports:** Export concrete functions/classes from implementation files and re-export public surface through local `index.ts` barrels where a folder has multiple related tools, as in `src/tools/crypto/index.ts` and `src/modules/stealth/index.ts`.

**Barrel Files:** Use barrel files for feature folders, not for arbitrary project-wide aggregation. `src/tools/crypto/index.ts` re-exports `hookCryptoJS`, `hookJSEncrypt`, `hookSMCrypto`, and related types; tests import from this barrel in `tests/unit/functions/crypto.test.ts`.

**Project-Specific Constraints:**
- Follow GitNexus safety workflow for code edits: use GitNexus exploration for unfamiliar areas, run upstream impact analysis before editing symbols, and run change detection before commits. The local skill docs are under `.claude/skills/gitnexus/`.
- Keep reverse-engineering work evidence-first and avoid committing private task artifacts; repository guidance points evidence to `artifacts/tasks/<task-id>/` and public docs to `docs/reference/`.
- Do not add dependencies for style or tests without explicit need; `package.json` already provides ESLint, Prettier, Node test runner, `fast-check`, `sinon`, and `c8`.

---

*Convention analysis: 2026-04-27*
