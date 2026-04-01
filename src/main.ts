/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import './polyfill.js';

import type {Channel} from './browser.js';
import {ensureBrowserConnected, ensureBrowserLaunched, resolveAutoConnectTarget} from './browser.js';
import {parseArguments} from './cli.js';
import {features} from './features.js';
import {loadIssueDescriptions} from './issue-descriptions.js';
import {logger, saveLogsToFile} from './logger.js';
import {McpContext} from './McpContext.js';
import {McpResponse} from './McpResponse.js';
import {dbService} from './services/DatabaseService.js';
import {
  McpServer,
  StdioServerTransport,
  StreamableHTTPServerTransport,
  type CallToolResult,
  SetLevelRequestSchema,
  isInitializeRequest,
} from './third_party/index.js';
import * as jshookAnalyzerTools from './tools/analyzer.js';
import {ToolCategory} from './tools/categories.js';
import * as cdpProxyTools from './tools/cdp-proxy.js';
import * as jshookCollectorTools from './tools/collector.js';
import * as consoleTools from './tools/console.js';
import * as debuggerTools from './tools/debugger.js';
import * as dialogTools from './tools/dialog.js';
import * as jshookDomTools from './tools/dom.js';
import * as emulationTools from './tools/emulation.js';
import * as frameTools from './tools/frames.js';
import * as jshookHookTools from './tools/hook.js';
import * as inputTools from './tools/input.js';
import * as networkTools from './tools/network.js';
import * as jshookPageTools from './tools/page.js';
import * as pagesTools from './tools/pages.js';
import * as performanceTools from './tools/performance.js';
import * as jshookRebuildTools from './tools/rebuild.js';
import {getJSHookRuntime} from './tools/runtime.js';
import * as screenshotTools from './tools/screenshot.js';
import * as scriptTools from './tools/script.js';
import * as siteExperienceTools from './tools/siteExperience.js';
import * as jshookStealthTools from './tools/stealth.js';
import * as antiDebugTools from './tools/anti-debug/bypassDebugger.js';
import * as antiAntiDebugTools from './tools/anti-debug/antiAntiDebug.js';
import * as cryptoTools from './tools/crypto/hookCryptoJS.js';
import * as cryptoJSEncryptTools from './tools/crypto/hookJSEncrypt.js';
import * as cryptoSMCryptoTools from './tools/crypto/hookSMCrypto.js';
import * as vueGetRoutesTools from './tools/vue/getVueRoutes.js';
import * as vueClearGuardsTools from './tools/vue/clearVueGuards.js';
import * as vueActivateDevtoolsTools from './tools/vue/activateVueDevtools.js';
import * as extensionsTools from './tools/extensions.js';
import type {ToolDefinition} from './tools/ToolDefinition.js';
import {ToolRegistry} from './tools/ToolRegistry.js';
import * as websocketTools from './tools/websocket.js';
import {ErrorCodes, formatError} from './utils/errors.js';
import {TokenBudgetManager} from './utils/TokenBudgetManager.js';
import {ToolExecutionScheduler} from './utils/ToolExecutionScheduler.js';
import {registerBuiltInSkills, SkillRegistry} from './skills/index.js';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import type {IncomingMessage, ServerResponse} from 'node:http';

// If moved update release-please config
// x-release-please-start-version
const VERSION = '2.0.3';
// x-release-please-end

export const args = parseArguments(VERSION);

const logFile = args.logFile ? saveLogsToFile(args.logFile) : undefined;

logger(`Starting Chrome DevTools MCP Server v${VERSION}`);
const server = new McpServer(
  {
    name: 'chrome_devtools',
    title: 'Chrome DevTools MCP server',
    version: VERSION,
  },
  {capabilities: {logging: {}}},
);
server.server.setRequestHandler(SetLevelRequestSchema, () => {
  return {};
});

// Initialize database connection if databaseUrl is provided
if (args.databaseUrl) {
  try {
    await dbService.connect(args.databaseUrl);
    await dbService.migrate();
    logger('[main] Database initialized');
  } catch (error) {
    logger('[main] Failed to initialize database', error);
    // Continue without database - tools will return appropriate errors
  }
}

