# Technology Stack

**Analysis Date:** 2026-04-27

## Languages

**Primary:**
- TypeScript 5.9.2 - Core source in `src/**/*.ts`, tests in `tests/**/*.ts`, build scripts such as `scripts/post-build.ts`.
- JavaScript ESM - CLI helper scripts in `scripts/**/*.mjs` and generated call-tool examples in `scripts/call_tool/*.js`.

**Secondary:**
- Markdown - User and architecture documentation in `README.md`, `docs/**/*.md`, and `artifacts/tasks/_TEMPLATE/**/*.md`.
- Shell - Test helper scripts in `scripts/test-loop.sh`, `scripts/test-dashboard.sh`, `scripts/test-ci.sh`, and `tests/daemon/start-daemon.sh`.

## Runtime

**Environment:**
- Node.js `^20.19.0 || ^22.12.0 || >=23` from `package.json`.
- `.nvmrc` pins local development to `v22`.
- Project uses native ESM via `"type": "module"` in `package.json`.

**Package Manager:**
- npm - `package-lock.json` uses lockfile version 3.
- Lockfile: present at `package-lock.json`.

## Frameworks

**Core:**
- `axi-sdk-js` `^0.1.4` - CLI framework used by `src/bin/js-reverse.ts` and CLI command modules under `src/cli/commands/`.
- `patchright` `^1.59.0` - Browser automation and Chrome connection layer used by `src/browser/browser.ts` and re-exported from `src/third_party/playwright.ts`.
- `ws` `^8.20.0` - Sekiro WebSocket client transport in `src/protocol/sekiro.ts`.
- `drizzle-orm` `^0.45.2` with `pg` `^8.20.0` - Optional PostgreSQL access for site experience storage in `src/services/DatabaseService.ts` and schema definitions in `src/database/schema.ts`.

**Testing:**
- Node built-in `node:test` - Test runner configured through npm scripts in `package.json`; setup file is `tests/setup.ts`.
- `fast-check` `^4.5.3` - Property testing in `tests/property/**/*.test.ts`.
- `sinon` `^21.0.0` - Test doubles in unit tests.
- `c8` `^10.1.3` - Coverage runner via `npm run coverage` and `npm run coverage:strict`.

**Build/Dev:**
- `@swc/cli` `^0.8.1` and `@swc/core` `^1.15.21` - Transpile `src` and `tests` to `build` via `npm run build`.
- TypeScript compiler `typescript` `^5.9.2` - Type checking via `npm run typecheck` using `tsconfig.json`.
- ESLint 9 flat config - Linting rules in `eslint.config.mjs`, including local license rule from `scripts/eslint_rules/local-plugin.js`.
- Prettier 3.6.2 - Formatting configured in `.prettierrc.cjs`.
- `scripts/post-build.ts` - Post-build patching and mock file generation for `chrome-devtools-frontend` assets under `build/node_modules/`.
- `scripts/prepare.ts` - npm prepare cleanup for problematic `chrome-devtools-frontend` package files.

## Key Dependencies

**Critical:**
- `openai` `^4.73.0` - Current implemented LLM provider in `src/services/OpenAIProvider.ts`; wired by `src/config.ts` and `src/services/LLMService.ts`.
- `chrome-devtools-frontend` `^1.0.1608868` - Optional dependency used for DevTools trace and collector compatibility through `src/trace-processing/parse.ts`, `src/modules/collector/PageCollector.ts`, and post-build mocks in `scripts/post-build.ts`.
- `patchright` `^1.59.0` - Browser launch, remote browser connection, page/frame automation, screenshots, and CDP-facing tool execution.
- `ws` `^8.20.0` - Required for Node-side Sekiro registration and action dispatch.
- `zod` `^3.25.76` - Re-exported from `src/third_party/index.ts` for schema-style validation surfaces.

