# Testing Patterns

**Analysis Date:** 2026-04-27

## Test Framework

**Runner:**
- Node.js built-in `node:test` runner.
- Version source: Node engine range is defined in `package.json` as `^20.19.0 || ^22.12.0 || >=23`.
- Config: no separate Jest/Vitest config detected; test commands are defined in `package.json`, global setup is `tests/setup.ts`, and TypeScript is compiled to `build/tests/` before execution.

**Assertion Library:**
- Use Node built-in `node:assert` and `node:assert/strict`; examples are `tests/unit/utils/errors.test.ts`, `tests/unit/functions/crypto.test.ts`, and `tests/performance/baseline.test.ts`.
- Use `fast-check` for property tests in `tests/property/*.property.test.ts`, including `tests/property/ToolRegistry.property.test.ts` and `tests/property/AIService.property.test.ts`.
- `sinon` is available in `package.json`, but common tests prefer `node:test` `mock.fn`, hand-written fakes, or direct dependency replacement.

**Run Commands:**
```bash
npm test              # Build, load build/tests/setup.js, then run build/tests/**/*.test.js
npm run test:unit     # Build and run build/tests/unit/**/*.test.js
npm run test:quick    # Build and run selected unit test folders for tools/services/utils
npm run test:property # Build and run build/tests/property/**/*.test.js
npm run test:integration # Build and run build/tests/integration/**/*.test.js
npm run test:perf     # Build with RUN_PERF_TESTS=true and run build/tests/performance/**/*.test.js
npm run coverage      # Run coverage:core
npm run coverage:strict # Run c8 over all unit and property tests
npm run test:only     # Build and run tests marked with .only
npm run test:only:no-build # Run build/tests/**/*.test.js without rebuilding
```

## Test File Organization

**Location:**
- Unit tests live under `tests/unit/` and should mirror source structure, as shown by `src/services/OpenAIProvider.ts` and `tests/unit/services/OpenAIProvider.mocked.test.ts`.
- Integration tests live under `tests/integration/`, as shown by `tests/integration/gemini-cli.integration.test.ts` and `tests/integration/jshook-e2e.integration.test.ts`.
- Property tests live under `tests/property/`, as shown by `tests/property/AIService.property.test.ts` and `tests/property/error-handling.property.test.ts`.
- Performance tests live under `tests/performance/`, as shown by `tests/performance/baseline.test.ts` and `tests/performance/jshook-performance.test.ts`.
- CLI/bin and daemon tests have dedicated folders such as `tests/bin/` and `tests/daemon/`.
- Manual scripts live under `tests/manual/` and are not part of normal automated test commands.

**Naming:**
- Use `*.test.ts` for unit, daemon, CLI, and performance tests, as in `tests/unit/utils/errors.test.ts`.
- Use `*.integration.test.ts` for integration tests, as in `tests/integration/gemini-cli.integration.test.ts`.
- Use `*.property.test.ts` for property tests, as in `tests/property/ToolRegistry.property.test.ts`.
- Use `.mocked.test.ts` when the test replaces external dependencies or internal clients, as in `tests/unit/services/OpenAIProvider.mocked.test.ts` and `tests/unit/browser/BrowserManager.mocked.test.ts`.
- Use `.extended.test.ts` for branch-expansion coverage of an existing module, as in `tests/unit/modules/HookManager.extended.test.ts`.

**Structure:**
```
tests/
├── setup.ts                  # Global test environment setup
├── unit/                     # Isolated module tests mirroring src/
├── integration/              # Tests requiring real subprocesses or integration flows
├── property/                 # fast-check property tests
├── performance/              # Baseline and threshold tests, usually gated by env vars
├── bin/                      # CLI binary tests
├── daemon/                   # Daemon/client lifecycle tests
└── manual/                   # Manually executed exploratory scripts
```

## Test Structure

**Suite Organization:**
```typescript
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {ErrorCodes, formatError} from '../../../src/utils/errors.js';

describe('error formatting', () => {
  it('formats Error instances', () => {
    const result = formatError(new Error('boom'), ErrorCodes.TOOL_EXECUTION_ERROR, {
      tool: 'x',
    });

    assert.strictEqual(result.code, ErrorCodes.TOOL_EXECUTION_ERROR);
    assert.strictEqual(result.type, 'Error');
    assert.strictEqual(result.message, 'boom');
  });
});
```

