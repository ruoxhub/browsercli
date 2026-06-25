/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'hook',
  description: 'JavaScript runtime hook creation and management tools.',
  prerequisites: {
    injectHook: [
      {condition: 'requiresPage', fix: 'Start or attach a browser page first.'},
    ],
    hookCookie: [
      {condition: 'requiresPage', fix: 'Start or attach a browser page first.'},
    ],
    hookFetch: [
      {condition: 'requiresPage', fix: 'Start or attach a browser page first.'},
    ],
  },
  toolDependencies: [
    {from: 'injectHook', to: 'createHook', relation: 'requires', weight: 1},
    {from: 'hookCookie', to: 'injectHook', relation: 'uses', weight: 0.8},
    {from: 'hookFetch', to: 'injectHook', relation: 'uses', weight: 0.8},
  ],
  sceneKeywords: {
    hookCookie: ['cookie', 'document.cookie', 'runtime hook'],
    hookFetch: ['fetch', 'request', 'network hook'],
    injectHook: ['inject', 'runtime', 'instrumentation'],
  },
  tools: [
    {modulePath: './hook/CreateHook.js', handlerName: 'createHook'},
    {modulePath: './hook/InjectHook.js', handlerName: 'injectHook'},
    {modulePath: './hook/InjectHook.js', handlerName: 'listPersistentHooks'},
    {modulePath: './hook/GetHookData.js', handlerName: 'getHookData'},
    {modulePath: './hook/RemoveHook.js', handlerName: 'removeHook'},
    {modulePath: './hook/ListCreatedHooks.js', handlerName: 'listCreatedHooks'},
    
  ],
} satisfies DomainManifest;
