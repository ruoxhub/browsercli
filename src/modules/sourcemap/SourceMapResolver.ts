import {lookup as dnsLookup} from 'node:dns/promises';
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {BlockList, isIP} from 'node:net';

import {
  type SourceMapConfig,
  SourceMapError,
  type SourceMapHttpResponse,
  type SourceMapResolverDependencies,
} from './types.js';

const blockedAddresses = new BlockList();
blockedAddresses.addSubnet('0.0.0.0', 8, 'ipv4');
blockedAddresses.addSubnet('10.0.0.0', 8, 'ipv4');
blockedAddresses.addSubnet('100.64.0.0', 10, 'ipv4');
blockedAddresses.addSubnet('127.0.0.0', 8, 'ipv4');
blockedAddresses.addSubnet('169.254.0.0', 16, 'ipv4');
blockedAddresses.addSubnet('172.16.0.0', 12, 'ipv4');
blockedAddresses.addSubnet('192.0.0.0', 24, 'ipv4');
blockedAddresses.addSubnet('192.168.0.0', 16, 'ipv4');
blockedAddresses.addSubnet('198.18.0.0', 15, 'ipv4');
blockedAddresses.addSubnet('224.0.0.0', 4, 'ipv4');
blockedAddresses.addSubnet('240.0.0.0', 4, 'ipv4');
blockedAddresses.addAddress('::', 'ipv6');
blockedAddresses.addAddress('::1', 'ipv6');
blockedAddresses.addSubnet('fc00::', 7, 'ipv6');
blockedAddresses.addSubnet('fe80::', 10, 'ipv6');
blockedAddresses.addSubnet('ff00::', 8, 'ipv6');

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
    if (!allowPrivate) {
      for (const {address} of addresses) assertPublicAddress(address);
    }
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
}
