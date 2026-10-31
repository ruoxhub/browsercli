# Browser Connection Configuration Precedence and Fallback

Browser-CLI previously required explicit command-line flags on every `browsercli browser connect` invocation or during daemon startup, ignoring user-level preferences configured in `~/.browsercli/config.json` and preventing seamless reconnection to existing remote Chrome debugging endpoints. We decided to establish a strict four-tier configuration precedence cascade (`CLI flags` > `environment variables` > `~/.browsercli/config.json` > `system defaults`), unify connection targets across CLI commands and daemon startup auto-connect, and support flat keys (`browserUrl`, `wsEndpoint`, `executablePath`, `headless`, `cloak`) with higher-precedence mutual exclusion suppression while keeping runtime connections in-memory without mutating user configuration on disk.

## Consequences

- Executing `browsercli browser connect` without arguments seamlessly falls back to connection targets specified in `~/.browsercli/config.json` (such as a remote Chrome instance at `http://127.0.0.1:9222`), eliminating repetitive flag entry for daily workflows.
- Daemon background startup recognizes flat connection targets in user configuration, automatically establishing the browser session upon socket readiness when a remote endpoint is configured.
- Passing explicit CLI target flags (e.g., `--ws-endpoint`) cleanly suppresses conflicting config-file target keys (such as `browserUrl`) without triggering mutual-exclusion validation errors.
- Invoking `browsercli browser connect` modifies only the in-memory runtime connection state for the active daemon session and never silently mutates `~/.browsercli/config.json`, preserving explicit configuration control via `browsercli config --set`.
- When neither CLI flags nor configuration files declare a remote target, connection falls back cleanly to launching a local Chrome/Chromium instance under configured flags.
