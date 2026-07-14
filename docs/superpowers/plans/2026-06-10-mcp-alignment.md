# MCP Alignment Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align JSReverser-CLI with JSReverser-MCP by adding environment diagnostics, trace output, agent response protocol, knowledge base, and documentation — adapted to CLI's manifest/domain architecture.

**Architecture:** Three-phase migration (P0 core runtime → P1 agent protocol → P2 knowledge & docs). Each phase is independently deliverable. New modules follow CLI's existing DomainManifest registration pattern and `defineTool` pattern. Mutex.ts already exists in `src/utils/` so it is excluded from scope.

**Tech Stack:** TypeScript ESM, node:test, zod, MCP SDK, SWC build

**Spec:** `docs/superpowers/specs/2026-06-10-mcp-alignment-design.md`

---

## File Structure

### P0 — Core Runtime

| Action | File                                           | Responsibility                                                 |
| ------ | ---------------------------------------------- | -------------------------------------------------------------- |
| Create | `src/diagnostics/types.ts`                     | DiagnosticCheck, DiagnosticReport, DiagnosticStatus types      |
| Create | `src/diagnostics/environment.ts`               | Environment check implementations (node, build, AI, artifacts) |
| Create | `src/diagnostics/index.ts`                     | Re-export barrel                                               |
| Create | `src/tools/diagnostics/diagnoseEnvironment.ts` | `diagnose_environment` tool via `defineTool`                   |
| Create | `src/tools/diagnostics/manifest.ts`            | DomainManifest for diagnostics domain                          |
| Create | `src/tools/diagnostics/index.ts`               | Re-export barrel                                               |
| Create | `src/tools/diagnostics/types.ts`               | Tool-specific types                                            |
| Create | `src/tools/shared/trace-output.ts`             | TraceOutputMode resolution and traceId injection               |
| Modify | `src/tools/categories.ts`                      | Add `DIAGNOSTICS` enum value                                   |
| Modify | `src/cli/args-parser.ts`                       | Add `--traceOutput` CLI option                                 |
| Modify | `src/cli/commands/start.ts`                    | Pass traceOutput to worker config                              |
| Create | `tests/unit/diagnostics/environment.test.ts`   | Unit tests for diagnostics                                     |
| Create | `tests/unit/tools/shared/trace-output.test.ts` | Unit tests for trace output                                    |

### P1 — Agent Response Protocol

| Action | File                                                 | Responsibility                                        |
| ------ | ---------------------------------------------------- | ----------------------------------------------------- |
| Create | `src/tools/shared/response-builder.ts`               | Continuation types + builder functions (~630 lines)   |
| Modify | `src/reverse/ReverseTaskAdmin.ts`                    | Integrate `buildManageContinuation`                   |
| Modify | `src/reverse/ReverseTaskOrchestrator.ts`             | Integrate `buildOrchestrationContinuation`            |
| Modify | `src/reverse/ReverseAgentRunner.ts`                  | Integrate `compactAgentPayload` + `withSchemaVersion` |
| Create | `docs/reference/manage-response.schema.json`         | manage_reverse_task response schema                   |
| Create | `docs/reference/orchestrate-response.schema.json`    | orchestrate response schema                           |
| Create | `docs/reference/rebuild-health-response.schema.json` | rebuild health response schema                        |
| Create | `docs/reference/reverse-agent-response.schema.json`  | run_reverse_agent response schema                     |
| Create | `docs/reference/reverse-agent-schema-versioning.md`  | Schema versioning strategy                            |
| Create | `tests/unit/tools/shared/response-builder.test.ts`   | Unit tests for response builder                       |

### P2 — Knowledge & Documentation

