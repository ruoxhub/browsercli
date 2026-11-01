# Remove Ego Bridge Layer and Related Command Configuration

The experimental `ego-bridge` connection layer introduced an external child process worker (`ego-bridge-worker`), complex process lifecycle tracking (`EgoBridgeManager`), custom task space queries (`browser space list`), and extensive parameter mutual-exclusion guards (`browserInvariants.ts`). Because this bridge coupled browser-cli to external desktop browser bindings, introduced asymmetric configuration invariants, and diverged default connection semantics, we decided to completely remove the ego bridge layer, its CLI subcommands (`browser space`), flags (`--ego`, `--keep-page`, `--profile`), and related configuration schema keys. Default connection semantics for `browsercli browser connect` are restored to launching a local Chromium/Chrome instance (`launch` mode), leaving `BrowserMode` cleanly constrained to `'launch' | 'remote'`.

## Consequences

- The codebase eliminates over 6,000 lines of specialized bridge worker code, custom CDP polyfills, and process management logic, reducing maintenance overhead and startup complexity.
- Browser connection semantics return to a predictable two-path model: explicit remote CDP debugging endpoints (`--browser-url` / `--ws-endpoint`) connect in `remote` mode, while omitted endpoints launch a local browser instance in `launch` mode.
- Configuration schemas and runtime invariants are simplified; configuration keys `browser.ego`, `browser.keepPage`, and `browser.egoProfile` as well as their environment variable counterparts are removed.
- CLI argument validation strictly rejects former ego-specific parameters, adhering to explicit failure instead of silent fallback.
