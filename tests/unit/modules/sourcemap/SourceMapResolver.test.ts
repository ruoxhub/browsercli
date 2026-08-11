import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import {describe, it} from 'node:test';

import {
  assertPublicAddress,
  decodeDataUri,
  readBoundedBody,
  SourceMapResolver,
} from '../../../../src/modules/sourcemap/SourceMapResolver.js';
import {
  type SourceMapCapturedBody,
  type SourceMapConfig,
  SourceMapError,
  type SourceMapResolverDependencies,
  type SourceMapRuntimeAccess,
} from '../../../../src/modules/sourcemap/types.js';

const fixture = (name: string) =>
  readFile(path.join(process.cwd(), 'tests/fixtures/sourcemap', name), 'utf8');

const TEST_CONFIG: SourceMapConfig = {
  maxBytes: 20 * 1024 * 1024,
  cacheMaxBytes: 64 * 1024 * 1024,
  cacheMaxEntries: 16,
  cacheTtlMs: 30 * 60 * 1000,
  fetchTimeoutMs: 15_000,
  maxRedirects: 3,
  maxIndexedDepth: 8,
  maxIndexedSections: 1000,
  maxDiffChanges: 2000,
};

function fakeAccess(
  options: {captured?: SourceMapCapturedBody} = {},
): SourceMapRuntimeAccess {
  return {
    listScripts: () => [],
    findCapturedBody: async url =>
      options.captured?.url === url ? options.captured : undefined,
    getCookies: async () => [],
    getPageUrl: () => 'https://example.com/app.js',
    resolveExistingTaskDir: async () => undefined,
  };
}

function createResolver(
  overrides: Partial<SourceMapResolverDependencies> = {},
): SourceMapResolver {
  return new SourceMapResolver(TEST_CONFIG, {
    lookup: async () => [{address: '93.184.216.34', family: 4}],
    request: async () => {
      throw new Error('unexpected network request');
    },
    ...overrides,
  });
}

function createResolverWithBodies(
  bodies: Record<string, string>,
): SourceMapResolver {
  return createResolver({
    request: async url => {
      const body = bodies[url.href];
      assert.notEqual(body, undefined, `unexpected URL: ${url.href}`);
      return {
        status: 200,
        headers: {'content-length': String(Buffer.byteLength(body ?? ''))},
        body: Readable.from([body ?? '']),
      };
    },
  });
}

