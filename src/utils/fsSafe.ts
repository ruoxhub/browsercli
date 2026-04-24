/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import path from 'node:path';

import {getEnvValue} from '../config.js';

/**
 * Validate a user-provided file path to prevent directory traversal attacks.
 *
 * Strategy:
 * - Absolute paths are allowed as-is (user/dev controls the destination)
 * - Relative paths with `..` that escape the allowed directory are rejected
 * - When JSREVERSER_OUTPUT_DIR is set, restrict relative paths to that directory
 *
 * @throws Error if the resolved path contains traversal sequences that escape
 *         the allowed directory (only applies to relative paths with `..`)
 */
export function validateOutputPath(userPath: string): string {
  const resolved = path.resolve(userPath);

  // Absolute paths: resolve and return (dev tool trust model)
  if (path.isAbsolute(userPath)) {
    return resolved;
  }

  // Relative paths: check for traversal outside allowed directory
  const allowedBase = getEnvValue('JSREVERSER_OUTPUT_DIR') ?? process.cwd();
  const normalizedBase = path.resolve(allowedBase) + path.sep;
  const resolvedWithTrailingSep = resolved + path.sep;

  // Also check the base itself (in case it doesn't end with sep)
  const resolvedBase = path.resolve(allowedBase);

  if (
    !resolvedWithTrailingSep.startsWith(normalizedBase) &&
    resolved !== resolvedBase
  ) {
    throw new Error(
      `Path traversal blocked: "${userPath}" resolves to "${resolved}" outside allowed directory "${allowedBase}". ` +
        `Set JSREVERSER_OUTPUT_DIR to configure the allowed output path.`,
    );
  }

  return resolved;
}
