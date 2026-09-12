# Tool Categories & Reference Models Index

Index of all `proxycli` tool categories, domains, and their corresponding reference documentation files (`references/<module>.md`).

## Category-to-Reference Map

| Category / Model Name | Reference File                            | Primary Responsibilities                                                            |
| --------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------- |
| `browser`             | [`references/browser.md`](./browser.md)   | Tab management, URL navigation, frame/iframe selection, health check                |
| `script`              | [`references/script.md`](./script.md)     | Loaded script listing, source retrieval, keyword search, target snapshots           |
| `analyzer`            | [`references/analyzer.md`](./analyzer.md) | AST deobfuscation, code understanding, crypto detection, CAPTCHA inspection         |
| `hook`                | [`references/hook.md`](./hook.md)         | Non-blocking runtime hooks, crypto library hooks (CryptoJS/RSA/SM), auto-hook       |
| `debugger`            | [`references/debugger.md`](./debugger.md) | Line & XHR breakpoints, execution stepping, scope inspection, eval                  |
| `stealth`             | [`references/stealth.md`](./stealth.md)   | Anti-anti-debug, infinite debugger loop bypass, fingerprint stealth scripts         |
| `wasm`                | [`references/wasm.md`](./wasm.md)         | WebAssembly capture, dump, decompilation (C-like), disassembly (WAT), sandboxed run |
| `dom`                 | [`references/dom.md`](./dom.md)           | DOM selector query, input/click/drag simulation, form fill, screenshots             |
| `network`             | [`references/network.md`](./network.md)   | Request capture, initiator stack trace, replay, cURL export, WebSocket frames       |
| `proxy`               | [`references/proxy.md`](./proxy.md)       | MITM capture proxy, rewrite rules, HAR export, non-browser & local process traffic  |
| `rebuild`             | [`references/rebuild.md`](./rebuild.md)   | Offline bundle building, evidence logging, env diffing, SourceMap recovery          |
| `workflow`            | [`references/workflow.md`](./workflow.md) | Reverse-engineering next-step advisor, stage explanation, parameter workflows       |
| `session`             | [`references/session.md`](./session.md)   | Cookie & Storage extraction, session save/restore, video element inspection         |

---

## Tool-to-Reference Quick Lookup