**Patterns:**
- Import `describe`, `it`, and hooks from `node:test`; examples include `tests/unit/utils/config.test.ts` and `tests/integration/gemini-cli.integration.test.ts`.
- Group tests by module first and behavior second; `tests/unit/functions/crypto.test.ts` nests `describe('hookCryptoJS')`, `describe('hookJSEncrypt')`, and `describe('hookSMCrypto')`.
- Use direct assertions from `node:assert`, including `strictEqual`, `deepStrictEqual`, `ok`, `match`, `doesNotMatch`, `throws`, and `rejects`.
- Use async test functions for promises and browser/provider operations, as in `tests/unit/tools/navigation/navigatePage.test.ts`.
- Gate slow or external tests with env-driven suite skip options, as in `describe('Performance Baseline', {skip: !runPerf}, ...)` in `tests/performance/baseline.test.ts`.
- Use `beforeEach`/`afterEach` to isolate global state such as `process.env`; `tests/unit/utils/config.test.ts` snapshots and restores `process.env`.

## Mocking

**Framework:** Prefer `node:test` `mock.fn` and hand-written fakes; use direct dependency replacement for hard-to-inject modules.

**Patterns:**
```typescript
import {strict as assert} from 'node:assert';
import {describe, it, mock} from 'node:test';

import type {Frame} from '../../../src/third_party/index.js';

it('calls frame.evaluate', async () => {
  const evaluate = mock.fn(async () => undefined);
  const frame = {evaluate} as unknown as Frame;

  await hookCryptoJS(frame);

  assert.strictEqual(evaluate.mock.callCount(), 1);
});
```

**What to Mock:**
- Mock browser/page/frame objects with minimal typed fakes for tool functions, as in `tests/unit/tools/navigation/navigatePage.test.ts` and `tests/unit/functions/crypto.test.ts`.
- Mock external AI clients by replacing provider client fields in harness types, as in `tests/unit/services/OpenAIProvider.mocked.test.ts`.
- Mock filesystem/process boundaries only within tightly scoped `try/finally` restoration blocks, as in `tests/unit/logger/root-logger.test.ts`.
- Mock providers through the `AIProvider` interface for service-level tests, as in `tests/property/AIService.property.test.ts`.
- Use env vars to skip true external integrations such as Gemini CLI and browser-dependent flows, as in `tests/integration/gemini-cli.integration.test.ts` and `tests/property/browser-manager.property.test.ts`.

**What NOT to Mock:**
- Do not mock pure utilities such as `formatError` from `src/utils/errors.ts` or `parseArgs` from `src/cli/args-parser.ts`; assert deterministic outputs directly.
- Do not call real external provider APIs in unit tests; use mocked provider clients and avoid real API key values.
- Do not depend on a real browser or real CLI in default test commands; guard these paths with `RUN_BROWSER_TESTS`, `RUN_E2E_TESTS`, or `RUN_GEMINI_CLI_TESTS`.
- Do not leave global mutations active after tests; restore `process.env`, `process.exit`, `console.error`, `fs.createWriteStream`, and `process.cwd` when modified.

## Fixtures and Factories

**Test Data:**
```typescript
function createNavigationRuntime(
  overrides: Partial<NavigationRuntimeServices> = {},
): NavigationRuntimeServices {
  return {
    getPages: () => [],
    getPageByIdx: () => {
      throw new Error('unused');
    },
    getSelectedPageIndex: () => null,
    getSelectedPage: () => null,
    newPage: async () => createPage() as unknown as Page,
    selectPage: () => undefined,
    bringPageToFront: async () => undefined,
    ...overrides,
  };
}
```

**Location:**
- Keep small fixtures and factories inside the test file that uses them, as in `tests/unit/tools/navigation/navigatePage.test.ts`.
- Use temporary OS directories for filesystem tests through `node:os` `tmpdir` or `mkdtemp`, as in `tests/unit/reverse/ReverseTaskStore.test.ts` and `tests/unit/functions/rebuild.test.ts`.
- Put cross-test setup only in `tests/setup.ts`; it currently sets `NODE_ENV` to `test` and silences noisy console methods unless `DEBUG` is present.
- Keep manual scripts under `tests/manual/`, as in `tests/manual/test-gemini-provider.ts` and `tests/manual/test-browser-manager.ts`.

## Coverage

**Requirements:** `tests/README.md` states an 80% coverage aim. `package.json` provides `coverage`, `coverage:core`, and `coverage:strict` scripts using `c8`.

