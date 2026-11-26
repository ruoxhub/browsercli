/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 已废弃的旧顶层生命周期命令（ADR-0007）。
 */
export const DEPRECATED_COMMANDS: Readonly<Record<string, string>> = {
  open: 'browsercli start',
  close: 'browsercli stop',
  list: 'browsercli status',
  'kill-all': 'browsercli stop --all',
  browser: 'browsercli start',
};

/**
 * 已收敛移除的重复工具迁移映射（ADR-0011），键统一为 snake_case。
 */
export const DEPRECATED_TOOLS: Readonly<Record<string, string>> = {
  step_into: 'browsercli debugger_step --direction into',
  step_over: 'browsercli debugger_step --direction over',
  step_out: 'browsercli debugger_step --direction out',
  hook_function:
    'browsercli create_hook --type function --params \'{"target":"<fn>"}\' --inject true',
  list_hooks: 'browsercli list_created_hooks',
  unhook_function: 'browsercli remove_hook --hookId <id>',
  search_in_scripts:
    'browsercli collect_code --returnMode pattern 或 browsercli search_in_sources',
  find_in_script:
    'browsercli search_in_sources --scriptId <id> --query <text> --contextChars 100',
  inspect_locals: 'browsercli get_paused_info --scopeFrames all',
  video: 'browsercli screencast_start / browsercli screencast_stop',
};

/**
 * 顶层 CLI 隐藏废弃命令全集：含旧生命周期命令与废弃工具的 snake_case / kebab-case 两种写法。
 */
export const DEPRECATED_HINTS: Readonly<Record<string, string>> = (() => {
  const hints: Record<string, string> = {...DEPRECATED_COMMANDS};
  for (const [tool, replacement] of Object.entries(DEPRECATED_TOOLS)) {
    hints[tool] = replacement;
    const kebab = tool.replaceAll('_', '-');
    if (kebab !== tool) {
      hints[kebab] = replacement;
    }
  }
  return hints;
})();

/**
 * 查询 `call <tool>` 入口传入的工具名是否已废弃（同时兼容 snake_case 与 kebab-case）。
 */
export function resolveDeprecatedToolHint(
  requestedName: string,
): string | undefined {
  const normalized = requestedName.replaceAll('-', '_');
  return DEPRECATED_TOOLS[requestedName] ?? DEPRECATED_TOOLS[normalized];
}
