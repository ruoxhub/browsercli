/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {appendFileSync, mkdirSync} from 'node:fs';
import path from 'node:path';

import {
  getToolResultRecordingConfig,
  type ResolvedToolResultRecordingConfig,
} from '../config.js';
import {safeStringify} from '../utils/safeJson.js';

export interface ToolResultRecord {
  toolName: string;
  success: boolean;
  startedAt: string;
  durationMs: number;
  input?: Record<string, unknown>;
  request?: Record<string, unknown>;
  response?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

export class ToolResultRecorder {
  constructor(
    private readonly configProvider = getToolResultRecordingConfig,
    private readonly now = () => new Date(),
  ) {}

  record(record: ToolResultRecord): void {
    const config = this.configProvider();
    if (!config.enabled) return;

    try {
      this.write(config, this.normalizeRecord(record));
    } catch {
      // Tool result recording is diagnostic only; it must not affect tools.
    }
  }

  private normalizeRecord(record: ToolResultRecord): ToolResultRecord {
    const inputSource = record.input ?? record.request;
    const input = inputSource ? {...inputSource} : undefined;
    return input ? {...record, input} : record;
  }

  private write(
    config: ResolvedToolResultRecordingConfig,
    record: ToolResultRecord,
  ): void {
    mkdirSync(config.outputDir, {recursive: true});
    const filePath = path.join(config.outputDir, this.fileName());
    appendFileSync(filePath, safeStringify(record) + '\n', 'utf-8');
  }

  private fileName(): string {
    return `${this.now().toISOString().slice(0, 10)}.jsonl`;
  }
}
