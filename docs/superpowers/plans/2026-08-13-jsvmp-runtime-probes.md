# JSVMP Runtime Probes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port `hook_jsvmp_interpreter` and `compare_env` from the vendored Camoufox reference into the current TypeScript MCP tool runtime.

**Architecture:** Add a focused `jsvmp` tool domain. Render the proxy and transparent probes from self-contained browser functions so SWC emits everything needed without a new asset-copy path; register persistent probes through the existing `PersistentHookRegistry`, and run one-shot probes plus environment collection in the selected Frame.

**Tech Stack:** TypeScript ESM, Patchright Frame/BrowserContext APIs, Zod schemas, Node `node:test`, Node `vm`.

## Global Constraints

- Preserve the reference MCP names and snake_case parameters: `hook_jsvmp_interpreter`, `compare_env`, `script_url`, `track_calls`, `track_props`, `track_reflect`, `proxy_objects`, and `max_entries`.
- Keep JS injection opt-in: no launch-time or navigation-time implicit installation.
- Reuse `PersistentHookRegistry`; do not add another browser-lifecycle store or dependency.
- Treat proxy mode as detectable and report that warning explicitly.
- Do not modify generated `build/` output or unrelated pre-existing worktree changes.
- Do not create commits or perform remote actions unless the user asks.

---

### Task 1: Executable JSVMP probe scripts

**Files:**

- Create: `src/tools/jsvmp/hookScripts.ts`
- Test: `tests/unit/tools/jsvmp/hookScripts.test.ts`

**Interfaces:**

- Produces: `buildJsvmpProxyHook(options: JsvmpProxyHookOptions): string`
- Produces: `buildJsvmpTransparentHook(options: JsvmpTransparentHookOptions): string`
- Both scripts write structured entries to `window.__mcp_jsvmp_log` and expose their matching uninstall function.

- [ ] **Step 1: Write failing behavior tests**

```ts
it('records proxied global property reads and honors max_entries', () => {
  const realm = createBrowserRealm();
  vm.runInContext(
    buildJsvmpProxyHook({
      scriptUrl: '',
      maxEntries: 1,
      trackCalls: false,
      trackProps: true,
      trackReflect: false,
      proxyObjects: ['navigator'],
    }),
    realm,
  );
  vm.runInContext('navigator.userAgent; navigator.platform;', realm);
  assert.equal(readLog(realm).length, 1);
  assert.equal(readLog(realm)[0].type, 'proxy_get');
});

it('observes prototype getters without constructing a Proxy', () => {
  const realm = createBrowserRealm({rejectProxyConstruction: true});
  vm.runInContext(
    buildJsvmpTransparentHook({scriptUrl: '', maxEntries: 10}),
    realm,
  );
  vm.runInContext('navigator.userAgent', realm);
  assert.equal(readLog(realm)[0].type, 'transparent_get');
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm run build:compile && node --require ./build/tests/setup.js --test build/tests/unit/tools/jsvmp/hookScripts.test.js`

Expected: failure because `src/tools/jsvmp/hookScripts.ts` does not exist.

- [ ] **Step 3: Implement the minimum self-contained probe renderers**

```ts
export function buildJsvmpProxyHook(options: JsvmpProxyHookOptions): string {
  return `(${installJsvmpProxyHook.toString()})(${JSON.stringify(options)});`;
}

export function buildJsvmpTransparentHook(
  options: JsvmpTransparentHookOptions,
): string {
  return `(${installJsvmpTransparentHook.toString()})(${JSON.stringify(options)});`;
}
```

The serialized installers preserve original intrinsics, cap the shared log, filter by stack substring, implement the reference call/Reflect/global-property/timing coverage, and restore every patched surface their uninstall function owns.

- [ ] **Step 4: Re-run the focused test and confirm GREEN**

Run: `npm run build:compile && node --require ./build/tests/setup.js --test build/tests/unit/tools/jsvmp/hookScripts.test.js`

Expected: all probe behavior tests pass.

### Task 2: MCP tools and manifest registration

**Files:**

- Create: `src/tools/jsvmp/jsvmp.ts`
- Create: `src/tools/jsvmp/manifest.ts`
- Test: `tests/unit/tools/jsvmp/jsvmp.test.ts`
- Generate: `src/tools/generated-tools-index.ts`

**Interfaces:**