**Infrastructure:**
- `dotenv` `^16.4.7` - Loads root `.env` from `src/config.ts` via `resolveDefaultEnvPath`; do not read or commit `.env`.
- `pg` `^8.20.0` - PostgreSQL pool in `src/services/DatabaseService.ts`.
- `drizzle-orm` `^0.45.2` - Typed database query and schema layer in `src/database/schema.ts` and `src/services/SiteExperienceService.ts`.
- `yargs` `18.0.0` - Browser/MCP-style argument parser in `src/cli.ts`.
- `@babel/parser`, `@babel/traverse`, `@babel/generator`, `@babel/types` - AST analysis and deobfuscation in `src/modules/deobfuscator/*.ts`, `src/modules/analyzer/CodeAnalyzer.ts`, and `src/tools/vjstools/deobfuscate.ts`.
- `terser` `^5.46.1`, `javascript-obfuscator` `^5.4.1`, `diff` `^8.0.4` - Code cleanup, minification, obfuscation detection, and diff tooling in `src/tools/vjstools/deobfuscate.ts` and deobfuscator tests.
- `chalk` `^5.6.2` - CLI output styling.
- `express` `^5.2.1`, `@types/express` `^5.0.6`, `@anthropic-ai/sdk` `^0.32.1`, `axios` `^1.13.5`, `cheerio` `^1.2.0`, `sm-crypto` `^0.4.0`, and `xbogus` `^1.0.2` are declared in `package.json`; current `src/` references are absent or limited to templates/tests, so treat them as dependency inventory requiring verification before relying on them in production code.

## Configuration

**Environment:**
- Central configuration lives in `src/config.ts`; public re-export exists at `src/utils/config.ts`.
- Configuration precedence in `src/config.ts`: CLI arguments, environment variables, root `config.json`, project `js-reverse.config.json`, user `~/.jsreverserrc.json`, then defaults.
- `.env` and `.env.example` are present in the repository root; only their existence is recorded because they may contain environment configuration.
- Root `config.json` is present; do not quote values from it because it may contain local connection strings or API configuration.
- Important env keys parsed by `src/config.ts`: `SEKIRO_HOST`, `SEKIRO_GROUP`, `BROWSER_URL`, `BROWSER_WS_ENDPOINT`, `BROWSER_HEADLESS`, `BROWSER_EXECUTABLE_PATH`, `DATABASE_URL`, `JSREVERSER_RUNTIME_DIR`, `DEFAULT_LLM_PROVIDER`, `JSREVERSER_DEBUG`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `BROWSER_ISOLATED`, `USE_STEALTH_SCRIPTS`, `BROWSER_CHANNEL`, `REMOTE_DEBUGGING_URL`, `REMOTE_DEBUGGING_PORT`, `LOG_LEVEL`, `JSREVERSER_OUTPUT_DIR`, `SESSION_STATE_TTL_MS`, `SESSION_STATE_CLEANUP_INTERVAL_MS`, `SESSION_STATE_ENCRYPTION_KEY`.

**Build:**
- Build entry: `npm run build` in `package.json` runs `swc src tests -d build --extensions .ts` plus `scripts/post-build.ts`.
- Typecheck: `npm run typecheck` runs `tsc --noEmit` with `tsconfig.json`.
- Formatting: `npm run format` and `npm run check-format` use `eslint.config.mjs` and `.prettierrc.cjs`.
- Package binaries: `js-reverse` maps to `build/src/bin/js-reverse.js`; `js-reverse-worker` maps to `build/src/index.js` in `package.json`.
- No `rollup.config.mjs` is present even though `package.json` contains a `bundle` script referencing it; verify before using `npm run bundle`.

## Platform Requirements

**Development:**
- Use Node 22 for local work to match `.nvmrc`, while respecting the broader engine range in `package.json`.
- Run `npm install` or `npm ci` with `package-lock.json`.
- Chrome or Chromium is required for browser automation through `src/browser/browser.ts`; remote debugging can be provided through `--browserUrl`, `--wsEndpoint`, `BROWSER_URL`, or `BROWSER_WS_ENDPOINT`.
- Sekiro server is required for CLI worker action routing; defaults are `DEFAULT_SEKIRO_HOST = 'ws://127.0.0.1:5612'` and `DEFAULT_GROUP = 'js-reverse'` in `src/config.ts`.
- Optional PostgreSQL is enabled only when `--databaseUrl` or `DATABASE_URL` is provided.

**Production:**
- Runtime artifact is the compiled `build/` tree generated from `src/` and `tests/`.
- Worker mode runs `build/src/index.js` and registers actions against Sekiro via `src/protocol/Client.ts`.
- CLI mode runs `build/src/bin/js-reverse.js` and delegates tool calls through `src/cli/sekiro-invoker.ts`.
- HTTP mode is documented in `docs/guides/http-mode.md` and CLI options exist in `src/cli.ts`, but current worker entry `src/index.ts` does not implement an Express or MCP Streamable HTTP listener.

---

*Stack analysis: 2026-04-27*
