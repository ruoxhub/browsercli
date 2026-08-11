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

export interface SourceMapConfig {
  maxBytes: number;
  cacheMaxBytes: number;
  cacheMaxEntries: number;
  cacheTtlMs: number;
  fetchTimeoutMs: number;
  maxRedirects: 3;
  maxIndexedDepth: number;
  maxIndexedSections: number;
  maxDiffChanges: number;
}

export interface SourceMapHttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: NodeJS.ReadableStream;
}

export interface SourceMapResolverDependencies {
  lookup(hostname: string): Promise<Array<{address: string; family: 4 | 6}>>;
  request(
    url: URL,
    options: {
      address: string;
      family: 4 | 6;
      headers: Record<string, string>;
      timeoutMs: number;
    },
  ): Promise<SourceMapHttpResponse>;
}

export interface SourceMapScriptInfo {
  scriptId: string;
  generatedUrl: string;
  sourceMapURL: string;
}

export interface SourceMapCapturedBody {
  url: string;
  content: string;
  complete: boolean;
}

export interface SourceMapRuntimeAccess {
  listScripts(): SourceMapScriptInfo[];
  findCapturedBody(url: string): Promise<SourceMapCapturedBody | undefined>;
  getCookies(url: string): Promise<Array<{name: string; value: string}>>;
  getPageUrl(): string | undefined;
  resolveExistingTaskDir(taskId: string): Promise<string | undefined>;
}

export interface SourceMapParseInput {
  scriptId?: string;
  mapUrl?: string;
  mapContent?: string;
  generatedUrl?: string;
  allowCrossOrigin?: boolean;
}

export interface SourceMapReconstructInput {
  mapId: string;
  taskId?: string;
  outputDir?: string;
  overwrite: boolean;
}

export interface SourceMapManifestEntry {
  source: string;
  outputPath?: string;
  status: 'written' | 'skipped' | 'missing' | 'collision';
  sha256?: string;
  bytes?: number;
  warnings: string[];
}

export interface SourceMapReconstructResult {
  rootDir: string;
  manifestPath: string;
  written: number;
  skipped: number;
  missing: number;
  collisions: number;
  entries: SourceMapManifestEntry[];
}

export interface ResolvedSourceMap {
  map: MaterializedSourceMap;
  canonicalContent: string;
  baseUrl?: string;
  decodedBytes: number;
  provenance: {
    kind: 'content' | 'data' | 'captured' | 'same_origin' | 'cross_origin';
    displayUrl?: string;
  };
  warnings: string[];
}