| Action | File                                                 | Responsibility                         |
| ------ | ---------------------------------------------------- | -------------------------------------- |
| Copy   | `docs/knowledge/parameter-blueprints/` (13+ files)   | Structured parameter blueprint library |
| Create | `docs/guides/troubleshooting.md`                     | Troubleshooting guide                  |
| Create | `docs/guides/reverse-task-orchestration.md`          | Task orchestration guide               |
| Create | `docs/guides/mcp-agent-quick-reference.md`           | Agent quick reference                  |
| Create | `docs/guides/mcp-client-auto-resume-example.md`      | Auto-resume examples                   |
| Create | `docs/guides/client-system-prompt.md`                | Client system prompt template          |
| Create | `docs/reference/pure-extraction.md`                  | Pure extraction phase guide            |
| Create | `docs/reference/parameter-blueprint-template.md`     | Blueprint contribution template        |
| Create | `docs/reference/parameter-blueprint-contribution.md` | Blueprint contribution guide           |
| Modify | `docs/reference/tool-reference.md`                   | Add diagnose_environment docs          |

---

## Chunk 1: P0 Core Runtime

### Task 1: Diagnostic Types

**Files:**

- Create: `src/diagnostics/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

export type DiagnosticStatus = 'ok' | 'warn' | 'fail';

export interface DiagnosticCheck {
  name: string;
  status: DiagnosticStatus;
  reason: string;
  fix: string;
  details?: Record<string, unknown>;
}

export interface DiagnosticReport {
  status: DiagnosticStatus;
  summary: string;
  checks: DiagnosticCheck[];
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/diagnostics/types.ts
git commit -m "feat(diagnostics): add diagnostic types"
```

### Task 2: Environment Diagnostics Module

**Files:**

- Create: `src/diagnostics/environment.ts`
- Create: `src/diagnostics/index.ts`
- Create: `tests/unit/diagnostics/environment.test.ts`

**Reference:** `JSReverser-MCP/src/diagnostics/environment.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/diagnostics/environment.test.ts
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {runEnvironmentDiagnostics} from '../../src/diagnostics/environment.js';

describe('runEnvironmentDiagnostics', () => {
  it('returns a report with checks array', () => {
    const report = runEnvironmentDiagnostics();
    assert.ok(Array.isArray(report.checks));
    assert.ok(report.checks.length > 0);
  });

  it('includes node_version check', () => {
    const report = runEnvironmentDiagnostics();
    const nodeCheck = report.checks.find(c => c.name === 'node_version');
    assert.ok(nodeCheck);
    assert.ok(['ok', 'warn', 'fail'].includes(nodeCheck.status));
  });

  it('includes build_output check', () => {
    const report = runEnvironmentDiagnostics();
    const buildCheck = report.checks.find(c => c.name === 'build_output');
    assert.ok(buildCheck);
  });

  it('includes artifacts_dir check', () => {
    const report = runEnvironmentDiagnostics();
    const artifactsCheck = report.checks.find(c => c.name === 'artifacts_dir');
    assert.ok(artifactsCheck);
  });

  it('sets overall status from worst check', () => {
    const report = runEnvironmentDiagnostics();
    const statuses = report.checks.map(c => c.status);
    if (statuses.includes('fail')) {
      assert.equal(report.status, 'fail');
    } else if (statuses.includes('warn')) {
      assert.equal(report.status, 'warn');
    } else {
      assert.equal(report.status, 'ok');
    }
  });

  it('generates a summary string', () => {
    const report = runEnvironmentDiagnostics();
    assert.ok(typeof report.summary === 'string');
    assert.ok(report.summary.length > 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/diagnostics/environment.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write the environment diagnostics implementation**

Adapt from MCP's `diagnostics/environment.ts`. Key differences:

- Use `resolvePackageRoot(import.meta.url)` from `src/utils/projectPaths.ts` instead of `getPackageRootDirectory()`
- Use `resolveArtifactsTasksDirForPackageRoot()` from `src/utils/projectPaths.ts` instead of `getArtifactsDirectory()`
- Build entry path is `build/src/bin/js-reverse.js` (not `build/src/index.js`)
- AI config status uses `getDefaultLLMProvider()` and `getAIConfig()` from `src/config/resolver.ts`

```typescript
// src/diagnostics/environment.ts
import {accessSync, constants, existsSync} from 'node:fs';
import path from 'node:path';

import {getDefaultLLMProvider, getAIConfig} from '../config/resolver.js';
import {
  resolvePackageRoot,
  resolveArtifactsTasksDirForPackageRoot,
} from '../utils/projectPaths.js';

