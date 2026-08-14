import {lookup as dnsLookup} from 'node:dns/promises';
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {BlockList, isIP} from 'node:net';

import {assertMaterializedSourceMap} from './SourceMapDocument.js';
import {
  type MaterializedSourceMap,
  type ResolvedSourceMap,
  type SourceMapConfig,
  SourceMapError,
  type SourceMapHttpResponse,
  type SourceMapParseInput,
  type SourceMapResolverDependencies,
  type SourceMapRuntimeAccess,
  type SourceMapScriptInfo,
} from './types.js';

interface FetchedResource {
  content: string;
  url: string;
  kind: 'captured' | 'same_origin' | 'cross_origin';
}

const blockedAddresses = new BlockList();
blockedAddresses.addSubnet('0.0.0.0', 8, 'ipv4');
blockedAddresses.addSubnet('10.0.0.0', 8, 'ipv4');
blockedAddresses.addSubnet('100.64.0.0', 10, 'ipv4');
blockedAddresses.addSubnet('127.0.0.0', 8, 'ipv4');
blockedAddresses.addSubnet('169.254.0.0', 16, 'ipv4');
blockedAddresses.addSubnet('172.16.0.0', 12, 'ipv4');
blockedAddresses.addSubnet('192.0.0.0', 24, 'ipv4');
blockedAddresses.addSubnet('192.0.2.0', 24, 'ipv4');
blockedAddresses.addSubnet('192.168.0.0', 16, 'ipv4');
blockedAddresses.addSubnet('198.18.0.0', 15, 'ipv4');
blockedAddresses.addSubnet('198.51.100.0', 24, 'ipv4');
blockedAddresses.addSubnet('203.0.113.0', 24, 'ipv4');
blockedAddresses.addSubnet('224.0.0.0', 4, 'ipv4');
blockedAddresses.addSubnet('240.0.0.0', 4, 'ipv4');
blockedAddresses.addAddress('::', 'ipv6');
blockedAddresses.addAddress('::1', 'ipv6');
blockedAddresses.addSubnet('fc00::', 7, 'ipv6');
blockedAddresses.addSubnet('fe80::', 10, 'ipv6');
blockedAddresses.addSubnet('ff00::', 8, 'ipv6');
blockedAddresses.addSubnet('2001:db8::', 32, 'ipv6');

export function assertPublicAddress(address: string): void {
  const family = isIP(address);
  if (
    family === 0 ||
    blockedAddresses.check(address, family === 4 ? 'ipv4' : 'ipv6')
  ) {
    throw new SourceMapError(
      'FETCH_BLOCKED',
      `Network address blocked: ${address}`,
    );
  }
}

function assertNetworkAddress(address: string, allowPrivate: boolean): void {
  if (isIP(address) === 0) {
    throw new SourceMapError(
      'FETCH_BLOCKED',
      `Invalid network address: ${address}`,
    );
  }
  if (!allowPrivate) assertPublicAddress(address);
}

export function assertAllowedNetworkUrl(input: URL): void {
  if (!['http:', 'https:'].includes(input.protocol)) {
    throw new SourceMapError(
      'FETCH_BLOCKED',
      `Protocol blocked: ${input.protocol}`,
    );
  }
  if (input.username || input.password) {
    throw new SourceMapError(
      'FETCH_BLOCKED',
      'URL credentials are not allowed',
    );
  }
}

function assertSize(bytes: number, maxBytes: number): void {
  if (bytes > maxBytes) {
    throw new SourceMapError(
      'FETCH_TOO_LARGE',
      `SourceMap exceeds the ${maxBytes} byte limit`,
    );
  }
}

