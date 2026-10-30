# Global Daemon Session by Default & Workspace Isolation Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make BrowserCLI use a unified global Daemon session by default across all directories, while providing persistent configuration (`browsercli config --set isolate_workspace=true`) and environment controls to opt into workspace-isolated Daemon sessions.

**Architecture:** Introduce `isolate_workspace` configuration in `CliConfig` and validation in `config` command. In `sessionPaths.ts` (CLI client) and `registry.ts` (Worker daemon), check isolation state: when disabled (default), route to a deterministic global workspace (`workspaceDirHash = 'global'`, `daemonDir = <base>/global`, pipe `browsercli-global-<session>`). When enabled (or when `BROWSERCLI_WORKSPACE` is explicitly set), preserve the per-workspace directory hash isolation.

**Tech Stack:** TypeScript (Node.js ESM), `node:test`, `node:assert`, Axi CLI framework.

**Spec:** In-chat approved specification:

- Default: Global Daemon session across all directories.
- CLI Config persistence: `browsercli config --set isolate_workspace=true` / `false`.
- Overrides: `BROWSERCLI_WORKSPACE` / `PROXYCLI_WORKSPACE` and `BROWSERCLI_ISOLATE_WORKSPACE`.

## Global Constraints

- No external dependencies added.
- ESM imports must use `.js` extension.
- Prettier formatting: `singleQuote: true`, `trailingComma: all`, `arrowParens: avoid`.
- Keep `src/cli/sessionPaths.ts` and `src/ipc/registry.ts` path algorithms strictly in sync.

## Review Focus

1. **Non-isolated default**: Calling `computeClientInfo()` from different directories without env/config yields identical `workspaceDirHash = 'global'` and identical `daemonDir`.
2. **Explicit workspace override**: When `BROWSERCLI_WORKSPACE` or `PROXYCLI_WORKSPACE` is set, isolation must take effect for that specific directory, regardless of global config.
3. **Config persistence**: `browsercli config --set isolate_workspace=true` writes to `config.json` and immediately causes subsequent calls to use workspace hash isolation.
4. **Valid session names & pipe names**: Pipe name `browsercli-global-default` must conform to platform naming limits and valid session name assertions.
5. **Existing test compatibility**: Existing unit tests for `sessionPaths` and `registry` that mock directories or expect specific hashes must still be testable (e.g., via isolation flag/env).

---

### Task 1: Update CLI Config Schema and Config Command

**Files:**

- Modify: `plugin/browser-cli/src/cli/daemonClient.ts`
- Modify: `plugin/browser-cli/src/cli/commands/config.ts`
- Modify: `plugin/browser-cli/src/cli/sessionArgs.ts`
- Test: `plugin/browser-cli/tests/unit/cli/commands/config.test.ts` (or add test case in `tests/unit/cli/configSpawnFlags.test.ts`)

**Interfaces:**

- Consumes: `CliConfig` interface, `VALID_KEYS` set in `config.ts`
- Produces: `isolate_workspace` allowed in `CliConfig` and recognized by `config --set` / `--get` / `--unset`

- [ ] **Step 1: Write the failing test**
      Create/update test in `tests/unit/cli/configSpawnFlags.test.ts` verifying that `isolate_workspace` is accepted by config and parsed properly.

- [ ] **Step 2: Run test to verify it fails**
      Run: `npm test tests/unit/cli/configSpawnFlags.test.ts`

- [ ] **Step 3: Implement `isolate_workspace` in `daemonClient.ts` and `config.ts`**
      Add `isolate_workspace?: string;` to `CliConfig` in `src/cli/daemonClient.ts`.
      Add `'isolate_workspace'` to `VALID_KEYS` in `src/cli/commands/config.ts`.

- [ ] **Step 4: Run test to verify it passes**
      Run: `npm test tests/unit/cli/configSpawnFlags.test.ts`
      Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/daemonClient.ts src/cli/commands/config.ts tests/unit/cli/configSpawnFlags.test.ts