- Produces: `hookJsvmpInterpreter: ToolDefinition`
- Produces: `compareEnv: ToolDefinition`
- Produces: `buildJsvmpHook(mode: JsvmpMode, params: HookJsvmpParams): string`
- Produces: `createJsvmpHookId(mode: JsvmpMode, scriptUrl: string): string`
- Produces: `requireOpenBrowserContext(context: Context): BrowserContext`
- Produces: `writeHookResponse(response: Response, mode: JsvmpMode, persistent: boolean, frameUrl: string, registration?: RegisterPersistentHookResult): void`
- Produces: `collectEnvironment(properties: string[]): EnvironmentSnapshot`
- Consumes: `Context.getSelectedFrame()`, `Context.getBrowserContext()`, and `Context.getPersistentHookRegistry()`.

- [ ] **Step 1: Write failing tool-contract tests**

```ts
it('registers a persistent transparent probe for existing and future frames', async () => {
  await hookJsvmpInterpreter.handler(
    {params: {mode: 'transparent', persistent: true, script_url: 'sdk.js'}},
    response,
    context,
  );
  assert.equal(registration.applyMode, 'existing-and-future');
  assert.match(registration.hookId, /^jsvmp_transparent:/);
  assert.equal(result.data.data_location, 'window.__mcp_jsvmp_log');
});

it('collects standard and requested environment properties', async () => {
  await compareEnv.handler(
    {params: {properties: ['navigator.userAgent']}},
    response,
    context,
  );
  assert.equal(result.data.custom['navigator.userAgent'].type, 'string');
});
```

- [ ] **Step 2: Run the focused tool test and confirm RED**

Run: `npm run build:compile && node --require ./build/tests/setup.js --test build/tests/unit/tools/jsvmp/jsvmp.test.js`

Expected: failure because the JSVMP tool module is not implemented.

- [ ] **Step 3: Implement handlers with current project response conventions**

```ts
export const hookJsvmpInterpreter = defineTool({
  name: 'hook_jsvmp_interpreter',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: hookSchema,
  handler: async (request, response, context) => {
    const mode = request.params.mode ?? 'proxy';
    const script = buildJsvmpHook(mode, request.params);
    const frame = context.getSelectedFrame();
    const persistent = request.params.persistent ?? true;
    const registration = persistent
      ? await context.getPersistentHookRegistry().register({
          context: requireOpenBrowserContext(context),
          hookId: createJsvmpHookId(mode, request.params.script_url ?? ''),
          script,
          source: 'inject_hook',
          requestedWorld: 'main',
          applyMode: 'existing-and-future',
        })
      : await frame.evaluate(script).then(() => undefined);
    writeHookResponse(response, mode, persistent, frame.url(), registration);
  },
});

export const compareEnv = defineTool({
  name: 'compare_env',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {properties: zod.array(zod.string()).optional()},
  handler: async (request, response, context) => {
    const data = await context
      .getSelectedFrame()
      .evaluate(collectEnvironment, request.params.properties ?? []);
    response.setStructuredContent({
      success: true,
      message: '浏览器环境采集完成',
      tooltype: 'compare_env',
      data,
    });
  },
});
```

Persistent mode uses the current BrowserContext registry with a stable mode/URL hook ID; one-shot mode evaluates only the selected Frame. Both modes retain the reference timing warning for already-loaded pages.

- [ ] **Step 4: Register the domain and regenerate the index**

Run: `npm run build:index`

Expected: `src/tools/generated-tools-index.ts` imports `jsvmpManifest` and registers both named exports.

- [ ] **Step 5: Re-run both focused test files and confirm GREEN**

Run: `npm run build:compile && node --require ./build/tests/setup.js --test build/tests/unit/tools/jsvmp/*.test.js`

Expected: all JSVMP tool and script tests pass.

### Task 3: Final-diff verification

**Files:**

- Inspect: all files changed by Tasks 1–2

**Interfaces:**

- Verifies the two public MCP schemas, runtime side effects, manifest discovery, formatting, and TypeScript compatibility.

- [ ] **Step 1: Inspect the scoped final diff and registration output**

Run: `git diff -- src/tools/jsvmp tests/unit/tools/jsvmp src/tools/generated-tools-index.ts docs/superpowers/plans/2026-08-13-jsvmp-runtime-probes.md`

- [ ] **Step 2: Run final project gates after the last code change**

Run: `npm run typecheck`

Run: `npm run test:unit`

Run: `npm run check-format`

Expected: every command exits 0. If a gate reveals an unrelated pre-existing failure, preserve its exact output and report it separately instead of changing unrelated files.

- [ ] **Step 3: Confirm no unrelated user changes were modified**

Run: `git status --short`

Expected: the pre-existing dirty files remain untouched; only the scoped JSVMP files, generated registry, and this plan are newly changed by this task.
