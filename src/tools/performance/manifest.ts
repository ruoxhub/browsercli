/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'performance',
  description: 'Performance trace and metrics tools.',
  profile: 'full',
  tools: [
    {
      modulePath: './performance/startPerformanceTrace.js',
      handlerName: 'startPerformanceTrace',
    },
    {
      modulePath: './performance/stopPerformanceTrace.js',
      handlerName: 'stopPerformanceTrace',
    },
    {
      modulePath: './performance/getPerformanceMetrics.js',
      handlerName: 'getPerformanceMetrics',
    },
    {
      modulePath: './performance/performanceAnalyzeInsight.js',
      handlerName: 'performanceAnalyzeInsight',
    },
  ],
} satisfies DomainManifest;
