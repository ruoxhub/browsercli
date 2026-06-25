/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'network',
  description: 'Network and WebSocket inspection tools.',
  profile: 'workflow',
  tools: [
    {modulePath: './network/listNetworkRequests.js', handlerName: 'listNetworkRequests'},
    {modulePath: './network/getNetworkRequest.js', handlerName: 'getNetworkRequest'},
    {modulePath: './network/clearNetworkRequests.js', handlerName: 'clearNetworkRequests'},
    {modulePath: './network/listConnections.js', handlerName: 'listWebSocketConnections'},
    {modulePath: './network/getMessages.js', handlerName: 'getWebSocketMessages'},
    {modulePath: './network/getMessage.js', handlerName: 'getWebSocketMessage'},
    {modulePath: './network/analyzeMessages.js', handlerName: 'analyzeWebSocketMessages'},
  ],
} satisfies DomainManifest;
