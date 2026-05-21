/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {WorkflowContract} from './contracts.js';

export const builtinWorkflowContracts: WorkflowContract[] = [
  {
    kind: 'workflow-contract',
    version: 1,
    id: 'observe-flow',
    displayName: 'Observe Flow',
    description:
      'Collect page, console, network and script evidence before choosing hooks.',
    route: {
      patterns: [/observe/i, /分析.*流程/u, /抓.*流程/u],
      priority: 80,
      requiredDomains: ['workflow', 'network', 'console', 'collector'],
      hint: 'Start with observeFlow before injecting hooks.',
    },
    steps: [
      {
        id: 'observe',
        toolName: 'observeFlow',
        description: 'Collect baseline runtime evidence.',
        prerequisites: ['requiresPage'],
      },
    ],
  },
  {
    kind: 'workflow-contract',
    version: 1,
    id: 'auto-hook',
    displayName: 'Auto Hook',
    description:
      'Observe candidate behavior, generate hook code, then inject it.',
    route: {
      patterns: [/auto.*hook/i, /自动.*hook/u, /自动.*注入/u],
      priority: 90,
      requiredDomains: ['workflow', 'hook'],
      hint: 'Observe first, create hook second, inject last.',
    },
    steps: [
      {
        id: 'observe',
        toolName: 'observeFlow',
        description: 'Find hook targets.',
        prerequisites: ['requiresPage'],
      },
      {
        id: 'create',
        toolName: 'createHook',
        description: 'Create hook script.',
        prerequisites: [],
      },
      {
        id: 'inject',
        toolName: 'injectHook',
        description: 'Inject hook script.',
        prerequisites: ['requiresPage'],
      },
    ],
  },
  {
    kind: 'workflow-contract',
    version: 1,
    id: 'rebuild-bundle',
    displayName: 'Rebuild Bundle',
    description:
      'Rebuild collected JavaScript bundle artifacts for offline analysis.',
    route: {
      patterns: [/rebuild/i, /重建.*bundle/u],
      priority: 70,
      requiredDomains: ['workflow', 'rebuild'],
      hint: 'Collect code before rebuilding bundle artifacts.',
    },
    steps: [
      {
        id: 'rebuild',
        toolName: 'rebuildBundle',
        description: 'Rebuild bundle from collected artifacts.',
        prerequisites: [],
      },
    ],
  },
  {
    kind: 'workflow-contract',
    version: 1,
    id: 'trace-signature-generation',
    displayName: 'Trace Signature Generation',
    description: 'Trace request signing and signature generation flow.',
    route: {
      patterns: [/signature/i, /签名/u, /追.*签/u],
      priority: 95,
      requiredDomains: ['workflow', 'debugger', 'hook', 'network'],
      hint: 'Capture request evidence, then trace signature generation.',
    },
    steps: [
      {
        id: 'trace',
        toolName: 'traceSignatureGeneration',
        description: 'Trace signing flow.',
        prerequisites: ['requiresPage'],
      },
    ],
  },
];