import type {
  DiagnosticCheck,
  DiagnosticReport,
  DiagnosticStatus,
} from './types.js';

function getNodeVersionStatus(version: string): DiagnosticCheck {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  const supported =
    major > 22 ||
    major === 23 ||
    (major === 22 && minor >= 12) ||
    (major === 20 && minor >= 19) ||
    (major > 20 && major < 22);

  return {
    name: 'node_version',
    status: supported ? 'ok' : 'fail',
    reason: supported
      ? `Detected supported Node version ${version}.`
      : `Detected unsupported Node version ${version}.`,
    fix: supported
      ? 'No action required.'
      : 'Upgrade to Node 20.19.0+, Node 22.12.0+, or a newer supported release.',
    details: {version},
  };
}

function getBuildOutputStatus(packageRoot: string): DiagnosticCheck {
  const buildEntry = path.join(
    packageRoot,
    'build',
    'src',
    'bin',
    'js-reverse.js',
  );
  const exists = existsSync(buildEntry);
  return {
    name: 'build_output',
    status: exists ? 'ok' : 'fail',
    reason: exists
      ? `Build entry exists at ${buildEntry}.`
      : `Build entry is missing at ${buildEntry}.`,
    fix: exists
      ? 'No action required.'
      : 'Run `npm run build` before starting.',
    details: {buildEntry},
  };
}

function getAISelectionStatus(): DiagnosticCheck {
  const provider = getDefaultLLMProvider();
  const aiConfig = getAIConfig();
  const configured = aiConfig !== undefined;
  return {
    name: 'ai_provider_selection',
    status: configured ? 'ok' : 'warn',
    reason: configured
      ? `AI provider "${provider}" is configured.`
      : `No AI provider configured. Default provider is "${provider}".`,
    fix: configured
      ? 'No action required.'
      : `Configure credentials for ${provider} or set DEFAULT_LLM_PROVIDER.`,
    details: {defaultProvider: provider, configured},
  };
}

function getGeminiCliStatus(): DiagnosticCheck {
  const cliPath = process.env.GEMINI_CLI_PATH || 'gemini-cli';
  return {
    name: 'gemini_cli',
    status: 'warn',
    reason: `Gemini CLI fallback path is set to ${cliPath}. Availability is not verified during static diagnostics.`,
    fix: 'If you rely on Gemini CLI fallback, ensure the executable is installed and on PATH.',
    details: {cliPath},
  };
}

function getArtifactsDirectoryStatus(): DiagnosticCheck {
  const packageRoot = resolvePackageRoot(import.meta.url);
  const artifactsDir = resolveArtifactsTasksDirForPackageRoot(packageRoot);
  try {
    accessSync(path.dirname(artifactsDir), constants.W_OK);
    return {
      name: 'artifacts_dir',
      status: 'ok',
      reason: `Artifacts parent directory is writable for ${artifactsDir}.`,
      fix: 'No action required.',
      details: {artifactsDir},
    };
  } catch (error) {
    return {
      name: 'artifacts_dir',
      status: 'warn',
      reason: `Artifacts parent directory is not writable: ${String(error)}.`,
      fix: 'Set JSREVERSER_ARTIFACTS_DIR to a writable path before running task exports.',
      details: {artifactsDir},
    };
  }
}

function summarizeStatus(checks: DiagnosticCheck[]): DiagnosticStatus {
  if (checks.some(item => item.status === 'fail')) return 'fail';
  if (checks.some(item => item.status === 'warn')) return 'warn';
  return 'ok';
}

function buildSummary(
  checks: DiagnosticCheck[],
  status: DiagnosticStatus,
): string {
  const counts = checks.reduce(
    (acc, item) => {
      acc[item.status] += 1;
      return acc;
    },
    {ok: 0, warn: 0, fail: 0},
  );
  return `Diagnostics completed with status=${status} (ok=${counts.ok}, warn=${counts.warn}, fail=${counts.fail}).`;
}

