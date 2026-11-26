/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `@toon-format/toon` 懒加载器（参考 chrome-devtools-mcp/src/third_party/index.ts#getToonEncode）。
 * 独立放在 L0 轻量模块中，避免 CLI 侧引入 patchright 等重型运行时依赖。
 */

export type ToonEncode = (val: unknown) => string;

let cachedToonEncode: ToonEncode | undefined;

export async function getToonEncode(): Promise<ToonEncode> {
  if (cachedToonEncode) {
    return cachedToonEncode;
  }
  try {
    const {encode} = await import('@toon-format/toon');
    cachedToonEncode = encode;
    return encode;
  } catch {
    throw new Error(
      'The `@toon-format/toon` package is required to use --output-format toon. ' +
        'Make sure it is installed:\n' +
        '- npm install @toon-format/toon',
    );
  }
}
