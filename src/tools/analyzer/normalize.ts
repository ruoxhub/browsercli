/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {CollectedFileEntry} from './types.js';

export function normalizeCollectedFiles(
  result: unknown,
): Array<{url: string; content: string; size: number; type: string}> {
  if (!result || typeof result !== 'object') {
    return [];
  }
  const files = (result as {files?: unknown}).files;
  if (!Array.isArray(files)) {
    return [];
  }
  return files
    .filter(
      (
        item,
      ): item is {
        url?: unknown;
        content?: unknown;
        size?: unknown;
        type?: unknown;
      } => Boolean(item && typeof item === 'object'),
    )
    .map(file => ({
      url: typeof file.url === 'string' ? file.url : 'unknown',
      content: typeof file.content === 'string' ? file.content : '',
      size:
        typeof file.size === 'number'
          ? file.size
          : typeof file.content === 'string'
            ? file.content.length
            : 0,
      type: typeof file.type === 'string' ? file.type : 'external',
    }));
}

export function toRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function toMirroredNetworkEntry(
  entry: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }
  const request = toRecord(entry.request);
  if (!request || typeof request.url !== 'string') {
    return undefined;
  }
  const mirrored: Record<string, unknown> = {
    ...(typeof entry.ts === 'string' ? {ts: entry.ts} : {}),
    ...(typeof entry.stage === 'string' ? {stage: entry.stage} : {}),
    ...(typeof entry.source === 'string' ? {source: entry.source} : {}),
    request,
  };
  const response = toRecord(entry.response);
  if (response) {
    mirrored.response = response;
  }
  if (typeof entry.note === 'string') {
    mirrored.note = entry.note;
  }
  return mirrored;
}

export function toMirroredScriptEntry(
  entry: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }
  const scriptUrl =
    typeof entry.scriptUrl === 'string'
      ? entry.scriptUrl
      : typeof entry.url === 'string'
        ? entry.url
        : undefined;
  const hasLocator = Boolean(toRecord(entry.locator));
  const hasScriptId = typeof entry.scriptId === 'string';
  if (!scriptUrl || (!hasLocator && !hasScriptId)) {
    return undefined;
  }
  const mirrored: Record<string, unknown> = {
    ...(typeof entry.ts === 'string' ? {ts: entry.ts} : {}),
    ...(typeof entry.source === 'string' ? {source: entry.source} : {}),
    url: scriptUrl,
  };
  if (hasScriptId) {
    mirrored.scriptId = entry.scriptId;
  }
  const locator = toRecord(entry.locator);
  if (locator) {
    mirrored.locator = locator;
  }
  if (typeof entry.note === 'string') {
    mirrored.note = entry.note;
  }
  return mirrored;
}