import {createHash} from 'node:crypto';

import {AnyMap, decodedMappings, TraceMap} from '@jridgewell/trace-mapping';

import {
  type BasicSourceMap,
  type IndexedSourceMap,
  type MaterializedSourceMap,
  SourceMapError,
  type SourceMapExtensionSummary,
  type SourceMapSourceEntry,
  type SourceMapSummary,
} from './types.js';

function parseFailed(message: string): never {
  throw new SourceMapError('PARSE_FAILED', message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isSourcesContent(value: unknown): value is Array<string | null> {
  return (
    Array.isArray(value) &&
    value.every(item => item === null || typeof item === 'string')
  );
}

function assertBasicSourceMap(value: Record<string, unknown>): BasicSourceMap {
  if (
    !isStringArray(value.sources) ||
    !isStringArray(value.names) ||
    typeof value.mappings !== 'string'
  ) {
    return parseFailed('SourceMap is missing required v3 fields');
  }
  if (
    value.sourcesContent !== undefined &&
    !isSourcesContent(value.sourcesContent)
  ) {
    return parseFailed('SourceMap sourcesContent must contain strings or null');
  }
  if (value.file !== undefined && typeof value.file !== 'string') {
    return parseFailed('SourceMap file must be a string');
  }
  if (value.sourceRoot !== undefined && typeof value.sourceRoot !== 'string') {
    return parseFailed('SourceMap sourceRoot must be a string');
  }
  return value as BasicSourceMap;
}

function assertIndexedSourceMap(
  value: Record<string, unknown>,
): IndexedSourceMap {
  if (!Array.isArray(value.sections)) {
    return parseFailed('Indexed SourceMap sections must be an array');
  }
  const sections = value.sections.map(section => {
    if (!isRecord(section) || !isRecord(section.offset)) {
      return parseFailed('Indexed SourceMap section is invalid');
    }
    const {line, column} = section.offset;
    if (
      !Number.isInteger(line) ||
      !Number.isInteger(column) ||
      (line as number) < 0 ||
      (column as number) < 0 ||
      !('map' in section) ||
      'url' in section
    ) {
      return parseFailed(
        'Indexed SourceMap section must contain an embedded map',
      );
    }
    return {
      offset: {line: line as number, column: column as number},
      map: assertMaterializedSourceMap(section.map),
    };
  });
  return {...value, version: 3, sections};
}

export function assertMaterializedSourceMap(
  value: unknown,
): MaterializedSourceMap {
  if (!isRecord(value) || value.version !== 3) {
    return parseFailed('SourceMap must be a version 3 object');
  }
  return 'sections' in value
    ? assertIndexedSourceMap(value)
    : assertBasicSourceMap(value);
}

function extensionSummary(
  name: string,
  value: unknown,
): SourceMapExtensionSummary {
  const serialized = JSON.stringify(value) ?? 'undefined';
  return {
    name,
    type: value === null ? 'null' : typeof value,
    bytes: Buffer.byteLength(serialized),
    sha256: createHash('sha256').update(serialized).digest('hex'),
  };
}

function buildSummary(
  raw: MaterializedSourceMap,
  traceMap: TraceMap,
): SourceMapSummary {
  const present =
    traceMap.sourcesContent?.filter(value => value !== null).length ?? 0;
  const missing = traceMap.sources.length - present;
  const debugId = typeof raw.debugId === 'string' ? raw.debugId : undefined;
  const ignoreList = Array.isArray(raw.x_google_ignoreList)
    ? raw.x_google_ignoreList.filter(
        (value): value is number => Number.isInteger(value) && value >= 0,
      )
    : [];
  const extensions = Object.entries(raw)
    .filter(([name]) => name.startsWith('x_') && name !== 'x_google_ignoreList')
    .map(([name, value]) => extensionSummary(name, value));
  return {
    version: 3,
    indexed: 'sections' in raw,
    sourcesCount: traceMap.sources.length,
    namesCount: traceMap.names.length,
    sectionsCount: 'sections' in raw ? raw.sections.length : 0,
    mappingsCount: decodedMappings(traceMap).reduce(
      (count, line) => count + line.length,
      0,
    ),
    sourcesContentCoverage: {
      present,
      missing,
      ratio:
        traceMap.sources.length === 0 ? 1 : present / traceMap.sources.length,
    },
    ...(debugId === undefined ? {} : {debugId}),
    ignoreList,
    extensions,
    warnings: [],
  };
}

export class SourceMapDocument {
  private constructor(
    private readonly raw: MaterializedSourceMap,
    private readonly traceMap: TraceMap,
    private readonly summary: SourceMapSummary,
  ) {}

  static parse(content: string, mapUrl?: string): SourceMapDocument {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new SourceMapError('PARSE_FAILED', 'SourceMap is not valid JSON', {
        cause: error,
      });
    }
    const raw = assertMaterializedSourceMap(parsed);
    const traceMap =
      'sections' in raw
        ? AnyMap(raw, mapUrl ?? null)
        : new TraceMap(raw, mapUrl ?? null);
    return new SourceMapDocument(raw, traceMap, buildSummary(raw, traceMap));
  }

  getSummary(): SourceMapSummary {
    return this.summary;
  }

  getSources(): SourceMapSourceEntry[] {
    return this.traceMap.resolvedSources.map((resolvedSource, index) => ({
      index,
      source: this.traceMap.sources[index] ?? resolvedSource,
      resolvedSource,
      content: this.traceMap.sourcesContent?.[index] ?? null,
    }));
  }

  getTraceMap(): TraceMap {
    return this.traceMap;
  }
}