export function runEnvironmentDiagnostics(): DiagnosticReport {
  const packageRoot = resolvePackageRoot(import.meta.url);
  const checks: DiagnosticCheck[] = [
    getNodeVersionStatus(process.version),
    getBuildOutputStatus(packageRoot),
    getAISelectionStatus(),
    getGeminiCliStatus(),
    getArtifactsDirectoryStatus(),
  ];

  const status = summarizeStatus(checks);
  return {
    status,
    summary: buildSummary(checks, status),
    checks,
  };
}
```

- [ ] **Step 4: Create the barrel export**

```typescript
// src/diagnostics/index.ts
export type {
  DiagnosticCheck,
  DiagnosticReport,
  DiagnosticStatus,
} from './types.js';
export {runEnvironmentDiagnostics} from './environment.js';
```

- [ ] **Step 5: Run tests**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/diagnostics/environment.test.js`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/diagnostics/environment.ts src/diagnostics/index.ts tests/unit/diagnostics/environment.test.ts
git commit -m "feat(diagnostics): add environment diagnostics module"
```

### Task 3: Add DIAGNOSTICS ToolCategory

**Files:**

- Modify: `src/tools/categories.ts`

- [ ] **Step 1: Add the enum value and label**

In `src/tools/categories.ts`, add `DIAGNOSTICS = 'diagnostics'` to the `ToolCategory` enum and its label:

```typescript
// In the enum, add:
DIAGNOSTICS = 'diagnostics',

// In the labels object, add:
[ToolCategory.DIAGNOSTICS]: 'Diagnostics',
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/tools/categories.ts
git commit -m "feat(tools): add DIAGNOSTICS tool category"
```

### Task 4: diagnose_environment Tool

**Files:**

- Create: `src/tools/diagnostics/diagnoseEnvironment.ts`
- Create: `src/tools/diagnostics/manifest.ts`
- Create: `src/tools/diagnostics/index.ts`
- Create: `src/tools/diagnostics/types.ts`

**Reference:** `src/tools/console/manifest.ts` for manifest pattern

- [ ] **Step 1: Create the tool types file**

```typescript
// src/tools/diagnostics/types.ts
export type {DiagnosticReport} from '../../diagnostics/types.js';
```

- [ ] **Step 2: Create the tool implementation**

````typescript
// src/tools/diagnostics/diagnoseEnvironment.ts
import {runEnvironmentDiagnostics} from '../../diagnostics/environment.js';
import {zod} from '../../third_party/index.js';

import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const diagnoseEnvironmentTool = defineTool({
  name: 'diagnose_environment',
  description:
    'Run environment diagnostics to check Node version, build output, AI configuration, and artifacts directory status.',
  annotations: {
    category: ToolCategory.DIAGNOSTICS,
    readOnlyHint: true,
  },
  schema: {
    checks: zod
      .array(zod.string())
      .optional()
      .describe(
        'Optional list of check names to run. If omitted, all checks run. Valid names: node_version, build_output, ai_provider_selection, gemini_cli, artifacts_dir.',
      ),
  },
  handler: async (request, response) => {
    const report = runEnvironmentDiagnostics();

    if (request.params.checks?.length) {
      const allowed = new Set(request.params.checks);
      report.checks = report.checks.filter(c => allowed.has(c.name));
      const hasFail = report.checks.some(c => c.status === 'fail');
      const hasWarn = report.checks.some(c => c.status === 'warn');
      report.status = hasFail ? 'fail' : hasWarn ? 'warn' : 'ok';
    }

    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(report, null, 2));
    response.appendResponseLine('```');
  },
});
````

- [ ] **Step 3: Create the manifest**

```typescript
// src/tools/diagnostics/manifest.ts
import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'diagnostics',
  description: 'Environment diagnostics and health checks.',
  profile: 'search',
  tools: [
    {
      modulePath: './diagnostics/diagnoseEnvironment.js',
      handlerName: 'diagnoseEnvironmentTool',
    },
  ],
} satisfies DomainManifest;
```

- [ ] **Step 4: Create the barrel export**

```typescript
// src/tools/diagnostics/index.ts
export {diagnoseEnvironmentTool} from './diagnoseEnvironment.js';
export {manifest} from './manifest.js';
```

- [ ] **Step 5: Regenerate the tools index**

Run: `npm run build:index`
Expected: `src/tools/generated-tools-index.ts` updated to include the diagnostics manifest

