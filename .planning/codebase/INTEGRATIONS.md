# External Integrations

**Analysis Date:** 2026-04-27

## APIs & External Services

**LLM APIs:**
- OpenAI - AI-assisted code analysis, image analysis, deobfuscation guidance, crypto detection prompts, and taint-analysis prompt execution.
  - SDK/Client: `openai` package in `src/services/OpenAIProvider.ts`.
  - Auth: `OPENAI_API_KEY`; optional `OPENAI_BASE_URL` and `OPENAI_MODEL`.
  - Wiring: `src/config.ts` creates `AIService` with `OpenAIProvider`; `src/services/LLMService.ts` calls the configured service.
- Anthropic - Documented and declared dependency, but not implemented in current `src/services/`.
  - SDK/Client: `@anthropic-ai/sdk` is declared in `package.json`.
  - Auth: docs mention `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, and `ANTHROPIC_BASE_URL` in `docs/guides/llm-provider-config.md`.
  - Current state: no `src/services/AnthropicProvider.ts` exists; do not assume production support without adding source wiring.
- Gemini - Documented and tested as legacy or planned behavior, but not implemented in current `src/services/`.
  - SDK/Client: no Gemini SDK package is declared; tests reference a missing `src/services/GeminiProvider.ts`.
  - Auth: docs mention `GEMINI_API_KEY`, `GEMINI_MODEL`, and `GEMINI_CLI_PATH` in `docs/guides/llm-provider-config.md`.
  - Current state: no `src/services/GeminiProvider.ts` exists; do not assume production support without adding source wiring.

**Browser & DevTools:**
- Chrome / Chromium remote debugging - Browser observation, automation, script evaluation, CDP sessions, network capture, screenshots, input, and performance tracing.
  - SDK/Client: `patchright` in `src/browser/browser.ts` and re-exported types from `src/third_party/playwright.ts`.
  - Auth: none by default; optional `--wsHeaders` JSON is parsed in `src/cli.ts` for WebSocket endpoint connections.
  - Config: `--browserUrl`, `--wsEndpoint`, `BROWSER_URL`, `BROWSER_WS_ENDPOINT`, `REMOTE_DEBUGGING_URL`, `REMOTE_DEBUGGING_PORT`, `BROWSER_EXECUTABLE_PATH`, `BROWSER_CHANNEL`, `BROWSER_HEADLESS`, `BROWSER_ISOLATED`, `USE_STEALTH_SCRIPTS`.
- `chrome-devtools-frontend` - Trace parsing and DevTools compatibility modules.
  - SDK/Client: optional dependency `chrome-devtools-frontend` in `package.json`; imports appear in `src/trace-processing/parse.ts` and `src/modules/collector/PageCollector.ts`.
  - Auth: none.

**RPC & Tool Routing:**
- Sekiro server - Worker registration, action dispatch, CLI invocation, and online client/group discovery.
  - SDK/Client: custom WebSocket client in `src/protocol/sekiro.ts`; CLI HTTP invoker in `src/cli/sekiro-invoker.ts`.
  - Auth: none detected in current implementation.
  - Config: `SEKIRO_HOST`, `SEKIRO_GROUP`, `--sekiroHost`, `--group`.
  - Endpoints: WebSocket registration at `/business/register`; HTTP calls to `/business/invoke`, `/business/clientQueue`, and `/business/groupQueue`.

**Local HTTP Test Utilities:**
- Debugger lab server - Local development site with HTTP and WebSocket endpoints for tool verification.
  - SDK/Client: Node `http` module and `ws` `WebSocketServer` in `scripts/debugger-lab/server.mjs`.
  - Auth: none.
  - Config: CLI `--host` and `--port` accepted by `scripts/debugger-lab/server.mjs`.

## Data Storage

**Databases:**
- PostgreSQL - Optional site experience storage.
  - Connection: `DATABASE_URL` or CLI `--databaseUrl`.
  - Client: `pg` pool in `src/services/DatabaseService.ts`; `drizzle-orm/node-postgres` query layer in `src/services/DatabaseService.ts`.
  - Schema: `site_experiences` table in `src/database/schema.ts`.
  - Migration: `DatabaseService.migrate()` creates `site_experiences` and indexes in `src/services/DatabaseService.ts`.

**File Storage:**
- Local filesystem artifacts - Reverse task evidence, snapshots, and JSONL logs.
  - Implementation: `src/reverse/ReverseTaskStore.ts`.
  - Default location: resolved through `resolveDefaultArtifactsTasksDir()` in `src/utils/projectPaths.ts`, with templates under `artifacts/tasks/_TEMPLATE/`.
- Local worker runtime state - Worker PID tracking.
  - Implementation: `src/cli/worker-manager.ts`.
  - Location: OS temp directory plus `RUNTIME_DIR_NAME` from `src/config.ts`.
- Browser session state - Save, restore, dump, and load tools are implemented in `src/tools/page/sessionState.ts`.

**Caching:**
- In-process and local code/data cache utilities are present in `src/utils/UnifiedCacheManager.ts`, `src/utils/CacheAdapters.ts`, `src/modules/collector/CodeCache.ts`, and `src/modules/collector/CodeCompressor.ts`.
- External cache service: None detected.

## Authentication & Identity

**Auth Provider:**
- Custom / none for core CLI and worker routing.
  - Implementation: Sekiro action routing identifies workers by `group` and generated `clientId` in `src/protocol/Client.ts`.
  - Browser session state is handled as target-site state through page storage/cookies in `src/tools/page/sessionState.ts`; the project does not implement an application auth provider.
- External LLM auth uses API key environment variables.
  - Implementation: `OPENAI_API_KEY` is consumed by `src/config.ts` and passed to `src/services/OpenAIProvider.ts`.

## Monitoring & Observability

**Error Tracking:**
- None detected. No Sentry, OpenTelemetry, Honeycomb, Datadog, or similar service is configured in `package.json` or `src/`.

**Logs:**
- Console logging is used by worker and Sekiro flows in `src/index.ts`, `src/protocol/Client.ts`, and `src/protocol/sekiro.ts`.
- Project logger utility is used in services and modules through `src/utils/logger.ts`.
- Debug logging is configured through `DEBUG`, `JSREVERSER_DEBUG`, and CLI `--logFile` parsing in `src/cli.ts`.

## CI/CD & Deployment

**Hosting:**
- No hosted deployment target detected in repository configuration.
- Docker usage is documented as an example in `docs/guides/http-mode.md`, but no `Dockerfile` is present at the repository root.
- Runtime is intended to run locally or as a long-lived Node worker process connected to a Sekiro server.

**CI Pipeline:**
- None detected. No `.github/workflows/` files are present.
- Local verification commands are defined in `package.json`: `npm run build`, `npm test`, `npm run test:unit`, `npm run test:integration`, `npm run test:property`, `npm run test:perf`, `npm run typecheck`, and `npm run check-format`.

## Environment Configuration

**Required env vars:**
- Core worker defaults require no env vars if CLI arguments and local defaults are acceptable.
- `SEKIRO_HOST` - Optional override for Sekiro WebSocket server.
- `SEKIRO_GROUP` - Optional worker action group.
- `OPENAI_API_KEY` - Required only for current AI provider functionality.
- `OPENAI_BASE_URL` - Optional custom OpenAI-compatible endpoint.
- `OPENAI_MODEL` - Optional model override.
- `DATABASE_URL` - Optional PostgreSQL storage.
- `BROWSER_URL` or `BROWSER_WS_ENDPOINT` - Optional existing Chrome remote debugging target.
- `BROWSER_HEADLESS`, `BROWSER_EXECUTABLE_PATH`, `BROWSER_CHANNEL`, `BROWSER_ISOLATED`, `USE_STEALTH_SCRIPTS`, `REMOTE_DEBUGGING_URL`, `REMOTE_DEBUGGING_PORT` - Optional browser behavior controls.
- `JSREVERSER_RUNTIME_DIR`, `JSREVERSER_OUTPUT_DIR`, `SESSION_STATE_TTL_MS`, `SESSION_STATE_CLEANUP_INTERVAL_MS`, `SESSION_STATE_ENCRYPTION_KEY`, `LOG_LEVEL`, `DEBUG`, `JSREVERSER_DEBUG` - Optional runtime, session, and logging controls.

**Secrets location:**
- Prefer MCP client env injection as documented in `docs/guides/client-configuration.md` and `docs/guides/llm-provider-config.md`.
- `.env` file is present and loaded by `src/config.ts` for local direct runs; do not read or commit real secret values.
- `config.json` is present and participates in configuration precedence through `src/config.ts`; treat it as potentially sensitive when documenting or committing.
- User-level config path is `~/.jsreverserrc.json`, resolved by `getUserConfigPath()` in `src/config.ts`.

## Webhooks & Callbacks

**Incoming:**
- Sekiro WebSocket worker callback channel: `src/protocol/sekiro.ts` receives action messages from Sekiro and dispatches registered handlers from `src/worker/ToolAdapter.ts`.
- Sekiro HTTP invoke path is consumed indirectly by CLI through `src/cli/sekiro-invoker.ts`; the repository does not implement the Sekiro server itself.
- Documented MCP HTTP endpoint `/mcp` appears in `docs/guides/http-mode.md`, but no current `src/` implementation of an Express or MCP Streamable HTTP listener was detected.

**Outgoing:**
- OpenAI Chat Completions requests from `src/services/OpenAIProvider.ts`.
- Chrome DevTools HTTP discovery calls to `/json/version` from `src/browser/browser.ts` and `src/cli/commands/start.ts`.
- Chrome/DevTools WebSocket connections through `patchright` and optional `--wsEndpoint` usage.
- Sekiro HTTP calls to `/business/invoke`, `/business/clientQueue`, and `/business/groupQueue` from `src/cli/sekiro-invoker.ts`.
- Sekiro WebSocket registration and heartbeat from `src/protocol/Client.ts` and `src/protocol/sekiro.ts`.
- Optional PostgreSQL connections from `src/services/DatabaseService.ts`.

---

*Integration audit: 2026-04-27*
