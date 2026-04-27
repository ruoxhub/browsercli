# Codebase Concerns

**Analysis Date:** 2026-04-27

## Tech Debt

**Patchright/Puppeteer API migration is incomplete:**
- Issue: Current code mixes Patchright types with Puppeteer-style APIs such as `browser.pages()`, `targetcreated`, `target.page()`, `page._client()`, `networkidle2`, and multi-argument `page.evaluate(...)` calls.
- Files: `src/modules/collector/CodeCollector.ts`, `src/modules/collector/PageCollector.ts`, `src/modules/collector/DOMInspector.ts`, `src/tools/network/WebSocketCollector.ts`, `src/tools/page/scrollBy.ts`, `src/tools/screenshot/takeScreenshot.ts`, `src/tools/dom/WaitForHelper.ts`
- Impact: `npm run typecheck` currently fails with 185 TypeScript errors, so type safety cannot protect browser automation changes.
- Fix approach: Standardize runtime abstractions around Patchright APIs, wrap CDP access behind a typed adapter, and update tests to use the same runtime interfaces.

**Historical flat tool modules still referenced by tests and coverage:**
- Issue: Tests and coverage config reference legacy files such as `src/tools/dom.js`, `src/tools/page.js`, `src/tools/runtime.js`, `src/tools/analyzer.js`, `src/tools/categories.js`, and `src/tools/ToolRegistry.js`, while current source is organized into subdirectories.
- Files: `tests/unit/tools/jshook-tools.test.ts`, `tests/unit/tools/jshook-tools.handlers.test.ts`, `tests/property/jshook-tools.property.test.ts`, `tests/unit/tools/ToolRegistry.test.ts`, `tests/unit/tools/ToolDefinition.extended.test.ts`, `package.json`
- Impact: Typecheck and likely built test execution fail before behavioral regressions are detected.
- Fix approach: Either add compatibility barrels with the old public API or migrate tests and coverage includes to the current files under `src/tools/*/`.

**Removed AI providers are still in tests and coverage:**
- Issue: Source exports only `AIService`, `LLMService`, and `OpenAIProvider`, but tests still import `GeminiProvider` and `AnthropicProvider`.
- Files: `src/services/index.ts`, `tests/unit/services/GeminiProvider.test.ts`, `tests/unit/services/GeminiProvider.extended.test.ts`, `tests/unit/services/AnthropicProvider.test.ts`, `tests/unit/services/AnthropicProvider.mocked.test.ts`, `tests/property/AIService.property.test.ts`, `tests/integration/gemini-cli.integration.test.ts`, `package.json`
- Impact: Service-layer tests are out of sync with the implementation and coverage includes `build/src/services/GeminiProvider.js`, which no longer maps to current source.
- Fix approach: Restore providers intentionally or remove/replace provider-specific tests and coverage targets with OpenAI-only coverage.

**Large multi-responsibility files are difficult to review safely:**
- Issue: Several files combine parsing, transformation, runtime orchestration, registration metadata, and state management in single modules.
- Files: `src/modules/analyzer/CodeAnalyzer.ts` (1979 lines), `src/modules/deobfuscator/Deobfuscator.ts` (1536 lines), `src/modules/deobfuscator/AdvancedDeobfuscator.ts` (1316 lines), `src/modules/collector/CodeCollector.ts` (1285 lines), `src/cli/tools-meta.ts` (1228 lines), `src/modules/debugger/DebuggerManager.ts` (1165 lines), `src/tools/workflow/autoHook.ts` (1071 lines), `src/browser/browser.ts` (1027 lines)
- Impact: Changes in these files have broad blast radius, make targeted tests harder to write, and increase merge conflict risk.
- Fix approach: Extract cohesive pure helpers first, keep public tool handlers stable, and add regression tests around each extracted behavior before further cleanup.

**Stubbed third-party and runtime services hide missing behavior:**
- Issue: Some interfaces are implemented as no-op stubs to satisfy type checking or keep runtime plumbing moving.
- Files: `src/third_party/stubs.ts`, `src/worker/ToolContextProvider.ts`
- Impact: Console and WebSocket collection paths can silently return empty data or throw "not integrated" errors even when tool metadata suggests the capability exists.
- Fix approach: Replace stubs with explicit capability flags or real adapters, and make unsupported tools return structured "not available" responses.

## Known Bugs

**Typecheck fails on current repository state:**
- Symptoms: `npm run typecheck` exits non-zero with 185 `error TS` diagnostics.
- Files: `tsconfig.json`, `src/modules/collector/DOMInspector.ts`, `src/modules/collector/PageCollector.ts`, `src/tools/network/WebSocketCollector.ts`, `src/tools/page/scrollBy.ts`, `tests/unit/tools/jshook-tools.test.ts`, `tests/unit/services/GeminiProvider.test.ts`
- Trigger: Run `npm run typecheck`.
- Workaround: `npm run build` uses SWC and does not perform TypeScript semantic checking, but this bypasses the type errors rather than fixing them.

