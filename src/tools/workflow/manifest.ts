/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'workflow',
  description: 'High-level reverse engineering workflow tools.',
  profile: 'workflow',
  prerequisites: {
    observeFlow: [
      {condition: 'requiresPage', fix: 'Start or attach a browser page first.'},
    ],
    autoHook: [
      {condition: 'requiresPage', fix: 'Start or attach a browser page first.'},
    ],
    traceSignatureGeneration: [
      {condition: 'requiresPage', fix: 'Start or attach a browser page first.'},
    ],
  },
  toolDependencies: [
    {from: 'autoHook', to: 'observeFlow', relation: 'requires', weight: 1},
    {
      from: 'traceSignatureGeneration',
      to: 'observeFlow',
      relation: 'precedes',
      weight: 0.7,
    },
  ],
  sceneKeywords: {
    observeFlow: ['observe', 'network', 'console', 'flow'],
    autoHook: ['automatic hook', 'signature', 'runtime'],
    traceSignatureGeneration: ['signature', 'trace', 'request signing'],
  },
  workflowRule: {
    patterns: [
      /observe/i,
      /auto.*hook/i,
      /signature/i,
      /签名/u,
      /workflow/i,
      /blueprint/i,
    ],
    priority: 90,
    tools: ['observeFlow', 'autoHook', 'traceSignatureGeneration'],
    hint: 'Use workflow contracts to select observe, hook, rebuild, or signature tracing flows.',
  },
  tools: [
    {modulePath: './workflow/observeFlow.js', handlerName: 'observeFlow'},
    {modulePath: './workflow/autoHook.js', handlerName: 'autoHook'},
    {modulePath: './workflow/rebuildBundle.js', handlerName: 'rebuildBundle'},
    {
      modulePath: './workflow/traceSignatureGeneration.js',
      handlerName: 'traceSignatureGeneration',
    },
  ],
} satisfies DomainManifest;
