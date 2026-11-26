/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';

import type {Page, ResourceType, Route} from '../../third_party/index.js';
import {logger} from '../../utils/logger.js';
import {Mutex} from '../../utils/Mutex.js';

export interface NetworkMockFilter {
  urlPattern?: string;
  resourceType?: ResourceType;
}

export interface UpstreamNetworkOverrideInput extends NetworkMockFilter {
  kind: 'upstream';
  upstreamUrl: string;
}

export interface FileNetworkOverrideInput extends NetworkMockFilter {
  kind: 'file';
  responseFilePath: string;
  contentType?: string;
  loadResponseFile: () => Promise<Uint8Array<ArrayBufferLike>>;
}

export interface NetworkMockActions {
  abort?: boolean;
  allowOrigin?: string;
}

export type NetworkMockInput =
  | (NetworkMockActions & UpstreamNetworkOverrideInput)
  | (NetworkMockActions & FileNetworkOverrideInput)
  | (NetworkMockActions & NetworkMockFilter & {kind?: 'passthrough'});

interface NetworkOverrideBase {
  id: number;
  urlPattern: string;
  resourceType?: ResourceType;
  abort?: boolean;
  allowOrigin?: string;
  diagnostics: {
    hits: number;
    errors: number;
    navigations: number;
    lastError?: string;
  };
}

export interface UpstreamNetworkOverride extends NetworkOverrideBase {
  kind: 'upstream';
  upstreamUrl: string;
}

export interface FileNetworkOverride extends NetworkOverrideBase {
  kind: 'file';
  responseFilePath: string;
  contentType: string;
}

export interface PassthroughNetworkOverride extends NetworkOverrideBase {
  kind: 'passthrough';
}

export type NetworkOverride =
  | UpstreamNetworkOverride
  | FileNetworkOverride
  | PassthroughNetworkOverride;

interface PatternMatcher {
  test(url: string): boolean;
}

interface StoredNetworkOverrideBase extends NetworkOverrideBase {
  matcher: PatternMatcher;
}

interface StoredUpstreamNetworkOverride extends StoredNetworkOverrideBase {
  kind: 'upstream';
  upstreamUrl: string;
}

interface StoredFileNetworkOverride extends StoredNetworkOverrideBase {
  kind: 'file';
  responseFilePath: string;
  contentType: string;
  loadResponseFile: () => Promise<Uint8Array<ArrayBufferLike>>;
}

type StoredNetworkOverride =
  | StoredUpstreamNetworkOverride
  | StoredFileNetworkOverride
  | (StoredNetworkOverrideBase & {kind: 'passthrough'});

const DEFAULT_URL_PATTERN = '*://*:*/*';

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.xml': 'application/xml; charset=utf-8',
};

function inferContentType(filePath: string): string {
  return (
    CONTENT_TYPES[path.extname(filePath).toLowerCase()] ??
    'application/octet-stream'
  );
}

export function validateUrlPattern(pattern: string): void {
  if (!pattern || pattern.startsWith('/')) {
    throw new Error(
      `Invalid route pattern "${pattern}". Expected an absolute URLPattern such as https://example.com/app.js or *://*:*/app.js.`,
    );
  }
  const UrlPatternCtor = (
    globalThis as {URLPattern?: new (input: string) => PatternMatcher}
  ).URLPattern;
  if (typeof UrlPatternCtor === 'function') {
    // 校验 URLPattern 合法性并禁止正则表达式 / :name 命名分组
    if (/\([^)]*\)/.test(pattern) || /\/:[A-Za-z0-9_]+/.test(pattern)) {
      throw new Error(
        `Invalid route pattern "${pattern}". Regex and :name groups are not supported; use * wildcards instead.`,
      );
    }
    new UrlPatternCtor(pattern);
  }
}

function compilePatternMatcher(pattern: string): PatternMatcher {
  const UrlPatternCtor = (
    globalThis as {URLPattern?: new (input: string) => PatternMatcher}
  ).URLPattern;
  if (typeof UrlPatternCtor === 'function') {
    return new UrlPatternCtor(pattern);
  }
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  const regex = new RegExp(`^${escaped}$`);
  return {
    test: (url: string) => regex.test(url),
  };
}