**Sekiro `_execjs` executes remote-provided JavaScript in-process:**
- Symptoms: Incoming WebSocket requests for `_execjs` are converted into `new Function(...)` and executed in the Node worker process.
- Files: `src/protocol/sekiro.ts`
- Trigger: A connected Sekiro server sends a request with `param`, `params`, or `code` for `_execjs`.
- Workaround: Do not connect to untrusted Sekiro servers; restrict `SEKIRO_HOST` to trusted local or controlled endpoints.

**Session restore can drop cookie attributes:**
- Symptoms: Restore maps stored cookies to `{name, value, domain, path}` only, omitting attributes such as expiry, httpOnly, secure, and sameSite.
- Files: `src/tools/page/sessionState.ts`, `src/tools/page/types.ts`
- Trigger: Save a cookie-bearing session and restore it into a browser context.
- Workaround: Use session restore only for lightweight debugging sessions where exact cookie attributes are not required.

**Worker process state depends on a single temp PID file:**
- Symptoms: A stale or reused PID in the temp runtime directory can make the CLI believe an unrelated process is the worker.
- Files: `src/cli/worker-manager.ts`
- Trigger: Worker exits unexpectedly, temp files are preserved, or the operating system reuses the PID.
- Workaround: Manually remove the PID file under the runtime directory if CLI status/stop commands become inconsistent.

## Security Considerations

**Session dumps can write sensitive browser state in plaintext:**
- Risk: Cookies, localStorage, and sessionStorage may include authentication material. Encryption is optional and disabled unless requested with a configured key.
- Files: `src/tools/page/sessionState.ts`, `src/tools/page/types.ts`, `src/config.ts`, `src/utils/fsSafe.ts`
- Current mitigation: `SESSION_STATE_ENCRYPTION_KEY` enables AES-256-GCM encryption when `encrypt=true`; `validateOutputPath()` restricts relative paths to `JSREVERSER_OUTPUT_DIR` or the current working directory.
- Recommendations: Default file dumps containing cookies/storage to encrypted output, redact sensitive keys in summaries, and disallow absolute output paths unless an explicit trusted-output flag is set.

**Absolute output paths bypass the output directory boundary:**
- Risk: `validateOutputPath()` allows absolute paths as-is under the dev-tool trust model.
- Files: `src/utils/fsSafe.ts`, `src/tools/page/sessionState.ts`
- Current mitigation: Relative traversal outside the allowed base is blocked.
- Recommendations: Require absolute paths to be inside `JSREVERSER_OUTPUT_DIR` by default, with an opt-in escape hatch for local debugging.

**Browser launch arguments weaken browser protections:**
- Risk: Stealth mode disables or downgrades protections such as safe browsing auto-update and cookie encryption.
- Files: `src/browser/stealth-args.ts`, `src/browser/browser.ts`
- Current mitigation: These flags are scoped to launched automation browsers.
- Recommendations: Keep stealth flags disabled by default for general debugging, document the risk in CLI help, and add tests that verify dangerous flags are only applied when stealth mode is explicitly enabled.

**Dynamic code execution exists in multiple deobfuscation and rebuild paths:**
- Risk: Untrusted input passed to deobfuscation or scaffolded rebuild helpers may execute code in the Node process or generated bundle.
- Files: `src/tools/vjstools/deobfuscate.ts`, `src/modules/deobfuscator/PackerDeobfuscator.ts`, `src/modules/deobfuscator/JSVMPDeobfuscator.ts`, `src/tools/rebuild/rebuildFn.ts`, `src/tools/workflow/rebuildBundle.ts`, `tests/bin/scaffold.test.ts`
- Current mitigation: Some execution is intentional for reverse-engineering workflows, and tests cover detection/scaffold behavior.
- Recommendations: Isolate execution in a sandboxed process or VM context, add clear "trusted input only" flags to tool schemas, and avoid implicit evaluation in automatic modes.

**Configuration can load secrets from multiple locations:**
- Risk: API keys and database URLs can be read from environment variables, root `config.json`, project config, user config, and `.env`, increasing accidental commit or log exposure risk.
- Files: `src/config.ts`, `.env.example`, `config.json`
- Current mitigation: `.env` is present locally but should not be read or committed; the mapper did not inspect secret values.
- Recommendations: Ensure `config.json` contains no secrets before commits, prefer environment injection, and add a pre-commit secret scan for `OPENAI_API_KEY`, `DATABASE_URL`, and `SESSION_STATE_ENCRYPTION_KEY`.

## Performance Bottlenecks

