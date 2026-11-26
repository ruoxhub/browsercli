---
status: accepted
---

# Consolidate Duplicate Tools and Unify the Hook Lifecycle

After aligning `browsercli` with `chrome-devtools-mcp` and completing ADR-0008/0009/0010, the 98-tool surface still carried five high-duplication clusters created by layering new aligned tools on top of legacy reverse-engineering commands: four stepping tools (`debugger_step` alongside `step_into`/`step_over`/`step_out`), two parallel hook lifecycles (`debugger.ts`'s `hook_function`/`list_hooks`/`unhook_function` backed by `window.__mcp_hooks__` vs `hook.ts`'s `HookManager` tools whose `remove_hook` could not restore wrapped functions), misleading URL-only `search_in_scripts` duplicating `collect_code(returnMode='pattern')`, single-script `find_in_script` duplicating `search_in_sources`, and `inspect_locals` overlapping `get_paused_info`.

We decided on conservative consolidation of these five clusters (98 → 89 tools) while keeping the five convenience/differentiated pairs (`click`/`click_at`, `fill`/`fill_form`, `wait_for`/`wait_for_element`, `emulate`/`resize_page`, `set_breakpoint_on_text`/`trace_function`):
- **Prefer aggregated parameterized tools** where a `chrome-devtools-mcp`-aligned tool overlaps fragmented legacy commands (`debugger_step` replaces `step_into`/`step_over`/`step_out`; `search_in_sources` absorbs `find_in_script`'s `scriptId`/`occurrence`/`contextChars` and exact column reporting; `get_paused_info` gains `scopeFrames?: 'top' | 'all'` to absorb `inspect_locals`; `search_in_scripts` is retired in favor of `collect_code --returnMode pattern` and `search_in_sources`).
- **Unify Hook ownership under `hook.ts`**: distinguish `PageHook` (single `BrowserPage`, restorable) from `PersistentHook` (context-wide) on one engine. `create_hook` gains optional `inject?: boolean` for one-step `PageHook` setup, `HookCodeBuilder` registers page-side restore handles so `remove_hook` restores wrapped functions as well as clearing stores, and `hook_function`/`list_hooks`/`unhook_function` are removed from `debugger.ts`.
- **Tiered compatibility contract**: parameter-equivalent legacy names stay in `ToolDefinition.aliases`, while structurally incompatible or retired tool names are removed from `ToolManifest` and routed through a shared `DEPRECATED_HINTS` table returning `COMMAND_DEPRECATED` across both top-level CLI commands (`cli.ts`) and `browsercli call <tool>` (`toolInvoke.ts`), preventing fuzzy substring misrouting.

## Consequences

- `ToolManifest` shrinks from 98 to 89 tools across the same 21 domains, reducing agent tool-selection ambiguity without losing multi-frame scope inspection, minified-line column lookup, or one-step function hooking.
- `remove_hook` becomes truly reversible for `PageHook` instances, eliminating the split between `window.__mcp_hooks__` and `HookManager`/`PageHookStore`.
- Both `browsercli <old_tool>` and `browsercli call <old_tool>` fail fast with actionable migration hints instead of silently matching another tool by substring, and in-repo skills (`.agents/skills/`, `.claude/skills/`, `plugin/browsercli/skills/`) plus contract tests are updated in lockstep.