- [ ] **Step 6: Verify build and typecheck**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/tools/diagnostics/ src/tools/categories.ts src/tools/generated-tools-index.ts
git commit -m "feat(tools): add diagnose_environment tool"
```

### Task 5: Trace Output Module

**Files:**

- Create: `src/tools/shared/trace-output.ts`
- Create: `tests/unit/tools/shared/trace-output.test.ts`

**Reference:** `JSReverser-MCP/src/tools/trace-output.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/tools/shared/trace-output.test.ts
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveTraceOutputMode,
  withOptionalTraceIdContent,
} from '../../../src/tools/shared/trace-output.js';

describe('resolveTraceOutputMode', () => {
  it('returns request mode when explicitly set to all', () => {
    assert.equal(resolveTraceOutputMode(undefined, 'all'), 'all');
  });

  it('returns request mode when explicitly set to errors', () => {
    assert.equal(resolveTraceOutputMode('all', 'errors'), 'errors');
  });

  it('falls back to global mode when request mode is invalid', () => {
    assert.equal(resolveTraceOutputMode('all', undefined), 'all');
    assert.equal(resolveTraceOutputMode('all', 'invalid'), 'all');
  });

  it('defaults to errors when neither is set', () => {
    assert.equal(resolveTraceOutputMode(undefined, undefined), 'errors');
  });
});