**Network request storage is in-memory and bounded only by navigation groups:**
- Problem: Request collection stores each request object in arrays per page and keeps up to three navigation groups.
- Files: `src/worker/ToolContextProvider.ts`, `src/modules/collector/PageCollector.ts`, `src/tools/network/WebSocketCollector.ts`
- Cause: There are no byte-size limits, request-count caps, or payload sampling controls in the storage maps.
- Improvement path: Add per-page request and WebSocket frame limits, expose truncation metadata, and allow users to disable collection for high-volume sessions.

**Code collection caches large site assets in memory:**
- Problem: The collector is designed to collect all files into cache and limit only response output.
- Files: `src/modules/collector/CodeCollector.ts`, `src/modules/collector/CodeCache.ts`, `src/modules/collector/CodeCompressor.ts`
- Cause: `collectedFilesCache` and related collection limits are implemented inside a large stateful collector instead of a shared bounded cache policy.
- Improvement path: Enforce global cache size and file-count ceilings, evict by LRU or task scope, and add performance tests for large sites.

**AST deobfuscation uses repeated parse/traverse/generate passes:**
- Problem: Deobfuscation reparses generated code and repeatedly traverses large ASTs, with some evaluation loops capped at 50 iterations.
- Files: `src/tools/vjstools/deobfuscate.ts`, `src/modules/deobfuscator/Deobfuscator.ts`, `src/modules/deobfuscator/AdvancedDeobfuscator.ts`, `src/modules/deobfuscator/JSVMPDeobfuscator.ts`
- Cause: Transformation passes are chained imperatively without a shared pass scheduler or size budget.
- Improvement path: Add input size limits, pass timing metrics, and bailout reasons; split pure transform passes into benchmarkable units.

**Performance tests are opt-in and not part of default test runs:**
- Problem: Performance suites run only when `RUN_PERF_TESTS=true`.
- Files: `package.json`, `tests/performance/baseline.test.ts`, `tests/performance/jshook-performance.test.ts`
- Cause: Default `npm test` prioritizes unit/integration execution and skips perf suites unless explicitly enabled.
- Improvement path: Keep heavy perf tests opt-in, but add lightweight budget tests for request storage, deobfuscation input size, and session dump size.

## Fragile Areas

**Browser runtime adapters:**
- Files: `src/browser/browser.ts`, `src/worker/ToolContextProvider.ts`, `src/modules/collector/PageCollector.ts`, `src/tools/shared/browserRuntime.ts`
- Why fragile: Tool handlers depend on a mix of selected page/frame state, weak-map storage, CDP sessions, and browser context lifecycle events.
- Safe modification: Add integration tests around page switching, navigation, page close cleanup, and CDP detach before changing listener or state-management code.
- Test coverage: Browser-dependent tests are often skipped unless specific environment flags are enabled.

**Tool metadata and handler registration:**
- Files: `src/cli/tools-meta.ts`, `src/worker/ToolAdapter.ts`, `src/tools/hook.ts`, `src/tools/*/index.ts`
- Why fragile: Metadata, schema shape, handler exports, and tests are not all generated from one source of truth.
- Safe modification: Treat tool registration as an API contract; update metadata, handler exports, and tests in the same change.
- Test coverage: Existing tests expect legacy `.schema`, `.handler`, and flat module contracts in several places.

**Configuration precedence and secret-bearing config:**
- Files: `src/config.ts`, `.env.example`, `config.json`
- Why fragile: Runtime behavior changes depending on CLI args, environment variables, root config, project config, user config, and defaults.
- Safe modification: Add table-driven tests for precedence before changing config keys or defaults.
- Test coverage: Config parsing has CLI tests, but end-to-end coverage for all precedence combinations is limited.

**Decompiler/evaluator modules:**
- Files: `src/tools/vjstools/deobfuscate.ts`, `src/modules/deobfuscator/PackerDeobfuscator.ts`, `src/modules/deobfuscator/JSVMPDeobfuscator.ts`
- Why fragile: Many transformations catch and ignore errors, and several paths intentionally evaluate generated snippets.
- Safe modification: Use corpus-based fixture tests and snapshot before/after output for each transform family.
- Test coverage: Unit tests exist for deobfuscators, but sandboxing and hostile-input behavior need stronger coverage.

## Scaling Limits

**Single-process worker execution:**
- Current capacity: One `WorkerManager` controls one worker PID through a temp file.
- Limit: Concurrent independent worker sessions are not represented by the current PID model.
- Scaling path: Introduce named worker instances with per-instance runtime dirs and structured status files.

**In-memory session snapshots:**
- Current capacity: Session snapshots live in a process-local `Map` with TTL cleanup.
- Limit: Snapshots are lost on restart and may grow with cookie/storage size until TTL cleanup runs.
- Scaling path: Add max snapshot count/bytes, explicit redaction, and optional encrypted persistence behind a configured storage directory.