**View Coverage:**
```bash
npm run coverage        # c8 over selected core build/src modules plus unit/property tests
npm run coverage:strict # c8 over all unit and property tests with lcov output
```

**Coverage Scope:**
- `coverage:core` in `package.json` includes specific build outputs: `build/src/tools/dom.js`, `build/src/tools/hook.js`, `build/src/tools/runtime.js`, `build/src/tools/stealth.js`, `build/src/services/AIService.js`, `build/src/services/GeminiProvider.js`, and `build/src/services/LLMService.js`.
- `coverage:strict` in `package.json` covers all `build/tests/unit/**/*.test.js` and `build/tests/property/**/*.test.js`.
- Coverage reports use `text` and `lcov` reporters through `c8` in `package.json`.

## Test Types

**Unit Tests:**
- Scope individual modules, tools, services, and utilities.
- Place under `tests/unit/` and mirror `src/` paths where practical.
- Use isolated fakes for external dependencies, as in `tests/unit/services/OpenAIProvider.mocked.test.ts`, `tests/unit/tools/navigation/navigatePage.test.ts`, and `tests/unit/functions/crypto.test.ts`.
- Assert both success and expected error branches, as in `tests/unit/utils/errors.test.ts` and `tests/unit/tools/navigation/navigatePage.test.ts`.

**Integration Tests:**
- Scope subprocess, CLI, and end-to-end component flows.
- Place under `tests/integration/`.
- Gate real external requirements with env vars and runtime availability checks; `tests/integration/gemini-cli.integration.test.ts` uses `RUN_GEMINI_CLI_TESTS` and checks CLI availability.
- Use `this.skip()` in function-style tests when a dependency is unavailable, as in `tests/integration/gemini-cli.integration.test.ts`.

**E2E Tests:**
- Lightweight E2E scenarios exist in `tests/integration/jshook-e2e.integration.test.ts` and are gated by `RUN_E2E_TESTS`.
- Browser-related property tests are gated by `RUN_BROWSER_TESTS` in `tests/property/browser-manager.property.test.ts`.
- No separate Playwright test runner is configured; browser interactions are tested through project abstractions and package-provided compatibility layers.

**Property Tests:**
- Use `fast-check` under `tests/property/`.
- Keep generators near the properties they support, as in `tests/property/AIService.property.test.ts`.
- Set `numRuns` explicitly when the property needs a stable sample count, as in `tests/property/AIService.property.test.ts`.

**Performance Tests:**
- Place under `tests/performance/`.
- Gate execution with `RUN_PERF_TESTS=true`, as in `tests/performance/baseline.test.ts`.
- Assert thresholds using deterministic workloads and elapsed time from `node:perf_hooks`.

## Common Patterns

**Async Testing:**
```typescript
it('maps timeout errors to readable troubleshooting guidance', async () => {
  const page = createPage({
    goto: async () => {
      throw new Error('Navigation timeout of 10000 ms exceeded');
    },
  });

  const result = await navigatePage(
    createNavigationRuntime({
      getPages: () => [page as unknown as Page],
      getSelectedPage: () => page as unknown as Page,
    }),
    {type: 'url', url: 'https://slow.example'},
  );

  assert.equal(result.success, false);
  assert.match(result.message, /超时/);
});
```

**Error Testing:**
```typescript
await assert.rejects(
  async () => provider.chat([{role: 'user', content: 'hello'}]),
  /No response from OpenAI/,
);

assert.throws(
  () => registry.register(tool),
  /Tool name conflict/,
);
```

**Environment Isolation:**
```typescript
const originalEnv = {...process.env};

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.DEFAULT_LLM_PROVIDER;
});

afterEach(() => {
  process.env = {...originalEnv};
});
```

**Verification Guidance:**
- Run `npm run check-format` for style and lint verification.
- Run `npm run typecheck` for TypeScript verification; `tsconfig.json` includes `src/**/*.ts` and `tests/**/*.ts`.
- Run `npm run test:unit` for most source changes.
- Add `npm run test:property` when changing invariants, registries, caches, schedulers, or provider behavior covered by `tests/property/`.
- Add `npm run test:integration` when changing CLI/provider subprocess flows.
- Add `npm run test:perf` when changing scheduler, compressor, cache, or performance-sensitive code.

---

*Testing analysis: 2026-04-27*
