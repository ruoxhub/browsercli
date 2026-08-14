/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {createHash, randomBytes} from 'node:crypto';

import {SourceMapDocument} from './SourceMapDocument.js';
import {SourceMapReconstructor} from './SourceMapReconstructor.js';
import {SourceMapResolver} from './SourceMapResolver.js';
import {
  type ResolvedSourceMap,
  type SourceMapConfig,
  type SourceMapDiffResult,
  type SourceMapLookupInput,
  type SourceMapLookupResult,
  type SourceMapParseInput,
  type SourceMapReconstructInput,
  type SourceMapReconstructResult,
  type SourceMapResolverDependencies,
  type SourceMapRuntimeAccess,
  SourceMapError,
} from './types.js';

interface CacheEntry {
  mapId: string;
  cacheKey: string;
  document: SourceMapDocument;
  rawBytes: number;
  provenance: ResolvedSourceMap['provenance'];
  lastAccess: number;
}

export interface SourceMapServiceDependencies {
  now?: () => number;
  randomBytes?: typeof randomBytes;
  resolverDependencies?: Partial<SourceMapResolverDependencies>;
}

function buildCacheKey(resolved: ResolvedSourceMap): string {
  return createHash('sha256')
    .update(resolved.canonicalContent)
    .update('\0')
    .update(resolved.baseUrl ?? '')
    .digest('hex');
}

export class SourceMapService {
  private readonly byId = new Map<string, CacheEntry>();
  private readonly idByKey = new Map<string, string>();
  private readonly now: () => number;
  private readonly createRandomBytes: typeof randomBytes;
  private readonly resolver: SourceMapResolver;
  private cacheBytes = 0;

  constructor(
    private readonly config: SourceMapConfig,
    dependencies: SourceMapServiceDependencies = {},
  ) {
    this.now = dependencies.now ?? Date.now;
    this.createRandomBytes = dependencies.randomBytes ?? randomBytes;
    this.resolver = new SourceMapResolver(
      config,
      dependencies.resolverDependencies,
    );
  }

  discover(
    input: {scriptId?: string; urlPattern?: string; limit?: number},
    access: SourceMapRuntimeAccess,
  ): ReturnType<SourceMapResolver['discover']> {
    this.cleanupExpired();
    return this.resolver.discover(input, access);
  }

  async parse(
    input: SourceMapParseInput,
    access: SourceMapRuntimeAccess,
  ): Promise<{
    mapId: string;
    cacheHit: boolean;
    summary: ReturnType<SourceMapDocument['getSummary']>;
    provenance: ResolvedSourceMap['provenance'];
    warnings: string[];
  }> {
    this.cleanupExpired();
    const original = await this.resolver.resolve(input, access);
    const resolved: ResolvedSourceMap =
      original.baseUrl === undefined && input.generatedUrl !== undefined
        ? {...original, baseUrl: input.generatedUrl}
        : original;
    const cacheKey = buildCacheKey(resolved);
    const cachedId = this.idByKey.get(cacheKey);
    if (cachedId !== undefined) {
      const cached = this.byId.get(cachedId);
      if (cached !== undefined) {
        this.touch(cached);
        return {
          mapId: cached.mapId,
          cacheHit: true,
          summary: cached.document.getSummary(),
          provenance: cached.provenance,
          warnings: resolved.warnings,
        };
      }
      this.idByKey.delete(cacheKey);
    }

    const rawBytes = Buffer.byteLength(resolved.canonicalContent);
    if (rawBytes > this.config.cacheMaxBytes) {
      throw new SourceMapError(
        'SOURCEMAP_CONFIG_INVALID',
        'SourceMap is larger than the configured cache',
      );
    }
    this.evictFor(rawBytes);
    const mapId = `sm_${this.createRandomBytes(16).toString('hex')}`;
    const document = SourceMapDocument.parse(
      resolved.canonicalContent,
      resolved.baseUrl,
    );
    const entry: CacheEntry = {
      mapId,
      cacheKey,
      document,
      rawBytes,
      provenance: resolved.provenance,
      lastAccess: this.now(),
    };
    this.byId.set(mapId, entry);
    this.idByKey.set(cacheKey, mapId);
    this.cacheBytes += rawBytes;
    return {
      mapId,
      cacheHit: false,
      summary: document.getSummary(),
      provenance: resolved.provenance,
      warnings: resolved.warnings,
    };
  }

  lookup(input: SourceMapLookupInput & {mapId: string}): SourceMapLookupResult {
    const {mapId, ...lookupInput} = input;
    return this.getEntry(mapId).document.lookup(
      lookupInput as SourceMapLookupInput,
    );
  }

  diff(input: {
    leftMapId: string;
    rightMapId: string;
    mode?: 'summary' | 'sources' | 'mappings';
    maxChanges?: number;
  }): SourceMapDiffResult {
    const left = this.getEntry(input.leftMapId);
    const right = this.getEntry(input.rightMapId);
    return left.document.diff(right.document, {
      mode: input.mode ?? 'summary',
      maxChanges: Math.min(
        input.maxChanges ?? this.config.maxDiffChanges,
        this.config.maxDiffChanges,
      ),
    });
  }

  async reconstructTree(
    input: SourceMapReconstructInput,
    access: SourceMapRuntimeAccess,
  ): Promise<SourceMapReconstructResult> {
    const entry = this.getEntry(input.mapId);
    const outputDir =
      input.outputDir ??
      (input.taskId === undefined
        ? undefined
        : await access.resolveExistingTaskDir(input.taskId));
    if (outputDir === undefined) {
      throw new SourceMapError(
        'OUTPUT_PATH_REQUIRED',
        'An explicit output directory or existing task is required',
      );
    }
    return new SourceMapReconstructor().reconstruct(entry.document, {
      ...input,
      outputDir,
    });
  }

  getCacheStats(): {entries: number; bytes: number} {
    this.cleanupExpired();
    return {entries: this.byId.size, bytes: this.cacheBytes};
  }

  private getEntry(mapId: string): CacheEntry {
    this.cleanupExpired();
    const entry = this.byId.get(mapId);
    if (entry === undefined) {
      throw new SourceMapError('MAP_NOT_FOUND', 'SourceMap is not cached');
    }
    this.touch(entry);
    return entry;
  }

  private touch(entry: CacheEntry): void {
    entry.lastAccess = this.now();
    this.byId.delete(entry.mapId);
    this.byId.set(entry.mapId, entry);
  }

  private cleanupExpired(): void {
    const now = this.now();
    for (const entry of this.byId.values()) {
      if (now - entry.lastAccess > this.config.cacheTtlMs) {
        this.deleteEntry(entry);
      }
    }
  }

  private evictFor(rawBytes: number): void {
    while (
      this.byId.size >= Math.min(this.config.cacheMaxEntries, 64) ||
      this.cacheBytes + rawBytes > this.config.cacheMaxBytes
    ) {
      const oldest = this.byId.values().next().value as CacheEntry | undefined;
      if (oldest === undefined) break;
      this.deleteEntry(oldest);
    }
  }

  private deleteEntry(entry: CacheEntry): void {
    this.byId.delete(entry.mapId);
    this.idByKey.delete(entry.cacheKey);
    this.cacheBytes -= entry.rawBytes;
  }
}