**Code intelligence and deobfuscation input size:**
- Current capacity: Large code strings are parsed in-process using Babel/Terser flows.
- Limit: Very large or intentionally hostile JavaScript can consume CPU and memory during repeated AST passes or evaluation.
- Scaling path: Run heavy transforms in worker threads or child processes with timeouts, memory limits, and cancel support.

## Dependencies at Risk

**Patchright browser API:**
- Risk: Current type errors show active mismatch between source assumptions and Patchright's typed API.
- Impact: Browser automation, collectors, navigation, screenshots, and emulation tools are the highest-risk areas.
- Migration plan: Centralize Patchright wrappers and remove direct Puppeteer-specific calls from feature modules.

**chrome-devtools-frontend runtime internals:**
- Risk: `src/modules/collector/PageCollector.ts` dynamically requires `chrome-devtools-frontend/mcp/mcp.js` and uses internal issue aggregation objects.
- Impact: Upstream packaging or internal API changes can break console/issue collection at runtime.
- Migration plan: Isolate DevTools frontend imports in one adapter and keep graceful fallback behavior when the module shape changes.

**Generated or third-party stubs:**
- Risk: `src/third_party/stubs.ts` returns empty/no-op behavior for selected APIs.
- Impact: Callers can receive plausible empty results instead of a clear unsupported-capability error.
- Migration plan: Replace stubs with typed facades that explicitly distinguish unsupported, unavailable, and empty-result states.

## Missing Critical Features

**Reliable typecheck gate:**
- Problem: The repository cannot currently pass `npm run typecheck`.
- Blocks: Safe refactoring, CI confidence, and downstream use of TypeScript as a regression detector.

**Consistent public compatibility layer for legacy tool modules:**
- Problem: Tests still expect old flat tool module exports while implementation moved into feature directories.
- Blocks: Test suite stabilization and external consumers that may import legacy paths.

**Sandboxed execution for untrusted JavaScript analysis:**
- Problem: Reverse-engineering workflows need to inspect hostile JavaScript, but some analysis paths execute snippets in-process.
- Blocks: Safer handling of third-party samples and automated deobfuscation of untrusted code.

**Secret redaction policy for artifacts and session dumps:**
- Problem: Session state, hook output, network data, and rebuild artifacts can include cookies, tokens, and storage values.
- Blocks: Safe sharing of `artifacts/tasks/*` outputs and public case creation.

## Test Coverage Gaps

**Typecheck is failing, so test coverage cannot be trusted as a quality gate:**
- What's not tested: Current source/test compatibility under TypeScript semantics.
- Files: `tsconfig.json`, `package.json`, `tests/unit/services/GeminiProvider.test.ts`, `tests/unit/tools/jshook-tools.test.ts`, `src/modules/collector/DOMInspector.ts`
- Risk: SWC can emit build output while type errors and stale imports remain.
- Priority: High

**Several integration and browser suites are skipped by default:**
- What's not tested: Daemon start/stop, browser manager behavior, E2E hook scenarios, Gemini CLI integration, and performance budgets in default runs.
- Files: `tests/daemon/daemon-start.test.ts`, `tests/integration/jshook-e2e.integration.test.ts`, `tests/integration/gemini-cli.integration.test.ts`, `tests/property/browser-manager.property.test.ts`, `tests/performance/baseline.test.ts`
- Risk: Browser lifecycle and external-tool regressions can ship unnoticed.
- Priority: High

**Session dump security behavior needs broader negative tests:**
- What's not tested: Absolute path policy, plaintext dump defaults, redaction expectations, malformed encrypted payloads, and restore fidelity for cookie attributes.
- Files: `src/tools/page/sessionState.ts`, `tests/unit/tools/jshook-tools.handlers.test.ts`, `src/utils/fsSafe.ts`
- Risk: Sensitive browser state can be persisted or restored incorrectly.
- Priority: High

**Worker lifecycle edge cases need process-isolation tests:**
- What's not tested: Stale PID files, PID reuse, worker startup timeout cleanup, and Windows shell/spawn behavior.
- Files: `src/cli/worker-manager.ts`, `tests/daemon/cli.test.ts`, `tests/daemon/daemon-start.test.ts`
- Risk: CLI commands may manage the wrong process or leave broken runtime state.
- Priority: Medium

**Runtime service stubs need contract tests:**
- What's not tested: Whether tools backed by `ToolContextProvider` return explicit unsupported responses instead of silent empty arrays.
- Files: `src/worker/ToolContextProvider.ts`, `src/third_party/stubs.ts`, `tests/unit/worker/ToolAdapter.test.ts`
- Risk: Users receive successful-looking empty output for missing integrations.
- Priority: Medium

---

*Concerns audit: 2026-04-27*