function destroyBody(body: NodeJS.ReadableStream): void {
  if ('destroy' in body && typeof body.destroy === 'function') body.destroy();
}

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new SourceMapError('PARSE_FAILED', 'SourceMap is not valid JSON', {
      cause: error,
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getHeader(
  headers: SourceMapHttpResponse['headers'],
  name: string,
): string | undefined {
  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  )?.[1];
  return Array.isArray(entry) ? entry[0] : entry;
}

function resolveNetworkUrl(reference: string, baseUrl?: string): URL {
  try {
    return baseUrl === undefined
      ? new URL(reference)
      : new URL(reference, baseUrl);
  } catch (error) {
    throw new SourceMapError(
      'INVALID_SOURCE_INPUT',
      'Relative SourceMap URL requires a generated URL',
      {cause: error},
    );
  }
}

function sameOrigin(url: URL, anchor: string | undefined): boolean {
  if (anchor === undefined) return false;
  try {
    return url.origin === new URL(anchor).origin;
  } catch {
    return false;
  }
}

function cookieHeader(cookies: Array<{name: string; value: string}>): string {
  return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
}

export function redactUrl(input: URL): string {
  const redacted = new URL(input.href);
  redacted.username = '';
  redacted.password = '';
  for (const key of new Set(redacted.searchParams.keys())) {
    redacted.searchParams.set(key, '[redacted]');
  }
  return redacted.href;
}

export function decodeDataUri(input: string, maxBytes: number): string {
  const match = /^data:([^,]*),(.*)$/s.exec(input);
  if (match === null) {
    throw new SourceMapError('FETCH_BLOCKED', 'Invalid data URI');
  }
  const metadata = match[1] ?? '';
  const parts = metadata.split(';');
  const mediaType = (parts[0] ?? '').toLowerCase();
  if (
    mediaType !== '' &&
    mediaType !== 'application/json' &&
    mediaType !== 'application/octet-stream'
  ) {
    throw new SourceMapError(
      'FETCH_BLOCKED',
      `Data URI media type blocked: ${mediaType}`,
    );
  }
  const base64 = parts.some(part => part.toLowerCase() === 'base64');
  let content: string;
  try {
    content = base64
      ? Buffer.from(match[2] ?? '', 'base64').toString('utf8')
      : decodeURIComponent(match[2] ?? '');
  } catch (error) {
    throw new SourceMapError('PARSE_FAILED', 'Data URI payload is invalid', {
      cause: error,
    });
  }
  assertSize(Buffer.byteLength(content), maxBytes);
  if (mediaType === '') {
    try {
      JSON.parse(content);
    } catch (error) {
      throw new SourceMapError(
        'PARSE_FAILED',
        'Data URI without a media type must contain JSON',
        {cause: error},
      );
    }
  }
  return content;
}

export async function readBoundedBody(
  body: NodeJS.ReadableStream,
  maxBytes: number,
): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of body as AsyncIterable<Buffer | string>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > maxBytes) {
      destroyBody(body);
      throw new SourceMapError(
        'FETCH_TOO_LARGE',
        `SourceMap exceeds the ${maxBytes} byte limit`,
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, bytes).toString('utf8');
}

function defaultRequest(
  url: URL,
  options: {
    address: string;
    family: 4 | 6;
    headers: Record<string, string>;
    timeoutMs: number;
  },
): Promise<SourceMapHttpResponse> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        headers: {host: url.host, ...options.headers},
        ...(url.protocol === 'https:' ? {servername: url.hostname} : {}),
        lookup: (_hostname, _lookupOptions, callback) =>
          callback(null, options.address, options.family),
      },
      response =>
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: response,
        }),
    );
    request.setTimeout(options.timeoutMs, () => {
      request.destroy(
        new SourceMapError('FETCH_TIMEOUT', 'SourceMap request timed out'),
      );
    });
    request.once('error', reject);
    request.end();
  });
}

const defaultDependencies: SourceMapResolverDependencies = {
  lookup: async hostname => {
    const addresses = await dnsLookup(hostname, {all: true, verbatim: true});
    return addresses.filter(
      (entry): entry is {address: string; family: 4 | 6} =>
        entry.family === 4 || entry.family === 6,
    );
  },
  request: defaultRequest,
};

export class SourceMapResolver {
  private readonly dependencies: SourceMapResolverDependencies;

  constructor(
    private readonly config: SourceMapConfig,
    dependencies: Partial<SourceMapResolverDependencies> = {},
  ) {
    this.dependencies = {...defaultDependencies, ...dependencies};
  }

  async fetchUrl(
    url: URL,
    headers: Record<string, string> = {},
    allowPrivate = false,
  ): Promise<{
    status: number;
    headers: SourceMapHttpResponse['headers'];
    content: string;
  }> {
    assertAllowedNetworkUrl(url);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = await this.dependencies.lookup(hostname);
    if (addresses.length === 0) {
      throw new SourceMapError(
        'FETCH_BLOCKED',
        'Hostname has no usable address',
      );
    }
    for (const {address} of addresses)
      assertNetworkAddress(address, allowPrivate);
    const pinned = addresses[0];
    if (pinned === undefined) {
      throw new SourceMapError(
        'FETCH_BLOCKED',
        'Hostname has no usable address',
      );
    }
    const response = await this.dependencies.request(url, {
      ...pinned,
      headers,
      timeoutMs: this.config.fetchTimeoutMs,
    });
    const contentLength = response.headers['content-length'];
    const declaredBytes = Number(
      Array.isArray(contentLength) ? contentLength[0] : contentLength,
    );
    if (Number.isFinite(declaredBytes))
      assertSize(declaredBytes, this.config.maxBytes);
    return {
      status: response.status,
      headers: response.headers,
      content: await readBoundedBody(response.body, this.config.maxBytes),
    };
  }

