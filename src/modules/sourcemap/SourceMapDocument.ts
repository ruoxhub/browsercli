import {createHash} from 'node:crypto';

import {
  AnyMap,
  decodedMappings,
  generatedPositionFor,
  GREATEST_LOWER_BOUND,
  LEAST_UPPER_BOUND,
  originalPositionFor,
  TraceMap,
} from '@jridgewell/trace-mapping';

import {
  type BasicSourceMap,
  type IndexedSourceMap,
  type MaterializedSourceMap,
  type SourceMapBias,
  type SourceMapDiffInput,
  type SourceMapDiffResult,
  SourceMapError,
  type SourceMapExtensionSummary,
  type SourceMapLookupInput,
  type SourceMapLookupResult,
  type SourceMapSourceEntry,
  type SourceMapSummary,
} from './types.js';

interface NormalizedMappingRow {
  generatedLine: number;
  generatedColumn: number;
  source: string | null;
  originalLine: number | null;
  originalColumn: number | null;
  name: string | null;
}

const coordinateConvention = {
  line: '1-based',
  column: '0-based',
} as const;

function toTraceBias(bias: SourceMapBias | undefined): 1 | -1 {
  return bias === 'least_upper_bound'
    ? LEAST_UPPER_BOUND
    : GREATEST_LOWER_BOUND;
}

function compareNullable<T extends number | string>(
  left: T | null,
  right: T | null,
): number {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return left < right ? -1 : 1;
}

function compareMappingRows(
  left: NormalizedMappingRow,
  right: NormalizedMappingRow,
): number {
  return (
    left.generatedLine - right.generatedLine ||
    left.generatedColumn - right.generatedColumn ||
    compareNullable(left.source, right.source) ||
    compareNullable(left.originalLine, right.originalLine) ||
    compareNullable(left.originalColumn, right.originalColumn) ||
    compareNullable(left.name, right.name)
  );
}

function nextMapping(
  iterator: Generator<NormalizedMappingRow>,
): NormalizedMappingRow | undefined {
  const next = iterator.next();
  return next.done ? undefined : next.value;
}