let context: McpContext;
async function getContext(): Promise<McpContext> {
  const extraArgs: string[] = (args.chromeArg ?? []).map(String);
  if (args.proxyServer) {
    extraArgs.push(`--proxy-server=${args.proxyServer}`);
  }
  const devtools = args.experimentalDevtools ?? false;
  // Get session ID from environment variable or command line argument
  // This is used for page ownership isolation when multiple server instances
  // connect to the same browser instance.
  const sessionId = process.env.MCP_SESSION_ID || args.sessionId;
  const autoConnectTarget =
    !args.browserUrl && !args.wsEndpoint && args.autoConnect
      ? await resolveAutoConnectTarget()
      : undefined;
  const browser =
    args.browserUrl || args.wsEndpoint || autoConnectTarget
      ? await ensureBrowserConnected({
          browserURL: args.browserUrl ?? autoConnectTarget?.browserURL,
          wsEndpoint: args.wsEndpoint ?? autoConnectTarget?.wsEndpoint,
          wsHeaders: args.wsHeaders,
          devtools,
        })
      : await ensureBrowserLaunched({
          headless: args.headless,
          executablePath: args.executablePath,
          channel: args.channel as Channel,
          isolated: args.isolated,
          logFile,
          viewport: args.viewport,
          args: extraArgs,
          acceptInsecureCerts: args.acceptInsecureCerts,
          devtools,
        });

  if (context?.browser !== browser) {
    context = await McpContext.from(browser, logger, {
      experimentalDevToolsDebugging: devtools,
      experimentalIncludeAllPages: args.experimentalIncludeAllPages,
      sessionId,
    });
  }
  return context;
}

const logDisclaimers = () => {
  console.error(
    `chrome-devtools-mcp exposes content of the browser instance to the MCP clients allowing them to inspect,
debug, and modify any data in the browser or DevTools.
Avoid sharing sensitive or personal information that you do not want to share with MCP clients.`,
  );
};

const toolScheduler = new ToolExecutionScheduler();
const tokenBudgetManager = TokenBudgetManager.getInstance();
const toolCanonicalSourceOverrides: Record<string, string> = {};