describe('SourceMapResolver network boundaries', () => {
  it('decodes base64 and percent data URIs', () => {
    assert.equal(
      decodeDataUri('data:application/json;base64,eyJ2ZXJzaW9uIjozfQ==', 100),
      '{"version":3}',
    );
    assert.equal(
      decodeDataUri('data:application/json,%7B%22version%22%3A3%7D', 100),
      '{"version":3}',
    );
  });

  it('blocks private and mapped-private addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '169.254.1.1',
      '192.0.2.1',
      '198.51.100.1',
      '203.0.113.1',
      '::1',
      '::ffff:127.0.0.1',
      'fc00::1',
      '2001:db8::1',
    ]) {
      assert.throws(() => assertPublicAddress(address), SourceMapError);
    }
  });

  it('aborts a streamed body at the byte limit', async () => {
    const body = Readable.from([Buffer.alloc(6), Buffer.alloc(6)]);
    await assert.rejects(
      readBoundedBody(body, 10),
      (error: unknown) =>
        error instanceof SourceMapError && error.code === 'FETCH_TOO_LARGE',
    );
  });

  it('uses an exact complete captured body before fetching', async () => {
    let requests = 0;
    const resolver = createResolver({
      request: async () => {
        requests += 1;
        throw new Error('network must not run');
      },
    });
    const access = fakeAccess({
      captured: {
        url: 'https://example.com/app.js.map',
        content: await fixture('basic-v3.json'),
        complete: true,
      },
    });
    const result = await resolver.resolve(
      {
        mapUrl: 'https://example.com/app.js.map',
        generatedUrl: 'https://example.com/app.js',
      },
      access,
    );
    assert.equal(result.provenance.kind, 'captured');
    assert.equal(requests, 0);
  });

  it('blocks cross-origin fetch unless explicitly allowed', async () => {
    const resolver = createResolver();
    await assert.rejects(
      resolver.resolve(
        {
          mapUrl: 'https://cdn.example.net/app.js.map',
          generatedUrl: 'https://example.com/app.js',
        },
        fakeAccess(),
      ),
      (error: unknown) =>
        error instanceof SourceMapError && error.code === 'FETCH_BLOCKED',
    );
  });

  it('materializes relative indexed section URLs', async () => {
    const resolver = createResolverWithBodies({
      'https://example.com/root.map': JSON.stringify({
        version: 3,
        sections: [{offset: {line: 0, column: 0}, url: 'part.map'}],
      }),
      'https://example.com/part.map': await fixture('basic-v3.json'),
    });
    const result = await resolver.resolve(
      {
        mapUrl: 'https://example.com/root.map',
        generatedUrl: 'https://example.com/app.js',
      },
      fakeAccess(),
    );
    assert.ok('sections' in result.map);
    assert.ok('map' in result.map.sections[0]);
  });

  it('resolves direct content without runtime or network access', async () => {
    const content = await fixture('basic-v3.json');
    const result = await createResolver().resolve(
      {mapContent: content},
      fakeAccess(),
    );
    assert.equal(result.provenance.kind, 'content');
    assert.equal(result.decodedBytes, Buffer.byteLength(content));
  });

  it('discovers existing metadata without fetching', () => {
    const resolver = createResolver({
      request: async () => {
        throw new Error('discover must not fetch');
      },
    });
    const access = fakeAccess();
    access.listScripts = () => [
      {
        scriptId: '1',
        generatedUrl: 'https://example.com/app.js',
        sourceMapURL: 'app.js.map',
      },
      {
        scriptId: '2',
        generatedUrl: 'https://example.com/other.js',
        sourceMapURL: '',
      },
    ];
    assert.deepEqual(
      resolver.discover({urlPattern: 'app'}, access).candidates,
      [access.listScripts()[0]],
    );
  });

  it('allows pinned same-origin private fetches and forwards cookies', async () => {
    let cookieHeader: string | undefined;
    const content = await fixture('basic-v3.json');
    const resolver = new SourceMapResolver(TEST_CONFIG, {
      lookup: async () => [{address: '127.0.0.1', family: 4}],
      request: async (_url, options) => {
        cookieHeader = options.headers.Cookie;
        return {
          status: 200,
          headers: {},
          body: Readable.from([content]),
        };
      },
    });
    const access = fakeAccess();
    access.getCookies = async () => [{name: 'session', value: 'value'}];
    const result = await resolver.resolve(
      {
        mapUrl: 'http://127.0.0.1/app.js.map',
        generatedUrl: 'http://127.0.0.1/app.js',
      },
      access,
    );
    assert.equal(result.provenance.kind, 'same_origin');
    assert.equal(cookieHeader, 'session=value');
  });

  it('rechecks origin policy on every redirect', async () => {
    let requests = 0;
    const resolver = createResolver({
      request: async () => {
        requests += 1;
        return {
          status: 302,
          headers: {location: 'https://cdn.example.net/app.js.map'},
          body: Readable.from([]),
        };
      },
    });
    await assert.rejects(
      resolver.resolve(
        {
          mapUrl: 'https://example.com/app.js.map',
          generatedUrl: 'https://example.com/app.js',
        },
        fakeAccess(),
      ),
      (error: unknown) =>
        error instanceof SourceMapError && error.code === 'FETCH_BLOCKED',
    );
    assert.equal(requests, 1);
  });

  it('rejects indexed URL cycles', async () => {
    const resolver = createResolverWithBodies({
      'https://example.com/root.map': JSON.stringify({
        version: 3,
        sections: [{offset: {line: 0, column: 0}, url: 'root.map'}],
      }),
    });
    await assert.rejects(
      resolver.resolve(
        {
          mapUrl: 'https://example.com/root.map',
          generatedUrl: 'https://example.com/app.js',
        },
        fakeAccess(),
      ),
      (error: unknown) =>
        error instanceof SourceMapError &&
        error.code === 'INDEXED_MAP_LIMIT_EXCEEDED',
    );
  });
});
