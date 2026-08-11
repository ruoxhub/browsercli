export type SourceMapErrorCode =
  | 'INVALID_SOURCE_INPUT'
  | 'SCRIPT_NOT_FOUND'
  | 'SOURCEMAP_REFERENCE_NOT_FOUND'
  | 'FETCH_BLOCKED'
  | 'FETCH_TOO_LARGE'
  | 'FETCH_TIMEOUT'
  | 'INDEXED_MAP_LIMIT_EXCEEDED'
  | 'PARSE_FAILED'
  | 'UNSUPPORTED_SEMANTICS'
  | 'MAP_NOT_FOUND'
  | 'OUTPUT_PATH_REQUIRED'
  | 'PATH_BLOCKED'
  | 'OUTPUT_EXISTS'
  | 'SOURCEMAP_CONFIG_INVALID';

export class SourceMapError extends Error {
  constructor(
    readonly code: SourceMapErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SourceMapError';
  }
}

export interface BasicSourceMap {
  version: 3;
  file?: string;
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: Array<string | null>;
  names: string[];
  mappings: string;
  [key: string]: unknown;
}

export interface IndexedSourceMapSection {
  offset: {line: number; column: number};
  map: MaterializedSourceMap;
}

export interface IndexedSourceMap {
  version: 3;
  sections: IndexedSourceMapSection[];
  [key: string]: unknown;
}

export type MaterializedSourceMap = BasicSourceMap | IndexedSourceMap;

export interface SourceMapExtensionSummary {
  name: string;
  type: string;
  bytes: number;
  sha256: string;
}

export interface SourceMapSummary {
  version: 3;
  indexed: boolean;
  sourcesCount: number;
  namesCount: number;
  sectionsCount: number;
  mappingsCount: number;
  sourcesContentCoverage: {present: number; missing: number; ratio: number};
  debugId?: string;
  ignoreList: number[];
  extensions: SourceMapExtensionSummary[];
  warnings: string[];
}

export interface SourceMapSourceEntry {
  index: number;
  source: string;
  resolvedSource: string;
  content: string | null;
}

export type SourceMapBias = 'greatest_lower_bound' | 'least_upper_bound';

export type SourceMapLookupInput =
  | {
      direction: 'generated_to_original';
      line: number;
      column: number;
      bias?: SourceMapBias;
    }
  | {
      direction: 'original_to_generated';
      source: string;
      line: number;
      column: number;
      bias?: SourceMapBias;
    };

export interface SourceMapLookupResult {
  coordinateConvention: {line: '1-based'; column: '0-based'};
  match: {line: number; column: number; source?: string; name?: string} | null;
  exact: boolean;
}

export interface SourceMapDiffInput {
  mode: 'summary' | 'sources' | 'mappings';
  maxChanges: number;
}

export interface SourceMapDiffResult {
  summaryChanged: boolean;
  sources: {added: string[]; removed: string[]; contentChanged: string[]};
  mappingChanges: number;
  totalChanges: number;
  changes: Array<{kind: 'added' | 'removed'; mapping: string}>;
  truncated: boolean;
}