function createTraceId(toolName: string): string {
  return `${toolName}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function withTraceIdContent(content: CallToolResult['content'], traceId: string): CallToolResult['content'] {
  return [
    {
      type: 'text',
      text: JSON.stringify({traceId}, null, 2),
    },
    ...content,
  ];
}

function logToolEvent(traceId: string, toolName: string, phase: string, details: Record<string, unknown> = {}): void {
  logger(JSON.stringify({
    type: 'tool_event',
    traceId,
    tool: toolName,
    phase,
    ...details,
  }));
}

function registerTool(tool: ToolDefinition): void {
  if (
    tool.annotations.category === ToolCategory.NETWORK &&
    args.categoryNetwork === false
  ) {
    return;
  }
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.schema,
      annotations: tool.annotations,
    },
    async (params): Promise<CallToolResult> => {
      return toolScheduler.execute(tool.annotations.readOnlyHint, async () => {
        const traceId = createTraceId(tool.name);
        const startedAt = Date.now();
        try {
          logToolEvent(traceId, tool.name, 'request', {params});
          const context = await getContext();
          logToolEvent(traceId, tool.name, 'context_resolved');
          await context.detectOpenDevToolsWindows();
          getJSHookRuntime().bindPageContext(() => context.getSelectedPage());
          const response = new McpResponse();
          await tool.handler(
            {
              params,
            },
            response,
            context,
          );
          try {
            const result = await response.handle(tool.name, context);
            const wrapped = withTraceIdContent(result.content, traceId);
            tokenBudgetManager.recordToolCall(tool.name, params, result.content);
            logToolEvent(traceId, tool.name, 'success', {durationMs: Date.now() - startedAt});
            return {
              content: wrapped,
              structuredContent: result.structuredContent as Record<string, unknown> | undefined,
            };
          } catch (error) {
            const formatted = formatError(error, ErrorCodes.TOOL_EXECUTION_ERROR, {
              tool: tool.name,
              traceId,
            });
            tokenBudgetManager.recordToolCall(tool.name, params, formatted);
            logToolEvent(traceId, tool.name, 'response_error', {durationMs: Date.now() - startedAt, error: formatted});

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({traceId, ...formatted}, null, 2),
                },
              ],
              isError: true,
            };
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logToolEvent(traceId, tool.name, 'handler_error', {error: message, durationMs: Date.now() - startedAt});
          throw err;
        }
      });
    },
  );
}

function asTools(module: object): ToolDefinition[] {
  return Object.values(module) as unknown as ToolDefinition[];
}

const toolSources: Array<{source: string; tools: ToolDefinition[]}> = [
  {source: 'console', tools: asTools(consoleTools)},
  {source: 'debugger', tools: asTools(debuggerTools)},
  {source: 'dialog', tools: asTools(dialogTools)},
  {source: 'emulation', tools: asTools(emulationTools)},
  {source: 'frames', tools: asTools(frameTools)},
  {source: 'input', tools: asTools(inputTools)},
  {source: 'network', tools: asTools(networkTools)},
  {source: 'pages', tools: asTools(pagesTools)},
  {source: 'performance', tools: asTools(performanceTools)},
  {source: 'screenshot', tools: asTools(screenshotTools)},
  {source: 'script', tools: asTools(scriptTools)},
  {source: 'jshookCollector', tools: asTools(jshookCollectorTools)},
  {source: 'jshookAnalyzer', tools: asTools(jshookAnalyzerTools)},
  {source: 'jshookHook', tools: asTools(jshookHookTools)},
  {source: 'jshookStealth', tools: asTools(jshookStealthTools)},
  {source: 'jshookDom', tools: asTools(jshookDomTools)},
  {source: 'jshookPage', tools: asTools(jshookPageTools)},
  {source: 'jshookRebuild', tools: asTools(jshookRebuildTools)},
  {source: 'websocket', tools: asTools(websocketTools)},
  {source: 'cdp-proxy', tools: asTools(cdpProxyTools)},
  {source: 'siteExperience', tools: asTools(siteExperienceTools)},
  {source: 'anti-debug', tools: [...asTools(antiDebugTools), ...asTools(antiAntiDebugTools)]},
  {source: 'crypto', tools: [...asTools(cryptoTools), ...asTools(cryptoJSEncryptTools), ...asTools(cryptoSMCryptoTools)]},
  {source: 'vue', tools: [...asTools(vueGetRoutesTools), ...asTools(vueClearGuardsTools), ...asTools(vueActivateDevtoolsTools)]},
  {source: 'extensions', tools: asTools(extensionsTools)},
];

const tools = toolSources.flatMap((entry) =>
  entry.tools.map((tool) => ({
    source: entry.source,
    tool,
  })),
);

function applyCanonicalSelection(allTools: Array<{source: string; tool: ToolDefinition}>): ToolDefinition[] {
  const selected = new Map<string, {source: string; tool: ToolDefinition}>();
  for (const entry of allTools) {
    const existing = selected.get(entry.tool.name);
    if (!existing) {
      selected.set(entry.tool.name, entry);
      continue;
    }

    const preferSource = toolCanonicalSourceOverrides[entry.tool.name];
    if (preferSource && entry.source === preferSource) {
      selected.set(entry.tool.name, entry);
    }
  }
  return Array.from(selected.values()).map((entry) => entry.tool);
}

const registry = new ToolRegistry();
registry.registerMany(applyCanonicalSelection(tools));

const registeredTools = registry.values();
registeredTools.sort((a, b) => {
  return a.name.localeCompare(b.name);
});

for (const tool of registeredTools) {
  const aliases = registry.aliasesFor(tool.name);
  if (aliases.length > 0) {
    tool.aliases = aliases;
  }
  registerTool(tool);
  for (const alias of aliases) {
    registerTool({
      ...tool,
      name: alias,
      aliases: [],
      description: `${tool.description} (alias of ${tool.name})`,
    });
  }
}

if (features.issues) {
  await loadIssueDescriptions();
}

// 注册技能系统
registerBuiltInSkills();
const skillRegistry = SkillRegistry.getInstance();
const skills = skillRegistry.list();
logger(`Registered ${skills.length} skills`);

// Start server based on mode (HTTP or stdio)
if (args.http) {
  // HTTP mode
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS headers for browser-based clients
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    // Read request body for POST requests
    let body: any = null;
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const rawData = Buffer.concat(chunks).toString();
      body = rawData ? JSON.parse(rawData) : null;
    }

    if (sessionId && transports[sessionId]) {
      // Reuse existing transport
      transport = transports[sessionId];
    } else if (!sessionId && body && isInitializeRequest(body)) {
      // New initialization request - create session
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId: string) => {
          transports[newSessionId] = transport;
          logger(`[HTTP] Session initialized: ${newSessionId}`);
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          delete transports[transport.sessionId];
          logger(`[HTTP] Session closed: ${transport.sessionId}`);
        }
      };

      await server.connect(transport);
    } else if (!sessionId && req.method === 'POST') {
      // Stateless mode - create transport per request
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      res.on('close', () => {
        transport.close();
      });

      await server.connect(transport);
    } else {
      // Invalid request
      res.writeHead(400, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided or invalid request'
        },
        id: null
      }));
      return;
    }

    // Handle the request
    await transport.handleRequest(req, res, body);
  });

  const port = args.port || 3000;
  const host = args.host || '127.0.0.1';

  httpServer.listen(port, host, () => {
    logger(`Chrome DevTools MCP Server v${VERSION} running on http://${host}:${port}/mcp`);
    console.error(`Chrome DevTools MCP Server v${VERSION} running on http://${host}:${port}/mcp`);
    logDisclaimers();
  });

  httpServer.on('error', (error) => {
    logger('[main] HTTP server error', error);
    console.error('HTTP server error:', error);
    process.exit(1);
  });
} else {
  // Stdio mode (default)
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger('Chrome DevTools MCP Server connected');
  logDisclaimers();
}
