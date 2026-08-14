/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type SourceMapLookupInput,
  type SourceMapReconstructInput,
  type SourceMapRuntimeAccess,
  SourceMapError,
} from '../../modules/sourcemap/types.js';
import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import type {HTTPRequest} from '../../third_party/index.js';
import type {ToolContextProvider} from '../../worker/ToolContext.js';
import type {ToolResponseAccumulator} from '../../worker/ToolResponse.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

const discoverSchema = {
  scriptId: zod.string().min(1).optional(),
  urlPattern: zod.string().optional(),
  limit: zod.number().int().positive().max(1000).optional().default(100),
};

const parseSchema = {
  scriptId: zod.string().min(1).optional(),
  mapUrl: zod.string().min(1).optional(),
  mapContent: zod.string().min(1).optional(),
  generatedUrl: zod.string().min(1).optional(),
  allowCrossOrigin: zod.boolean().optional().default(false),
};

const lookupSchema = {
  mapId: zod.string().regex(/^sm_[a-f0-9]{32}$/),
  direction: zod.enum(['generated_to_original', 'original_to_generated']),
  line: zod.number().int().positive(),
  column: zod.number().int().nonnegative(),
  source: zod.string().min(1).optional(),
  bias: zod.enum(['greatest_lower_bound', 'least_upper_bound']).optional(),
};

const reconstructSchema = {
  mapId: zod.string().regex(/^sm_[a-f0-9]{32}$/),
  taskId: zod.string().min(1).optional(),
  outputDir: zod.string().min(1).optional(),
  overwrite: zod.boolean().optional().default(false),
};

const diffSchema = {
  leftMapId: zod.string().regex(/^sm_[a-f0-9]{32}$/),
  rightMapId: zod.string().regex(/^sm_[a-f0-9]{32}$/),
  mode: zod
    .enum(['summary', 'sources', 'mappings'])
    .optional()
    .default('summary'),
  maxChanges: zod.number().int().positive().max(2000).optional().default(200),
};

async function respond<T>(
  response: Pick<ToolResponseAccumulator, 'setStructuredContent'>,
  tooltype: string,
  action: () => Promise<T> | T,
): Promise<void> {
  try {
    const data = await action();
    response.setStructuredContent({
      success: true,
      message: `${tooltype} completed`,
      tooltype,
      data,
    });
  } catch (error) {
    if (!(error instanceof SourceMapError)) throw error;
    response.setStructuredContent({
      success: false,
      message: error.message,
      tooltype,
      data: {code: error.code},
    });
  }
}

async function capturedBody(
  requests: HTTPRequest[],
  url: string,
  maxBytes?: number,
) {
  const request = requests.find(candidate => candidate.url() === url);
  const response = await request?.response();
  if (!response) return undefined;
  const headers = response.headers();
  const contentLength = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === 'content-length',
  )?.[1];
  const declaredBytes = Number(contentLength);
  if (
    maxBytes !== undefined &&
    Number.isFinite(declaredBytes) &&
    declaredBytes > maxBytes
  ) {
    return undefined;
  }
  const body = await response.body();
  if (maxBytes !== undefined && body.byteLength > maxBytes) return undefined;
  return {url, content: body.toString('utf8'), complete: true};
}

function createRuntimeAccess(
  context: ToolContextProvider,
): SourceMapRuntimeAccess {
  const runtime = getRuntime();
  return {
    listScripts: () =>
      (context.getExistingDebuggerContext()?.getScripts() ?? [])
        .filter(script => typeof script.sourceMapURL === 'string')
        .map(script => ({
          scriptId: script.scriptId,
          generatedUrl: script.url,
          sourceMapURL: script.sourceMapURL ?? '',
        })),
    findCapturedBody: (url, maxBytes) =>
      capturedBody(context.getNetworkRequests(true), url, maxBytes),
    getCookies: async url => {
      const page = context.getSelectedPage();
      return page ? page.context().cookies(url) : [];
    },
    getPageUrl: () => context.getSelectedPage()?.url(),
    resolveExistingTaskDir: async taskId => {
      const snapshot = await runtime.reverseTaskStore.readSnapshot(
        taskId,
        'task.json',
      );
      return snapshot === undefined
        ? undefined
        : runtime.reverseTaskStore.getTaskDir(taskId);
    },
  };
}

function service() {
  const sourceMapService = getRuntime().sourceMapService;
  if (!sourceMapService) {
    throw new Error('SourceMapService is unavailable');
  }
  return sourceMapService;
}

function access(context: unknown): SourceMapRuntimeAccess {
  return createRuntimeAccess(context as ToolContextProvider);
}

function assertSingleParseSource(input: {
  scriptId?: string;
  mapUrl?: string;
  mapContent?: string;
}): void {
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
}

export const sourcemapDiscover = defineTool({
  name: 'sourcemap_discover',
  description: 'Discover SourceMap references from existing debugger metadata.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: discoverSchema,
  handler: async (request, response, context) =>
    respond(response, 'sourcemap_discover', () =>
      service().discover(request.params, access(context)),
    ),
});

export const sourcemapParse = defineTool({
  name: 'sourcemap_parse',
  description: 'Parse one SourceMap source into a bounded process-local cache.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: parseSchema,
  handler: async (request, response, context) =>
    respond(response, 'sourcemap_parse', () => {
      assertSingleParseSource(request.params);
      return service().parse(request.params, access(context));
    }),
});

export const sourcemapLookup = defineTool({
  name: 'sourcemap_lookup',
  description: 'Look up generated or original SourceMap coordinates.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: lookupSchema,
  handler: async (request, response) =>
    respond(response, 'sourcemap_lookup', () => {
      if (
        request.params.direction === 'original_to_generated' &&
        request.params.source === undefined
      ) {
        throw new SourceMapError(
          'INVALID_SOURCE_INPUT',
          'Original-to-generated lookup requires a source',
        );
      }
      return service().lookup(
        request.params as SourceMapLookupInput & {mapId: string},
      );
    }),
});

export const sourcemapReconstructTree = defineTool({
  name: 'sourcemap_reconstruct_tree',
  description:
    'Explicitly reconstruct cached SourceMap sources to a safe tree.',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: reconstructSchema,
  handler: async (request, response, context) =>
    respond(response, 'sourcemap_reconstruct_tree', () =>
      service().reconstructTree(
        request.params as SourceMapReconstructInput,
        access(context),
      ),
    ),
});

export const sourcemapDiff = defineTool({
  name: 'sourcemap_diff',
  description: 'Compare two cached SourceMaps with bounded detail.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: diffSchema,
  handler: async (request, response) =>
    respond(response, 'sourcemap_diff', () =>
      service().diff(
        request.params as {
          leftMapId: string;
          rightMapId: string;
          mode?: 'summary' | 'sources' | 'mappings';
          maxChanges?: number;
        },
      ),
    ),
});