function contentHash(content: string | null): string {
  return createHash('sha256')
    .update(content === null ? 'null:' : `value:${content}`)
    .digest('hex');
}

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
    sectionsCount: Array.isArray(raw.sections) ? raw.sections.length : 0,
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

  lookup(input: SourceMapLookupInput): SourceMapLookupResult {
    const bias = toTraceBias(input.bias);
    if (input.direction === 'generated_to_original') {
      const match = originalPositionFor(this.traceMap, {
        line: input.line,
        column: input.column,
        bias,
      });
      if (match.line === null || match.column === null) {
        return {coordinateConvention, match: null, exact: false};
      }
      const reverse =
        match.source === null
          ? null
          : generatedPositionFor(this.traceMap, {
              source: match.source,
              line: match.line,
              column: match.column,
              bias,
            });
      return {
        coordinateConvention,
        match: {
          line: match.line,
          column: match.column,
          ...(match.source === null ? {} : {source: match.source}),
          ...(match.name === null ? {} : {name: match.name}),
        },
        exact: reverse?.line === input.line && reverse.column === input.column,
      };
    }

    const source = this.resolveOriginalSource(input.source);
    if (source === undefined) {
      return {coordinateConvention, match: null, exact: false};
    }
    const match = generatedPositionFor(this.traceMap, {
      source,
      line: input.line,
      column: input.column,
      bias,
    });
    if (match.line === null || match.column === null) {
      return {coordinateConvention, match: null, exact: false};
    }
    const reverse = originalPositionFor(this.traceMap, {
      line: match.line,
      column: match.column,
      bias,
    });
    return {
      coordinateConvention,
      match: {line: match.line, column: match.column},
      exact:
        reverse.line === input.line &&
        reverse.column === input.column &&
        reverse.source === source,
    };
  }

  diff(
    other: SourceMapDocument,
    input: SourceMapDiffInput,
  ): SourceMapDiffResult {
    const summaryChanged =
      'sections' in this.raw !== 'sections' in other.raw ||
      JSON.stringify(this.summary) !== JSON.stringify(other.summary);
    const sources = {added: [], removed: [], contentChanged: []} as {
      added: string[];
      removed: string[];
      contentChanged: string[];
    };

    if (input.mode !== 'summary') {
      const leftSources = new Map(
        this.getSources().map(source => [
          source.resolvedSource,
          contentHash(source.content),
        ]),
      );
      const rightSources = new Map(
        other
          .getSources()
          .map(source => [source.resolvedSource, contentHash(source.content)]),
      );
      for (const [source, hash] of leftSources) {
        const otherHash = rightSources.get(source);
        if (otherHash === undefined) sources.removed.push(source);
        else if (otherHash !== hash) sources.contentChanged.push(source);
      }
      for (const source of rightSources.keys()) {
        if (!leftSources.has(source)) sources.added.push(source);
      }
    }

    const changes: SourceMapDiffResult['changes'] = [];
    let mappingChanges = 0;
    if (input.mode === 'mappings') {
      const maxChanges = Math.max(0, Math.floor(input.maxChanges));
      const left = this.mappingRows();
      const right = other.mappingRows();
      let leftRow = nextMapping(left);
      let rightRow = nextMapping(right);
      while (leftRow !== undefined || rightRow !== undefined) {
        const comparison =
          leftRow === undefined
            ? 1
            : rightRow === undefined
              ? -1
              : compareMappingRows(leftRow, rightRow);
        if (comparison === 0) {
          leftRow = nextMapping(left);
          rightRow = nextMapping(right);
          continue;
        }
        const kind = comparison < 0 ? 'removed' : 'added';
        const row = comparison < 0 ? leftRow : rightRow;
        mappingChanges += 1;
        if (changes.length < maxChanges && row !== undefined) {
          changes.push({kind, mapping: JSON.stringify(row)});
        }
        if (comparison < 0) leftRow = nextMapping(left);
        else rightRow = nextMapping(right);
      }
    }

    const sourceChanges =
      sources.added.length +
      sources.removed.length +
      sources.contentChanged.length;
    const totalChanges =
      input.mode === 'summary'
        ? Number(summaryChanged)
        : input.mode === 'sources'
          ? sourceChanges
          : mappingChanges;
    return {
      summaryChanged,
      sources,
      mappingChanges,
      totalChanges,
      changes,
      truncated: mappingChanges > changes.length,
    };
  }

  private resolveOriginalSource(input: string): string | undefined {
    const exactIndex = this.traceMap.sources.findIndex(
      (source, index) =>
        source === input || this.traceMap.resolvedSources[index] === input,
    );
    if (exactIndex >= 0) {
      return this.traceMap.resolvedSources[exactIndex] ?? input;
    }

    const suffix = input.replaceAll('\\', '/');
    const matches = this.traceMap.resolvedSources.filter((source, index) => {
      const rawSource = this.traceMap.sources[index]?.replaceAll('\\', '/');
      return (
        source.replaceAll('\\', '/').endsWith(suffix) ||
        rawSource?.endsWith(suffix)
      );
    });
    return matches.length === 1 ? matches[0] : undefined;
  }

  private *mappingRows(): Generator<NormalizedMappingRow> {
    const lines = decodedMappings(this.traceMap);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      for (const segment of lines[lineIndex] ?? []) {
        const sourceIndex = segment.length >= 4 ? segment[1] : undefined;
        const nameIndex = segment.length === 5 ? segment[4] : undefined;
        yield {
          generatedLine: lineIndex + 1,
          generatedColumn: segment[0],
          source:
            sourceIndex === undefined
              ? null
              : (this.traceMap.resolvedSources[sourceIndex] ?? null),
          originalLine: segment.length >= 4 ? segment[2] + 1 : null,
          originalColumn: segment.length >= 4 ? segment[3] : null,
          name:
            nameIndex === undefined
              ? null
              : (this.traceMap.names[nameIndex] ?? null),
        };
      }
    }
  }

  getTraceMap(): TraceMap {
    return this.traceMap;
  }
}