  discover(
    input: {scriptId?: string; urlPattern?: string; limit?: number},
    access: SourceMapRuntimeAccess,
  ): {candidates: SourceMapScriptInfo[]; warnings: string[]} {
    const limit = Math.min(input.limit ?? 100, 1000);
    const scripts = access.listScripts();
    const candidates = scripts
      .filter(script => script.sourceMapURL.length > 0)
      .filter(script => !input.scriptId || script.scriptId === input.scriptId)
      .filter(
        script =>
          !input.urlPattern || script.generatedUrl.includes(input.urlPattern),
      )
      .slice(0, limit);
    return {
      candidates,
      warnings:
        scripts.length === 0
          ? [
              'Debugger context is not active; no existing script metadata is available.',
            ]
          : [],
    };
  }

  async resolve(
    input: SourceMapParseInput,
    access: SourceMapRuntimeAccess,
  ): Promise<ResolvedSourceMap> {
    const selectors =
      Number(Boolean(input.scriptId)) +
      Number(Boolean(input.mapUrl)) +
      Number(Boolean(input.mapContent));
    if (selectors !== 1) {
      throw new SourceMapError(
        'INVALID_SOURCE_INPUT',
        'Exactly one SourceMap source must be provided',
      );
    }

    let generatedUrl = input.generatedUrl;
    let mapReference = input.mapUrl;
    if (input.scriptId) {
      const script = access
        .listScripts()
        .find(candidate => candidate.scriptId === input.scriptId);
      if (script === undefined) {
        throw new SourceMapError('SCRIPT_NOT_FOUND', 'Script was not found');
      }
      if (script.sourceMapURL.length === 0) {
        throw new SourceMapError(
          'SOURCEMAP_REFERENCE_NOT_FOUND',
          'Script has no SourceMap reference',
        );
      }
      generatedUrl = script.generatedUrl;
      mapReference = script.sourceMapURL;
    }

    let content: string;
    let baseUrl: string | undefined;
    let provenance: ResolvedSourceMap['provenance'];
    if (input.mapContent) {
      content = input.mapContent;
      assertSize(Buffer.byteLength(content), this.config.maxBytes);
      provenance = {kind: 'content'};
    } else if (mapReference?.startsWith('data:')) {
      content = decodeDataUri(mapReference, this.config.maxBytes);
      provenance = {kind: 'data'};
    } else {
      if (mapReference === undefined) {
        throw new SourceMapError(
          'SOURCEMAP_REFERENCE_NOT_FOUND',
          'SourceMap reference was not found',
        );
      }
      const mapUrl = resolveNetworkUrl(mapReference, generatedUrl);
      const fetched = await this.fetchWithPolicy(
        mapUrl,
        generatedUrl ?? access.getPageUrl(),
        access,
        input.allowCrossOrigin === true,
      );
      content = fetched.content;
      baseUrl = fetched.url;
      provenance = {
        kind: fetched.kind,
        displayUrl: redactUrl(new URL(fetched.url)),
      };
    }

    const bytes = Buffer.byteLength(content);
    const state = {
      depth: 0,
      sections: 0,
      bytes,
      seenUrls: new Set(baseUrl === undefined ? [] : [baseUrl]),
    };
    const map = await this.materialize(
      parseJson(content),
      baseUrl,
      state,
      access,
      input.allowCrossOrigin === true,
    );
    return {
      map,
      canonicalContent: JSON.stringify(map),
      ...(baseUrl === undefined ? {} : {baseUrl}),
      decodedBytes: state.bytes,
      provenance,
      warnings: [],
    };
  }