function toNetworkOverride(override: StoredNetworkOverride): NetworkOverride {
  const base = {
    id: override.id,
    urlPattern: override.urlPattern,
    resourceType: override.resourceType,
    abort: override.abort,
    allowOrigin: override.allowOrigin,
    diagnostics: {...override.diagnostics},
  };
  if (override.kind === 'upstream') {
    return {
      ...base,
      kind: override.kind,
      upstreamUrl: override.upstreamUrl,
    };
  }
  if (override.kind === 'passthrough') {
    return {...base, kind: override.kind};
  }
  return {
    ...base,
    kind: override.kind,
    responseFilePath: override.responseFilePath,
    contentType: override.contentType,
  };
}

function matchesFilter(
  override: NetworkOverrideBase,
  filter: NetworkMockFilter,
): boolean {
  return (
    (filter.urlPattern === undefined ||
      override.urlPattern === filter.urlPattern) &&
    (filter.resourceType === undefined ||
      override.resourceType === filter.resourceType)
  );
}

function mergeCorsHeaders(
  headers: Record<string, string>,
  allowOrigin?: string,
): Record<string, string> {
  if (!allowOrigin) {
    return headers;
  }
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== 'access-control-allow-origin') {
      next[key] = value;
    }
  }
  next['access-control-allow-origin'] = allowOrigin;
  return next;
}

/**
 * 基于 Patchright `page.route` 的单页网络 Mock 管理器。
 */
export class NetworkMockManager {
  #page: Page;
  #overrides = new Map<number, StoredNetworkOverride>();
  #nextId = 1;
  #active = false;
  #disposed = false;
  #lifecycleMutex = new Mutex();

