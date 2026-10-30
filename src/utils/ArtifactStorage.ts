/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';

import {safeStringify} from './safeJson.js';

export const DEFAULT_OFFLOAD_THRESHOLD_BYTES = 16 * 1024; // 16 KB

export interface ArtifactStorageConfig {
  thresholdBytes?: number;
  outputDir?: string;
}

export interface OffloadReference {
  _referenceOverValue: true;
  artifactPath: string;
  totalBytes: number;
  summary: string;
  preview: unknown;
  totalItems?: number;
}

export class ArtifactStorage {
  private readonly thresholdBytes: number;
  private readonly outputDir: string;

  constructor(config: ArtifactStorageConfig = {}) {
    this.thresholdBytes =
      config.thresholdBytes ?? DEFAULT_OFFLOAD_THRESHOLD_BYTES;
    this.outputDir = config.outputDir ?? 'artifacts/outputs';
  }

  shouldOffload(content: unknown): boolean {
    if (content === null || content === undefined) return false;
    let size = 0;
    if (typeof content === 'string') {
      size = Buffer.byteLength(content, 'utf8');
    } else {
      try {
        const json = safeStringify(content);
        size = Buffer.byteLength(json, 'utf8');
      } catch {
        return false;
      }
    }
    return size > this.thresholdBytes;
  }

  saveArtifact(
    toolName: string,
    content: unknown,
  ): {filePath: string; byteSize: number} {
    const resolvedDir = path.resolve(process.cwd(), this.outputDir);
    mkdirSync(resolvedDir, {recursive: true});

    const safeToolName = toolName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${safeToolName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`;
    const fullPath = path.join(resolvedDir, filename);

    const serialized =
      typeof content === 'string'
        ? content
        : safeStringify(content, undefined, 2);

    writeFileSync(fullPath, serialized, 'utf8');
    const byteSize = Buffer.byteLength(serialized, 'utf8');

    return {
      filePath: fullPath,
      byteSize,
    };
  }

  createReference(toolName: string, content: unknown): OffloadReference {
    const {filePath, byteSize} = this.saveArtifact(toolName, content);

    let preview: unknown = null;
    let totalItems: number | undefined;

    if (Array.isArray(content)) {
      totalItems = content.length;
      preview = content.slice(0, 3);
    } else if (
      typeof content === 'object' &&
      content !== null &&
      'data' in content &&
      Array.isArray((content as Record<string, unknown>).data)
    ) {
      const dataArr = (content as Record<string, unknown>).data as unknown[];
      totalItems = dataArr.length;
      preview = dataArr.slice(0, 3);
    } else if (typeof content === 'string') {
      preview =
        content.slice(0, 300) + (content.length > 300 ? '... [truncated]' : '');
    } else if (typeof content === 'object' && content !== null) {
      const record = content as Record<string, unknown>;
      const keys = Object.keys(record);
      const sampleObj: Record<string, unknown> = {};
      for (const k of keys.slice(0, 5)) {
        sampleObj[k] = record[k];
      }
      preview = sampleObj;
    }

    return {
      _referenceOverValue: true,
      artifactPath: filePath,
      totalBytes: byteSize,
      summary: `Content exceeded inline token budget (${byteSize} bytes). Full content saved to file.`,
      preview,
      ...(totalItems !== undefined ? {totalItems} : {}),
    };
  }
}

export const globalArtifactStorage = new ArtifactStorage();