  private async fetchWithPolicy(
    initialUrl: URL,
    anchor: string | undefined,
    access: SourceMapRuntimeAccess,
    allowCrossOrigin: boolean,
  ): Promise<FetchedResource> {
    let current = initialUrl;
    let redirectCount = 0;
    while (true) {
      assertAllowedNetworkUrl(current);
      const captured = await access.findCapturedBody(
        current.href,
        this.config.maxBytes,
      );
      if (captured?.complete === true && captured.url === current.href) {
        assertSize(Buffer.byteLength(captured.content), this.config.maxBytes);
        return {content: captured.content, url: current.href, kind: 'captured'};
      }

      const isSameOrigin = sameOrigin(current, anchor);
      if (!isSameOrigin && !allowCrossOrigin) {
        throw new SourceMapError(
          'FETCH_BLOCKED',
          'Cross-origin SourceMap fetch requires explicit permission',
        );
      }
      const cookies = isSameOrigin ? await access.getCookies(current.href) : [];
      const headers =
        cookies.length === 0 ? {} : {Cookie: cookieHeader(cookies)};
      const response = await this.fetchUrl(current, headers, isSameOrigin);
      if (response.status < 300 || response.status >= 400) {
        if (response.status < 200 || response.status >= 300) {
          throw new SourceMapError(
            'FETCH_BLOCKED',
            `SourceMap request failed with status ${response.status}`,
          );
        }
        return {
          content: response.content,
          url: current.href,
          kind: isSameOrigin ? 'same_origin' : 'cross_origin',
        };
      }

      const location = getHeader(response.headers, 'location');
      redirectCount += 1;
      if (location === undefined || redirectCount > this.config.maxRedirects) {
        throw new SourceMapError(
          'FETCH_BLOCKED',
          'SourceMap redirect policy was exceeded',
        );
      }
      current = resolveNetworkUrl(location, current.href);
    }
  }

  private async materialize(
    value: unknown,
    parentUrl: string | undefined,
    state: {
      depth: number;
      sections: number;
      bytes: number;
      seenUrls: Set<string>;
    },
    access: SourceMapRuntimeAccess,
    allowCrossOrigin: boolean,
  ): Promise<MaterializedSourceMap> {
    if (state.depth > this.config.maxIndexedDepth) {
      throw new SourceMapError(
        'INDEXED_MAP_LIMIT_EXCEEDED',
        'Indexed SourceMap depth limit exceeded',
      );
    }
    if (!isRecord(value) || value.version !== 3) {
      return assertMaterializedSourceMap(value);
    }
    if (!('sections' in value)) return assertMaterializedSourceMap(value);
    if (!Array.isArray(value.sections)) {
      return assertMaterializedSourceMap(value);
    }

    const sections: Array<{
      offset: {line: number; column: number};
      map: MaterializedSourceMap;
    }> = [];
    for (const section of value.sections) {
      state.sections += 1;
      if (state.sections > this.config.maxIndexedSections) {
        throw new SourceMapError(
          'INDEXED_MAP_LIMIT_EXCEEDED',
          'Indexed SourceMap section limit exceeded',
        );
      }
      if (!isRecord(section) || !isRecord(section.offset)) {
        throw new SourceMapError('PARSE_FAILED', 'Indexed section is invalid');
      }
      const {line, column} = section.offset;
      if (
        !Number.isInteger(line) ||
        !Number.isInteger(column) ||
        (line as number) < 0 ||
        (column as number) < 0
      ) {
        throw new SourceMapError('PARSE_FAILED', 'Indexed offset is invalid');
      }
      const hasMap = 'map' in section;
      const hasUrl = 'url' in section;
      if (hasMap === hasUrl) {
        throw new SourceMapError(
          'PARSE_FAILED',
          'Indexed section must contain exactly one map or URL',
        );
      }

      let childValue: unknown;
      let childParentUrl = parentUrl;
      if (hasMap) {
        childValue = section.map;
      } else {
        if (typeof section.url !== 'string' || parentUrl === undefined) {
          throw new SourceMapError(
            'PARSE_FAILED',
            'Indexed section URL requires a parent URL',
          );
        }
        const sectionUrl = resolveNetworkUrl(section.url, parentUrl);
        if (state.seenUrls.has(sectionUrl.href)) {
          throw new SourceMapError(
            'INDEXED_MAP_LIMIT_EXCEEDED',
            'Indexed SourceMap URL cycle detected',
          );
        }
        state.seenUrls.add(sectionUrl.href);
        const fetched = await this.fetchWithPolicy(
          sectionUrl,
          access.getPageUrl(),
          access,
          allowCrossOrigin,
        );
        const childBytes = Buffer.byteLength(fetched.content);
        state.bytes += childBytes;
        if (state.bytes > this.config.maxBytes) {
          throw new SourceMapError(
            'INDEXED_MAP_LIMIT_EXCEEDED',
            'Indexed SourceMap byte limit exceeded',
          );
        }
        childValue = parseJson(fetched.content);
        childParentUrl = fetched.url;
      }

      state.depth += 1;
      let map: MaterializedSourceMap;
      try {
        map = await this.materialize(
          childValue,
          childParentUrl,
          state,
          access,
          allowCrossOrigin,
        );
      } finally {
        state.depth -= 1;
      }
      sections.push({
        offset: {line: line as number, column: column as number},
        map,
      });
    }
    return assertMaterializedSourceMap({...value, sections});
  }
}