| Tool Name                                                     | Module Reference         |
| ------------------------------------------------------------- | ------------------------ |
| `analyze_websocket_messages`                                  | `references/network.md`  |
| `anti_anti_debug`                                             | `references/stealth.md`  |
| `auto_hook`                                                   | `references/hook.md`     |
| `break_on_xhr`                                                | `references/debugger.md` |
| `bypass_debugger`                                             | `references/stealth.md`  |
| `capture_video_frame`                                         | `references/session.md`  |
| `check_browser_health`                                        | `references/browser.md`  |
| `clear_network_requests`                                      | `references/network.md`  |
| `clear_mitm_requests`                                         | `references/proxy.md`    |
| `click` / `click_at` / `click_element`                        | `references/dom.md`      |
| `collect_code`                                                | `references/script.md`   |
| `collect_wasm`                                                | `references/wasm.md`     |
| `collection_diff`                                             | `references/script.md`   |
| `create_hook`                                                 | `references/hook.md`     |
| `deobfuscate_code`                                            | `references/analyzer.md` |
| `detect_captcha`                                              | `references/analyzer.md` |
| `diff_env_requirements`                                       | `references/rebuild.md`  |
| `dump_session_state`                                          | `references/session.md`  |
| `dump_target_scripts`                                         | `references/script.md`   |
| `evaluate_on_callframe`                                       | `references/debugger.md` |
| `evaluate_script`                                             | `references/debugger.md` |
| `explain_reverse_stage`                                       | `references/workflow.md` |
| `export_mitm_ca`                                              | `references/proxy.md`    |
| `export_rebuild_bundle`                                       | `references/rebuild.md`  |
| `export_request_as_curl`                                      | `references/network.md`  |
| `fill` / `fill_form`                                          | `references/dom.md`      |
| `find_clickable_elements`                                     | `references/dom.md`      |
| `find_in_script`                                              | `references/script.md`   |
| `get_dom_structure`                                           | `references/dom.md`      |
| `get_hook_data`                                               | `references/hook.md`     |
| `get_mitm_request`                                            | `references/proxy.md`    |
| `get_network_request`                                         | `references/network.md`  |
| `get_parameter_workflow`                                      | `references/workflow.md` |
| `get_paused_info`                                             | `references/debugger.md` |
| `get_request_initiator`                                       | `references/network.md`  |
| `get_script_source`                                           | `references/script.md`   |
| `get_storage`                                                 | `references/session.md`  |
| `get_video_info`                                              | `references/session.md`  |
| `get_websocket_message` / `get_websocket_messages`            | `references/network.md`  |
| `handle_dialog`                                               | `references/dom.md`      |
| `hook_cryptojs` / `hook_jsencrypt` / `hook_smcrypto`          | `references/hook.md`     |
| `hook_function`                                               | `references/hook.md`     |
| `inject_hook`                                                 | `references/hook.md`     |
| `inject_stealth`                                              | `references/stealth.md`  |
| `inspect_locals` / `inspect_object`                           | `references/debugger.md` |
| `list_breakpoints`                                            | `references/debugger.md` |
| `list_created_hooks` / `list_hooks` / `list_persistent_hooks` | `references/hook.md`     |
| `list_frames`                                                 | `references/browser.md`  |
| `list_mitm_requests`                                          | `references/proxy.md`    |
| `list_network_requests`                                       | `references/network.md`  |
| `list_pages`                                                  | `references/browser.md`  |
| `list_parameter_workflows`                                    | `references/workflow.md` |
| `list_scripts`                                                | `references/script.md`   |
| `list_session_states`                                         | `references/session.md`  |
| `list_stealth_features` / `list_stealth_presets`              | `references/stealth.md`  |
| `list_targets`                                                | `references/script.md`   |
| `list_websocket_connections`                                  | `references/network.md`  |
| `load_session_state`                                          | `references/session.md`  |
| `mitm_add_host_filter`                                        | `references/proxy.md`    |
| `mitm_add_rule`                                               | `references/proxy.md`    |
| `mitm_clear_host_filters`                                     | `references/proxy.md`    |
| `mitm_clear_rules`                                            | `references/proxy.md`    |
| `mitm_configure_local_apps`                                   | `references/proxy.md`    |
| `mitm_export_har`                                             | `references/proxy.md`    |
| `mitm_list_host_filters`                                      | `references/proxy.md`    |
| `mitm_list_local_processes`                                   | `references/proxy.md`    |
| `mitm_list_rules`                                             | `references/proxy.md`    |
| `mitm_remove_host_filter`                                     | `references/proxy.md`    |
| `mitm_remove_rule`                                            | `references/proxy.md`    |
| `navigate_page`                                               | `references/browser.md`  |
| `new_page`                                                    | `references/browser.md`  |
| `pause`                                                       | `references/debugger.md` |
| `press_key`                                                   | `references/dom.md`      |
| `query_dom`                                                   | `references/dom.md`      |
| `rebuild_bundle`                                              | `references/rebuild.md`  |
| `recommend_next_step`                                         | `references/workflow.md` |
| `recommend_parameter_workflow`                                | `references/workflow.md` |
| `record_reverse_evidence`                                     | `references/rebuild.md`  |
| `remove_breakpoint` / `remove_xhr_breakpoint`                 | `references/debugger.md` |
| `remove_hook` / `unhook_function`                             | `references/hook.md`     |
| `replay_network_request` / `replay_network_request_batch`     | `references/network.md`  |
| `restore_session_state`                                       | `references/session.md`  |
| `resume`                                                      | `references/debugger.md` |
| `save_session_state`                                          | `references/session.md`  |
| `scroll_by`                                                   | `references/dom.md`      |
| `search_in_scripts` / `search_in_sources`                     | `references/script.md`   |
| `seek_video`                                                  | `references/session.md`  |
| `select_frame`                                                | `references/browser.md`  |
| `select_page`                                                 | `references/browser.md`  |
| `set_breakpoint` / `set_breakpoint_on_text`                   | `references/debugger.md` |
| `set_files`                                                   | `references/dom.md`      |
| `set_user_agent`                                              | `references/stealth.md`  |
| `sourcemap_diff`                                              | `references/rebuild.md`  |
| `sourcemap_discover`                                          | `references/rebuild.md`  |
| `sourcemap_lookup`                                            | `references/rebuild.md`  |
| `sourcemap_parse`                                             | `references/rebuild.md`  |
| `sourcemap_reconstruct_tree`                                  | `references/rebuild.md`  |
| `start_mitm_proxy`                                            | `references/proxy.md`    |
| `step_into` / `step_out` / `step_over`                        | `references/debugger.md` |
| `stop_mitm_proxy`                                             | `references/proxy.md`    |
| `take_screenshot`                                             | `references/dom.md`      |
| `trace_signature_generation`                                  | `references/rebuild.md`  |
| `type_text`                                                   | `references/dom.md`      |
| `wait_for_element`                                            | `references/dom.md`      |
| `wasm_capabilities`                                           | `references/wasm.md`     |
| `wasm_decompile`                                              | `references/wasm.md`     |
| `wasm_disassemble`                                            | `references/wasm.md`     |
| `wasm_dump`                                                   | `references/wasm.md`     |
| `wasm_inspect_sections`                                       | `references/wasm.md`     |
| `wasm_memory_inspect`                                         | `references/wasm.md`     |
| `wasm_offline_run`                                            | `references/wasm.md`     |
| `wasm_optimize`                                               | `references/wasm.md`     |
| `wasm_vmp_trace`                                              | `references/wasm.md`     |
| `xhr_to_js_breakpoint`                                        | `references/debugger.md` |
