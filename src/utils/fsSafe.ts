/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {createHash} from 'node:crypto';
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {getEnvValue} from '../config.js';

import {ErrorCodes, ToolError} from './errors.js';

/**
 * Validate a user-provided file path to prevent directory traversal attacks.
 *
 * Strategy:
 * - Absolute paths are allowed as-is (user/dev controls the destination)
 * - Relative paths with `..` that escape the allowed directory are rejected
 * - When BROWSER_OUTPUT_DIR is set, restrict relative paths to that directory
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
  const allowedBase = getEnvValue('BROWSER_OUTPUT_DIR') ?? process.cwd();
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
        `Set BROWSER_OUTPUT_DIR to configure the allowed output path.`,
    );
  }

  return resolved;
}

export interface AtomicWriteResult {
  /** 实际写入的字节数，恒等于 Buffer.byteLength(source, 'utf8')。 */
  bytesWritten: number;
  /** 落盘源码的 SHA-256（UTF-8 字节）。 */
  sha256: string;
}

/**
 * 原子写入完整源码：先写入目标同目录下的唯一临时文件，校验字节长度与
 * SHA-256 与内存源码一致后再 rename 覆盖目标。任何失败都会删除临时文件
 * 并保留已存在的旧目标文件。
 */
export async function writeScriptFileAtomic(
  filePath: string,
  source: string,
): Promise<AtomicWriteResult> {
  const bytes = Buffer.from(source, 'utf8');
  const expectedBytes = bytes.length;
  const expectedSha256 = createHash('sha256').update(bytes).digest('hex');
  const dir = path.dirname(filePath);
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random()
      .toString(36)
      .slice(2)}.tmp`,
  );

  try {
    await mkdir(dir, {recursive: true});
    await writeFile(tmpPath, bytes);

    const written = await readFile(tmpPath);
    if (written.length !== expectedBytes) {
      throw new ToolError(
        ErrorCodes.SOURCE_INTEGRITY_MISMATCH,
        `写入校验失败：期望 ${expectedBytes} 字节，实际落盘 ${written.length} 字节`,
        {filePath, expectedBytes, actualBytes: written.length},
      );
    }
    const writtenSha256 = createHash('sha256').update(written).digest('hex');
    if (writtenSha256 !== expectedSha256) {
      throw new ToolError(
        ErrorCodes.SOURCE_INTEGRITY_MISMATCH,
        `写入校验失败：源码 SHA-256 不匹配（期望 ${expectedSha256}，实际 ${writtenSha256}）`,
        {filePath, expectedSha256, actualSha256: writtenSha256},
      );
    }

    await rename(tmpPath, filePath);
    return {bytesWritten: expectedBytes, sha256: expectedSha256};
  } catch (error) {
    try {
      await rm(tmpPath, {force: true});
    } catch {
      // 清理临时文件失败不应掩盖原始错误。
    }
    if (error instanceof ToolError) {
      throw error;
    }
    throw new ToolError(
      ErrorCodes.SOURCE_WRITE_FAILED,
      `脚本源码写入失败（目标 ${filePath}）：${error instanceof Error ? error.message : String(error)}`,
      {filePath},
    );
  }
}