describe('withOptionalTraceIdContent', () => {
  it('returns content unchanged when mode is not all', () => {
    const content = [{type: 'text', text: 'hello'}];
    const result = withOptionalTraceIdContent(content, 'trace-123', 'errors');
    assert.deepEqual(result, content);
  });

  it('prepends traceId when mode is all', () => {
    const content = [{type: 'text', text: 'hello'}];
    const result = withOptionalTraceIdContent(content, 'trace-123', 'all');
    assert.equal(result.length, 2);
    assert.deepEqual(JSON.parse(result[0].text!), {traceId: 'trace-123'});
    assert.equal(result[1].text, 'hello');
  });

  it('returns content unchanged when mode is undefined', () => {
    const content = [{type: 'text', text: 'hello'}];
    const result = withOptionalTraceIdContent(content, 'trace-123', undefined);
    assert.deepEqual(result, content);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/tools/shared/trace-output.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/tools/shared/trace-output.ts
export type TraceOutputMode = 'errors' | 'all';

export function resolveTraceOutputMode(
  globalMode: string | undefined,
  requestMode: unknown,
): TraceOutputMode {
  if (requestMode === 'all' || requestMode === 'errors') {
    return requestMode;
  }
  return globalMode === 'all' ? 'all' : 'errors';
}

export function withOptionalTraceIdContent(
  content: Array<{type: string; text?: string}>,
  traceId: string,
  mode: string | undefined,
): Array<{type: string; text?: string}> {
  if (mode !== 'all') {
    return content;
  }
  return [{type: 'text', text: JSON.stringify({traceId}, null, 2)}, ...content];
}
```

- [ ] **Step 4: Run tests**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/tools/shared/trace-output.test.js`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/shared/trace-output.ts tests/unit/tools/shared/trace-output.test.ts
git commit -m "feat(tools): add trace output module"
```

### Task 6: CLI traceOutput Integration

**Files:**

- Modify: `src/cli/args-parser.ts`
- Modify: `src/cli/commands/start.ts`

- [ ] **Step 1: Add --traceOutput option to args-parser**

In `src/cli/args-parser.ts`, add to the `cliOptions` object:

```typescript
traceOutput: {
  type: 'string',
  description: 'Trace output mode: "errors" (default) only includes traceId on error responses, "all" includes traceId on every response.',
  choices: ['errors', 'all'] as const,
  default: 'errors',
},
```

- [ ] **Step 2: Pass traceOutput in start command**

In `src/cli/commands/start.ts`, ensure the parsed `traceOutput` value is included in the worker launch configuration. The exact integration point depends on the existing start command structure — pass it as an environment variable or worker config field.

- [ ] **Step 3: Verify build**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/cli/args-parser.ts src/cli/commands/start.ts
git commit -m "feat(cli): add --traceOutput option"
```

### Task 7: P0 Verification

- [ ] **Step 1: Run full unit test suite**

Run: `npm run test:unit`
Expected: All tests PASS, no regressions

- [ ] **Step 2: Run format check**

Run: `npm run check-format`
Expected: PASS

- [ ] **Step 3: Commit any formatting fixes if needed**

---

## Chunk 2: P1 Agent Response Protocol

### Task 8: Response Builder Module

**Files:**

- Create: `src/tools/shared/response-builder.ts`
- Create: `tests/unit/tools/shared/response-builder.test.ts`

**Reference:** `JSReverser-MCP/src/tools/response-builder.ts` (full ~630 lines)

- [ ] **Step 1: Write key tests first**

Write tests for the most critical functions: `compactAgentPayload`, `withSchemaVersion`, `buildInvokeHint` (via `buildManageContinuation`), `inferBlockedBy`, `inferOutcomeFromStatus`.

```typescript
// tests/unit/tools/shared/response-builder.test.ts
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {
  compactAgentPayload,
  withSchemaVersion,
  inferBlockedBy,
  inferOutcomeFromStatus,
  buildTaskDiagnostics,
  buildManageSummaryText,
  compactManagePayload,
  REVERSE_AGENT_SCHEMA_VERSION,
} from '../../../src/tools/shared/response-builder.js';

describe('compactAgentPayload', () => {
  it('returns payload unchanged in verbose mode', () => {
    const payload = {status: 'ok', agentGuidance: {summary: 'test'}};
    const result = compactAgentPayload(payload, 'verbose');
    assert.deepEqual(result, payload);
  });

  it('strips guidance fields in compact mode', () => {
    const payload = {
      status: 'ok',
      agentGuidance: {summary: 'test'},
      nextBestTool: 'some_tool',
      fallbackPlan: {steps: []},
      routeGuard: {},
    };
    const result = compactAgentPayload(payload, 'compact');
    assert.equal(result.detailLevel, 'minimal');
    assert.equal(result.nextBestTool, undefined);
    assert.equal(result.agentGuidance, undefined);
  });
});

describe('withSchemaVersion', () => {
  it('prepends schema version', () => {
    const result = withSchemaVersion({foo: 'bar'});
    assert.equal(result.schemaVersion, REVERSE_AGENT_SCHEMA_VERSION);
    assert.equal(result.foo, 'bar');
  });
});

describe('inferBlockedBy', () => {
  it('maps known reasons', () => {
    assert.equal(inferBlockedBy('blocked'), 'task_state');
    assert.equal(inferBlockedBy('env_error'), 'environment');
    assert.equal(inferBlockedBy('validation_error'), 'input_validation');
  });

  it('returns undefined for unknown reasons', () => {
    assert.equal(inferBlockedBy('something_random'), undefined);
  });
});

describe('inferOutcomeFromStatus', () => {
  it('maps blocked to blocked', () => {
    assert.equal(inferOutcomeFromStatus('blocked'), 'blocked');
  });

  it('maps partial to partial', () => {
    assert.equal(inferOutcomeFromStatus('partial'), 'partial');
  });

  it('defaults to success', () => {
    assert.equal(inferOutcomeFromStatus('completed'), 'success');
  });
});

describe('buildTaskDiagnostics', () => {
  it('includes action and outputMode', () => {
    const result = buildTaskDiagnostics('get', 'verbose', 'task-1');
    assert.equal(result.responseStatus, 'ok');
    assert.equal(result.action, 'get');
    assert.equal(result.outputMode, 'verbose');
    assert.equal(result.taskId, 'task-1');
  });
});

describe('buildManageSummaryText', () => {
  it('summarizes list action', () => {
    const text = buildManageSummaryText('list', {items: [1, 2]});
    assert.ok(text.includes('2'));
  });

  it('summarizes get action', () => {
    const text = buildManageSummaryText('get', {taskId: 'task-1'});
    assert.ok(text.includes('task-1'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/tools/shared/response-builder.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Copy response-builder.ts from MCP and adapt**

Copy `JSReverser-MCP/src/tools/response-builder.ts` to `src/tools/shared/response-builder.ts`.

No code changes needed — the file is pure logic with no external dependencies beyond its own type definitions. The tool names referenced in `buildInvokeHint` already match CLI tool names (both use `snake_case`).

- [ ] **Step 4: Run tests**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/tools/shared/response-builder.test.js`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/shared/response-builder.ts tests/unit/tools/shared/response-builder.test.ts
git commit -m "feat(tools): add agent response builder protocol"
```

### Task 9: Integrate Response Builder into ReverseTaskAdmin

**Files:**

- Modify: `src/reverse/ReverseTaskAdmin.ts`

- [ ] **Step 1: Read the current file to understand the return structure**

Run: Read `src/reverse/ReverseTaskAdmin.ts` to identify where manage_reverse_task results are returned.

- [ ] **Step 2: Import and integrate continuation builder**

Add import:

```typescript
import {
  buildManageContinuation,
  compactManagePayload,
  buildTaskDiagnostics,
} from '../tools/shared/response-builder.js';
```

At the return point for each manage action, call `buildManageContinuation(action, payload, fallbackReason)` and merge the result into the response payload.

- [ ] **Step 3: Run existing tests to verify no regression**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/reverse/ReverseTaskAdmin.test.js`
Expected: All tests PASS (or equivalent test file)

- [ ] **Step 4: Commit**

```bash
git add src/reverse/ReverseTaskAdmin.ts
git commit -m "feat(reverse): integrate response builder into ReverseTaskAdmin"
```

### Task 10: Integrate Response Builder into ReverseTaskOrchestrator

**Files:**

- Modify: `src/reverse/ReverseTaskOrchestrator.ts`

- [ ] **Step 1: Import buildOrchestrationContinuation**

```typescript
import {buildOrchestrationContinuation} from '../tools/shared/response-builder.js';
```

- [ ] **Step 2: Add continuation fields to orchestration output**

At the return point where orchestration results are assembled, call `buildOrchestrationContinuation()` with the guidance/fallback data and merge into the response.

- [ ] **Step 3: Run existing tests**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/reverse/ReverseTaskOrchestrator.test.js`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/reverse/ReverseTaskOrchestrator.ts
git commit -m "feat(reverse): integrate response builder into orchestrator"
```

### Task 11: Integrate Response Builder into ReverseAgentRunner

**Files:**

- Modify: `src/reverse/ReverseAgentRunner.ts`

- [ ] **Step 1: Import compactAgentPayload and withSchemaVersion**

```typescript
import {
  compactAgentPayload,
  withSchemaVersion,
} from '../tools/shared/response-builder.js';
```

- [ ] **Step 2: Wrap agent output with schema version and compact mode**

At the final return point, wrap the payload:

```typescript
const compacted = compactAgentPayload(payload, outputMode);
return withSchemaVersion(compacted);
```

- [ ] **Step 3: Run existing tests**

Run: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/reverse/ReverseAgentRunner.test.js`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/reverse/ReverseAgentRunner.ts
git commit -m "feat(reverse): integrate response builder into agent runner"
```

### Task 12: Response Schema Documentation

**Files:**

- Create: `docs/reference/manage-response.schema.json`
- Create: `docs/reference/orchestrate-response.schema.json`
- Create: `docs/reference/rebuild-health-response.schema.json`
- Create: `docs/reference/reverse-agent-response.schema.json`
- Create: `docs/reference/reverse-agent-schema-versioning.md`

**Reference:** Copy from `JSReverser-MCP/docs/reference/` and adapt field names.

- [ ] **Step 1: Copy schema files from MCP**

Copy the 4 JSON schema files from `JSReverser-MCP/docs/reference/` to `docs/reference/`.

- [ ] **Step 2: Copy schema versioning doc**

Copy `JSReverser-MCP/docs/reference/reverse-agent-schema-versioning.md` to `docs/reference/`.

- [ ] **Step 3: Verify JSON validity**

Run: `node -e "require('./docs/reference/manage-response.schema.json'); require('./docs/reference/orchestrate-response.schema.json'); require('./docs/reference/rebuild-health-response.schema.json'); require('./docs/reference/reverse-agent-response.schema.json'); console.log('All schemas valid JSON')"`
Expected: `All schemas valid JSON`

- [ ] **Step 4: Commit**

```bash
git add docs/reference/
git commit -m "docs: add agent response schema documentation"
```

### Task 13: P1 Verification

- [ ] **Step 1: Run full unit test suite**

Run: `npm run test:unit`
Expected: All tests PASS

- [ ] **Step 2: Run format check**

Run: `npm run check-format`
Expected: PASS

---

## Chunk 3: P2 Knowledge & Documentation

### Task 14: Parameter Blueprints Knowledge Base

**Files:**

- Copy: `docs/knowledge/parameter-blueprints/` (entire directory tree from MCP)

**Reference:** `JSReverser-MCP/docs/knowledge/parameter-blueprints/`

- [ ] **Step 1: Copy the entire blueprints directory**

```bash
cp -r JSReverser-MCP/docs/knowledge/parameter-blueprints/ docs/knowledge/parameter-blueprints/
```

- [ ] **Step 2: Verify the index.json is valid**

Run: `node -e "const idx = require('./docs/knowledge/parameter-blueprints/index.json'); console.log('Blueprints:', idx.items.length)"`
Expected: `Blueprints: 5` (or however many exist)

- [ ] **Step 3: Verify list_parameter_workflows picks them up**

Run: `npm run build && node build/src/bin/js-reverse.js --list-parameter-workflows`
Expected: Lists the blueprints

- [ ] **Step 4: Commit**

```bash
git add docs/knowledge/
git commit -m "docs: add parameter blueprints knowledge base"
```

### Task 15: Guides Documentation

**Files:**

- Create: `docs/guides/troubleshooting.md`
- Create: `docs/guides/reverse-task-orchestration.md`
- Create: `docs/guides/mcp-agent-quick-reference.md`
- Create: `docs/guides/mcp-client-auto-resume-example.md`
- Create: `docs/guides/client-system-prompt.md`

**Reference:** `JSReverser-MCP/docs/guides/`

- [ ] **Step 1: Copy guides from MCP**

Copy the 5 guide files from `JSReverser-MCP/docs/guides/` to `docs/guides/`.

- [ ] **Step 2: Adapt CLI-specific content**

For each copied guide:

- Replace `node build/src/index.js` with `node build/src/bin/js-reverse.js` where applicable
- Add CLI command equivalents alongside MCP tool references
- In `troubleshooting.md`, add a section about CLI worker issues (`js-reverse stop`, `js-reverse status`)

- [ ] **Step 3: Commit**

```bash
git add docs/guides/
git commit -m "docs: add guides from MCP with CLI adaptations"
```

### Task 16: Reference Documentation

**Files:**

- Create: `docs/reference/pure-extraction.md`
- Create: `docs/reference/parameter-blueprint-template.md`
- Create: `docs/reference/parameter-blueprint-contribution.md`
- Modify: `docs/reference/tool-reference.md`

- [ ] **Step 1: Copy reference docs from MCP**

Copy `pure-extraction.md` and `parameter-blueprint-template.md` from `JSReverser-MCP/docs/reference/`.

- [ ] **Step 2: Create contribution guide**

Create `docs/reference/parameter-blueprint-contribution.md` based on the MCP project's contribution conventions.

- [ ] **Step 3: Update tool-reference.md**

Add `diagnose_environment` tool documentation to `docs/reference/tool-reference.md`, including:

- Tool name, description, and category
- Parameter schema (optional `checks` array)
- Example output

- [ ] **Step 4: Commit**

```bash
git add docs/reference/
git commit -m "docs: add reference docs and update tool-reference"
```

### Task 17: P2 Verification

- [ ] **Step 1: Verify all doc paths are valid**

Check that all cross-references in the new docs point to existing files.

- [ ] **Step 2: Verify blueprints load correctly**

Run: `npm run build && node build/src/bin/js-reverse.js --list-parameter-workflows`
Expected: Lists 5+ blueprints

- [ ] **Step 3: Final full test run**

Run: `npm run test:unit`
Expected: All tests PASS, no regressions