  #routeHandler = async (route: Route): Promise<void> => {
    await this.#handleRoute(route);
  };

  constructor(page: Page) {
    this.#page = page;
  }

  async mock(input: NetworkMockInput): Promise<NetworkOverride> {
    const guard = await this.#lifecycleMutex.acquire();
    try {
      return await this.#mock(input);
    } finally {
      guard.dispose();
    }
  }

  async #mock(input: NetworkMockInput): Promise<NetworkOverride> {
    if (this.#disposed) {
      throw new Error('Cannot update mocks after the page was disposed.');
    }
    const urlPattern = input.urlPattern ?? DEFAULT_URL_PATTERN;
    validateUrlPattern(urlPattern);

    const existing = [...this.#overrides.values()].find(
      override =>
        override.urlPattern === urlPattern &&
        override.resourceType === input.resourceType,
    );
    const override = await this.#createOverride(input, existing);
    const previous = this.#overrides;
    const overrides = new Map(previous);
    overrides.delete(override.id);
    overrides.set(override.id, override);
    this.#overrides = overrides;

    try {
      await this.#activate();
    } catch (error) {
      this.#overrides = previous;
      throw error;
    }
    if (!existing) {
      this.#nextId += 1;
    }
    return toNetworkOverride(override);
  }

  async #createOverride(
    input: NetworkMockInput,
    existing?: StoredNetworkOverride,
  ): Promise<StoredNetworkOverride> {
    const urlPattern = input.urlPattern ?? DEFAULT_URL_PATTERN;
    const base: StoredNetworkOverrideBase = {
      id: existing?.id ?? this.#nextId,
      urlPattern,
      resourceType: input.resourceType,
      abort: input.abort ?? existing?.abort ?? false,
      allowOrigin: input.allowOrigin ?? existing?.allowOrigin,
      matcher: compilePatternMatcher(urlPattern),
      diagnostics: {hits: 0, errors: 0, navigations: 0},
    };
    if (input.kind === 'upstream') {
      return {
        ...base,
        kind: 'upstream',
        upstreamUrl: input.upstreamUrl,
      };
    }
    if (input.kind === 'file') {
      await input.loadResponseFile();
      return {
        ...base,
        kind: 'file',
        responseFilePath: input.responseFilePath,
        contentType:
          input.contentType ?? inferContentType(input.responseFilePath),
        loadResponseFile: input.loadResponseFile,
      };
    }
    if (
      base.allowOrigin !== undefined &&
      (!existing || existing.kind === 'passthrough')
    ) {
      throw new Error(
        'allowOrigin requires a body or upstream source on the mock.',
      );
    }
    return existing ? {...existing, ...base} : {...base, kind: 'passthrough'};
  }

  list(filter: NetworkMockFilter = {}): NetworkOverride[] {
    const overrides: NetworkOverride[] = [];
    for (const override of this.#overrides.values()) {
      if (matchesFilter(override, filter)) {
        overrides.push(toNetworkOverride(override));
      }
    }
    return overrides;
  }

  async remove(filter: NetworkMockFilter): Promise<number> {
    const guard = await this.#lifecycleMutex.acquire();
    try {
      if (this.#disposed) {
        throw new Error('Cannot remove mocks after the page was disposed.');
      }
      const overrides = new Map(this.#overrides);
      for (const [id, override] of overrides) {
        if (matchesFilter(override, filter)) {
          overrides.delete(id);
        }
      }
      const removed = this.#overrides.size - overrides.size;
      if (removed === 0) {
        return 0;
      }
      if (overrides.size === 0) {
        await this.#deactivate();
      }
      this.#overrides = overrides;
      return removed;
    } finally {
      guard.dispose();
    }
  }

  async dispose(): Promise<void> {
    const guard = await this.#lifecycleMutex.acquire();
    try {
      if (this.#disposed) {
        return;
      }
      this.#disposed = true;
      this.#overrides.clear();
      await this.#deactivate().catch(error => {
        logger.debug('Failed to dispose network mocks', error);
      });
    } finally {
      guard.dispose();
    }
  }

  async #activate(): Promise<void> {
    if (this.#active) {
      return;
    }
    if (typeof this.#page.isClosed === 'function' && this.#page.isClosed()) {
      throw new Error('Cannot add a network mock to a closed page.');
    }
    await this.#page.route('**/*', this.#routeHandler);
    this.#active = true;
  }

  async #deactivate(): Promise<void> {
    if (!this.#active) {
      return;
    }
    this.#active = false;
    await this.#page.unroute('**/*', this.#routeHandler).catch(() => undefined);
  }

  #findMatch(
    url: string,
    resourceType: string,
  ): StoredNetworkOverride | undefined {
    const ordered = [...this.#overrides.values()].reverse();
    for (const override of ordered) {
      if (
        override.resourceType !== undefined &&
        override.resourceType !== resourceType
      ) {
        continue;
      }
      if (override.matcher.test(url)) {
        return override;
      }
    }
    return undefined;
  }

  async #handleRoute(route: Route): Promise<void> {
    const req = route.request();
    const match = this.#findMatch(req.url(), req.resourceType());
    if (!match) {
      await route.continue().catch(() => undefined);
      return;
    }

    match.diagnostics.hits += 1;
    try {
      if (match.abort) {
        await route.abort();
        return;
      }

      if (match.kind === 'file') {
        const bodyBytes = await match.loadResponseFile();
        const headers = mergeCorsHeaders(
          {'content-type': match.contentType},
          match.allowOrigin,
        );
        await route.fulfill({
          status: 200,
          headers,
          body: Buffer.from(bodyBytes),
        });
        return;
      }

      if (match.kind === 'upstream') {
        const method = req.method().toUpperCase();
        if (method !== 'GET' && method !== 'HEAD') {
          throw new Error(
            `Upstream replacement only supports GET/HEAD requests, got ${method}.`,
          );
        }
        const upstreamRes = await fetch(match.upstreamUrl, {
          method,
        });
        const arrayBuf = await upstreamRes.arrayBuffer();
        const rawHeaders: Record<string, string> = {};
        upstreamRes.headers.forEach((value, key) => {
          rawHeaders[key] = value;
        });
        const headers = mergeCorsHeaders(rawHeaders, match.allowOrigin);
        await route.fulfill({
          status: upstreamRes.status,
          headers,
          body: Buffer.from(arrayBuf),
        });
        return;
      }

      await route.continue();
    } catch (error) {
      match.diagnostics.errors += 1;
      match.diagnostics.lastError =
        error instanceof Error ? error.message : String(error);
      await route.continue().catch(() => undefined);
    }
  }
}

export function formatNetworkOverrides(overrides: NetworkOverride[]): string {
  if (overrides.length === 0) {
    return 'No network mocks configured.';
  }
  return overrides
    .map(o => {
      const target =
        o.kind === 'file'
          ? `file:${o.responseFilePath}`
          : o.kind === 'upstream'
            ? `upstream:${o.upstreamUrl}`
            : 'passthrough';
      const flags = [
        o.abort ? 'abort=true' : undefined,
        o.allowOrigin ? `allowOrigin=${o.allowOrigin}` : undefined,
        o.resourceType ? `type=${o.resourceType}` : undefined,
      ]
        .filter(Boolean)
        .join(', ');
      return `#${o.id} ${o.urlPattern} [${target}]${flags ? ` (${flags})` : ''} hits=${o.diagnostics.hits} errors=${o.diagnostics.errors}`;
    })
    .join('\n');
}
