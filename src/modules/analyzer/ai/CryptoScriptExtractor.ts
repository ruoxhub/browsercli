/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {HookRecordRow} from '../../session/types.js';
import type {CryptoSnippet} from './types.js';

const LINE_PREFIX_WIDTH = 5;
const SOURCE_UNAVAILABLE = '[source unavailable]';
const DEFAULT_RADIUS = 10;

interface ParsedFrame {
  functionName: string;
  file: string;
  line: number;
  column: number;
}

function parseFrame(frame: string): ParsedFrame | null {
  const match = frame.match(
    /^\s*at\s+(?:(.+?)\s+\()?([^()\s]+):(\d+):(\d+)\)?\s*$/,
  );
  if (!match) {
    return null;
  }
  const file = match[2];
  const line = Number(match[3]);
  const column = Number(match[4]);
  if (
    !file.endsWith('.js') ||
    !Number.isInteger(line) ||
    !Number.isInteger(column) ||
    line < 1 ||
    column < 1
  ) {
    return null;
  }
  return {
    functionName: match[1] ?? '',
    file,
    line,
    column,
  };
}

function findJsFrame(callStack: string): ParsedFrame | null {
  if (!callStack) {
    return null;
  }
  for (const rawFrame of callStack.split('\n')) {
    const frame = rawFrame.trim();
    if (!frame.startsWith('at ')) {
      continue;
    }
    const parsed = parseFrame(frame);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

/**
 * Given source text and a 1-based line number, extract context from
 * `max(1, line - radius)` to `line + radius`, prefixing each line with
 * its line number for readability. Returns '' for missing source or
 * out-of-range line numbers.
 */
export function sliceSourceContext(
  source: string | null | undefined,
  line: number | null | undefined,
  radius = DEFAULT_RADIUS,
): string {
  if (!source) {
    return '';
  }
  if (typeof line !== 'number' || !Number.isInteger(line) || line < 1) {
    return '';
  }
  const lines = source.split('\n');
  if (line > lines.length) {
    return '';
  }

  const start = Math.max(1, line - radius);
  const end = Math.min(lines.length, line + radius);

  const padded: string[] = [];
  for (let i = start; i <= end; i++) {
    padded.push(`${String(i).padStart(LINE_PREFIX_WIDTH)} | ${lines[i - 1]}`);
  }
  return padded.join('\n');
}

function preview(value: string | null | undefined): string | undefined {
  return value == null || value === '' ? undefined : value;
}

export class CryptoScriptExtractor {
  extractSnippets(
    hooks: HookRecordRow[],
    scriptGetter?: (url: string) => string | null,
  ): CryptoSnippet[] {
    const snippets: CryptoSnippet[] = [];
    const seen = new Set<string>();

    for (const hook of hooks) {
      if (!hook.callStack) {
        continue;
      }
      const frame = findJsFrame(hook.callStack);
      if (!frame) {
        continue;
      }

      const key = `${frame.file}:${frame.line}:${frame.column}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      const functionName = frame.functionName || hook.functionName;

      let sourceSnippet = SOURCE_UNAVAILABLE;
      if (scriptGetter) {
        const source = scriptGetter(frame.file);
        if (source) {
          sourceSnippet =
            sliceSourceContext(source, frame.line) || SOURCE_UNAVAILABLE;
        }
      }

      snippets.push({
        functionName,
        hookType: hook.hookType,
        file: frame.file,
        line: frame.line,
        column: frame.column,
        sourceSnippet,
        argsPreview: preview(hook.arguments),
        resultPreview: preview(hook.result),
      });
    }

    return snippets;
  }
}