git commit -m "feat(config): support isolate_workspace configuration key"
```

---

### Task 2: Implement Global Daemon Routing with Isolation Opt-In

**Files:**

- Modify: `plugin/browser-cli/src/cli/sessionPaths.ts`
- Modify: `plugin/browser-cli/src/ipc/registry.ts`
- Test: `plugin/browser-cli/tests/unit/cli/sessionPaths.test.ts`
- Test: `plugin/browser-cli/tests/unit/ipc/registry.test.ts`

**Interfaces:**

- Consumes: `loadCliConfig()` from `daemonClient.ts` (or direct config reader in `registry.ts`), `BROWSERCLI_WORKSPACE`, `BROWSERCLI_ISOLATE_WORKSPACE`
- Produces: `isWorkspaceIsolationEnabled(): boolean`, `computeClientInfo(startDir?: string)` returning `'global'` by default, or workspace sha1 hash when isolated.

- [ ] **Step 1: Write the failing test**
      Update `tests/unit/cli/sessionPaths.test.ts` and `tests/unit/ipc/registry.test.ts`:
- Add test: `computeClientInfo` defaults to `workspaceDirHash = 'global'` across different directories.
- Add test: `computeClientInfo` with `isolate_workspace=true` (or `BROWSERCLI_ISOLATE_WORKSPACE=true`) uses per-workspace SHA1 hash.
- Add test: `BROWSERCLI_WORKSPACE` explicitly set enables directory isolation.

- [ ] **Step 2: Run test to verify it fails**
      Run: `npm test tests/unit/cli/sessionPaths.test.ts`
      Expected: FAIL because `computeClientInfo` currently always uses directory SHA1 hash.

- [ ] **Step 3: Implement `isWorkspaceIsolationEnabled` and update `computeClientInfo`**
      In `src/cli/sessionPaths.ts` and `src/ipc/registry.ts`:

1. Check `process.env.BROWSERCLI_ISOLATE_WORKSPACE ?? process.env.PROXYCLI_ISOLATE_WORKSPACE`.
2. Check `process.env.BROWSERCLI_WORKSPACE ?? process.env.PROXYCLI_WORKSPACE`.
3. Check `loadCliConfig().isolate_workspace`.
4. If not isolated:
   - `workspaceDir = computeBaseDaemonDir()` (or home directory)
   - `workspaceDirHash = 'global'`
   - `daemonDir = path.join(computeBaseDaemonDir(), 'global')`
5. If isolated:
   - Retain current directory calculation and SHA1 hash slicing.

- [ ] **Step 4: Run test to verify it passes**
      Run: `npm test tests/unit/cli/sessionPaths.test.ts tests/unit/ipc/registry.test.ts`
      Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/sessionPaths.ts src/ipc/registry.ts tests/unit/cli/sessionPaths.test.ts tests/unit/ipc/registry.test.ts
git commit -m "feat(daemon): default to global daemon session and support workspace isolation"
```

---

### Task 3: Build, Typecheck, and End-to-End Verification

**Files:**

- None (Build & verify)

- [ ] **Step 1: Typecheck and build**
      Run: `npm run typecheck && npm run build`
      Expected: Clean compilation with 0 errors.

- [ ] **Step 2: Run all unit tests**
      Run: `npm run test:unit`
      Expected: All unit tests pass.

- [ ] **Step 3: Verification via CLI**

1. Test default status: `browsercli status` (should point to global session).
2. Test config toggle:
   - `browsercli config --set isolate_workspace=true`
   - `browsercli status` (should point to workspace hash)
   - `browsercli config --set isolate_workspace=false`
   - `browsercli status` (should return to global session)
3. Test `browsercli call list_pages` in global mode.

- [ ] **Step 4: Commit**

```bash
git commit --allow-empty -m "chore: verify global daemon session and workspace isolation"
```
